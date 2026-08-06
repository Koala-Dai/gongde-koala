// 帧分析：找出「烤进画面的橙色文字/特效」区间，以及每帧相对上一帧的运动量。
// 用途：挑选干净的敲击动画区间（不含 AI 生成的 功德+1 文字）。
import sharp from 'sharp'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../assets/raw/frames/', import.meta.url).pathname
const files = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()

// 橙色文字判定：暖橙 (#e8921f 附近)，饱和度高，明显偏红
const isOrange = (r, g, b) => r > 175 && g > 80 && g < 185 && b < 120 && r - b > 80

let prevGray = null
const rows = []

for (const [i, f] of files.entries()) {
  const img = sharp(join(DIR, f))
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info

  let orangeTop = 0 // 上 40% 区域的橙色像素数（文字区）
  let orangeAll = 0
  const topLimit = Math.floor(H * 0.4)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * C
      if (isOrange(data[p], data[p + 1], data[p + 2])) {
        orangeAll++
        if (y < topLimit) orangeTop++
      }
    }
  }

  // 运动量：降采样灰度图的平均绝对差
  const gray = await sharp(join(DIR, f)).resize(72, 72).greyscale().raw().toBuffer()
  let motion = 0
  if (prevGray) {
    for (let k = 0; k < gray.length; k++) motion += Math.abs(gray[k] - prevGray[k])
    motion /= gray.length
  }
  prevGray = gray

  rows.push({ i, f, orangeTop, orangeAll, motion: +motion.toFixed(2) })
}

console.log('idx frame    orangeTop orangeAll motion')
for (const r of rows) {
  const flag = r.orangeTop > 300 ? ' <<TEXT' : ''
  console.log(
    String(r.i).padStart(3),
    r.f.padEnd(9),
    String(r.orangeTop).padStart(8),
    String(r.orangeAll).padStart(9),
    String(r.motion).padStart(6),
    flag
  )
}

const textFrames = rows.filter((r) => r.orangeTop > 300).map((r) => r.i)
const clean = rows.filter((r) => r.orangeTop <= 300).map((r) => r.i)
console.log('\n有文字的帧:', textFrames.length ? `${textFrames[0]}–${textFrames.at(-1)} (${textFrames.length}帧)` : '无')
console.log('干净帧区间:', clean.length ? `${clean[0]}–${clean.at(-1)}` : '无')
const peak = rows.reduce((a, b) => (b.motion > a.motion ? b : a))
console.log('运动峰值帧:', peak.i, '(motion', peak.motion, ')')
