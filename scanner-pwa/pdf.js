/* 极简 PDF 生成器：把若干张 JPEG 拼成多页 PDF。
 * 不依赖任何第三方库。PDF 原生支持直接嵌入 JPEG（DCTDecode），
 * 所以这里只做对象拼装 + 交叉引用表，不重新编码图片。
 */

const A4_SHORT = 595.276;
const A4_LONG = 841.89;

const enc = new TextEncoder();
const ascii = (s) => enc.encode(s);

/**
 * @param {{jpeg: Uint8Array, width: number, height: number}[]} pages
 * @returns {Uint8Array}
 */
export function buildPdf(pages) {
  if (!pages.length) throw new Error('没有页面');

  const n = pages.length;
  const objCount = 2 + n * 3; // 1 catalog, 2 pages, 之后每页 3 个对象
  const parts = [];
  let offset = 0;
  const offsets = new Array(objCount + 1).fill(0);

  const push = (bytes) => {
    parts.push(bytes);
    offset += bytes.length;
  };

  const beginObj = (num) => {
    offsets[num] = offset;
    push(ascii(`${num} 0 obj\n`));
  };
  const endObj = () => push(ascii('endobj\n'));

  /* 文件头（第二行是二进制标记，PDF 规范要求） */
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])); // %PDF-1.4\n
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  /* 1: 目录 */
  beginObj(1);
  push(ascii('<< /Type /Catalog /Pages 2 0 R >>\n'));
  endObj();

  /* 2: 页面树 */
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  beginObj(2);
  push(ascii(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>\n`));
  endObj();

  for (let i = 0; i < n; i++) {
    const pageNum = 3 + i * 3;
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    const img = pages[i];

    const landscape = img.width >= img.height;
    const pw = landscape ? A4_LONG : A4_SHORT;
    const ph = landscape ? A4_SHORT : A4_LONG;
    const scale = Math.min(pw / img.width, ph / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (pw - dw) / 2;
    const dy = (ph - dh) / 2;

    const content = `q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const contentBytes = ascii(content);

    /* 页对象 */
    beginObj(pageNum);
    push(
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(
          2
        )}] /Resources << /XObject << /Im0 ${imageNum} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentNum} 0 R >>\n`
      )
    );
    endObj();

    /* 内容流 */
    beginObj(contentNum);
    push(ascii(`<< /Length ${contentBytes.length} >>\nstream\n`));
    push(contentBytes);
    push(ascii('\nendstream\n'));
    endObj();

    /* 图片 XObject，原始 JPEG 字节直接塞进去 */
    beginObj(imageNum);
    push(
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
      )
    );
    push(img.jpeg);
    push(ascii('\nendstream\n'));
    endObj();
  }

  /* 交叉引用表 */
  const xrefOffset = offset;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (let num = 1; num <= objCount; num++) {
    xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  push(ascii(xref));
  push(
    ascii(
      `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    )
  );

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
