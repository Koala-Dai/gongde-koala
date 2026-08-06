// 生成 macOS 菜单栏托盘图标：木鱼 + 槌。
//
// 为什么不画考拉：模板图只保留 alpha（颜色由系统染黑/白），而考拉的辨识度来自
// 毛绒质感和扁鼻，22px 下这些全部丢失，剩下「大圆+两小圆」正好是米老鼠的签名构图。
// 实测四个考拉变体全部读成米老鼠，因此改用木鱼——一侧开口的鼓状体加一柄斜槌，
// 这个不对称轮廓在菜单栏尺寸下独一无二，不会和任何系统图标混淆。
import sharp from 'sharp'

const OUT = 'assets/koala'

/** 22pt 设计基准。槌子刻意斜置：不对称轮廓在小尺寸下比对称形状更好认。 */
const shape = (p) => `
  <!-- 木鱼本体：横向鼓状 -->
  <ellipse cx="${p(10.4)}" cy="${p(13.6)}" rx="${p(8.2)}" ry="${p(6.2)}"/>
  <!-- 开口：木鱼的标志性横缝，挖空 -->
  <path d="M${p(3.8)} ${p(13.6)} h${p(9.6)}
           a${p(1.15)} ${p(1.15)} 0 0 1 0 ${p(2.3)}
           h${p(-9.6)} a${p(1.15)} ${p(1.15)} 0 0 1 0 ${p(-2.3)} z" fill="#fff"/>
  <!-- 槌：斜 34°，槌头在右上。柄要够粗，22px 下细杆会消失 -->
  <g transform="rotate(-34 ${p(16)} ${p(6.4)})">
    <rect x="${p(15.1)}" y="${p(2.2)}" width="${p(2)}" height="${p(7.6)}" rx="${p(1)}"/>
    <circle cx="${p(16.1)}" cy="${p(2.4)}" r="${p(2.5)}"/>
  </g>`

const svg = (S) => {
  const k = S / 22
  const p = (n) => +(n * k).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><g fill="#000" fill-rule="evenodd">${shape(p)}</g></svg>`
}

/** SVG → 模板图：RGB 全 0，形状完全由 alpha 表达（evenodd 挖出的白色变透明） */
async function toTemplate(S) {
  // 4x 渲染再缩小，得到干净的抗锯齿边缘
  const { data, info } = await sharp(Buffer.from(svg(S * 4)))
    .resize(S, S)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const N = info.width * info.height
  const out = Buffer.alloc(N * 4)
  for (let i = 0; i < N; i++) {
    const r = data[i * info.channels]
    const a = info.channels === 4 ? data[i * 4 + 3] : 255
    out[i * 4 + 3] = Math.round((a / 255) * (1 - r / 255) * 255)
  }
  return sharp(out, { raw: { width: S, height: S, channels: 4 } }).png()
}

for (const [size, name] of [[22, 'trayTemplate.png'], [44, 'trayTemplate@2x.png']]) {
  await (await toTemplate(size)).toFile(`${OUT}/${name}`)
  console.log(`${name}  ${size}x${size}`)
}

// 预览：模拟真实菜单栏（浅色栏染黑 / 深色栏染白），下方放大看形状
const mkRow = async (bg, tint) => {
  const { data: d, info } = await sharp(`${OUT}/trayTemplate@2x.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const v = tint === 'white' ? 255 : 0
  const buf = Buffer.alloc(d.length)
  for (let i = 0; i < info.width * info.height; i++) {
    buf[i * 4] = v; buf[i * 4 + 1] = v; buf[i * 4 + 2] = v; buf[i * 4 + 3] = d[i * 4 + 3]
  }
  const img = sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } })
  const at22 = await img.clone().resize(22, 22).png().toBuffer()
  const big = await img.clone().resize(110, 110, { kernel: 'nearest' }).png().toBuffer()
  return sharp({ create: { width: 240, height: 160, channels: 4, background: bg } })
    .composite([
      { input: at22, left: 30, top: 4 }, { input: at22, left: 70, top: 4 }, { input: at22, left: 110, top: 4 },
      { input: big, left: 65, top: 36 },
    ])
    .png()
    .toBuffer()
}
await sharp({ create: { width: 500, height: 160, channels: 4, background: '#7d7d7d' } })
  .composite([
    { input: await mkRow('#f2f2f2', 'black'), left: 0, top: 0 },
    { input: await mkRow('#26262b', 'white'), left: 260, top: 0 },
  ])
  .png()
  .toFile('assets/raw/tray-look.png')
console.log('预览 → assets/raw/tray-look.png')
