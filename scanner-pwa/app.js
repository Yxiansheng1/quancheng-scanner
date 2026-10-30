import {
  detectDocumentCorners,
  insetCorners,
  suggestOutputSize,
  warpDocument,
  trimDarkBorders,
  enhanceImage,
} from './scan.js';
import { buildPdf } from './pdf.js';
import { buildDocx, blocksToLines, linesToText } from './docx.js';
import { savePage, listPages, deletePage, clearPages } from './idb.js';

const $ = (sel) => document.querySelector(sel);
const tick = () => new Promise((r) => setTimeout(r, 16));

/* 原生能力只有装成 App 才有。浏览器里这个 Promise 直接得到 null，
 * 也就永远不会去加载 native.js（避免网页版报错）。 */
const nativeReady = (async () => {
  try {
    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
      return await import('./native.js');
    }
  } catch (e) {
    console.warn('原生模块不可用', e);
  }
  return null;
})();

const state = {
  pages: [],   // { id, w, h, blob, seq, url }
  editing: null, // { src: ImageData, srcCanvas, corners: [4], mode: 'color' }
  viewIndex: -1,
  activeHandle: -1,
};

/* ---------------- 通用 UI ---------------- */

let toastTimer = null;
function toast(msg, ms = 2000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function busy(on, text) {
  const el = $('#busy');
  if (text) el.querySelector('span').textContent = text;
  el.hidden = !on;
}

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('#' + name).classList.add('active');
}

/* ---------------- 图片读取 ---------------- */

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图读不出来，可能是 HEIC 或损坏文件'));
    };
    im.src = url;
  });
}

async function fileToPage(file, maxSide = 2400) {
  const bmp = await loadBitmap(file);
  const w0 = bmp.width || bmp.naturalWidth;
  const h0 = bmp.height || bmp.naturalHeight;
  if (!w0 || !h0) throw new Error('图片尺寸异常');

  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s));
  const h = Math.max(1, Math.round(h0 * s));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();

  return { canvas, img: ctx.getImageData(0, 0, w, h) };
}

/* ---------------- 首页 ---------------- */

function renderPages() {
  const wrap = $('#pages');
  wrap.innerHTML = '';
  state.pages.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'pageCard';
    const im = document.createElement('img');
    im.src = p.url;
    im.alt = `第 ${i + 1} 页`;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `P${i + 1}`;
    card.append(im, num);
    card.addEventListener('click', () => openViewer(i));
    wrap.appendChild(card);
  });

  const has = state.pages.length > 0;
  $('#empty').style.display = has ? 'none' : 'flex';
  $('#btnExport').disabled = !has;
  $('#btnExport').textContent = has ? `导出 (${state.pages.length})` : '导出';
  $('#btnClear').hidden = !has;
}

async function restore() {
  try {
    const rows = await listPages();
    rows.sort((a, b) => a.seq - b.seq);
    state.pages = rows.map((r) => ({
      ...r,
      url: URL.createObjectURL(r.blob),
    }));
  } catch (e) {
    console.warn('读取本地记录失败', e);
  }
  renderPages();
}

/* ---------------- 编辑 ---------------- */

async function openEditor(pageData) {
  state.editing = {
    src: pageData.img,
    srcCanvas: pageData.canvas,
    corners: null,
    mode: 'color',
  };

  busy(true, '识别边框…');
  await tick();
  let corners = null;
  try {
    corners = detectDocumentCorners(pageData.img);
  } catch (e) {
    console.warn('自动识别失败', e);
  }
  state.editing.corners = corners || insetCorners(pageData.img);
  busy(false);

  document.querySelectorAll('#modes button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === 'color');
  });
  show('editor');
  layoutEditor();
  updateOverlay();
  updatePreview();
}

function layoutEditor() {
  const ed = state.editing;
  if (!ed) return;
  const stage = $('#stage');
  const availW = stage.clientWidth;
  const availH = stage.clientHeight;
  const scale = Math.min(availW / ed.src.width, availH / ed.src.height);
  const cw = Math.max(1, Math.floor(ed.src.width * scale));
  const ch = Math.max(1, Math.floor(ed.src.height * scale));
  const ox = Math.floor((availW - cw) / 2);
  const oy = Math.floor((availH - ch) / 2);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = $('#stageCanvas');
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.position = 'absolute';
  canvas.style.left = ox + 'px';
  canvas.style.top = oy + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(ed.srcCanvas, 0, 0, cw, ch);

  state.view = { scale, ox, oy, cw, ch };
}

function updateOverlay() {
  const ed = state.editing;
  const v = state.view;
  if (!ed || !v) return;

  const pts = ed.corners.map((c) => ({
    x: v.ox + c.x * v.scale,
    y: v.oy + c.y * v.scale,
  }));

  $('#quad').setAttribute('points', pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));

  const g = $('#handles');
  g.innerHTML = '';
  pts.forEach((p, i) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', 12);
    c.setAttribute('class', 'handle');
    c.dataset.i = String(i);
    g.appendChild(c);
  });
}

function pointerToSource(ev) {
  const v = state.view;
  return {
    x: (ev.clientX - v.ox) / v.scale,
    y: (ev.clientY - v.oy) / v.scale,
  };
}

function bindHandles() {
  const svg = $('#overlay');

  svg.addEventListener('pointerdown', (ev) => {
    const t = ev.target;
    if (!t.classList || !t.classList.contains('handle')) return;
    state.activeHandle = Number(t.dataset.i);
    svg.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  svg.addEventListener('pointermove', (ev) => {
    if (state.activeHandle < 0) return;
    const ed = state.editing;
    const p = pointerToSource(ev);
    ed.corners[state.activeHandle] = {
      x: Math.max(0, Math.min(ed.src.width - 1, p.x)),
      y: Math.max(0, Math.min(ed.src.height - 1, p.y)),
    };
    updateOverlay();
    ev.preventDefault();
  });

  const end = (ev) => {
    if (state.activeHandle < 0) return;
    state.activeHandle = -1;
    try { svg.releasePointerCapture(ev.pointerId); } catch {}
    updatePreview();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

/* ---------------- 预览 ---------------- */

let previewTimer = null;
function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const ed = state.editing;
    if (!ed) return;
    const size = suggestOutputSize(ed.corners, 320);
    let warped = warpDocument(ed.src, ed.corners, size.width, size.height);
    if (!warped) return;
    warped = trimDarkBorders(warped);
    const out = enhanceImage(warped, ed.mode);

    const c = $('#previewCanvas');
    c.width = out.width;
    c.height = out.height;
    const ctx = c.getContext('2d');
    const id = new ImageData(new Uint8ClampedArray(out.data), out.width, out.height);
    ctx.putImageData(id, 0, 0);
  }, 60);
}

/* ---------------- 生成页面 ---------------- */

async function confirmPage() {
  const ed = state.editing;
  if (!ed) return;

  busy(true, '生成中…');
  await tick();

  try {
    const size = suggestOutputSize(ed.corners, 1800);
    let warped = warpDocument(ed.src, ed.corners, size.width, size.height);
    if (!warped) throw new Error('拉正失败，请调整四个角');
    warped = trimDarkBorders(warped);

    await tick();
    const out = enhanceImage(warped, ed.mode);

    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    canvas
      .getContext('2d')
      .putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) throw new Error('生成图片失败');

    const page = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
      w: out.width,
      h: out.height,
      blob,
      seq: Date.now(),
      url: URL.createObjectURL(blob),
    };

    state.pages.push(page);
    await savePage({ id: page.id, w: page.w, h: page.h, blob: page.blob, seq: page.seq });
    renderPages();
    state.editing = null;
    show('home');
    toast('已添加 1 页');
  } catch (e) {
    toast(e.message || '处理失败');
  } finally {
    busy(false);
  }
}

/* ---------------- 查看 / 删除 ---------------- */

function openViewer(index) {
  state.viewIndex = index;
  const p = state.pages[index];
  if (!p) return;
  $('#viewImage').src = p.url;
  $('#viewIndex').textContent = String(index + 1);
  show('viewer');
}

async function removeCurrentPage() {
  const i = state.viewIndex;
  const p = state.pages[i];
  if (!p) return;
  state.pages.splice(i, 1);
  renderPages();
  show('home');
  try {
    await deletePage(p.id);
  } catch {}
  setTimeout(() => URL.revokeObjectURL(p.url), 1000);
  toast('已删除');
}

/* ---------------- 导出 ---------------- */

const fileStamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

/** 统一出口：手机走系统分享面板，浏览器走下载 */
async function deliver(blob, filename) {
  const nat = await nativeReady;
  if (nat) {
    await nat.shareBlob(blob, filename);
    return;
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('已下载');
}

async function exportPdf() {
  if (!state.pages.length) return;
  busy(true, '生成 PDF…');
  await tick();
  try {
    const inputs = [];
    for (const p of state.pages) {
      inputs.push({ jpeg: new Uint8Array(await p.blob.arrayBuffer()), width: p.w, height: p.h });
    }
    const pdf = buildPdf(inputs);
    await deliver(new Blob([pdf], { type: 'application/pdf' }), `扫描_${fileStamp()}.pdf`);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast(e.message || '导出失败');
  } finally {
    busy(false);
  }
}

/** 逐页跑文字识别：App 里用 ML Kit，网页里用 Tesseract */
async function ocrAllPages() {
  const nat = await nativeReady;
  const pages = [];
  for (let i = 0; i < state.pages.length; i++) {
    const p = state.pages[i];
    if (nat) {
      busy(true, `识别文字 ${i + 1}/${state.pages.length}…`);
      await tick();
      const res = await nat.recognize(p.blob, `p${i}.jpg`);
      pages.push({ lines: blocksToLines(res.blocks, p.h) });
    } else {
      busy(true, `识别文字 ${i + 1}/${state.pages.length}… 0%`);
      await tick();
      const { recognizeImage } = await import('./ocr.js');
      const res = await recognizeImage(p.blob, (m) => {
        if (m && m.status) {
          const pct = m.progress ? Math.round(m.progress * 100) : 0;
          busy(true, `识别文字 ${i + 1}/${state.pages.length}… ${pct}%`);
        }
      });
      pages.push({ lines: blocksToLines(res.blocks, p.h) });
    }
  }
  if (nat) {
    try {
      await nat.cleanupTemp();
    } catch {}
  }
  return pages;
}

async function exportWord() {
  if (!state.pages.length) return;
  busy(true, '准备中…');
  try {
    const pages = await ocrAllPages();
    if (!pages) return;
    const bytes = buildDocx(pages);
    await deliver(
      new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      `扫描_${fileStamp()}.docx`
    );
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast(e.message || '识别失败');
  } finally {
    busy(false);
  }
}

async function exportTxt() {
  if (!state.pages.length) return;
  busy(true, '准备中…');
  try {
    const pages = await ocrAllPages();
    if (!pages) return;
    await deliver(
      new Blob([linesToText(pages)], { type: 'text/plain;charset=utf-8' }),
      `扫描_${fileStamp()}.txt`
    );
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast(e.message || '识别失败');
  } finally {
    busy(false);
  }
}

function openSheet() {
  if (!state.pages.length) return;
  $('#sheet').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  $('#btnAdd').addEventListener('click', () => {
    const input = $('#fileInput');
    input.value = '';
    input.click();
  });

  $('#fileInput').addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    busy(true, '读取图片…');
    await tick();
    try {
      const first = await fileToPage(files[0]);
      // 其余的先排队，等第一张处理完再逐个来
      state.queue = files.slice(1);
      busy(false);
      await openEditor(first);
    } catch (e) {
      busy(false);
      toast(e.message || '读取失败');
    }
  });

  $('#btnCancel').addEventListener('click', async () => {
    state.editing = null;
    show('home');
    await drainQueue();
  });

  $('#btnAuto').addEventListener('click', async () => {
    const ed = state.editing;
    if (!ed) return;
    busy(true, '识别边框…');
    await tick();
    let corners = null;
    try { corners = detectDocumentCorners(ed.src); } catch {}
    ed.corners = corners || insetCorners(ed.src);
    busy(false);
    updateOverlay();
    updatePreview();
    toast(corners ? '已重新识别' : '没找到纸张边缘，用默认边框');
  });

  $('#btnConfirm').addEventListener('click', async () => {
    await confirmPage();
    await drainQueue();
  });

  document.querySelectorAll('#modes button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.editing) return;
      document.querySelectorAll('#modes button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.editing.mode = btn.dataset.mode;
      updatePreview();
    });
  });

  $('#btnExport').addEventListener('click', openSheet);

  const sheet = $('#sheet');
  sheet.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    closeSheet();
    if (act === 'pdf') exportPdf();
    else if (act === 'word') exportWord();
    else if (act === 'txt') exportTxt();
  });

  // App 里用 ML Kit，网页里用 Tesseract，两边都能识别，不需要再标灰
  $('#btnViewClose').addEventListener('click', () => show('home'));
  $('#btnViewDelete').addEventListener('click', removeCurrentPage);

  $('#btnClear').addEventListener('click', async () => {
    if (!confirm('确定清空所有页面？')) return;
    state.pages.forEach((p) => URL.revokeObjectURL(p.url));
    state.pages = [];
    renderPages();
    try { await clearPages(); } catch {}
    toast('已清空');
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!state.editing) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      layoutEditor();
      updateOverlay();
    }, 120);
  });

  bindHandles();
}

async function drainQueue() {
  const q = state.queue || [];
  if (!q.length) return;
  const next = q.shift();
  busy(true, '读取图片…');
  await tick();
  try {
    const data = await fileToPage(next);
    busy(false);
    await openEditor(data);
  } catch (e) {
    busy(false);
    toast(e.message || '读取失败');
    await drainQueue();
  }
}

/* ---------------- 启动 ---------------- */

bindEvents();
restore();

/* 只有在 https / 正式站才启用 Service Worker；localhost 开发时跳过，免得改了代码还读到旧缓存 */
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
