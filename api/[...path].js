'use strict';

/**
 * Point d'entrée serverless Vercel : toutes les routes /api/* arrivent ici.
 * La logique reste dans lib/api.js, partagée avec server.js.
 */

const { handleApiRequest } = require('../lib/api');

function toPathname(query) {
  const raw = query && query.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const clean = segments
    .filter((segment) => segment !== undefined && segment !== null && segment !== '')
    .map((segment) => encodeURIComponent(String(segment)));
  return `/api${clean.length ? `/${clean.join('/')}` : ''}`;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      return {};
    }
  }
  return body;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // Selon le runtime, req.url vaut /api/products, /products, ou rien d'exploitable :
  // on normalise systématiquement vers /api/<reste>.
  const rawPath = url.pathname || '/';
  const withoutApi = rawPath.replace(/^\/api(?=\/|$)/, '') || '/';
  const pathname = withoutApi === '/' && !rawPath.startsWith('/api')
    ? toPathname(req.query)
    : `/api${withoutApi === '/' ? '' : withoutApi}`;

  let result;
  try {
    result = await handleApiRequest({
      method: req.method,
      pathname,
      searchParams: url.searchParams,
      headers: req.headers,
      body: parseBody(req.body),
      ip
    });
  } catch (error) {
    console.error('[api]', error);
    result = { status: 500, body: { error: 'Erreur interne du serveur.' } };
  }

  res.statusCode = result.status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(result.body));
};
