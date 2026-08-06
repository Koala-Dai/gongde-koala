// 持久化：功德数据 + 窗口位置。写在 userData 下的一个 JSON 里。
//
// 为什么不用数据库：全部数据就是「每天 7 个计数器」，一年也才 2.5KB。
// 用 JSON 换来的是零依赖、可手动查看、崩溃也不会损坏成无法读取的状态。
import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { todayKey } from '../shared/constants.mjs'

const EMPTY_DAY = () => ({ knocks: 0, merit: 0, luck: 0, health: 0, wealth: 0, joy: 0, beauty: 0 })

let file = ''
let data = null
let flushTimer = null

function defaults() {
  return {
    version: 1,
    /** 按日期存的统计：{ '2026-07-31': { knocks, merit, ... } } */
    days: {},
    /** 累计总数，避免每次都要遍历 days */
    total: EMPTY_DAY(),
    /** 桌宠窗口位置。null = 首次启动，由主进程放到右下角 */
    petPos: null,
    settings: {
      launchAtLogin: false,
      muted: false,
      volume: 0.7,
      koalaScale: 1.0,
      /** 用户画像（多用户玄学）。每个：{ id, name, year, month, day, hour, gender } */
      profiles: [],
      /** 当前激活画像 id，null = 还没记过任何人 */
      currentProfileId: null,
    },
  }
}

export function initStore() {
  file = join(app.getPath('userData'), 'gongde.json')
  try {
    if (!existsSync(file)) { data = defaults(); return data }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    // 深合并 settings：旧文件可能缺 profiles / currentProfileId 等新字段，
    // 浅合并会让旧 settings 整体覆盖 defaults.settings，导致新字段丢失。
    data = { ...defaults(), ...parsed, settings: { ...defaults().settings, ...(parsed.settings ?? {}) } }
  } catch (err) {
    // 文件损坏时不要让应用起不来——备份后重新开始，用户最多丢统计数据
    console.error('[store] 读取失败，重置:', err.message)
    try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch {}
    data = defaults()
  }
  return data
}

/** 合并写入，200ms 内的多次调用只落一次盘（连点木鱼时每次都写盘没必要） */
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      mkdirSync(dirname(file), { recursive: true })
      // 先写临时文件再改名：断电/崩溃时不会留下半个 JSON
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, file)
    } catch (err) {
      console.error('[store] 写入失败:', err.message)
    }
  }, 200)
}

export function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  try {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, file)
  } catch (err) {
    console.error('[store] 退出时写入失败:', err.message)
  }
}

export function getDay(key = todayKey()) {
  return data.days[key] ?? EMPTY_DAY()
}

export function getTotal() {
  return data.total
}

/** 记一次敲击。rewardKey 是 REWARDS 里的 key。返回更新后的今日数据。 */
export function recordKnock(rewardKey) {
  const key = todayKey()
  const day = (data.days[key] ??= EMPTY_DAY())
  day.knocks++
  data.total.knocks++
  if (rewardKey in day) {
    day[rewardKey]++
    data.total[rewardKey]++
  }
  scheduleFlush()
  return { date: key, ...day }
}

export function getPetPos() {
  return data.petPos
}

export function setPetPos(x, y) {
  data.petPos = { x, y }
  scheduleFlush()
}

export function getSettings() {
  return data.settings
}

export function setSettings(patch) {
  Object.assign(data.settings, patch)
  scheduleFlush()
  return data.settings
}

// ── 用户画像（多用户玄学）──────────────────────────────
// 考拉「记得用户」的基础：每记一次出生信息就存一个画像，
// 之后说「今日运势」不用再打生日，也支持「切换用户 XX」换人分析。

export function getProfiles() {
  return data.settings.profiles ?? []
}

export function getCurrentProfile() {
  const id = data.settings.currentProfileId
  return data.settings.profiles?.find((p) => p.id === id) ?? null
}

/** 新建或更新画像：有名字按名字匹配，否则更新当前激活画像。返回该画像。
 *  防御性检查：
 *  1. 拒绝在没有完整出生信息（year+month+day）的情况下创建新画像——空画像会让后续所有
 *     八字/运势请求走"未提供出生信息"分支，破坏上下文连续性。
 *  2. 更新已有画像时，只在 patch 包含完整出生信息时才覆盖命盘字段（year/month/day/hour/gender），
 *     避免"2024年8月运势"的误提取结果覆盖用户真实出生年份。 */
export function upsertProfile(patch) {
  const profiles = (data.settings.profiles ??= [])
  const name = (patch.name ?? '').trim()
  const hasCompleteBirth = patch.year && patch.month && patch.day

  let p = name
    ? profiles.find((x) => x.name === name)
    : profiles.find((x) => x.id === data.settings.currentProfileId)

  if (!p && hasCompleteBirth) {
    // 真正的新建：必须有完整出生信息，避免误创建"幽灵画像"
    p = { id: 'p' + Date.now().toString(36), name: name || '主人' }
    profiles.push(p)
  }
  if (!p) {
    // 没有完整命盘、也找不到对应画像 → 静默忽略，不切换、不创建
    return getCurrentProfile() ?? data.settings.profiles?.[0] ?? null
  }

  // 更新画像：命盘字段（year/month/day/hour/gender）只在有完整出生信息时才覆盖
  const { name: _drop, year, month, day, hour, gender, birthplace, ...rest } = patch
  if (hasCompleteBirth) {
    Object.assign(p, { year, month, day })
    if (hour !== undefined) p.hour = hour
    if (gender !== undefined) p.gender = gender
    if (birthplace !== undefined) p.birthplace = birthplace
  }
  // 非命盘字段（如 name）随时可以更新
  Object.assign(p, rest)
  if (name) p.name = name
  data.settings.currentProfileId = p.id
  scheduleFlush()
  return p
}

/** 切换当前激活画像（按 id 或名字）。找不到返回 null。 */
export function switchProfile(idOrName) {
  const p = (data.settings.profiles ?? []).find(
    (x) => x.id === idOrName || x.name === idOrName,
  )
  if (p) {
    data.settings.currentProfileId = p.id
    scheduleFlush()
  }
  return p ?? null
}

/** 最近 n 天有记录的日期，新的在前 */
export function recentDays(n = 14) {
  return Object.keys(data.days).sort().reverse().slice(0, n)
    .map((date) => ({ date, ...data.days[date] }))
}
