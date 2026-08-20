// macOS 形状级点击穿透（纯 N-API + Objective-C++，无第三方依赖）。
//
// 思路：重写 pet 窗口内容视图的 -hitTest:withEvent:。
//   - 点击落在考拉实体像素（alpha 掩膜为 1）→ 返回原始命中视图，事件交给窗口，
//     DOM 的 mousedown/up 正常触发（敲木鱼、拖拽、长按都靠它）。
//   - 点击落在透明区域（掩膜为 0）→ 返回 nil，事件穿透到下层窗口（浏览器/桌面），
//     于是「考拉旁边的空白」能点到下面的应用，点真的空桌面也照常工作。
//
// 关键点：窗口本身是 NSPanel + focusable:false，所以即使收到点击也不会激活 app、
// 不会抢走浏览器焦点；而透明区域因为 hitTest 返回 nil，压根不会落到本窗口。
// 这一整套不需要「输入监控」等任何系统隐私权限，比 CGEventTap 拦截稳得多。
//
// 坐标说明：hitTest: 的 point 是视图本地坐标（原点左下、单位 point）；
// 渲染进程传来的掩膜是「窗口内左上原点」的 0/1 数据，故 y 需要翻转：
//   mask_x = point.x - left
//   mask_y = (bounds.height - point.y) - top

#include <node_api.h>
#include <Cocoa/Cocoa.h>
#include <objc/runtime.h>
#include <string.h>
#include <stdlib.h>

static void* g_view = NULL;          // 已安装 hitTest 重写的 NSView
static Class g_subCls = NULL;        // 动态创建的子类 KoalaHitView
static IMP g_origHitTest = NULL;     // 原始 hitTest: 实现（保留以返回正确命中目标）

static int g_left = 0, g_top = 0, g_w = 0, g_h = 0;
static uint8_t* g_mask = NULL;
static size_t g_maskLen = 0;
static bool g_enabled = false;

static NSView* koalaHitTest(id self, SEL _cmd, NSPoint point, NSEvent* event) {
  bool enabled = g_enabled && g_mask && g_w > 0 && g_h > 0;
  if (enabled) {
    NSRect b = [self bounds];
    CGFloat H = b.size.height;
    CGFloat pty = H - point.y;   // 翻到左上原点，与掩膜一致
    // 矩形粗筛：矩形外一定是窗口外圈空白 → 穿透到下层
    if (point.x < g_left || point.x > g_left + g_w ||
        pty < g_top  || pty > g_top + g_h) {
      return nil;
    }
    // 矩形内：逐像素查掩膜，只拦截考拉实体像素（alpha 非透明）。
    // 考拉精灵图是方形、四周大量透明留白——这些透明像素必须穿透到下层，
    // 否则「考拉附近」会变成一层点不透的透明隔层。
    int mx = (int)round(point.x - g_left);
    int my = (int)round(pty - g_top);
    if (mx >= 0 && my >= 0 && mx < g_w && my < g_h && g_mask[(size_t)my * g_w + mx]) {
      // 考拉实体像素：交原始命中，DOM 正常收到点击
      if (g_origHitTest) {
        typedef NSView* (*fnT)(id, SEL, NSPoint, NSEvent*);
        return ((fnT)g_origHitTest)(self, _cmd, point, event);
      }
      return self;
    }
    // 透明像素：穿透到下层（点考拉旁边的按钮/链接/桌面都有反应）
    return nil;
  }
  // 未启用掩膜（加载期过渡态）：原样行为，整窗接收事件
  if (g_origHitTest) {
    typedef NSView* (*fnT)(id, SEL, NSPoint, NSEvent*);
    return ((fnT)g_origHitTest)(self, _cmd, point, event);
  }
  return self;
}

static napi_value Install(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_error(env, NULL, "install expects a native handle buffer");
    return NULL;
  }

  void* buf = NULL;
  size_t len = 0;
  if (napi_get_buffer_info(env, argv[0], &buf, &len) != napi_ok || len < 8) {
    napi_throw_error(env, NULL, "install: invalid handle buffer");
    return NULL;
  }
  void* ptr = *(void**)buf;
  if (!ptr) {
    napi_throw_error(env, NULL, "install: null handle");
    return NULL;
  }

  // getNativeWindowHandle() 在 macOS 上可能返回 NSWindow* 或 NSView*，两种都兼容。
  id obj = (__bridge id)ptr;
  NSView* view = nil;
  if ([obj isKindOfClass:[NSWindow class]]) {
    view = [(NSWindow*)obj contentView];
  } else if ([obj isKindOfClass:[NSView class]]) {
    view = (NSView*)obj;
  }
  if (!view) {
    napi_throw_error(env, NULL, "install: cannot resolve NSView");
    return NULL;
  }

  Class origCls = [view class];
  if (g_subCls == NULL) {
    // 从 NSView 基类取 hitTest:withEvent: 的实现。某些 Electron 版本的内容视图类
    // 用 class_getInstanceMethod 直接查不到这个方法（"not found"），但只要它是 NSView
    // 子类，基类的实现一定可用——用基类的实现当「原始实现」即可，调用时对普通视图
    // 会正确返回命中子视图（webview），从而让 DOM 正常收到点击。
    Method baseM = class_getInstanceMethod([NSView class], @selector(hitTest:withEvent:));
    if (!baseM) {
      napi_throw_error(env, NULL, "install: NSView hitTest:withEvent: not found");
      return NULL;
    }
    g_origHitTest = method_getImplementation(baseM);
    g_subCls = objc_allocateClassPair(origCls, "KoalaHitView", 0);
    if (!g_subCls) {
      napi_throw_error(env, NULL, "install: objc_allocateClassPair failed");
      return NULL;
    }
    class_addMethod(g_subCls, @selector(hitTest:withEvent:),
                    (IMP)koalaHitTest, method_getTypeEncoding(baseM));
    objc_registerClassPair(g_subCls);
  }

  // 仅把本实例的类切到子类（不影响其它窗口）
  if (object_getClass(view) != g_subCls) {
    object_setClass(view, g_subCls);
  }
  g_view = (__bridge void*)view;
  return NULL;
}

static napi_value SetMask(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 5) {
    napi_throw_error(env, NULL, "setMask expects (left, top, w, h, mask)");
    return NULL;
  }
  int32_t left, top, w, h;
  napi_get_value_int32(env, argv[0], &left);
  napi_get_value_int32(env, argv[1], &top);
  napi_get_value_int32(env, argv[2], &w);
  napi_get_value_int32(env, argv[3], &h);

  void* data = NULL;
  size_t dlen = 0;
  if (napi_get_typedarray_info(env, argv[4], NULL, &dlen, &data, NULL, NULL) != napi_ok) {
    napi_throw_error(env, NULL, "setMask: mask must be a TypedArray");
    return NULL;
  }

  free(g_mask);
  g_mask = NULL;
  g_left = left;
  g_top = top;
  g_w = w;
  g_h = h;
  g_maskLen = 0;

  if (w > 0 && h > 0 && dlen == (size_t)w * h && data) {
    g_mask = (uint8_t*)malloc(dlen);
    memcpy(g_mask, data, dlen);
    g_maskLen = dlen;
    g_enabled = true;
  } else {
    g_enabled = false;
  }
  return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, Install, NULL, &fn);
  napi_set_named_property(env, exports, "install", fn);
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, SetMask, NULL, &fn);
  napi_set_named_property(env, exports, "setMask", fn);
  return exports;
}

NAPI_MODULE(koala_hit, Init)
