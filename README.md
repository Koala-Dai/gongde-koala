# 功德考拉 🐨

陪你上班的「敲木鱼」桌面宠物。一只会陪你聊天、看八字、查星座、抽签占卜的治愈系考拉。

基于 **Electron 43 + ESM** 构建，常驻菜单栏（macOS）或系统托盘（Windows），无边框卡片风格，像一只趴在桌角的小宠物。

---

## ✨ 功能

- 🪵 **敲木鱼**：点击考拉随机功德 +1，配木鱼音效，记录今日功德
- 🔮 **玄学聊天**（多模式，支持连续对话）
  - 八字探索：输入生日排盘，生成「修行报告」式解读（事业 / 财运 / 感情 / 情绪）
  - 星座运势：问任意星座的今日 / 本月 / 今年运势
  - 今日占卜：能量签、抽签、AI 塔罗三选一、幸运数字、心情测试、星座配对
- 💬 **可复制**：聊天内容、占卜结果均可选中复制
- 🪟 **像普通窗口**：聊天窗口可最小化 / 最大化 / 关闭，出现在 Dock / 任务栏，可 `Cmd+Tab` 切换

---

## 📦 安装（给使用者）

去 **[Releases](../../releases)** 页面下载对应安装包：

- **macOS**：`功德考拉-0.1.0-arm64.dmg`（Apple 芯片）或 `功德考拉-0.1.0.dmg`（Intel）
- **Windows**：`功德考拉-Windows-x64.zip`，解压后运行里面的 `.exe`（便携版，无需安装）

> ⚠️ **macOS 打开提示**：本项目未购买 Apple 开发者证书，首次打开会提示「无法验证开发者」。
> 解决：右键（或 `Control`+点击）安装包 / 应用 → **打开**，或运行 `xattr -cr /Applications/功德考拉.app` 后重试。之后即可正常启动。

> ⚠️ **需要自己的 API Key**：AI 聊天功能依赖 DeepSeek API。首次使用在考拉菜单 → 设置中填入你自己的 DeepSeek Key（[获取地址](https://platform.deepseek.com/)）。Key 只存在你本机，不会上传。

---

## 🛠 本地开发

```bash
# 克隆
git clone https://github.com/<你的用户名>/gongde-koala.git
cd gongde-koala

# 安装依赖
npm install

# 启动（开发模式）
npm start

# 带日志启动
npm run dev
```

> 若在国内，仓库根目录 `.npmrc` 已配置 npmmirror 镜像以加速 Electron 下载。
> 若 CI / 海外环境下载慢，可临时注释 `.npmrc` 中的 mirror 行。

### 目录结构

```
src/
  main/        主进程：窗口、托盘、聊天 API、数据
  renderer/    渲染进程：桌宠动画 + 聊天界面
  shared/      八字排盘、玄学娱乐数据引擎
assets/
  koala/       考拉精灵图（运行时加载）
  audio/       木鱼音效
  icon-*       应用图标源
scripts/       精灵图 / 托盘图标构建脚本
build/         打包用图标（icns / png）
```

---

## 📦 打包

```bash
npm run build:mac    # 输出 dist/*.dmg（arm64 + x64）
npm run build:win    # 输出 dist/*.zip（Windows 便携版）
npm run build:all    # 同时打 mac + win
```

打包产物在 `dist/`，已被 `.gitignore` 忽略，不会进仓库。

---

## 🚀 自动发布（CI）

仓库已配置 GitHub Actions（`.github/workflows/release.yml`）：

1. 在本地打标签并推送：`git tag v0.1.0 && git push origin v0.1.0`
2. GitHub 自动在 macOS / Windows  runner 上构建
3. 构建产物自动发布到 **Releases**，任何人都能下载

---

## 📄 协议

[ISC](./LICENSE)
