// 采样关键点的真实 RGB，判断「背景 vs 奶白色主体」能否靠色度分离。
import sharp from 'sharp'

const file = process.argv[2] ?? 'assets/raw/frames/044.png'
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
const { width: W, channels: C } = info

// 取 r 半径方块的均值，避免单像素噪声
const patch = (cx, cy, r = 5) => {
  let R = 0, G = 0, B = 0, n = 0
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const p = (y * W + x) * C
      R += data[p]; G += data[p + 1]; B += data[p + 2]; n++
    }
  return [R / n, G / n, B / n].map((v) => Math.round(v))
}

const pts = [
  ['背景·左上', 60, 60], ['背景·右上', 660, 60], ['背景·正上', 360, 40],
  ['背景·左耳旁', 100, 250], ['背景·右耳旁', 620, 250], ['背景·左下', 60, 660],
  ['左耳内侧(奶白)', 178, 250], ['右耳内侧(奶白)', 520, 255],
  ['头顶灰毛', 355, 215], ['脸颊灰', 300, 330],
  ['槌头白球', 462, 424], ['木鱼棕', 430, 545],
  ['袈裟蓝', 250, 470], ['地面阴影', 300, 672], ['坐垫', 420, 640],
]

console.log(`# ${file}`)
console.log('  点位              R,G,B          亮度   R-B(暖度)')
for (const [name, x, y] of pts) {
  const [r, g, b] = patch(x, y)
  const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  console.log(`  ${name.padEnd(16)} ${String(r).padStart(3)},${String(g).padStart(3)},${String(b).padStart(3)}   ${String(lum).padStart(4)}   ${String(r - b).padStart(4)}`)
}
