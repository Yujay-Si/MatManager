'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
};

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
  response.end(body);
}

function safePath(requestUrl) {
  const url = new URL(requestUrl, `http://${HOST}:${PORT}`);
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method Not Allowed');
    return;
  }
  const target = safePath(request.url);
  if (!target) {
    send(response, 403, 'Forbidden');
    return;
  }
  fs.stat(target, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(response, 404, 'Not Found');
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(target).on('error', () => {
      if (!response.headersSent) send(response, 500, 'Internal Server Error');
      else response.destroy();
    }).pipe(response);
  });
});

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' :
    process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请关闭占用该端口的窗口，或设置 PORT 环境变量后重试。`);
  } else {
    console.error('预览服务启动失败：', error.message);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`材料数据计算 · 独立版已启动`);
  console.log(`访问地址：${url}`);
  console.log('按 Ctrl+C 停止服务。');
  if (process.argv.includes('--open')) openBrowser(url);
});
