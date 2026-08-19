{
  "targets": [{
    "target_name": "koala_hit",
    "sources": ["src/native/koala_hit.mm"],
    "cflags": ["-fvisibility=hidden", "-std=c++17"],
    "cflags_cc": ["-fvisibility=hidden", "-std=c++17"],
    "xcode_settings": {
      "MACOSX_DEPLOYMENT_TARGET": "10.15",
      "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
      "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
      "GCC_ENABLE_CPP_RTTI": "YES"
    },
    "conditions": [
      ["OS=='mac'", {
        "link_settings": {
          "libraries": ["-framework Cocoa", "-framework ApplicationServices", "-framework CoreFoundation"]
        }
      }]
    ]
  }]
}
