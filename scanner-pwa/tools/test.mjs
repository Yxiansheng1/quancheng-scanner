/* 算法自测：node tools/test.mjs
 * 纯逻辑测试，不需要浏览器。用合成图验证「找边 + 透视拉正 + PDF 结构」。
 */
import {
  createImageData,
  detectDocumentCorners,
  warpDocument,
  suggestOutputSize,
  trimDarkBorders,
  enhanceImage,
  homography,
} from '../scan.js';
import { buildPdf } from '../pdf.js';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

/* ---------- 造一张合成照片：深色桌面 + 倾斜的白纸 ---------- */
const W = 800, H = 600;
const truth = [
  { x: 120, y: 80 },
  { x: 690, y: 130 },
  { x: 655, y: 545 },
  { x: 95, y: 495 },
];

function inQuad(px, py, quad) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = quad[i].x, yi = quad[i].y;
    const xj = quad[j].x, yj = quad[j].y;
    const hit = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function makePhoto() {
  const img = createImageData(W, H);
  const pageToImg = homography(
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    truth
  );
  const map = (u, v) => {
    const d = pageToImg[6] * u + pageToImg[7] * v + 1;
    return {
      x: (pageToImg[0] * u + pageToImg[1] * v + pageToImg[2]) / d,
      y: (pageToImg[3] * u + pageToImg[4] * v + pageToImg[5]) / d,
    };
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      // 桌面：暗灰 + 轻微光照渐变
      const desk = 52 + 26 * (1 - y / H) + 10 * (x / W);
      let v = desk;
      if (inQuad(x, y, truth)) v = 214; // 白纸
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }

  // 在纸面内侧画 4 个灰度不同的标记块（页坐标 12% 内缩），用来验证拉正方向和朝向
  const MARKERS = [
    { uv: [0.12, 0.12], value: 10 },   // 左上
    { uv: [0.88, 0.12], value: 90 },   // 右上
    { uv: [0.88, 0.88], value: 150 },  // 右下
    { uv: [0.12, 0.88], value: 60 },   // 左下
  ];
  for (const { uv, value } of MARKERS) {
    const c = map(uv[0], uv[1]);
    for (let dy = -14; dy <= 14; dy++) {
      for (let dx = -14; dx <= 14; dx++) {
        if (dx * dx + dy * dy > 14 * 14) continue;
        const x = Math.round(c.x + dx), y = Math.round(c.y + dy);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 4;
        img.data[o] = value;
        img.data[o + 1] = value;
        img.data[o + 2] = value;
      }
    }
  }
  // 文字带：横向深色条
  for (let row = 0; row < 4; row++) {
    for (let t = 0; t <= 100; t++) {
      const u = 0.2 + (t / 100) * 0.6;
      const v = 0.3 + row * 0.13;
      const c = map(u, v);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round(c.x + dx), y = Math.round(c.y + dy);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = (y * W + x) * 4;
          img.data[o] = 30;
          img.data[o + 1] = 30;
          img.data[o + 2] = 30;
        }
      }
    }
  }
  return img;
}

/* ---------- 1. 找边 ---------- */
console.log('\n[1] 自动找边');
const photo = makePhoto();
const found = detectDocumentCorners(photo);

check('能检测到四角', !!found);
if (found) {
  const distToTruth = found.map((p) =>
    Math.min(...truth.map((t) => Math.hypot(t.x - p.x, t.y - p.y)))
  );
  check(
    '四个角误差都在 15px 内',
    distToTruth.every((d) => d < 15),
    JSON.stringify(distToTruth.map((d) => +d.toFixed(1)))
  );
  // 顺序必须是 tl, tr, br, bl
  const orderOk =
    found[0].x < found[1].x &&
    found[0].y < found[3].y &&
    found[2].x > found[3].x &&
    found[2].y > found[1].y;
  check('四角顺序正确(tl,tr,br,bl)', orderOk, JSON.stringify(found));
}

/* ---------- 2. 透视拉正 ---------- */
console.log('\n[2] 透视拉正');
const corners = found || truth;
const size = suggestOutputSize(corners, 800);
const warped = warpDocument(photo, corners, size.width, size.height);
check('输出尺寸合理', warped && warped.width === size.width && warped.height === size.height);

if (warped) {
  const at = (u, v) => {
    const x = Math.round(u * (warped.width - 1));
    const y = Math.round(v * (warped.height - 1));
    const o = (y * warped.width + x) * 4;
    return warped.data[o];
  };
  const expect = [
    { name: '左上', uv: [0.12, 0.12], value: 10 },
    { name: '右上', uv: [0.88, 0.12], value: 90 },
    { name: '右下', uv: [0.88, 0.88], value: 150 },
    { name: '左下', uv: [0.12, 0.88], value: 60 },
  ];
  const got = expect.map((e) => {
    const v = at(e.uv[0], e.uv[1]);
    return { ...e, got: v };
  });
  check(
    '四个标记按 tl/tr/br/bl 落位正确（没有旋转或镜像）',
    got.every((g) => Math.abs(g.got - g.value) < 28),
    got.map((g) => `${g.name}:${g.got}/${g.value}`).join(' ')
  );
  check('中心区域是亮的（纸面）', at(0.5, 0.5) > 150, String(at(0.5, 0.5)));
}

/* ---------- 3. 增强 ---------- */
console.log('\n[3] 画质增强');
for (const mode of ['color', 'gray', 'bw']) {
  const out = enhanceImage(warped, mode);
  let min = 255, max = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    min = Math.min(min, out.data[i]);
    max = Math.max(max, out.data[i]);
  }
  check(`${mode} 有对比度`, max - min > 80, `min=${min} max=${max}`);
  if (mode === 'bw') {
    let nonBinary = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] !== 0 && out.data[i] !== 255) nonBinary++;
    }
    check('bw 输出是纯黑白', nonBinary === 0, `非二值像素 ${nonBinary}`);
  }
}

/* ---------- 3.5 边缘修剪 ---------- */
console.log('\n[3.5] 裁掉桌面带进来的暗边');
{
  const w = 400, h = 400, pad = 6;
  const img = createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let v = 235;
      if (x < pad || y < pad || x >= w - pad || y >= h - pad) v = 32;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
    }
  }
  const trimmed = trimDarkBorders(img);
  check('尺寸被裁小', trimmed.width < w && trimmed.height < h, `${trimmed.width}x${trimmed.height}`);
  check(
    '裁完四边都是纸色',
    trimmed.data[0] > 180 &&
      trimmed.data[(trimmed.height - 1) * trimmed.width * 4] > 180 &&
      trimmed.data[trimmed.width * 4 - 4] > 180
  );
}

/* ---------- 4. PDF 结构 ---------- */
console.log('\n[4] PDF 结构');
const fakeJpeg = new Uint8Array(512);
fakeJpeg.set([0xff, 0xd8, 0xff, 0xe0]);
const pdf = buildPdf([
  { jpeg: fakeJpeg, width: 800, height: 1100 },
  { jpeg: fakeJpeg, width: 1200, height: 800 },
]);
const text = Buffer.from(pdf).toString('latin1');

check('以 %PDF-1.4 开头', text.startsWith('%PDF-1.4'));
check('以 %%EOF 结尾', text.trimEnd().endsWith('%%EOF'));
check('有 Catalog', text.includes('/Type /Catalog'));
check('页数 = 2', text.includes('/Count 2'));
check('有 DCTDecode 图片', (text.match(/\/DCTDecode/g) || []).length === 2);

// 校验交叉引用表偏移量
const xrefPos = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
check('startxref 指向 xref 关键字', text.slice(xrefPos, xrefPos + 4) === 'xref');

const xrefBlock = text.slice(xrefPos).split('\n');
const count = Number(xrefBlock[1].split(' ')[1]);
let offsetsOk = true;
for (let num = 1; num < count; num++) {
  const offset = Number(xrefBlock[1 + num + 1].slice(0, 10));
  const head = text.slice(offset, offset + 12);
  if (!head.startsWith(`${num} 0 obj`)) {
    offsetsOk = false;
    console.log(`      对象 ${num} 偏移错误: ${JSON.stringify(head)}`);
  }
}
check(`交叉引用表 ${count - 1} 个对象偏移全部正确`, offsetsOk);

// 每个 stream 的 /Length 必须和内容字节数一致，否则阅读器会解析错位
const reLen = /\/Length (\d+)\s*>>\s*\n?stream\n/g;
let m;
let lenOk = true;
let seenStreams = 0;
while ((m = reLen.exec(text)) !== null) {
  const len = Number(m[1]);
  const start = m.index + m[0].length;
  if (!text.slice(start + len, start + len + 10).startsWith('\nendstream')) lenOk = false;
  seenStreams++;
  reLen.lastIndex = start + len;
}
check(`stream 长度标注正确（${seenStreams} 段）`, lenOk && seenStreams === 4);

/* ---------- 结果 ---------- */
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
