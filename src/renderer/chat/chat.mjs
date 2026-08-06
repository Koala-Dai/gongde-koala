// 功德考拉·玄学小助手 — 渲染端逻辑。
// 首页三入口 + 快捷玩法 + 聊天 + 娱乐互动。

const el = {
  home: document.getElementById('home'),
  chatView: document.getElementById('chat-view'),
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  close: document.getElementById('close'),
  minimize: document.getElementById('minimize'),
  maximize: document.getElementById('maximize'),
  back: document.getElementById('back-btn'),
  title: document.getElementById('title'),
  tarotOverlay: document.getElementById('tarot-overlay'),
  tarotCards: document.getElementById('tarot-cards'),
  matchOverlay: document.getElementById('match-overlay'),
  matchSelects: document.getElementById('match-selects'),
  matchGo: document.getElementById('match-go'),
}

let sending = false
let viewMode = 'home'
let activeOverlay = null // 'tarot' | 'match' | null

// ── 视图切换 ──────────────────────────────────────────
function showHome() {
  viewMode = 'home'
  activeOverlay = null
  el.home.style.display = ''
  el.chatView.style.display = 'none'
  el.tarotOverlay.style.display = 'none'
  el.matchOverlay.style.display = 'none'
  el.back.style.display = 'none'
  el.title.textContent = '🔮 玄学小助手'
  el.messages.innerHTML = ''
}

function showChat(titleText = '🐨 考拉聊天') {
  viewMode = 'chat'
  activeOverlay = null
  el.home.style.display = 'none'
  el.chatView.style.display = ''
  el.tarotOverlay.style.display = 'none'
  el.matchOverlay.style.display = 'none'
  el.back.style.display = ''
  el.title.textContent = titleText
  el.input.focus()
}

function closeOverlays() {
  activeOverlay = null
  el.tarotOverlay.style.display = 'none'
  el.matchOverlay.style.display = 'none'
  if (viewMode === 'home') {
    el.back.style.display = 'none'
    el.title.textContent = '🔮 玄学小助手'
  } else {
    el.back.style.display = ''
    el.input?.focus()
  }
}

// ── 消息气泡 ──────────────────────────────────────────
function addBubble(role, text) {
  const div = document.createElement('div')
  div.className = `msg ${role}`
  div.textContent = text
  el.messages.appendChild(div)
  scrollDown()
  return div
}

function scrollDown() {
  requestAnimationFrame(() => {
    el.messages.scrollTop = el.messages.scrollHeight
  })
}

function showTyping() {
  const div = document.createElement('div')
  div.className = 'typing'
  div.textContent = '考拉正在想'
  el.messages.appendChild(div)
  scrollDown()
  return div
}

// ── 能量签卡片 ────────────────────────────────────────
function addEnergyCard(energy) {
  const div = document.createElement('div')
  div.className = 'energy-card'
  div.innerHTML = `
    <div class="ec-header">✨ 今日能量签 · ${energy.date}</div>
    <div class="ec-keyword">${energy.keyword}</div>
    <div class="ec-row">
      <span class="ec-label">幸运色</span>
      <span class="ec-value">
        <span class="ec-color-swatch" style="background:${energy.luckyColor.hex}"></span>
        ${energy.luckyColor.name} · ${energy.luckyColor.desc}
      </span>
    </div>
    <div class="ec-row">
      <span class="ec-label">幸运数</span>
      <span class="ec-value">${energy.luckyNumber}</span>
    </div>
    <div class="ec-divider"></div>
    <div class="ec-row">
      <span class="ec-label">适合做</span>
      <span class="ec-value">${energy.suitable.join('；')}</span>
    </div>
    <div class="ec-reminder">💡 ${energy.reminder}</div>
  `
  el.messages.appendChild(div)
  scrollDown()
}

// ── 抽签卡片 ──────────────────────────────────────────
function addLotCard(stick) {
  const div = document.createElement('div')
  div.className = 'lot-card'
  div.innerHTML = `
    <div class="lot-tag">${stick.tag}</div>
    <div class="lot-level">${stick.level}</div>
    <div class="lot-poem">${stick.poem}</div>
  `
  el.messages.appendChild(div)
  scrollDown()
}

// ── 幸运数字卡片 ──────────────────────────────────────
function addLuckyCard(data) {
  const div = document.createElement('div')
  div.className = 'lucky-card'
  div.innerHTML = `
    <div class="lucky-num">${data.number}</div>
    <div class="lucky-meaning">${data.meaning}</div>
  `
  el.messages.appendChild(div)
  scrollDown()
}

// ── 塔罗牌翻转动画 ────────────────────────────────────
function showTarotOverlay(cards) {
  activeOverlay = 'tarot'
  el.tarotCards.innerHTML = ''
  el.tarotOverlay.style.display = ''
  el.back.style.display = ''
  el.title.textContent = '🃏 AI塔罗'
  cards.forEach((card, i) => {
    const back = document.createElement('div')
    back.className = 'tarot-card-back'
    back.textContent = '🔮'
    back.addEventListener('click', () => pickTarot(card, back))
    el.tarotCards.appendChild(back)
  })
}

async function pickTarot(card, backEl) {
  // 翻牌动画
  backEl.className = 'tarot-card-reveal'
  backEl.innerHTML = `
    <div class="tcr-num">${card.num}</div>
    <div class="tcr-name">${card.name}</div>
    <div class="tcr-keyword">${card.keyword}</div>
  `
  // 等翻牌动画
  await new Promise(r => setTimeout(r, 500))

  el.tarotOverlay.style.display = 'none'
  showChat('🃏 AI塔罗')
  addBubble('user', `我选了「${card.name}」`)

  const dot = showTyping()
  sending = true
  try {
    const result = await window.koala.tarotPick(card)
    dot.remove()
    addBubble('koala', result?.text ?? String(result))
  } catch (err) {
    dot.remove()
    addBubble('koala', `❌ 出错了：${err.message}`)
  }
  sending = false
}

// ── 心情测试卡片 ──────────────────────────────────────
function addMoodCard(quiz) {
  const div = document.createElement('div')
  div.className = 'mood-card'
  div.innerHTML = `
    <div class="mood-question">${quiz.question}</div>
    <div class="mood-options"></div>
  `
  const optsContainer = div.querySelector('.mood-options')
  quiz.options.forEach(opt => {
    const btn = document.createElement('button')
    btn.className = 'mood-option'
    btn.textContent = opt.text
    btn.addEventListener('click', () => {
      // 显示结果
      const result = document.createElement('div')
      result.className = 'mood-result'
      result.innerHTML = `你的选择：<b>${opt.text}</b><br>今日心情：<span class="hint">${opt.mood}</span> — ${opt.hint}`
      optsContainer.style.display = 'none'
      div.querySelector('.mood-question').style.opacity = '0.5'
      div.appendChild(result)
      scrollDown()
    })
    optsContainer.appendChild(btn)
  })
  el.messages.appendChild(div)
  scrollDown()
}

// ── 星座配对结果 ──────────────────────────────────────
function addMatchCard(result, sign1, sign2) {
  const div = document.createElement('div')
  div.className = 'match-result'
  div.innerHTML = `
    <div class="match-pair">${sign1} × ${sign2}</div>
    <div class="match-score">${result.score}<span style="font-size:16px">分</span></div>
    <div class="match-score-label">元素：${result.elements}</div>
    <div class="match-desc">${result.desc}</div>
  `
  el.messages.appendChild(div)
  scrollDown()
}

// ── 发送消息 ──────────────────────────────────────────
async function doSend() {
  const text = el.input.value.trim()
  if (!text || sending) return
  el.input.value = ''
  el.input.style.height = 'auto'

  if (viewMode === 'home') showChat()

  addBubble('user', text)

  sending = true
  el.send.disabled = true
  const dot = showTyping()

  try {
    const result = await window.koala.chatSend(text)
    dot.remove()
    const reply = (result?.text ?? String(result)).trim()
    // 保护：如果模型返回空内容，给用户一句兜底提示而不是空气泡
    addBubble('koala', reply || '（考拉打了个盹，没听清…再说一次？）🐨')
  } catch (err) {
    dot.remove()
    addBubble('koala', `❌ 出错了：${err.message}`)
  }
  sending = false
  el.send.disabled = false
  scrollDown()
}

// ── 事件绑定 ──────────────────────────────────────────
el.close.addEventListener('click', () => window.koala.closeChat())
el.minimize?.addEventListener('click', () => window.koala.minimizeChat())
el.maximize?.addEventListener('click', () => window.koala.maximizeChat())

// 标题栏双击切换最大化（仅当点击在拖拽区域时）
document.querySelector('header').addEventListener('dblclick', (e) => {
  // 避开按钮
  if (e.target.closest('.icon-btn')) return
  window.koala.maximizeChat()
})

// 监听最大化状态，切换按钮图标
window.koala.onChatMaximized?.((maximized) => {
  if (el.maximize) el.maximize.textContent = maximized ? '❐' : '□'
})

// 初始化最大化按钮图标（先判方法是否存在，避免旧 preload 缺失时崩溃）
if (window.koala.isChatMaximized) {
  window.koala.isChatMaximized().then((maximized) => {
    if (el.maximize) el.maximize.textContent = maximized ? '❐' : '□'
  }).catch(() => {})
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (activeOverlay) { closeOverlays(); return }
    if (viewMode === 'chat') { goHome(); return }
    window.koala.closeChat()
  }
})

function goHome() {
  window.koala.chatReset()
  showHome()
}

function handleBack() {
  if (activeOverlay) {
    closeOverlays()
    return
  }
  goHome()
}

el.back.addEventListener('click', handleBack)

document.querySelectorAll('.overlay-close').forEach(btn => {
  btn.addEventListener('click', handleBack)
})

// 自动伸缩输入框
el.input.addEventListener('input', () => {
  el.input.style.height = 'auto'
  el.input.style.height = Math.min(el.input.scrollHeight, 80) + 'px'
})

el.send.addEventListener('click', doSend)
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
})

// ── 模式卡片 ──────────────────────────────────────────
const MODE_PROMPTS = {
  bazi: {
    title: '🔮 八字探索',
    welcome: '🔮 八字探索模式！\n\n告诉我你的「出生年月日时分 + 性别」，我帮你排盘分析。\n\n比如：「1995年8月15日下午3点 男」\n\n五行分布、性格特点、事业财运…都可以聊～',
    placeholder: '输入出生信息，或问八字问题…',
  },
  zodiac: {
    title: '⭐ 星座运势',
    welcome: '⭐ 星座运势模式！\n\n直接问我任何星座的问题，不需要出生信息～\n\n比如：「天蝎座今天运势怎么样」「双子座适合做什么工作」「最近是不是水逆」',
    placeholder: '问我任何星座的问题…',
  },
  oracle: {
    title: '🃏 今日占卜',
    welcome: '🃏 今日占卜模式！\n\n可以用下方的快捷按钮抽签、塔罗、看能量签，也可以直接跟我聊你的状态。\n\n今天想试试什么？',
    placeholder: '跟考拉聊聊，或用下方快捷按钮…',
  },
}

document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    const mode = card.dataset.mode
    const cfg = MODE_PROMPTS[mode]
    if (!cfg) return
    window.koala.chatReset()
    showChat(cfg.title)
    el.input.placeholder = cfg.placeholder
    addBubble('koala', cfg.welcome)
  })
})

// ── 快捷玩法 ──────────────────────────────────────────
const ZODIAC_NAMES = ['白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座','水瓶座','双鱼座']

document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action
    if (viewMode === 'home') showChat('✨ 玄学小助手')

    if (action === 'energy') {
      addBubble('user', '✨ 看看今日能量签')
      const energy = await window.koala.dailyEnergy()
      addEnergyCard(energy)
      addBubble('koala', '🐨 今日能量签已生成～这份能量图是你今天的小小罗盘，跟着感觉走就好。')
    }
    else if (action === 'lot') {
      addBubble('user', '🎋 帮我抽根签')
      const dot = showTyping()
      sending = true
      try {
        const result = await window.koala.drawLot()
        dot.remove()
        if (result?.stick) addLotCard(result.stick)
        addBubble('koala', result?.text ?? '')
      } catch (err) {
        dot.remove()
        addBubble('koala', `❌ ${err.message}`)
      }
      sending = false
    }
    else if (action === 'tarot') {
      addBubble('user', '🃏 来一次AI塔罗')
      const cards = await window.koala.tarotDraw()
      showTarotOverlay(cards)
    }
    else if (action === 'lucky') {
      addBubble('user', '🎲 今天的幸运数字是？')
      const data = await window.koala.luckyNumber()
      addLuckyCard(data)
      addBubble('koala', '🐨 数字本身没有魔力，但它是一个提醒——今天，留意这个频率。')
    }
    else if (action === 'mood') {
      addBubble('user', '🧪 测测今天的心情')
      const quiz = await window.koala.moodQuiz()
      addMoodCard(quiz)
    }
    else if (action === 'match') {
      showMatchOverlay()
    }
  })
})

// ── 星座配对浮层 ──────────────────────────────────────
function showMatchOverlay() {
  activeOverlay = 'match'
  el.matchSelects.innerHTML = ''
  for (let i = 0; i < 2; i++) {
    const select = document.createElement('select')
    select.className = 'match-select'
    ZODIAC_NAMES.forEach(name => {
      const opt = document.createElement('option')
      opt.value = name
      opt.textContent = name
      select.appendChild(opt)
    })
    if (i === 1) select.selectedIndex = 7 // 天蝎座
    el.matchSelects.appendChild(select)
  }
  el.matchOverlay.style.display = ''
  el.back.style.display = ''
  el.title.textContent = '💑 星座配对'
}

el.matchGo.addEventListener('click', async () => {
  const selects = el.matchSelects.querySelectorAll('.match-select')
  const s1 = selects[0].value
  const s2 = selects[1].value
  el.matchOverlay.style.display = 'none'
  if (viewMode === 'home') showChat('💑 星座配对')
  addBubble('user', `${s1} 和 ${s2} 配吗？`)
  const result = await window.koala.zodiacMatch(s1, s2)
  addMatchCard(result, s1, s2)
  addBubble('koala', '🐨 配对分数只是一个参考维度，真正的关系靠的是两个人的理解和用心。')
})

// ── 初始化 ────────────────────────────────────────────
window.koala.onChatFocus(() => {
  // 每次打开都回到首页
  showHome()
})
