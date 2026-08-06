// 桌宠渲染进程：精灵图切帧、alpha 命中测试、点击反馈（动画 + 音效 + 飘字）。
import { rollReward } from '../../shared/constants.mjs'

const ASSETS = '../../../assets'
const koalaEl = document.getElementById('koala')
const stageEl = document.getElementById('stage')
const rippleEl = document.getElementById('ripple')
const rewardsEl = document.getElementById('rewards')

let manifest = null
let frameIndex = {} // 帧名 -> 序号
let hitMask = null // Uint8Array，考拉实体像素的 alpha 掩膜（显示分辨率）
let maskW = 0
let maskH = 0
let stageRect = null

// ── 音效 ────────────────────────────────────────────
// 用 Web Audio 而不是 <audio>：解码一次复用，连点时可以重叠播放且零启动延迟。
let audioCtx = null
let knockBuffer = null
let settings = { muted: false, volume: 0.7 }

async function initAudio() {
  try {
    audioCtx = new AudioContext()
    const res = await fetch(`${ASSETS}/audio/mokugyo.mp3`)
    knockBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer())
  } catch (err) {
    console.warn('[audio] 初始化失败，将静音运行:', err.message)
  }
}

function playKnock() {
  if (!audioCtx || !knockBuffer || settings.muted) return
  // 浏览器可能因为没有用户手势而挂起音频上下文
  if (audioCtx.state === 'suspended') audioCtx.resume()
  const src = audioCtx.createBufferSource()
  src.buffer = knockBuffer
  // 每次微调音高，连点时才不会像机器在响
  src.playbackRate.value = 0.97 + Math.random() * 0.08
  const gain = audioCtx.createGain()
  gain.gain.value = settings.volume
  src.connect(gain).connect(audioCtx.destination)
  src.start()
}

// ── 精灵图 ──────────────────────────────────────────
async function loadSprite() {
  manifest = await (await fetch(`${ASSETS}/koala/manifest.json`)).json()
  manifest.frames.forEach((f) => (frameIndex[f.name] = f.index))

  const n = manifest.frames.length
  const w = manifest.frameWidth * manifest.scale
  const h = manifest.frameHeight * manifest.scale
  document.documentElement.style.setProperty('--koala-w', `${w}px`)
  document.documentElement.style.setProperty('--koala-h', `${h}px`)
  document.documentElement.style.setProperty('--sheet-w', `${w * n}px`)
  setFrame(manifest.idle)

  const s = settings.koalaScale ?? 1
  await buildHitMask(w * s, h * s)
  stageRect = stageEl.getBoundingClientRect()
  document.documentElement.style.setProperty('--koala-scale', s)
}

function setFrame(name) {
  const i = frameIndex[name] ?? 0
  const w = manifest.frameWidth * manifest.scale
  koalaEl.style.backgroundPosition = `${-i * w}px 0`
}

/**
 * 从静息帧生成 alpha 掩膜，用于判断鼠标是否真的落在考拉身上。
 * 只用静息帧：敲击时轮廓变化很小，而每帧都建掩膜没必要。
 */
async function buildHitMask(w, h) {
  const img = new Image()
  img.src = `${ASSETS}/koala/idle.png`
  await img.decode()
  const c = document.createElement('canvas')
  maskW = Math.ceil(w)
  maskH = Math.ceil(h)
  c.width = maskW
  c.height = maskH
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, maskW, maskH)
  const d = ctx.getImageData(0, 0, maskW, maskH).data
  hitMask = new Uint8Array(maskW * maskH)
  for (let i = 0; i < maskW * maskH; i++) hitMask[i] = d[i * 4 + 3] > 24 ? 1 : 0
}

/** 屏幕坐标（窗口内）是否命中考拉实体 */
function hitTest(clientX, clientY) {
  if (!hitMask || !stageRect) return false
  const x = Math.round(clientX - stageRect.left)
  const y = Math.round(clientY - stageRect.top)
  if (x < 0 || y < 0 || x >= maskW || y >= maskH) return false
  return hitMask[y * maskW + x] === 1
}

// ── 敲击 ────────────────────────────────────────────
// 连点是这个应用的常态（木鱼本来就是拿来连敲的），所以这里的设计目标是
// 「点多快都跟得上、且不会看起来乱」：声音每次都响，动画可被打断重启，飘字走错开的轨道。
let strikeGen = 0
let phase = 'idle' // idle | rising | hit

async function strike() {
  const reward = rollReward()
  playKnock() // 声音必须在第一时间响，延迟到击中帧会让点击感觉发黏
  spawnReward(reward)
  window.koala.knock(reward.key)

  // 抬槌途中再点，就让它把这一击敲完；已经敲下去了才允许重启，避免动画反复抽搐
  if (phase === 'rising') return
  const gen = ++strikeGen

  koalaEl.classList.add('striking')
  for (const [name, ms] of manifest.strike) {
    if (gen !== strikeGen) return // 被新的一击接管了
    phase = name === 'hit' || name === 'settle1' ? 'hit' : 'rising'
    setFrame(name)
    if (name === 'hit') {
      restartAnim(koalaEl, 'impact')
      restartAnim(rippleEl, 'go')
    }
    await sleep(ms)
  }
  if (gen !== strikeGen) return
  setFrame(manifest.idle)
  koalaEl.classList.remove('striking')
  phase = 'idle'
}

/** 重放同名 CSS 动画：必须先移除类并强制重排，否则连点时第二次不会触发 */
function restartAnim(el, cls) {
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
}

// 5 条错开的轨迹轮流使用。纯随机偏移在连点时仍会撞车，轮换才能保证相邻两次一定分开。
const LANES = [-46, 34, -20, 48, -34]
const LIFTS = [80, 96, 68]
const MERGE_MS = 700 // 同类型奖励在这个窗口内合并计数，而不是再飘一条
let spawnSeq = 0
/** 正在飘的奖励：key -> { el, countEl, count, born } */
const live = new Map()

function spawnReward(reward) {
  const now = performance.now()

  // 连点同一种奖励时，把已有那条的数字加上去，而不是叠一堆重复文字。
  // 这是游戏里伤害数字的常见处理，连敲木鱼时画面清爽很多。
  const cur = live.get(reward.key)
  if (cur && now - cur.born < MERGE_MS) {
    cur.count++
    cur.countEl.textContent = `+${cur.count}`
    restartAnim(cur.countEl, 'bump')
    return
  }

  while (rewardsEl.childElementCount >= 6) rewardsEl.firstElementChild.remove()

  const n = spawnSeq++
  const el = document.createElement('div')
  el.className = 'reward'
  el.style.setProperty('--c', reward.color)
  el.style.setProperty('--dx', `${LANES[n % LANES.length] + (Math.random() * 8 - 4)}px`)
  el.style.setProperty('--lift', `${LIFTS[n % LIFTS.length]}px`)
  // 已经有几条在飘，新的就从更高处起步，避免叠在同一行
  el.style.setProperty('--y0', `${-Math.min(rewardsEl.childElementCount, 3) * 30}px`)

  const label = document.createElement('span')
  label.textContent = `${reward.emoji} ${reward.label} `
  const countEl = document.createElement('span')
  countEl.className = 'count'
  countEl.textContent = '+1'
  el.append(label, countEl)
  rewardsEl.appendChild(el)

  const entry = { el, countEl, count: 1, born: now }
  live.set(reward.key, entry)

  const kill = () => {
    el.remove()
    if (live.get(reward.key) === entry) live.delete(reward.key)
  }
  el.addEventListener('animationend', (e) => {
    if (e.target === el) kill() // 只认外层的飘升动画，内层数字跳动不算结束
  })
  setTimeout(kill, 1600) // 兜底，防止动画事件丢失导致节点残留
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 鼠标穿透 ────────────────────────────────────────
// 窗口是矩形但考拉不是。默认整窗穿透，只有指针压在实体像素上时才让主进程接管，
// 这样考拉旁边的空白区域仍然能点到下面的编辑器/浏览器。
let interactive = false

window.addEventListener('mousemove', (e) => {
  const hit = hitTest(e.clientX, e.clientY)
  if (hit !== interactive) {
    interactive = hit
    window.koala.setInteractive(hit)
    document.body.style.cursor = hit ? 'pointer' : 'default'
  }
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return
  window.koala.pointerDown()
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return
  window.koala.pointerUp()
})

// 右键考拉弹出菜单。托盘图标在菜单栏拥挤时会被 macOS 静默丢弃，这是保底入口。
window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (hitTest(e.clientX, e.clientY)) window.koala.contextMenu()
})

// 主进程判定「按下到松开位移 < 5px」才算点击，拖动时不会误触发敲击
window.koala.onClick(() => strike())
window.koala.onSettingsChanged((s) => {
  Object.assign(settings, s)
  if ('koalaScale' in s) {
    document.documentElement.style.setProperty('--koala-scale', s.koalaScale)
    // 更新命中掩膜——缩放后实际点击区域变了
    const w = manifest.frameWidth * manifest.scale * s.koalaScale
    const h = manifest.frameHeight * manifest.scale * s.koalaScale
    setTimeout(buildHitMask, 200, w, h)
  }
})

window.addEventListener('resize', () => {
  stageRect = stageEl.getBoundingClientRect()
})

;(async () => {
  settings = { ...settings, ...(await window.koala.getSettings()) }
  if (settings.koalaScale) {
    document.documentElement.style.setProperty('--koala-scale', settings.koalaScale)
  }
  await loadSprite()
  await initAudio()
})()
