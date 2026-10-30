/* 测试 DOCX 生成器：node tools/test-docx.mjs
 * 检查：zip 结构、document.xml 合法性、段落与字号是否正确。
 * 用 Python 的 zipfile 交叉验证 zip 是不是标准格式。
 */
import { buildDocx, blocksToLines, linesToText } from '../docx.js';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

/* --- 极简 zip 读取（只处理 stored） --- */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let p = 0;
  while (p + 4 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const size = dv.getUint32(p + 22, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    if (method === 0) {
      files[name] = bytes.slice(start, start + size);
    }
    p = start + size;
  }
  return files;
}

console.log('\n[1] DOCX 结构');
const pages = [
  {
    lines: [
      { text: '房屋租赁合同', sizePt: 20 },
      { text: '出租方（甲方）：张建国', sizePt: 13 },
      { text: '承租方（乙方）：李晓雯', sizePt: 13 },
    ],
  },
  {
    lines: [
      { text: '第二条 租赁期限', sizePt: 13 },
      { text: '租赁期为一年。', sizePt: 13 },
    ],
  },
];

const bytes = buildDocx(pages);
check('有内容', bytes.length > 500, `${bytes.length} 字节`);

const files = readZip(bytes);
const names = Object.keys(files).sort();
check('包含 [Content_Types].xml', names.includes('[Content_Types].xml'), names.join(','));
check('包含 _rels/.rels', names.includes('_rels/.rels'));
check('包含 word/document.xml', names.includes('word/document.xml'));

const docXml = new TextDecoder().decode(files['word/document.xml']);
check('有 w:document 根标签', docXml.includes('<w:document'));
check('有 XML 声明', docXml.startsWith('<?xml version="1.0"'));
check('有 A4 页面设置', docXml.includes('w:w="11906"') && docXml.includes('w:h="16838"'));

console.log('\n[2] 内容与字号');
check('6 段文字都在', (docXml.match(/<w:p>/g) || []).length === 6, `实际 ${(docXml.match(/<w:p>/g) || []).length}`);
check('标题是 40 半磅(=20pt)', docXml.includes('<w:sz w:val="40"/>'));
check('正文是 26 半磅(=13pt)', docXml.includes('<w:sz w:val="26"/>'));
check('中文用了 eastAsia 字体', docXml.includes('w:eastAsia="SimSun"'));
check('有分页符', docXml.includes('w:type="page"'));
check('文字内容正确', docXml.includes('房屋租赁合同') && docXml.includes('租赁期为一年。'));

console.log('\n[3] XML 合法性');
const open = (docXml.match(/<w:[a-zA-Z]+[ >]/g) || []).length;
const close = (docXml.match(/<\/w:[a-zA-Z]+>/g) || []).length;
const selfClose = (docXml.match(/\/>/g) || []).length;
check(`标签数量平衡 (开${open} 闭${close} 自闭合${selfClose})`, open === close + selfClose);

const escaped = buildDocx([{ lines: [{ text: 'A&B <tag> "引号"', sizePt: 12 }] }]);
const xml2 = new TextDecoder().decode(readZip(escaped)['word/document.xml']);
check('特殊字符已转义', xml2.includes('A&amp;B') && xml2.includes('&lt;tag&gt;'));

console.log('\n[4] ML Kit 结果转行');
const blocks = [
  {
    lines: [
      { text: '标题', boundingBox: { top: 10, bottom: 60 } },
      { text: '正文第一行', boundingBox: { top: 80, bottom: 100 } },
      { text: '正文第二行', boundingBox: { top: 110, bottom: 130 } },
    ],
  },
];
const lines = blocksToLines(blocks, 1000);
check('拆成 3 行', lines.length === 3, `实际 ${lines.length}`);
check('文字没丢', lines.map((l) => l.text).join('') === '标题正文第一行正文第二行');
check('标题字号比正文大', lines[0].sizePt > lines[1].sizePt, `${lines[0].sizePt} vs ${lines[1].sizePt}`);
check('正文两行字号相同', Math.abs(lines[1].sizePt - lines[2].sizePt) < 0.01);

const text = linesToText([{ lines }]);
check('纯文本拼接正确', text.includes('标题') && text.includes('正文第二行'));

writeFileSync(join(here, 'sample.docx'), Buffer.from(bytes));
console.log('\n  已写出 scanner-pwa/tools/sample.docx，供 Word / python-docx 交叉验证');

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
