'use strict';

/**
 * Fabriny Bakery — serveur HTTP sans dépendance.
 * Sert le site statique (public/) et expose l'API de commande (data/orders.json).
 */

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SHOP_FILE = path.join(DATA_DIR, 'shop.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const ADMIN_KEY = process.env.ADMIN_KEY || 'fabriny2026';
const STATUSES = ['recue', 'preparation', 'prete', 'retiree', 'annulee'];
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

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

let ordersChain = Promise.resolve();

/** Sérialise les accès en écriture au fichier de commandes. */
function withOrdersLock(task) {
  const run = ordersChain.then(task, task);
  ordersChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function fail(res, status, message, fields) {
  sendJson(res, status, { error: message, fields: fields || undefined });
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

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function sameSecret(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Limiteur simple par IP (fenêtre glissante grossière). */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  if (buckets.size > 5000) buckets.clear();
  return entry.count <= max;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newOrderCode() {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return `FB-${out}`;
}

/* ------------------------------------------------------------------ */
/* Domaine                                                             */
/* ------------------------------------------------------------------ */

async function getCatalog() {
  const catalog = await readJson(PRODUCTS_FILE, { categories: [], products: [] });
  return catalog;
}

async function getShop() {
  return readJson(SHOP_FILE, {});
}

function publicOrder(order) {
  return {
    code: order.code,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    mode: order.mode,
    customer: { name: order.customer.name, phone: order.customer.phone },
    address: order.address || null,
    note: order.note || '',
    items: order.items,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    currency: order.currency,
    eta: order.eta,
    history: order.history
  };
}

async function createOrder(payload) {
  const [catalog, shop] = await Promise.all([getCatalog(), getShop()]);
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  const fields = {};

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const merged = new Map();
  for (const line of rawItems) {
    const id = String(line && line.id ? line.id : '');
    const qty = Number(line && line.qty);
    if (!byId.has(id)) continue;
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) continue;
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  if (!merged.size) {
    fields.items = 'Votre panier est vide.';
  } else if (merged.size > 25) {
    fields.items = 'Trop d’articles différents (25 maximum).';
  }

  const name = String(payload.customer?.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) {
    fields.name = 'Indiquez votre nom (2 à 60 caractères).';
  }

  const phone = digitsOnly(payload.customer?.phone);
  if (phone.length < 8 || phone.length > 15) {
    fields.phone = 'Numéro de téléphone invalide.';
  }

  const mode = payload.mode === 'livraison' ? 'livraison' : 'retrait';
  const address = String(payload.address || '').trim().replace(/\s+/g, ' ');
  if (mode === 'livraison' && (address.length < 5 || address.length > 200)) {
    fields.address = 'Précisez l’adresse de livraison (rue, numéro, repère).';
  }

  const note = String(payload.note || '').trim().slice(0, 300);

  if (Object.keys(fields).length) {
    return { errors: fields };
  }

  const items = [...merged.entries()].map(([id, qty]) => {
    const product = byId.get(id);
    return {
      id,
      name: product.name,
      price: product.price,
      qty,
      lineTotal: product.price * qty
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const freeFrom = Number(shop.freeDeliveryFrom) || 0;
  const fee = Number(shop.deliveryFee) || 0;
  const deliveryFee = mode === 'livraison' && subtotal < freeFrom ? fee : 0;
  const now = new Date().toISOString();

  return {
    order: await withOrdersLock(async () => {
      const orders = await readJson(ORDERS_FILE, []);
      let code = newOrderCode();
      while (orders.some((o) => o.code === code)) code = newOrderCode();

      const order = {
        code,
        status: 'recue',
        createdAt: now,
        updatedAt: now,
        mode,
        customer: { name, phone },
        address: mode === 'livraison' ? address : null,
        note,
        items,
        subtotal,
        deliveryFee,
        total: subtotal + deliveryFee,
        currency: shop.currency || 'FC',
        eta: Number(shop.prepMinutes) || 20,
        history: [{ status: 'recue', at: now }]
      };

      orders.unshift(order);
      await writeJsonAtomic(ORDERS_FILE, orders.slice(0, 500));
      return order;
    })
  };
}

/* ------------------------------------------------------------------ */
/* Routage API                                                         */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const isAdmin =
    sameSecret(req.headers['x-admin-key'], ADMIN_KEY) || sameSecret(url.searchParams.get('key'), ADMIN_KEY);

  if (req.method === 'GET' && parts[1] === 'health') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (req.method === 'GET' && parts[1] === 'config') {
    const [shop, catalog] = await Promise.all([getShop(), getCatalog()]);
    return sendJson(res, 200, {
      shop,
      categories: catalog.categories,
      statuses: STATUSES
    });
  }

  if (req.method === 'GET' && parts[1] === 'products') {
    const catalog = await getCatalog();
    return sendJson(res, 200, catalog);
  }

  if (req.method === 'POST' && parts[1] === 'orders' && parts.length === 2) {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!rateLimit(`order:${ip}`, 25, 5 * 60 * 1000)) {
      return fail(res, 429, 'Trop de commandes envoyées. Réessayez dans quelques minutes.');
    }
    const payload = await readBody(req);
    const result = await createOrder(payload);
    if (result.errors) return fail(res, 422, 'Vérifiez les informations du formulaire.', result.errors);
    return sendJson(res, 201, { order: publicOrder(result.order) });
  }

  if (req.method === 'GET' && parts[1] === 'orders' && parts[2]) {
    const code = decodeURIComponent(parts[2]).trim().toUpperCase();
    const phone = digitsOnly(url.searchParams.get('phone'));
    const orders = await readJson(ORDERS_FILE, []);
    const order = orders.find((o) => o.code === code);
    if (!order) return fail(res, 404, 'Aucune commande ne correspond à ce numéro.');
    const storedPhone = digitsOnly(order.customer.phone);
    const matches = phone.length >= 8 && storedPhone.slice(-8) === phone.slice(-8);
    if (!matches && !isAdmin) return fail(res, 403, 'Le numéro de téléphone ne correspond pas.');
    return sendJson(res, 200, { order: publicOrder(order) });
  }

  if (parts[1] === 'admin' && parts[2] === 'orders') {
    if (!isAdmin) return fail(res, 401, 'Clé administrateur invalide.');

    if (req.method === 'GET' && !parts[3]) {
      const orders = await readJson(ORDERS_FILE, []);
      return sendJson(res, 200, { orders });
    }

    if (req.method === 'PATCH' && parts[3]) {
      const code = decodeURIComponent(parts[3]).trim().toUpperCase();
      const payload = await readBody(req);
      const status = String(payload.status || '');
      if (!STATUSES.includes(status)) {
        return fail(res, 422, `Statut inconnu. Valeurs possibles : ${STATUSES.join(', ')}.`);
      }
      const updated = await withOrdersLock(async () => {
        const orders = await readJson(ORDERS_FILE, []);
        const order = orders.find((o) => o.code === code);
        if (!order) return null;
        const now = new Date().toISOString();
        order.status = status;
        order.updatedAt = now;
        order.history = Array.isArray(order.history) ? order.history : [];
        order.history.push({ status, at: now });
        await writeJsonAtomic(ORDERS_FILE, orders);
        return order;
      });
      if (!updated) return fail(res, 404, 'Commande introuvable.');
      return sendJson(res, 200, { order: updated });
    }
  }

  return fail(res, 404, 'Point d’API inconnu.');
}

/* ------------------------------------------------------------------ */
/* Fichiers statiques                                                  */
/* ------------------------------------------------------------------ */

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);

  // /admin/ -> /admin : évite de casser les chemins relatifs des assets
  if (pathname.length > 1 && pathname.endsWith('/')) {
    res.writeHead(301, { location: pathname.replace(/\/+$/, '') });
    return res.end();
  }

  // Certains navigateurs demandent /favicon.ico même avec un SVG déclaré
  if (pathname === '/favicon.ico') {
    res.writeHead(302, { location: '/assets/favicon.svg' });
    return res.end();
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/menu' || pathname === '/commander') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  if (pathname === '/suivi') pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    return fail(res, 403, 'Accès refusé.');
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
    return fail(res, 404, 'Page introuvable.');
  }

  if (stat.isDirectory()) {
    return serveStatic(req, res, new URL(`${url.pathname.replace(/\/?$/, '/')}index.html`, 'http://localhost'));
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // HTML et code : revalidation systématique (le site évolue) ;
  // images et polices : cache long.
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
  const stream = require('node:fs').createReadStream(filePath);
  stream.on('error', () => res.destroy());
  return stream.pipe(res);
}

/* ------------------------------------------------------------------ */
/* Serveur                                                             */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'ALLOWALL');

  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PATCH', 'OPTIONS', 'HEAD'].includes(req.method)) {
        return fail(res, 405, 'Méthode non autorisée.');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { allow: 'GET, POST, PATCH, OPTIONS' });
        return res.end();
      }
      return await handleApi(req, res, url);
    }

    if (!['GET', 'HEAD'].includes(req.method)) {
      return fail(res, 405, 'Méthode non autorisée.');
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[erreur]', err);
    if (!res.headersSent) return fail(res, status, err.message || 'Erreur interne.');
    res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fabriny Bakery — serveur prêt sur http://${HOST}:${PORT}`);
  console.log(`Admin : /admin (clé par défaut : ${ADMIN_KEY === 'fabriny2026' ? 'fabriny2026' : 'définie via ADMIN_KEY'})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
