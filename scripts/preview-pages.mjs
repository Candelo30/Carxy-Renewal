#!/usr/bin/env node
/**
 * Servidor local para probar exactamente la salida de GitHub Pages,
 * incluido el fallback 404.html para rutas profundas.
 *
 * Uso:
 *   npm run build:pages
 *   npm run preview:pages
 *   http://localhost:4300/Carxy-Renewal/
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve('dist/github-pages/browser');
const baseHref = (process.env.PAGES_BASE_HREF || '/Carxy-Renewal/').trim();
const port = Number(process.env.PORT || 4300);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(
    '[preview] No existe dist/github-pages/browser/index.html. Ejecuta `npm run build:pages`.',
  );
  process.exit(1);
}

function sendFile(res, filePath, status = 200) {
  const extension = extname(filePath).toLowerCase();
  res.writeHead(status, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  const host = req.headers.host || `localhost:${port}`;
  const requestUrl = new URL(req.url || '/', `http://${host}`);
  let pathname;

  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Solicitud inválida.');
    return;
  }

  if (!pathname.startsWith(baseHref)) {
    const withoutSlash = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
    if (pathname === withoutSlash) {
      res.writeHead(301, { Location: baseHref });
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Esta vista previa vive en ${baseHref}`);
    return;
  }

  const relativePath = pathname.slice(baseHref.length);
  let filePath = resolve(root, relativePath);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acceso denegado.');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  // Igual que GitHub Pages: shell de Angular para deep links desconocidos.
  sendFile(res, join(root, '404.html'), 404);
});

server.listen(port, () => {
  console.log(`[preview] GitHub Pages en http://localhost:${port}${baseHref}`);
  console.log('[preview] Pulsa Ctrl+C para detener el servidor.');
});
