/* 极简 DOCX 生成器。
 * .docx 本质是一个 zip 包着几个 XML。这里手写 ZIP（存储方式，不压缩）
 * 和那几个 XML，不依赖任何第三方库 —— 浏览器和 App 都能直接跑。
 * 只做三件事：分页、每行一段、字号按原图大小还原。不做表格/图片/加粗。
 */

/* ---------------- ZIP（stored，不压缩） ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = new TextEncoder();

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Uint8Array}
 */
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = utf8.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // 本地文件头签名
    dv.setUint16(4, 20, true); // 解压所需版本
    dv.setUint16(6, 0x0800, true); // 通用标志：文件名为 UTF-8
    dv.setUint16(8, 0, true); // 压缩方式：0 = 存储
    dv.setUint16(10, 0, true); // 修改时间
    dv.setUint16(12, 0x21, true); // 修改日期（1980-01-01）
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true); // 压缩后大小
    dv.setUint32(22, size, true); // 原始大小
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // 额外字段长度
    local.set(nameBytes, 30);

    chunks.push(local, f.data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); // 中央目录签名
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + size;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // 中央目录结束签名
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total =
    chunks.reduce((s, c) => s + c.length, 0) + cdSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(end, pos);
  return out;
}

/* ---------------- OOXML ---------------- */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

// A4 纵向：11906 x 16838 twips，页边距 2.54cm = 1440
const SECT_PR =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>' +
  '</w:sectPr>';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // 去掉 XML 非法的控制字符
}

function paragraph(text, sizePt) {
  const halfPt = Math.max(2, Math.min(80, Math.round(sizePt * 2)));
  return (
    '<w:p><w:pPr><w:spacing w:before="0" w:after="20" w:line="276" w:lineRule="auto"/></w:pPr>' +
    '<w:r><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/>' +
    `<w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/>` +
    '</w:rPr>' +
    `<w:t xml:space="preserve">${esc(text)}</w:t>` +
    '</w:r></w:p>'
  );
}

/**
 * @param {{lines: {text: string, sizePt: number}[]}[]} pages 每页一组行
 * @returns {Uint8Array} docx 文件字节
 */
export function buildDocx(pages) {
  const body = [];
  pages.forEach((page, i) => {
    if (i > 0) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    for (const line of page.lines) {
      if (!line.text || !line.text.trim()) continue;
      body.push(paragraph(line.text, line.sizePt || 10.5));
    }
  });

  const documentXml =
    XML_HEAD +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    body.join('') +
    SECT_PR +
    '</w:body></w:document>';

  return zipStore([
    { name: '[Content_Types].xml', data: utf8.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: utf8.encode(RELS) },
    { name: 'word/document.xml', data: utf8.encode(documentXml) },
  ]);
}

/**
 * 把 ML Kit 的 blocks 拍平成行，并按整页行高推算字号。
 * @param {{text:string, lines: {text:string, boundingBox?:{top:number,bottom:number}}[]}[]} blocks
 * @param {number} imageHeight 图片像素高
 */
export function blocksToLines(blocks, imageHeight) {
  const lines = [];
  for (const block of blocks || []) {
    for (const line of block.lines || []) {
      const box = line.boundingBox;
      const h = box ? box.bottom - box.top : 0;
      lines.push({ text: line.text, heightPx: h });
    }
  }
  if (!lines.length) return [];

  // 页面正文基准字号（中位数），避免字号忽大忽小
  const heights = lines.map((l) => l.heightPx).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const toPt = (px) => (px / Math.max(imageHeight, 1)) * 841.89 * 0.75;

  const bodyPt = median ? clampPt(toPt(median)) : 10.5;
  return lines.map((l) => {
    const ratio = median ? l.heightPx / median : 1;
    const sizePt = ratio >= 0.85 && ratio <= 1.2 ? bodyPt : clampPt(toPt(l.heightPx || median));
    return { text: l.text, sizePt };
  });
}

function clampPt(v) {
  return Math.max(7, Math.min(40, Math.round(v * 2) / 2));
}

export function linesToText(pages) {
  return pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n');
}
