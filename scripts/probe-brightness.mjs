// 决定性测量：主体像素相对背景模型的「亮度差」分布。
// 若考拉全身都比背景暗，就能用「比背景模型亮 → 判为背景」这条规则一次性干掉轮廓辉光。
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
const modelLum = (x, y) => {
  const f = basis(nx(x), ny(y))
  const c = coeffs.map((cf) => cf.reduce((s, v, i) => s + v * f[i], 0))
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
}

// 手工框出「肯定是考拉」的区域，统计其 lum − modelLum
const subjectBoxes = [
  ['头顶绒毛', 260, 200, 200, 40],
  ['左耳', 140, 200, 90, 110],
  ['右耳', 450, 190, 100, 110],
  ['脸', 260, 280, 190, 90],
  ['袈裟', 200, 430, 90, 120],
  ['槌头白球', 380, 455, 30, 26],
  ['木鱼', 380, 520, 110, 70],
  ['坐垫', 330, 620, 160, 50],
]
console.log(`# ${file}   （负值 = 比背景模型暗）`)
console.log('  区域            lum−model  均 / 最小 / 最大      比模型亮的像素占比')
for (const [name, x0, y0, w, h] of subjectBoxes) {
  const d = []
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const p = (y * W + x) * C
    d.push(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] - modelLum(x, y))
  }
  const mean = d.reduce((a, b) => a + b, 0) / d.length
  const brighter = d.filter((v) => v > 0).length / d.length
  console.log(`  ${name.padEnd(12)} ${mean.toFixed(1).padStart(8)} / ${Math.min(...d).toFixed(1).padStart(7)} / ${Math.max(...d).toFixed(1).padStart(6)}   ${(brighter * 100).toFixed(2)}%`)
}

// 辉光区（紧贴头顶轮廓之外）
const glowBoxes = [['头顶外辉光', 260, 160, 200, 25], ['右肩外辉光', 570, 380, 40, 140], ['左肩外辉光', 120, 400, 40, 140]]
console.log('\n  辉光区')
for (const [name, x0, y0, w, h] of glowBoxes) {
  const d = []
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const p = (y * W + x) * C
    d.push(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] - modelLum(x, y))
  }
  const mean = d.reduce((a, b) => a + b, 0) / d.length
  console.log(`  ${name.padEnd(12)} ${mean.toFixed(1).padStart(8)} / ${Math.min(...d).toFixed(1).padStart(7)} / ${Math.max(...d).toFixed(1).padStart(6)}`)
}
