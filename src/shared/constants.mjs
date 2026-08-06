// 应用级常量：主进程和渲染进程共用。
export const PET = {
  // 窗口比考拉本身大：上方要给飘字留位置，左右给特效留余量。
  width: 300,
  height: 380,
  // 考拉在窗口内的锚点（底部居中），拖动时按这个点计算屏幕位置
  koalaHeight: 220,
  margin: 24,
}

/** 点击一次随机掉落的奖励。weight 越大越常出现。 */
export const REWARDS = [
  { key: 'merit', label: '功德', emoji: '🙏', color: '#c9a227', weight: 34 },
  { key: 'luck', label: '欧气', emoji: '✨', color: '#d98cc4', weight: 16 },
  { key: 'health', label: '健康', emoji: '🌱', color: '#5fa871', weight: 14 },
  { key: 'wealth', label: '财富', emoji: '💰', color: '#d99a3c', weight: 12 },
  { key: 'joy', label: '快乐', emoji: '😊', color: '#e0864f', weight: 14 },
  { key: 'beauty', label: '美貌', emoji: '🌸', color: '#dd8b9e', weight: 10 },
]

const TOTAL_WEIGHT = REWARDS.reduce((s, r) => s + r.weight, 0)

/** 按权重随机抽一个奖励 */
export function rollReward() {
  let n = Math.random() * TOTAL_WEIGHT
  for (const r of REWARDS) {
    n -= r.weight
    if (n <= 0) return r
  }
  return REWARDS[0]
}

/** 本地日期键 YYYY-MM-DD。刻意不用 UTC——用户的「今天」是本地时区的今天。 */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
