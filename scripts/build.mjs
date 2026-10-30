/* 构建：把 scanner-pwa/ 打包成 www/
 *
 * 为什么要打包：Android App 里的网页跑在 WebView 里，浏览器不认识
 * `@capacitor/filesystem` 这种「裸模块名」，必须由打包器解析成实际文件。
 * 所以网页版和 App 版共用同一份产物 www/，行为完全一致。
 *
 * 用法: node scripts/build.mjs
 */
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const src = join(root, 'scanner-pwa');
const out = join(root, 'www');

const STATIC_FILES = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js'];
const STATIC_DIRS = ['icons', 'vendor'];

if (!existsSync(src)) {
  console.error('找不到 scanner-pwa/');
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

/* 1. 打包 JS。
 * app.js 里对 native.js 用的是动态 import，esbuild 在不开分包时会把它
 * 连同 @capacitor/* 一起内联进同一个文件 —— 正好，App 里只需要一个 app.js，
 * 不用管 chunk 路径。 */
await esbuild.build({
  entryPoints: [join(src, 'app.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  outfile: join(out, 'app.js'),
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: '/* 全澄扫描王 — 由 scanner-pwa/ 构建，请勿直接改 www/ */',
  },
});

/* 2. 静态资源 */
for (const f of STATIC_FILES) {
  const from = join(src, f);
  if (existsSync(from)) await cp(from, join(out, f));
}
for (const d of STATIC_DIRS) {
  const from = join(src, d);
  if (existsSync(from)) await cp(from, join(out, d), { recursive: true });
}

let total = 0;
for (const f of await readdir(out, { recursive: true })) {
  const s = await stat(join(out, f)).catch(() => null);
  if (s && s.isFile()) total += s.size;
}
console.log(`www/ 构建完成，共 ${(total / 1024).toFixed(0)} KB`);
