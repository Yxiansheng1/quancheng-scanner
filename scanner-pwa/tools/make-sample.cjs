/* 生成一张"拍的文档照片"用于本地联调：node tools/make-sample.cjs
 * 输出 tools/sample.png
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const W = 1200, H = 900;
const corners = [
  { x: 210, y: 130 },
  { x: 1010, y: 205 },
  { x: 960, y: 800 },
  { x: 165, y: 725 },
];

function inQuad(px, py, q) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 页坐标 -> 图像坐标（双线性插值近似，够用）
function pageToImg(u, v) {
  const top = { x: corners[0].x + (corners[1].x - corners[0].x) * u, y: corners[0].y + (corners[1].y - corners[0].y) * u };
  const bot = { x: corners[3].x + (corners[2].x - corners[3].x) * u, y: corners[3].y + (corners[2].y - corners[3].y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
}

const rgb = Buffer.alloc(W * H * 3);

// 桌面背景
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3;
    const shade = 46 + 30 * (1 - y / H) + 12 * (x / W);
    rgb[o] = shade * 0.9;
    rgb[o + 1] = shade * 0.95;
    rgb[o + 2] = shade;
  }
}

// 白纸 + 轻微阴影边
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (inQuad(x, y, corners)) {
      const o = (y * W + x) * 3;
      rgb[o] = 238; rgb[o + 1] = 237; rgb[o + 2] = 233;
    }
  }
}

// 文字行
const drawLine = (u0, u1, v, thick, value) => {
  const steps = 400;
  for (let s = 0; s <= steps; s++) {
    const u = u0 + ((u1 - u0) * s) / steps;
    const c = pageToImg(u, v);
    for (let dy = -thick; dy <= thick; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.round(c.x + dx), y = Math.round(c.y + dy);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 3;
        rgb[o] = value; rgb[o + 1] = value; rgb[o + 2] = value;
      }
    }
  }
};

drawLine(0.14, 0.62, 0.14, 5, 40);          // 标题
for (let i = 0; i < 9; i++) {
  const v = 0.26 + i * 0.075;
  const end = i === 8 ? 0.55 : 0.86;
  drawLine(0.14, end, v, 3, 70);
}

fs.writeFileSync(path.join(__dirname, 'sample.png'), encodePng(W, H, rgb));
console.log('sample.png 已生成');
