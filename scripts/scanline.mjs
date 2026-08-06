// 扫描线探针：沿一行/一列打印像素值，用来看清主体边缘外的「光晕」到底有多亮多宽。
import sharp from 'sharp'

const file = process.argv[2] ?? 'assets/raw/frames/044.png'
const axis = process.argv[3] ?? 'row'
const at = Number(process.argv[4] ?? 250)
const from = Number(process.argv[5] ?? 80)
const to = Number(process.argv[6] ?? 220)

const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
const { width: W, channels: C } = info
const px = (x, y) => {
  const p = (y * W + x) * C
  return [data[p], data[p + 1], data[p + 2]]
}

console.log(`# ${file}  ${axis}=${at}  ${from}..${to}`)
console.log('  pos    R,G,B        亮度  色度')
for (let v = from; v <= to; v++) {
  const [r, g, b] = axis === 'row' ? px(v, at) : px(at, v)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b).toFixed(0)
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  const bar = '█'.repeat(Math.max(0, Math.round((lum - 100) / 4)))
  console.log(`  ${String(v).padStart(4)}  ${String(r).padStart(3)},${String(g).padStart(3)},${String(b).padStart(3)}  ${String(lum).padStart(4)}  ${String(chroma).padStart(3)} ${bar}`)
}
