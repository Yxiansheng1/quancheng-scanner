/* 预览服务器：把 www/（构建产物）跑起来
 * 用法: node scripts/serve.mjs [端口]
 * 手机同 WiFi 直接访问 http://<本机内网IP>:<端口>
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = fileURLToPath(new URL('../www/', import.meta.url));
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
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
  '.traineddata': 'application/octet-stream',
};

const server = createServer(async (req, res) => {
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
      // 让 WASM 线程能力可用
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
});

server.listen(port, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  console.log(`本机: http://localhost:${port}`);
  for (const ip of ips) console.log(`手机: http://${ip}:${port}`);
});
