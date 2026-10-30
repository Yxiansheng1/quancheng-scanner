/* 扫描算法：不依赖 DOM，所有输入都是 {width, height, data} 形式的 RGBA 像素
 * （与浏览器 ImageData 结构一致），因此可以在 Node 里直接跑测试。
 */

export function createImageData(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/* ---------------- 基础工具 ---------------- */

export function toGray(img) {
  const { width, height, data } = img;
  const n = width * height;
  const g = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    g[i] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114 + 0.5) | 0;
  }
  return g;
}

export function downscale(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = createImageData(w, h);
  const data = img.data;
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.height, Math.ceil((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(img.width, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, c = 0;
      for (let yy = y0; yy < y1; yy++) {
        let p = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, p += 4) {
          r += data[p]; g += data[p + 1]; b += data[p + 2]; c++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / c;
      out.data[o + 1] = g / c;
      out.data[o + 2] = b / c;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function boxBlur(gray, w, h, radius) {
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, c = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += gray[yy * w + xx];
          c++;
        }
      }
      out[y * w + x] = sum / c;
    }
  }
  return out;
}

function borderMean(gray, w, h, ring) {
  let sum = 0, c = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) {
        sum += gray[y * w + x];
        c++;
      }
    }
  }
  return c ? sum / c : 0;
}

function otsu(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

/* 最大连通域（8 邻域），返回面积与像素列表里需要的极值点 */
function largestComponent(mask, w, h) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best = null;
  let bestArea = 0;

  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0;
    let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
    let pTL = null, pBR = null, pTR = null, pBL = null;
    let touch = 0;
    const pts = [];

    while (top) {
      const idx = stack[--top];
      area++;
      const x = idx % w;
      const y = (idx / w) | 0;
      pts.push(idx);
      const s = x + y, d = x - y;
      if (s < minSum) { minSum = s; pTL = { x, y }; }
      if (s > maxSum) { maxSum = s; pBR = { x, y }; }
      if (d > maxDiff) { maxDiff = d; pTR = { x, y }; }
      if (d < minDiff) { minDiff = d; pBL = { x, y }; }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch++;

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }

    if (area > bestArea) {
      bestArea = area;
      best = { area, tl: pTL, br: pBR, tr: pTR, bl: pBL, touch, pts };
    }
  }
  return bestArea ? best : null;
}

function shoelace(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/* 保证四边形是 tl, tr, br, bl 的顺序 */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const arr = pts
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  // 起点取左上角（x+y 最小）
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (arr[i].x + arr[i].y < arr[start].x + arr[start].y) start = i;
  }
  const rot = [...arr.slice(start), ...arr.slice(0, start)];

  // 屏幕坐标（y 向下）里 tl→tr→br→bl 的叉积为正；为负说明绕反了
  return cross(rot[0], rot[1], rot[2]) > 0 ? rot : [rot[0], rot[3], rot[2], rot[1]];
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * 自动找出纸张四角。返回 [tl, tr, br, bl]（原图坐标），失败返回 null。
 */
export function detectDocumentCorners(img, opts = {}) {
  const workMax = opts.workMax || 320;
  const small = downscale(img, workMax);
  const w = small.width, h = small.height;
  const g = toGray(small);
  const soft = boxBlur(g, w, h, 1);

  const bg = borderMean(soft, w, h, 2);
  let sum = 0;
  for (let i = 0; i < soft.length; i++) sum += soft[i];
  const center = sum / soft.length;
  const paperIsBright = center >= bg;

  const t = otsu(soft);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (paperIsBright ? soft[i] > t : soft[i] < t) ? 1 : 0;
  }

  const comp = largestComponent(mask, w, h);
  if (!comp) return null;
  if (comp.area < w * h * 0.08) return null;
  if (!comp.tl || !comp.tr || !comp.bl || !comp.br) return null;

  const quad = orderCorners([comp.tl, comp.tr, comp.br, comp.bl]);
  const qArea = shoelace(quad);
  if (qArea < w * h * 0.08) return null;
  if (qArea < comp.area * 0.45) return null;
  if (comp.touch > (w + h) * 4) return null; // 整张图都是同一块，基本等于没检测到

  const sx = img.width / w;
  const sy = img.height / h;
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

/* 四个角的兜底值：内缩一圈 */
export function insetCorners(img, ratio = 0.04) {
  const dx = img.width * ratio;
  const dy = img.height * ratio;
  return [
    { x: dx, y: dy },
    { x: img.width - dx, y: dy },
    { x: img.width - dx, y: img.height - dy },
    { x: dx, y: img.height - dy },
  ];
}

/* ---------------- 透视变换 ---------------- */

function solveLinear(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    }
    if (Math.abs(A[piv][i]) < 1e-12) return null;
    [A[i], A[piv]] = [A[piv], A[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

/** 求把 from(4点) 映射到 to(4点) 的单应矩阵，返回 9 个数 */
export function homography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + 1;
  return {
    x: (H[0] * x + H[1] * y + H[2]) / d,
    y: (H[3] * x + H[4] * y + H[5]) / d,
  };
}

/** 按四角把画面拉正到 outW x outH */
export function warpDocument(img, corners, outW, outH) {
  const dst = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const H = homography(dst, corners); // 目标像素 -> 源像素
  if (!H) return null;

  const out = createImageData(outW, outH);
  const src = img.data;
  const sw = img.width, sh = img.height;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyH(H, x, y);
      const o = (y * outW + x) * 4;
      let sx = p.x, sy = p.y;
      if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1;
      if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;

      const x0 = sx | 0, y0 = sy | 0;
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;

      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out.data[o + c] = top * (1 - fy) + bot * fy;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 根据四角推算合适的输出尺寸 */
export function suggestOutputSize(corners, maxSide = 1800) {
  const w = (dist(corners[0], corners[1]) + dist(corners[3], corners[2])) / 2;
  const h = (dist(corners[0], corners[3]) + dist(corners[1], corners[2])) / 2;
  const s = Math.min(1, maxSide / Math.max(w, h, 1));
  return {
    width: Math.max(32, Math.round(w * s)),
    height: Math.max(32, Math.round(h * s)),
  };
}

/**
 * 裁掉拉正后四周可能带进来的桌面/阴影边（只裁最外圈一小条）。
 * 思路：以中心区域亮度为基准，若最外侧若干行列明显更暗，就切掉。
 */
export function trimDarkBorders(img, maxRatio = 0.03) {
  const { width: w, height: h, data } = img;
  if (w < 20 || h < 20) return img;

  let sum = 0, n = 0;
  for (let y = (h * 0.3) | 0; y < (h * 0.7) | 0; y += 2) {
    for (let x = (w * 0.3) | 0; x < (w * 0.7) | 0; x += 2) {
      const o = (y * w + x) * 4;
      sum += (data[o] + data[o + 1] + data[o + 2]) / 3;
      n++;
    }
  }
  if (!n) return img;
  const limit = (sum / n) * 0.62;

  const rowMean = (y) => {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      s += (data[o] + data[o + 1] + data[o + 2]) / 3;
    }
    return s / w;
  };
  const colMean = (x) => {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const o = (y * w + x) * 4;
      s += (data[o] + data[o + 1] + data[o + 2]) / 3;
    }
    return s / h;
  };

  const maxY = Math.floor(h * maxRatio);
  const maxX = Math.floor(w * maxRatio);

  let top = 0;
  while (top < maxY && rowMean(top) < limit) top++;
  let bottom = 0;
  while (bottom < maxY && rowMean(h - 1 - bottom) < limit) bottom++;
  let left = 0;
  while (left < maxX && colMean(left) < limit) left++;
  let right = 0;
  while (right < maxX && colMean(w - 1 - right) < limit) right++;

  if (!top && !bottom && !left && !right) return img;

  const nw = w - left - right;
  const nh = h - top - bottom;
  if (nw < 40 || nh < 40) return img;

  const out = createImageData(nw, nh);
  for (let y = 0; y < nh; y++) {
    const srcStart = ((y + top) * w + left) * 4;
    out.data.set(data.subarray(srcStart, srcStart + nw * 4), y * nw * 4);
  }
  return out;
}

/* ---------------- 画质增强 ---------------- */

function stretchLut(gray, lowPct = 0.02, highPct = 0.995) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * lowPct) { lo = i; break; }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= total * (1 - highPct)) { hi = i; break; }
  }
  if (hi <= lo) { hi = 255; lo = 0; }
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.max(0, Math.min(255, ((i - lo) * 255) / (hi - lo)));
  }
  return lut;
}

/**
 * mode: 'color' 原色 | 'gray' 增强(灰度) | 'bw' 黑白
 */
export function enhanceImage(img, mode = 'color') {
  const out = createImageData(img.width, img.height);
  if (mode === 'color') {
    const g = toGray(img);
    const lut = stretchLut(g);
    for (let p = 0; p < img.data.length; p += 4) {
      out.data[p] = lut[img.data[p]];
      out.data[p + 1] = lut[img.data[p + 1]];
      out.data[p + 2] = lut[img.data[p + 2]];
      out.data[p + 3] = 255;
    }
    return out;
  }

  const g = toGray(img);
  const lut = stretchLut(g, 0.03, 0.99);
  const stretched = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) stretched[i] = lut[g[i]];

  if (mode === 'gray') {
    for (let i = 0, p = 0; i < stretched.length; i++, p += 4) {
      const v = stretched[i];
      out.data[p] = v; out.data[p + 1] = v; out.data[p + 2] = v; out.data[p + 3] = 255;
    }
    return out;
  }

  // 黑白：先轻微平滑再全局阈值，避免噪点变麻子
  const soft = boxBlur(stretched, img.width, img.height, 1);
  const t = Math.max(otsu(soft), 90);
  for (let i = 0, p = 0; i < soft.length; i++, p += 4) {
    const v = soft[i] > t ? 255 : 0;
    out.data[p] = v; out.data[p + 1] = v; out.data[p + 2] = v; out.data[p + 3] = 255;
  }
  return out;
}
