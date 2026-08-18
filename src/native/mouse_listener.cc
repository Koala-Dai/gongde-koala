// macOS 全局鼠标监听（纯 N-API 原生模块，无第三方头依赖）。
// 用 CGEventTap 监听全局左/右键 down/up/drag，把屏幕坐标回调给 JS。
// 关键：回调里**原样返回 event**（不消费），所以下层 app（浏览器/编辑器）照样收到点击，
// 我们只是「顺便」探知坐标。这样考拉窗口可以永远保持纯穿透、绝不激活 app。
//
// 注意：CGEventTap 监听全局输入在 macOS 10.15+ 需要「输入监控」或「辅助功能」权限。
// 未授权时 CGEventTapCreate 返回 NULL，调用方应提示用户授权。

#include <node_api.h>
#include <ApplicationServices/ApplicationServices.h>
#include <thread>
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

static CGEventRef tapCallback(CGEventTapProxy, CGEventType type, CGEventRef event, void*) {
  int code = 0;
  switch (type) {
    case kCGEventLeftMouseDown: code = EV_LEFT_DOWN; break;
    case kCGEventLeftMouseUp: code = EV_LEFT_UP; break;
    case kCGEventLeftMouseDragged: code = EV_LEFT_DRAG; break;
    case kCGEventRightMouseDown: code = EV_RIGHT_DOWN; break;
    case kCGEventRightMouseUp: code = EV_RIGHT_UP; break;
    case kCGEventRightMouseDragged: code = EV_RIGHT_DRAG; break;
    default: return event;
  }
  CGPoint p = CGEventGetLocation(event);
  evt_t* e = (evt_t*)malloc(sizeof(evt_t));
  e->code = code;
  e->x = (int)p.x;
  e->y = (int)p.y;
  if (g_tsfn) {
    napi_call_threadsafe_function(g_tsfn, e, napi_tsfn_nonblocking);
  } else {
    free(e);
  }
  return event; // 不消费，下层 app 照常收到
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

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn_start, fn_stop;
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, Start, NULL, &fn_start);
  napi_create_function(env, NULL, NAPI_AUTO_LENGTH, Stop, NULL, &fn_stop);
  napi_set_named_property(env, exports, "start", fn_start);
  napi_set_named_property(env, exports, "stop", fn_stop);
  return exports;
}

NAPI_MODULE(mouse_listener, Init)
