// 桌宠主进程：透明置顶窗口 + 形状级鼠标穿透 + 拖拽 + 托盘。
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
// ESM 模块里没有全局 require，加载 .node 原生模块必须用 createRequire 造一个
const require = createRequire(import.meta.url)
import {
  initStore, flushNow, recordKnock, getDay, getTotal,
  getPetPos, setPetPos, getSettings, setSettings, recentDays,
  getProfiles, getCurrentProfile, upsertProfile, switchProfile,
} from './store.mjs'
import { PET, todayKey } from '../shared/constants.mjs'
import {
  chat, extractBirthInfo,
  buildZodiacBlock, buildShengxiaoBlock, buildTarotBlock, buildFortuneBlock, buildEnergyBlock,
} from './chat-api.mjs'
import { baziPaiPan, westernZodiac } from '../shared/ganzhi.mjs'
import {
  generateDailyEnergy, drawFortuneStick, drawTarotCards, getLuckyNumber,
  zodiacMatch, detectStarSign, detectShengxiao, MOOD_QUIZZES,
} from '../shared/fortune.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

// 启动诊断日志：写到用户家目录，便于在沙箱外（真机 GUI 会话）也能读到的地方追踪启动到哪一步。
import { appendFileSync } from 'node:fs'
const HOME = process.env.HOME || '/tmp'
function logStart(...args) {
  try { appendFileSync(join(HOME, 'koala_startup.log'), `[${new Date().toISOString()}] ${args.join(' ')}\n`) } catch {}
}

// 读取版本号，写入诊断日志以便确认到底跑的是哪个 build
let BUILD_VERSION = 'dev'
try { BUILD_VERSION = require(join(ROOT, 'package.json')).version } catch {}

// ── 自替换旧实例：确保永远只跑最新编译版（避免「修了却还在跑旧进程」反复发生）──
;(function replaceStaleInstance() {
  try {
    const me = process.pid
    const exe = process.execPath
    let pids = []
    try {
      const { execSync } = require('node:child_process')
      const out = execSync(`pgrep -f "${exe}"`, { encoding: 'utf8' }).trim()
      pids = out ? out.split('\n').map((s) => parseInt(s, 10)).filter((n) => n && n !== me) : []
    } catch { /* pgrep 无匹配返回非 0，忽略 */ }
    for (const p of pids) {
      try { process.kill(p, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') {} }
    }
    if (pids.length) logStart(`[boot] 已终止旧实例 ${pids.join(',')}，确保运行最新版`)
    logStart(`===== 功德考拉启动 v${BUILD_VERSION} (pid=${me}) =====`)
  } catch (e) {
    logStart('[boot] 自替换检查出错:', e.message)
  }
})()

// ── 形状级鼠标穿透（原生模块）─────────────────────────
// 用原生模块重写 pet 窗口内容视图的 hitTest:，仅考拉实体像素接收点击，
// 透明区域直接穿透到下层（浏览器/桌面）。不需要任何系统权限（无需「输入监控」），
// 比 CGEventTap 拦截稳得多。模块缺失/安装失败时退回旧 forward 方案。
let hitOK = false
let petMask = null // { left, top, w, h, data: Uint8Array } 窗口内坐标下的考拉实体 alpha 掩膜
let hitModule = null
try {
  // 开发期：.node 在 src/native/ 下，ROOT 即项目根。
  // 打包后：asarUnpack 把 .node 解到 app.asar.unpacked 同级目录（asar 内只留引用），
  // 所以要先试 asar 内路径，失败再试 unpacked 路径，否则会 require 失败、回退到 forward 模式。
  let hitPath = join(ROOT, 'src', 'native', 'koala_hit.node')
  if (!existsSync(hitPath)) {
    hitPath = join(ROOT, '..', 'app.asar.unpacked', 'src', 'native', 'koala_hit.node')
  }
  hitModule = require(hitPath)
  logStart('[hit] 原生模块加载成功:', hitPath)
} catch (e) {
  console.warn('[hit] 原生模块加载失败，退回 forward 模式:', e.message)
  logStart('[hit] 原生模块加载失败:', e.message)
}

// 必须在 app.whenReady 之前设置：userData 路径由它决定。
// 不设的话所有开发中的 Electron 应用会共用 ~/Library/Application Support/Electron，
// 数据互相覆盖（实测种子数据就是这样被另一个进程写没的）。
app.setName('GongdeKoala')
app.setPath('userData', join(app.getPath('appData'), 'GongdeKoala'))

let petWin = null
let panelWin = null
let chatWin = null
let tray = null
/** 拖拽状态：按下时记录光标与窗口左上角的偏移，松开时按位移判断是点击还是拖动 */
let drag = null

/** 面板尺寸。内容是固定的六维 + 一段文案，不需要可变高度。 */
const PANEL = { width: 320, height: 460 }

/**
 * 今日功德面板。设计成「点考拉旁边就出现、失焦就消失」的浮层，
 * 而不是常驻窗口——桌宠的数据面板不该占任务栏也不该被误当成主窗口。
 */
function createPanelWindow() {
  if (panelWin) return panelWin
  panelWin = new BrowserWindow({
    width: PANEL.width,
    height: PANEL.height,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  panelWin.setAlwaysOnTop(true, 'screen-saver')
  panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  panelWin.loadFile(join(ROOT, 'src', 'renderer', 'panel', 'index.html'))
  // 点到别处就收起，符合「浮层」的直觉
  panelWin.on('blur', () => panelWin?.hide())
  panelWin.on('closed', () => { panelWin = null })
  return panelWin
}

/** 把面板摆在考拉旁边，并确保不超出屏幕可视区 */
function positionPanelNearPet() {
  const [px, py] = petWin.getPosition()
  const area = screen.getDisplayNearestPoint({ x: px, y: py }).workArea
  // 优先放考拉左侧（桌宠通常停在屏幕右下角），放不下再翻到右侧
  let x = px - PANEL.width - 12
  if (x < area.x + 8) x = px + PET.width + 12
  x = Math.min(x, area.x + area.width - PANEL.width - 8)
  let y = py + PET.height - PANEL.height
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - PANEL.height - 8))
  panelWin.setPosition(Math.round(x), Math.round(y), false)
}

function togglePanel() {
  const win = createPanelWindow()
  if (win.isVisible()) { win.hide(); return }
  positionPanelNearPet()
  win.webContents.send('panel:refresh')
  win.show()
  win.focus() // 需要焦点才能触发 blur 自动收起
}

/** 聊天面板。尺寸比统计面板大（需要对话气泡空间）。
 *  现在它更像一个普通窗口：可最小化、可最大化、会出现在 Dock/任务栏，
 *  方便用户用 Cmd+Tab / Alt+Tab 切换，也能在 Dock 里找到它。
 *  但视觉上仍保持无边框卡片风格。
 */
function createChatWindow() {
  if (chatWin) return chatWin
  chatWin = new BrowserWindow({
    width: 440, height: 640,
    minWidth: 360, minHeight: 480,
    show: false,
    transparent: true,
    frame: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // 不置顶：切到其他 app 时聊天窗口自然退到后面，但不会自动消失
  // （blur→hide 监听已删除，窗口只在用户主动关闭时才隐藏）。
  // 之前用 floating/pop-up-menu 级会导致窗口永远浮在最前，遮挡其他 app。
  chatWin.setAlwaysOnTop(false)
  chatWin.loadFile(join(ROOT, 'src', 'renderer', 'chat', 'index.html'))
  // 聊天窗口不再失焦自动隐藏——用户聊到一半点别处就丢对话太痛苦。
  // 关闭方式：点窗口内的 × 按钮、再次点考拉聊天菜单、或快捷键。
  chatWin.on('closed', () => {
    chatWin = null
    if (!panelWin?.isVisible()) app.dock?.hide()
  })
  // 通知渲染进程最大化状态变化，方便标题栏按钮图标切换
  chatWin.on('maximize', () => chatWin?.webContents.send('chat:maximized', true))
  chatWin.on('unmaximize', () => chatWin?.webContents.send('chat:maximized', false))
  return chatWin
}

function positionChatNearPet() {
  const area = screen.getPrimaryDisplay().workArea
  // 屏幕上半区上方 4%，水平居中；尺寸加大后位置要同步更新避免偏左偏右。
  const x = area.x + Math.round((area.width - 440) / 2)
  const y = area.y + Math.round(area.height * 0.04)
  chatWin.setPosition(Math.round(x), Math.round(y), false)
}

function toggleChat() {
  const win = createChatWindow()
  if (win.isVisible()) {
    win.hide()
    // macOS LSUIElement 应用默认不在 Dock，聊天窗口隐藏后也没必要占 Dock 位
    if (!panelWin?.isVisible()) app.dock?.hide()
    return
  }
  positionChatNearPet()
  win.webContents.send('chat:focus')
  win.show()
  win.focus()
  // 聊天窗口打开时让它像普通应用一样出现在 Dock / Cmd+Tab，方便用户切换和找到
  app.dock?.show()
}

function changeScale(s) {
  setSettings({ koalaScale: s })
  // 直接写 CSS 变量，不走 IPC（子菜单的 click 在 Electron 43 上有问题）
  petWin?.webContents.executeJavaScript(`document.documentElement.style.setProperty('--koala-scale','${s}')`).catch(() => {})
  // 也发 IPC 给掩膜重建（掩膜需要 canvas 操作，executeJavaScript 做不了那么多行）
  petWin?.webContents.send('settings:changed', { koalaScale: s })
}

// 玄学类关键词：命中即要求基于命盘解读（今日修行报告结构）
// 注意：只用运势专属词汇，不要放"今日""适合""数字""颜色""心情"等日常词——
// 否则"今日天气怎么样""适合穿什么""心情不好"都会被误判为运势请求，路由到八字模式。
const BAZI_KW = /八字|命盘|五行|命理|日柱|日主|十神|大运|流年|排盘/
const FORTUNE_KW = /运势|运气|事业运|财运|感情运|爱情运|姻缘|桃花|流年|流月|水逆|星象|占卜|能量签|今日签|抽签|塔罗|幸运色|幸运数|星座匹配|生肖运|命理/

/** 对话历史：主进程维护，支持连续对话。chat:reset 清空。 */
let chatHistory = []

/** 滑动窗口：保留最近 MAX_HISTORY 条消息，防止超模型 context window。
 *  每次追加后调用，超过上限时丢弃最早的消息。 */
const MAX_HISTORY = 20
function trimHistory() {
  if (chatHistory.length > MAX_HISTORY) {
    chatHistory = chatHistory.slice(-MAX_HISTORY)
  }
}

/** 从用户消息里抓个名字：我叫XX / 我是XX / 叫 XX。
 *  只匹配明确自报家门，不要"X的八字"这种泛指——「八月的事业运」里的"八月"是月份不是名字，
 *  误识别会创建空画像并切走当前激活，导致后续八字/运势请求找不到命盘。 */
function detectName(text) {
  const m = text.match(/(?:我叫|我是|我是谁|叫)\s*([\S]{1,6})(?=[\s，。,.\n]|$)/)
  if (m) return m[1]
  return null
}

/** 判断用户问题里的时间维度，避免把"八月""今年"也回答成"今日" */
function detectTimeScope(text) {
  if (/今年|明年|后年|流年|全年|整年/.test(text)) return '今年'
  if (/本月|这个月|这月|八月|下个月|上个月|整月/.test(text)) return '本月'
  if (/今天|今日|明天|后天|今明/.test(text)) return '今日'
  return '这段时间'
}

/** 把当前激活画像算成 [用户命盘] 区块（八字 + 星座），没有则返回空串 */
function buildProfileBlock(profile) {
  if (!profile || !profile.year) return ''
  const bazi = baziPaiPan({
    year: profile.year,
    month: profile.month ?? 1,
    day: profile.day ?? 1,
    hour: profile.hour ?? 12,
    gender: profile.gender ?? 'male',
  })
  const sign = westernZodiac(profile.month ?? 1, profile.day ?? 1)
  let block = `[用户命盘 · ${profile.name || '主人'}]
八字：${bazi.formula}
日主：${bazi.dayWuxing}${bazi.dayYinYang}
生肖：${bazi.zodiac}　星座：${sign}
五行分布：${JSON.stringify(bazi.wuxingCount)}
性别：${profile.gender === 'female' ? '女' : '男'}`
  if (profile.birthplace) block += `\n出生地：${profile.birthplace}`
  return block
}

/** 近期状态区块：让考拉"记得用户的生活" */
function buildHistoryBlock(n = 7) {
  const days = recentDays(n)
  if (!days.length) return ''
  const sum = days.reduce((a, d) => { a.knocks += d.knocks; a.merit += d.merit; return a }, { knocks: 0, merit: 0 })
  return `[用户近期状态（最近 ${days.length} 天）]
敲木鱼 ${sum.knocks} 次，积功德 ${sum.merit} 次。最近活跃：${days[0].date}`
}

/**
 * 聊天消息处理：多模式路由 + 连续对话。
 *
 * 路由优先级：
 * 1. 切换用户 → 本地处理
 * 2. 给了出生信息 → 存画像，进入八字命理分析（模式 A）
 * 3. 文本含星座名 → 轻量星座聊天（模式 B），不需要命盘
 * 4. 有命盘 + 玄学关键词 → 八字命理分析（模式 A）
 * 5. 无命盘 + 八字关键词 → 引导提供出生信息
 * 6. 默认 → 普通闲聊
 */
ipcMain.handle('chat:send', async (_e, text) => {
  const key = getSettings().deepseekKey
  if (!key) return { role: 'koala', text: '🔑 还没设置 API Key。\n\n在设置里填入 DeepSeek API Key 就能和我聊天了～' }

  // ── 1. 切换用户 ──
  const sw = text.match(/切换(?:\s*(?:用户|至)|\s*到)\s*([\S]{1,8})/)
  if (sw) {
    const p = switchProfile(sw[1])
    if (p) {
      chatHistory = []
      return { role: 'koala', text: `🐨 已切到「${p.name}」的命盘，接下来都用 TA 的八字和星座来分析啦～` }
    }
    return { role: 'koala', text: '🐨 没找到这个用户哦～试试「切换用户 小明」，或者先告诉我 TA 的出生日期。' }
  }

  // ── 2. 抽取出生信息，命中则更新/新建画像 ──
  const info = extractBirthInfo(text)
  // 必须有完整的年月日才算"给了出生信息"，避免"2024年8月运势"被误判
  const gaveBirth = info.year && info.month && info.day
  let profile = getCurrentProfile()
  if (gaveBirth) {
    const name = detectName(text)
    profile = upsertProfile({ ...info, name: name || (profile?.name ?? undefined) })
  } else {
    const name = detectName(text)
    if (name && profile) profile = upsertProfile({ name })
  }

  // ── 3. 星座检测（模式 B 入口）──
  const starSign = detectStarSign(text)
  const shengxiao = detectShengxiao(text)

  // ── 4. 构建上下文区块 ──
  const profileBlock = buildProfileBlock(profile)
  const historyBlock = buildHistoryBlock()
  const isBazi = BAZI_KW.test(text)
  const isFortune = FORTUNE_KW.test(text)

  // ── 模式 A：八字命理分析（有命盘 + 玄学请求/刚给出生信息）──
  if (profileBlock && (isBazi || isFortune || gaveBirth)) {
    const timeScope = detectTimeScope(text)
    const instruction = gaveBirth
      ? '用户刚提供了出生信息。请先温和确认已记下 TA 的命盘，再给一句简短的八字初读（性格倾向），不要长篇大论。'
      : `请基于以上命盘与近期状态，给出「${timeScope}修行报告」式的解读（使用规定的结构），不要脱离命盘自由发挥。注意：用户问的是「${timeScope}」，所以标题和描述都要用「${timeScope}」，不要写成「今日」或其他时间。`

    // 构建带上下文的用户消息
    const contextParts = [profileBlock, historyBlock].filter(Boolean)
    const userMsg = contextParts.length
      ? `${contextParts.join('\n')}\n\n用户说：「${text}」\n${instruction}`
      : text

    chatHistory.push({ role: 'user', content: userMsg })
    trimHistory()
    const reply = await chat(chatHistory, key)
    chatHistory.push({ role: 'assistant', content: reply })
    return { role: 'koala', text: reply }
  }

  // ── 模式 B：轻量星座聊天（文本含星座名，不需要命盘）──
  if (starSign && !isBazi) {
    const zodiacBlock = buildZodiacBlock(starSign)
    let contextParts = [zodiacBlock]
    if (shengxiao) contextParts.push(buildShengxiaoBlock(shengxiao))
    if (profileBlock) contextParts.push(profileBlock) // 有命盘也带上，双维度分析
    if (historyBlock) contextParts.push(historyBlock)

    const timeScope = detectTimeScope(text)
    const timeHint = timeScope === '这段时间'
      ? ''
      : `用户问的是「${timeScope}」，请围绕这个时间段组织回答，不要用「今日」等其他时间。`
    const userMsg = `${contextParts.join('\n')}\n\n用户说：「${text}」\n请基于以上星座档案给出有趣有陪伴感的解读，支持连续对话。${timeHint}`
    chatHistory.push({ role: 'user', content: userMsg })
    trimHistory()
    const reply = await chat(chatHistory, key)
    chatHistory.push({ role: 'assistant', content: reply })
    return { role: 'koala', text: reply }
  }

  // ── 模式 B-2：生肖聊天（文本含生肖，但没给出生信息）──
  if (shengxiao && !isBazi && !gaveBirth) {
    const sxBlock = buildShengxiaoBlock(shengxiao)
    const userMsg = `${sxBlock}\n\n用户说：「${text}」\n请基于以上生肖档案给出有趣有陪伴感的解读。`
    chatHistory.push({ role: 'user', content: userMsg })
    trimHistory()
    const reply = await chat(chatHistory, key)
    chatHistory.push({ role: 'assistant', content: reply })
    return { role: 'koala', text: reply }
  }

  // ── 引导：八字类请求但没有命盘也没星座 ──
  if (isBazi && !profileBlock && !starSign) {
    return {
      role: 'koala',
      text: '🐨 想给你做八字分析，但我还不知道你的出生信息呢～\n\n告诉我你的「出生年月日时分 + 性别」就行，比如：\n「1995年8月15日下午3点 男」\n\n💡 如果不想给出生信息，也可以直接问我某个星座的问题哦，比如「天蝎座今天运势怎么样」～',
    }
  }

  // ── 运势类请求但没有命盘也没星座 → 引导 ──
  if (isFortune && !profileBlock && !starSign && !gaveBirth) {
    return {
      role: 'koala',
      text: '🐨 想给你看运势，但我需要一点线索～\n\n你有两种方式：\n\n🔮 深度版：告诉我「出生年月日时分 + 性别」，我做完整的八字分析\n⭐ 轻量版：直接问我某个星座，比如「天蝎座今天运势怎么样」\n\n你选哪种？🐨',
    }
  }

  // ── 普通闲聊：带上用户命盘和近期状态做陪伴 ──
  // 即使关键词没命中玄学模式，也注入 profileBlock，让 AI 在需要时能结合命盘回答。
  // 系统提示词已规定"不涉及玄学时做朋友式陪伴"，不会因为带了命盘就强行算命。
  const lightParts = [
    profile?.name ? `当前用户：${profile.name}` : '',
    profileBlock,
    historyBlock,
  ].filter(Boolean)
  const userMsg = lightParts.length ? `${lightParts.join('\n')}\n\n用户说：「${text}」` : text
  chatHistory.push({ role: 'user', content: userMsg })
  trimHistory()
  const reply = await chat(chatHistory, key)
  chatHistory.push({ role: 'assistant', content: reply })
  return { role: 'koala', text: reply }
})

// ── 娱乐功能 IPC ──────────────────────────────────────

/** 每日能量签：本地生成，不花 API 额度 */
ipcMain.handle('chat:daily-energy', () => {
  const profile = getCurrentProfile()
  return generateDailyEnergy(profile?.id ?? '')
})

/** 抽签：本地抽 + AI 解读 */
ipcMain.handle('chat:draw-lot', async () => {
  const key = getSettings().deepseekKey
  const profile = getCurrentProfile()
  const stick = drawFortuneStick(profile?.id ?? '')
  if (!key) return { role: 'koala', text: '🔑 还没设置 API Key，没法帮你解读签文～\n\n不过签已经抽好了：\n' + stick.level + '\n' + stick.poem + '\n\n去设置里填入 DeepSeek API Key 就能听我解读啦！' }

  const fortuneBlock = buildFortuneBlock(stick)
  // 注入用户命盘和近期状态，让 AI 解读能结合用户情况
  const profileBlock = buildProfileBlock(profile)
  const historyBlock = buildHistoryBlock()
  const contextParts = [fortuneBlock, profileBlock, historyBlock].filter(Boolean)
  const userMsg = `${contextParts.join('\n')}\n\n用户抽了一根签。请用考拉的口吻帮 TA 解读这根签，把诗句翻译成现代生活语言，结合签的等级调整语气。${profileBlock ? '结合用户命盘给更有针对性的解读。' : ''}下签也要给出温暖的角度，不制造恐惧。`
  chatHistory.push({ role: 'user', content: userMsg })
  trimHistory()
  const reply = await chat(chatHistory, key)
  chatHistory.push({ role: 'assistant', content: reply })
  return { role: 'koala', text: reply, stick }
})

/** AI 塔罗三选一：抽 3 张牌，返回牌背信息让用户选 */
ipcMain.handle('chat:tarot-draw', () => {
  return drawTarotCards(3)
})

/** 用户选了一张牌 → AI 解读 */
ipcMain.handle('chat:tarot-pick', async (_e, card) => {
  const key = getSettings().deepseekKey
  if (!key) return { role: 'koala', text: '🔑 还没设置 API Key，没法帮你解读这张牌～\n\n牌是：' + card.name + '（' + card.keyword + '）\n\n去设置里填入 DeepSeek API Key 就能听我解读啦！' }

  const tarotBlock = buildTarotBlock(card)
  // 注入用户命盘和近期状态，让 AI 解读能结合用户情况
  const profile = getCurrentProfile()
  const profileBlock = buildProfileBlock(profile)
  const historyBlock = buildHistoryBlock()
  const contextParts = [tarotBlock, profileBlock, historyBlock].filter(Boolean)
  const userMsg = `${contextParts.join('\n')}\n\n用户抽到了这张塔罗牌。请用故事化的方式为 TA 解读这张牌在当下的含义。${profileBlock ? '结合用户命盘给更有针对性的解读。' : ''}即使牌面看似负面（如死神、高塔），也要强调蜕变和新生的正面意义。让解读有仪式感和神秘感，但落脚点温暖。`
  chatHistory.push({ role: 'user', content: userMsg })
  trimHistory()
  const reply = await chat(chatHistory, key)
  chatHistory.push({ role: 'assistant', content: reply })
  return { role: 'koala', text: reply }
})

/** 幸运数字：本地生成 */
ipcMain.handle('chat:lucky-number', () => {
  const profile = getCurrentProfile()
  return getLuckyNumber(profile?.id ?? '')
})

/** 星座匹配：本地计算 */
ipcMain.handle('chat:zodiac-match', (_e, sign1, sign2) => {
  return zodiacMatch(sign1, sign2)
})

/** 心情测试：返回一道随机题 */
ipcMain.handle('chat:mood-quiz', () => {
  const seed = Math.abs(Date.now()) % MOOD_QUIZZES.length
  return MOOD_QUIZZES[seed]
})

/** 重置对话历史（用户点首页按钮时调用） */
ipcMain.handle('chat:reset', () => {
  chatHistory = []
  return true
})

function createPetWindow() {
  logStart('[boot] createPetWindow 开始')
  const saved = getPetPos()
  const area = screen.getPrimaryDisplay().workArea
  // 首次启动放在右下角，离边缘留点距离
  const pos = saved ?? {
    x: area.x + area.width - PET.width - 40,
    y: area.y + area.height - PET.height - 40,
  }

  petWin = new BrowserWindow({
    ...pos,
    width: PET.width,
    height: PET.height,
    // type:panel 让窗口成为 NSPanel；再配合 focusable:false 加上
    // NSNonactivatingPanelMask，点击考拉就不会激活 app、不会抢走浏览器焦点。
    // 这是 macOS 桌宠「可点击但不抢焦点」的标准做法。
    type: 'panel',
    transparent: true,
    frame: false,
    resizable: false,
    movable: false, // 位置完全由我们自己控制，避免系统拖拽和自定义拖拽打架
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    // 关键：桌宠不该抢焦点。用户在浏览器/编辑器里时，点一下考拉（敲木鱼）不应该
    // 把当前 app 顶到前台、让浏览器失焦。focusable:false 把窗口变成「非激活面板」，
    // 点击只把事件交给考拉、不会激活 app。不要加 acceptFirstMouse:true——那在 macOS 上
    // 反而会让点击重新激活 app，导致一边敲一边看不了浏览器。
    focusable: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 浮在全屏应用之上，并在所有桌面空间可见
  petWin.setAlwaysOnTop(true, 'screen-saver')
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 默认穿透。原生监听可用时窗口纯穿透（不接收事件、绝不激活 app）；
  // 不可用时退回 forward，由渲染进程接管点击（旧方案，快敲仍可能抢焦点）。
  applyPetMouseMode()

  petWin.loadFile(join(ROOT, 'src', 'renderer', 'pet', 'index.html'))
  petWin.on('closed', () => { petWin = null })
  logStart('[boot] pet 窗口已创建并 loadFile')
  return petWin
}

/** 根据原生 hitTest 是否可用，切换 pet 窗口的鼠标模式。
 *  关键：窗口始终接收事件（考拉永远可点）。原生 hitTest 安装成功时，只有窗口最外圈
 *  空白会由 hitTest 返回 nil 穿透到下层；安装失败/掩膜异常时则整窗可点（考拉照常可用，
 *  仅失去形状穿透）。两种情况下考拉都一定能敲击，杜绝「死悬浮、点哪都没反应」。 */
function applyPetMouseMode() {
  if (!petWin) return
  petWin.setIgnoreMouseEvents(false)
}

/** 把考拉命中掩膜（窗口内坐标 + alpha 数据）推给原生模块 */
function pushHitMask(mask) {
  if (!hitOK || !hitModule) return
  const data = mask.data instanceof Uint8Array ? mask.data : Uint8Array.from(mask.data)
  hitModule.setMask(mask.left | 0, mask.top | 0, mask.w | 0, mask.h | 0, data)
}

/** 渲染进程算好命中掩膜后传过来（窗口内坐标 + alpha 数据） */
ipcMain.on('pet:set-mask', (_e, mask) => {
  petMask = { left: mask.left, top: mask.top, w: mask.w, h: mask.h, data: mask.data }
  let ones = 0
  const d = mask.data
  const total = (mask.w * mask.h) || 0
  if (d && d.length) for (let i = 0; i < d.length; i++) if (d[i]) ones++
  logStart(`[mask] 收到掩膜 ${mask.w}x${mask.h} 实体像素=${ones}/${total} (left=${mask.left}, top=${mask.top})`)
  // 掩膜异常（全 0 或尺寸不符）时强制整窗可点，避免考拉变成死悬浮
  if (!ones) {
    logStart('[mask] 警告：掩膜全空，强制整窗可点（形状穿透降级）')
    return
  }
  pushHitMask(mask)
})

/** 开始一次按下：记录偏移，开定时器跟踪位移，长按则开面板 */
function beginDrag(sx, sy) {
  if (!petWin) return
  const [wx, wy] = petWin.getPosition()
  drag = {
    dx: sx - wx,
    dy: sy - wy,
    startX: sx,
    startY: sy,
    moved: 0,
    held: false,
    timer: setInterval(() => {
      if (!petWin || !drag) return
      const c = screen.getCursorScreenPoint()
      drag.moved = Math.max(drag.moved, Math.hypot(c.x - drag.startX, c.y - drag.startY))
      // 拖拽超过阈值才真的移动窗口，连敲（几乎不动）不会误移动
      if (drag.moved > 10) {
        const nx = c.x - drag.dx
        const ny = c.y - drag.dy
        petWin.setPosition(nx, ny, false)
        // 掩膜是窗口内坐标，窗口移动无需重传/重算
      }
    }, 16),
  }
  // 长按（按住约 450ms 且几乎没拖动）才打开「今日功德」面板。
  // 木鱼本来就是用来连敲的，双击和连敲无法区分，所以用长按替代双击。
  drag.holdTimer = setTimeout(() => {
    if (!petWin || !drag || drag.held) return
    if (drag.moved < 8) {
      drag.held = true
      togglePanel()
    }
  }, 450)
}

/** 松开：位移小算点击（敲木鱼），否则算拖动结束 */
function endDrag() {
  if (!petWin || !drag) return
  clearInterval(drag.timer)
  clearTimeout(drag.holdTimer)
  const wasClick = drag.moved < 5
  const [x, y] = petWin.getPosition()
  const held = drag.held
  drag = null
  if (!wasClick) {
    setPetPos(x, y)
    return
  }
  if (held) return
  petWin.webContents.send('pet:click')
}

/** 原生 hitTest 接管后，考拉像素上的点击由渲染进程 DOM 转发到这里 */
ipcMain.on('pet:pointerdown', () => {
  const c = screen.getCursorScreenPoint()
  beginDrag(c.x, c.y)
})
ipcMain.on('pet:pointerup', () => {
  endDrag()
})
ipcMain.on('pet:contextmenu', () => {
  buildMenu().popup({ window: petWin })
})

ipcMain.handle('stats:knock', (_e, rewardKey) => {
  const day = recordKnock(rewardKey)
  // 面板开着时实时更新数字，否则用户会以为面板卡住了
  if (panelWin?.isVisible()) panelWin.webContents.send('panel:refresh')
  return day
})
ipcMain.handle('stats:today', () => ({ day: getDay(), total: getTotal(), date: todayKey() }))
ipcMain.handle('stats:recent', (_e, n) => recentDays(n))
ipcMain.on('panel:toggle', () => togglePanel())
ipcMain.on('panel:close', () => panelWin?.hide())
ipcMain.on('chat:toggle', () => toggleChat())
ipcMain.on('chat:close', () => {
  chatWin?.hide()
  chatHistory = []
  if (!panelWin?.isVisible()) app.dock?.hide()
})
ipcMain.on('chat:minimize', () => chatWin?.minimize())
ipcMain.on('chat:maximize', () => {
  if (!chatWin) return
  chatWin.isMaximized() ? chatWin.unmaximize() : chatWin.maximize()
})
ipcMain.handle('chat:is-maximized', () => chatWin?.isMaximized() ?? false)
ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('settings:set', (_e, patch) => {
  const s = setSettings(patch)
  if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin })
  return s
})

// ── 检测更新 ──────────────────────────────────────────
// 仓库固定为 Koala-Dai/gongde-koala；用 GitHub Releases API 取 latest，
// 比对 app 版本，按平台/架构挑出对应安装包。不依赖证书/自动安装——
// 当前安装包未签名、Windows 为便携版，故做成「检测 + 一键下载」而非静默自动升级。
const REPO = 'Koala-Dai/gongde-koala'

/** GitHub Releases API 要求带 User-Agent，否则 403 */
async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'gongde-koala', Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) return null
  return res.json()
}

function parseVersion(tag) {
  return String(tag).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
}

/** a 是否比 b 新（语义化版本逐段比较） */
function isNewer(a, b) {
  const av = parseVersion(a)
  const bv = parseVersion(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const x = av[i] ?? 0
    const y = bv[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

/** 按当前平台/架构从 release 资源里挑出该下载的那个 */
function pickAsset(assets, platform, arch) {
  if (!Array.isArray(assets)) return null
  if (platform === 'darwin') {
    const arm = assets.find((a) => /arm64/i.test(a.name) && /\.dmg$/i.test(a.name))
    const intel = assets.find((a) => !/arm64/i.test(a.name) && /\.dmg$/i.test(a.name))
    if (arch === 'arm64' && arm) return arm
    if (intel) return intel
    return arm || intel || null
  }
  if (platform === 'win32') {
    return assets.find((a) => /\.exe$/i.test(a.name)) || null
  }
  return null
}

/**
 * 检测更新。返回：
 * { updateAvailable, currentVersion, latestVersion, downloadUrl, releaseUrl, releaseNotes, error? }
 */
async function checkForUpdate() {
  try {
    const release = await fetchLatestRelease()
    if (!release || !release.tag_name) return { updateAvailable: false }
    const current = app.getVersion()
    const latest = release.tag_name
    const updateAvailable = isNewer(latest, current)
    let downloadUrl = release.html_url
    if (updateAvailable) {
      const asset = pickAsset(release.assets, process.platform, process.arch)
      if (asset) downloadUrl = asset.browser_download_url
    }
    return {
      updateAvailable,
      currentVersion: current,
      latestVersion: latest.replace(/^v/i, ''),
      downloadUrl,
      releaseUrl: release.html_url,
      releaseNotes: release.body || '',
    }
  } catch (err) {
    return { updateAvailable: false, error: err.message }
  }
}

/** 把更新提示弹到聊天窗口（确保窗口已创建并可见） */
function showUpdateToast(info) {
  const win = createChatWindow()
  positionChatNearPet()
  win.webContents.send('chat:focus')
  win.show()
  win.focus()
  app.dock?.show()
  win.webContents.send('app:update-available', info)
}

/** 启动后延迟自动检查；用户已忽略的版本不再打扰 */
function autoCheckUpdate() {
  checkForUpdate()
    .then((info) => {
      if (!info.updateAvailable) return
      const dismissed = getSettings().dismissedUpdate
      if (dismissed && dismissed === info.latestVersion) return
      showUpdateToast(info)
    })
    .catch(() => {})
}

// 手动/自动检查都走这里
ipcMain.handle('app:check-update', () => checkForUpdate())
ipcMain.on('app:open-external', (_e, url) => {
  if (typeof url === 'string') shell.openExternal(url)
})
ipcMain.on('app:dismiss-update', (_e, version) => {
  if (typeof version === 'string') setSettings({ dismissedUpdate: version })
})

/** 托盘和右键考拉共用同一份菜单，避免两处维护 */
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '💬 找考拉聊天', click: () => toggleChat() },
    { label: '📊 今日功德', click: () => togglePanel() },
    { type: 'separator' },
    { label: '显示 / 隐藏考拉', click: () => (petWin?.isVisible() ? petWin.hide() : petWin?.show()) },
    { type: 'separator' },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: getSettings().launchAtLogin,
      click: (item) => {
        setSettings({ launchAtLogin: item.checked })
        app.setLoginItemSettings({ openAtLogin: item.checked })
      },
    },
    {
      label: '静音',
      type: 'checkbox',
      checked: getSettings().muted,
      click: (item) => {
        setSettings({ muted: item.checked })
        petWin?.webContents.send('settings:changed', { muted: item.checked })
      },
    },
    { type: 'separator' },
    { label: '🐨 小考拉', click: () => changeScale(0.65) },
    { label: '🐨 中考拉（默认）', click: () => changeScale(1.0) },
    { label: '🐨 大考拉', click: () => changeScale(1.4) },
    { type: 'separator' },
    { label: '打开数据文件夹', click: () => shell.openPath(app.getPath('userData')) },
    { label: '退出功德考拉', role: 'quit' },
  ])
}

// 右键考拉弹出菜单在上方 pointer 段落已注册（ipcMain.on('pet:contextmenu')），此处不再重复。

/** 安装原生 hitTest 重写（形状级穿透）。失败则退回 forward 模式。 */
function installHit() {
  if (process.platform !== 'darwin' || !hitModule || !petWin) return
  try {
    const handle = petWin.getNativeWindowHandle()
    hitModule.install(handle)
    hitOK = true
    applyPetMouseMode()
    console.log('[hit] 形状级穿透已启用（无需系统权限，快敲也不抢焦点）')
    logStart('[hit] install OK — 形状级穿透已启用')
  } catch (e) {
    hitOK = false
    console.warn('[hit] 安装失败，退回 forward 模式:', e.message)
    logStart('[hit] install 失败，退回 forward:', e.message)
    applyPetMouseMode()
  }
}

function buildTray() {
  const iconPath = join(ROOT, 'assets', 'koala', 'trayTemplate.png')
  tray = new Tray(iconPath)
  tray.setToolTip('功德考拉')
  // 点击图标直接弹菜单（macOS 上左键默认不弹，需要显式调用）
  tray.on('click', () => tray.popUpContextMenu())
  tray.setContextMenu(buildMenu())
  // 诊断：托盘图标实际被系统放在哪。菜单栏拥挤或刘海挤占时，macOS 会静默丢弃图标，
  // 此时 bounds 会是 0 宽/0 高或落在屏幕外，而不会有任何报错。
  const b = tray.getBounds()
  const ok = b.width > 0 && b.height > 0 && b.y < 40
  console.log('[tray] bounds =', JSON.stringify(b), ok ? '← 正常' : '← 图标未进入菜单栏（空间不足），请用右键考拉打开菜单')
}

app.whenReady().then(async () => {
  logStart('[boot] app.whenReady 已触发')
  try {
    initStore()
    // 首次启动不内置任何 Key：让用户在本机「设置」里填入自己的 DeepSeek Key。
    // 不要把密钥写进源码——会随仓库 / 分享包一起泄露。
    // 桌宠不需要 Dock 图标，常驻托盘即可
    app.dock?.hide()
    // 设置 Dock 图标：聊天窗口打开时显示自定义考拉图标，而不是默认 Electron 图标。
    // 注意：打包后 build/icon.png 不一定随 asar 一起存在，文件不存在时 setIcon 会同步抛异常，
    // 必须把「存在判断 + try/catch」兜住，否则会连累整个 whenReady 崩掉、考拉窗口创建不出来。
    try {
      const dockIcon = join(ROOT, 'build', 'icon.png')
      if (existsSync(dockIcon)) app.dock?.setIcon?.(dockIcon)
    } catch (e) {
      logStart('[boot] setIcon 跳过:', e.message)
    }
    createPetWindow()
    buildTray()
    // 窗口加载完后安装原生 hitTest 重写（形状级穿透，无需系统权限）
    petWin.webContents.once('did-finish-load', () => installHit())
    // 启动 5 秒后静默检查更新（用户已忽略的版本不再弹窗）
    setTimeout(autoCheckUpdate, 5000)
    // if (process.env.KOALA_SHOT) devCapture()  // 开发期自检，正常启动不执行
  } catch (e) {
    // 任何启动异常都写进诊断日志，避免「打开没反应」却无从排查
    logStart('[boot] 启动异常:', e && (e.stack || e.message))
    console.error('[boot] 启动异常:', e)
  }
})

/**
 * 开发期自检：把桌宠窗口自身渲染结果截图存盘（含 alpha）。
 * 用 capturePage 而不是系统截屏，是因为它不需要「屏幕录制」权限，
 * 而且拿到的就是窗口真实的合成结果，能直接看出透明和精灵图有没有问题。
 */
async function devCapture() {
  const { writeFileSync } = await import('node:fs')
  const out = join(ROOT, 'assets', 'raw')
  const shot = async (tag, win = petWin) => {
    const img = await win.webContents.capturePage()
    writeFileSync(join(out, `shot-${tag}.png`), img.toPNG())
    console.log('[shot]', tag)
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2000)
  // 面板先截：它显示的是累计数据，敲击测试会改变数字
  togglePanel()
  await wait(800)
  await shot('panel', panelWin)
  panelWin.hide()
  // 聊天面板
  toggleChat()
  await wait(800)
  await shot('chat', chatWin)
  chatWin.hide()
  await wait(200)
  await shot('idle')
  petWin.webContents.send('pet:click')
  await wait(170)
  await shot('hit')
  // 连点压力测试：木鱼本来就是拿来连敲的，这是真实使用场景
  for (let i = 0; i < 6; i++) {
    petWin.webContents.send('pet:click')
    await wait(90)
  }
  await wait(120)
  await shot('spam')
  console.log('[shot] 完成')
}

// 桌宠是常驻应用：关掉窗口不等于退出
app.on('window-all-closed', (e) => e.preventDefault())
app.on('before-quit', flushNow)
