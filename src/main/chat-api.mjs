// DeepSeek API 代理：主进程持有 key，渲染进程只发消息和收回复。
// 不把 API key 暴露给渲染进程——那是用户态代码，CSP 阻止不了 devtools 读内存。
import { ZODIAC_DATA, SHENGXIAO_DATA } from '../shared/fortune.mjs'

const BASE = 'https://api.deepseek.com/v1'

/**
 * 功德考拉系统提示词——多模式玄学陪伴系统。
 * 人设：懂传统文化的年轻玄学顾问 + 温暖陪伴型朋友。
 */
const SYSTEM_PROMPT = `# 你是「功德考拉」🐨

一只会敲木鱼的 AI 桌宠，也是用户的玄学陪伴好友。

## 你的人设
你不是传统算命先生。你是一个「懂传统文化的年轻玄学顾问 + 温暖陪伴型朋友」。
- 语气轻松有趣，像朋友聊天，偶尔毒舌但永远站在用户这边
- 有一点神秘感，但不故弄玄虚、不吓人
- 多用比喻和故事化表达，少用生硬的专业术语
- 适当用 🐨✨🔮🍃🍀，一句最多一两个，别堆砌
- 永远不自称 AI / 语言模型 / 助手，你是考拉

## 不好的表达 vs 好的表达
❌ "你的命局火旺，木弱，因此今年事业受阻。"
✅ "从传统命理角度看，你的能量更偏向行动和创造，但容易因为节奏过快忽略休息。今年可以尝试给自己留一些调整空间。"

❌ "你今天一定会遇到贵人。"
✅ "今天的人际能量不错，保持开放，也许会有意外的连接。"

❌ "你命中注定财运不佳。"
✅ "从五行分布看，你的财富能量更偏向稳健积累，不太适合冒险投机。"

## 你的两种玄学模式

### 模式 A：八字命理分析
当对话包含 [用户命盘] 区块时，你在做八字分析。
分析角度：五行分布、性格特点、优势与潜在挑战、事业方向、财运趋势、感情倾向、近期运势建议。
输出用「修行报告」结构（下方有模板）。具体用"今日/本月/今年/这段时间"哪个时间维度，由用户问题里的时间词决定。
铁律：不脱离命盘自由发挥、不编造干支五行、不用"一定""必然""必定"等绝对化词语。

### 模式 B：轻量玄学聊天
当对话包含 [星座档案] 区块时（用户提到了某个星座但没给出生信息），你在做轻量星座聊天。
- 基于该星座的元素、守护星、特质给有趣有陪伴感的回答
- 可以聊运势、适合的工作、感情倾向、幸运元素
- 支持连续对话：用户说"我是天蝎座"→你回应并追问方向→用户说"事业"→继续展开
- 这不是算命，是结合星座文化的娱乐陪伴

### 普通闲聊
不涉及玄学时，做朋友式陪伴。先共情再鼓励，别急着给建议。

## 修行报告模板（模式 A 用）
用户问的是哪个时间段，就用哪个时间段来组织标题。比如：
- 用户问「今天/今日运势」→ 用「今日关键词」「今日气场」「今日幸运」
- 用户问「本月/八月运势」→ 用「本月关键词」「本月气场」「本月幸运」
- 用户问「今年/明年运势」→ 用「今年关键词」「今年气场」「今年幸运」
- 用户没明确时间 → 用「这段时间关键词」「这段时间气场」「这段时间幸运」

关键词：（2-4字概括状态）

🪵 气场：
结合命盘解释整体状态，说明"为什么"。

工作修行：
结合现代生活场景给建议。

财富能量：
娱乐性质分析，不预测具体财富。

情绪状态：
关注压力、动力、关系，像朋友一样给建议。

幸运指引：
- 幸运行动：（一个可做的小动作）
- 幸运物品：（随身小物）

最后用考拉口吻收尾，时间词要和用户的问题一致。例如用户问今天就说"今天的木鱼已经帮你敲响啦"，问八月就说"这个八月的木鱼已经帮你敲响啦"。

## 塔罗牌解读
当对话包含 [塔罗牌] 区块时，为用户解读这张牌在当下的含义。
- 结合牌的关键词和提示，用故事化的方式解读
- 不制造恐惧（即便抽到死神、高塔等牌，要强调蜕变和新生的正面意义）
- 让解读有仪式感和神秘感，但落脚点温暖

## 抽签解读
当对话包含 [抽签结果] 区块时，用考拉的口吻帮用户解读这根签。
- 把诗句翻译成现代生活语言
- 结合签的等级（上上签/上签/中签/下签）调整语气
- 下签也要给出温暖的角度，不制造恐惧

## 铁律（所有模式通用）
- 不说"一定会发财""马上遇到贵人""今年必定成功"
- 不制造恐惧、焦虑或宿命感
- 明确这是传统文化解读+娱乐参考，不是命运预言
- 没有命盘时问玄学运势：温柔地请用户提供出生信息
- 有命盘时优先基于命盘数据，不编造
- 每条回复让人感觉「被听到了」「被陪伴了」`

/**
 * 发送聊天请求到 DeepSeek。
 * @param {Array<{role:string, content:string}>} messages - 完整对话历史
 * @param {string} apiKey
 * @returns {Promise<string>} 纯文本回复
 */
const CHAT_TIMEOUT_MS = 25000 // 25 秒：超过则视为超时，避免窗口长期无响应

export async function chat(messages, apiKey) {
  if (!apiKey) return '🔑 还没有设置 API Key，请在设置中填入 DeepSeek API Key。'

  const body = {
    // deepseek-v4-flash 是推理模型，常把全部 max_tokens 用于内部 reasoning
    // 导致 content 为空（finish_reason=length）。deepseek-chat 是通用对话模型，
    // 响应更稳定，不会出现花掉全部额度却不说话的情况。
    model: 'deepseek-chat',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    temperature: 0.85,
    max_tokens: 1200,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      if (res.status === 401) return '🔑 API Key 无效，请检查设置。'
      if (res.status === 429) return '⏳ 聊太快了，等我喘口气…（被限流了，稍等几秒再试）'
      if (res.status === 503) {
        return '⏳ DeepSeek 服务器现在忙到冒烟了（503）…\n这不是你的 Key 错了，也不是考拉坏了。官方建议可以临时换一家模型服务，或者等 30 秒再敲我一下～🐨'
      }
      const msg = err.error?.message ?? '未知错误'
      return `😵 服务器开小差了（${res.status}）：${msg}\n等我揉揉眼睛，过会儿再试？`
    }

    const data = await res.json()
    const message = data.choices?.[0]?.message
    const content = message?.content?.trim()
    // 推理模型可能把额度全花在 reasoning_content 上，导致 content 为空。
    // 如果 content 为空但 reasoning_content 有内容，把它整理后返回，避免完全没声音。
    const reasoning = message?.reasoning_content?.trim()
    if (!content && reasoning) {
      return `🐨 我脑子里转了好几圈，先用最简洁的话说给你听：\n\n${reasoning}`
    }
    if (!content) return '（考拉打了个盹，没听清…再说一次？）🐨'
    return content
  } catch (err) {
    if (err.name === 'AbortError') {
      return '⏳ 等了好久都没收到回复，可能是网络有点卡或者模型服务太忙了。\n你可以再试一次，或者稍等会儿再来找我～🐨'
    }
    return `❌ 请求出错了：${err.message}\n等我揉揉眼睛，过会儿再试？`
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 构建星座档案区块（模式 B 用）。
 * @param {string} sign 星座名
 * @returns {string} 注入到对话中的星座上下文
 */
export function buildZodiacBlock(sign) {
  const d = ZODIAC_DATA[sign]
  if (!d) return ''
  return `[星座档案 · ${sign}]
元素：${d.element}
守护星：${d.planet}
特质：${d.traits}
关键词：${d.keywords}`
}

/**
 * 构建生肖档案区块。
 */
export function buildShengxiaoBlock(animal) {
  const d = SHENGXIAO_DATA[animal]
  if (!d) return ''
  return `[生肖档案 · ${animal}]
特质：${d.traits}
五行：${d.element}`
}

/**
 * 构建塔罗牌区块。
 */
export function buildTarotBlock(card) {
  return `[塔罗牌]
牌名：${card.name}（${card.num}号）
关键词：${card.keyword}
提示：${card.hint}`
}

/**
 * 构建抽签区块。
 */
export function buildFortuneBlock(stick) {
  return `[抽签结果]
等级：${stick.level}
诗句：${stick.poem}
含义：${stick.meaning}
标签：${stick.tag}`
}

/**
 * 构建每日能量签区块。
 */
export function buildEnergyBlock(energy) {
  return `[今日能量签 · ${energy.date}]
关键词：${energy.keyword}
幸运颜色：${energy.luckyColor.name}（${energy.luckyColor.desc}）
幸运数字：${energy.luckyNumber}
适合做的事：${energy.suitable.join('；')}
今日提醒：${energy.reminder}`
}

/**
 * 解析用户消息中的出生信息，返回八字排盘需要的字段。
 * 用正则而不是调 AI（八字排盘是确定性的数学，不该花钱算）。
 *
 * 防御性设计：
 * - 年份合理性：排除近 3 年（当前 2026 → 拒绝 2024+），避免"2024年8月运势"被误当成出生年份
 * - 性别检测收紧：只匹配「男命/女命」或独立位置的「男/女」，不匹配「男朋友」里的"男"
 */
export function extractBirthInfo(text) {
  const result = {}

  // 年份：2000, 1990, 88年, 1988
  const y4 = text.match(/(?:19|20)\d{2}/)
  if (y4) {
    const yr = parseInt(y4[0])
    // 排除近 3 年：这些几乎肯定是"2024年运势"而非出生年份
    const maxBirthYear = new Date().getFullYear() - 3
    if (yr <= maxBirthYear) result.year = yr
  }
  if (!result.year) {
    // 两位年份（如「88年」）→ 19xx；避免被 parseInt("88年") 误算成公元 88 年
    const y2 = text.match(/(\d{2})\s*年/)
    if (y2) {
      const yr = 1900 + parseInt(y2[1])
      const maxBirthYear = new Date().getFullYear() - 3
      if (yr <= maxBirthYear) result.year = yr
    }
  }

  // 月份
  const monthM = text.match(/(\d{1,2})\s*(?:月)/)
  if (monthM) result.month = parseInt(monthM[1])

  // 日期
  const dayM = text.match(/(\d{1,2})\s*(?:日|号)/)
  if (dayM) result.day = parseInt(dayM[1])

  // 时辰：先匹配传统时辰名，再匹配常用时段口语，最后匹配具体时间
  if (/子时|0[：:]00|半夜|凌晨0/.test(text)) result.hour = 0
  else if (/丑时|1[：:]00|凌晨1/.test(text)) result.hour = 1
  else if (/寅时|3[：:]00|凌晨3/.test(text)) result.hour = 3
  else if (/卯时|5[：:]00|清晨5|早上5/.test(text)) result.hour = 5
  else if (/辰时|7[：:]00|早上7/.test(text)) result.hour = 7
  else if (/巳时|9[：:]00|上午9/.test(text)) result.hour = 9
  else if (/午时|11[：:]00|中午/.test(text)) result.hour = 11
  else if (/未时|13[：:]00|下午1/.test(text)) result.hour = 13
  else if (/申时|15[：:]00|下午3/.test(text)) result.hour = 15
  else if (/酉时|17[：:]00|傍晚5|下午5/.test(text)) result.hour = 17
  else if (/戌时|19[：:]00|晚上7/.test(text)) result.hour = 19
  else if (/亥时|21[：:]00|晚上9/.test(text)) result.hour = 21
  // 口语化时段补全
  else if (/中午|早上|上午|下午|傍晚|晚上|凌晨/.test(text)) {
    const tm = text.match(/(\d{1,2})\s*[点时：:]/)
    if (tm) result.hour = parseInt(tm[1])
  }
  const hourM = text.match(/(\d{1,2})\s*[点时：:]/)
  if (!result.hour && hourM) result.hour = parseInt(hourM[1])

  // 性别：只匹配「男命/女命」「性别男/女」或独立位置的「男/女」
  // 不匹配「男朋友」「女士优先」等复合词中的"男/女"
  if (/男命|性别[为是]?\s*男|(?:^|[\s，。,.\n])男(?:[\s，。,.\n]|$)/.test(text)) result.gender = 'male'
  else if (/女命|性别[为是]?\s*女|(?:^|[\s，。,.\n])女(?:[\s，。,.\n]|$)/.test(text)) result.gender = 'female'

  // 出生地点（可选）
  const placeM = text.match(/(?:出生|生在|老家|籍贯)[在於]?\s*([\u4e00-\u9fff]{2,6})/)
  if (placeM) result.birthplace = placeM[1]

  return result
}
