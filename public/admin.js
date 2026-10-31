'use strict';

/* Fabriny Bakery — espace équipe : suivi et traitement des commandes */

const KEY_STORE = 'fabriny.admin-key';
const TZ = 'Africa/Lubumbashi';

const ui = {
  gate: document.querySelector('[data-gate]'),
  dashboard: document.querySelector('[data-dashboard]'),
  loginForm: document.querySelector('[data-login-form]'),
  loginInput: document.querySelector('#admin-key'),
  loginError: document.querySelector('[data-login-error]'),
  logout: document.querySelector('[data-logout]'),
  stats: document.querySelector('[data-stats]'),
  filters: document.querySelector('[data-admin-filters]'),
  orders: document.querySelector('[data-orders]'),
  empty: document.querySelector('[data-orders-empty]'),
  refresh: document.querySelector('[data-refresh]'),
  toast: document.querySelector('[data-toast]')
};

const state = {
  key: sessionStorage.getItem(KEY_STORE) || '',
  orders: [],
  filter: 'actives',
  loading: false,
  timer: null
};

const nf = new Intl.NumberFormat('fr-FR');

const money = (value) => `${nf.format(Number(value) || 0)} FC`;

const STATUS = {
  recue: { label: 'Reçue', state: 'recue' },
  preparation: { label: 'En préparation', state: 'preparation' },
  prete: { label: 'Prête', state: 'prete' },
  retiree: { label: 'Récupérée', state: 'retiree' },
  annulee: { label: 'Annulée', state: 'annulee' }
};

const NEXT = {
  recue: { status: 'preparation', label: 'Accepter' },
  preparation: { status: 'prete', label: 'Marquer prête' },
  prete: { status: 'retiree', label: 'Récupérée' }
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function timeLabel(iso) {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function isToday(iso) {
  try {
    const fmt = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
    return fmt(new Date(iso)) === fmt(new Date());
  } catch {
    return false;
  }
}

let toastTimer;
function toast(message) {
  if (!ui.toast) return;
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  requestAnimationFrame(() => ui.toast.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove('is-visible');
    setTimeout(() => {
      ui.toast.hidden = true;
    }, 300);
  }, 2400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-admin-key': state.key,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    logout(true);
    throw new Error('Clé administrateur invalide.');
  }
  if (!response.ok) throw new Error(payload.error || 'Erreur serveur.');
  return payload;
}

function showDashboard() {
  ui.gate.hidden = true;
  ui.dashboard.hidden = false;
  ui.logout.hidden = false;
}

function logout(silent = false) {
  sessionStorage.removeItem(KEY_STORE);
  state.key = '';
  state.orders = [];
  clearInterval(state.timer);
  ui.gate.hidden = false;
  ui.dashboard.hidden = true;
  ui.logout.hidden = true;
  if (!silent) toast('Déconnecté de l’espace équipe.');
}

async function loadOrders() {
  if (state.loading) return;
  state.loading = true;
  try {
    const { orders } = await api('/api/admin/orders');
    state.orders = Array.isArray(orders) ? orders : [];
    render();
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
  }
}

function renderStats() {
  const today = state.orders.filter((order) => isToday(order.createdAt));
  const active = state.orders.filter((order) => ['recue', 'preparation', 'prete'].includes(order.status));
  const revenue = today
    .filter((order) => order.status !== 'annulee')
    .reduce((sum, order) => sum + order.total, 0);
  const cards = [
    { label: 'Commandes du jour', value: today.length },
    { label: 'En cours', value: active.length, accent: active.length > 0 },
    { label: 'Prêtes à servir', value: state.orders.filter((o) => o.status === 'prete').length },
    { label: 'Recette du jour', value: money(revenue) }
  ];
  ui.stats.innerHTML = cards
    .map(
      (card) => `<div class="stat ${card.accent ? 'is-accent' : ''}">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
      </div>`
    )
    .join('');
}

function renderFilters() {
  const active = state.orders.filter((order) => ['recue', 'preparation', 'prete'].includes(order.status));
  const chips = [
    { id: 'actives', label: 'À traiter', count: active.length },
    { id: 'toutes', label: 'Toutes', count: state.orders.length },
    { id: 'prete', label: 'Prêtes', count: state.orders.filter((o) => o.status === 'prete').length },
    { id: 'retiree', label: 'Terminées', count: state.orders.filter((o) => o.status === 'retiree').length },
    { id: 'annulee', label: 'Annulées', count: state.orders.filter((o) => o.status === 'annulee').length }
  ];
  ui.filters.innerHTML = chips
    .map(
      (chip) => `<button type="button" class="chip ${chip.id === state.filter ? 'is-active' : ''}" data-filter="${chip.id}">
        ${chip.label}<span>${chip.count}</span></button>`
    )
    .join('');
}

function filteredOrders() {
  if (state.filter === 'actives') {
    return state.orders.filter((order) => ['recue', 'preparation', 'prete'].includes(order.status));
  }
  if (state.filter === 'toutes') return state.orders;
  return state.orders.filter((order) => order.status === state.filter);
}

function orderTemplate(order) {
  const items = order.items
    .map((item) => `<div>${item.qty} × ${escapeHtml(item.name)} <span>— ${money(item.lineTotal)}</span></div>`)
    .join('');
  const next = NEXT[order.status];
  const actions = [];
  if (next) {
    actions.push(`<button type="button" class="action-btn is-primary" data-advance="${escapeHtml(order.code)}" data-to="${next.status}">${next.label}</button>`);
  }
  if (!['retiree', 'annulee'].includes(order.status)) {
    actions.push(`<button type="button" class="action-btn is-danger" data-advance="${escapeHtml(order.code)}" data-to="annulee">Annuler</button>`);
  }
  if (order.status === 'annulee') {
    actions.push(`<button type="button" class="action-btn" data-advance="${escapeHtml(order.code)}" data-to="recue">Rétablir</button>`);
  }

  const mode = order.mode === 'livraison' ? 'Livraison' : 'Retrait';
  const phone = String(order.customer.phone || '');

  return `<article class="order ${order.status === 'recue' ? 'is-new' : ''}">
    <div class="order-head">
      <div>
        <p class="order-code">${escapeHtml(order.code)}</p>
        <p class="order-meta">
          <span>${escapeHtml(order.customer.name)}</span>
          <span>${escapeHtml(phone)}</span>
          <span>${timeLabel(order.createdAt)}</span>
          <span>${mode}${order.mode === 'livraison' && order.address ? ` · ${escapeHtml(order.address)}` : ''}</span>
        </p>
      </div>
      <span class="order-badge" data-state="${order.status}">${STATUS[order.status]?.label || order.status}</span>
    </div>
    <div class="order-items">${items}</div>
    ${order.note ? `<div class="order-items"><span>Note :</span> ${escapeHtml(order.note)}</div>` : ''}
    <div class="order-foot">
      <span class="order-total">${money(order.total)}</span>
      <div class="order-actions">${actions.join('')}</div>
    </div>
  </article>`;
}

function render() {
  renderStats();
  renderFilters();
  const list = filteredOrders();
  ui.orders.innerHTML = list.map(orderTemplate).join('');
  ui.empty.hidden = list.length > 0;
}

async function advance(code, status) {
  try {
    await api(`/api/admin/orders/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    toast(`${code} → ${STATUS[status]?.label || status}`);
    await loadOrders();
  } catch (error) {
    toast(error.message);
  }
}

function bind() {
  ui.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = ui.loginInput.value.trim();
    if (!key) return;
    state.key = key;
    ui.loginError.hidden = true;
    try {
      const { orders } = await api('/api/admin/orders');
      sessionStorage.setItem(KEY_STORE, key);
      state.orders = orders || [];
      showDashboard();
      render();
      clearInterval(state.timer);
      state.timer = setInterval(loadOrders, 25_000);
      ui.loginInput.value = '';
    } catch (error) {
      state.key = '';
      ui.loginError.textContent = error.message;
      ui.loginError.hidden = false;
    }
  });

  ui.logout.addEventListener('click', () => logout());

  ui.refresh.addEventListener('click', () => loadOrders());

  ui.filters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    render();
  });

  ui.orders.addEventListener('click', (event) => {
    const button = event.target.closest('[data-advance]');
    if (!button) return;
    advance(button.dataset.advance, button.dataset.to);
  });
}

async function init() {
  bind();
  if (state.key) {
    try {
      const { orders } = await api('/api/admin/orders');
      state.orders = orders || [];
      showDashboard();
      render();
      state.timer = setInterval(loadOrders, 25_000);
      return;
    } catch {
      /* clé expirée : on retombe sur l'écran de connexion */
    }
  }
  ui.gate.hidden = false;
}

document.addEventListener('DOMContentLoaded', init);
