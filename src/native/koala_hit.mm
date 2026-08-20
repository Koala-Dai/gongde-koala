// macOS 形状级点击穿透（纯 N-API + Objective-C++，无第三方依赖）。
//
// 双层 hitTest 重写（这是「透明区域点击穿透到下层」的关键）：
//   - NSWindow 级（KoalaHitWindow，重写 -hitTest:）：
//       点击落在透明像素 → 返回 nil → 窗口拒绝事件，AppKit 继续把点击交给下层窗口
//       （浏览器/桌面），这是 macOS 上实现「窗口某区域点击穿透」的标准机制。
//       点击落在考拉实体像素 → 返回内容视图命中结果 → 事件进入本窗口。
//   - NSView 级（KoalaHitView，重写 -hitTest:withEvent:）：
//       实体像素 → objc_msgSendSuper 走父类原始命中（返回 webview 子视图，
//       DOM 的 mousedown/up 正常触发：敲木鱼、拖拽、长按都靠它）。
//
// 关键点：窗口是 NSPanel + focusable:false，收到点击不会激活 app、不抢焦点；
// 透明像素在窗口级就返回 nil，事件穿透到下层。整套不需要任何系统隐私权限。
//
// 历史教训（决定性的）：
//   只重写内容视图的 hitTest 返回 nil，事件并不会穿透——NSWindow 自己仍在接收
//   鼠标事件，点击被窗口吞掉。必须同时重写 NSWindow 的 hitTest: 返回 nil。
//   class_getInstanceMethod 在 Electron 的 BridgedContentView 上返回 NULL（"not
//   found"），所以父类实现一律用 objc_msgSendSuper 走基类，不依赖方法查询。
//
// 坐标说明：
//   - 视图 hitTest:withEvent: 的 point 是视图本地坐标（原点左下）；
//   - 窗口 hitTest: 的 point 是窗口 base 坐标（原点左下）；
//   - 掩膜是「窗口内左上原点」的 0/1 数据。统一换算：
//       localPoint → 视图本地(左下) → pty = bounds.height - localPoint.y（距左上）
//       mask_x = localPoint.x - left，mask_y = pty - top

#include <node_api.h>
#include <Cocoa/Cocoa.h>
#include <objc/runtime.h>
#include <objc/message.h>
#include <string.h>
#include <stdlib.h>
#include <stdarg.h>
#include <stdio.h>
#include <time.h>

static NSView* g_view = NULL;          // 已注入的内容视图
static NSWindow* g_win = NULL;         // 已注入的窗口
static Class g_subCls = NULL;          // KoalaHitView（内容视图子类）
static Class g_winCls = NULL;          // KoalaHitWindow（窗口子类）

static int g_left = 0, g_top = 0, g_w = 0, g_h = 0;
static uint8_t* g_mask = NULL;
static size_t g_maskLen = 0;
static bool g_enabled = false;

// 原生侧诊断日志：写到 ~/koala_native.log
static void nlog(const char* fmt, ...) {
  char buf[1024];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  const char* home = getenv("HOME");
  if (!home) home = "/tmp";
  char path[2048];
  snprintf(path, sizeof(path), "%s/koala_native.log", home);
  FILE* f = fopen(path, "a");
  if (f) { fprintf(f, "[%ld] %s\n", (long)time(NULL), buf); fclose(f); }
}

/** 判定「视图本地坐标(左下原点)」是否落在考拉实体像素上。
 *  未启用掩膜时返回 true（整窗可点）。 */
static bool koalaPointHit(NSView* cv, NSPoint localPoint) {
  if (!g_enabled || !g_mask || g_w <= 0 || g_h <= 0) return true;
  NSRect b = [cv bounds];
  CGFloat H = b.size.height;
  CGFloat pty = H - localPoint.y;   // 翻到左上原点，与掩膜一致
  if (localPoint.x < g_left || localPoint.x > g_left + g_w ||
      pty < g_top  || pty > g_top + g_h) {
    return false;
  }
  int mx = (int)round(localPoint.x - g_left);
  int my = (int)round(pty - g_top);
  return mx >= 0 && my >= 0 && mx < g_w && my < g_h && g_mask[(size_t)my * g_w + mx];
}

/** 调用 [NSView class] 的 hitTest:withEvent: 原始实现（跳过子类 override）。 */
static NSView* callSuperHitTest(id self, SEL _cmd, NSPoint point, NSEvent* event) {
  struct objc_super sup = { self, [NSView class] };
  typedef NSView* (*superHitFn)(struct objc_super*, SEL, NSPoint, NSEvent*);
  return ((superHitFn)objc_msgSendSuper)(&sup, _cmd, point, event);
}

// ── 内容视图级 hitTest:withEvent: ─────────────────────────────
static NSView* koalaHitTest(id self, SEL _cmd, NSPoint point, NSEvent* event) {
  if (g_enabled && g_mask && g_w > 0 && g_h > 0) {
    // 透明像素：返回 nil（本视图不响应）。窗口级已拦截穿透，这里主要防漏。
    if (!koalaPointHit((NSView*)self, point)) return nil;
  }
  // 实体像素 / 未启用：走父类原始命中（返回命中的子视图，DOM 收到点击）
  return callSuperHitTest(self, _cmd, point, event);
}

// ── 窗口级 hitTest: ───────────────────────────────────────────
// 窗口 hitTest: 的 point 是窗口 base 坐标（原点左下）。
// 透明像素 → 返回 nil（窗口拒绝事件 → 点击穿透到下层窗口）← 穿透的关键
// 实体像素 → 返回内容视图的命中结果（事件进入本窗口，DOM 收到点击）
static NSView* koalaWindowHitTest(id self, SEL _cmd, NSPoint point) {
  NSWindow* win = (NSWindow*)self;
  NSView* cv = [win contentView];
  if (cv) {
    NSPoint lp = [cv convertPoint:point fromView:nil];   // 窗口坐标 → 视图本地
    if (koalaPointHit(cv, lp)) {
      // 实体像素：走内容视图的命中（KoalaHitView → 父类原始命中 → webview）
      return [cv hitTest:lp];
    }
    return nil;   // 透明像素：窗口拒绝，穿透到下层
  }
  // 理论上走不到；保险起见走窗口基类原始实现
  struct objc_super sup = { self, [NSWindow class] };
  typedef NSView* (*superHitFn)(struct objc_super*, SEL, NSPoint);
  return ((superHitFn)objc_msgSendSuper)(&sup, _cmd, point);
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
  BOOL isWin = [obj isKindOfClass:[NSWindow class]];
  BOOL isView = [obj isKindOfClass:[NSView class]];
  if (isWin) {
    view = [(NSWindow*)obj contentView];
  } else if (isView) {
    view = (NSView*)obj;
  }
  nlog("install: handle obj=%p isWindow=%d isView=%d contentView=%p",
       (void*)obj, (int)isWin, (int)isView, (void*)view);
  if (!view) {
    napi_throw_error(env, NULL, "install: cannot resolve NSView");
    return NULL;
  }

  Class origCls = [view class];
  Class winCls = [[view window] class];

  // 内容视图子类 KoalaHitView：重写 hitTest:withEvent:
  if (g_subCls == NULL) {
    g_subCls = objc_allocateClassPair(origCls, "KoalaHitView", 0);
    if (!g_subCls) {
      napi_throw_error(env, NULL, "install: objc_allocateClassPair failed");
      return NULL;
    }
    class_addMethod(g_subCls, @selector(hitTest:withEvent:),
                    (IMP)koalaHitTest, "@@:@{CGPoint=dd}");
    objc_registerClassPair(g_subCls);
    nlog("install: KoalaHitView 已注册 (parent=%s)", class_getName(origCls));
  }

  // 窗口子类 KoalaHitWindow：重写 hitTest:（透明像素穿透的关键）
  NSWindow* win = [view window];
  if (win) {
    if (g_winCls == NULL) {
      g_winCls = objc_allocateClassPair([win class], "KoalaHitWindow", 0);
      if (g_winCls) {
        class_addMethod(g_winCls, @selector(hitTest:),
                        (IMP)koalaWindowHitTest, "@@:{CGPoint=dd}");
        objc_registerClassPair(g_winCls);
        nlog("install: KoalaHitWindow 已注册 (parent=%s)", class_getName(winCls));
      }
    }
    if (g_winCls && object_getClass(win) != g_winCls) {
      object_setClass(win, g_winCls);
      g_win = win;
      nlog("install: 窗口 %p 已切换到 KoalaHitWindow", (void*)win);
    }
  } else {
    nlog("install: 警告：view 无窗口，跳过窗口级穿透注入");
  }

  // 仅把本实例的类切到子类（不影响其它窗口/视图）
  if (object_getClass(view) != g_subCls) {
    object_setClass(view, g_subCls);
  }
  g_view = view;
  nlog("install: OK，视图 %p 已安装 (class=%s) 窗口级=%d", (void*)view,
       class_getName(g_subCls), g_win ? 1 : 0);
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
    nlog("setMask: %dx%d left=%d top=%d (enabled)", w, h, left, top);
  } else {
    g_enabled = false;
    nlog("setMask: 尺寸不符 %dx%d dlen=%zu → 未启用", w, h, dlen);
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
