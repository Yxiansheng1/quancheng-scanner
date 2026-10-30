/* 生成安卓启动图标（替换 Capacitor 默认的机器人图标）
 * 用法: node tools/make-android-icons.cjs
 * 输出到 android/app/src/main/res/ 下各个 mipmap 目录，
 * 覆盖 ic_launcher、ic_launcher_round、ic_launcher_foreground。
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
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 画图标。mode:
 *   'full'     —— 圆角方底 + 白纸（老式图标）
 *   'round'    —— 圆形底
 *   'fg'       —— 只画白纸，透明背景（自适应图标前景，安全区 66%）
 */
function drawIcon(size, mode) {
  const SS = 3;
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);
  const put = (x, y, r, g, b, a) => {
    const o = (y * S + x) * 4;
    const na = a / 255;
    buf[o] = Math.round(buf[o] * (1 - na) + r * na);
    buf[o + 1] = Math.round(buf[o + 1] * (1 - na) + g * na);
    buf[o + 2] = Math.round(buf[o + 2] * (1 - na) + b * na);
    buf[o + 3] = Math.max(buf[o + 3], a);
  };
  const shape = (x0, y0, x1, y1, rad, color, circle) => {
    const [r, g, b] = color;
    for (let y = Math.floor(y0 * S); y < Math.ceil(y1 * S); y++) {
      for (let x = Math.floor(x0 * S); x < Math.ceil(x1 * S); x++) {
        const px = (x + 0.5) / S;
        const py = (y + 0.5) / S;
        let inside;
        if (circle) {
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
          inside = Math.hypot(px - cx, py - cy) <= (x1 - x0) / 2;
        } else {
          const dx = Math.max(x0 + rad - px, 0, px - (x1 - rad));
          const dy = Math.max(y0 + rad - py, 0, py - (y1 - rad));
          inside = Math.hypot(dx, dy) <= rad;
        }
        if (inside) put(x, y, r, g, b, 255);
      }
    }
  };

  const BLUE = [79, 140, 255];
  const pad = mode === 'fg' ? 0.19 : 0.0; // 自适应前景要留安全区

  if (mode === 'fg') {
    // 透明底，只画纸和字
    const px0 = 0.22 + pad * 0.3, px1 = 0.78 - pad * 0.3;
    const py0 = 0.16 + pad * 0.2, py1 = 0.84 - pad * 0.2;
    shape(px0, py0, px1, py1, 0.04, [255, 255, 255]);
    const lx0 = px0 + 0.085, lx1 = px1 - 0.085;
    [0.30, 0.44, 0.58, 0.72].forEach((yy, i) => {
      const x1 = i === 3 ? lx0 + (lx1 - lx0) * 0.55 : lx1;
      shape(lx0, yy, x1, yy + 0.052, 0.024, i === 0 ? BLUE : [176, 190, 210]);
    });
  } else {
    shape(0, 0, 1, 1, mode === 'round' ? 0.5 : 0.22, BLUE, mode === 'round');
    const px0 = 0.31, px1 = 0.69, py0 = 0.19, py1 = 0.81;
    shape(px0, py0, px1, py1, 0.035, [255, 255, 255]);
    const lx0 = px0 + 0.075, lx1 = px1 - 0.075;
    [0.35, 0.47, 0.59, 0.71].forEach((yy, i) => {
      const x1 = i === 3 ? lx0 + (lx1 - lx0) * 0.55 : lx1;
      shape(lx0, yy, x1, yy + 0.048, 0.022, i === 0 ? BLUE : [176, 190, 210]);
    });
  }

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
      const aAvg = a / n;
      const norm = aAvg > 0 ? 255 / aAvg : 0;
      const o = (y * size + x) * 4;
      out[o] = Math.round((r / n) * (norm / 255) * 255);
      out[o + 1] = Math.round((g / n) * (norm / 255) * 255);
      out[o + 2] = Math.round((b / n) * (norm / 255) * 255);
      out[o + 3] = Math.round(aAvg);
    }
  }
  return encodePng(size, size, out);
}

const res = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(res)) {
  console.error('找不到 android 工程，先跑 npx cap add android');
  process.exit(1);
}

// mdpi=48dp 基准
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = path.join(res, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });

  const size = Math.round(48 * k);
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), drawIcon(size, 'full'));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), drawIcon(size, 'round'));

  // 自适应图标前景 108dp
  const fgSize = Math.round(108 * k);
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), drawIcon(fgSize, 'fg'));
  console.log(`  mipmap-${d}: ${size}px / 前景 ${fgSize}px`);
}

console.log('安卓图标已生成');
