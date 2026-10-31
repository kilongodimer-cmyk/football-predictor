'use strict';

/**
 * Fabriny Bakery — serveur de développement / auto-hébergement (sans dépendance).
 * Sert le site statique (public/) et l'API (lib/api.js).
 * En production sur Vercel, c'est la fonction api/[...path].js qui sert l'API.
 */

const http = require('node:http');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { handleApiRequest } = require('./lib/api');
const { storageMode } = require('./lib/store');

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Corps de requête trop volumineux'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON invalide'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.length > 1 && pathname.endsWith('/')) {
    res.writeHead(301, { location: pathname.replace(/\/+$/, '') });
    return res.end();
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(302, { location: '/assets/favicon.svg' });
    return res.end();
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/menu' || pathname === '/commander' || pathname === '/suivi') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    return sendJson(res, 403, { error: 'Accès refusé.' });
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    const notFound = await fsp.readFile(path.join(PUBLIC_DIR, '404.html'), 'utf8').catch(() => null);
    if (notFound) {
      res.writeHead(404, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(notFound);
    }
    return sendJson(res, 404, { error: 'Page introuvable.' });
  }

  if (stat.isDirectory()) {
    return serveStatic(req, res, new URL(`${url.pathname.replace(/\/?$/, '/')}index.html`, 'http://localhost'));
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const cacheControl = ext === '.html' || ext === '.css' || ext === '.js'
    ? 'no-cache'
    : 'public, max-age=604800';

  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff'
  });

  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  return stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'ALLOWALL');

  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PATCH', 'OPTIONS', 'HEAD'].includes(req.method)) {
        return sendJson(res, 405, { error: 'Méthode non autorisée.' });
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { allow: 'GET, POST, PATCH, OPTIONS' });
        return res.end();
      }

      const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await handleApiRequest({
        method: req.method,
        pathname: url.pathname,
        searchParams: url.searchParams,
        headers: req.headers,
        body,
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
      });
      return sendJson(res, result.status, result.body);
    }

    if (!['GET', 'HEAD'].includes(req.method)) {
      return sendJson(res, 405, { error: 'Méthode non autorisée.' });
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[erreur]', err);
    if (!res.headersSent) return sendJson(res, status, { error: err.message || 'Erreur interne.' });
    res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fabriny Bakery — serveur prêt sur http://${HOST}:${PORT}`);
  console.log(`Stockage des commandes : ${storageMode()}`);
  console.log('Admin : /admin (clé via ADMIN_KEY, défaut fabriny2026)');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
