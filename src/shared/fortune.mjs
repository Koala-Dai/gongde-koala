// 玄学娱乐数据与本地生成逻辑。
// 所有结果用「日期 + 用户画像 id」做种子，保证同一天同一人结果稳定，
// 换一天自动换签——像每日运势一样有仪式感。
// 纯本地计算，不花 API 额度。

import { todayKey } from './constants.mjs'

// ── 星座数据 ──────────────────────────────────────────
export const ZODIAC_DATA = {
  '白羊座': { element: '火', planet: '火星', traits: '行动力强、勇敢直率、充满冲劲', keywords: '突破·引领·冒险' },
  '金牛座': { element: '土', planet: '金星', traits: '稳重务实、耐心持久、享受生活', keywords: '积累·稳固·感受' },
  '双子座': { element: '风', planet: '水星', traits: '思维敏捷、善于沟通、好奇心强', keywords: '交流·探索·灵活' },
  '巨蟹座': { element: '水', planet: '月亮', traits: '温柔细腻、重感情、保护欲强', keywords: '守护·共情·安顿' },
  '狮子座': { element: '火', planet: '太阳', traits: '自信热情、天生的领导者、光芒四射', keywords: '闪耀·创造·引领' },
  '处女座': { element: '土', planet: '水星', traits: '细致完美、逻辑清晰、服务精神', keywords: '精炼·整理·完善' },
  '天秤座': { element: '风', planet: '金星', traits: '优雅平衡、善于社交、追求和谐', keywords: '平衡·审美·合作' },
  '天蝎座': { element: '水', planet: '冥王星', traits: '洞察力强、深情专注、意志坚定', keywords: '蜕变·深度·掌控' },
  '射手座': { element: '火', planet: '木星', traits: '乐观自由、热爱探索、哲学思辨', keywords: '远行·扩张·哲思' },
  '摩羯座': { element: '土', planet: '土星', traits: '务实坚韧、目标明确、耐力惊人', keywords: '攀登·坚守·成就' },
  '水瓶座': { element: '风', planet: '天王星', traits: '独立创新、思想前卫、人道精神', keywords: '革新·独立·理想' },
  '双鱼座': { element: '水', planet: '海王星', traits: '感性浪漫、直觉敏锐、富有同理心', keywords: '梦境·共感·流动' },
}

export const ZODIAC_NAMES = Object.keys(ZODIAC_DATA)

// ── 生肖数据 ──────────────────────────────────────────
export const SHENGXIAO_DATA = {
  '鼠': { traits: '机灵聪慧、适应力强、善于理财', element: '水' },
  '牛': { traits: '勤恳踏实、耐力过人、值得信赖', element: '土' },
  '虎': { traits: '果敢有魄力、天生的冒险家', element: '木' },
  '兔': { traits: '温和细腻、审美出众、人缘好', element: '木' },
  '龙': { traits: '气场强大、志向远大、充满魅力', element: '土' },
  '蛇': { traits: '深思熟虑、直觉精准、优雅神秘', element: '火' },
  '马': { traits: '热情奔放、行动力强、不受拘束', element: '火' },
  '羊': { traits: '温柔善良、有艺术天赋、注重和谐', element: '土' },
  '猴': { traits: '聪明灵活、幽默风趣、应变力强', element: '金' },
  '鸡': { traits: '勤奋守时、观察力敏锐、直率坦诚', element: '金' },
  '狗': { traits: '忠诚可靠、正义感强、踏实护家', element: '土' },
  '猪': { traits: '福气满满、豁达厚道、享受生活', element: '水' },
}

// ── 每日能量签 ──────────────────────────────────────────
const ENERGY_KEYWORDS = [
  '蓄力', '顺流', '破局', '沉淀', '舒展', '绽放', '内观', '前行',
  '安顿', '出发', '凝聚', '释放', '深耕', '远眺', '归零', '新生',
  '稳固', '流转', '蛰伏', '展翅', '收敛', '播种', '收获', '淬炼',
  '漫游', '扎根', '逆风', '乘风', '破晓', '月升',
]

const LUCKY_COLORS = [
  { name: '墨绿色', hex: '#2d5a3d', desc: '沉稳而有生命力' },
  { name: '暖橙色', hex: '#e8915a', desc: '温暖而充满活力' },
  { name: '靛蓝色', hex: '#3b4a6b', desc: '深邃而平静' },
  { name: '砖红色', hex: '#a0522d', desc: '踏实而有温度' },
  { name: '鹅黄色', hex: '#e6c84c', desc: '明亮而柔和' },
  { name: '雾紫色', hex: '#9b8aa6', desc: '梦幻而神秘' },
  { name: '青灰色', hex: '#6a8b8b', desc: '冷静而通透' },
  { name: '赭石色', hex: '#8b6914', desc: '质朴而厚重' },
  { name: '黛色', hex: '#4a4266', desc: '深邃而有层次' },
  { name: '竹青色', hex: '#7ba87b', desc: '清新而舒展' },
  { name: '藕荷色', hex: '#c08a8a', desc: '温柔而内敛' },
  { name: '月白色', hex: '#d4dcd0', desc: '空灵而干净' },
]

const SUITABLE_ACTIVITIES = [
  '整理计划、复盘近期目标', '学习新技能、接触新领域', '推进搁置已久的长期项目',
  '联系久未见面的朋友', '运动出汗、释放身体能量', '独处思考、写写日记',
  '处理积压的琐事', '创造性工作、写写画画', '与人深度交流、碰撞想法',
  '清理生活环境、断舍离', '出门走走、换换环境', '阅读一本好书',
  '整理财务、理清账目', '给关心的人发条消息', '尝试一件没做过的小事',
  '放慢节奏、做做深呼吸', '规划接下来的方向', '完成一件拖延的事',
  '享受一顿好饭', '观察生活中的小确幸',
]

const REMINDERS = [
  '不要因为短期结果焦虑——种子发芽需要时间。',
  '休息也是前进的一部分，别把自己绷太紧。',
  '今天的能量不需要用完，留一点给明天的自己。',
  '不是因为看到希望才坚持，是因为坚持才看到希望。',
  '允许自己有不在状态的时候，那是在充电。',
  '比起做得快，今天更适合做得稳。',
  '别人的进度条是别人的，你有你的时区。',
  '纠结的时候，选那个让你更放松的方向。',
  '今天不必事事完美，完成比完美重要。',
  '情绪来了就让它来，走了就让它走，不挽留。',
  '与其想一百步，不如先迈一步。',
  '今天的你已经是最好的你了，不必和别人比。',
  '保持柔软，但不丢掉棱角。',
  '可以慢，但不要停。',
  '把注意力放在「能做什么」而不是「缺什么」。',
  '今天适合做减法，少即是多。',
  '顺其自然不是躺平，是尽人事后听天命。',
  '心里烦的时候，去看看天空或树木。',
  '你比你以为的更有韧性。',
  '今天值得为自己做一件开心的小事。',
]

// ── 抽签数据 ──────────────────────────────────────────
export const FORTUNE_STICKS = [
  { level: '上上签', poem: '春雷一声蛰虫醒，万里鹏程正此时。', meaning: '蓄势已久的力量即将释放，大胆迈出那一步。', tag: '⚡ 破局之力' },
  { level: '上上签', poem: '金鳞岂是池中物，一遇风云便化龙。', meaning: '你的潜力远超现在的处境，等待对的时机即可。', tag: '🐉 潜龙在渊' },
  { level: '上签', poem: '春风得意马蹄疾，一日看尽长安花。', meaning: '顺势而为的时节，行动力是最好的运气。', tag: '🌸 春风时节' },
  { level: '上签', poem: '宝剑锋从磨砺出，梅花香自苦寒来。', meaning: '之前的磨砺正在结出果实，耐心收获。', tag: '剑 锋初成' },
  { level: '上签', poem: '海上生明月，天涯共此时。', meaning: '人脉和连接正在为你带来光芒，别独自扛。', tag: '🌙 明月照海' },
  { level: '中上签', poem: '竹外桃花三两枝，春江水暖鸭先知。', meaning: '细微处已有转机，留心身边的信号。', tag: '🌿 春水初暖' },
  { level: '中上签', poem: '行到水穷处，坐看云起时。', meaning: '看似到了尽头，其实是新风景的开始。', tag: '☁️ 云起水穷' },
  { level: '中签', poem: '山重水复疑无路，柳暗花明又一村。', meaning: '方向没有错，再多走几步就能看到转机。', tag: '🗺️ 寻路问津' },
  { level: '中签', poem: '采菊东篱下，悠然见南山。', meaning: '今天的节奏适合放慢，在平静中自有所得。', tag: '🍵 东篱采菊' },
  { level: '中签', poem: '潮平两岸阔，风正一帆悬。', meaning: '条件正在成熟，准备出发即可。', tag: '⛵ 风正帆悬' },
  { level: '中签', poem: '润物细无声，春雨贵如油。', meaning: '潜移默化的积累正在发生，别急看结果。', tag: '🌧️ 春雨润物' },
  { level: '中签', poem: '不识庐山真面目，只缘身在此山中。', meaning: '跳出来看看全局，答案会更清晰。', tag: '🏔️ 山中观雾' },
  { level: '中下签', poem: '欲渡黄河冰塞川，将登太行雪满山。', meaning: '暂时遇到阻力是正常的，绕路也是路。', tag: '🧊 冰河难渡' },
  { level: '中下签', poem: '蝉噪林逾静，鸟鸣山更幽。', meaning: '外界越吵闹，越需要内在的安静。', tag: '🐦 林静蝉噪' },
  { level: '下签', poem: '千磨万击还坚劲，任尔东西南北风。', meaning: '考验期，但你的韧性足以撑过去。', tag: '🌬️ 风吹不折' },
  { level: '下签', poem: '蜀道之难，难于上青天。', meaning: '今天不必硬冲，退一步整理再出发。', tag: '⛰️ 蜀道难行' },
]

// ── AI 塔罗牌（大阿卡纳 22 张）──────────────────────────
export const TAROT_MAJOR = [
  { name: '愚者', num: 0, keyword: '新的开始', hint: '放下包袱，轻装出发' },
  { name: '魔术师', num: 1, keyword: '创造力', hint: '你拥有所需的全部工具' },
  { name: '女祭司', num: 2, keyword: '直觉', hint: '倾听内心的声音' },
  { name: '皇后', num: 3, keyword: '丰盛', hint: '滋养与成长正在发生' },
  { name: '皇帝', num: 4, keyword: '秩序', hint: '建立你的根基和规则' },
  { name: '教皇', num: 5, keyword: '指引', hint: '寻找值得信赖的导师或传统' },
  { name: '恋人', num: 6, keyword: '选择', hint: '忠于内心的选择' },
  { name: '战车', num: 7, keyword: '意志', hint: '驾驭方向，全力前行' },
  { name: '力量', num: 8, keyword: '柔韧', hint: '用温柔驾驭力量' },
  { name: '隐者', num: 9, keyword: '独处', hint: '向内探索的时光' },
  { name: '命运之轮', num: 10, keyword: '转机', hint: '变化的轮盘正在转动' },
  { name: '正义', num: 11, keyword: '平衡', hint: '因果自有其回响' },
  { name: '倒吊人', num: 12, keyword: '换位', hint: '换个角度看世界' },
  { name: '死神', num: 13, keyword: '蜕变', hint: '旧篇章结束，新篇章开启' },
  { name: '节制', num: 14, keyword: '调和', hint: '在两端之间找到平衡' },
  { name: '恶魔', num: 15, keyword: '束缚', hint: '看清什么在牵制你' },
  { name: '高塔', num: 16, keyword: '破旧', hint: '旧结构崩塌是为了重建' },
  { name: '星星', num: 17, keyword: '希望', hint: '黑暗中看到微光' },
  { name: '月亮', num: 18, keyword: '梦境', hint: '情绪和潜意识在说话' },
  { name: '太阳', num: 19, keyword: '光明', hint: '充满能量与快乐' },
  { name: '审判', num: 20, keyword: '觉醒', hint: '过去的努力正在被回应' },
  { name: '世界', num: 21, keyword: '圆满', hint: '一个周期的完成与收获' },
]

// ── 星座匹配度（基于元素相性）──────────────────────────
const ELEMENT_COMPAT = {
  '火火': 75, '火土': 55, '火风': 85, '火水': 45,
  '土土': 70, '土风': 55, '土水': 75,
  '风风': 70, '风水': 55,
  '水水': 80,
}
const ELEM_OF = Object.fromEntries(
  Object.entries(ZODIAC_DATA).map(([name, d]) => [name, d.element])
)

/** 两个星座的匹配度 + 文案 */
export function zodiacMatch(sign1, sign2) {
  const e1 = ELEM_OF[sign1] ?? '土'
  const e2 = ELEM_OF[sign2] ?? '土'
  const key = [e1, e2].sort().join('')
  const score = ELEMENT_COMPAT[key] ?? 65
  const desc = score >= 80
    ? `${sign1}与${sign2}的能量天然共振，像风遇上火一样彼此点燃。`
    : score >= 70
    ? `${sign1}和${sign2}同频但不完全相同，有默契也有新鲜感。`
    : score >= 60
    ? `${sign1}与${sign2}需要多一些磨合，但差异本身就是吸引力。`
    : `${sign1}和${sign2}像水和火，碰撞激烈但也能互相补足——关键是理解。`
  return { score, desc, elements: `${e1}×${e2}` }
}

// ── 伪随机种子 ──────────────────────────────────────────
function seededRandom(seed) {
  // xorshift32：轻量、可复现
  let s = seed | 0
  s = s ^ (s << 13); s = s ^ (s >>> 17); s = s ^ (s << 5)
  return ((s >>> 0) % 10000) / 10000
}

/** 字符串 → 种子 */
function hashStr(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h
}

// ── 每日能量签生成 ──────────────────────────────────────
export function generateDailyEnergy(profileId = '') {
  const seed = Math.abs(hashStr(todayKey() + profileId))
  let s = seed || 1
  const pick = (arr) => {
    s = s + 1; const r = seededRandom(s); return arr[Math.floor(r * arr.length)]
  }
  const kw = pick(ENERGY_KEYWORDS)
  const color = pick(LUCKY_COLORS)
  const num = Math.floor(seededRandom(s + 7) * 9) + 1
  const act1 = pick(SUITABLE_ACTIVITIES)
  let act2 = pick(SUITABLE_ACTIVITIES)
  if (act2 === act1) act2 = pick(SUITABLE_ACTIVITIES)
  const reminder = pick(REMINDERS)

  return {
    date: todayKey(),
    keyword: kw,
    luckyColor: color,
    luckyNumber: num,
    suitable: [act1, act2],
    reminder,
  }
}

// ── 抽签 ──────────────────────────────────────────────
export function drawFortuneStick(seedExtra = '') {
  const seed = Math.abs(hashStr(todayKey() + Date.now() + seedExtra))
  const stick = FORTUNE_STICKS[seededRandom(seed) * FORTUNE_STICKS.length | 0]
  return stick
}

// ── AI 塔罗三选一：抽 3 张牌 ────────────────────────────
export function drawTarotCards(count = 3) {
  const picked = new Set()
  const cards = []
  let seed = Math.abs(hashStr(todayKey() + 'tarot'))
  while (cards.length < count && picked.size < TAROT_MAJOR.length) {
    seed = seed + 1
    const idx = Math.floor(seededRandom(seed) * TAROT_MAJOR.length)
    if (!picked.has(idx)) {
      picked.add(idx)
      cards.push(TAROT_MAJOR[idx])
    }
  }
  return cards
}

// ── 幸运数字 ──────────────────────────────────────────
export function getLuckyNumber(profileId = '') {
  const seed = Math.abs(hashStr(todayKey() + profileId))
  const num = Math.floor(seededRandom(seed) * 9) + 1
  const meanings = {
    1: '独立·开创——今天的能量适合做第一个吃螃蟹的人',
    2: '合作·平衡——今天的能量适合与人连接',
    3: '表达·创造——今天的能量适合输出你的想法',
    4: '稳固·建造——今天的能量适合打地基',
    5: '变化·自由——今天的能量适合打破常规',
    6: '关爱·和谐——今天的能量适合照顾关系',
    7: '内省·探索——今天的能量适合深度思考',
    8: '丰盛·掌控——今天的能量适合处理实际事务',
    9: '圆满·收尾——今天的能量适合做一个了结',
  }
  return { number: num, meaning: meanings[num] }
}

// ── 星座检测：从用户文本中提取星座名 ──────────────────
export function detectStarSign(text) {
  for (const name of ZODIAC_NAMES) {
    if (text.includes(name)) return name
  }
  // 简称：天蝎→天蝎座
  const shortMap = { '白羊': '白羊座', '金牛': '金牛座', '双子': '双子座', '巨蟹': '巨蟹座', '狮子': '狮子座', '处女': '处女座', '天秤': '天秤座', '天蝎': '天蝎座', '射手': '射手座', '摩羯': '摩羯座', '水瓶': '水瓶座', '双鱼': '双鱼座' }
  for (const [short, full] of Object.entries(shortMap)) {
    if (text.includes(short)) return full
  }
  return null
}

// ── 生肖检测 ──────────────────────────────────────────
export function detectShengxiao(text) {
  // 支持 "属鼠" 和 "生肖鼠"
  for (const name of Object.keys(SHENGXIAO_DATA)) {
    if (text.includes('属' + name) || text.includes('生肖' + name)) return name
  }
  // 也支持单独提及 "我是鼠" "我属兔"
  for (const name of Object.keys(SHENGXIAO_DATA)) {
    if (text.includes(name) && (text.includes('属') || text.includes('生肖'))) return name
  }
  return null
}

// ── 心情测试题库 ──────────────────────────────────────
export const MOOD_QUIZZES = [
  {
    question: '如果今天是一种天气，你觉得你更像哪个？',
    options: [
      { text: '晴空万里', mood: '阳光', hint: '能量充沛，适合输出' },
      { text: '多云转晴', mood: '转好', hint: '在调整中，但方向对了' },
      { text: '细雨蒙蒙', mood: '柔软', hint: '需要安静和独处' },
      { text: '雷暴将至', mood: '蓄爆', hint: '有压力在积累，需要释放' },
    ],
  },
  {
    question: '如果今天你是一种动物，你会选择……',
    options: [
      { text: '展翅的鹰', mood: '高飞', hint: '想突破视野和格局' },
      { text: '晒太阳的猫', mood: '松弛', hint: '想享受当下' },
      { text: '奔跑的马', mood: '行动', hint: '想冲出去做点什么' },
      { text: '水里的鱼', mood: '流动', hint: '想顺着感觉走' },
    ],
  },
  {
    question: '此刻你最想拥有的超能力是？',
    options: [
      { text: '暂停时间', mood: '喘息', hint: '需要空间停下来' },
      { text: '读心术', mood: '好奇', hint: '想更懂身边的人' },
      { text: '瞬间移动', mood: '逃离', hint: '想换个环境' },
      { text: '预知未来', mood: '掌控', hint: '想要确定感' },
    ],
  },
]
