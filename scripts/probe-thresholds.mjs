// 统计若干矩形区域的「颜色距背景模型的距离」和「局部纹理度 σ」分布，
// 用来给抠图阈值找一个真正有余量的分界，而不是靠试。
import sharp from 'sharp'

const DEGREE = 4
const TERMS = []
for (let i = 0; i <= DEGREE; i++) for (let j = 0; i + j <= DEGREE; j++) TERMS.push([i, j])
const basis = (x, y) => TERMS.map(([i, j]) => x ** i * y ** j)

function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    if (Math.abs(M[c][c]) < 1e-12) continue
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]))
}

const file = process.argv[2] ?? 'assets/raw/frames/044.png'
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H, channels: C } = info
const nx = (x) => (x / (W - 1)) * 2 - 1
const ny = (y) => (y / (H - 1)) * 2 - 1

const K = TERMS.length
const coeffs = []
for (let ch = 0; ch < 3; ch++) {
  const A = Array.from({ length: K }, () => new Array(K).fill(0))
  const bv = new Array(K).fill(0)
  const add = (x, y) => {
    const v = data[(y * W + x) * C + ch]
    const f = basis(nx(x), ny(y))
    for (let i = 0; i < K; i++) { bv[i] += f[i] * v; for (let j = 0; j < K; j++) A[i][j] += f[i] * f[j] }
  }
  for (let y = 0; y < 14; y++) for (let x = 0; x < W; x += 2) { add(x, y); add(x, H - 1 - y) }
  for (let x = 0; x < 14; x++) for (let y = 14; y < H - 14; y += 2) { add(x, y); add(W - 1 - x, y) }
  for (let i = 0; i < K; i++) A[i][i] += 1e-6
  coeffs.push(solve(A, bv))
}
const bgAt = (x, y) => {
  const f = basis(nx(x), ny(y))
  return coeffs.map((c) => c.reduce((s, v, i) => s + v * f[i], 0))
}

const lumAt = (x, y) => {
  const p = (y * W + x) * C
  return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
}
const sigmaAt = (cx, cy, r = 3) => {
  let s = 0, s2 = 0, n = 0
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const v = lumAt(x, y); s += v; s2 += v * v; n++ }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2))
}
const distAt = (x, y) => {
  const p = (y * W + x) * C
  const b = bgAt(x, y)
  return Math.hypot(data[p] - b[0], data[p + 1] - b[1], data[p + 2] - b[2])
}

const boxes = [
  ['纯背景·上',        280, 30, 160, 40],
  ['纯背景·左',        30, 300, 40, 160],
  ['纯背景·耳间隙',    390, 175, 30, 25],
  ['头顶轮廓光(难)',   300, 196, 160, 14],
  ['右耳上缘(难)',     470, 168, 70, 16],
  ['头顶毛(正常)',     300, 230, 160, 30],
  ['槌头白球',         386, 462, 26, 22],
  ['脸颊',             280, 320, 60, 40],
]

console.log(`# ${file}`)
console.log('  区域                 dist(均/最小/最大)      σ(均/最小/最大)')
for (const [name, x0, y0, w, h] of boxes) {
  const ds = [], ss = []
  for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) { ds.push(distAt(x, y)); ss.push(sigmaAt(x, y)) }
  const st = (a) => `${(a.reduce((p, c) => p + c, 0) / a.length).toFixed(1)}/${Math.min(...a).toFixed(1)}/${Math.max(...a).toFixed(1)}`
  console.log(`  ${name.padEnd(18)} ${st(ds).padEnd(22)} ${st(ss)}`)
}
