// 四柱八字排盘：纯本地计算，不需要调 API。
//
// 参考：《协纪辨方书》干支纪年法、日干支基数公式、五鼠遁时柱
// 算法来源：公历 → 日柱用蔡勒（Zeller）修正 + 基数查表，
// 年柱以立春为界，月柱以节气为界，时柱用五鼠遁。
//
// 这不是"算命"——这是把两千年的历法规则写成代码。解读留给 AI。

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']
const WUXING_TG = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }
const WUXING_DZ = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' }
const YIN_YANG_TG = { 甲: '阳', 乙: '阴', 丙: '阳', 丁: '阴', 戊: '阳', 己: '阴', 庚: '阳', 辛: '阴', 壬: '阳', 癸: '阴' }

/**
 * 公历日期 → 日柱干支 [gan, zhi]。
 * 用儒略日数（JDN）计算，世纪无关、无需查表，1900~2099 均准确。
 * 校验锚点（均经万年历交叉验证）：1949-10-01 = 甲子，2026-08-04 = 庚戌。
 */
function jdn(year, month, day) {
  // 1、2 月当作上一年的 13、14 月，公式才能正确处理闰年边界
  if (month <= 2) { year--; month += 12 }
  const A = Math.floor(year / 100)
  const B = 2 - A + Math.floor(A / 4)
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524
}

function dayPillar(year, month, day) {
  const n = ((jdn(year, month, day) + 49) % 60 + 60) % 60
  return [GAN[n % 10], ZHI[n % 12]]
}

/**
 * 年柱：以立春为界。
 * 立春通常在 2 月 4 日 ±1 天。简化为按 2 月 4 日切换。
 * 真正的界线是精确到分钟的节气时间，但用户对话场景下 1 天精度足够。
 */
function yearPillar(year, month, day) {
  if (month < 2 || (month === 2 && day < 4)) year--
  const idx = ((year - 4) % 60 + 60) % 60
  const g = idx % 10
  const z = idx % 12
  return [GAN[g], ZHI[z]]
}

/**
 * 月柱：以节气为界（正月立春、二月惊蛰…），按年柱天干用五虎遁推月干。
 * 同样用 1 天精度的节气近似。
 */
const MONTH_ZHI_ORDER = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']
// 节气日期近似（每月两个节气中的第一个，作为月份起算点）
const JIEQI_DAYS = [5, 4, 6, 5, 6, 6, 7, 8, 8, 8, 7, 7] // 正月到十二月，按公历月初算

function monthPillar(year, month, day) {
  // 如果还没到这个月的节气，回退到上个月
  const jq = JIEQI_DAYS[(month - 1) % 12]
  const mIdx = month - 1 + (day < jq ? -1 : 0)
  const z = MONTH_ZHI_ORDER[((mIdx % 12) + 12) % 12]

  // 五虎遁：甲己之年丙作首，乙庚之岁戊为头…
  const [yearGan] = yearPillar(year, month, day)
  const ganOrder = { 甲: 2, 乙: 4, 丙: 6, 丁: 8, 戊: 0, 己: 2, 庚: 4, 辛: 6, 壬: 8, 癸: 0 }
  const ziOrder = MONTH_ZHI_ORDER.indexOf(z)
  const g = GAN[(ganOrder[yearGan] + ziOrder) % 10]
  return [g, z]
}

/**
 * 时柱 → 时支由几时决定（固定映射），时干根据日干用五鼠遁推出。
 * @param {number} hour 0-23
 * @param {string} dayGan 日干
 */
function hourPillar(hour, dayGan) {
  const hourZhi = ZHI[(Math.floor((hour + 1) / 2) % 12)]
  // 五鼠遁：甲己还加甲，乙庚丙作初…
  const wsr = { 甲: 0, 己: 0, 乙: 2, 庚: 2, 丙: 4, 辛: 4, 丁: 6, 壬: 6, 戊: 8, 癸: 8 }
  const z = ZHI.indexOf(hourZhi)
  const g = GAN[(wsr[dayGan] + z) % 10]
  return [g, hourZhi]
}

/**
 * 十神：以日干为中心，其他天干与之的生克 + 阴阳关系。
 */
const SHI_SHEN = [
  // [关系, 阴阳同, 阴阳不同]
  ['比肩', '劫财'],   // 同我
  ['食神', '伤官'],   // 我生
  ['偏财', '正财'],   // 我克
  ['偏官', '正官'],   // 克我
  ['偏印', '正印'],   // 生我
]
function getShiShen(dayGan, otherGan) {
  const wi = { 木: 0, 火: 1, 土: 2, 金: 3, 水: 4 }
  const wx = WUXING_TG
  const yy = YIN_YANG_TG
  // 生克关系链：同=0, 我生=1, 我克=2, 克我=3, 生我=4
  const chain = [
    [0, 1, 2, 3, 4], // 木 → 同, 火(我生), 土(我克), 金(克我), 水(生我)
    [4, 0, 1, 2, 3], // 火
    [3, 4, 0, 1, 2], // 土
    [2, 3, 4, 0, 1], // 金
    [1, 2, 3, 4, 0], // 水
  ]
  const rel = chain[wi[wx[dayGan]]][wi[wx[otherGan]]]
  return SHI_SHEN[rel][yy[dayGan] === yy[otherGan] ? 0 : 1]
}

/** 性别类型 */
const MALE = 'male'
const FEMALE = 'female'

/**
 * 排盘入口。一次调用返回完整的四柱八字 + 十神 + 基本信息。
 * @param {{ year, month, day, hour, gender }}
 */
export function baziPaiPan({ year, month, day, hour, gender }) {
  const [yG, yZ] = yearPillar(year, month, day)
  const [mG, mZ] = monthPillar(year, month, day)
  const [dG, dZ] = dayPillar(year, month, day)
  const [hG, hZ] = hourPillar(hour, dG)

  const pillars = [
    { name: '年柱', gan: yG, zhi: yZ, shiShen: getShiShen(dG, yG), wuxing: `${WUXING_TG[yG]}+${WUXING_DZ[yZ]}` },
    { name: '月柱', gan: mG, zhi: mZ, shiShen: getShiShen(dG, mG), wuxing: `${WUXING_TG[mG]}+${WUXING_DZ[mZ]}` },
    { name: '日柱', gan: dG, zhi: dZ, shiShen: '日主', wuxing: `${WUXING_TG[dG]}+${WUXING_DZ[dZ]}` },
    { name: '时柱', gan: hG, zhi: hZ, shiShen: getShiShen(dG, hG), wuxing: `${WUXING_TG[hG]}+${WUXING_DZ[hZ]}` },
  ]

  const ganStems = pillars.map((p) => p.gan)
  const zhiBranches = pillars.map((p) => p.zhi)

  // 五行统计
  const wxC = {}
  for (const g of ganStems) { const w = WUXING_TG[g]; wxC[w] = (wxC[w] ?? 0) + 1 }
  for (const z of zhiBranches) { const w = WUXING_DZ[z]; wxC[w] = (wxC[w] ?? 0) + 1 }

  // 日柱 → 大运顺逆：阳男阴女顺排，阴男阳女逆排
  const dayYinYang = YIN_YANG_TG[dG]
  const isMale = gender === MALE
  const shunPai = (dayYinYang === '阳' && isMale) || (dayYinYang === '阴' && !isMale)

  return {
    pillars,
    dayGan: dG,
    dayZhi: dZ,
    dayWuxing: WUXING_TG[dG],
    dayYinYang,
    /** 四柱八字字符串，如 "甲子 乙丑 丙寅 丁卯" */
    formula: pillars.map((p) => p.gan + p.zhi).join(' '),
    wuxingCount: wxC,
    dayunDirection: shunPai ? '顺' : '逆',
    zodiac: ZODIAC[ZHI.indexOf(yZ)],
    summary: `${WUXING_TG[dG]}${dayYinYang}日主，${yG}${yZ}年生，四柱：${ganStems.join('')}/${zhiBranches.join('')}`,
  }
}

/** 公历日期 → 生肖 */
export function zodiac(year, month, day) {
  const [, yi] = yearPillar(year, month, day)
  return ZODIAC[ZHI.indexOf(yi)]
}

/**
 * 公历日期 → 西方星座（Numerologist 引擎的运算依据）。
 * 边界取天文常用近似（如巨蟹座 6/22 起、摩羯座 12/22 起）。
 * 与八字并列，作为「星座 / Numerology」维度的分析基础。
 */
const WESTERN = [
  { name: '水瓶座', m: 1, d: 20 },
  { name: '双鱼座', m: 2, d: 19 },
  { name: '白羊座', m: 3, d: 21 },
  { name: '金牛座', m: 4, d: 20 },
  { name: '双子座', m: 5, d: 21 },
  { name: '巨蟹座', m: 6, d: 22 },
  { name: '狮子座', m: 7, d: 23 },
  { name: '处女座', m: 8, d: 23 },
  { name: '天秤座', m: 9, d: 23 },
  { name: '天蝎座', m: 10, d: 24 },
  { name: '射手座', m: 11, d: 23 },
  { name: '摩羯座', m: 12, d: 22 },
]
export function westernZodiac(month, day) {
  for (let i = 0; i < WESTERN.length; i++) {
    const z = WESTERN[i]
    const afterStart = month > z.m || (month === z.m && day >= z.d)
    if (!afterStart) return i === 0 ? '摩羯座' : WESTERN[i - 1].name
    if (!WESTERN[i + 1]) return z.name // 已是最后一个（摩羯 12/22 起）
  }
  return '摩羯座'
}
