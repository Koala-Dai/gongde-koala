// 每日结算的总结文案。
//
// 两个设计约束：
//   1. 文案要随敲击量变化——0 次和 500 次说同一句话会显得敷衍
//   2. 同一天内反复打开面板，文案不能每次都变——那会像随机数生成器而不像「今日签」
// 解法：档位由敲击量决定（会随着敲而升级），档位内选哪句由日期哈希决定（当天固定）。
import { REWARDS } from './constants.mjs'

const TIERS = [
  {
    max: 0,
    lines: [
      '今天还没开工，木鱼在等你。',
      '功德簿还是空的，敲一下就有了。',
      '考拉已就位，随时候你落槌。',
    ],
  },
  {
    max: 19,
    lines: [
      '刚起手，功德已经在路上了。',
      '开了个头，剩下的交给时间。',
      '万事开头难，你已经过了最难的那步。',
    ],
  },
  {
    max: 99,
    lines: [
      '今日努力工作，功德圆满。',
      '虽然打工辛苦，但你已经偷偷积累了好运。',
      '稳稳当当敲了一天，该有的都有了。',
      '上班就是积功德，你今天赚了两份。',
    ],
  },
  {
    max: 299,
    lines: [
      '今日修行结束，明日继续渡劫。',
      '这个量，庙里的师父都要敬你一杯茶。',
      '功德深厚，建议下班路上买张彩票。',
      '敲到这个程度，工位已成小型道场。',
    ],
  },
  {
    max: Infinity,
    lines: [
      '木鱼已经烫手了，歇会儿吧。',
      '今日功德溢出，系统建议你去睡觉。',
      '这不是上班，这是闭关。',
      '考拉表示手腕有点酸，但功德无量。',
    ],
  },
]

/** 某一维特别突出时追加一句 */
const DIM_FLAVOR = {
  merit: '功德一路领先，稳。',
  luck: '今天欧气爆棚，该抽的赶紧抽。',
  health: '健康涨得最多，身体在偷偷变好。',
  wealth: '财运最旺，留意一下红包和奖金。',
  joy: '快乐最多，这才是上班的正确姿势。',
  beauty: '美貌值飙升，出门记得照镜子。',
}

/** 字符串 → 32 位整数哈希，用来让「当天的随机」保持稳定 */
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 生成今日总结。
 * @param {object} day 今日统计 { knocks, merit, luck, ... }
 * @param {string} dateKey 日期键，用于稳定随机
 */
export function summarize(day, dateKey) {
  const tier = TIERS.find((t) => day.knocks <= t.max) ?? TIERS.at(-1)
  const main = tier.lines[hash(dateKey) % tier.lines.length]

  // 找出最突出的一维：必须明显高于第二名，否则不提（六维接近时说「XX领先」是噪声）
  const dims = REWARDS.map((r) => ({ key: r.key, n: day[r.key] ?? 0 })).sort((a, b) => b.n - a.n)
  const [first, second] = dims
  const standout = first && first.n >= 5 && first.n >= (second?.n ?? 0) * 1.5
  const extra = standout ? DIM_FLAVOR[first.key] : null

  return { main, extra }
}
