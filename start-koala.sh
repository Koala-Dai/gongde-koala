#!/bin/bash
# 功德考拉启动脚本
# WorkBuddy 环境下设了 ELECTRON_RUN_AS_NODE=1，会导致 Electron 以 Node 模式运行而非 GUI 模式。
# 此脚本清除该变量并加 --no-sandbox 以在开发环境中正常启动。
cd /Users/koaladai/gongde-koala
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
  ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox .
