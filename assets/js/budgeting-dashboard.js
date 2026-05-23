// ============================================================
// MrWiseMax — Dashboard Application Logic
// ============================================================

// ── App State ────────────────────────────────────────────────
const App = {
  user: null,
  profile: null,
  transactions: [],
  categories: [],
  plans: [],
  goals: [],
  recurring: [],
  blueprints: [],
  communityTemplates: [],
  savedBlueprintIds: new Set(),
  likedBlueprintIds: new Set(),
  charts: {},
  activeSection: 'overview',
  filters: { month: '', year: '', category: '', type: '' },
  editing: { transaction: null, plan: null, goal: null, recurring: null },
  communitySearch: '',
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
  rateToUSD: 1,

  get isUSDMode() {
    return this.main.code !== 'USD' && this.viewCurrency === 'USD';
  },

  canEdit() {
    if (this.isUSDMode) {
      UI.toast('Go back to your main currency to make changes.', 'warning');
      return false;
    }
    return true;
  },

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem('mrwisemax_currency') || 'null');
      if (saved?.code) {
        const found = CURRENCIES.find(c => c.code === saved.code);
        if (found) this.main = found;
      }
      if (saved?.view === 'USD' && this.main.code !== 'USD') this.viewCurrency = 'USD';
    } catch (_) {}
    if (this.main.code !== 'USD') this._fetchRate(this.main.code);
  },

  async _fetchRate(code) {
    try {
      const cache = JSON.parse(localStorage.getItem('mrwisemax_rate_cache') || 'null');
      if (cache?.code === code && cache.rate && (Date.now() - cache.ts) < 3600000) {
        this.rateToUSD = cache.rate;
        return;
      }
    } catch (_) {}
    try {
      // fawazahmed0 CDN — no auth, CORS-safe, updates daily
      const res  = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${code.toLowerCase()}.json`);
      if (!res.ok) return;
      const data = await res.json();
      const rate = data[code.toLowerCase()]?.usd;
      if (rate) {
        this.rateToUSD = rate;
        localStorage.setItem('mrwisemax_rate_cache', JSON.stringify({ code, rate, ts: Date.now() }));
        if (App.activeSection === 'overview') renderOverview();
      }
    } catch (_) { this.rateToUSD = 1; }
  },

  save() {
    localStorage.setItem('mrwisemax_currency', JSON.stringify({
      code: this.main.code,
      view: this.viewCurrency,
    }));
  },

  toUSD(amount) { return parseFloat(amount || 0) * this.rateToUSD; },

  _applyViewMode() { this.save(); updateCurrencyBanner(); },
};

// Patch UI.currency — apply USD conversion when in USD view mode
(function () {
  const _orig = UI.currency;
  UI.currency = function (amount, forceSymbol) {
    if (forceSymbol !== undefined) return _orig(amount, forceSymbol);
    if (CurrencySettings.isUSDMode) return _orig(parseFloat(amount || 0) * CurrencySettings.rateToUSD, '$');
    return _orig(amount, CurrencySettings.main.symbol);
  };
})();

// Block edit-type modals when in USD view mode
(function () {
  const _origOpen = UI.openModal;
  const EDIT_MODALS = new Set([
    'transaction-modal', 'goal-modal', 'contribute-modal',
    'plan-modal', 'recurring-modal', 'share-blueprint-modal',
  ]);
  UI.openModal = function (id) {
    if (EDIT_MODALS.has(id) && !CurrencySettings.canEdit()) return;
    _origOpen(id);
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

function initCurrencyInputs() {
  document.querySelectorAll('.fmt-currency').forEach(el => {
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

  await Promise.all([loadProfile(), loadCategories(), loadTransactions(), loadPlans(), loadGoals(), loadRecurring()]);
  renderUserInfo(); // Re-render with full profile data (nickname + custom avatar)
  processRecurringTransactions(); // auto-post any pending monthly entries

  initCurrencyInputs();
  navigateTo('overview');
  NavHistory.init();
  setupNavigation();
  setupFilterListeners();
  setupDynamicLayout();
  subscribeToBlueprints();
  Chat.initGlobal(); // Start background badge tracking
}

function renderUserInfo() {
  const nickname = App.profile?.nickname;
  const name     = nickname || App.profile?.full_name || App.user.user_metadata?.full_name || App.user.email?.split('@')[0] || 'User';
  const username = App.profile?.username ? `@${App.profile.username}` : '';
  // Prefer custom-uploaded avatar, then Google avatar
  const avatar   = App.profile?.avatar_url_storage || App.user.user_metadata?.avatar_url || App.profile?.avatar_url;

  document.querySelectorAll('.user-name-display').forEach(el => (el.textContent = name));
  document.querySelectorAll('.user-username-display').forEach(el => (el.textContent = username));
  document.querySelectorAll('.user-avatar').forEach(el => {
    el.innerHTML = avatar
      ? `<img src="${avatar}" alt="${name}" onerror="this.parentElement.textContent='${UI.avatarInitials(name)}';">`
      : UI.avatarInitials(name);
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
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === section));

  // Others button active when simulate or compare is selected
  const othersBtn = document.getElementById('mobile-others-btn');
  if (othersBtn) othersBtn.classList.toggle('active', ['simulate', 'compare'].includes(section));

  // Close Others popup whenever we navigate
  document.getElementById('mobile-more-popup')?.classList.remove('open');

  // Manage chat updaters — stop all when leaving messages section
  if (section !== 'messages') {
    Chat.stopTimeUpdater();
    Chat.stopMessagePoll();
    Chat.stopRecording?.();
  }

  const loaders = { overview: renderOverview, vault: renderVault, plans: renderPlans,
    simulate: renderSimulate, compare: renderCompare, community: loadAndRenderCommunity,
    saved: loadAndRenderSaved, education: renderEducation, profile: renderProfile,
    messages: () => Chat.init() };
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
// Runs on boot, resize, and orientation change so every section and the
// chat panel fit the exact visible area on any device.

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

  // -- CSS variable (consumed by .chat-layout height calc and any other rule) --
  document.documentElement.style.setProperty('--available-vh', `${availH}px`);

  // -- dash-content bottom padding keeps scrollable content above the fixed nav --
  dashContent.style.paddingBottom = isMobile ? `${navH + padH}px` : '';

  // -- Every section gets a min-height so it fills the full visible area --
  document.querySelectorAll('.dash-section').forEach(s => {
    s.style.minHeight = `${availH}px`;
  });

  // -- Chat layout gets an exact height (panel doesn't scroll; messages do) --
  const chatLayout = document.querySelector('.chat-layout');
  if (chatLayout) {
    chatLayout.style.height = `${availH - padH * 2}px`;
  }
}

// ── Data Loaders ─────────────────────────────────────────────
async function loadProfile()      { const { data } = await db.from('profiles').select('*').eq('id', App.user.id).single(); if (data) App.profile = data; }
async function loadRecurring()    { const { data } = await db.from('recurring_transactions').select('*').eq('user_id', App.user.id).order('created_at'); if (data) App.recurring = data; }
async function loadCommunityTemplates() {
  const { data } = await db.from('community_templates').select('*').eq('is_active', true).order('sort_order');
  if (data) App.communityTemplates = data;
}
async function loadCategories()   { const { data } = await db.from('categories').select('*').eq('user_id', App.user.id).order('name'); if (data) App.categories = data; }
async function loadTransactions() { const { data } = await db.from('transactions').select('*').eq('user_id', App.user.id).order('date', { ascending: false }); if (data) App.transactions = data; }
async function loadPlans()        { const { data } = await db.from('budget_plans').select('*').eq('user_id', App.user.id).order('created_at', { ascending: false }); if (data) App.plans = data; }
async function loadGoals()        { const { data } = await db.from('savings_goals').select('*').eq('user_id', App.user.id).order('created_at', { ascending: false }); if (data) App.goals = data; }

async function loadUserInteractions() {
  const [l, s] = await Promise.all([
    db.from('blueprint_likes').select('blueprint_id').eq('user_id', App.user.id),
    db.from('saved_blueprints').select('blueprint_id').eq('user_id', App.user.id),
  ]);
  App.likedBlueprintIds = new Set((l.data || []).map(r => r.blueprint_id));
  App.savedBlueprintIds = new Set((s.data || []).map(r => r.blueprint_id));
}

// ── OVERVIEW ─────────────────────────────────────────────────
function renderOverview() {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  const thisMonth = App.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === month && d.getFullYear() === year;
  });

  const income   = thisMonth.filter(t => t.type === 'income').reduce((s, t) => s + +t.amount, 0);
  const expenses = thisMonth.filter(t => t.type === 'expense').reduce((s, t) => s + +t.amount, 0);
  const savings  = income - expenses;
  const burnRate = income > 0 ? ((expenses / income) * 100).toFixed(1) : 0;
  const score    = calcHealthScore();

  setText('stat-income',   UI.currency(income));
  setText('stat-expenses', UI.currency(expenses));
  setText('stat-savings',  UI.currency(savings));
  setText('stat-burn',     burnRate + '%');

  // USD sub-values (shown only in main view when currency ≠ USD and rate is loaded)
  const _showSub = !CurrencySettings.isUSDMode && CurrencySettings.main.code !== 'USD' && CurrencySettings.rateToUSD !== 1;
  [['stat-income-sub', income], ['stat-expenses-sub', expenses], ['stat-savings-sub', savings]].forEach(([id, amt]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = _showSub ? `≈ ${UI.currency(CurrencySettings.toUSD(amt), '$')} USD` : '';
  });

  renderHealthScore(score);
  renderExpensePieChart(thisMonth);
  renderTrendChart();
  renderRecentTransactions();
  renderGoalsOverview();
}

function calcHealthScore() {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();
  const tx    = App.transactions.filter(t => { const d = new Date(t.date); return d.getMonth() === month && d.getFullYear() === year; });
  const income   = tx.filter(t => t.type === 'income').reduce((s, t) => s + +t.amount, 0);
  const expenses = tx.filter(t => t.type === 'expense').reduce((s, t) => s + +t.amount, 0);
  if (!income) return 0;

  const savingsRate  = ((income - expenses) / income) * 100;
  const expenseRatio = (expenses / income) * 100;
  const goalProg     = App.goals.length > 0
    ? (App.goals.reduce((s, g) => s + Math.min(+g.current_amount / +g.target_amount, 1), 0) / App.goals.length) * 100
    : 50;
  const emergency = App.goals.some(g => g.name.toLowerCase().includes('emergency')) ? 10 : 0;

  let score = 0;
  score += Math.min(savingsRate * 1.4, 35);
  score += Math.max(35 - expenseRatio * 0.35, 0);
  score += goalProg * 0.2;
  score += emergency;
  return Math.round(Math.min(score, 100));
}

function renderHealthScore(score) {
  const el = document.getElementById('health-score');
  if (!el) return;
  const color = UI.healthScoreColor(score);
  const label = UI.healthScoreLabel(score);
  const dash  = 2.64 * score;
  el.innerHTML = `
    <div class="health-score-ring">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="8"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="8"
          stroke-dasharray="${dash} ${264 - dash}" stroke-dashoffset="66"
          stroke-linecap="round" transform="rotate(-90 50 50)"/>
      </svg>
      <div class="health-score-inner">
        <span class="score-num" style="color:${color}">${score}</span>
        <span class="score-label">${label}</span>
      </div>
    </div>`;

  const tips = score >= 80
    ? [
        'Excellent discipline — keep saving consistently every month.',
        'Consider increasing index fund or ETF contributions.',
        'Review all savings goals quarterly and raise targets as income grows.',
        'Ensure you have 6+ months of expenses as an emergency buffer.',
        'Explore tax-advantaged accounts (retirement, ISA, 401k) to grow wealth faster.',
      ]
    : score >= 60
    ? [
        'Aim to save at least 20% of your monthly income.',
        'Identify and cancel one recurring subscription you rarely use.',
        'Build an emergency fund covering 3–6 months of living expenses.',
        'Start or increase contributions to an investment account.',
        'Automate your savings so it happens before you can spend it.',
      ]
    : score >= 40
    ? [
        'Track every single expense this month — awareness is the first step.',
        'Create a strict budget plan in the Plans section and stick to it.',
        'Set up at least one savings goal today, even if it\'s small.',
        'Look for any expenses above 30% of income (especially housing).',
        'Cut or reduce one major non-essential category this month.',
      ]
    : [
        'List every income source you have — including irregular ones.',
        'Cut all non-essential spending until your savings rate is positive.',
        'Create a simple budget plan using the 50/30/20 rule as a start.',
        'Set a debt-reduction goal and attack the highest-interest debt first.',
        'Even saving $50/month builds a habit — start small but start now.',
      ];

  const tipsEl = document.getElementById('health-tips');
  if (tipsEl) tipsEl.innerHTML = tips.map(t => `<li>${t}</li>`).join('');
}

function renderExpensePieChart(transactions) {
  const canvas = document.getElementById('expense-pie-chart');
  if (!canvas) return;

  const expenses = transactions.filter(t => t.type === 'expense');
  const byCat = {};
  expenses.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + +t.amount; });

  if (App.charts.pie) { App.charts.pie.destroy(); App.charts.pie = null; }

  const labels = Object.keys(byCat);
  const values = Object.values(byCat);

  if (!labels.length) {
    const wrap = canvas.parentElement;
    wrap.innerHTML = '<div class="chart-empty">No expense data this month</div>';
    return;
  }

  App.charts.pie = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: UI.CHART_COLORS.slice(0, labels.length), borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { color: '#ccc', padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${UI.currency(ctx.raw)}` } }
      }
    }
  });
}

function renderTrendChart() {
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  if (App.charts.trend) { App.charts.trend.destroy(); App.charts.trend = null; }

  const months = [], incomeData = [], expenseData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const m = d.getMonth(), y = d.getFullYear();
    months.push(UI.monthName(m));
    const mTx = App.transactions.filter(t => { const td = new Date(t.date); return td.getMonth() === m && td.getFullYear() === y; });
    incomeData.push(mTx.filter(t => t.type === 'income').reduce((s, t) => s + +t.amount, 0));
    expenseData.push(mTx.filter(t => t.type === 'expense').reduce((s, t) => s + +t.amount, 0));
  }

  App.charts.trend = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        { label: 'Income',   data: incomeData,  borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.1)', tension: 0.4, fill: true, pointRadius: 4 },
        { label: 'Expenses', data: expenseData, borderColor: '#F44336', backgroundColor: 'rgba(244,67,54,0.1)', tension: 0.4, fill: true, pointRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#ccc', font: { size: 12 } } } },
      scales: {
        x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#888', callback: v => '$' + v.toLocaleString() }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

function renderRecentTransactions() {
  const el = document.getElementById('recent-transactions');
  if (!el) return;
  const recent = App.transactions.slice(0, 8);
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💰</div><p>No transactions yet.</p>
      <button class="btn btn-primary btn-sm" onclick="navigateTo('vault')">Add Transaction</button></div>`;
    return;
  }
  el.innerHTML = recent.map(t => `
    <div class="tx-item">
      <div class="tx-icon ${t.type}">${t.type === 'income' ? '↑' : '↓'}</div>
      <div class="tx-info">
        <span class="tx-desc">${t.description || t.category}</span>
        <span class="tx-cat">${t.category} · ${UI.formatDate(t.date)}</span>
      </div>
      <span class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${UI.currency(t.amount)}</span>
    </div>`).join('');
}

function renderGoalsOverview() {
  const el = document.getElementById('goals-overview');
  if (!el) return;
  if (!App.goals.length) {
    el.innerHTML = `<div class="empty-state"><p>No savings goals yet.</p>
      <button class="btn btn-primary btn-sm" onclick="navigateTo('vault')">Create Goal</button></div>`;
    return;
  }
  el.innerHTML = App.goals.slice(0, 4).map(g => {
    const pct = Math.min((+g.current_amount / +g.target_amount) * 100, 100).toFixed(1);
    return `<div class="goal-item">
      <div class="goal-header"><span class="goal-name">${g.name}</span><span class="goal-pct">${pct}%</span></div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;background:${g.color || '#BB885F'}"></div></div>
      <div class="goal-amounts"><span>${UI.currency(g.current_amount)}</span><span>of ${UI.currency(g.target_amount)}</span></div>
    </div>`;
  }).join('');
}

// ── VAULT ────────────────────────────────────────────────────
function renderVault() {
  populateCategoryDropdowns();
  renderTransactionTable();
  renderGoalsList();
  renderRecurringList();
}

function getFilteredTransactions() {
  const { month, year, category, type } = App.filters;
  return App.transactions.filter(t => {
    const d = new Date(t.date);
    if (month !== '' && d.getMonth() !== +month)    return false;
    if (year  !== '' && d.getFullYear() !== +year)  return false;
    if (category     && t.category !== category)    return false;
    if (type         && t.type !== type)            return false;
    return true;
  });
}

function renderTransactionTable() {
  const el = document.getElementById('transaction-list');
  if (!el) return;
  const txs = getFilteredTransactions();
  if (!txs.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💳</div><p>No transactions found.</p>
      <button class="btn btn-primary" onclick="openAddTransaction()">+ Add Transaction</button></div>`;
    return;
  }
  el.innerHTML = txs.map(t => `
    <div class="tx-row">
      <div class="tx-date">${UI.formatDate(t.date)}</div>
      <div class="tx-details">
        <span class="tx-desc">${t.description || '—'}</span>
        <span class="tx-badge">${t.category}</span>
      </div>
      <div class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${UI.currency(t.amount)}</div>
      <div class="tx-actions">
        <button class="icon-btn edit-btn" onclick="openEditTransaction('${t.id}')" title="Edit">✎</button>
        <button class="icon-btn del-btn"  onclick="deleteTransaction('${t.id}')"   title="Delete">✕</button>
      </div>
    </div>`).join('');
}

function setupFilterListeners() {
  // Populate year filter
  const yearEl = document.getElementById('filter-year');
  if (yearEl && !yearEl.dataset.populated) {
    const cur = new Date().getFullYear();
    for (let y = cur; y >= cur - 5; y--) yearEl.innerHTML += `<option value="${y}">${y}</option>`;
    yearEl.dataset.populated = '1';
  }

  ['filter-month','filter-year','filter-category','filter-type'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      App.filters.month    = document.getElementById('filter-month')?.value    || '';
      App.filters.year     = document.getElementById('filter-year')?.value     || '';
      App.filters.category = document.getElementById('filter-category')?.value || '';
      App.filters.type     = document.getElementById('filter-type')?.value     || '';
      renderTransactionTable();
    });
  });
}

function populateCategoryDropdowns() {
  const filterEl = document.getElementById('filter-category');
  if (filterEl) {
    filterEl.innerHTML = '<option value="">All Categories</option>' +
      App.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }
}

// Add / Edit Transaction
function openAddTransaction() {
  App.editing.transaction = null;
  document.getElementById('tx-modal-title').textContent = 'Add Transaction';
  document.getElementById('tx-type').value        = 'expense';
  document.getElementById('tx-amount').value      = '';
  document.getElementById('tx-description').value = '';
  document.getElementById('tx-date').value        = new Date().toISOString().split('T')[0];
  populateTxCategoryDropdown('');
  // Re-populate categories whenever type changes
  const typeEl = document.getElementById('tx-type');
  if (!typeEl.dataset.wired) {
    typeEl.dataset.wired = '1';
    typeEl.addEventListener('change', () => populateTxCategoryDropdown(''));
  }
  UI.openModal('transaction-modal');
}

function openEditTransaction(id) {
  const tx = App.transactions.find(t => t.id === id);
  if (!tx) return;
  App.editing.transaction = tx;
  document.getElementById('tx-modal-title').textContent = 'Edit Transaction';
  document.getElementById('tx-type').value        = tx.type;
  document.getElementById('tx-amount').value      = Fmt.set(tx.amount);
  document.getElementById('tx-description').value = tx.description || '';
  document.getElementById('tx-date').value        = UI.formatDateInput(tx.date);
  populateTxCategoryDropdown(tx.category);
  UI.openModal('transaction-modal');
}

function initCategoryCombo(inputId, suggestionsId, categories, selected) {
  const input = document.getElementById(inputId);
  const box   = document.getElementById(suggestionsId);
  if (!input || !box) return;

  // Clone to remove stale listeners
  const freshInput = input.cloneNode(true);
  input.parentNode.replaceChild(freshInput, input);
  const freshBox = box.cloneNode(false);
  box.parentNode.replaceChild(freshBox, box);

  freshInput.value = selected || '';

  function showSuggestions(query) {
    const q = query.trim().toLowerCase();
    const matched = (q
      ? categories.filter(c => c.name.toLowerCase().includes(q))
      : categories
    ).slice(0, 5);
    if (!matched.length) { freshBox.classList.remove('open'); return; }
    freshBox.innerHTML = matched.map(c =>
      `<div class="category-suggestion-item" data-value="${c.name}">${c.name}</div>`
    ).join('');
    freshBox.classList.add('open');
  }

  freshInput.addEventListener('focus', () => showSuggestions(freshInput.value));
  freshInput.addEventListener('input', () => showSuggestions(freshInput.value));
  freshInput.addEventListener('keydown', e => {
    const els    = freshBox.querySelectorAll('.category-suggestion-item');
    const active = freshBox.querySelector('.category-suggestion-item.active');
    let idx = [...els].indexOf(active);
    if (e.key === 'ArrowDown')                { e.preventDefault(); idx = Math.min(idx + 1, els.length - 1); }
    else if (e.key === 'ArrowUp')             { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    else if (e.key === 'Enter' && active)     { e.preventDefault(); freshInput.value = active.dataset.value; freshBox.classList.remove('open'); return; }
    else if (e.key === 'Escape')              { freshBox.classList.remove('open'); return; }
    else return;
    els.forEach(i => i.classList.remove('active'));
    if (els[idx]) els[idx].classList.add('active');
  });

  freshBox.addEventListener('mousedown', e => {
    const item = e.target.closest('.category-suggestion-item');
    if (!item) return;
    e.preventDefault();
    freshInput.value = item.dataset.value;
    freshBox.classList.remove('open');
  });

  document.addEventListener('click', e => {
    if (!freshInput.parentNode.contains(e.target)) freshBox.classList.remove('open');
  });
}

const TX_CATEGORY_OPTIONS = {
  expense: ['Online Shopping', 'Food & Drinks', 'Fixing Issue', 'Money Loan', 'Random'],
  income:  ['Salary', 'Freelance', 'Investment Return', 'Gift', 'Other Income'],
};

function populateTxCategoryDropdown(selected) {
  const typeEl = document.getElementById('tx-type');
  const type   = typeEl?.value || 'expense';
  const names  = TX_CATEGORY_OPTIONS[type] || TX_CATEGORY_OPTIONS.expense;
  const items  = names.map(n => ({ name: n }));
  initCategoryCombo('tx-category', 'tx-category-suggestions', items, selected);
}

async function saveTransaction() {
  const type        = document.getElementById('tx-type').value;
  const amount      = Fmt.get(document.getElementById('tx-amount').value);
  const category    = document.getElementById('tx-category').value;
  const description = document.getElementById('tx-description').value.trim();
  const date        = document.getElementById('tx-date').value;

  if (!type || !amount || !category || !date) { UI.toast('Please fill all required fields.', 'error'); return; }
  if (isNaN(amount) || amount <= 0)            { UI.toast('Amount must be a positive number.', 'error'); return; }

  const btn = document.getElementById('tx-save-btn');
  UI.setLoading(btn, true);

  const payload = { user_id: App.user.id, type, amount, category, description, date };
  let error;
  if (App.editing.transaction) {
    ({ error } = await db.from('transactions').update(payload).eq('id', App.editing.transaction.id).eq('user_id', App.user.id));
  } else {
    ({ error } = await db.from('transactions').insert([payload]));
  }

  UI.setLoading(btn, false);
  if (error) { UI.toast(error.message, 'error'); return; }

  UI.toast(App.editing.transaction ? 'Transaction updated!' : 'Transaction added!', 'success');
  UI.closeModal('transaction-modal');
  await loadTransactions();
  renderTransactionTable();
  if (App.activeSection === 'overview') renderOverview();
}

async function deleteTransaction(id) {
  if (!CurrencySettings.canEdit()) return;
  UI.confirm('Delete this transaction? This cannot be undone.', async () => {
    const { error } = await db.from('transactions').delete().eq('id', id).eq('user_id', App.user.id);
    if (error) { UI.toast(error.message, 'error'); return; }
    UI.toast('Transaction deleted.', 'success');
    await loadTransactions();
    renderTransactionTable();
    if (App.activeSection === 'overview') renderOverview();
  });
}

// ── GOALS ─────────────────────────────────────────────────────
function renderGoalsList() {
  const el = document.getElementById('goals-list');
  if (!el) return;
  if (!App.goals.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🎯</div><p>No savings goals yet.</p>
      <button class="btn btn-primary" onclick="openAddGoal()">+ Create Goal</button></div>`;
    return;
  }
  el.innerHTML = App.goals.map(g => {
    const pct = Math.min((+g.current_amount / +g.target_amount) * 100, 100).toFixed(1);
    return `<div class="goal-card">
      <div class="goal-card-header">
        <h4>${g.name}</h4>
        <div class="goal-card-actions">
          <button class="icon-btn edit-btn" onclick="openEditGoal('${g.id}')" title="Edit">✎</button>
          <button class="icon-btn del-btn"  onclick="deleteGoal('${g.id}')"   title="Delete">✕</button>
        </div>
      </div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;background:${g.color || '#BB885F'}"></div></div>
      <div class="goal-amounts">
        <span class="goal-current">${UI.currency(g.current_amount)}</span>
        <span class="goal-pct">${pct}%</span>
        <span class="goal-target">of ${UI.currency(g.target_amount)}</span>
      </div>
      ${g.deadline ? `<div class="goal-deadline">🗓 Target: ${UI.formatDate(g.deadline)}</div>` : ''}
      <button class="btn btn-sm btn-outline" style="margin-top:10px" onclick="openContributeGoal('${g.id}')">+ Add Contribution</button>
    </div>`;
  }).join('');
}

function openAddGoal() {
  App.editing.goal = null;
  document.getElementById('goal-modal-title').textContent = 'Create Savings Goal';
  ['goal-name','goal-target','goal-current','goal-deadline'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  document.getElementById('goal-color').value = '#BB885F';
  UI.openModal('goal-modal');
}

function openEditGoal(id) {
  const g = App.goals.find(g => g.id === id);
  if (!g) return;
  App.editing.goal = g;
  document.getElementById('goal-modal-title').textContent = 'Edit Goal';
  document.getElementById('goal-name').value    = g.name;
  document.getElementById('goal-target').value  = Fmt.set(g.target_amount);
  document.getElementById('goal-current').value = Fmt.set(g.current_amount);
  document.getElementById('goal-deadline').value = g.deadline || '';
  document.getElementById('goal-color').value   = g.color || '#BB885F';
  UI.openModal('goal-modal');
}

function openContributeGoal(id) {
  App.editing.goal = App.goals.find(g => g.id === id);
  if (!App.editing.goal) return;
  document.getElementById('contribute-goal-name').textContent = App.editing.goal.name;
  document.getElementById('contribute-amount').value = '';
  UI.openModal('contribute-modal');
}

async function contributeToGoal() {
  const amount = Fmt.get(document.getElementById('contribute-amount').value);
  if (!amount || amount <= 0) { UI.toast('Enter a valid amount.', 'error'); return; }
  const g = App.editing.goal;
  const newAmount = Math.min(+g.current_amount + amount, +g.target_amount);
  const { error } = await db.from('savings_goals').update({ current_amount: newAmount, updated_at: new Date().toISOString() }).eq('id', g.id).eq('user_id', App.user.id);
  if (error) { UI.toast(error.message, 'error'); return; }
  if (newAmount >= +g.target_amount) UI.toast(`🎉 Goal "${g.name}" reached!`, 'success');
  else UI.toast(`Added ${UI.currency(amount)} to "${g.name}"!`, 'success');
  UI.closeModal('contribute-modal');
  await loadGoals();
  renderGoalsList();
  renderGoalsOverview();
}

async function saveGoal() {
  const name         = document.getElementById('goal-name').value.trim();
  const target       = Fmt.get(document.getElementById('goal-target').value);
  const current      = Fmt.get(document.getElementById('goal-current').value);
  const deadline     = document.getElementById('goal-deadline').value || null;
  const color        = document.getElementById('goal-color').value || '#BB885F';
  if (!name || !target) { UI.toast('Goal name and target amount are required.', 'error'); return; }

  const payload = { user_id: App.user.id, name, target_amount: target, current_amount: current, deadline, color, updated_at: new Date().toISOString() };
  let error;
  if (App.editing.goal) {
    ({ error } = await db.from('savings_goals').update(payload).eq('id', App.editing.goal.id).eq('user_id', App.user.id));
  } else {
    ({ error } = await db.from('savings_goals').insert([payload]));
  }
  if (error) { UI.toast(error.message, 'error'); return; }
  UI.toast(App.editing.goal ? 'Goal updated!' : 'Goal created!', 'success');
  UI.closeModal('goal-modal');
  await loadGoals();
  renderGoalsList();
  renderGoalsOverview();
}

async function deleteGoal(id) {
  if (!CurrencySettings.canEdit()) return;
  UI.confirm('Delete this savings goal?', async () => {
    const { error } = await db.from('savings_goals').delete().eq('id', id).eq('user_id', App.user.id);
    if (error) { UI.toast(error.message, 'error'); return; }
    UI.toast('Goal deleted.', 'success');
    await loadGoals();
    renderGoalsList();
  });
}

// ── BUDGET PLANS ─────────────────────────────────────────────
async function renderPlans() {
  const el = document.getElementById('plans-grid');
  if (!el) return;
  const active   = App.plans.filter(p => p.status !== 'archived');
  const archived = App.plans.filter(p => p.status === 'archived');

  if (!active.length && !archived.length) {
    el.innerHTML = `<div class="empty-state full"><div class="empty-icon">📋</div><p>No budget plans yet. Create your first plan or import a ready-made template below!</p>
      <button class="btn btn-primary" onclick="openAddPlan()">+ Create Plan</button></div>`;
  } else {
    el.innerHTML = active.map(p => planCard(p)).join('') +
      (archived.length ? `<div class="archive-divider"><span>Archived (${archived.length})</span></div>` + archived.map(p => planCard(p, true)).join('') : '');
  }

  // Render community templates below user plans
  if (!App.communityTemplates.length) await loadCommunityTemplates();
  renderTemplateSection();
}

function renderTemplateSection() {
  const el = document.getElementById('community-templates-section');
  if (!el || !App.communityTemplates.length) return;

  const featured  = App.communityTemplates.filter(t => t.is_featured);
  const rest      = App.communityTemplates.filter(t => !t.is_featured);
  const diffColor = { Beginner: '#4CAF50', Intermediate: '#FF9800', Advanced: '#F44336' };

  const tmplCard = (t) => `
    <div class="template-card">
      <div class="template-card-header">
        <span class="template-difficulty" style="color:${diffColor[t.difficulty] || '#BB885F'}">${t.difficulty}</span>
        ${t.is_featured ? '<span class="template-featured-badge">★ Featured</span>' : ''}
      </div>
      <h4 class="template-title">${t.title}</h4>
      <p class="template-desc">${t.description || ''}</p>
      <div class="template-ratios">
        ${Object.entries(t.ratios || {}).slice(0, 4).map(([k, v]) => `
          <div class="tmpl-ratio-row">
            <span class="tmpl-ratio-name">${k}</span>
            <span class="tmpl-ratio-pct">${v}%</span>
          </div>`).join('')}
        ${Object.keys(t.ratios || {}).length > 4 ? `<div class="tmpl-more">+${Object.keys(t.ratios).length - 4} more categories</div>` : ''}
      </div>
      ${t.tags?.length ? `<div class="template-tags">${t.tags.slice(0, 4).map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
      <button class="btn btn-sm btn-outline" style="margin-top:12px;width:100%" onclick="importTemplate('${t.id}')">
        Import as My Plan
      </button>
    </div>`;

  el.innerHTML = `
    <div class="templates-section-header">
      <h3>Quick Start Templates</h3>
      <p>Click "Import as My Plan" to instantly create a budget plan from any template below.</p>
    </div>
    ${featured.length ? `<div class="templates-label">⭐ Featured</div><div class="templates-grid">${featured.map(tmplCard).join('')}</div>` : ''}
    ${rest.length ? `<div class="templates-label" style="margin-top:20px">All Templates</div><div class="templates-grid">${rest.map(tmplCard).join('')}</div>` : ''}`;
}

async function importTemplate(templateId) {
  const t = App.communityTemplates.find(t => t.id === templateId);
  if (!t) return;

  // Convert community_templates ratios (flat {name: pct}) to budget_plans allocations format
  const allocations = {};
  const COLORS = ['#BB885F','#4CAF50','#2196F3','#F44336','#FF9800','#9C27B0','#00BCD4','#E91E63','#8BC34A','#FF5722','#607D8B','#FFC107'];
  Object.entries(t.ratios || {}).forEach(([name, pct], i) => {
    allocations[name] = { percentage: pct, color: COLORS[i % COLORS.length] };
  });

  const { error } = await db.from('budget_plans').insert([{
    user_id:    App.user.id,
    name:       t.title,
    description: t.description,
    allocations,
    monthly_income: 0,
    status: 'active',
  }]);

  if (error) { UI.toast(error.message, 'error'); return; }
  UI.toast(`"${t.title}" imported as a plan!`, 'success');
  await loadPlans();
  const el = document.getElementById('plans-grid');
  if (el) {
    const active = App.plans.filter(p => p.status !== 'archived');
    el.innerHTML = active.map(p => planCard(p)).join('');
  }
}

function planCard(p, archived = false) {
  const allocs = Object.entries(p.allocations || {});
  const total  = allocs.reduce((s, [, v]) => s + (+v.percentage || 0), 0);
  return `<div class="plan-card ${archived ? 'archived' : ''}">
    <div class="plan-card-header">
      <div>
        <h3>${p.name}</h3>
        ${p.description ? `<p class="plan-desc">${p.description}</p>` : ''}
      </div>
      <span class="plan-status status-${p.status}">${p.status}</span>
    </div>
    ${p.monthly_income > 0 ? `<div class="plan-income">Monthly Income: <strong>${UI.currency(p.monthly_income)}</strong></div>` : ''}
    <div class="plan-allocations">
      ${allocs.slice(0, 6).map(([name, v]) => `
        <div class="alloc-item">
          <div class="alloc-bar-track"><div class="alloc-bar-fill" style="width:${v.percentage}%;background:${v.color || '#BB885F'}"></div></div>
          <span class="alloc-name">${name}</span>
          <span class="alloc-pct">${v.percentage}%</span>
        </div>`).join('')}
      ${total ? `<div class="alloc-total">Allocated: ${total}%</div>` : ''}
    </div>
    <div class="plan-actions">
      <button class="btn btn-sm btn-outline" onclick="openEditPlan('${p.id}')">Edit</button>
      <button class="btn btn-sm btn-outline" onclick="duplicatePlan('${p.id}')">Duplicate</button>
      ${!archived
        ? `<button class="btn btn-sm btn-ghost" onclick="archivePlan('${p.id}')">Archive</button>`
        : `<button class="btn btn-sm btn-ghost" onclick="unarchivePlan('${p.id}')">Restore</button>`}
      <button class="btn btn-sm btn-danger" onclick="deletePlan('${p.id}')">Delete</button>
    </div>
  </div>`;
}

function openAddPlan() {
  App.editing.plan = null;
  document.getElementById('plan-modal-title').textContent = 'Create Budget Plan';
  document.getElementById('plan-name').value = '';
  document.getElementById('plan-description').value = '';
  document.getElementById('plan-income').value = '';
  renderAllocRows([]);
  UI.openModal('plan-modal');
}

function openEditPlan(id) {
  const p = App.plans.find(p => p.id === id);
  if (!p) return;
  App.editing.plan = p;
  document.getElementById('plan-modal-title').textContent = 'Edit Plan';
  document.getElementById('plan-name').value        = p.name;
  document.getElementById('plan-description').value = p.description || '';
  document.getElementById('plan-income').value      = Fmt.set(p.monthly_income);
  renderAllocRows(Object.entries(p.allocations || {}).map(([name, v]) => ({ name, percentage: v.percentage, color: v.color })));
  UI.openModal('plan-modal');
}

function renderAllocRows(rows) {
  const c = document.getElementById('allocation-rows');
  if (!c) return;
  c.innerHTML = '';
  (rows.length ? rows : [{ name: '', percentage: '', color: '#BB885F' }]).forEach(r => addAllocRow(r));
}

function addAllocRow(data = {}) {
  const c = document.getElementById('allocation-rows');
  if (!c) return;
  const row = document.createElement('div');
  row.className = 'alloc-row';
  row.innerHTML = `
    <input type="text"   class="input alloc-name-input" placeholder="Category" value="${data.name || ''}">
    <input type="number" class="input alloc-pct-input"  placeholder="%" min="0" max="100" value="${data.percentage || ''}">
    <input type="color"  class="color-input alloc-color-input" value="${data.color || '#BB885F'}">
    <button type="button" class="icon-btn del-btn" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(row);
}

function getAllocationsFromForm() {
  const rows = document.querySelectorAll('#allocation-rows .alloc-row');
  const allocs = {};
  rows.forEach(row => {
    const name = row.querySelector('.alloc-name-input').value.trim();
    const pct  = parseFloat(row.querySelector('.alloc-pct-input').value);
    const color = row.querySelector('.alloc-color-input').value;
    if (name && !isNaN(pct) && pct > 0) allocs[name] = { percentage: pct, color };
  });
  return allocs;
}

async function savePlan() {
  const name           = document.getElementById('plan-name').value.trim();
  const description    = document.getElementById('plan-description').value.trim();
  const monthly_income = Fmt.get(document.getElementById('plan-income').value);
  const allocations    = getAllocationsFromForm();

  if (!name) { UI.toast('Plan name is required.', 'error'); return; }

  const payload = { user_id: App.user.id, name, description, allocations, monthly_income, updated_at: new Date().toISOString() };
  let error;
  if (App.editing.plan) {
    ({ error } = await db.from('budget_plans').update(payload).eq('id', App.editing.plan.id).eq('user_id', App.user.id));
  } else {
    ({ error } = await db.from('budget_plans').insert([payload]));
  }
  if (error) { UI.toast(error.message, 'error'); return; }
  UI.toast(App.editing.plan ? 'Plan updated!' : 'Plan created!', 'success');
  UI.closeModal('plan-modal');
  await loadPlans();
  renderPlans();
}

async function duplicatePlan(id) {
  if (!CurrencySettings.canEdit()) return;
  const p = App.plans.find(p => p.id === id);
  if (!p) return;
  const { error } = await db.from('budget_plans').insert([{
    user_id: App.user.id, name: p.name + ' (copy)',
    description: p.description, allocations: p.allocations,
    monthly_income: p.monthly_income, status: 'draft'
  }]);
  if (error) { UI.toast(error.message, 'error'); return; }
  UI.toast('Plan duplicated!', 'success');
  await loadPlans(); renderPlans();
}
async function archivePlan(id) {
  if (!CurrencySettings.canEdit()) return;
  await db.from('budget_plans').update({ status: 'archived' }).eq('id', id).eq('user_id', App.user.id);
  await loadPlans(); renderPlans(); UI.toast('Plan archived.', 'info');
}
async function unarchivePlan(id) {
  if (!CurrencySettings.canEdit()) return;
  await db.from('budget_plans').update({ status: 'active' }).eq('id', id).eq('user_id', App.user.id);
  await loadPlans(); renderPlans(); UI.toast('Plan restored.', 'success');
}
async function deletePlan(id) {
  if (!CurrencySettings.canEdit()) return;
  UI.confirm('Delete this budget plan?', async () => {
    await db.from('budget_plans').delete().eq('id', id).eq('user_id', App.user.id);
    UI.toast('Plan deleted.', 'success');
    await loadPlans(); renderPlans();
  });
}

// ── SIMULATION ENGINE ─────────────────────────────────────────
function renderSimulate() {
  document.getElementById('sim-results')?.classList.add('hidden');
}

function runSimulation() {
  const income       = Fmt.get(document.getElementById('sim-income').value);
  const expenses     = Fmt.get(document.getElementById('sim-expenses').value);
  const savingsPct   = parseFloat(document.getElementById('sim-savings-pct').value) || 0;
  const investPct    = parseFloat(document.getElementById('sim-invest-pct').value)  || 0;
  const annualReturn = parseFloat(document.getElementById('sim-return').value)      || 7;
  const debtPayment  = Fmt.get(document.getElementById('sim-debt').value);
  const totalDebt    = Fmt.get(document.getElementById('sim-total-debt').value);
  const years        = parseInt(document.getElementById('sim-years').value)         || 5;

  if (!income) { UI.toast('Enter your monthly income to run a simulation.', 'error'); return; }

  const monthlySavings = income * (savingsPct / 100);
  const monthlyInvest  = income * (investPct / 100);
  const monthlyReturn  = annualReturn / 100 / 12;

  let savings = 0, invest = 0, debt = totalDebt;
  const data = [];

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      savings += monthlySavings;
      invest   = (invest + monthlyInvest) * (1 + monthlyReturn);
      debt     = Math.max(debt - debtPayment, 0);
    }
    data.push({ year: y, savings, investment: invest, total: savings + invest, debt });
  }

  const last = data[data.length - 1];
  const riskScore = Math.round(Math.min(100, Math.max(0, savingsPct * 1.2 + (investPct > 15 ? 15 : investPct) - (expenses / income) * 25 + 40)));

  setText('sim-total-savings', UI.currency(last.savings));
  setText('sim-total-invest',  UI.currency(last.investment));
  setText('sim-net-worth',     UI.currency(last.total));
  setText('sim-final-debt',    UI.currency(last.debt));
  setText('sim-risk-score',    riskScore + '/100');
  setText('sim-risk-label',    riskScore >= 70 ? '🟢 Low Risk' : riskScore >= 40 ? '🟡 Moderate Risk' : '🔴 High Risk');

  const canvas = document.getElementById('sim-chart');
  if (!canvas) { document.getElementById('sim-results').classList.remove('hidden'); return; }
  if (App.charts.sim) { App.charts.sim.destroy(); App.charts.sim = null; }

  App.charts.sim = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map(d => `Year ${d.year}`),
      datasets: [
        { label: 'Total Wealth',  data: data.map(d => d.total),      borderColor: '#BB885F', backgroundColor: 'rgba(187,136,95,0.12)', tension: 0.4, fill: true },
        { label: 'Savings',       data: data.map(d => d.savings),    borderColor: '#4CAF50', tension: 0.4 },
        { label: 'Investments',   data: data.map(d => d.investment), borderColor: '#2196F3', tension: 0.4 },
        { label: 'Remaining Debt',data: data.map(d => d.debt),       borderColor: '#F44336', tension: 0.4, borderDash: [6, 3] },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#ccc', font: { size: 12 } } } },
      scales: {
        x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#888', callback: v => '$' + v.toLocaleString() }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
  document.getElementById('sim-results').classList.remove('hidden');
}

// ── PLAN COMPARISON ───────────────────────────────────────────
function renderCompare() {
  const makeOptions = () => App.plans.filter(p => p.status !== 'archived')
    .map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const s1 = document.getElementById('compare-plan-1');
  const s2 = document.getElementById('compare-plan-2');
  if (s1) s1.innerHTML = '<option value="">Select plan 1…</option>' + makeOptions();
  if (s2) s2.innerHTML = '<option value="">Select plan 2…</option>' + makeOptions();
  document.getElementById('compare-results')?.classList.add('hidden');
}

function comparePlans() {
  const id1 = document.getElementById('compare-plan-1')?.value;
  const id2 = document.getElementById('compare-plan-2')?.value;
  if (!id1 || !id2 || id1 === id2) { UI.toast('Select two different plans to compare.', 'error'); return; }

  const p1 = App.plans.find(p => p.id === id1);
  const p2 = App.plans.find(p => p.id === id2);
  if (!p1 || !p2) return;

  const income = Fmt.get(document.getElementById('compare-income')?.value) || p1.monthly_income || p2.monthly_income || 3000;
  const years  = parseInt(document.getElementById('compare-years')?.value) || 5;

  const proj1 = projectPlanWealth(p1.allocations, income, years);
  const proj2 = projectPlanWealth(p2.allocations, income, years);
  const m1 = getPlanMetrics(p1, income);
  const m2 = getPlanMetrics(p2, income);

  // Highlight the winning cell green; lower = better when isLow is true
  const row = (label, v1, v2, f1, f2, isLow = false) => {
    const win1 = isLow ? v1 < v2 : v1 > v2;
    const win2 = isLow ? v2 < v1 : v2 > v1;
    return `<tr>
      <td class="compare-label">${label}</td>
      <td${win1 ? ' class="compare-win"' : ''}>${f1}</td>
      <td${win2 ? ' class="compare-win"' : ''}>${f2}</td>
    </tr>`;
  };

  const s1 = proj1[years - 1], s2 = proj2[years - 1];

  const tableEl = document.getElementById('compare-table');
  if (tableEl) tableEl.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th></th>
          <th title="${p1.name}">${p1.name}</th>
          <th title="${p2.name}">${p2.name}</th>
        </tr>
      </thead>
      <tbody>
        ${row('Monthly Savings',           m1.savings,         m2.savings,         UI.currency(m1.savings),          UI.currency(m2.savings))}
        ${row('Monthly Investment',        m1.invest,          m2.invest,          UI.currency(m1.invest),           UI.currency(m2.invest))}
        ${row('Monthly Expenses',          m1.expenses,        m2.expenses,        UI.currency(m1.expenses),         UI.currency(m2.expenses),         true)}
        ${row('Savings Rate',              m1.savPct,          m2.savPct,          m1.savPct.toFixed(1) + '%',       m2.savPct.toFixed(1) + '%')}
        ${row('Investment Rate',           m1.invPct,          m2.invPct,          m1.invPct.toFixed(1) + '%',       m2.invPct.toFixed(1) + '%')}
        ${row('Expense Rate',              m1.expPct,          m2.expPct,          m1.expPct.toFixed(1) + '%',       m2.expPct.toFixed(1) + '%',       true)}
        ${row(`Savings in ${years}yr`,     s1?.savings || 0,   s2?.savings || 0,   UI.currency(s1?.savings),         UI.currency(s2?.savings))}
        ${row(`Wealth in ${years}yr`,      s1?.total   || 0,   s2?.total   || 0,   UI.currency(s1?.total),           UI.currency(s2?.total))}
      </tbody>
    </table>`;

  const canvas = document.getElementById('compare-chart');
  if (canvas) {
    if (App.charts.compare) { App.charts.compare.destroy(); App.charts.compare = null; }
    App.charts.compare = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: proj1.map((_, i) => `Year ${i + 1}`),
        datasets: [
          { label: p1.name, data: proj1.map(d => d.total), backgroundColor: 'rgba(187,136,95,0.75)', borderRadius: 4 },
          { label: p2.name, data: proj2.map(d => d.total), backgroundColor: 'rgba(76,175,80,0.75)',  borderRadius: 4 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#ccc' } } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#888', callback: v => '$' + v.toLocaleString() }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }
  document.getElementById('compare-results')?.classList.remove('hidden');
}

function getPlanMetrics(plan, income) {
  const allocs  = plan.allocations || {};
  const entries = Object.entries(allocs);
  const savPct  = entries.filter(([k]) => /saving/i.test(k)).reduce((s, [, v]) => s + +v.percentage, 0);
  const invPct  = entries.filter(([k]) => /invest/i.test(k)).reduce((s, [, v]) => s + +v.percentage, 0);
  const totalAllocPct = entries.reduce((s, [, v]) => s + +v.percentage, 0);
  const wealthPct     = savPct + invPct;
  const expPct        = Math.max(0, totalAllocPct - wealthPct);
  const unallocPct    = Math.max(0, 100 - totalAllocPct);
  return {
    savings:        income * savPct     / 100,
    invest:         income * invPct     / 100,
    wealth:         income * wealthPct  / 100,
    expenses:       income * expPct     / 100,
    unalloc:        income * unallocPct / 100,
    rate:           wealthPct,          // kept for any legacy references
    savPct, invPct, wealthPct, expPct, unallocPct, totalAllocPct,
    numCategories:  entries.length,
  };
}

function projectPlanWealth(allocations, income, years) {
  const allocs = allocations || {};
  const savPct = Object.entries(allocs).filter(([k]) => k.toLowerCase().includes('saving')).reduce((s, [, v]) => s + +v.percentage, 0);
  const invPct = Object.entries(allocs).filter(([k]) => k.toLowerCase().includes('invest')).reduce((s, [, v]) => s + +v.percentage, 0);
  const mSav = income * savPct / 100, mInv = income * invPct / 100, mRet = 0.07 / 12;
  let sav = 0, inv = 0;
  const data = [];
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) { sav += mSav; inv = (inv + mInv) * (1 + mRet); }
    data.push({ year: y, savings: sav, invest: inv, total: sav + inv });
  }
  return data;
}

// ── COMMUNITY ─────────────────────────────────────────────────
async function loadAndRenderCommunity() {
  const feed = document.getElementById('blueprint-feed');
  if (!feed) return;
  feed.innerHTML = '<div class="loading-state">Loading community blueprints…</div>';

  // Use two separate queries to avoid PostgREST join issues with auth.users FK
  const [bpRes] = await Promise.all([
    db.from('blueprints').select('*').eq('is_public', true)
      .order('likes_count', { ascending: false }).limit(50),
    loadUserInteractions(),
  ]);

  if (bpRes.error) { feed.innerHTML = `<div class="error-state">Could not load blueprints. (${bpRes.error.message})</div>`; return; }
  const bps = bpRes.data || [];

  // Fetch profiles for all blueprint authors in one query
  const userIds = [...new Set(bps.map(b => b.user_id).filter(Boolean))];
  if (userIds.length) {
    const { data: profiles } = await db.from('profiles')
      .select('id, username, nickname, avatar_url, avatar_url_storage').in('id', userIds);
    const pMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    bps.forEach(b => { b.profiles = pMap[b.user_id] || null; });
  }

  App.blueprints = bps;
  setupCommunitySearch();
  renderCommunityFeed();
}

function renderCommunityFeed() {
  const feed = document.getElementById('blueprint-feed');
  if (!feed) return;

  const query = App.communitySearch.trim().toLowerCase();
  let bps = App.blueprints;
  if (query) {
    bps = bps.filter(b =>
      b.title?.toLowerCase().includes(query) ||
      b.description?.toLowerCase().includes(query) ||
      b.strategy_type?.toLowerCase().includes(query) ||
      b.tags?.some(t => t.toLowerCase().includes(query)) ||
      b.profiles?.username?.toLowerCase().includes(query)
    );
  }

  if (!bps.length) {
    feed.innerHTML = `<div class="empty-state full"><div class="empty-icon">🌐</div>
      <p>${query ? `No blueprints match "${query}".` : 'No blueprints yet — be the first to share!'}</p>
      ${!query ? `<button class="btn btn-primary" onclick="openShareBlueprint()">Share Blueprint</button>` : ''}
    </div>`;
    return;
  }
  feed.innerHTML = bps.map(b => blueprintCard(b)).join('');
}

function blueprintCard(b) {
  const liked = App.likedBlueprintIds.has(b.id);
  const saved = App.savedBlueprintIds.has(b.id);
  const user  = b.profiles?.username || 'Anonymous';
  return `<div class="blueprint-card" data-id="${b.id}">
    <div class="bp-card-header">
      <div class="bp-author">
        <div class="bp-avatar">${UI.avatarInitials(user)}</div>
        <div><span class="bp-username">${user}</span><span class="bp-time">${UI.timeAgo(b.created_at)}</span></div>
      </div>
      ${b.strategy_type ? `<span class="bp-tag">${b.strategy_type}</span>` : ''}
    </div>
    <h3 class="bp-title">${b.title}</h3>
    ${b.description ? `<p class="bp-desc">${b.description}</p>` : ''}
    <div class="bp-ratios">
      ${Object.entries(b.ratios || {}).slice(0, 6).map(([k, v]) => `
        <div class="bp-ratio-item">
          <span class="bp-ratio-name">${k}</span>
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${v}%;background:${bpColor(k)}"></div></div>
          <span class="bp-ratio-pct">${v}%</span>
        </div>`).join('')}
    </div>
    ${b.tags?.length ? `<div class="bp-tags">${b.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
    <div class="bp-card-footer">
      <button class="bp-action-btn ${liked ? 'liked' : ''}" onclick="toggleLike('${b.id}')">♥ <span id="lc-${b.id}">${b.likes_count || 0}</span></button>
      <button class="bp-action-btn" onclick="openBlueprintDetail('${b.id}')">💬 ${b.comments_count || 0}</button>
      <button class="bp-action-btn ${saved ? 'saved' : ''}" onclick="toggleSave('${b.id}')">${saved ? '🔖 Saved' : '+ Save'}</button>
    </div>
  </div>`;
}

function bpColor(key) {
  const m = { saving: '#4CAF50', invest: '#2196F3', housing: '#F44336', food: '#FF9800',
    debt: '#FF5252', needs: '#9C27B0', wants: '#E91E63', fun: '#00BCD4', transport: '#FF9800' };
  const k = key.toLowerCase();
  for (const [kw, v] of Object.entries(m)) if (k.includes(kw)) return v;
  return '#BB885F';
}

async function toggleLike(id) {
  const liked = App.likedBlueprintIds.has(id);
  if (liked) {
    await db.from('blueprint_likes').delete().eq('blueprint_id', id).eq('user_id', App.user.id);
    App.likedBlueprintIds.delete(id);
  } else {
    await db.from('blueprint_likes').insert([{ blueprint_id: id, user_id: App.user.id }]);
    App.likedBlueprintIds.add(id);
  }
  const bp = App.blueprints.find(b => b.id === id);
  if (bp) { bp.likes_count = Math.max(0, (bp.likes_count || 0) + (liked ? -1 : 1)); }
  const cnt = document.getElementById(`lc-${id}`);
  if (cnt) cnt.textContent = bp?.likes_count || 0;
  const card = document.querySelector(`.blueprint-card[data-id="${id}"] .bp-action-btn`);
  if (card) card.classList.toggle('liked', !liked);
}

async function toggleSave(id) {
  const saved = App.savedBlueprintIds.has(id);
  if (saved) {
    await db.from('saved_blueprints').delete().eq('blueprint_id', id).eq('user_id', App.user.id);
    App.savedBlueprintIds.delete(id);
    UI.toast('Removed from saved.', 'info');
  } else {
    await db.from('saved_blueprints').insert([{ blueprint_id: id, user_id: App.user.id }]);
    App.savedBlueprintIds.add(id);
    UI.toast('Blueprint saved!', 'success');
  }
}

async function openBlueprintDetail(id) {
  const bp = App.blueprints.find(b => b.id === id);
  if (!bp) return;

  const { data: comments } = await db.from('blueprint_comments')
    .select('*, profiles(username)').eq('blueprint_id', id).is('parent_id', null).order('created_at');

  setText('detail-title', bp.title);
  setText('detail-description', bp.description || '');
  document.getElementById('detail-blueprint-id').value = id;

  const ratiosEl = document.getElementById('detail-ratios');
  if (ratiosEl) ratiosEl.innerHTML = Object.entries(bp.ratios || {}).map(([k, v]) => `
    <div class="bp-ratio-item">
      <span class="bp-ratio-name">${k}</span>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${v}%;background:${bpColor(k)}"></div></div>
      <span class="bp-ratio-pct">${v}%</span>
    </div>`).join('');

  const commentsEl = document.getElementById('detail-comments');
  if (commentsEl) commentsEl.innerHTML = (comments || []).length
    ? (comments || []).map(c => `
        <div class="comment">
          <div class="comment-header">
            <span class="comment-author">${c.profiles?.username || 'User'}</span>
            <span class="comment-time">${UI.timeAgo(c.created_at)}</span>
          </div>
          <p class="comment-text">${c.content}</p>
        </div>`).join('')
    : '<p class="no-comments">No comments yet. Start the discussion!</p>';

  UI.openModal('blueprint-detail-modal');
}

async function submitComment() {
  const content = document.getElementById('comment-input')?.value.trim();
  const bpId    = document.getElementById('detail-blueprint-id')?.value;
  if (!content) return;

  const { error } = await db.from('blueprint_comments').insert([{ blueprint_id: bpId, user_id: App.user.id, content }]);
  if (error) { UI.toast(error.message, 'error'); return; }
  document.getElementById('comment-input').value = '';
  UI.toast('Comment posted!', 'success');
  await openBlueprintDetail(bpId);
}

// Share Blueprint
function openShareBlueprint() {
  const form = document.getElementById('share-blueprint-form');
  if (form) form.reset();
  const rows = document.getElementById('share-allocation-rows');
  if (rows) { rows.innerHTML = ''; addShareRow(); }
  UI.openModal('share-blueprint-modal');
}

function addShareRow() {
  const c = document.getElementById('share-allocation-rows');
  if (!c) return;
  const row = document.createElement('div');
  row.className = 'alloc-row';
  row.innerHTML = `
    <input type="text"   class="input share-cat-name" placeholder="e.g. Housing">
    <input type="number" class="input share-cat-pct"  placeholder="%" min="0" max="100">
    <button type="button" class="icon-btn del-btn" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(row);
}

async function shareBlueprint() {
  const title    = document.getElementById('share-title')?.value.trim();
  const desc     = document.getElementById('share-desc')?.value.trim();
  const strategy = document.getElementById('share-strategy')?.value.trim();
  const tagsRaw  = document.getElementById('share-tags')?.value.trim();

  if (!title) { UI.toast('Title is required.', 'error'); return; }

  const rows   = document.querySelectorAll('#share-allocation-rows .alloc-row');
  const ratios = {};
  rows.forEach(r => {
    const name = r.querySelector('.share-cat-name').value.trim();
    const pct  = parseFloat(r.querySelector('.share-cat-pct').value);
    if (name && !isNaN(pct) && pct > 0) ratios[name] = pct;
  });
  if (!Object.keys(ratios).length) { UI.toast('Add at least one allocation ratio.', 'error'); return; }

  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const { error } = await db.from('blueprints').insert([{
    user_id: App.user.id, title, description: desc, ratios, strategy_type: strategy, tags, is_public: true
  }]);
  if (error) { UI.toast(error.message, 'error'); return; }
  UI.toast('Blueprint shared with the community!', 'success');
  UI.closeModal('share-blueprint-modal');
  await loadAndRenderCommunity();
}

// ── SAVED BLUEPRINTS ──────────────────────────────────────────
async function loadAndRenderSaved(gridId = 'saved-blueprints-grid') {
  const el = document.getElementById(gridId);
  if (!el) return;
  el.innerHTML = '<div class="loading-state">Loading saved blueprints…</div>';

  const { data, error } = await db.from('saved_blueprints')
    .select('*, blueprints(*, profiles(username))').eq('user_id', App.user.id).order('created_at', { ascending: false });

  await loadUserInteractions();

  if (error || !data?.length) {
    el.innerHTML = `<div class="empty-state full"><div class="empty-icon">🔖</div><p>You haven't saved any blueprints yet.</p>
      <button class="btn btn-primary" onclick="navigateTo('community')">Browse Community</button></div>`;
    return;
  }
  const blueprints = data.map(d => d.blueprints).filter(Boolean);
  blueprints.forEach(b => { if (!App.blueprints.find(x => x.id === b.id)) App.blueprints.push(b); });
  el.innerHTML = blueprints.map(b => blueprintCard(b)).join('');
}

// ── EDUCATION ─────────────────────────────────────────────────
function renderEducation() {} // Static content in HTML

// ── PROFILE ───────────────────────────────────────────────────
function renderProfile() {
  const name   = App.profile?.nickname || App.profile?.full_name || App.user.user_metadata?.full_name || '';
  const avatar = App.profile?.avatar_url_storage || App.user.user_metadata?.avatar_url || App.profile?.avatar_url || '';

  setText('profile-email', App.user.email || '');
  const uEl = document.getElementById('profile-username-input'); if (uEl) uEl.value = App.profile?.username || '';
  const nEl = document.getElementById('profile-nickname-input'); if (nEl) nEl.value = App.profile?.nickname || '';
  const bEl = document.getElementById('profile-bio-input');      if (bEl) bEl.value = App.profile?.bio || '';

  const avEl = document.getElementById('profile-avatar-display');
  if (avEl) {
    avEl.innerHTML = avatar
      ? `<img src="${avatar}" alt="${name}" onerror="this.style.display='none'">`
      : `<span>${UI.avatarInitials(name || App.profile?.username || 'U')}</span>`;
  }

  // Wire up avatar upload → crop flow
  const fileInput = document.getElementById('profile-avatar-file');
  const uploadBtn = document.getElementById('profile-avatar-upload-btn');
  if (uploadBtn && fileInput && !uploadBtn.dataset.wired) {
    uploadBtn.dataset.wired = '1';
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { UI.toast('Image must be under 10 MB.', 'error'); return; }
      openCropModal(file);
    });
  }

  setText('profile-stat-transactions', App.transactions.length);
  setText('profile-stat-plans',        App.plans.length);
  setText('profile-stat-goals',        App.goals.length);

  loadAndRenderSaved('profile-saved-blueprints-grid');
}

async function uploadAvatar(file) {
  const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
  const path = `${App.user.id}/avatar.${ext}`;
  const { error } = await db.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (error) { UI.toast('Upload failed: ' + error.message, 'error'); return null; }
  const { data } = db.storage.from('avatars').getPublicUrl(path);
  // Persist to profile
  await db.from('profiles').update({ avatar_url_storage: data.publicUrl, updated_at: new Date().toISOString() }).eq('id', App.user.id);
  return data.publicUrl;
}

async function saveProfile() {
  const username = document.getElementById('profile-username-input')?.value.trim().toLowerCase();
  const nickname = document.getElementById('profile-nickname-input')?.value.trim();
  const bio      = document.getElementById('profile-bio-input')?.value.trim();
  if (!username) { UI.toast('Username cannot be empty.', 'error'); return; }

  // Validate username format
  const usernameOk = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(username) && username.length >= 3 && !username.includes('--');
  if (!usernameOk) { UI.toast('Invalid username format. Use 3–30 lowercase letters, numbers, or hyphens.', 'error'); return; }

  // Check availability + 14-day change limit (skip both if username unchanged)
  if (username !== App.profile?.username) {
    // 14-day cooldown
    const lastChanged = App.profile?.username_changed_at;
    if (lastChanged) {
      const daysSince = (Date.now() - new Date(lastChanged).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 14) {
        const daysLeft = Math.ceil(14 - daysSince);
        UI.toast(`Username can only be changed once every 14 days. Try again in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`, 'error');
        return;
      }
    }
    const { data: available } = await db.rpc('is_username_available', { requested_username: username, requesting_user_id: App.user.id });
    if (!available) { UI.toast('That username is already taken.', 'error'); return; }
  }

  const updates = { username, bio, updated_at: new Date().toISOString() };
  if (username !== App.profile?.username) updates.username_changed_at = new Date().toISOString();
  if (nickname !== undefined) updates.nickname = nickname || null;

  const { error } = await db.from('profiles').update(updates).eq('id', App.user.id);
  if (error) { UI.toast(error.message, 'error'); return; }
  UI.toast('Profile updated!', 'success');
  await loadProfile();
  renderUserInfo();
}

// ── RECURRING TRANSACTIONS ───────────────────────────────────

async function processRecurringTransactions() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const today = now.getDate();

  const pending = App.recurring.filter(r =>
    r.is_active &&
    (r.last_posted_year === null || r.last_posted_year === undefined ||
     r.last_posted_year < year ||
     (r.last_posted_year === year && r.last_posted_month < month)) &&
    today >= r.day_of_month
  );

  if (!pending.length) return;

  for (const r of pending) {
    const postDate = new Date(year, month - 1, r.day_of_month);
    const dateStr  = postDate.toISOString().split('T')[0];

    const { error } = await db.from('transactions').insert([{
      user_id:     App.user.id,
      type:        r.type,
      category:    r.category,
      description: r.description || r.category,
      amount:      r.amount,
      date:        dateStr,
    }]);

    if (!error) {
      await db.from('recurring_transactions')
        .update({ last_posted_month: month, last_posted_year: year })
        .eq('id', r.id);
    }
  }

  if (pending.length) {
    await loadTransactions();
    UI.toast(`${pending.length} recurring transaction${pending.length > 1 ? 's' : ''} posted for this month.`, 'info');
  }
}

function renderRecurringList() {
  const el = document.getElementById('recurring-list');
  if (!el) return;
  if (!App.recurring.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔄</div>
      <p>No recurring entries yet. Add a monthly salary, rent, subscriptions, etc.</p></div>`;
    return;
  }
  el.innerHTML = App.recurring.map(r => `
    <div class="recurring-row ${!r.is_active ? 'inactive' : ''}">
      <div class="recurring-icon ${r.type}">${r.type === 'income' ? '↑' : '↓'}</div>
      <div class="recurring-info">
        <span class="recurring-desc">${r.description || r.category}</span>
        <span class="recurring-meta">${r.category} · Day ${r.day_of_month} of each month</span>
      </div>
      <span class="recurring-amount ${r.type}">${r.type === 'income' ? '+' : '-'}${UI.currency(r.amount)}</span>
      <div class="recurring-actions">
        <button class="icon-btn edit-btn" onclick="openEditRecurring('${r.id}')" title="Edit">✎</button>
        <button class="icon-btn ${r.is_active ? 'pause-btn' : 'play-btn'}" onclick="toggleRecurring('${r.id}',${r.is_active})" title="${r.is_active ? 'Pause' : 'Resume'}">${r.is_active ? '⏸' : '▶'}</button>
        <button class="icon-btn del-btn" onclick="deleteRecurring('${r.id}')" title="Delete">✕</button>
      </div>
    </div>`).join('');
}

function openAddRecurring() {
  App.editing.recurring = null;
  document.getElementById('rec-modal-title').textContent = 'Add Recurring Entry';
  document.getElementById('rec-type').value        = 'income';
  document.getElementById('rec-amount').value      = '';
  document.getElementById('rec-description').value = '';
  document.getElementById('rec-day').value         = '1';
  populateRecurringCategoryDropdown('income', '');
  const recTypeEl = document.getElementById('rec-type');
  if (!recTypeEl.dataset.wired) {
    recTypeEl.dataset.wired = '1';
    recTypeEl.addEventListener('change', () => populateRecurringCategoryDropdown(recTypeEl.value, ''));
  }
  UI.openModal('recurring-modal');
}

function openEditRecurring(id) {
  const r = App.recurring.find(r => r.id === id);
  if (!r) return;
  App.editing.recurring = r;
  document.getElementById('rec-modal-title').textContent = 'Edit Recurring Entry';
  document.getElementById('rec-type').value        = r.type;
  document.getElementById('rec-amount').value      = Fmt.set(r.amount);
  document.getElementById('rec-description').value = r.description || '';
  document.getElementById('rec-day').value         = r.day_of_month;
  populateRecurringCategoryDropdown(r.type, r.category);
  UI.openModal('recurring-modal');
}

const REC_CATEGORY_OPTIONS = {
  expense: ['Rent / Mortgage', 'Utilities', 'Subscriptions', 'Insurance', 'Loan Payment'],
  income:  ['Job Salary', 'Side Hustle', 'Online Service', 'Investment', 'Real Estate'],
};

function populateRecurringCategoryDropdown(type, selected) {
  const names = REC_CATEGORY_OPTIONS[type] || REC_CATEGORY_OPTIONS.expense;
  const items = names.map(n => ({ name: n }));
  initCategoryCombo('rec-category', 'rec-category-suggestions', items, selected);
}

async function saveRecurring() {
  const type        = document.getElementById('rec-type').value;
  const amount      = Fmt.get(document.getElementById('rec-amount').value);
  const category    = document.getElementById('rec-category').value;
  const description = document.getElementById('rec-description').value.trim();
  const day         = parseInt(document.getElementById('rec-day').value) || 1;

  if (!type || !amount || !category) { UI.toast('Type, amount and category are required.', 'error'); return; }
  if (isNaN(amount) || amount <= 0)  { UI.toast('Amount must be a positive number.', 'error'); return; }

  const payload = { user_id: App.user.id, type, amount, category, description, day_of_month: day };
  let error;
  if (App.editing.recurring) {
    ({ error } = await db.from('recurring_transactions').update(payload).eq('id', App.editing.recurring.id).eq('user_id', App.user.id));
  } else {
    ({ error } = await db.from('recurring_transactions').insert([payload]));
  }
  if (error) { UI.toast(error.message, 'error'); return; }
  UI.toast(App.editing.recurring ? 'Updated!' : 'Recurring entry added!', 'success');
  UI.closeModal('recurring-modal');
  await loadRecurring();
  renderRecurringList();
}

async function toggleRecurring(id, isActive) {
  if (!CurrencySettings.canEdit()) return;
  await db.from('recurring_transactions').update({ is_active: !isActive }).eq('id', id).eq('user_id', App.user.id);
  await loadRecurring(); renderRecurringList();
  UI.toast(isActive ? 'Paused.' : 'Resumed.', 'info');
}

async function deleteRecurring(id) {
  if (!CurrencySettings.canEdit()) return;
  UI.confirm('Remove this recurring entry? Future months will no longer be posted.', async () => {
    await db.from('recurring_transactions').delete().eq('id', id).eq('user_id', App.user.id);
    await loadRecurring(); renderRecurringList();
    UI.toast('Recurring entry removed.', 'success');
  });
}

// ── REALTIME ─────────────────────────────────────────────────
function subscribeToBlueprints() {
  db.channel('blueprints-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'blueprints' }, () => {
      if (App.activeSection === 'community') loadAndRenderCommunity();
    }).subscribe();
}

// ── COMMUNITY SEARCH ─────────────────────────────────────────

function setupCommunitySearch() {
  const input = document.getElementById('community-search-input');
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';
  let searchTimer;
  input.addEventListener('input', () => {
    App.communitySearch = input.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      renderCommunityFeed();
      await renderUserSearchResults(input.value.trim());
    }, 300);
  });
}

async function renderUserSearchResults(query) {
  const el = document.getElementById('user-search-results');
  if (!el) return;
  if (!query || query.length < 2) { el.innerHTML = ''; return; }

  const { data, error } = await db.rpc('search_users', { query, limit_count: 8 });
  if (error || !data?.length) { el.innerHTML = ''; return; }

  // Filter out users who have blocked me (they won't appear in my searches)
  const _blocked = typeof Chat !== 'undefined' ? Chat.getBlockedByOthers() : new Set();
  const visible  = data.filter(u => !_blocked.has(u.id));
  if (!visible.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="user-search-header">People matching "${query}"</div>
    ${visible.map(u => {
      const avatar = u.avatar_url_storage || u.avatar_url;
      const name   = u.nickname || u.username;
      return `<div class="user-search-card">
        <div class="user-search-avatar">${avatar ? `<img src="${avatar}" alt="${name}">` : UI.avatarInitials(name)}</div>
        <div class="user-search-info">
          <span class="user-search-name">${name}</span>
          <span class="user-search-handle">@${u.username}</span>
        </div>
        <button class="btn btn-sm btn-outline" onclick="Chat.startChat('${u.id}','${name}','${u.username}')">Message</button>
      </div>`;
    }).join('')}`;
}

// ── HELPERS ───────────────────────────────────────────────────
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }

// ── SETTINGS ─────────────────────────────────────────────────
function updateCurrencyBanner() {
  const banner = document.getElementById('usd-view-banner');
  if (banner) banner.style.display = CurrencySettings.isUSDMode ? 'flex' : 'none';
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
      <div class="cur-status-usd">${isUSDMode ? 'Active · Read-only' : 'Click to preview'}</div>
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
      `Switch to USD view? Amounts will be shown converted at today's rate. Editing will be disabled until you switch back.`,
      async () => {
        UI.closeModal('currency-modal');
        await CurrencySettings._fetchRate(main.code);
        CurrencySettings.viewCurrency = 'USD';
        CurrencySettings._applyViewMode();
        navigateTo(App.activeSection);
        UI.toast('USD view enabled. Editing is disabled.', 'info');
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
    `Set ${found.name} (${found.code}) as your main currency? All amounts will be shown in ${found.symbol}.`,
    async () => {
      UI.closeModal('currency-modal');
      CurrencySettings.main = found;
      CurrencySettings.viewCurrency = 'main';
      if (found.code !== 'USD') {
        await CurrencySettings._fetchRate(found.code);
      } else {
        CurrencySettings.rateToUSD = 1;
        localStorage.removeItem('mrwisemax_rate_cache');
      }
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

// ── IMAGE CROP ────────────────────────────────────────────────
const _crop = { file: null, x: 0, y: 0, size: 0 };

function openCropModal(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    _crop.file = file;
    const img = document.getElementById('crop-source-img');
    img.onload = () => { setupCropBox(); initCropDrag(); };
    img.src = ev.target.result;
    UI.openModal('crop-modal');
  };
  reader.readAsDataURL(file);
}

function setupCropBox() {
  const img  = document.getElementById('crop-source-img');
  const wrap = document.getElementById('crop-wrap');
  const ir   = img.getBoundingClientRect();
  const wr   = wrap.getBoundingClientRect();
  const size = Math.round(Math.min(ir.width, ir.height) * 0.72);
  _crop.x    = Math.round((ir.width  - size) / 2 + ir.left - wr.left);
  _crop.y    = Math.round((ir.height - size) / 2 + ir.top  - wr.top);
  _crop.size = size;
  applyCropBox();
  updateCropPreview();
}

function applyCropBox() {
  const box = document.getElementById('crop-box');
  if (!box) return;
  box.style.left   = _crop.x + 'px';
  box.style.top    = _crop.y + 'px';
  box.style.width  = _crop.size + 'px';
  box.style.height = _crop.size + 'px';
}

function clampCrop() {
  const img  = document.getElementById('crop-source-img');
  const wrap = document.getElementById('crop-wrap');
  if (!img || !wrap) return;
  const ir = img.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const ox = ir.left - wr.left;
  const oy = ir.top  - wr.top;
  _crop.size = Math.max(40, Math.min(Math.min(ir.width, ir.height), _crop.size));
  _crop.x    = Math.max(ox, Math.min(ox + ir.width  - _crop.size, _crop.x));
  _crop.y    = Math.max(oy, Math.min(oy + ir.height - _crop.size, _crop.y));
}

function updateCropPreview() {
  const canvas = document.getElementById('crop-preview-canvas');
  const img    = document.getElementById('crop-source-img');
  const wrap   = document.getElementById('crop-wrap');
  if (!canvas || !img || !wrap) return;
  const ir  = img.getBoundingClientRect();
  const wr  = wrap.getBoundingClientRect();
  const ox  = ir.left - wr.left;
  const oy  = ir.top  - wr.top;
  const sx  = img.naturalWidth  / ir.width;
  const sy  = img.naturalHeight / ir.height;
  const cx  = (_crop.x - ox) * sx;
  const cy  = (_crop.y - oy) * sy;
  const cs  = _crop.size * sx;
  const OUT = 56;
  canvas.width = OUT; canvas.height = OUT;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.beginPath(); ctx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(img, cx, cy, cs, cs, 0, 0, OUT, OUT);
  ctx.restore();
}

function initCropDrag() {
  const box = document.getElementById('crop-box');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  let startX, startY, startCX, startCY, startSz, mode;

  box.addEventListener('pointerdown', e => {
    const tgt = e.target;
    mode   = tgt.classList.contains('crop-handle') ? tgt.dataset.dir : 'move';
    startX = e.clientX; startY = e.clientY;
    startCX = _crop.x; startCY = _crop.y; startSz = _crop.size;
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  box.addEventListener('pointermove', e => {
    if (!mode) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (mode === 'move') {
      _crop.x = startCX + dx;
      _crop.y = startCY + dy;
    } else if (mode === 'se') {
      _crop.size = startSz + dx;
    } else if (mode === 'nw') {
      _crop.size = startSz - dx;
      _crop.x = startCX + dx;
      _crop.y = startCY + dx;
    } else if (mode === 'ne') {
      _crop.size = startSz + dx;
      _crop.y = startCY - dx;
    } else if (mode === 'sw') {
      _crop.size = startSz + dy;
      _crop.x = startCX - dy;
    }
    clampCrop(); applyCropBox(); updateCropPreview();
  });

  box.addEventListener('pointerup', () => { mode = null; });
}

async function confirmCrop() {
  const img  = document.getElementById('crop-source-img');
  const wrap = document.getElementById('crop-wrap');
  if (!img || !wrap) return;
  const ir  = img.getBoundingClientRect();
  const wr  = wrap.getBoundingClientRect();
  const ox  = ir.left - wr.left;
  const oy  = ir.top  - wr.top;
  const sx  = img.naturalWidth  / ir.width;
  const sy  = img.naturalHeight / ir.height;
  const cx  = (_crop.x - ox) * sx;
  const cy  = (_crop.y - oy) * sy;
  const cs  = _crop.size * sx;
  const OUT = 512;
  const canvas = document.getElementById('crop-canvas');
  canvas.width = OUT; canvas.height = OUT;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, cx, cy, cs, cs, 0, 0, OUT, OUT);
  canvas.toBlob(async blob => {
    UI.closeModal('crop-modal');
    const uploadBtn = document.getElementById('profile-avatar-upload-btn');
    if (uploadBtn) { uploadBtn.textContent = 'Uploading…'; uploadBtn.disabled = true; }
    const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    const url  = await uploadAvatar(file);
    if (url) {
      App.profile.avatar_url_storage = url;
      renderUserInfo();
      renderProfile();
      UI.toast('Profile photo updated!', 'success');
    }
    if (uploadBtn) { uploadBtn.textContent = 'Change Photo'; uploadBtn.disabled = false; }
  }, 'image/jpeg', 0.92);
}

// -- PWA Install Banner ----------------------------------------
(function () {
  const DISMISSED_KEY = 'mrwisemax_pwa_dismissed';
  let _deferredPrompt = null;

  const banner     = document.getElementById('pwa-install-banner');
  const installBtn = document.getElementById('pwa-install-btn');
  const dismissBtn = document.getElementById('pwa-dismiss-btn');

  if (!banner) return;

  // Already running as an installed PWA — never show the banner
  const isStandalone = window.navigator.standalone === true ||
                       window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone || sessionStorage.getItem(DISMISSED_KEY)) return;

  function hideBanner() {
    banner.style.display = 'none';
    sessionStorage.setItem(DISMISSED_KEY, '1');
  }

  dismissBtn?.addEventListener('click', hideBanner);

  window.addEventListener('appinstalled', () => {
    banner.style.display = 'none';
    _deferredPrompt = null;
  });

  // ── Safari (iOS & macOS) ──────────────────────────────────────
  // Safari never fires beforeinstallprompt — detect it and show
  // manual "Add to Home Screen" instructions instead.
  const isIOS    = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = isIOS || /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isSafari) {
    const subtext = banner.querySelector('.pwa-banner-text span');
    if (subtext) {
      subtext.innerHTML = isIOS
        ? 'Tap the <strong>Share &#x2191;</strong> button, then <strong>"Add to Home Screen"</strong>'
        : 'In Safari: <strong>File</strong> &rarr; <strong>"Add to Dock&hellip;"</strong>';
    }
    if (installBtn) {
      installBtn.textContent = 'Got it';
      installBtn.addEventListener('click', hideBanner);
    }
    banner.style.display = 'flex';
    return;
  }

  // ── Chrome / Android — wait for the native install prompt ─────
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    banner.style.display = 'flex';
  });

  installBtn?.addEventListener('click', async () => {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    banner.style.display = 'none';
    if (outcome === 'accepted') sessionStorage.setItem(DISMISSED_KEY, '1');
  });
})();
