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

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size, { maskable = false } = {}) {
  const SS = 3;
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);
  const pad = maskable ? 0.1 : 0;

  const put = (x, y, r, g, b, a) => {
    const o = (y * S + x) * 4;
    const na = a / 255;
    buf[o] = Math.round(buf[o] * (1 - na) + r * na);
    buf[o + 1] = Math.round(buf[o + 1] * (1 - na) + g * na);
    buf[o + 2] = Math.round(buf[o + 2] * (1 - na) + b * na);
    buf[o + 3] = Math.max(buf[o + 3], a);
  };

  const roundRect = (x0, y0, x1, y1, rad, color) => {
    const [r, g, b] = color;
    for (let y = Math.floor(y0 * S); y < Math.ceil(y1 * S); y++) {
      for (let x = Math.floor(x0 * S); x < Math.ceil(x1 * S); x++) {
        const px = (x + 0.5) / S;
        const py = (y + 0.5) / S;
        const dx = Math.max(x0 + rad - px, 0, px - (x1 - rad));
        const dy = Math.max(y0 + rad - py, 0, py - (y1 - rad));
        if (Math.hypot(dx, dy) <= rad) put(x, y, r, g, b, 255);
      }
    }
  };

  // 背景（iOS 会自己加圆角，这里铺满，只在 maskable 时留白）
  const bg = maskable ? [14, 16, 20] : [79, 140, 255];
  roundRect(0, 0, 1, 1, maskable ? 0.5 : 0.0, bg);

  // 蓝色圆角底
  const inset = 0.06 + pad;
  roundRect(inset, inset, 1 - inset, 1 - inset, 0.2, maskable ? [79, 140, 255] : [79, 140, 255]);

  // 白纸
  const px0 = 0.30 + pad, px1 = 0.70 - pad;
  const py0 = 0.19 + pad * 0.6, py1 = 0.81 - pad * 0.6;
  roundRect(px0, py0, px1, py1, 0.035, [255, 255, 255]);

  // 文字行
  const lineX0 = px0 + 0.075, lineX1 = px1 - 0.075;
  const rows = [0.36, 0.47, 0.58, 0.69];
  rows.forEach((yy, i) => {
    const w = i === rows.length - 1 ? 0.55 : 1;
    const x1 = lineX0 + (lineX1 - lineX0) * w;
    roundRect(lineX0, yy, x1, yy + 0.045, 0.022, i === 0 ? [79, 140, 255] : [176, 190, 210]);
  });

  // 降采样
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          const al = buf[o + 3] / 255;
          r += buf[o] * al;
          g += buf[o + 1] * al;
          b += buf[o + 2] * al;
          a += buf[o + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const aAvg = a / n;
      const norm = aAvg > 0 ? 255 / aAvg : 0;
      out[o] = Math.round((r / n) * (norm / 255) * 255);
      out[o + 1] = Math.round((g / n) * (norm / 255) * 255);
      out[o + 2] = Math.round((b / n) * (norm / 255) * 255);
      out[o + 3] = Math.round(aAvg);
    }
  }
  return encodePng(size, size, out);
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), makeIcon(512));
fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), makeIcon(512, { maskable: true }));
console.log('icons written');
