/* 校验生成的 PDF 结构：node tools/check-pdf.mjs <文件路径>
 * 检查：头部、交叉引用表偏移、每个 stream 的 /Length 是否与实际字节数一致、结尾。
 */
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/check-pdf.mjs <file.pdf>');
  process.exit(2);
}

const buf = await readFile(file);
const text = buf.toString('latin1');
let bad = 0;
const ok = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`);
  if (!cond) bad++;
};

ok('文件头 %PDF-', text.startsWith('%PDF-'));
ok('结尾 %%EOF', text.trimEnd().endsWith('%%EOF'));

const xrefPos = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
ok('startxref 有效', text.slice(xrefPos, xrefPos + 4) === 'xref', `位置 ${xrefPos}`);

const lines = text.slice(xrefPos).split('\n');
const count = Number(lines[1].split(' ')[1]);
console.log(`  对象数量 ${count - 1}`);

for (let num = 1; num < count; num++) {
  const offset = Number(lines[1 + num + 1].slice(0, 10));
  const head = text.slice(offset, offset + 20).split('\n')[0];
  if (!head.startsWith(`${num} 0 obj`)) {
    ok(`对象 ${num} 偏移`, false, JSON.stringify(head));
  }
}

// 逐个 stream 校验 /Length（只匹配 ">>\nstream\n" 前的 /Length，避免误命中 endstream 或 JPEG 内的字节）
let streams = 0;
let lengthErrors = 0;
const re = /\/Length (\d+)\s*>>\s*\n?stream\n/g;
let m;
while ((m = re.exec(text)) !== null) {
  const len = Number(m[1]);
  const start = m.index + m[0].length;
  const after = text.slice(start + len, start + len + 12);
  if (!after.startsWith('\nendstream')) {
    lengthErrors++;
    console.log(`      stream 在 ${start} 处长度不匹配：期望 ${len}，其后是 ${JSON.stringify(after)}`);
  }
  streams++;
  re.lastIndex = start + len;
}
ok(`stream 的 /Length 全部正确（共 ${streams} 段）`, lengthErrors === 0 && streams > 0);
void dictStartUnused();
function dictStartUnused() {}

const pages = (text.match(/\/Type \/Page[^s]/g) || []).length;
const images = (text.match(/\/Subtype \/Image/g) || []).length;
console.log(`  页面 ${pages} 个，嵌图 ${images} 张，文件 ${(buf.length / 1024).toFixed(1)} KB`);

console.log(bad ? `\n有问题 ${bad} 处` : '\n结构没问题');
process.exit(bad ? 1 : 0);
