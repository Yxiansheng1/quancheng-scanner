/* 网页版文字识别：Tesseract.js（WASM，离线）。
 *
 * App 里优先用 ML Kit（更快更准），只有在浏览器里才用这个。
 * 模型和 wasm 都放在 vendor/ 本地，不联网也能跑。
 */
import { createWorker } from 'tesseract.js';

const VENDOR = 'vendor';

let workerPromise = null;
let currentLogger = null;

async function ensureWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('chi_sim', 1, {
      workerPath: `${VENDOR}/worker.min.js`,
      corePath: `${VENDOR}`,
      langPath: `${VENDOR}`,
      // 语言包用未压缩的 .traineddata：Android 打包会自动解压 .gz 并去掉扩展名，
      // 那样 Tesseract 就找不到文件，识别会直接失败。
      gzip: false,
      cacheMethod: 'none',
      logger: (m) => {
        if (currentLogger) currentLogger(m);
      },
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * 识别一张图，返回统一格式的 blocks（和 ML Kit 的结果形状一致）。
 * @param {Blob} blob
 * @param {(p:{status:string,progress:number})=>void} onProgress
 * @returns {Promise<{text:string, blocks:{lines:{text:string,boundingBox:{top:number,bottom:number}}[]}[]}>}
 */
export async function recognizeImage(blob, onProgress) {
  const worker = await ensureWorker();
  currentLogger = onProgress || null;
  try {
    const { data } = await worker.recognize(blob, {}, { blocks: true, text: true });
    return {
      text: data.text || '',
      blocks: normalizeBlocks(data.blocks || []),
    };
  } finally {
    currentLogger = null;
  }
}

/** Tesseract 的 blocks -> 我们内部用的形状 */
function normalizeBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    const lines = [];
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        if (!l.text || !l.text.trim()) continue;
        const bb = l.bbox || {};
        lines.push({
          text: l.text.replace(/\s+$/, '').replace(/^\s+/, ''),
          boundingBox: { top: bb.y0 || 0, bottom: bb.y1 || 0 },
        });
      }
    }
    if (lines.length) out.push({ lines });
  }
  return out;
}

/** 释放 worker（换大图或退出时调用） */
export async function releaseWorker() {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    workerPromise = null;
    if (w) await w.terminate().catch(() => {});
  }
}
