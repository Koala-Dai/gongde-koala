// 抠图管线：把 720x720 的视频帧从中灰渐变背景中抠出来，输出带真 alpha 的 PNG。
//
// 思路（针对「平光影棚背景」的标准做法）：
//   1. 用边框一圈像素做二次多项式最小二乘拟合，得到平滑背景模型 B(x,y)——因为背景是渐变而非纯色
//   2. 背景判定 = 「接近 B」 或 「中性且略暗于 B」（后者吃掉地面投影）
//   3. 从四边种子做洪水填充，只有和边框连通的才算背景（防止把主体内部的浅色误伤）
//   4. 边缘按距离做 soft alpha 过渡，消除锯齿
//   5. 只保留最大连通前景块 —— 顺手干掉右下角水印和飘散的火花
import sharp from 'sharp'

/** 多项式基函数，坐标归一化到 [-1,1]（居中可改善数值条件）。degree=4 → 15 项 */
const DEGREE = 4
const TERMS = []
for (let i = 0; i <= DEGREE; i++) for (let j = 0; i + j <= DEGREE; j++) TERMS.push([i, j])
const basis = (x, y) => TERMS.map(([i, j]) => x ** i * y ** j)

/** 高斯消元解 n×n 线性方程组 */
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

/**
 * 局部标准差（纹理度）图。用积分图做 O(1) 窗口求和。
 * 关键判据：影棚背景是完全光滑的渐变（σ≈0~2），而考拉的毛发/织物有纹理（σ≫2）。
 * 这让「浅色但有毛」的头顶绒毛能和「浅色且光滑」的背景区分开——纯颜色阈值做不到。
 */
function localSigma(data, W, H, C, radius = 3) {
  const N = W * H
  const S = new Float64Array((W + 1) * (H + 1))
  const S2 = new Float64Array((W + 1) * (H + 1))
  const rowW = W + 1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * C
      const v = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
      const i = (y + 1) * rowW + (x + 1)
      S[i] = v + S[i - 1] + S[i - rowW] - S[i - rowW - 1]
      S2[i] = v * v + S2[i - 1] + S2[i - rowW] - S2[i - rowW - 1]
    }
  }
  const box = (T, x0, y0, x1, y1) =>
    T[(y1 + 1) * rowW + (x1 + 1)] - T[y0 * rowW + (x1 + 1)] - T[(y1 + 1) * rowW + x0] + T[y0 * rowW + x0]

  const sigma = new Float32Array(N)
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(H - 1, y + radius)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(W - 1, x + radius)
      const n = (x1 - x0 + 1) * (y1 - y0 + 1)
      const m = box(S, x0, y0, x1, y1) / n
      const v = box(S2, x0, y0, x1, y1) / n - m * m
      sigma[y * W + x] = Math.sqrt(Math.max(0, v))
    }
  }
  return sigma
}

/**
 * 二值掩膜腐蚀 / 膨胀（4 邻域，迭代 n 次）。
 * 越界像素的取值必须按操作区分：腐蚀时当 1（否则整圈边框被啃掉），膨胀时当 0（否则整圈边框被点亮）。
 */
function morph(mask, W, H, n, mode) {
  const oob = mode === 'erode' ? 1 : 0
  let cur = mask
  for (let it = 0; it < n; it++) {
    const next = new Uint8Array(cur)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const nb = [
          x > 0 ? cur[i - 1] : oob,
          x < W - 1 ? cur[i + 1] : oob,
          y > 0 ? cur[i - W] : oob,
          y < H - 1 ? cur[i + W] : oob,
        ]
        if (mode === 'erode') {
          if (cur[i] && nb.some((v) => !v)) next[i] = 0
        } else if (!cur[i] && nb.some((v) => v)) next[i] = 1
      }
    }
    cur = next
  }
  return cur
}

/** 用边框 ring 像素拟合背景模型，返回 (x,y) -> [r,g,b] */
function fitBackground(data, W, H, C, ring = 14) {
  const K = TERMS.length
  const nx = (x) => (x / (W - 1)) * 2 - 1
  const ny = (y) => (y / (H - 1)) * 2 - 1
  const coeffs = []
  for (let ch = 0; ch < 3; ch++) {
    const A = Array.from({ length: K }, () => new Array(K).fill(0))
    const bv = new Array(K).fill(0)
    const add = (x, y) => {
      const v = data[(y * W + x) * C + ch]
      const f = basis(nx(x), ny(y))
      for (let i = 0; i < K; i++) {
        bv[i] += f[i] * v
        for (let j = 0; j < K; j++) A[i][j] += f[i] * f[j]
      }
    }
    for (let y = 0; y < ring; y++) for (let x = 0; x < W; x += 2) { add(x, y); add(x, H - 1 - y) }
    for (let x = 0; x < ring; x++) for (let y = ring; y < H - ring; y += 2) { add(x, y); add(W - 1 - x, y) }
    for (let i = 0; i < K; i++) A[i][i] += 1e-6 // 岭正则，防止病态
    coeffs.push(solve(A, bv))
  }
  return (x, y) => {
    const f = basis(nx(x), ny(y))
    return coeffs.map((c) => {
      let s = 0
      for (let i = 0; i < K; i++) s += c[i] * f[i]
      return s
    })
  }
}

/**
 * @param {string} file 输入帧
 * @param {object} opt
 *   nearT   距背景模型多近算纯背景（全透明）
 *   farT    距背景模型多远算纯主体（全不透明），中间做 soft alpha
 *   sigmaNear/sigmaFar 局部纹理度的对应阈值（背景光滑 σ≈0~2，毛发 σ≫2）
 *   shadowLum 投影判定：亮度 ≥ 背景亮度 × 此比例 且 中性色 → 当背景吃掉
 *   shadowChroma 投影判定的最大色度偏移
 *   shadowZone 投影判定只在画面下方这个比例以下生效
 *   regularizeSigma alpha 正则化的模糊半径（越大越能吞掉小点/补上小缺口，也越会磨平真实细节）
 *   edgeSigma  最终边缘抗锯齿的模糊半径
 *   chokeGain 收边强度，越大低 alpha 被压得越狠
 */
export async function matte(file, opt = {}) {
  const {
    nearT = 16, farT = 32, sigmaNear = 2.2, sigmaFar = 4.6,
    shadowLum = 0.7, shadowChroma = 14, shadowZone = 0.75, glowT = 2,
    regularizeSigma = 1.8, edgeSigma = 0.9, binT = 140, chokePx = 2, chokeGain = 0.05, coreT = 0.72, feather = 4,
    openRadius = 3, wipeWatermark = true,
  } = opt

  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const bg = fitBackground(data, W, H, C)
  const sigma = localSigma(data, W, H, C)

  // 预算每像素：到背景模型的距离 dist，以及是否「中性暗块（投影）」
  const N = W * H
  const dist = new Float32Array(N)
  const overBright = new Float32Array(N) // 像素亮度 − 背景模型亮度
  const shadowish = new Uint8Array(N)
  const shadowY = Math.floor(H * shadowZone) // 投影只可能出现在画面底部
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const p = i * C
      const r = data[p], g = data[p + 1], b = data[p + 2]
      const [br, bgc, bb] = bg(x, y)
      dist[i] = Math.sqrt((r - br) ** 2 + (g - bgc) ** 2 + (b - bb) ** 2)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const blum = 0.299 * br + 0.587 * bgc + 0.114 * bb
      overBright[i] = lum - blum
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      // 投影：位于底部 + 中性灰 + 比背景暗但没暗太多。
      // 空间约束很关键：头顶绒毛/槌头白球同样是「浅色中性灰」，不加约束会被误判成投影抠掉。
      shadowish[i] =
        y >= shadowY && chroma <= shadowChroma && lum <= blum && lum >= blum * shadowLum ? 1 : 0
    }
  }

  // 前景得分 = 颜色证据 与 纹理证据 取最大值（任一条成立就算主体）。
  //
  // 颜色证据有一条硬约束：实测考拉全身都比背景模型暗（脸 −78、木鱼 −105、坐垫 −130，
  // 亮于模型的像素不到 1%），而源视频角色轮廓外那圈辉光均匀地亮 +3～+13。
  // 所以「比背景亮」直接判为背景，一次性切掉辉光——不用再靠调阈值去猜边界在哪。
  // 唯一比背景亮的主体部件是槌头白球的高光（+39），但它有强纹理（σ≈9.3），
  // 而辉光是完全光滑的（σ<1.2），会被纹理证据救回来。
  const score = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const byColor = overBright[i] > glowT ? -1 : (dist[i] - nearT) / (farT - nearT)
    const byTexture = (sigma[i] - sigmaNear) / (sigmaFar - sigmaNear)
    score[i] = Math.max(byColor, byTexture)
  }

  // 水印在右下角，先当成背景抹掉
  const wmX0 = Math.floor(W * 0.78), wmY0 = Math.floor(H * 0.93)
  const inWatermark = (x, y) => wipeWatermark && x >= wmX0 && y >= wmY0

  // 从四边种子洪水填充出「连通背景」。
  // 投影不再附加纹理条件：投影区亮度接近背景（≥0.7×）且中性灰，而考拉在底部的部件
  // 要么很暗（坐垫/袈裟）要么偏暖（脚掌 chroma≈41），都不会命中投影判定。
  const isBg = (i, x, y) => inWatermark(x, y) || score[i] <= 0 || shadowish[i]

  const rawBg = new Uint8Array(N)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; rawBg[i] = isBg(i, x, y) ? 1 : 0 }

  // 开运算：先腐蚀断掉细窄渗漏通道，洪水填充后再膨胀回来并与原掩膜取交。
  // 不做这步的话，主体轮廓上一两像素宽的浅色缝隙会让填充灌进头顶绒毛里，啃出弧形缺口。
  const eroded = morph(rawBg, W, H, openRadius, 'erode')

  const bgMask = new Uint8Array(N)
  const stack = []
  const push = (x, y) => {
    const i = y * W + x
    if (!bgMask[i] && eroded[i]) { bgMask[i] = 1; stack.push(i) }
  }
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1) }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y) }
  while (stack.length) {
    const i = stack.pop()
    const x = i % W, y = (i / W) | 0
    if (x > 0) push(x - 1, y)
    if (x < W - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < H - 1) push(x, y + 1)
  }
  const grown = morph(bgMask, W, H, openRadius, 'dilate')
  for (let i = 0; i < N; i++) bgMask[i] = grown[i] && rawBg[i] ? 1 : 0

  // 前景 = 非背景，取最大连通块（丢掉水印残留、飘散火花等孤岛）
  const label = new Int32Array(N).fill(-1)
  let best = -1, bestSize = 0
  for (let s = 0; s < N; s++) {
    if (bgMask[s] || label[s] !== -1) continue
    const id = s
    let size = 0
    const q = [s]
    label[s] = id
    while (q.length) {
      const i = q.pop()
      size++
      const x = i % W, y = (i / W) | 0
      const nb = []
      if (x > 0) nb.push(i - 1)
      if (x < W - 1) nb.push(i + 1)
      if (y > 0) nb.push(i - W)
      if (y < H - 1) nb.push(i + W)
      for (const j of nb) if (!bgMask[j] && label[j] === -1) { label[j] = id; q.push(j) }
    }
    if (size > bestSize) { bestSize = size; best = id }
  }

  // 组装 alpha：主体块内按前景得分做 soft alpha
  const alpha = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    if (label[i] !== best) continue
    alpha[i] = Math.max(0, Math.min(1, score[i]))
  }

  // 先用形态学约束干掉大片低 alpha 灰雾：真实抗锯齿软边只会紧贴实心核，
  // 而背景模型的残差是远离主体的大片半透明区域。不做这步，后面的模糊-二值化会把灰雾推成实心。
  const core = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (alpha[i] >= coreT) core[i] = 1
  const nearCore = morph(core, W, H, feather, 'dilate')
  for (let i = 0; i < N; i++) if (!nearCore[i]) alpha[i] = 0

  // Alpha 正则化：模糊 → 重新二值化 → 轻模糊做抗锯齿。
  // 比形态学开闭更适合这里：孤立毛尖小点被模糊后峰值 <0.5 自然消失，头顶轮廓光造成的小缺口
  // 被周围实心区域填回来，而且不会像结构元那样在画面上留下菱形痕迹。
  const a8 = Buffer.alloc(N)
  for (let i = 0; i < N; i++) a8[i] = Math.round(alpha[i] * 255)

  // 注意：sharp 对单通道 raw 做模糊后可能输出 3 通道，必须按 info.channels 的步长取值
  const blurGray = async (buf, sigma) => {
    const { data: d, info: inf } = await sharp(buf, { raw: { width: W, height: H, channels: 1 } })
      .blur(sigma)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const st = inf.channels
    const out = Buffer.alloc(N)
    for (let i = 0; i < N; i++) out[i] = d[i * st]
    return out
  }

  const smoothed = await blurGray(a8, regularizeSigma)
  const hard = Buffer.alloc(N)
  // 阈值取 >128：把边界往主体内收一点，避免把周围的半透明光晕推成实心灰块
  for (let i = 0; i < N; i++) hard[i] = smoothed[i] >= binT ? 1 : 0

  // 补洞：头顶过曝轮廓光会在主体内部留下一串被围住的透明洞，
  // 白底上看不出来，深色桌面上却是一条明显的暗色虚线带。
  // 判据很干净——凡是不与画面边框连通的「背景」区域，都是洞。
  const reach = new Uint8Array(N)
  const hstack = []
  const hpush = (x, y) => {
    const i = y * W + x
    if (!reach[i] && !hard[i]) { reach[i] = 1; hstack.push(i) }
  }
  for (let x = 0; x < W; x++) { hpush(x, 0); hpush(x, H - 1) }
  for (let y = 0; y < H; y++) { hpush(0, y); hpush(W - 1, y) }
  while (hstack.length) {
    const i = hstack.pop()
    const x = i % W, y = (i / W) | 0
    if (x > 0) hpush(x - 1, y)
    if (x < W - 1) hpush(x + 1, y)
    if (y > 0) hpush(x, y - 1)
    if (y < H - 1) hpush(x, y + 1)
  }
  let holes = 0
  for (let i = 0; i < N; i++) if (!hard[i] && !reach[i]) { hard[i] = 1; holes++ }

  // 主动收边：源视频角色轮廓外自带一圈过曝辉光，颜色与纹理都够不到背景阈值，
  // 会被当成主体留下 4~8px 的亮边。与其调阈值去猜，不如直接向内腐蚀几像素——
  // 720px 源缩到 ~210px 显示时，4px 只剩 1.2px，看不出损失，但白边被彻底切掉。
  const choked = morph(hard, W, H, chokePx, 'erode')
  const bin8 = Buffer.alloc(N)
  for (let i = 0; i < N; i++) bin8[i] = choked[i] ? 255 : 0
  const aa = await blurGray(bin8, edgeSigma)
  for (let i = 0; i < N; i++) alpha[i] = aa[i] / 255

  // 输出 RGBA + 内容包围盒
  // 半透明像素做「颜色去污染」：观测色 C = a·F + (1-a)·B，已知 B（背景模型）可反解真实前景 F。
  // 这一步消除源视频自带的亮光晕在深色桌面上形成的白边。
  const out = Buffer.alloc(N * 4)
  let minX = W, minY = H, maxX = 0, maxY = 0
  for (let i = 0; i < N; i++) {
    const p = i * C
    let a = alpha[i]
    // 收边：把低 alpha 往 0 压，保留高 alpha，避免残留半透明光晕
    a = Math.max(0, Math.min(1, a * (1 + chokeGain) - chokeGain))
    const x = i % W, y = (i / W) | 0
    // 只在 alpha 足够大时去污染：a 很小时 1/a 会把噪声放大成亮斑
    if (a > 0.35 && a < 0.98) {
      const bgc = bg(x, y)
      for (let ch = 0; ch < 3; ch++) {
        const F = (data[p + ch] - (1 - a) * bgc[ch]) / a
        // 去污染只允许把像素变暗（去掉背景亮光的混入），不允许提亮
        out[i * 4 + ch] = Math.max(0, Math.min(data[p + ch], Math.round(F)))
      }
    } else {
      out[i * 4] = data[p]
      out[i * 4 + 1] = data[p + 1]
      out[i * 4 + 2] = data[p + 2]
    }
    const A = Math.round(a * 255)
    out[i * 4 + 3] = A
    if (A > 8) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    alpha[i] = a
  }

  let solid = 0
  for (let i = 0; i < N; i++) if (alpha[i] > 0.5) solid++
  return { rgba: out, W, H, bbox: { minX, minY, maxX, maxY }, coverage: solid / N }
}

// 直接运行时：抠一帧并输出预览（透明 PNG + 深色底合成图，方便看边缘毛边）
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? 'assets/raw/frames/044.png'
  const outName = process.argv[3] ?? 'assets/raw/matte-test'
  const { rgba, W, H, bbox, coverage } = await matte(file)
  console.log('bbox:', bbox, ' 主体占比:', (coverage * 100).toFixed(1) + '%')
  const img = () => sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  await img().png().toFile(`${outName}.png`)
  await sharp({ create: { width: W, height: H, channels: 4, background: '#1b1b22' } })
    .composite([{ input: await img().png().toBuffer() }])
    .png()
    .toFile(`${outName}-dark.png`)
  await sharp({ create: { width: W, height: H, channels: 4, background: '#e8f0d8' } })
    .composite([{ input: await img().png().toBuffer() }])
    .png()
    .toFile(`${outName}-light.png`)
  // alpha 通道可视化：白=不透明 黑=透明，用来直接检查蒙版形状
  const a = Buffer.alloc(W * H)
  for (let i = 0; i < W * H; i++) a[i] = rgba[i * 4 + 3]
  await sharp(a, { raw: { width: W, height: H, channels: 1 } }).png().toFile(`${outName}-alpha.png`)
  console.log('已输出:', `${outName}.png / -dark.png / -light.png / -alpha.png`)
}
