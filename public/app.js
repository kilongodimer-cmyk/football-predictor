'use strict';

/* Fabriny Bakery — logique de la boutique (panier, commande, suivi) */

const TZ = 'Africa/Lubumbashi';
const CART_KEY = 'fabriny.cart.v1';
const LAST_ORDER_KEY = 'fabriny.last-order.v1';

const state = {
  shop: null,
  categories: [],
  products: [],
  filter: 'tout',
  mode: 'retrait',
  cart: [],
  lastOrder: null,
  submitting: false
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------ utils */

const nf = new Intl.NumberFormat('fr-FR');

function money(amount) {
  const currency = (state.shop && state.shop.currency) || 'FC';
  return `${nf.format(Number(amount) || 0)} ${currency}`;
}

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

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
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function loadStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : on continue sans persistance */
  }
}

let toastTimer;
function toast(message) {
  const el = $('[data-toast]');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => {
      el.hidden = true;
    }, 300);
  }, 2600);
}

/* ---------------------------------------------------- horaires / ouverture */

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_SHORT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function lubumbashiNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  const day = WEEKDAY_INDEX[get('weekday')] ?? now.getDay();
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { day, minutes: hour * 60 + minute };
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function humanHour(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

function computeOpenState() {
  const hours = (state.shop && state.shop.hours) || [];
  const { day, minutes } = lubumbashiNow();
  const today = hours.find((rule) => (rule.days || []).includes(day));
  if (today && minutes >= toMinutes(today.open) && minutes < toMinutes(today.close)) {
    return {
      open: true,
      label: 'Ouvert',
      note: `Ouvert aujourd'hui · ferme à ${humanHour(today.close)}`,
      today: `${humanHour(today.open)} – ${humanHour(today.close)}`
    };
  }
  let note = "Fermé pour le moment";
  if (today && minutes < toMinutes(today.open)) {
    note = `Fermé · ouvre à ${humanHour(today.open)}`;
  } else {
    for (let i = 1; i <= 7; i += 1) {
      const nextDay = (day + i) % 7;
      const rule = hours.find((r) => (r.days || []).includes(nextDay));
      if (rule) {
        note = `Fermé · réouverture ${DAY_SHORT[nextDay]} à ${humanHour(rule.open)}`;
        break;
      }
    }
  }
  return {
    open: false,
    label: 'Fermé',
    note,
    today: today ? `${humanHour(today.open)} – ${humanHour(today.close)}` : 'Fermé'
  };
}

function renderHours() {
  const list = $('[data-hours]');
  if (!list) return;
  const hours = (state.shop && state.shop.hours) || [];
  const { day } = lubumbashiNow();
  const groups = hours.map((rule) => {
    const days = [...(rule.days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const first = days[0];
    const last = days[days.length - 1];
    const label = days.length === 1
      ? DAY_NAMES[first]
      : days.length === 2 && days.includes(0) && days.includes(6)
        ? 'Samedi & dimanche'
        : `${DAY_NAMES[first]} – ${DAY_NAMES[last]}`;
    const isToday = days.includes(day);
    return `<li class="${isToday ? 'is-today' : ''}"><span>${label}</span><span>${humanHour(rule.open)} – ${humanHour(rule.close)}</span></li>`;
  });
  const closedDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !hours.some((r) => (r.days || []).includes(d)));
  if (closedDays.length) {
    groups.push(`<li><span>${closedDays.map((d) => DAY_NAMES[d]).join(', ')}</span><span>Fermé</span></li>`);
  }
  list.innerHTML = groups.join('');

  const openState = computeOpenState();
  const statusEl = $('[data-open-status]');
  if (statusEl) {
    statusEl.classList.toggle('is-closed', !openState.open);
    $('[data-open-label]', statusEl).textContent = openState.label;
  }
  const noteEl = $('[data-open-note]');
  if (noteEl) noteEl.textContent = openState.note;
  const todayEl = $('[data-shop-hours-today]');
  if (todayEl) todayEl.textContent = openState.today;
}

/* ------------------------------------------------------------------ shop */

function renderShop() {
  const shop = state.shop || {};
  const set = (sel, value) => {
    const el = $(sel);
    if (el && value != null) el.textContent = value;
  };

  set('[data-shop-announcement]', shop.announcement);
  set('[data-shop-phone]', shop.phone);
  set('[data-shop-address-line1]', shop.address && shop.address.line1);
  set('[data-shop-address-full]', shop.address
    ? `${shop.address.line2} · ${shop.address.city} · ${shop.address.region}`
    : '');
  set('[data-stat-products]', state.products.length);
  set('[data-delivery-fee]', money(shop.deliveryFee || 0));
  set('[data-year]', new Date().getFullYear());

  $$('[data-shop-phone-link]').forEach((el) => {
    el.href = `tel:${digits(shop.phone)}`;
  });
  $$('[data-shop-whatsapp]').forEach((el) => {
    el.href = `https://wa.me/${digits(shop.whatsapp)}`;
  });
  $$('[data-shop-maps]').forEach((el) => {
    el.href = shop.mapsUrl || '#';
  });
}

/* ------------------------------------------------------------------ carte */

function renderFilters() {
  const wrap = $('[data-filters]');
  if (!wrap) return;
  const total = state.products.length;
  const chips = [{ id: 'tout', label: 'Tout voir', count: total }].concat(
    state.categories.map((cat) => ({
      id: cat.id,
      label: cat.label,
      count: state.products.filter((p) => p.category === cat.id).length
    }))
  );
  wrap.innerHTML = chips
    .map(
      (chip) => `<button type="button" role="tab" class="chip ${chip.id === state.filter ? 'is-active' : ''}"
        aria-selected="${chip.id === state.filter}" data-filter="${chip.id}">${escapeHtml(chip.label)}<span>${chip.count}</span></button>`
    )
    .join('');
}

function cardTemplate(product) {
  const badge = product.badge
    ? `<span class="card-badge ${product.popular ? 'hot' : ''}">${escapeHtml(product.badge)}</span>`
    : product.popular
      ? '<span class="card-badge hot">Populaire</span>'
      : '';
  return `
    <article class="card">
      <div class="card-media">
        ${badge}
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" width="700" height="470" />
      </div>
      <div class="card-body">
        <h3>${escapeHtml(product.name)}</h3>
        <p class="card-desc">${escapeHtml(product.description)}</p>
        <div class="card-foot">
          <p class="card-price">${nf.format(product.price)}<small>${escapeHtml((state.shop && state.shop.currency) || 'FC')}</small></p>
          <button type="button" class="add-btn" data-add="${escapeHtml(product.id)}" aria-label="Ajouter ${escapeHtml(product.name)} au panier">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Ajouter
          </button>
        </div>
      </div>
    </article>`;
}

function renderMenu() {
  const grid = $('[data-products]');
  const empty = $('[data-grid-empty]');
  if (!grid) return;
  const list = state.filter === 'tout'
    ? state.products
    : state.products.filter((p) => p.category === state.filter);
  grid.innerHTML = list.map(cardTemplate).join('');
  if (empty) empty.hidden = list.length > 0;
  observeReveals(grid);
}

/* ----------------------------------------------------------------- panier */

function cartLines() {
  return state.cart
    .map((line) => {
      const product = state.products.find((p) => p.id === line.id);
      if (!product) return null;
      return { ...line, product, lineTotal: product.price * line.qty };
    })
    .filter(Boolean);
}

function cartCount() {
  return state.cart.reduce((sum, line) => sum + line.qty, 0);
}

function totals() {
  const lines = cartLines();
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const shop = state.shop || {};
  const freeFrom = Number(shop.freeDeliveryFrom) || 0;
  const deliveryFee = state.mode === 'livraison' && subtotal > 0 && subtotal < freeFrom
    ? Number(shop.deliveryFee) || 0
    : 0;
  return { lines, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function persistCart() {
  store(CART_KEY, state.cart);
}

function updateBadge() {
  const count = cartCount();
  const badge = $('[data-cart-count]');
  if (badge) {
    badge.textContent = count;
    badge.hidden = count === 0;
    if (count > 0) {
      badge.classList.remove('bump');
      void badge.offsetWidth;
      badge.classList.add('bump');
    }
  }
  const bar = $('[data-mobile-bar]');
  if (bar) {
    const { total } = totals();
    bar.hidden = count === 0;
    bar.classList.toggle('is-visible', count > 0);
    $('[data-mobile-count]', bar).textContent = `${count} article${count > 1 ? 's' : ''}`;
    $('[data-mobile-total]', bar).textContent = money(total);
  }
  document.body.classList.toggle('has-cart-bar', count > 0);
}

function renderCart() {
  const { lines, subtotal, deliveryFee, total } = totals();
  const count = cartCount();
  const linesEl = $('[data-cart-lines]');
  const emptyEl = $('[data-cart-empty]');
  const form = $('[data-checkout-form]');
  const foot = $('[data-cart-foot]');
  const success = $('[data-success]');
  const body = $('[data-cart-view]');

  if (success && !success.hidden) {
    updateBadge();
    return;
  }

  if (emptyEl) emptyEl.hidden = count > 0;
  if (linesEl) {
    linesEl.hidden = count === 0;
    linesEl.innerHTML = lines
      .map(
        (line) => `
        <div class="cart-line" data-line="${escapeHtml(line.id)}">
          <img src="${escapeHtml(line.product.image)}" alt="" width="62" height="62" />
          <div class="cart-line-info">
            <h4>${escapeHtml(line.product.name)}</h4>
            <span>${nf.format(line.product.price)} ${escapeHtml((state.shop && state.shop.currency) || 'FC')}</span>
          </div>
          <div class="cart-line-right">
            <div class="qty">
              <button type="button" data-dec="${escapeHtml(line.id)}" aria-label="Retirer un ${escapeHtml(line.product.name)}">−</button>
              <span>${line.qty}</span>
              <button type="button" data-inc="${escapeHtml(line.id)}" aria-label="Ajouter un ${escapeHtml(line.product.name)}">+</button>
            </div>
            <span class="cart-line-price">${money(line.lineTotal)}</span>
          </div>
        </div>`
      )
      .join('');
  }

  if (form) form.hidden = count === 0;
  if (foot) foot.hidden = count === 0;
  if (body) body.scrollTop = 0;

  $('[data-total-subtotal]').textContent = money(subtotal);
  const deliveryEl = $('[data-total-delivery]');
  if (state.mode === 'retrait') {
    deliveryEl.textContent = 'Gratuit';
  } else if (deliveryFee === 0 && subtotal > 0) {
    deliveryEl.textContent = 'Offerte';
  } else {
    deliveryEl.textContent = money(deliveryFee);
  }
  $('[data-total-grand]').textContent = money(total);

  const addressField = $('[data-address-field]');
  if (addressField) addressField.hidden = state.mode !== 'livraison';
  $$('.mode-btn').forEach((btn) => {
    const active = btn.dataset.mode === state.mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', String(active));
  });

  updateBadge();
}

function addToCart(id, qty = 1) {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;
  const line = state.cart.find((l) => l.id === id);
  if (line) {
    line.qty = Math.min(20, line.qty + qty);
  } else {
    state.cart.push({ id, qty });
  }
  persistCart();
  renderCart();
  toast(`${product.name} ajouté au panier`);
}

function setQty(id, qty) {
  const line = state.cart.find((l) => l.id === id);
  if (!line) return;
  if (qty <= 0) {
    state.cart = state.cart.filter((l) => l.id !== id);
  } else {
    line.qty = Math.min(20, qty);
  }
  persistCart();
  renderCart();
}

/* ----------------------------------------------------------------- tiroir */

let overlayTimer;

function openDrawer() {
  const drawer = $('#cart-drawer');
  const overlay = $('[data-drawer-overlay]');
  if (!drawer || !overlay) return;
  clearTimeout(overlayTimer);
  overlay.hidden = false;
  drawer.inert = false;
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  renderCart();
  requestAnimationFrame(() => {
    drawer.classList.add('is-open');
    overlay.classList.add('is-visible');
    $('[data-close-cart]', drawer)?.focus({ preventScroll: true });
  });
}

function closeDrawer() {
  const drawer = $('#cart-drawer');
  const overlay = $('[data-drawer-overlay]');
  if (!drawer || !overlay) return;
  drawer.classList.remove('is-open');
  overlay.classList.remove('is-visible');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.inert = true;
  document.body.classList.remove('is-locked');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => {
    overlay.hidden = true;
  }, 360);
}

/* -------------------------------------------------------------- commande */

function setFieldError(field, message) {
  const wrap = $(`[data-error-for="${field}"]`);
  if (!wrap) return;
  wrap.textContent = message || '';
  wrap.hidden = !message;
  const input = wrap.closest('.field')?.querySelector('input, textarea');
  if (input) input.closest('.field').classList.toggle('has-error', Boolean(message));
}

function clearFieldErrors() {
  ['name', 'phone', 'address'].forEach((field) => setFieldError(field, ''));
  const error = $('[data-order-error]');
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
}

function showFormError(message) {
  const error = $('[data-order-error]');
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}

async function submitOrder() {
  if (state.submitting) return;
  const lines = cartLines();
  if (!lines.length) {
    toast('Votre panier est vide.');
    return;
  }
  clearFieldErrors();

  const name = $('#order-name').value.trim();
  const phone = $('#order-phone').value.trim();
  const address = $('#order-address').value.trim();
  const note = $('#order-note').value.trim();

  let invalid = false;
  if (name.length < 2) {
    setFieldError('name', 'Indiquez votre nom.');
    invalid = true;
  }
  if (digits(phone).length < 8) {
    setFieldError('phone', 'Numéro de téléphone incomplet.');
    invalid = true;
  }
  if (state.mode === 'livraison' && address.length < 5) {
    setFieldError('address', 'Précisez l’adresse de livraison.');
    invalid = true;
  }
  if (invalid) return;

  const button = $('[data-submit-order]');
  const original = button ? button.innerHTML : '';
  state.submitting = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Envoi en cours…';
  }

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: state.mode,
        customer: { name, phone },
        address,
        note,
        items: state.cart.map((line) => ({ id: line.id, qty: line.qty }))
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (payload.fields) {
        Object.entries(payload.fields).forEach(([field, message]) => setFieldError(field, message));
      }
      showFormError(payload.error || 'La commande n’a pas pu être envoyée. Réessayez.');
      return;
    }

    state.lastOrder = payload.order;
    store(LAST_ORDER_KEY, payload.order);
    state.cart = [];
    persistCart();
    renderSuccess(payload.order);
    renderCart();
  } catch {
    showFormError('Connexion impossible. Vérifiez votre réseau puis réessayez.');
  } finally {
    state.submitting = false;
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

function renderSuccess(order) {
  const drawer = $('#cart-drawer');
  const view = $('[data-cart-view]');
  const foot = $('[data-cart-foot]');
  const success = $('[data-success]');
  if (!success || !view || !foot) return;

  view.hidden = true;
  foot.hidden = true;
  success.hidden = false;

  // Remise en haut du panneau, sans dépendre de scrollTo (non universel)
  if (drawer) drawer.scrollTop = 0;
  if (typeof success.scrollIntoView === 'function') {
    try {
      success.scrollIntoView({ block: 'start' });
    } catch {
      success.scrollTop = 0;
    }
  }

  const codeEl = $('[data-success-code]');
  if (codeEl) codeEl.textContent = order.code;
  const modeLabel = order.mode === 'livraison'
    ? `Livraison prévue dans 30 à 45 min · ${money(order.total)}`
    : `Retrait au comptoir dans ~${order.eta} min · ${money(order.total)}`;
  $('[data-success-meta]').textContent = `${modeLabel} — paiement à la récupération.`;

  const track = $('[data-success-track]');
  if (track) track.href = `#suivi`;

  const wa = $('[data-success-whatsapp]');
  if (wa && state.shop) {
    const items = order.items.map((item) => `• ${item.qty} × ${item.name}`).join('\n');
    const text = `Bonjour Fabriny Bakery ! Commande ${order.code} :\n${items}\nTotal : ${money(order.total)}\nMode : ${order.mode === 'livraison' ? 'livraison' : 'retrait'}`;
    wa.href = `https://wa.me/${digits(state.shop.whatsapp)}?text=${encodeURIComponent(text)}`;
  }

  const title = $('[data-drawer-title]');
  if (title) title.textContent = 'Commande envoyée';
}

function resetDrawer() {
  const view = $('[data-cart-view]');
  const foot = $('[data-cart-foot]');
  const success = $('[data-success]');
  if (view) view.hidden = false;
  if (success) success.hidden = true;
  if (foot) foot.hidden = cartCount() === 0;
  const title = $('[data-drawer-title]');
  if (title) title.textContent = 'Panier';
  $('#order-note').value = '';
  clearFieldErrors();
  renderCart();
}

/* ------------------------------------------------------------------ suivi */

const STATUS_LABELS = {
  recue: 'Commande reçue',
  preparation: 'En préparation au fournil',
  prete: 'Prête',
  retiree: 'Récupérée',
  annulee: 'Commande annulée'
};

const STATUS_PILL = {
  recue: 'Reçue',
  preparation: 'En préparation',
  prete: 'Prête',
  retiree: 'Récupérée',
  annulee: 'Annulée'
};

function renderTimeline(order) {
  const timeline = $('[data-timeline]');
  if (!timeline) return;
  const steps = ['recue', 'preparation', 'prete', 'retiree'];
  const flow = order.status === 'annulee' ? ['recue', 'annulee'] : steps;
  const currentIndex = flow.indexOf(order.status);

  timeline.innerHTML = flow
    .map((step, index) => {
      const history = (order.history || []).filter((h) => h.status === step).pop();
      const stateClass = index < currentIndex ? 'done' : index === currentIndex ? 'current done' : '';
      let label = STATUS_LABELS[step];
      if (step === 'prete' && order.mode === 'livraison') label = 'En route vers vous';
      if (step === 'retiree' && order.mode === 'livraison') label = 'Livrée';
      return `<li class="${stateClass}">
        <strong>${label}</strong>
        <span>${history ? timeLabel(history.at) : 'En attente'}</span>
      </li>`;
    })
    .join('');

  const statusEl = $('[data-track-status]');
  if (statusEl) {
    statusEl.textContent = STATUS_PILL[order.status] || order.status;
    statusEl.dataset.state = order.status;
  }
  $('[data-track-code]').textContent = order.code;

  const foot = $('[data-track-foot]');
  if (foot) {
    const mode = order.mode === 'livraison' ? 'Livraison dans le quartier' : 'Retrait au comptoir';
    const items = order.items.map((item) => `${item.qty} × ${item.name}`).join(' · ');
    foot.textContent = `${mode} · ${items} · Total ${money(order.total)}`;
  }
}

async function trackOrder(code, phone) {
  const errorEl = $('[data-track-error]');
  const resultEl = $('[data-track-result]');
  if (errorEl) errorEl.hidden = true;

  if (!code || digits(phone).length < 8) {
    if (errorEl) {
      errorEl.textContent = 'Renseignez le code de commande et le téléphone utilisé.';
      errorEl.hidden = false;
    }
    return;
  }

  try {
    const response = await fetch(
      `/api/orders?code=${encodeURIComponent(code.trim().toUpperCase())}&phone=${encodeURIComponent(phone)}`
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (errorEl) {
        errorEl.textContent = payload.error || 'Commande introuvable.';
        errorEl.hidden = false;
      }
      if (resultEl) resultEl.hidden = true;
      return;
    }
    renderTimeline(payload.order);
    if (resultEl) resultEl.hidden = false;
    state.lastOrder = payload.order;
    store(LAST_ORDER_KEY, payload.order);
  } catch {
    if (errorEl) {
      errorEl.textContent = 'Connexion impossible. Réessayez dans un instant.';
      errorEl.hidden = false;
    }
  }
}

/* ------------------------------------------------------------- révélation */

let observer;

function observeReveals(root = document) {
  if (!('IntersectionObserver' in window)) {
    $$('.reveal', root).forEach((el) => el.classList.add('is-visible'));
    return;
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
  }
  $$('.reveal:not(.is-visible)', root).forEach((el) => observer.observe(el));
}

function setupReveals() {
  const targets = [
    ...$$('.section-head'),
    ...$$('.step'),
    ...$$('.order-card'),
    ...$$('.info-card'),
    ...$$('.story-copy'),
    ...$$('.story-media')
  ];
  targets.forEach((el) => el.classList.add('reveal'));
  observeReveals();
}

/* ------------------------------------------------------------------ init */

function bindEvents() {
  // filtres
  $('[data-filters]')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    renderFilters();
    renderMenu();
  });

  // ajout au panier
  $('[data-products]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add]');
    if (!button) return;
    addToCart(button.dataset.add);
    button.classList.add('is-added');
    const previous = button.innerHTML;
    button.innerHTML = '✓ Ajouté';
    setTimeout(() => {
      button.classList.remove('is-added');
      button.innerHTML = previous;
    }, 1200);
  });

  // panier
  $$('[data-open-cart]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.setMode) {
        state.mode = button.dataset.setMode;
      }
      openDrawer();
      renderCart();
    });
  });

  $$('[data-close-cart]').forEach((button) => button.addEventListener('click', closeDrawer));
  $('[data-drawer-overlay]')?.addEventListener('click', closeDrawer);

  $('[data-cart-lines]')?.addEventListener('click', (event) => {
    const inc = event.target.closest('[data-inc]');
    const dec = event.target.closest('[data-dec]');
    if (inc) {
      const line = state.cart.find((l) => l.id === inc.dataset.inc);
      setQty(inc.dataset.inc, (line?.qty || 0) + 1);
    } else if (dec) {
      const line = state.cart.find((l) => l.id === dec.dataset.dec);
      setQty(dec.dataset.dec, (line?.qty || 0) - 1);
    }
  });

  $$('.mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      renderCart();
    });
  });

  $('[data-submit-order]')?.addEventListener('click', submitOrder);

  $('[data-new-order]')?.addEventListener('click', () => {
    resetDrawer();
    closeDrawer();
    document.querySelector('#menu')?.scrollIntoView({ behavior: 'smooth' });
  });

  $('[data-copy-code]')?.addEventListener('click', async () => {
    const code = $('[data-success-code]')?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      toast(`Code ${code} copié`);
    } catch {
      toast(`Votre code : ${code}`);
    }
  });

  $('[data-success-track]')?.addEventListener('click', () => {
    closeDrawer();
    setTimeout(() => {
      document.querySelector('#suivi')?.scrollIntoView({ behavior: 'smooth' });
      const code = $('[data-success-code]')?.textContent || '';
      const phone = state.lastOrder?.customer?.phone || '';
      $('#track-code').value = code;
      $('#track-phone').value = phone;
      if (code && phone) trackOrder(code, phone);
    }, 320);
  });

  // suivi
  $('[data-track-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    trackOrder($('#track-code').value, $('#track-phone').value);
  });

  // burger
  const burger = $('#burger');
  const panel = $('#mobile-panel');
  burger?.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') === 'true';
    burger.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });
  panel?.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      burger.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
    }
  });

  // échap
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('#cart-drawer')?.classList.contains('is-open')) closeDrawer();
    if (panel && !panel.hidden) {
      panel.hidden = true;
      burger.setAttribute('aria-expanded', 'false');
    }
  });

  // en-tête au scroll
  const header = $('#site-header');
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // saisie : on efface l'erreur du champ
  $$('#order-name, #order-phone, #order-address').forEach((input) => {
    input.addEventListener('input', () => setFieldError(input.name, ''));
  });
}

async function init() {
  state.cart = loadStored(CART_KEY, []).filter(
    (line) => line && typeof line.id === 'string' && Number.isInteger(line.qty) && line.qty > 0
  );
  state.lastOrder = loadStored(LAST_ORDER_KEY, null);

  const drawer = $('#cart-drawer');
  if (drawer) drawer.inert = true;

  bindEvents();
  setupReveals();

  try {
    const [configRes, productsRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/products')
    ]);
    const config = await configRes.json();
    const catalog = await productsRes.json();

    state.shop = config.shop || {};
    state.categories = config.categories || catalog.categories || [];
    state.products = catalog.products || [];

    renderShop();
    renderHours();
    setInterval(renderHours, 60_000);
    renderFilters();
    renderMenu();
    renderCart();

    if (state.lastOrder?.code) {
      const codeInput = $('#track-code');
      const phoneInput = $('#track-phone');
      if (codeInput && !codeInput.value) codeInput.value = state.lastOrder.code;
      if (phoneInput && !phoneInput.value) phoneInput.value = state.lastOrder.customer?.phone || '';
    }
  } catch {
    toast('Impossible de charger la carte. Rechargez la page.');
  }
}

document.addEventListener('DOMContentLoaded', init);
