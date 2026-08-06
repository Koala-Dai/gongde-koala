// 今日功德面板渲染进程。
import { REWARDS } from '../../shared/constants.mjs'
import { summarize } from '../../shared/summaries.mjs'

const el = {
  date: document.getElementById('date'),
  knockNum: document.getElementById('knock-num'),
  dims: document.getElementById('dims'),
  bars: document.getElementById('bars'),
  trendMax: document.getElementById('trend-max'),
  sumMain: document.getElementById('sum-main'),
  sumExtra: document.getElementById('sum-extra'),
  total: document.getElementById('total'),
  streak: document.getElementById('streak'),
  close: document.getElementById('close'),
}

// 六维格子只建一次，之后只更新数值——避免每次刷新都重建 DOM 导致进度条动画丢失
const cells = new Map()
for (const r of REWARDS) {
  const div = document.createElement('div')
  div.className = 'dim'
  div.style.setProperty('--d', r.color)
  div.innerHTML =
    `<span class="emoji">${r.emoji}</span>` +
    `<span class="label">${r.label}</span>` +
    `<span class="val">+0</span>` +
    `<span class="bar"></span>`
  el.dims.appendChild(div)
  cells.set(r.key, { div, val: div.querySelector('.val'), bar: div.querySelector('.bar') })
}

const dayKey = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

let lastKnocks = -1

function fmtDate(key) {
  const [y, m, d] = key.split('-').map(Number)
  const wd = '日一二三四五六'[new Date(y, m - 1, d).getDay()]
  return `${m} 月 ${d} 日 · 周${wd}`
}

/**
 * 近 7 天柱状图。刻意按日历日补齐而不是只画有记录的天——
 * 只画有记录的天会让「中间休息了两天」看起来像连续修行。
 */
function renderTrend(days, todayK) {
  const map = new Map(days.map((d) => [d.date, d.knocks]))
  const cols = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    cols.push({ key, n: map.get(key) ?? 0, isToday: key === todayK, label: d.getDate() })
  }
  const max = Math.max(1, ...cols.map((c) => c.n))
  el.trendMax.textContent = `峰值 ${max} 次`

  el.bars.replaceChildren(
    ...cols.map((c, i) => {
      const col = document.createElement('div')
      col.className = `bar-col${c.isToday ? ' today' : ''}${c.n === 0 ? ' empty' : ''}`
      const fill = document.createElement('div')
      fill.className = 'fill'
      // 最矮也留 3px，否则 0 和 1 次看起来一样
      fill.style.height = `${c.n === 0 ? 3 : Math.max(6, (c.n / max) * 46)}px`
      fill.style.animationDelay = `${i * 45}ms`
      fill.title = `${c.key}  ${c.n} 次`
      const day = document.createElement('div')
      day.className = 'day'
      day.textContent = c.label
      col.append(fill, day)
      return col
    })
  )
}

async function render() {
  const { day, total, date } = await window.koala.today()

  el.date.textContent = fmtDate(date)

  // 数字变化时跳一下。首次渲染不跳，否则每次打开面板都在抖
  if (lastKnocks >= 0 && day.knocks !== lastKnocks) {
    el.knockNum.classList.remove('tick')
    void el.knockNum.offsetWidth
    el.knockNum.classList.add('tick')
  }
  lastKnocks = day.knocks
  el.knockNum.textContent = day.knocks

  const max = Math.max(1, ...REWARDS.map((r) => day[r.key] ?? 0))
  for (const r of REWARDS) {
    const n = day[r.key] ?? 0
    const c = cells.get(r.key)
    c.val.textContent = `+${n}`
    c.div.classList.toggle('zero', n === 0)
    c.bar.style.transform = `scaleX(${n / max})`
  }

  const { main, extra } = summarize(day, date)
  el.sumMain.textContent = main
  el.sumExtra.textContent = extra ?? ''

  const days = await window.koala.recent(60)
  renderTrend(days, date)
  el.total.textContent = `累计 ${total.knocks.toLocaleString('zh-CN')} 次`
  el.streak.textContent = `已修行 ${countStreak(days)} 天`
}

/** 连续修行天数：从今天往前数，遇到断档就停 */
function countStreak(days) {
  const has = new Set(days.filter((d) => d.knocks > 0).map((d) => d.date))
  let streak = 0
  const cur = new Date()
  for (;;) {
    if (!has.has(dayKey(cur))) break
    streak++
    cur.setDate(cur.getDate() - 1)
  }
  return streak
}

el.close.addEventListener('click', () => window.koala.closePanel())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.koala.closePanel()
})

window.koala.onPanelRefresh(render)
render()
