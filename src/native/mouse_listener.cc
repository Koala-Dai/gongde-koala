// macOS 全局鼠标监听 + 点击拦截（纯 N-API 原生模块，无第三方头依赖）。
//
// 两个职责：
// 1. CGEventTap 监听全局左/右键 down/up/drag，把屏幕坐标回调给 JS（驱动敲木鱼/拖拽/长按）；
// 2. **拦截（吃掉）落在考拉实体像素上的点击**：tap callback 返回 NULL，
//    系统就不会把这次点击分发给下面的窗口（桌面墙纸/浏览器/编辑器）。
//    这样「点按墙纸显示桌面」等系统特性不会被误触，浏览器里的链接也不会被误点。
//    我们的 app 自身窗口仍保持纯穿透，绝不会因为点击而被激活。
//
// 注意：CGEventTap（可消费事件的 active tap）需要「输入监控」权限。
// 未授权时 CGEventTapCreate 返回 NULL，调用方应提示用户授权并退回 forward 方案。

#include <node_api.h>
#include <ApplicationServices/ApplicationServices.h>
#include <thread>
#include <mutex>
#include <vector>
#include <stdlib.h>
#include <string.h>

static napi_threadsafe_function g_tsfn = NULL;
static CFMachPortRef g_tap = NULL;
static CFRunLoopRef g_loop = NULL;
static std::thread g_thread;
static bool g_running = false;

enum {
  EV_LEFT_DOWN = 1,
  EV_LEFT_UP = 2,
  EV_LEFT_DRAG = 3,
  EV_RIGHT_DOWN = 4,
  EV_RIGHT_UP = 5,
  EV_RIGHT_DRAG = 6,
};

// ── 命中区域（屏幕坐标系）：由 JS 传入考拉掩膜的屏幕原点 + 0/1 掩膜 ──
typedef struct {
  int x = 0, y = 0, w = 0, h = 0;
  std::vector<uint8_t> data;
} region_t;

static region_t g_region;
static std::mutex g_region_mtx;
static bool g_region_valid = false;

// 按住状态：按下落在考拉上→ true，直到对应松开。期间 drag/up 一并吃掉，
// 保证下层窗口看到的 down/up 永远成对（不会出现「只收到 up」的怪状态）。
static bool g_left_held = false;
static bool g_right_held = false;

static bool hitRegion(int x, int y) {
  std::lock_guard<std::mutex> lock(g_region_mtx);
  if (!g_region_valid) return false;
  int lx = x - g_region.x, ly = y - g_region.y;
  if (lx < 0 || ly < 0 || lx >= g_region.w || ly >= g_region.h) return false;
  return g_region.data[(size_t)ly * g_region.w + lx] != 0;
}

typedef struct { int code; int x; int y; } evt_t;

// 在 JS 线程上被调用，把事件转成回调参数
static void call_js(napi_env env, napi_value js_cb, void* context, void* data) {
  evt_t* e = (evt_t*)data;
  napi_value argv[3];
  napi_create_int32(env, e->code, &argv[0]);
  napi_create_int32(env, e->x, &argv[1]);
  napi_create_int32(env, e->y, &argv[2]);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_value result;
  napi_call_function(env, undefined, js_cb, 3, argv, &result);
  free(e);
}

static void emit(int code, int x, int y) {
  evt_t* e = (evt_t*)malloc(sizeof(evt_t));
  e->code = code;
  e->x = x;
  e->y = y;
  if (g_tsfn) {
    napi_call_threadsafe_function(g_tsfn, e, napi_tsfn_nonblocking);
  } else {
    free(e);
  }
}

static CGEventRef tapCallback(CGEventTapProxy, CGEventType type, CGEventRef event, void*) {
  CGPoint p = CGEventGetLocation(event);
  int x = (int)p.x, y = (int)p.y;

  switch (type) {
    case kCGEventLeftMouseDown: {
      bool hit = hitRegion(x, y);
      g_left_held = hit;
      emit(EV_LEFT_DOWN, x, y);
      return hit ? NULL : event; // 落在考拉上：吃掉，桌面/浏览器收不到
    }
    case kCGEventLeftMouseUp: {
      bool swallow = g_left_held;
      g_left_held = false;
      emit(EV_LEFT_UP, x, y);
      return swallow ? NULL : event;
    }
    case kCGEventLeftMouseDragged: {
      emit(EV_LEFT_DRAG, x, y);
      return g_left_held ? NULL : event; // 拖的就是考拉，别让下层跟着滚
    }
    case kCGEventRightMouseDown: {
      bool hit = hitRegion(x, y);
      g_right_held = hit;
      emit(EV_RIGHT_DOWN, x, y);
      return hit ? NULL : event;
    }
    case kCGEventRightMouseUp: {
      bool swallow = g_right_held;
      g_right_held = false;
      emit(EV_RIGHT_UP, x, y);
      return swallow ? NULL : event;
    }
    case kCGEventRightMouseDragged: {
      emit(EV_RIGHT_DRAG, x, y);
      return g_right_held ? NULL : event;
    }
    default:
      return event;
  }
}

static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_valuetype vt;
  if (argc < 1 || !argv[0] || napi_typeof(env, argv[0], &vt) != napi_ok || vt != napi_function) {
    napi_throw_error(env, NULL, "mouse_listener.start expects a callback");
    return NULL;
  }
  if (g_running) return NULL;

  napi_value async_resource_name;
  napi_create_string_utf8(env, "mouse-listener", NAPI_AUTO_LENGTH, &async_resource_name);
  napi_status s = napi_create_threadsafe_function(
      env, argv[0], NULL, async_resource_name, 0, 1, NULL, NULL, NULL, call_js, &g_tsfn);
  if (s != napi_ok) {
    napi_throw_error(env, NULL, "failed to create threadsafe function");
    return NULL;
  }

  CGEventMask mask =
      CGEventMaskBit(kCGEventLeftMouseDown) | CGEventMaskBit(kCGEventLeftMouseUp) |
      CGEventMaskBit(kCGEventLeftMouseDragged) | CGEventMaskBit(kCGEventRightMouseDown) |
      CGEventMaskBit(kCGEventRightMouseUp) | CGEventMaskBit(kCGEventRightMouseDragged);

  // active tap：允许返回 NULL 消费事件（拦截点击的关键）。
  g_tap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap,
                           kCGEventTapOptionDefault, mask, tapCallback, nullptr);
  if (!g_tap) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
    napi_throw_error(env, NULL, "CGEventTapCreate_FAILED_INPUT_MONITORING");
    return NULL;
  }

  g_running = true;
  g_thread = std::thread([]() {
    g_loop = CFRunLoopGetCurrent();
    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(nullptr, g_tap, 0);
    CFRunLoopAddSource(g_loop, src, kCFRunLoopCommonModes);
    CFRelease(src);
    CFRunLoopRun();
  });
  return NULL;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
  if (g_tap) {
    if (g_loop) CFRunLoopStop(g_loop);
    CFMachPortInvalidate(g_tap);
    CFRelease(g_tap);
    g_tap = NULL;
  }
  if (g_thread.joinable()) g_thread.join();
  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
  }
  g_running = false;
  return NULL;
}

/** setRegion(x, y, w, h, Uint8Array mask)：设置考拉掩膜的屏幕原点与 0/1 数据 */
static napi_value SetRegion(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 5) {
    napi_throw_error(env, NULL, "setRegion expects (x, y, w, h, mask)");
    return NULL;
  }
  int32_t x, y, w, h;
  napi_get_value_int32(env, argv[0], &x);
  napi_get_value_int32(env, argv[1], &y);
  napi_get_value_int32(env, argv[2], &w);
  napi_get_value_int32(env, argv[3], &h);

  void* data = NULL;
  size_t len = 0;
  napi_get_typedarray_info(env, argv[4], NULL, &len, &data, NULL, NULL);

  {
    std::lock_guard<std::mutex> lock(g_region_mtx);
    g_region.x = x;
    g_region.y = y;
    g_region.w = w;
    g_region.h = h;
    g_region.data.assign((uint8_t*)data, (uint8_t*)data + len);
    g_region_valid = (w > 0 && h > 0 && len == (size_t)w * h);
  }
  return NULL;
}

/** setOrigin(x, y)：窗口拖动时只更新掩膜原点（免重传整张掩膜） */
static napi_value SetOrigin(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) return NULL;
  int32_t x, y;
  napi_get_value_int32(env, argv[0], &x);
  napi_get_value_int32(env, argv[1], &y);
  std::lock_guard<std::mutex> lock(g_region_mtx);
  g_region.x = x;
  g_region.y = y;
  return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, Start, NULL, &fn);
  napi_set_named_property(env, exports, "start", fn);
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, Stop, NULL, &fn);
  napi_set_named_property(env, exports, "stop", fn);
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, SetRegion, NULL, &fn);
  napi_set_named_property(env, exports, "setRegion", fn);
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, SetOrigin, NULL, &fn);
  napi_set_named_property(env, exports, "setOrigin", fn);
  return exports;
}

NAPI_MODULE(mouse_listener, Init)
