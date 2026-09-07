// ============================================================
// MrWiseMax — Dashboard Application Logic
// ============================================================

// ── App State ────────────────────────────────────────────────
const App = {
  user: null,
  balances: [],
  expenses: [],
  expenseGroups: [],
  // Read only, to offer a one-time import of the previous version's entries.
  recurring: [],
  activeSection: 'overview',
  coverageWindow: 30,
  expenseFilters: { search: '', sort: 'due' },
  editing: { expense: null, group: null },
};

// ── Currency Configuration ────────────────────────────────────
const CURRENCIES = [
  { code: 'AUD', symbol: 'A$',  name: 'Australian Dollar',   flag: '🇦🇺' },
  { code: 'BGN', symbol: 'лв',  name: 'Bulgarian Lev',       flag: '🇧🇬' },
  { code: 'BRL', symbol: 'R$',  name: 'Brazilian Real',      flag: '🇧🇷' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar',     flag: '🇨🇦' },
  { code: 'CHF', symbol: 'Fr',  name: 'Swiss Franc',         flag: '🇨🇭' },
  { code: 'CNY', symbol: '¥',   name: 'Chinese Yuan',        flag: '🇨🇳' },
  { code: 'CZK', symbol: 'Kč',  name: 'Czech Koruna',        flag: '🇨🇿' },
  { code: 'DKK', symbol: 'kr',  name: 'Danish Krone',        flag: '🇩🇰' },
  { code: 'EUR', symbol: '€',   name: 'Euro',                flag: '🇪🇺' },
  { code: 'GBP', symbol: '£',   name: 'British Pound',       flag: '🇬🇧' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar',    flag: '🇭🇰' },
  { code: 'HUF', symbol: 'Ft',  name: 'Hungarian Forint',    flag: '🇭🇺' },
  { code: 'IDR', symbol: 'Rp',  name: 'Indonesian Rupiah',   flag: '🇮🇩' },
  { code: 'ILS', symbol: '₪',   name: 'Israeli Shekel',      flag: '🇮🇱' },
  { code: 'INR', symbol: '₹',   name: 'Indian Rupee',        flag: '🇮🇳' },
  { code: 'ISK', symbol: 'kr',  name: 'Icelandic Króna',     flag: '🇮🇸' },
  { code: 'JPY', symbol: '¥',   name: 'Japanese Yen',        flag: '🇯🇵' },
  { code: 'KRW', symbol: '₩',   name: 'South Korean Won',    flag: '🇰🇷' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso',        flag: '🇲🇽' },
  { code: 'MYR', symbol: 'RM',  name: 'Malaysian Ringgit',   flag: '🇲🇾' },
  { code: 'NOK', symbol: 'kr',  name: 'Norwegian Krone',     flag: '🇳🇴' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar',  flag: '🇳🇿' },
  { code: 'PHP', symbol: '₱',   name: 'Philippine Peso',     flag: '🇵🇭' },
  { code: 'PLN', symbol: 'zł',  name: 'Polish Zloty',        flag: '🇵🇱' },
  { code: 'RON', symbol: 'lei', name: 'Romanian Leu',        flag: '🇷🇴' },
  { code: 'SEK', symbol: 'kr',  name: 'Swedish Krona',       flag: '🇸🇪' },
  { code: 'SGD', symbol: 'S$',  name: 'Singapore Dollar',    flag: '🇸🇬' },
  { code: 'THB', symbol: '฿',   name: 'Thai Baht',           flag: '🇹🇭' },
  { code: 'TRY', symbol: '₺',   name: 'Turkish Lira',        flag: '🇹🇷' },
  { code: 'USD', symbol: '$',   name: 'US Dollar',           flag: '🇺🇸' },
  { code: 'ZAR', symbol: 'R',   name: 'South African Rand',  flag: '🇿🇦' },
];

const CurrencySettings = {
  main: CURRENCIES.find(c => c.code === 'USD'),
  viewCurrency: 'main',   // 'main' | 'USD'

  // Exchange rates keyed by base currency: { IDR: { USD: 0.000061, ... }, ... }.
  // Loaded before the first render so every conversion below stays synchronous.
  rates: {},
  _missingRateWarned: false,

  get isUSDMode() {
    return this.main.code !== 'USD' && this.viewCurrency === 'USD';
  },

  // The currency currently on screen — and the currency any amount the user
  // types right now is understood to be in.
  get activeCode()   { return this.isUSDMode ? 'USD' : this.main.code; },
  get activeSymbol() { return this.isUSDMode ? '$'   : this.main.symbol; },

  // Used by the currency modal's "1 XXX ~ n USD" line.
  get rateToUSD() { return this.rates[this.main.code]?.USD ?? 1; },

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem('mrwisemax_currency') || 'null');
      if (saved?.code) {
        const found = CURRENCIES.find(c => c.code === saved.code);
        if (found) this.main = found;
      }
      if (saved?.view === 'USD' && this.main.code !== 'USD') this.viewCurrency = 'USD';
    } catch (_) {}
  },

  // Loads the rate table for one base currency. Returns false if unavailable.
  async _loadRates(base) {
    base = String(base || '').toUpperCase();
    if (!base || this.rates[base]) return true;

    const KEY = 'mrwisemax_rates_' + base;
    try {
      const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (cached?.rates && (Date.now() - cached.ts) < 3600000) {
        this.rates[base] = cached.rates;
        return true;
      }
    } catch (_) {}

    try {
      // fawazahmed0 CDN — no auth, CORS-safe, updates daily
      const res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base.toLowerCase()}.json`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const table = (await res.json())[base.toLowerCase()];
      if (!table) throw new Error('no rate table for ' + base);

      const rates = {};
      Object.entries(table).forEach(([code, rate]) => { rates[code.toUpperCase()] = rate; });
      this.rates[base] = rates;
      try { localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), rates })); } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[Currency] Could not load rates for', base, '-', e.message);
      return false;
    }
  },

  // Call before rendering, and after any currency switch, so that every
  // currency the user's data is stored in has a rate table available.
  async ensureRates(codes) {
    const needed = [...new Set((codes || []).filter(Boolean).map(c => String(c).toUpperCase()))];
    const loaded = await Promise.all(needed.map(c => this._loadRates(c)));
    return loaded.every(Boolean);
  },

  // Synchronous conversion. Identical currencies are returned untouched — this
  // is what stops an amount entered in USD from being "converted" while the
  // user is viewing USD.
  convert(amount, from, to) {
    const n = parseFloat(amount) || 0;
    if (!n || !from || !to) return n;
    from = String(from).toUpperCase();
    to   = String(to).toUpperCase();
    if (from === to) return n;

    const direct = this.rates[from]?.[to];
    if (typeof direct === 'number' && isFinite(direct)) return n * direct;

    // Bridge through USD when only one leg of the pair is loaded.
    const toUsd   = from === 'USD' ? 1 : this.rates[from]?.USD;
    const fromUsd = to   === 'USD' ? 1 : this.rates.USD?.[to];
    if (typeof toUsd === 'number' && typeof fromUsd === 'number') return n * toUsd * fromUsd;

    // No rate at all — show the number as stored rather than invent one.
    if (!this._missingRateWarned) {
      this._missingRateWarned = true;
      console.warn(`[Currency] No rate for ${from} -> ${to}; showing amounts unconverted.`);
      UI.toast('Live exchange rates are unavailable - amounts are shown unconverted.', 'warning', 6000);
    }
    return n;
  },

  save() {
    localStorage.setItem('mrwisemax_currency', JSON.stringify({
      code: this.main.code,
      view: this.viewCurrency,
    }));
  },

  _applyViewMode() { this.save(); updateCurrencyBanner(); },
};

// -- Money ----------------------------------------------------
// Every saved amount carries the currency it was entered in (the `currency`
// column). These helpers are the only way an amount should reach the screen:
// they convert from the row's own currency into the one being viewed, and
// leave amounts already in that currency exactly as the user typed them.
const Money = {
  // Saved amount -> number in the currency currently on screen.
  toActive(amount, from) {
    return CurrencySettings.convert(amount, from || CurrencySettings.activeCode, CurrencySettings.activeCode);
  },

  // Saved amount -> formatted string in the currency currently on screen.
  fmt(amount, from) {
    return UI.currency(this.toActive(amount, from));
  },

  // Amount the user just typed -> the currency a given row is stored in.
  fromActive(amount, to) {
    return CurrencySettings.convert(amount, CurrencySettings.activeCode, to || CurrencySettings.activeCode);
  },

  // Every currency present in the user's saved data, plus both display currencies.
  usedCodes() {
    const codes = [CurrencySettings.main.code, 'USD'];
    (App.expenses || []).forEach(e => { if (e.currency) codes.push(e.currency); });
    (App.balances || []).forEach(a => { if (a.currency) codes.push(a.currency); });
    return codes;
  },
};

// Patch UI.currency — always renders in the currency being viewed.
// Conversion happens in Money.toActive(), never here, so no amount can ever
// be converted twice.
(function () {
  const _orig = UI.currency;
  UI.currency = function (amount, forceSymbol) {
    if (forceSymbol !== undefined) return _orig(amount, forceSymbol);
    return _orig(amount, CurrencySettings.activeSymbol);
  };
})();

// ── Currency Formatter ────────────────────────────────────────
// Handles live comma-formatting for all dollar-amount inputs.
// Inputs must have class="fmt-currency" and type="text".
const Fmt = {
  // Number/string → display string  e.g. 1234.5 → "1,234.50"
  set(n) {
    if (n == null || n === '' || isNaN(+n)) return '';
    const [i, d] = String(+n).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d.slice(0, 2).padEnd(2, '0') : '');
  },
  // Input string → float   e.g. "1,234.50" → 1234.5
  get(s) { return parseFloat(String(s || '').replace(/,/g, '')) || 0; },
  // Live-format a raw string while the user types
  live(s) {
    s = s.replace(/[^0-9.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) {
      s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
      if (s.length > dot + 3) s = s.slice(0, dot + 3);   // max 2 decimal places
    }
    const [i, d] = s.split('.');
    const fi = (i || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d !== undefined ? fi + '.' + d : fi;
  },
};

// Safe to call again after rendering new inputs — already-wired ones are skipped.
function initCurrencyInputs() {
  document.querySelectorAll('.fmt-currency').forEach(el => {
    if (el.dataset.fmtWired) return;
    el.dataset.fmtWired = '1';
    el.addEventListener('input', () => {
      const start  = el.selectionStart;
      const before = el.value.length;
      el.value     = Fmt.live(el.value);
      const delta  = el.value.length - before;
      try { el.setSelectionRange(start + delta, start + delta); } catch (_) {}
    });
  });
}

// ── Bootstrap ─────────────────────────────────────────────────
async function initDashboard() {
  const user = await Auth.requireAuth();
  if (!user) return;
  App.user = user;

  // Gate: redirect to onboarding if not completed
  const { data: profileCheck } = await db.from('profiles')
    .select('onboarding_complete').eq('id', user.id).single();
  if (!profileCheck?.onboarding_complete) {
    window.location.href = 'budgeting-onboarding.html';
    return;
  }

  CurrencySettings.init();
  updateCurrencyBanner();
  document.getElementById('page-loader').style.display = 'none';
  renderUserInfo();

  await Promise.all([loadExpenseGroups(), loadExpenses(), loadBalances(), loadRecurring()]);

  // Rates must be in place before anything renders: every amount is converted
  // from the currency it was saved in into the one being displayed.
  await CurrencySettings.ensureRates(Money.usedCodes());
  // A charge date left in the past belongs on its real next date.
  await rollForwardDueDates();

  initCurrencyInputs();
  // Enter in either field of an account row saves that row.
  document.getElementById('balance-accounts')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const row = e.target.closest?.('.balance-account');
    if (!row) return;
    e.preventDefault();
    saveBalanceAccount(row.querySelector('.save-btn'));
  });
  navigateTo('overview');
  NavHistory.init();
  setupNavigation();
  setupExpenseControls();
  setupDynamicLayout();
}

// The one piece of identity the app still shows: which account you are in.
// It comes from the auth session, not from a stored profile.
function renderUserInfo() {
  const email = App.user?.email || '';
  document.querySelectorAll('.user-email-display').forEach(el => {
    el.textContent = email;
    el.title = email;
  });
}

// ── Navigation ────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.nav); });
  });
}

function navigateTo(section) {
  App.activeSection = section;
  UI.showSection(section);

  // Entrance animations are keyed off this flag, which is dropped shortly
  // after arriving — so rows animate in when you open a page, and stay put
  // when a re-render replaces them while you are typing or editing.
  const pane = document.getElementById(`section-${section}`);
  if (pane) {
    pane.setAttribute('data-fresh', '');
    clearTimeout(pane._freshTimer);
    pane._freshTimer = setTimeout(() => pane.removeAttribute('data-fresh'), 750);
  }
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === section));

  // Instantly snap the content area back to the top on every section switch
  const dashContent = document.querySelector('.dash-content');
  if (dashContent) dashContent.scrollTop = 0;

  // Others button lights up for anything not on the bottom bar
  const othersBtn = document.getElementById('mobile-others-btn');
  if (othersBtn) othersBtn.classList.toggle('active', section === 'education');

  // Close Others popup whenever we navigate
  document.getElementById('mobile-more-popup')?.classList.remove('open');

  const loaders = { overview: renderOverview, expenses: renderExpenses,
    education: renderEducation };
  if (loaders[section]) loaders[section]();
}

function toggleMobileMore(e) {
  e.stopPropagation();
  document.getElementById('mobile-more-popup')?.classList.toggle('open');
}

function mobileMoreNav(section) {
  document.getElementById('mobile-more-popup')?.classList.remove('open');
  navigateTo(section);
}

// Close Others popup when tapping anywhere else
document.addEventListener('click', () => {
  document.getElementById('mobile-more-popup')?.classList.remove('open');
});

// ── Dynamic Layout Sizing ─────────────────────────────────────
// Replaces the static .dash-content::after spacer.
// Runs on boot, resize, and orientation change so every section fits the
// exact visible area on any device.

function setupDynamicLayout() {
  _applyLayout();
  window.addEventListener('resize', _applyLayout);
  // visualViewport fires its own resize event (e.g. as Safari's address bar
  // collapses) which may not trigger window.resize — listen to both.
  window.visualViewport?.addEventListener('resize', _applyLayout);
  // orientationchange fires before the viewport settles; the 150 ms delay
  // lets the browser finish repainting before we measure.
  window.addEventListener('orientationchange', () => setTimeout(_applyLayout, 150));

}

function _applyLayout() {
  const mobileNav   = document.querySelector('.mobile-nav');
  const topbar      = document.querySelector('.topbar');
  const dashContent = document.querySelector('.dash-content');
  const dashLayout  = document.querySelector('.dash-layout');
  if (!dashContent) return;

  // Use visualViewport when available — it stays accurate when the
  // on-screen keyboard or browser chrome resizes the visible area.
  // On mobile browsers 100vh = the *large* viewport (chrome hidden), so
  // .dash-layout ends up taller than what is actually visible and the
  // bottom of dash-content disappears behind the browser toolbar.
  // Pinning dash-layout to the real visual height fixes that.
  const vh       = window.visualViewport?.height ?? window.innerHeight;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const navH     = isMobile && mobileNav ? mobileNav.offsetHeight : 0;
  const topbarH  = topbar ? topbar.offsetHeight : 0;
  const availH   = Math.floor(vh - topbarH - navH);       // px available for sections
  const padH     = isMobile ? 14 : 24;                    // matches .dash-content padding

  // -- Pin the layout container to the exact visible viewport height --
  if (dashLayout) dashLayout.style.height = `${Math.floor(vh)}px`;

  // -- Published for any rule that needs the exact visible height --
  document.documentElement.style.setProperty('--available-vh', `${availH}px`);

  // -- dash-content bottom padding keeps scrollable content above the fixed nav --
  dashContent.style.paddingBottom = isMobile ? `${navH + padH}px` : '';

  // -- Every section gets a min-height so it fills the full visible area --
  document.querySelectorAll('.dash-section').forEach(s => {
    s.style.minHeight = `${availH}px`;
  });

}

// ── Data Loaders ─────────────────────────────────────────────
async function loadBalances() { const { data } = await db.from('account_balance').select('*').eq('user_id', App.user.id).order('sort_order').order('name'); App.balances = data || []; }
// Kept only so the Expenses page can offer to import them once.
async function loadRecurring() { const { data } = await db.from('recurring_transactions').select('*').eq('user_id', App.user.id).order('created_at'); App.recurring = data || []; }

// ── ACCOUNT BALANCES ─────────────────────────────────────────
// The user names each account they hold and says what is in it. Each figure is
// an anchor — true at the moment it was saved — and everything logged after the
// newest anchor is added on top of the combined total, so the number stays
// right without being re-typed.

// The most recent confirmation across every account. Transactions after it are
// the ones no stated figure can already include.
function balanceAnchor() {
  let newest = null;
  (App.balances || []).forEach(a => {
    if (!newest || new Date(a.as_of) > new Date(newest)) newest = a.as_of;
  });
  return newest;
}

// Every account added up, each converted from its own currency into the one
// on screen.
function balancesTotal() {
  return (App.balances || []).reduce((s, a) => s + Money.toActive(a.balance, a.currency), 0);
}

function renderBalanceCard() {
  const valueEl = document.getElementById('balance-value');
  if (!valueEl) return;
  renderBalanceAccounts();
  const metaEl = document.getElementById('balance-meta');

  if (!App.balances?.length) {
    valueEl.textContent = '\u2014';
    valueEl.classList.remove('negative');
    if (metaEl) metaEl.textContent = 'Add an account so the app knows what you have to work with.';
    return;
  }

  const total = balancesTotal();
  valueEl.textContent = UI.currency(total);
  valueEl.classList.toggle('negative', total < 0);

  const count = App.balances.length;
  const when  = UI.formatDate(String(balanceAnchor()).slice(0, 10));
  if (metaEl) {
    metaEl.textContent = count > 1
      ? `Across ${count} accounts · last confirmed ${when}`
      : `Last confirmed ${when}`;
  }
}

// One editable row per account. An account not confirmed in a month is called
// out, since a stale figure quietly drags the whole total off.
function renderBalanceAccounts() {
  const el = document.getElementById('balance-accounts');
  if (!el) return;

  // Never throw away a row the user is halfway through typing.
  const draft = el.querySelector('.balance-account.is-new');

  el.innerHTML = (App.balances || []).map(a => {
    const stale = (Date.now() - new Date(a.as_of).getTime()) > 30 * 86400000;
    return `
      <div class="balance-account" data-id="${a.id}">
        <input class="input balance-account-name" maxlength="40" placeholder="Bank name" aria-label="Account name">
        <input class="input fmt-currency balance-account-amount" inputmode="decimal" placeholder="0"
          aria-label="Balance" value="${Fmt.set(Money.toActive(a.balance, a.currency))}">
        <button class="icon-btn save-btn" title="Save" onclick="saveBalanceAccount(this)">✓</button>
        <button class="icon-btn del-btn" title="Remove account" onclick="removeBalanceAccount('${a.id}')">✕</button>
        <div class="balance-account-meta${stale ? ' stale' : ''}">${stale ? 'Not confirmed since ' : 'Confirmed '}${UI.formatDate(String(a.as_of).slice(0, 10))}</div>
      </div>`;
  }).join('');

  // Names are user text — assigned, never interpolated into markup.
  const byId = Object.fromEntries((App.balances || []).map(a => [a.id, a]));
  el.querySelectorAll('.balance-account[data-id]').forEach(row => {
    row.querySelector('.balance-account-name').value = byId[row.dataset.id]?.name || '';
  });

  if (draft) el.appendChild(draft);
  else if (!App.balances?.length) el.appendChild(newBalanceAccountRow());
  initCurrencyInputs();
}

function newBalanceAccountRow() {
  const row = document.createElement('div');
  row.className = 'balance-account is-new';
  row.innerHTML = `
    <input class="input balance-account-name" maxlength="40" placeholder="Bank name" aria-label="Account name">
    <input class="input fmt-currency balance-account-amount" inputmode="decimal" placeholder="0" aria-label="Balance">
    <button class="icon-btn save-btn" title="Save" onclick="saveBalanceAccount(this)">✓</button>
    <button class="icon-btn del-btn" title="Discard" onclick="this.closest('.balance-account').remove()">✕</button>
    <div class="balance-account-meta">Not saved yet</div>`;
  return row;
}

function addBalanceAccountRow() {
  const el = document.getElementById('balance-accounts');
  if (!el) return;
  let row = el.querySelector('.balance-account.is-new');
  if (!row) {
    row = newBalanceAccountRow();
    el.appendChild(row);
    initCurrencyInputs();
  }
  row.querySelector('.balance-account-name').focus();
}

async function saveBalanceAccount(btn) {
  const row  = btn.closest('.balance-account');
  if (!row) return;
  const id   = row.dataset.id || null;
  const name = row.querySelector('.balance-account-name').value.trim();
  const raw  = row.querySelector('.balance-account-amount').value.trim();

  if (!name) { UI.toast('Give the account a name — your bank, for instance.', 'error'); return; }
  if (!raw)  { UI.toast('Enter what is in this account right now.', 'error'); return; }
  const amount = Fmt.get(raw);
  if (isNaN(amount)) { UI.toast('That does not look like a number.', 'error'); return; }

  UI.setLoading(btn, true);
  // Recorded in the currency on screen, like every other amount, and stamped
  // now — everything logged after this moment moves the total on its own.
  const now     = new Date().toISOString();
  const payload = { name, balance: amount, currency: CurrencySettings.activeCode, as_of: now, updated_at: now };
  const { error } = id
    ? await db.from('account_balance').update(payload).eq('id', id).eq('user_id', App.user.id)
    : await db.from('account_balance').insert([{ ...payload, user_id: App.user.id, sort_order: App.balances.length }]);
  UI.setLoading(btn, false);
  if (error) { UI.toast(error.message, 'error'); return; }

  row.classList.remove('is-new');
  await loadBalances();
  await CurrencySettings.ensureRates(Money.usedCodes());
  renderOverview();   // the coverage figures move with the balance
  UI.toast(`${name} updated.`, 'success');
}

async function removeBalanceAccount(id) {
  const account = App.balances.find(a => a.id === id);
  UI.confirm(`Remove ${account?.name || 'this account'} from your balance?`, async () => {
    const { error } = await db.from('account_balance').delete().eq('id', id).eq('user_id', App.user.id);
    if (error) { UI.toast(error.message, 'error'); return; }
    await loadBalances();
    renderOverview();
    UI.toast('Account removed.', 'success');
  });
}

// ── EXPENSES ─────────────────────────────────────────────────
// Everything here is contractual: an amount, how often it charges, and when
// it next does. Nothing is inferred from a bank, so nothing can drift out of
// step with reality without the user changing it.

const DAYS_PER_MONTH = 365.2425 / 12;

const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: DAYS_PER_MONTH, yearly: 365.2425 };

const GROUP_COLORS = ['#BB885F', '#4CAF50', '#F44336', '#2196F3', '#9C27B0',
                      '#FF9800', '#00BCD4', '#E91E63', '#8BC34A', '#607D8B'];

// Average days between charges — used for the monthly and yearly equivalents.
function cadenceDays(e) {
  if (e.cadence === 'custom') return Math.max(1, +e.custom_days || 1);
  return CADENCE_DAYS[e.cadence] || DAYS_PER_MONTH;
}

function cadenceLabel(e) {
  if (e.cadence === 'custom') {
    const n = Math.max(1, +e.custom_days || 1);
    return n === 1 ? 'Every day' : `Every ${n} days`;
  }
  return { daily: 'Every day', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' }[e.cadence]
    || 'Every month';
}

// What this costs per month, in the currency on screen.
function monthlyCost(e) {
  return Money.toActive(e.amount, e.currency) * DAYS_PER_MONTH / cadenceDays(e);
}

// ── Dates ────────────────────────────────────────────────────
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function parseDay(s)  { return dayStart(new Date(String(s).slice(0, 10) + 'T00:00:00')); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function stepCharge(d, e) {
  const x = new Date(d);
  switch (e.cadence) {
    case 'daily':  x.setDate(x.getDate() + 1); break;
    case 'weekly': x.setDate(x.getDate() + 7); break;
    case 'yearly': x.setFullYear(x.getFullYear() + 1); break;
    case 'custom': x.setDate(x.getDate() + Math.max(1, +e.custom_days || 1)); break;
    default:       x.setMonth(x.getMonth() + 1); break;
  }
  return x;
}

// The next time this charges, rolling a stale date forward on its own schedule.
// null once it has run past its end date.
function nextChargeOf(e) {
  const today = dayStart(new Date());
  const end   = e.ends_on ? parseDay(e.ends_on) : null;
  let d = parseDay(e.next_due), guard = 0;
  while (d < today && guard++ < 5000) d = stepCharge(d, e);
  return end && d > end ? null : d;
}

// Every charge this expense makes between today and `days` from now.
function occurrencesIn(e, days) {
  const today = dayStart(new Date());
  const limit = addDays(today, days);
  const end   = e.ends_on ? parseDay(e.ends_on) : null;
  const out   = [];
  let d = nextChargeOf(e), guard = 0;
  while (d && d <= limit && guard++ < 500) {
    if (end && d > end) break;
    out.push(d);
    d = stepCharge(d, e);
  }
  return out;
}

function activeExpenses() { return (App.expenses || []).filter(e => e.is_active); }

// ── Coverage ─────────────────────────────────────────────────
// Walks the upcoming charges in date order against the stated balance. The
// first charge the money cannot meet is where it runs out; everything from
// there on is uncovered.
function coverage(days = App.coverageWindow) {
  const balance = balancesTotal();
  const charges = [];
  activeExpenses().forEach(e =>
    occurrencesIn(e, days).forEach(date =>
      charges.push({ id: e.id, e, date, amount: Money.toActive(e.amount, e.currency) })));

  charges.sort((a, b) => a.date - b.date || a.amount - b.amount || a.e.name.localeCompare(b.e.name));

  const per = new Map();
  let left = balance, breakDate = null;
  charges.forEach(c => {
    const r = per.get(c.id) || { covered: 0, count: 0, total: 0, first: c.date, e: c.e };
    r.count++; r.total += c.amount;
    if (breakDate === null && left >= c.amount) { left -= c.amount; r.covered++; c.covered = true; }
    else { if (breakDate === null) breakDate = c.date; c.covered = false; }
    per.set(c.id, r);
  });

  const total   = charges.reduce((s, c) => s + c.amount, 0);
  const covered = balance - left;
  return { days, balance, charges, per, total, covered,
           shortfall: Math.max(0, total - covered), left, breakDate };
}

// ── Data ─────────────────────────────────────────────────────
async function loadExpenses() {
  const { data } = await db.from('expenses').select('*')
    .eq('user_id', App.user.id).order('sort_order').order('name');
  App.expenses = data || [];
}

async function loadExpenseGroups() {
  const { data } = await db.from('expense_groups').select('*')
    .eq('user_id', App.user.id).order('sort_order').order('name');
  App.expenseGroups = data || [];
}

// A charge date left in the past is rolled forward to its real next date, so
// the stored schedule stays true without the user tidying it up.
async function rollForwardDueDates() {
  const today = dayStart(new Date());
  const stale = (App.expenses || []).filter(e => {
    if (!e.is_active) return false;
    const due = parseDay(e.next_due);
    const next = nextChargeOf(e);
    return due < today && next && +next !== +due;
  });
  if (!stale.length) return;
  await Promise.all(stale.map(e =>
    db.from('expenses').update({ next_due: isoDay(nextChargeOf(e)), updated_at: new Date().toISOString() })
      .eq('id', e.id).eq('user_id', App.user.id)));
  await loadExpenses();
}

function groupOf(e) { return App.expenseGroups.find(g => g.id === e.group_id) || null; }
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── OVERVIEW ─────────────────────────────────────────────────
function renderOverview() {
  renderBalanceCard();
  renderCoverage();
  renderCostSummary();
  renderAttention();
}

function renderCoverage() {
  const list = document.getElementById('coverage-list');
  if (!list) return;
  const sub  = document.getElementById('coverage-sub');
  const fig  = document.getElementById('coverage-figures');
  const fill = document.getElementById('coverage-fill');

  if (!activeExpenses().length) {
    if (sub) sub.textContent = 'Add an expense and this fills in.';
    if (fig) fig.innerHTML = '';
    if (fill) fill.style.width = '0%';
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🧾</div>
      <p>Nothing listed yet. Add your subscriptions and bills to see what your balance covers.</p>
      <button class="btn btn-primary" onclick="navigateTo('expenses')">Go to Expenses</button></div>`;
    return;
  }

  const c   = coverage();
  const pct = c.total > 0 ? Math.max(2, Math.min(100, (c.covered / c.total) * 100)) : 100;
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('short', c.shortfall > 0);
  }

  if (sub) {
    sub.textContent = c.total === 0
      ? `Nothing is due in the next ${c.days} days.`
      : c.shortfall > 0
        ? `Your money runs out on ${UI.formatDate(isoDay(c.breakDate))}.`
        : `Everything due in the next ${c.days} days is covered.`;
    sub.classList.toggle('bad', c.shortfall > 0);
  }

  if (fig) {
    fig.innerHTML = `
      <div class="cov-fig"><span>Balance</span><strong>${UI.currency(c.balance)}</strong></div>
      <div class="cov-fig"><span>Due in ${c.days} days</span><strong>${UI.currency(c.total)}</strong></div>
      <div class="cov-fig ${c.shortfall > 0 ? 'bad' : 'good'}">
        <span>${c.shortfall > 0 ? 'Short by' : 'Left over'}</span>
        <strong>${UI.currency(c.shortfall > 0 ? c.shortfall : c.left)}</strong>
      </div>`;
  }

  const groups = coverageByGroup(c);
  if (!groups.length) {
    list.innerHTML = `<p class="cov-empty">Nothing charges in the next ${c.days} days.</p>`;
    return;
  }

  list.innerHTML = groups.map((b, gi) => `
    <div class="cov-group ${b.status}" style="--chip:${b.color};--i:${gi}">
      <div class="cov-group-head">
        <span class="cov-group-dot"></span>
        <span class="cov-group-name">${esc(b.label)}</span>
        <span class="cov-group-verdict">${groupVerdict(b)}</span>
        <span class="cov-group-total">${UI.currency(b.total)}</span>
      </div>
      <div class="cov-group-items">
        ${b.items.map(it => `
          <div class="cov-row ${it.status}">
            <span class="cov-dot"></span>
            <div class="cov-name"><span class="cov-title">${esc(it.e.name)}</span></div>
            <div class="cov-when">${UI.formatDate(isoDay(it.first))}${it.count > 1 ? ` · ${it.count}×` : ''}</div>
            <div class="cov-amt">${UI.currency(it.total)}</div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// Rolls the walk up per group, so each one answers "can the balance cover this
// whole group?" — and, when it cannot, which of its items miss out. The
// statuses come from the single shared walk, not from pricing each group in
// isolation: groups compete for the same money, in date order.
function coverageByGroup(c) {
  const buckets = new Map();

  c.charges.forEach(ch => {
    const gid = ch.e.group_id || null;
    let b = buckets.get(gid);
    if (!b) {
      const g = App.expenseGroups.find(x => x.id === gid) || null;
      b = {
        gid,
        label: g ? (g.icon ? g.icon + ' ' : '') + g.name : 'Ungrouped',
        color: g ? g.color : '#607D8B',
        total: 0, covered: 0, count: 0, coveredCount: 0, first: ch.date, items: new Map(),
      };
      buckets.set(gid, b);
    }
    b.total += ch.amount;
    b.count++;
    if (ch.covered) { b.covered += ch.amount; b.coveredCount++; }
    if (ch.date < b.first) b.first = ch.date;

    let it = b.items.get(ch.id);
    if (!it) { it = { e: ch.e, total: 0, count: 0, coveredCount: 0, first: ch.date }; b.items.set(ch.id, it); }
    it.total += ch.amount;
    it.count++;
    if (ch.covered) it.coveredCount++;
    if (ch.date < it.first) it.first = ch.date;
  });

  const rank = { uncovered: 0, partial: 1, covered: 2 };
  const statusOf = (done, all) => done === 0 ? 'uncovered' : done < all ? 'partial' : 'covered';

  return [...buckets.values()].map(b => ({
    ...b,
    shortfall: b.total - b.covered,
    status: statusOf(b.coveredCount, b.count),
    items: [...b.items.values()]
      .map(it => ({ ...it, status: statusOf(it.coveredCount, it.count) }))
      .sort((x, y) => rank[x.status] - rank[y.status] || x.first - y.first),
  })).sort((x, y) => y.shortfall - x.shortfall || x.first - y.first);
}

function groupVerdict(b) {
  if (b.status === 'covered') {
    return `All ${b.count} ${b.count === 1 ? 'charge' : 'charges'} covered`;
  }
  if (b.status === 'uncovered') {
    return `None covered · ${UI.currency(b.shortfall)} short`;
  }
  return `${b.coveredCount} of ${b.count} covered · ${UI.currency(b.shortfall)} short`;
}

function renderCostSummary() {
  const el = document.getElementById('cost-summary');
  if (!el) return;
  const active = activeExpenses();

  if (!active.length) {
    el.innerHTML = `<p class="muted-note">Nothing listed yet.</p>`;
    return;
  }

  const perMonth = active.reduce((s, e) => s + monthlyCost(e), 0);
  const groups = App.expenseGroups.map(g => ({
    g, total: active.filter(e => e.group_id === g.id).reduce((s, e) => s + monthlyCost(e), 0),
    count: active.filter(e => e.group_id === g.id).length,
  })).filter(r => r.count > 0);
  const loose = active.filter(e => !e.group_id);
  if (loose.length) {
    groups.push({ g: { id: null, name: 'Ungrouped', color: '#607D8B', icon: '' },
                  total: loose.reduce((s, e) => s + monthlyCost(e), 0), count: loose.length });
  }
  groups.sort((a, b) => b.total - a.total);

  el.innerHTML = `
    <div class="cost-totals">
      <div class="cost-big">
        <span class="cost-label">Every month</span>
        <strong>${UI.currency(perMonth)}</strong>
      </div>
      <div class="cost-big">
        <span class="cost-label">Every year</span>
        <strong>${UI.currency(perMonth * 12)}</strong>
      </div>
    </div>
    <p class="muted-note">${active.length} active ${active.length === 1 ? 'item' : 'items'}
      across ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}.</p>
    <div class="cost-groups">
      ${groups.map((r, i) => `
        <div class="cost-group" style="--i:${i}">
          <div class="cost-group-top">
            <span>${r.g.icon ? esc(r.g.icon) + ' ' : ''}${esc(r.g.name)}
              <span class="muted-note">· ${r.count}</span></span>
            <strong>${UI.currency(r.total)}<span class="muted-note">/mo</span></strong>
          </div>
          <div class="cost-bar"><div class="cost-bar-fill"
            style="width:${perMonth ? (r.total / perMonth) * 100 : 0}%;background:${r.g.color}"></div></div>
        </div>`).join('')}
    </div>`;
}

const REVIEW_STALE_DAYS = 90;

function renderAttention() {
  const el = document.getElementById('attention-list');
  if (!el) return;
  const active = activeExpenses();
  if (!active.length) {
    el.innerHTML = `<p class="muted-note">Nothing to check yet.</p>`;
    return;
  }

  const cutoff = Date.now() - REVIEW_STALE_DAYS * 86400000;
  const stale  = active.filter(e => new Date(e.last_reviewed_at).getTime() < cutoff)
    .sort((a, b) => monthlyCost(b) - monthlyCost(a));
  const priciest = [...active].sort((a, b) => monthlyCost(b) - monthlyCost(a)).slice(0, 3);

  const item = (e, note) => `
    <div class="att-row">
      <div class="att-main">
        <span class="att-name">${esc(e.name)}</span>
        <span class="att-note">${note}</span>
      </div>
      <div class="att-cost">${UI.currency(monthlyCost(e))}<span class="muted-note">/mo</span></div>
    </div>`;

  const parts = [];
  if (stale.length) {
    parts.push(`<div class="att-head">Not checked in ${REVIEW_STALE_DAYS}+ days</div>`);
    parts.push(stale.slice(0, 4).map(e => `
      <div class="att-row">
        <div class="att-main">
          <span class="att-name">${esc(e.name)}</span>
          <span class="att-note">${UI.currency(monthlyCost(e) * 12)} a year if you keep it</span>
        </div>
        <div class="att-actions">
          <button class="btn btn-ghost btn-sm" onclick="reviewExpense('${e.id}')">Still using it</button>
          <button class="icon-btn del-btn" title="Remove" onclick="deleteExpense('${e.id}')">✕</button>
        </div>
      </div>`).join(''));
  }

  parts.push(`<div class="att-head">Costs the most</div>`);
  parts.push(priciest.map(e => item(e, cadenceLabel(e) + ' · ' + UI.currency(monthlyCost(e) * 12) + ' a year')).join(''));

  el.innerHTML = parts.join('');
}

// ── EXPENSES PAGE ────────────────────────────────────────────
function renderExpenses() {
  renderImportBanner();
  renderExpenseGroups();
}

// Everything is listed, paused included — a paused row is dimmed and badged
// rather than hidden, so nothing can quietly disappear from the picture.
function visibleExpenses() {
  const { search, sort } = App.expenseFilters;
  let list = [...(App.expenses || [])];
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(e => e.name.toLowerCase().includes(q) ||
      (e.notes || '').toLowerCase().includes(q) ||
      (groupOf(e)?.name || '').toLowerCase().includes(q));
  }
  const by = {
    due:  (a, b) => (nextChargeOf(a) || Infinity) - (nextChargeOf(b) || Infinity),
    cost: (a, b) => monthlyCost(b) - monthlyCost(a),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort(by[sort] || by.due);
}

function renderExpenseGroups() {
  const el = document.getElementById('expense-groups');
  if (!el) return;

  const list = visibleExpenses();
  if (!(App.expenses || []).length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🧾</div>
      <p>Nothing here yet. Add every subscription, bill, loan and repayment — the app works out
      what your balance covers.</p>
      <button class="btn btn-primary" onclick="openAddExpense()">+ Add your first expense</button></div>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>
      <p>Nothing matches that.</p></div>`;
    return;
  }

  const buckets = App.expenseGroups.map(g => ({ g, items: list.filter(e => e.group_id === g.id) }));
  const loose = list.filter(e => !e.group_id || !App.expenseGroups.some(g => g.id === e.group_id));
  if (loose.length) buckets.push({ g: null, items: loose });

  el.innerHTML = buckets.filter(b => b.items.length || b.g).map((b, gi) => {
    const total = b.items.filter(e => e.is_active).reduce((s, e) => s + monthlyCost(e), 0);
    const color = b.g ? b.g.color : '#607D8B';
    return `
      <div class="group-card" style="--accent:${color};--i:${gi}">
        <div class="group-head">
          <div class="group-id">
            <span class="group-dot"></span>
            <span class="group-name">${b.g ? (b.g.icon ? esc(b.g.icon) + ' ' : '') + esc(b.g.name) : 'Ungrouped'}</span>
            <span class="group-count">${b.items.length}</span>
          </div>
          <div class="group-right">
            <span class="group-total">${UI.currency(total)}<span class="muted-note">/mo</span></span>
            ${b.g ? `
              <button class="icon-btn edit-btn" title="Edit group" onclick="openEditGroup('${b.g.id}')">✎</button>
              <button class="icon-btn del-btn" title="Delete group" onclick="deleteGroup('${b.g.id}')">✕</button>
            ` : ''}
          </div>
        </div>
        <div class="group-items">
          ${b.items.length
            ? b.items.map((e, i) => expenseRow(e, i)).join('')
            : `<p class="muted-note" style="padding:10px 0">Nothing filed here yet.</p>`}
        </div>
      </div>`;
  }).join('');
}

function expenseRow(e, i) {
  const next   = nextChargeOf(e);
  const ended  = !next;
  const days   = next ? Math.round((next - dayStart(new Date())) / 86400000) : null;
  const soon   = days !== null && days <= 3;
  const when   = ended ? 'Finished'
    : days === 0 ? 'Today'
    : days === 1 ? 'Tomorrow'
    : `${UI.formatDate(isoDay(next))} · in ${days} days`;

  return `
    <div class="exp-row ${e.is_active ? '' : 'paused'}" data-id="${e.id}" style="--i:${i}">
      <div class="exp-main">
        <span class="exp-name">${esc(e.name)}</span>
        <span class="exp-sub">
          <span class="exp-cadence">${cadenceLabel(e)}</span>
          <span class="exp-when ${soon ? 'soon' : ''} ${ended ? 'ended' : ''}">${when}</span>
          ${e.notes ? `<span class="exp-note" title="${esc(e.notes)}">${esc(e.notes)}</span>` : ''}
          <span class="exp-status">Paused</span>
        </span>
      </div>
      <div class="exp-money">
        <span class="exp-amount">${Money.fmt(e.amount, e.currency)}</span>
        <span class="exp-equiv">${UI.currency(monthlyCost(e))}/mo · ${UI.currency(monthlyCost(e) * 12)}/yr</span>
      </div>
      <div class="exp-actions">
        <button class="icon-btn edit-btn" title="Edit" onclick="openEditExpense('${e.id}')">✎</button>
        <button class="icon-btn ${e.is_active ? 'pause-btn' : 'play-btn'}"
          title="${e.is_active ? 'Pause' : 'Resume'}"
          onclick="toggleExpense('${e.id}',${e.is_active})">${e.is_active ? '⏸' : '▶'}</button>
        <button class="icon-btn del-btn" title="Remove" onclick="deleteExpense('${e.id}')">✕</button>
      </div>
    </div>`;
}

// Pausing flips the row in place so the fade has two states to travel between.
function applyExpenseState(id, active) {
  const row = document.querySelector(`.exp-row[data-id="${id}"]`);
  if (!row) return;
  row.classList.toggle('paused', !active);
  const btn = row.querySelector('.pause-btn, .play-btn');
  if (!btn) return;
  btn.classList.toggle('pause-btn', active);
  btn.classList.toggle('play-btn', !active);
  btn.title = active ? 'Pause' : 'Resume';
  btn.textContent = active ? '⏸' : '▶';
  btn.setAttribute('onclick', `toggleExpense('${id}',${active})`);
}

async function toggleExpense(id, isActive) {
  const next = !isActive;
  applyExpenseState(id, next);
  const { error } = await db.from('expenses')
    .update({ is_active: next, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', App.user.id);
  if (error) { applyExpenseState(id, isActive); UI.toast(error.message, 'error'); return; }
  const e = App.expenses.find(x => x.id === id);
  if (e) e.is_active = next;
  UI.toast(next ? 'Resumed.' : 'Paused — it stops counting against your balance.', 'info');
  refreshGroupTotal(e?.group_id);
}

// The group subtotal after a row is paused or resumed, without rebuilding the
// list — the row stays put so its fade is actually visible.
function refreshGroupTotal(groupId) {
  const cards = document.querySelectorAll('.group-card');
  const index = groupId
    ? App.expenseGroups.findIndex(g => g.id === groupId)
    : App.expenseGroups.length;
  const card = cards[index];
  if (!card) return;
  const total = (App.expenses || [])
    .filter(e => e.is_active && (groupId ? e.group_id === groupId : !e.group_id))
    .reduce((s, e) => s + monthlyCost(e), 0);
  const el = card.querySelector('.group-total');
  if (el) el.innerHTML = `${UI.currency(total)}<span class="muted-note">/mo</span>`;
}

async function reviewExpense(id) {
  const { error } = await db.from('expenses')
    .update({ last_reviewed_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', App.user.id);
  if (error) { UI.toast(error.message, 'error'); return; }
  const e = App.expenses.find(x => x.id === id);
  if (e) e.last_reviewed_at = new Date().toISOString();
  UI.toast('Marked as checked.', 'success');
  renderAttention();
}

async function deleteExpense(id) {
  const e = App.expenses.find(x => x.id === id);
  UI.confirm(`Remove ${e?.name || 'this expense'}?`, async () => {
    const { error } = await db.from('expenses').delete().eq('id', id).eq('user_id', App.user.id);
    if (error) { UI.toast(error.message, 'error'); return; }
    await loadExpenses();
    renderExpenses();
    UI.toast('Removed.', 'success');
  });
}

// ── Expense modal ────────────────────────────────────────────
function populateGroupSelect(selected) {
  const el = document.getElementById('exp-group');
  if (!el) return;
  el.innerHTML = `<option value="">No group</option>` +
    App.expenseGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  el.value = selected || '';
}

function wireCadenceToggle() {
  const sel = document.getElementById('exp-cadence');
  if (!sel || sel.dataset.wired) return;
  sel.dataset.wired = '1';
  sel.addEventListener('change', () => {
    document.getElementById('exp-custom-wrap').hidden = sel.value !== 'custom';
  });
}

function openAddExpense(groupId) {
  App.editing.expense = null;
  document.getElementById('expense-modal-title').textContent = 'Add Expense';
  document.getElementById('exp-name').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-cadence').value = 'monthly';
  document.getElementById('exp-custom-days').value = '';
  document.getElementById('exp-custom-wrap').hidden = true;
  document.getElementById('exp-next-due').value = isoDay(new Date());
  document.getElementById('exp-ends-on').value = '';
  document.getElementById('exp-notes').value = '';
  populateGroupSelect(groupId || '');
  wireCadenceToggle();
  initCurrencyInputs();
  UI.openModal('expense-modal');
}

function openEditExpense(id) {
  const e = App.expenses.find(x => x.id === id);
  if (!e) return;
  App.editing.expense = e;
  document.getElementById('expense-modal-title').textContent = 'Edit Expense';
  document.getElementById('exp-name').value = e.name;
  document.getElementById('exp-amount').value = Fmt.set(Money.toActive(e.amount, e.currency));
  document.getElementById('exp-cadence').value = e.cadence;
  document.getElementById('exp-custom-days').value = e.custom_days || '';
  document.getElementById('exp-custom-wrap').hidden = e.cadence !== 'custom';
  document.getElementById('exp-next-due').value = String(e.next_due).slice(0, 10);
  document.getElementById('exp-ends-on').value = e.ends_on ? String(e.ends_on).slice(0, 10) : '';
  document.getElementById('exp-notes').value = e.notes || '';
  populateGroupSelect(e.group_id || '');
  wireCadenceToggle();
  initCurrencyInputs();
  UI.openModal('expense-modal');
}

async function saveExpense() {
  const name    = document.getElementById('exp-name').value.trim();
  const amount  = Fmt.get(document.getElementById('exp-amount').value);
  const cadence = document.getElementById('exp-cadence').value;
  const custom  = parseInt(document.getElementById('exp-custom-days').value, 10);
  const nextDue = document.getElementById('exp-next-due').value;
  const groupId = document.getElementById('exp-group').value || null;
  const endsOn  = document.getElementById('exp-ends-on').value || null;
  const notes   = document.getElementById('exp-notes').value.trim() || null;

  if (!name)                        { UI.toast('Give it a name.', 'error'); return; }
  if (!amount || amount <= 0)       { UI.toast('Amount must be more than zero.', 'error'); return; }
  if (!nextDue)                     { UI.toast('Pick the next charge date.', 'error'); return; }
  if (cadence === 'custom' && !(custom >= 1 && custom <= 3650)) {
    UI.toast('Enter how many days between charges (1–3650).', 'error'); return;
  }
  if (endsOn && endsOn < nextDue)   { UI.toast('The end date cannot be before the next charge.', 'error'); return; }

  const btn = document.getElementById('exp-save-btn');
  UI.setLoading(btn, true);

  // Recorded in the currency on screen, like every other amount here.
  const payload = {
    name, amount, cadence,
    custom_days: cadence === 'custom' ? custom : null,
    next_due: nextDue, ends_on: endsOn, notes,
    group_id: groupId,
    currency: CurrencySettings.activeCode,
    updated_at: new Date().toISOString(),
  };

  const { error } = App.editing.expense
    ? await db.from('expenses').update(payload).eq('id', App.editing.expense.id).eq('user_id', App.user.id)
    : await db.from('expenses').insert([{ ...payload, user_id: App.user.id,
        sort_order: (App.expenses || []).length, last_reviewed_at: new Date().toISOString() }]);

  UI.setLoading(btn, false);
  if (error) { UI.toast(error.message, 'error'); return; }

  UI.closeModal('expense-modal');
  await loadExpenses();
  await CurrencySettings.ensureRates(Money.usedCodes());
  renderExpenses();
  UI.toast(App.editing.expense ? 'Updated.' : `${name} added.`, 'success');
}

// ── Group modal ──────────────────────────────────────────────
function renderSwatches(selected) {
  const el = document.getElementById('grp-swatches');
  if (!el) return;
  el.innerHTML = GROUP_COLORS.map(c => `
    <button type="button" class="swatch ${c === selected ? 'active' : ''}" data-color="${c}"
      style="background:${c}" aria-label="${c}"></button>`).join('');
  el.querySelectorAll('.swatch').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));
}

function selectedSwatch() {
  return document.querySelector('#grp-swatches .swatch.active')?.dataset.color || GROUP_COLORS[0];
}

function openAddGroup() {
  App.editing.group = null;
  document.getElementById('group-modal-title').textContent = 'New Group';
  document.getElementById('grp-name').value = '';
  document.getElementById('grp-icon').value = '';
  renderSwatches(GROUP_COLORS[App.expenseGroups.length % GROUP_COLORS.length]);
  UI.openModal('group-modal');
}

function openEditGroup(id) {
  const g = App.expenseGroups.find(x => x.id === id);
  if (!g) return;
  App.editing.group = g;
  document.getElementById('group-modal-title').textContent = 'Edit Group';
  document.getElementById('grp-name').value = g.name;
  document.getElementById('grp-icon').value = g.icon || '';
  renderSwatches(g.color);
  UI.openModal('group-modal');
}

async function saveGroup() {
  const name = document.getElementById('grp-name').value.trim();
  const icon = document.getElementById('grp-icon').value.trim() || null;
  if (!name) { UI.toast('Give the group a name.', 'error'); return; }

  const btn = document.getElementById('grp-save-btn');
  UI.setLoading(btn, true);
  const payload = { name, icon, color: selectedSwatch(), updated_at: new Date().toISOString() };
  const { error } = App.editing.group
    ? await db.from('expense_groups').update(payload).eq('id', App.editing.group.id).eq('user_id', App.user.id)
    : await db.from('expense_groups').insert([{ ...payload, user_id: App.user.id,
        sort_order: App.expenseGroups.length }]);
  UI.setLoading(btn, false);
  if (error) { UI.toast(error.message, 'error'); return; }

  UI.closeModal('group-modal');
  await loadExpenseGroups();
  renderExpenses();
  UI.toast(App.editing.group ? 'Group updated.' : `${name} created.`, 'success');
}

async function deleteGroup(id) {
  const g = App.expenseGroups.find(x => x.id === id);
  const inside = (App.expenses || []).filter(e => e.group_id === id).length;
  UI.confirm(
    inside
      ? `Delete ${g?.name}? Its ${inside} ${inside === 1 ? 'expense stays' : 'expenses stay'}, just ungrouped.`
      : `Delete ${g?.name}?`,
    async () => {
      const { error } = await db.from('expense_groups').delete().eq('id', id).eq('user_id', App.user.id);
      if (error) { UI.toast(error.message, 'error'); return; }
      await Promise.all([loadExpenseGroups(), loadExpenses()]);
      renderExpenses();
      UI.toast('Group deleted.', 'success');
    });
}

// ── One-time import of the old recurring entries ─────────────
function importableRecurring() {
  if ((App.expenses || []).length) return [];
  return (App.recurring || []).filter(r => r.type === 'expense');
}

function renderImportBanner() {
  const el = document.getElementById('import-banner');
  if (!el) return;
  const rows = importableRecurring();
  if (!rows.length || localStorage.getItem('mrwisemax_import_dismissed')) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="import-banner">
      <div>
        <strong>Bring over your old entries?</strong>
        <span>${rows.length} recurring ${rows.length === 1 ? 'expense' : 'expenses'} from the previous
          version can be added here as monthly costs.</span>
      </div>
      <div class="import-actions">
        <button class="btn btn-ghost btn-sm" onclick="dismissImport()">No thanks</button>
        <button class="btn btn-primary btn-sm" onclick="importRecurring()">Import</button>
      </div>
    </div>`;
}

function dismissImport() {
  localStorage.setItem('mrwisemax_import_dismissed', '1');
  renderImportBanner();
}

async function importRecurring() {
  const rows = importableRecurring();
  if (!rows.length) return;
  const today = new Date();
  const payload = rows.map((r, i) => {
    const due = new Date(today.getFullYear(), today.getMonth(), Math.min(r.day_of_month || 1, 28));
    if (due < dayStart(today)) due.setMonth(due.getMonth() + 1);
    return {
      user_id: App.user.id, name: r.description || r.category, amount: r.amount,
      currency: r.currency || CurrencySettings.main.code, cadence: 'monthly',
      next_due: isoDay(due), is_active: r.is_active !== false, sort_order: i,
    };
  });
  const { error } = await db.from('expenses').insert(payload);
  if (error) { UI.toast(error.message, 'error'); return; }
  localStorage.setItem('mrwisemax_import_dismissed', '1');
  await loadExpenses();
  await CurrencySettings.ensureRates(Money.usedCodes());
  renderExpenses();
  UI.toast(`Imported ${payload.length} ${payload.length === 1 ? 'expense' : 'expenses'}.`, 'success');
}

// ── Page controls ────────────────────────────────────────────
function setupExpenseControls() {
  const search = document.getElementById('expense-search');
  if (search) search.addEventListener('input', () => {
    App.expenseFilters.search = search.value.trim();
    renderExpenseGroups();
  });

  const sort = document.getElementById('expense-sort');
  if (sort) sort.addEventListener('change', () => {
    App.expenseFilters.sort = sort.value;
    renderExpenseGroups();
  });

  document.getElementById('coverage-window')?.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    App.coverageWindow = +btn.dataset.days;
    document.querySelectorAll('#coverage-window .seg-btn')
      .forEach(b => b.classList.toggle('active', b === btn));
    renderCoverage();
  });
}

// ── EDUCATION ─────────────────────────────────────────────────
function renderEducation() {} // Static content in HTML

// ── HELPERS ───────────────────────────────────────────────────
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }

// ── SETTINGS ─────────────────────────────────────────────────
function updateCurrencyBanner() {
  const banner = document.getElementById('usd-view-banner');
  if (banner) banner.style.display = CurrencySettings.isUSDMode ? 'flex' : 'none';
  updateAmountLabels();
}

function updateAmountLabels() {
  const sym = CurrencySettings.activeSymbol;
  const map = {
    'lbl-exp-amount':    `Amount (${sym}) *`,
    'lbl-balance-input': `Your accounts (${sym})`,
  };
  Object.entries(map).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}

function exitUSDMode() {
  CurrencySettings.viewCurrency = 'main';
  CurrencySettings._applyViewMode();
  navigateTo(App.activeSection);
  UI.toast(`Back to ${CurrencySettings.main.name} (${CurrencySettings.main.code})`, 'success');
}

function openCurrencySettingsModal() {
  const searchEl = document.getElementById('currency-search-input');
  if (searchEl) searchEl.value = '';
  renderCurrencyStatusRow();
  renderCurrencyList('');
  UI.openModal('currency-modal');
}

function renderCurrencyStatusRow() {
  const el = document.getElementById('currency-status-row');
  if (!el) return;
  const { main, viewCurrency, isUSDMode, rateToUSD } = CurrencySettings;
  const usd = CURRENCIES.find(c => c.code === 'USD');

  const rateNote = main.code !== 'USD' && rateToUSD !== 1
    ? `<div class="cur-status-note">1 ${main.code} ≈ ${rateToUSD.toFixed(4)} USD</div>`
    : '';

  const mainCard = `
    <div class="cur-status-card${!isUSDMode ? ' cur-status-active' : ''}"
      ${isUSDMode ? 'style="cursor:pointer" onclick="UI.closeModal(\'currency-modal\'); exitUSDMode();"' : ''}>
      <div class="cur-status-label">Main Currency${isUSDMode ? ' — click to restore' : ''}</div>
      <div class="cur-status-flag">${main.flag}</div>
      <div class="cur-status-name">${main.name}</div>
      <div class="cur-status-code">${main.code} <span class="cur-status-sym">${main.symbol}</span></div>
      ${rateNote}
    </div>`;

  const usdCard = main.code !== 'USD' ? `
    <div class="cur-status-card${isUSDMode ? ' cur-status-active' : ''}" style="cursor:pointer" onclick="selectCurrency('USD')">
      <div class="cur-status-label">USD View</div>
      <div class="cur-status-flag">${usd.flag}</div>
      <div class="cur-status-name">${usd.name}</div>
      <div class="cur-status-code">${usd.code} <span class="cur-status-sym">${usd.symbol}</span></div>
      <div class="cur-status-usd">${isUSDMode ? 'Active' : 'Click to view'}</div>
    </div>` : '';

  el.innerHTML = mainCard + usdCard;
}

function renderCurrencyList(query) {
  const el = document.getElementById('currency-options-list');
  if (!el) return;
  const q = query.trim().toLowerCase();
  const list = q
    ? CURRENCIES.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    : CURRENCIES;
  const mainCode   = CurrencySettings.main.code;
  const activeCode = CurrencySettings.isUSDMode ? 'USD' : mainCode;

  el.innerHTML = list.map(c => {
    const isMain   = c.code === mainCode;
    const isActive = c.code === activeCode;
    const badges = [
      isMain && isActive ? '<span class="cur-badge cur-badge-main">Main · Active</span>'
        : isMain          ? '<span class="cur-badge cur-badge-main">Main</span>'
        : isActive        ? '<span class="cur-badge cur-badge-active">Active</span>'
        : '',
    ].join('');
    return `
    <div class="currency-option${isActive ? ' selected' : ''}" onclick="selectCurrency('${c.code}')">
      <span class="currency-flag">${c.flag}</span>
      <span class="currency-name">${c.name}</span>
      <div style="display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0">
        ${badges}
        <span class="currency-code">${c.code}</span>
        <span class="currency-symbol">${c.symbol}</span>
      </div>
    </div>`;
  }).join('');
}

function filterCurrencies(value) { renderCurrencyList(value); }

function selectCurrency(code) {
  const found = CURRENCIES.find(c => c.code === code);
  if (!found) return;

  const main = CurrencySettings.main;

  // No-op: clicking the already-active currency
  if (code === main.code && !CurrencySettings.isUSDMode) return;
  if (code === 'USD' && CurrencySettings.isUSDMode) return;

  // Case 1: switching INTO USD view mode (main ≠ USD, clicking USD)
  if (code === 'USD' && main.code !== 'USD') {
    UI.confirm(
      `Switch to USD? Everything is converted at today's rate, except amounts you already entered in USD — those stay exactly as you typed them. Anything you add while viewing USD is saved as USD.`,
      async () => {
        UI.closeModal('currency-modal');
        await CurrencySettings.ensureRates(Money.usedCodes());
        CurrencySettings.viewCurrency = 'USD';
        CurrencySettings._applyViewMode();
        navigateTo(App.activeSection);
        UI.toast('Now showing US Dollar (USD).', 'info');
      },
      false
    );
    return;
  }

  // Case 2: switching back from USD view to main
  if (CurrencySettings.isUSDMode && code === main.code) {
    UI.closeModal('currency-modal');
    CurrencySettings.viewCurrency = 'main';
    CurrencySettings._applyViewMode();
    navigateTo(App.activeSection);
    UI.toast(`Back to ${main.name} (${main.code})`, 'success');
    return;
  }

  // Case 3: changing the main currency
  UI.confirm(
    `Set ${found.name} (${found.code}) as your main currency? Everything you've saved is converted at today's rate — amounts already entered in ${found.code} stay exactly as they are.`,
    async () => {
      UI.closeModal('currency-modal');
      CurrencySettings.main = found;
      CurrencySettings.viewCurrency = 'main';
      await CurrencySettings.ensureRates(Money.usedCodes());
      CurrencySettings.save();
      updateCurrencyBanner();
      navigateTo(App.activeSection);
      UI.toast(`Currency set to ${found.name} (${found.code})`, 'success');
    },
    false
  );
}

// ── SIGN OUT ─────────────────────────────────────────────────
function setupSignOut() {
  document.getElementById('signout-btn')?.addEventListener('click', () => {
    UI.confirm('Sign out of MrWiseMax?', () => Auth.signOut(), false);
  });
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  setupSignOut();
});
