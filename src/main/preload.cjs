// 预加载：只暴露渲染进程真正需要的几个方法，不放 ipcRenderer 本体。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('koala', {
  /** 鼠标是否落在考拉实体像素上——决定窗口接管还是穿透（旧 forward 方案用） */
  setInteractive: (v) => ipcRenderer.send('pet:set-interactive', v),
  /** 渲染进程算好的命中掩膜：原生全局监听用它在屏幕坐标上判断点的是不是考拉 */
  setMask: (mask) => ipcRenderer.send('pet:set-mask', mask),
  pointerDown: () => ipcRenderer.send('pet:pointerdown'),
  pointerUp: () => ipcRenderer.send('pet:pointerup'),
  /** 右键考拉弹出菜单（托盘之外的备用入口） */
  contextMenu: () => ipcRenderer.send('pet:contextmenu'),
  /** 主进程判定为「点击而非拖动」后回调 */
  onClick: (fn) => ipcRenderer.on('pet:click', () => fn()),
  onSettingsChanged: (fn) => ipcRenderer.on('settings:changed', (_e, s) => fn(s)),

  knock: (rewardKey) => ipcRenderer.invoke('stats:knock', rewardKey),
  today: () => ipcRenderer.invoke('stats:today'),
  recent: (n) => ipcRenderer.invoke('stats:recent', n),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getVersion: () => ipcRenderer.invoke('app:version'),

  /** 今日功德面板 */
  togglePanel: () => ipcRenderer.send('panel:toggle'),
  closePanel: () => ipcRenderer.send('panel:close'),
  onPanelRefresh: (fn) => ipcRenderer.on('panel:refresh', () => fn()),

  /** 聊天 */
  toggleChat: () => ipcRenderer.send('chat:toggle'),
  closeChat: () => ipcRenderer.send('chat:close'),
  minimizeChat: () => ipcRenderer.send('chat:minimize'),
  maximizeChat: () => ipcRenderer.send('chat:maximize'),
  isChatMaximized: () => ipcRenderer.invoke('chat:is-maximized'),
  onChatMaximized: (fn) => ipcRenderer.on('chat:maximized', (_e, v) => fn(v)),
  chatSend: (text) => ipcRenderer.invoke('chat:send', text),
  onChatFocus: (fn) => ipcRenderer.on('chat:focus', () => fn()),
  /** 重置对话上下文 */
  chatReset: () => ipcRenderer.invoke('chat:reset'),
  /** 每日能量签 */
  dailyEnergy: () => ipcRenderer.invoke('chat:daily-energy'),
  /** 抽签 + AI 解读 */
  drawLot: () => ipcRenderer.invoke('chat:draw-lot'),
  /** AI 塔罗三选一：抽 3 张牌 */
  tarotDraw: () => ipcRenderer.invoke('chat:tarot-draw'),
  /** AI 塔罗：用户选了一张牌 → AI 解读 */
  tarotPick: (card) => ipcRenderer.invoke('chat:tarot-pick', card),
  /** 幸运数字 */
  luckyNumber: () => ipcRenderer.invoke('chat:lucky-number'),
  /** 星座匹配 */
  zodiacMatch: (sign1, sign2) => ipcRenderer.invoke('chat:zodiac-match', sign1, sign2),
  /** 心情测试题 */
  moodQuiz: () => ipcRenderer.invoke('chat:mood-quiz'),

  /** 检测更新：返回 { updateAvailable, currentVersion, latestVersion, downloadUrl, releaseUrl, releaseNotes } */
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  /** 主进程检测到更新时主动推送（含自动检查） */
  onUpdateAvailable: (fn) => ipcRenderer.on('app:update-available', (_e, info) => fn(info)),
  /** 用浏览器打开外部链接（下载安装包 / 更新说明） */
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  /** 用户点了「稍后」：记住该版本，自动检查不再打扰 */
  dismissUpdate: (version) => ipcRenderer.send('app:dismiss-update', version),
})
