'use strict';

/**
 * Cœur de l'API, indépendant du serveur HTTP.
 * Utilisé par server.js (local) et par la fonction serverless api/[...path].js (Vercel).
 */

const crypto = require('node:crypto');
const { getCatalog, getShop } = require('./catalog');
const {
  STATUSES,
  createOrder,
  findOrder,
  updateOrderStatus,
  listOrders,
  publicOrder,
  phoneMatches
} = require('./orders');

const ADMIN_KEY = process.env.ADMIN_KEY || 'fabriny2026';

function sameSecret(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Limiteur simple, par instance de serveur. */
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

const ok = (body, status = 200) => ({ status, body });
const fail = (status, error, fields) => ({ status, body: { error, fields: fields || undefined } });

/**
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.pathname      ex. /api/orders/FB-ABC12
 * @param {URLSearchParams} request.searchParams
 * @param {object} request.headers
 * @param {object} request.body          corps déjà désérialisé
 * @param {string} request.ip
 */
async function handleApiRequest({ method, pathname, searchParams, headers = {}, body = {}, ip = 'unknown' }) {
  const parts = String(pathname || '').split('/').filter(Boolean); // ['api', ...]
  const headerKey = headers['x-admin-key'] || headers['X-Admin-Key'];
  const isAdmin = sameSecret(headerKey, ADMIN_KEY) || sameSecret(searchParams.get('key'), ADMIN_KEY);

  if (method === 'GET' && parts[1] === 'health') {
    return ok({ ok: true, time: new Date().toISOString() });
  }

  if (method === 'GET' && parts[1] === 'config') {
    const [shop, catalog] = await Promise.all([getShop(), getCatalog()]);
    return ok({ shop, categories: catalog.categories, statuses: STATUSES });
  }

  if (method === 'GET' && parts[1] === 'products') {
    return ok(await getCatalog());
  }

  if (method === 'POST' && parts[1] === 'orders' && parts.length === 2) {
    if (!rateLimit(`order:${ip}`, 25, 5 * 60 * 1000)) {
      return fail(429, 'Trop de commandes envoyées. Réessayez dans quelques minutes.');
    }
    const result = await createOrder(body || {});
    if (result.errors) return fail(422, 'Vérifiez les informations du formulaire.', result.errors);
    return ok({ order: publicOrder(result.order) }, 201);
  }

  if (method === 'GET' && parts[1] === 'orders' && parts[2]) {
    const code = decodeURIComponent(parts[2]).trim().toUpperCase();
    const order = await findOrder(code);
    if (!order) return fail(404, 'Aucune commande ne correspond à ce numéro.');
    const phone = searchParams.get('phone') || '';
    if (!phoneMatches(order, phone) && !isAdmin) {
      return fail(403, 'Le numéro de téléphone ne correspond pas.');
    }
    return ok({ order: publicOrder(order) });
  }

  if (parts[1] === 'admin' && parts[2] === 'orders') {
    if (!isAdmin) return fail(401, 'Clé administrateur invalide.');

    if (method === 'GET' && !parts[3]) {
      return ok({ orders: await listOrders() });
    }

    if (method === 'PATCH' && parts[3]) {
      const code = decodeURIComponent(parts[3]).trim().toUpperCase();
      const status = String((body && body.status) || '');
      const result = await updateOrderStatus(code, status);
      if (result.error === 'status') {
        return fail(422, `Statut inconnu. Valeurs possibles : ${STATUSES.join(', ')}.`);
      }
      if (result.error === 'notfound') return fail(404, 'Commande introuvable.');
      return ok({ order: result.order });
    }
  }

  return fail(404, 'Point d’API inconnu.');
}

module.exports = { handleApiRequest, ADMIN_KEY };
