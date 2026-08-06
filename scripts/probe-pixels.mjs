// 像素探针：把一帧降成 32x32 亮度网格打印出来，看清背景/主体/阴影的真实数值分布。
import sharp from 'sharp'

const file = process.argv[2] ?? 'assets/raw/frames/006.png'
const N = 32
const { data, info } = await sharp(file)
  .resize(N, N, { kernel: 'nearest' })
  .raw()
  .toBuffer({ resolveWithObject: true })
const C = info.channels

const lum = []
for (let y = 0; y < N; y++) {
  const row = []
  for (let x = 0; x < N; x++) {
    const p = (y * N + x) * C
    row.push(Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]))
  }
  lum.push(row)
}

// 亮度分档字符图
const ch = (v) => (v >= 245 ? '·' : v >= 236 ? ':' : v >= 228 ? '+' : v >= 210 ? 'o' : v >= 180 ? 'O' : v >= 140 ? '#' : v >= 90 ? '@' : 'M')
console.log(`# ${file}  (· ≥245  : 236-244  + 228-235  o 210-227  O 180-209  # 140-179  @ 90-139  M <90)`)
console.log('    ' + Array.from({ length: N }, (_, i) => String(i % 10)).join(''))
lum.forEach((row, y) => console.log(String(y).padStart(3) + ' ' + row.map(ch).join('')))

// 四角背景实测值（原图分辨率）
const raw = await sharp(file).raw().toBuffer({ resolveWithObject: true })
const W = raw.info.width, H = raw.info.height, RC = raw.info.channels
const at = (x, y) => {
  const p = (y * W + x) * RC
  return [raw.data[p], raw.data[p + 1], raw.data[p + 2]]
}
console.log('\n背景采样 (RGB):')
for (const [name, x, y] of [['左上', 8, 8], ['右上', W - 9, 8], ['左中', 8, H >> 1], ['右中', W - 9, H >> 1], ['左下', 8, H - 9], ['右下', W - 9, H - 9], ['正上中', W >> 1, 6]]) {
  console.log(' ', name.padEnd(4), at(x, y).join(','))
}
console.log('\n全图亮度直方图（16 档）:')
const hist = new Array(16).fill(0)
for (let i = 0; i < raw.data.length; i += RC) {
  const v = 0.299 * raw.data[i] + 0.587 * raw.data[i + 1] + 0.114 * raw.data[i + 2]
  hist[Math.min(15, v >> 4)]++
}
hist.forEach((n, i) => console.log(`  ${String(i * 16).padStart(3)}-${String(i * 16 + 15).padStart(3)}: ${String(n).padStart(7)} ${'█'.repeat(Math.round((n / (W * H)) * 120))}`))
