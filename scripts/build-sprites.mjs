// 素材构建：把源视频的选定帧抠图后打包成一张精灵图 + 一份清单 JSON。
//
// 为什么用精灵图而不是逐帧 PNG：桌宠常驻运行，单张纹理只占一次 GPU 上传，
// 切帧只改 background-position，不触发解码，空闲时 CPU/GPU 开销接近 0。
//
// 帧的选取原则：
//   - 只用「干净帧」——源视频 idx 50~76 烤进了橙色「功德+1」，我们要自己随机 6 种奖励，不能用
//   - idx 46+ 木鱼上有金色火花，同样自己渲染，避免和随机奖励文案打架
//   - 抬槌过程压缩成 2 帧：点击反馈要快，源视频 20 帧的抬槌太拖沓
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { matte } from './matte.mjs'

const SRC = 'assets/raw/frames'
const OUT = 'assets/koala'

// [源帧序号, 语义名]。序号对应 ffmpeg 抽帧的 1-based 文件名。
const FRAMES = [
  [6, 'idle'],     // 静息：槌子搁在木鱼旁
  [21, 'raise1'],  // 抬槌中段
  [31, 'raise2'],  // 抬到最高
  [37, 'down1'],   // 落下
  [41, 'down2'],
  [44, 'hit'],     // 击中（与音频瞬态 1.80s 对齐）
  [45, 'settle1'], // 回弹。到此为止——源视频 046 起木鱼上有烤进去的金色火花，
                   // 而我们要自己渲染 6 种随机奖励特效，用了会打架
]

const TARGET_H = 440 // 2x 视网膜，显示时按 220px 高
const PAD = 6 // 包围盒外留一点余量，避免缩放时边缘被切

mkdirSync(OUT, { recursive: true })

console.log('抠图中…')
const mattes = []
for (const [n, name] of FRAMES) {
  const file = `${SRC}/${String(n).padStart(3, '0')}.png`
  const m = await matte(file)
  mattes.push({ name, ...m })
  console.log(`  ${name.padEnd(8)} ${file}  bbox=${m.bbox.minX},${m.bbox.minY}–${m.bbox.maxX},${m.bbox.maxY}`)
}

// 关键：所有帧共用同一个包围盒。各帧单独裁剪会让考拉在动画里抖动。
const W0 = mattes[0].W, H0 = mattes[0].H
const box = mattes.reduce(
  (a, m) => ({
    minX: Math.min(a.minX, m.bbox.minX), minY: Math.min(a.minY, m.bbox.minY),
    maxX: Math.max(a.maxX, m.bbox.maxX), maxY: Math.max(a.maxY, m.bbox.maxY),
  }),
  { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 }
)
const left = Math.max(0, box.minX - PAD)
const top = Math.max(0, box.minY - PAD)
const width = Math.min(W0 - left, box.maxX - box.minX + 1 + PAD * 2)
const height = Math.min(H0 - top, box.maxY - box.minY + 1 + PAD * 2)
const fw = Math.round((width / height) * TARGET_H)
console.log(`\n统一包围盒: ${left},${top} ${width}x${height}  →  单帧 ${fw}x${TARGET_H}`)

const tiles = []
for (const m of mattes) {
  const buf = await sharp(m.rgba, { raw: { width: m.W, height: m.H, channels: 4 } })
    .extract({ left, top, width, height })
    .resize(fw, TARGET_H, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer()
  tiles.push(buf)
  await sharp(buf).toFile(`${OUT}/${m.name}.png`)
}

// 横向排成一行精灵图
await sharp({ create: { width: fw * tiles.length, height: TARGET_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(tiles.map((input, i) => ({ input, left: i * fw, top: 0 })))
  .png({ compressionLevel: 9 })
  .toFile(`${OUT}/koala-sprite.png`)

const manifest = {
  sprite: 'koala-sprite.png',
  frameWidth: fw,
  frameHeight: TARGET_H,
  scale: 0.5, // 显示尺寸 = 像素尺寸 × scale（2x 视网膜素材）
  frames: FRAMES.map(([, name], i) => ({ name, index: i })),
  // 点击一次的播放序列：[帧名, 停留毫秒]。总时长 ~400ms，击中在 ~180ms，符合点击反馈的手感窗口。
  strike: [
    ['raise1', 45], ['raise2', 50], ['down1', 45], ['down2', 40],
    ['hit', 100], ['settle1', 120],
  ],
  idle: 'idle',
}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2))

console.log(`\n输出到 ${OUT}/`)
console.log(`  koala-sprite.png  ${fw * tiles.length}x${TARGET_H}`)
console.log(`  manifest.json`)
console.log(`  ${FRAMES.length} 张单帧 PNG`)
