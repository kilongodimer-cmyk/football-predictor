'use strict';

/**
 * Persistance des commandes.
 *
 * Trois adaptateurs, choisis automatiquement :
 *   1. Vercel KV / Upstash Redis (si KV_REST_API_URL + KV_REST_API_TOKEN)
 *   2. fichier JSON (local, ou /tmp sur Vercel)
 *   3. mémoire du processus (dernier recours, données non persistantes)
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const { DATA_DIR } = require('./catalog');

const KV_URL = (process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const KV_KEY = process.env.ORDERS_KEY || 'fabriny:orders';

const FILE = process.env.ORDERS_FILE
  || (process.env.VERCEL ? '/tmp/fabriny-orders.json' : path.join(DATA_DIR, 'orders.json'));

const MAX_ORDERS = 500;

let memoryStore = null;
let chain = Promise.resolve();

function kvEnabled() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kv(command, payload) {
  const response = await fetch(`${KV_URL}/${command}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${KV_TOKEN}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Stockage KV indisponible (${response.status})`);
  return response.json();
}

async function readOrders() {
  if (kvEnabled()) {
    const result = await kv(`get/${encodeURIComponent(KV_KEY)}`);
    const raw = result && result.result;
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return memoryStore || [];
    // système de fichiers non inscriptible : on bascule en mémoire
    return memoryStore || [];
  }
}

async function writeOrders(orders) {
  const trimmed = orders.slice(0, MAX_ORDERS);

  if (kvEnabled()) {
    await kv(`set/${encodeURIComponent(KV_KEY)}`, JSON.stringify(trimmed));
    return;
  }

  try {
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
    await fsp.rename(tmp, FILE);
    memoryStore = null;
  } catch {
    memoryStore = trimmed;
  }
}

/** Sérialise les lectures/écritures pour éviter les écritures concurrentes. */
function withLock(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

module.exports = {
  readOrders,
  writeOrders,
  withLock,
  storageMode: () => (kvEnabled() ? 'kv' : process.env.VERCEL ? 'tmp' : 'file'),
  FILE
};
