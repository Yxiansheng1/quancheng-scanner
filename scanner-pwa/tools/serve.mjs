/* 本地预览服务器：node tools/serve.mjs [端口]
 * iPhone 想直接连：保证手机和电脑在同一个 Wi-Fi，访问 http://<电脑内网IP>:8080
 * 注意：Safari 只在 https 或 localhost 下允许调用摄像头/文件选择，局域网 http 基本不可用，
 *      真机测试建议直接用 GitHub Pages（https）。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = normalize(join(root, url));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) filePath = join(filePath, 'index.html');

    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(port, () => {
  console.log(`预览地址: http://localhost:${port}`);
});
