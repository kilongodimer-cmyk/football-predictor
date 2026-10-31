'use strict';

/** Règles métier des commandes : validation, calcul des totaux, statuts. */

const crypto = require('node:crypto');
const { getCatalog, getShop } = require('./catalog');
const { readOrders, writeOrders, withLock } = require('./store');

const STATUSES = ['recue', 'preparation', 'prete', 'retiree', 'annulee'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function newOrderCode() {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return `FB-${out}`;
}

/** Version publique d'une commande (le téléphone complet n'est jamais exposé). */
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

async function createOrder(payload = {}) {
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

  const name = String((payload.customer && payload.customer.name) || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) {
    fields.name = 'Indiquez votre nom (2 à 60 caractères).';
  }

  const phone = digitsOnly(payload.customer && payload.customer.phone);
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
    order: await withLock(async () => {
      const orders = await readOrders();
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
      await writeOrders(orders);
      return order;
    })
  };
}

async function findOrder(code) {
  const orders = await readOrders();
  return orders.find((o) => o.code === code) || null;
}

async function updateOrderStatus(code, status) {
  if (!STATUSES.includes(status)) return { error: 'status' };

  return withLock(async () => {
    const orders = await readOrders();
    const order = orders.find((o) => o.code === code);
    if (!order) return { error: 'notfound' };

    const now = new Date().toISOString();
    order.status = status;
    order.updatedAt = now;
    order.history = Array.isArray(order.history) ? order.history : [];
    order.history.push({ status, at: now });
    await writeOrders(orders);
    return { order };
  });
}

async function listOrders() {
  return readOrders();
}

/** Le téléphone fourni doit correspondre aux 8 derniers chiffres enregistrés. */
function phoneMatches(order, phone) {
  const provided = digitsOnly(phone);
  const stored = digitsOnly(order.customer.phone);
  return provided.length >= 8 && stored.slice(-8) === provided.slice(-8);
}

module.exports = {
  STATUSES,
  createOrder,
  findOrder,
  updateOrderStatus,
  listOrders,
  publicOrder,
  phoneMatches,
  digitsOnly
};
