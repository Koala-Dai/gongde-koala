#!/usr/bin/env bash
# 编译全局鼠标监听原生模块（macOS only），产出「通用二进制」（arm64 + x64）。
# 产出的 .node 会放到 src/native/mouse_listener.node 并直接提交进仓库——
# N-API 是 ABI 稳定的，用 Node 头编译的 addon 可被 Electron 43 直接加载，
# 这样 CI 与 Windows 打包都无需现场编译（Windows 不编译，靠仓库里的通用 .node）。
# 注意：node-gyp 的编译目录 build/ 里还有应用图标 icon.*，rm 前先备份、编译后还原。
set -e

cd "$(dirname "$0")/.."

# 优先用项目里的 node-gyp，否则用全局
if [ -x ./node_modules/.bin/node-gyp ]; then
  NODE_GYP=./node_modules/.bin/node-gyp
else
  NODE_GYP=node-gyp
fi

# 确保能找到 python（node-gyp 需要）
if command -v python3 >/dev/null 2>&1; then
  export PYTHON=$(command -v python3)
elif [ -x /Users/koaladai/.workbuddy/binaries/python/versions/3.13.12/bin/python3 ]; then
  export PYTHON=/Users/koaladai/.workbuddy/binaries/python/versions/3.13.12/bin/python3
fi
echo "using python: ${PYTHON:-python3}"

OUT=src/native/mouse_listener.node

# node-gyp 产物全在 build/，但 build/ 里还有被 git 跟踪的应用图标。
# 备份目录方案不可靠（mktemp/沙箱环境差异），改用 git 直接恢复——最稳。
rm -rf build
BUILD_ONE() {
  local arch="$1"
  echo "==> configure + build ($arch)"
  "$NODE_GYP" configure --arch="$arch" >/dev/null
  "$NODE_GYP" build --arch="$arch" >/dev/null
  cp build/Release/mouse_listener.node "/tmp/ml-$arch.node"
}
restore_icons() {
  # 图标由 git 跟踪，无论中间过程如何，最后从 git 恢复
  git checkout -- build/ 2>/dev/null || true
}
trap restore_icons EXIT

BUILD_ONE arm64
BUILD_ONE x64

echo "==> lipo 合成通用二进制"
lipo -create /tmp/ml-arm64.node /tmp/ml-x64.node -output "$OUT"
restore_icons
trap - EXIT
echo "built: $OUT"
file "$OUT"
ls -la build/icon.* 2>/dev/null || echo "!! 警告：图标未恢复"
