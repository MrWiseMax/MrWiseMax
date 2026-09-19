// ============================================================
// MrWiseMax — Assistant
// ============================================================
// A chat page that already knows the user's money. Everything it is told about
// their finances is worked out here, by the same code that draws the Overview,
// so the assistant quotes exactly the figures on screen. The server half
// (supabase/functions/ai-chat) keeps every conversation, counts each person's
// messages for the day, and streams each answer back as it is written.

// The function is pinned to the database's region: every question reads and
// writes the conversation there.
const ASSISTANT_URL = `${SUPABASE_URL}/functions/v1/ai-chat?forceFunctionRegion=us-east-1`;
const ASSISTANT_MAX_QUESTION = 2000;
const ASSISTANT_TIMEOUT_MS = 120000;
// Messages per person per day, reset at midnight UTC. The server has the final
// say (DEFAULT_DAILY_LIMIT in the function) and reports its figure with every
// answer; this one is shown until the first answer of the visit arrives.
const ASSISTANT_DAILY_LIMIT = 5;
const ASSISTANT_SUBTITLE = 'Knows your balances, income and expenses — ask it anything about your money.';

const Chat = {
  wired: false,
  // Loading the chat list and today's count, once per visit (startAssistant).
  started: null,
  listReady: false,
  listFailed: false,
  // Every saved conversation: { key, id, title, named, pinned, created_at,
  // updated_at, messages }. messages is null until the chat is first opened.
  // A new chat is in the list from its first question, with no id until the
  // server has saved it; `key` stays the same throughout.
  chats: [],
  // The chat on screen; null for a new, empty one.
  open: null,
  // What is on screen: the open chat's messages. Each is { role, content, el? }
  // and, while an answer streams: pending, live, streaming, shown, status,
  // question; error and retry if it failed.
  messages: [],
  // The chat whose answer is being written. One question at a time, across
  // every chat, though you can read another meanwhile.
  streaming: null,
  busy: false,
  remaining: null,
  limit: ASSISTANT_DAILY_LIMIT,
  resetsAt: null,
  // Whether a streaming answer may still scroll the log (see followAnswer).
  follow: false,
  // The chat whose name is being edited, and the one whose menu is open.
  renaming: null,
  menuFor: null,
  // Bumped whenever the user opens a chat or starts a new one, so the chat
  // reopened on arrival never overrides a choice made while it loaded.
  moves: 0,
};

// Where to start, for someone looking at an empty conversation.
const ASSISTANT_STARTERS = [
  'How am I doing? Give me the honest picture.',
  'Will my money last until my next payday?',
  'Where could I cut back without it hurting much?',
  'I want to save for something — help me plan it.',
  'What should I do first to get my finances in better shape?',
  'Build me a simple monthly budget from what I have.',
];

// ── What the assistant knows ─────────────────────────────────
// A snapshot of the user's cash flow, rebuilt for every question so an edit made
// a moment ago is already in it. Amounts are whole units in the currency on
// screen, as everywhere else in the app. The coverage walk and the monthly
// equivalents are the Overview's own; the assistant is left to reason about
// them rather than redo the arithmetic.
const AssistantContext = {
  build() {
    const today = dayStart(new Date());
    const code  = CurrencySettings.activeCode;
    const whole = n => Math.round(n || 0);
    const day   = d => (d ? isoDay(d) : null);
    const pct   = (part, all) => (all > 0 ? Math.round((part / all) * 1000) / 10 : null);

    const incomes  = App.incomes  || [];
    const expenses = App.expenses || [];
    const accounts = App.balances || [];
    const inMonth  = activeIncomes().reduce((s, i) => s + monthlyCost(i), 0);
    const outMonth = activeExpenses().reduce((s, e) => s + monthlyCost(e), 0);
    const balance  = balancesTotal();

    const entry = r => {
      const next = nextChargeOf(r);
      const out = {
        name: r.name,
        amount: whole(Money.toActive(r.amount, r.currency)),
        schedule: cadenceLabel(r).toLowerCase(),
        per_month: whole(monthlyCost(r)),
        next_date: day(next),
        status: !r.is_active ? 'paused' : next ? 'active' : 'finished',
      };
      if (r.currency && r.currency !== code) out.entered_in = `${r.currency} ${+r.amount}`;
      if (r.ends_on) out.ends_on = String(r.ends_on).slice(0, 10);
      if (r.notes) out.note = r.notes;
      return out;
    };

    const groups = new Map();
    activeExpenses().forEach(e => {
      const name = groupOf(e)?.name || 'Ungrouped';
      const g = groups.get(name) || { name, per_month: 0, items: 0 };
      g.per_month += monthlyCost(e);
      g.items++;
      groups.set(name, g);
    });

    return {
      today: isoDay(today),
      weekday: today.toLocaleDateString('en-US', { weekday: 'long' }),
      currency: {
        code,
        symbol: CurrencySettings.activeSymbol,
        main_currency: CurrencySettings.main.code,
        viewing_in_usd: CurrencySettings.isUSDMode,
      },
      totals: {
        balance_now: whole(balance),
        income_per_month: whole(inMonth),
        expenses_per_month: whole(outMonth),
        left_per_month: whole(inMonth - outMonth),
        share_of_income_left_pct: pct(inMonth - outMonth, inMonth),
        income_per_year: whole(inMonth * 12),
        expenses_per_year: whole(outMonth * 12),
        months_of_expenses_in_the_bank: outMonth > 0 ? Math.round((balance / outMonth) * 10) / 10 : null,
      },
      accounts: accounts.map(a => ({
        name: a.name,
        balance: whole(Money.toActive(a.balance, a.currency)),
        ...(a.currency && a.currency !== code ? { entered_in: `${a.currency} ${+a.balance}` } : {}),
        last_confirmed: String(a.as_of).slice(0, 10),
        days_since_confirmed: Math.max(0, Math.round((today - dayStart(new Date(a.as_of))) / 86400000)),
      })),
      income: incomes.map(entry),
      expenses: expenses.map(e => ({
        ...entry(e),
        group: groupOf(e)?.name || null,
        ...(e.is_active ? { share_of_spending_pct: pct(monthlyCost(e), outMonth) } : {}),
      })),
      groups: [...groups.values()]
        .sort((a, b) => b.per_month - a.per_month)
        .map(g => ({ ...g, per_month: whole(g.per_month), share_of_spending_pct: pct(g.per_month, outMonth) })),
      coverage: [1, 3, 6, 12].map(m => this.coverage(m, whole, day)),
      month_by_month: this.monthByMonth(12, whole, day),
      next_30_days: this.upcoming(30, whole, day),
      notes_for_assistant: this.notes(code, inMonth, outMonth),
    };
  },

  // The Overview's "Can you cover it?" for one window.
  coverage(months, whole, day) {
    const c = coverage(months);
    const missed = c.charges.filter(ch => !ch.covered);
    const out = {
      window: windowLabel(months),
      charges_due: whole(c.total),
      income_arriving: whole(c.income),
      covered: whole(c.covered),
      short_by: whole(c.shortfall),
      runs_out_on: day(c.breakDate),
      money_left_at_end: whole(c.left),
    };
    if (missed.length) {
      out.uncovered_charges = missed.slice(0, 10)
        .map(ch => ({ name: ch.e.name, date: day(ch.date), amount: whole(ch.amount) }));
      if (missed.length > 10) out.more_uncovered_charges = missed.length - 10;
    }
    return out;
  },

  // Every payday and charge in date order — the same events as coverage — as a
  // plain running balance that is allowed to go below zero, per calendar month.
  monthByMonth(months, whole, day) {
    const today = dayStart(new Date());
    const events = [];
    activeExpenses().forEach(e => occurrencesIn(e, months + 1)
      .forEach(d => events.push({ d, amount: -Money.toActive(e.amount, e.currency) })));
    activeIncomes().forEach(i => occurrencesIn(i, months + 1)
      .forEach(d => events.push({ d, amount: Money.toActive(i.amount, i.currency) })));
    // Income first on a shared day, as the coverage walk has it.
    events.sort((a, b) => a.d - b.d || b.amount - a.amount);

    let running = balancesTotal();
    const rows = [];
    for (let k = 0; k < months; k++) {
      const start = k === 0 ? today : new Date(today.getFullYear(), today.getMonth() + k, 1);
      const end   = new Date(today.getFullYear(), today.getMonth() + k + 1, 1);
      const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const row = { month: k === 0 ? `${label} (from today)` : label, starts_with: whole(running),
                    money_in: 0, money_out: 0 };
      let lowest = running, lowestOn = start;
      events.filter(ev => ev.d >= start && ev.d < end).forEach(ev => {
        running += ev.amount;
        if (ev.amount > 0) row.money_in += ev.amount; else row.money_out -= ev.amount;
        if (running < lowest) { lowest = running; lowestOn = ev.d; }
      });
      rows.push({ ...row, money_in: whole(row.money_in), money_out: whole(row.money_out),
                  ends_with: whole(running), lowest: whole(lowest), lowest_on: day(lowestOn) });
    }
    return rows;
  },

  // What lands in the next few weeks, soonest first.
  upcoming(days, whole, day) {
    const today = dayStart(new Date());
    const limit = addDays(today, days);
    const out = [];
    const add = (kind, r) => occurrencesIn(r, 2).filter(d => d <= limit)
      .forEach(d => out.push({ date: d, kind, name: r.name, amount: Money.toActive(r.amount, r.currency) }));
    activeIncomes().forEach(i => add('income', i));
    activeExpenses().forEach(e => add('charge', e));
    return out.sort((a, b) => a.date - b.date || (a.kind === 'income' ? -1 : 1))
      .slice(0, 40)
      .map(x => ({ ...x, date: day(x.date), amount: whole(x.amount) }));
  },

  // Gaps and caveats the numbers alone would not reveal.
  notes(code, inMonth, outMonth) {
    const notes = [];
    const accounts = App.balances || [];
    if (!accounts.length) {
      notes.push('No bank accounts entered, so the balance counts as zero in every forecast.');
    }
    accounts.forEach(a => {
      const days = Math.round((Date.now() - new Date(a.as_of).getTime()) / 86400000);
      if (days > 30) notes.push(`The balance of "${a.name}" was last confirmed ${days} days ago and may be out of date.`);
    });
    if (!activeIncomes().length) {
      notes.push('No income is recorded, so forecasts assume nothing comes in.');
    }
    if (!activeExpenses().length) notes.push('No expenses are recorded yet.');
    const paused = (App.expenses || []).filter(e => !e.is_active).length
                 + (App.incomes || []).filter(i => !i.is_active).length;
    if (paused) notes.push(`${paused} paused ${paused === 1 ? 'item is' : 'items are'} excluded from every total.`);
    const foreign = [...new Set([...(App.expenses || []), ...(App.incomes || []), ...accounts]
      .map(r => r.currency).filter(c => c && c !== code))];
    if (foreign.length) {
      notes.push(`Some amounts were entered in ${foreign.join(', ')} and are converted into ${code} at today's rate, so they move with the exchange rate.`);
    }
    if (CurrencySettings._missingRateWarned) {
      notes.push('Live exchange rates could not be loaded, so foreign-currency amounts are shown unconverted.');
    }
    if (inMonth > 0 && outMonth > inMonth) notes.push('Recorded expenses are higher than recorded income.');
    return notes;
  },
};

// ── Markdown, safely ─────────────────────────────────────────
// The answers come back as Markdown. Everything is HTML-escaped first, and only
// a fixed set of tags is ever produced from it, so nothing in an answer can
// inject markup into the page.
const ChatMarkdown = (() => {
  const LIST_ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
  const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  // Code spans are set aside while the rest of a line is formatted, so nothing
  // inside backticks is read as bold or italic. The marker is a private-use
  // character, which no answer will contain.
  const CODE_MARK = String.fromCharCode(0xE000);
  const CODE_SLOT = new RegExp(`${CODE_MARK}([0-9]+)${CODE_MARK}`, 'g');

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `${CODE_MARK}${codes.push(c) - 1}${CODE_MARK}`);
    s = s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>');
    return s.replace(CODE_SLOT, (_, i) => `<code>${codes[i]}</code>`);
  }

  function list(lines, i) {
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(LIST_ITEM);
      if (m) {
        items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]),
                     start: parseInt(m[2], 10), text: m[3] });
        i++;
      } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
        items[items.length - 1].text += '\n' + lines[i].trim();   // wrapped line of the item above
        i++;
      } else if (!lines[i].trim() && LIST_ITEM.test(lines[i + 1] || '')) {
        i++;                                                         // blank line between items
      } else break;
    }

    let html = '';
    const open = [];
    items.forEach(it => {
      const tag = it.ordered ? 'ol' : 'ul';
      while (open.length && it.indent < open[open.length - 1].indent) html += `</li></${open.pop().tag}>`;
      const top = open[open.length - 1];
      if (!top || it.indent > top.indent) {
        const start = it.ordered && !top && it.start > 1 ? ` start="${it.start}"` : '';
        html += `<${tag}${start}>`;
        open.push({ indent: it.indent, tag });
      } else {
        html += '</li>';
        if (top.tag !== tag) { html += `</${top.tag}><${tag}>`; top.tag = tag; }
      }
      html += `<li>${inline(it.text).replace(/\n/g, '<br>')}`;
    });
    while (open.length) html += `</li></${open.pop().tag}>`;
    return [html, i];
  }

  function table(lines, i) {
    const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const head = cells(lines[i]);
    const align = cells(lines[i + 1]).map(c => (/-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''));
    const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
    i += 2;
    const body = [];
    while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(cells(lines[i++]));
    return [`<div class="md-table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead>` +
      `<tbody>${body.map(r => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`, i];
  }

  function render(src) {
    const lines = esc(String(src || '').replace(/\r/g, '')).split('\n');
    const html = [];
    let para = [];
    const flush = () => {
      if (para.length) html.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };

    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      let m;
      if (/^\s*```/.test(line)) {
        flush();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        html.push(`<pre><code>${code.join('\n')}</code></pre>`);
        i++;
      } else if (!line.trim()) {
        flush(); i++;
      } else if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*$/))) {
        flush();
        const tag = m[1].length <= 3 ? 'h3' : 'h4';
        html.push(`<${tag}>${inline(m[2])}</${tag}>`);
        i++;
      } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush(); html.push('<hr>'); i++;
      } else if (line.includes('|') && TABLE_RULE.test(lines[i + 1] || '')) {
        flush();
        const [t, next] = table(lines, i);
        html.push(t); i = next;
      } else if (/^\s*&gt;/.test(line)) {
        flush();
        const quote = [];
        while (i < lines.length && /^\s*&gt;/.test(lines[i])) quote.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
        html.push(`<blockquote>${render(quote.join('\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))}</blockquote>`);
      } else if (LIST_ITEM.test(line)) {
        flush();
        const [l, next] = list(lines, i);
        html.push(l); i = next;
      } else {
        para.push(line.trim()); i++;
      }
    }
    flush();
    return html.join('');
  }

  return { render };
})();

// ── Motion ───────────────────────────────────────────────────
// Everything on this page moves on the app's own easing curve. Anyone whose
// device asks for less motion gets the same page, with none of it.
const Motion = {
  get reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; },
  EASE: 'cubic-bezier(0.22, 0.61, 0.36, 1)',

  // Plays a keyframe list and resolves when it is over. The timeout matters in
  // a background tab, where animations can stall and would hold up whatever
  // is waiting on them.
  play(el, frames, opts = {}) {
    if (!el || !el.animate || this.reduced) return Promise.resolve();
    const run = el.animate(frames, { easing: this.EASE, ...opts });
    const limit = (opts.duration || 0) + (opts.delay || 0) + 150;
    return Promise.race([run.finished.catch(() => {}), new Promise(r => setTimeout(r, limit))]);
  },

  // Fades elements out as they lift away. They stay hidden afterwards, so the
  // caller can remove them without a flash.
  leave(els, duration = 200) {
    return Promise.all([...els].map((el, i) => this.play(el,
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px) scale(0.98)' }],
      { duration, delay: Math.min(i, 6) * 25, fill: 'forwards' })));
  },

  // Moves an element from where `from` was on screen to where it now sits, so
  // it seems to travel there: the chip you tapped, or the box you typed in,
  // becomes your message.
  flyFrom(el, from) {
    if (!el || !from || this.reduced) return;
    const to = el.getBoundingClientRect();
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    const scale = Math.max(0.8, Math.min(1, from.width / to.width));
    this.play(el, [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  },

  // Counts a figure up from zero, formatted the way the app shows money,
  // starting once whatever it sits in has had `delay` ms to fade in.
  countUp(el, { duration = 1000, delay = 0 } = {}) {
    const to = parseFloat(el?.dataset.count);
    if (!el || !isFinite(to) || this.reduced || document.hidden) return;
    el.textContent = UI.currency(0);
    let start = null;
    const tick = now => {
      if (start === null) start = now + delay;
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      el.textContent = UI.currency(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1 && el.isConnected) requestAnimationFrame(tick);
      else el.textContent = UI.currency(to);
    };
    requestAnimationFrame(tick);
  },
};

// ── Updating an answer in place ──────────────────────────────
// A streaming answer is redrawn many times a second. Rather than replacing it
// wholesale, each new version is laid over the old one node by node: whatever
// has not changed stays exactly as it is, text that grew is extended, and only
// genuinely new blocks — a paragraph, a list item, a table row — are added,
// each easing in as it arrives.
const ENTERING = new Set(['P', 'LI', 'TR', 'H3', 'H4', 'BLOCKQUOTE', 'PRE', 'HR', 'UL', 'OL', 'DIV']);

function morphInto(target, html) {
  const next = document.createElement('template');
  next.innerHTML = html;
  morphChildren(target, next.content);
}

function morphChildren(from, to) {
  const was = [...from.childNodes];
  const now = [...to.childNodes];
  now.forEach((node, i) => {
    const old = was[i];
    if (!old) { from.appendChild(entering(node)); return; }
    if (old.nodeType !== node.nodeType || old.nodeName !== node.nodeName) {
      from.replaceChild(entering(node), old);
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (old.nodeValue !== node.nodeValue) old.nodeValue = node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) { from.replaceChild(node, old); return; }
    syncAttributes(old, node);
    morphChildren(old, node);
  });
  for (let i = was.length - 1; i >= now.length; i--) was[i].remove();
}

function entering(node) {
  if (node.nodeType === Node.ELEMENT_NODE && ENTERING.has(node.nodeName)) node.classList.add('md-in');
  return node;
}

// Attributes follow the new version — except the entrance class an element was
// given when it arrived, since taking that away mid-animation would snap it.
function syncAttributes(old, node) {
  for (const { name } of [...old.attributes]) {
    if (name !== 'class' && !node.hasAttribute(name)) old.removeAttribute(name);
  }
  for (const { name, value } of [...node.attributes]) {
    if (name !== 'class' && old.getAttribute(name) !== value) old.setAttribute(name, value);
  }
  const arriving = old.classList.contains('md-in');
  const want = node.getAttribute('class') || '';
  const have = (old.getAttribute('class') || '').replace(/\bmd-in\b/, '').trim();
  if (want === have) return;
  if (want) old.setAttribute('class', want); else old.removeAttribute('class');
  if (arriving) old.classList.add('md-in');
}

// ── Page ─────────────────────────────────────────────────────
function renderAssistant() {
  wireAssistant();
  startAssistant();
  drawChat();
  drawChatList();
  drawChatHead();
  closeChatSide();
  // Put the cursor in the box on a wide screen; on a phone that would throw
  // the keyboard up over the page before anyone asked for it.
  if (!isNarrow()) setTimeout(() => document.getElementById('chat-input')?.focus(), 60);
}

// The chat list and today's count load once, the first time the page opens.
// The chat last open on this device opens again; otherwise a new one.
function startAssistant() {
  if (Chat.started) return Chat.started;
  const moves = Chat.moves;
  Chat.started = (async () => {
    const [chats] = await Promise.all([fetchChats(), loadAllowance()]);
    Chat.chats.push(...chats);
    Chat.listReady = true;
    drawChatList({ intro: true });
    if (Chat.moves !== moves) return;
    const last = rememberedChat();
    const chat = last && Chat.chats.find(c => c.id === last);
    if (chat) { await openChat(chat, { quiet: true }); return; }
    const log = document.getElementById('chat-log');
    await Motion.leave(log?.querySelectorAll('.chat-skeleton') || [], 160);
    if (!Chat.open) drawChat({ intro: true });
  })();
  return Chat.started;
}

async function fetchChats() {
  try {
    const { data, error } = await db.from('ai_chats')
      .select('id,title,named,pinned,created_at,updated_at')
      .eq('user_id', App.user.id)
      .order('updated_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    return (data || []).map(c => ({ ...c, key: c.id, messages: null }));
  } catch (e) {
    // Not fatal: the assistant still works, and new chats still save.
    console.warn('[Assistant] could not load your chats:', e.message);
    Chat.listFailed = true;
    return [];
  }
}

async function loadChatMessages(chat) {
  if (!chat.loading) chat.loading = (async () => {
    try {
      const { data, error } = await db.from('ai_chat_messages')
        .select('role,content,created_at')
        .eq('chat_id', chat.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      chat.messages = (data || []).reverse().map(m => ({ role: m.role, content: m.content }));
      chat.loadError = false;
    } catch (e) {
      console.warn('[Assistant] could not load that chat:', e.message);
      chat.loadError = true;
    }
    chat.loading = null;
  })();
  return chat.loading;
}

// ── Today's allowance ────────────────────────────────────────
// Read from the same count the server keeps, so a question asked on another
// device is already taken off. The count starts again at midnight UTC.
async function loadAllowance() {
  try {
    const { data, error } = await db.from('ai_usage')
      .select('messages')
      .eq('user_id', App.user.id)
      .eq('day', new Date().toISOString().slice(0, 10));
    if (error) throw error;
    Chat.remaining = Math.max(0, Chat.limit - (data?.[0]?.messages || 0));
  } catch (e) {
    Chat.remaining = null;      // unknown: the server still enforces it
  }
  Chat.resetsAt = nextUtcMidnight();
  scheduleAllowanceReset();
  updateComposer();
}

// Someone who runs out and leaves the page open gets their messages back when
// the day turns, without reloading.
function scheduleAllowanceReset() {
  clearTimeout(Chat.resetTimer);
  const wait = (Chat.resetsAt || nextUtcMidnight()) - Date.now() + 5000;
  Chat.resetTimer = setTimeout(loadAllowance, Math.max(5000, wait));
}

function nextUtcMidnight() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// When the messages come back, in the user's own time: "at 7:00 PM", or
// "tomorrow at 7:00 AM" when midnight UTC falls after their midnight.
function resetPhrase() {
  const at = Chat.resetsAt || nextUtcMidnight();
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString() ? `at ${time}` : `tomorrow at ${time}`;
}

function outOfMessages() {
  return `You’ve used all ${Chat.limit} of today’s messages. You can ask again ${resetPhrase()}.`;
}

// ── Remembering the open chat ────────────────────────────────
// Per person, per device: which chat to reopen next time. Only a convenience,
// so storage that is blocked or cleared just means opening on a new chat.
function chatStorageKey() { return `mwm.assistant.chat.${App.user?.id || ''}`; }

function rememberChat(id) {
  try {
    if (id) localStorage.setItem(chatStorageKey(), id);
    else localStorage.removeItem(chatStorageKey());
  } catch (_) { /* storage unavailable */ }
}

function rememberedChat() {
  try { return localStorage.getItem(chatStorageKey()); } catch (_) { return null; }
}

// ── Wiring ───────────────────────────────────────────────────
function wireAssistant() {
  if (Chat.wired) return;
  Chat.wired = true;

  const form  = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log   = document.getElementById('chat-log');
  const send  = document.getElementById('chat-send');
  const list  = document.getElementById('chat-list');

  input.addEventListener('input', () => { sizeChatInput(); updateComposer(); });
  input.addEventListener('keydown', e => {
    // Enter sends on a keyboard; on a touchscreen it is a new line, and the
    // send button sends — the way messaging apps behave there.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    form.requestSubmit();
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || Chat.busy || Chat.remaining === 0) return;
    const from = input.getBoundingClientRect();
    send.classList.remove('launch');
    void send.offsetWidth;          // restart the launch even on a quick second send
    send.classList.add('launch');
    input.value = '';
    sizeChatInput();
    sendChat(text, from);
  });

  // Any scroll the reader makes themselves ends the auto-follow for this answer.
  const takeOver = () => { Chat.follow = false; };
  log.addEventListener('wheel', takeOver, { passive: true });
  log.addEventListener('touchmove', takeOver, { passive: true });
  log.addEventListener('keydown', takeOver);

  let checking = 0;
  log.addEventListener('scroll', () => {
    if (checking) return;
    checking = requestAnimationFrame(() => { checking = 0; checkJump(); });
  }, { passive: true });

  document.getElementById('chat-jump')?.addEventListener('click', () => {
    log.scrollTo({ top: log.scrollHeight, behavior: Motion.reduced ? 'auto' : 'smooth' });
  });

  log.addEventListener('click', e => {
    const starter = e.target.closest('[data-ask]');
    if (starter) {
      if (Chat.busy) return;
      if (Chat.remaining === 0) { UI.toast(esc(outOfMessages()), 'info', 5000); return; }
      starter.classList.add('picked');
      sendChat(starter.dataset.ask, starter.getBoundingClientRect());
      return;
    }
    const retry = e.target.closest('.chat-retry');
    if (retry) { retryChat(Chat.messages.find(m => m.el === retry.closest('.chat-msg'))); return; }
    if (e.target.closest('.chat-reload')) reloadOpenChat();
  });

  // The chat list, its menu, and the panel it slides in on.
  document.getElementById('chat-new')?.addEventListener('click', newChat);
  document.getElementById('chat-side-new')?.addEventListener('click', newChat);
  document.getElementById('chat-side-open')?.addEventListener('click', openChatSide);
  document.getElementById('chat-side-close')?.addEventListener('click', () => closeChatSide(true));
  document.getElementById('chat-scrim')?.addEventListener('click', () => closeChatSide());

  const chatFor = el => Chat.chats.find(c => c.key === el?.closest('.chat-item')?.dataset.key);
  list.addEventListener('click', e => {
    const chat = chatFor(e.target);
    if (!chat) return;
    const more = e.target.closest('.chat-item-more');
    if (more) openChatMenu(chat, more);
    else if (e.target.closest('.chat-item-open')) openChat(chat);
  });
  // A right-click, or a long press on a phone, opens the same menu.
  list.addEventListener('contextmenu', e => {
    const chat = chatFor(e.target);
    const more = e.target.closest('.chat-item')?.querySelector('.chat-item-more');
    if (!chat || !more || Chat.renaming) return;
    e.preventDefault();
    openChatMenu(chat, more);
  });
  list.addEventListener('scroll', () => closeChatMenu(), { passive: true });

  document.addEventListener('pointerdown', e => {
    if (Chat.menuFor && !e.target.closest('.chat-menu, .chat-item-more')) closeChatMenu();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('.modal.modal-open')) return;
    if (Chat.menuFor) { closeChatMenu(true); return; }
    if (document.getElementById('assistant')?.classList.contains('side-open')) closeChatSide(true);
  });
  window.addEventListener('resize', () => closeChatMenu());
}

function sizeChatInput() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}

function updateComposer() {
  const input = document.getElementById('chat-input');
  const send  = document.getElementById('chat-send');
  const out   = Chat.remaining === 0;
  if (input) {
    input.disabled = out;
    input.placeholder = out ? `You’ve used today’s ${Chat.limit} messages — more ${resetPhrase()}`
                            : 'Ask about your money…';
  }
  if (send && input) send.disabled = Chat.busy || out || !input.value.trim();
  const form = document.getElementById('chat-form');
  form?.classList.toggle('busy', Chat.busy);
  form?.classList.toggle('out', out);
  document.querySelectorAll('#chat-log .chat-chip').forEach(b => b.classList.toggle('spent', out));

  const foot = document.getElementById('chat-foot');
  if (foot) {
    const left = Chat.remaining;
    const quota = left === null ? ''
      : left > 0 ? `<span class="chat-quota">${left} of ${Chat.limit} ${Chat.limit === 1 ? 'message' : 'messages'} left today</span>`
      : `<span class="chat-quota out">No messages left today — more ${esc(resetPhrase())}</span>`;
    const was = foot.querySelector('.chat-quota')?.textContent;
    foot.innerHTML = `${quota}<span class="chat-note">Answers can contain mistakes and aren’t professional financial advice.</span>`;
    // The count gives a small beat when it changes, so a spent message is noticed.
    const now = foot.querySelector('.chat-quota');
    if (was !== undefined && now && now.textContent !== was) {
      Motion.play(now, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
        { duration: 420 });
    }
  }
}

// The round button that takes you back down, shown once you have scrolled
// well up from the latest message.
function checkJump() {
  const log = document.getElementById('chat-log');
  const btn = document.getElementById('chat-jump');
  if (!log || !btn) return;
  const away = !!Chat.messages.length && log.scrollHeight - log.scrollTop - log.clientHeight > 240;
  btn.classList.toggle('show', away);
  btn.tabIndex = away ? 0 : -1;
  btn.setAttribute('aria-hidden', String(!away));
}

// ── Moving between chats ─────────────────────────────────────
async function openChat(chat, { quiet = false } = {}) {
  closeChatSide();
  if (chat === Chat.open) return;
  Chat.moves++;
  leaveUnsavedChat();
  Chat.open = chat;
  Chat.messages = chat.messages || [];
  chat.unread = false;
  rememberChat(chat.id);
  drawChatList();
  drawChatHead();

  // What was on screen lifts away first; the chat arriving settles in after.
  const log = document.getElementById('chat-log');
  if (!quiet) await Motion.leave(log?.children || [], 140);
  if (Chat.open !== chat) return;
  if (!chat.messages) {
    drawChat();                               // placeholder shapes while it loads
    await loadChatMessages(chat);
    if (Chat.open !== chat) return;
    await Motion.leave(log?.querySelectorAll('.chat-skeleton') || [], 160);
    if (Chat.open !== chat) return;
    Chat.messages = chat.messages || [];
  }
  drawChat({ intro: true });
  if (Chat.messages.length) scrollChat();
}

async function reloadOpenChat() {
  const chat = Chat.open;
  if (!chat || chat.loading) return;
  chat.loadError = false;
  drawChat();
  await loadChatMessages(chat);
  if (Chat.open !== chat) return;
  Chat.messages = chat.messages || [];
  drawChat({ intro: true });
  if (Chat.messages.length) scrollChat();
}

async function newChat() {
  closeChatSide();
  Chat.moves++;
  const input = document.getElementById('chat-input');
  if (!Chat.open) {
    if (!isNarrow()) input?.focus();
    return;
  }
  leaveUnsavedChat();
  Chat.open = null;
  Chat.messages = [];
  rememberChat(null);
  drawChatList();
  drawChatHead();
  await Motion.leave(document.getElementById('chat-log')?.children || [], 180);
  if (Chat.open) return;
  drawChat({ intro: true });
  if (!isNarrow()) input?.focus();
}

// A chat whose first question never got an answer was never saved, so it
// leaves the list once you move away from it.
function leaveUnsavedChat() {
  const c = Chat.open;
  if (c && !c.id && Chat.streaming !== c) Chat.chats = Chat.chats.filter(x => x !== c);
}

// The line under the page title: the open chat's name, or what the page does.
function drawChatHead() {
  const sub = document.getElementById('chat-subtitle');
  if (!sub) return;
  const text = Chat.open ? Chat.open.title : ASSISTANT_SUBTITLE;
  sub.classList.toggle('is-title', !!Chat.open);
  if (sub.textContent === text) return;
  sub.textContent = text;
  Motion.play(sub, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
}

// ── The chat panel ───────────────────────────────────────────
// Only slides on screens too narrow to keep it beside the chat; on a wide one
// it is always there and these do nothing visible.
function openChatSide() {
  const box = document.getElementById('assistant');
  if (!box) return;
  box.classList.add('side-open');
  document.getElementById('chat-side-open')?.setAttribute('aria-expanded', 'true');
  const active = document.querySelector('#chat-list .chat-item.active .chat-item-open');
  setTimeout(() => (active || document.getElementById('chat-side-new'))?.focus({ preventScroll: true }), 60);
}

function closeChatSide(returnFocus = false) {
  const box = document.getElementById('assistant');
  if (!box?.classList.contains('side-open')) return;
  box.classList.remove('side-open');
  closeChatMenu();
  const opener = document.getElementById('chat-side-open');
  opener?.setAttribute('aria-expanded', 'false');
  if (returnFocus) opener?.focus();
}

// ── The chat list ────────────────────────────────────────────
const CHAT_ICONS = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
  unpin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><line x1="12" y1="17" x2="12" y2="22"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12"/><path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89"/></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
};

// The pinned chat first, then the rest by when they were last used.
function chatGroups() {
  const today = dayStart(new Date());
  const when = c => Date.parse(c.updated_at) || 0;
  const sorted = [...Chat.chats].sort((a, b) => when(b) - when(a));
  const groups = new Map();
  const add = (label, c) => (groups.get(label) || groups.set(label, []).get(label)).push(c);
  sorted.filter(c => c.pinned).forEach(c => add('Pinned', c));
  sorted.filter(c => !c.pinned).forEach(c => {
    const day = dayStart(new Date(when(c)));
    const ago = Math.round((today - day) / 86400000);
    add(ago <= 0 ? 'Today' : ago === 1 ? 'Yesterday' : ago < 7 ? 'Previous 7 days' : ago < 30 ? 'Previous 30 days'
      : day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), c);
  });
  return groups;
}

// Redraws the list. Chats that were already there glide to their new place
// (one moving to the top, say, after a new message), and a new one slides in.
function drawChatList({ intro = false } = {}) {
  const list = document.getElementById('chat-list');
  if (!list) return;
  // Never pull the name box out from under someone typing in it.
  if (Chat.renaming) { Chat.listDirty = true; return; }
  Chat.listDirty = false;
  if (!Chat.listReady) {
    list.innerHTML = `<div class="chat-list-skeleton" aria-label="Loading your chats">
      ${[62, 80, 48, 70, 56].map(w => `<span class="sk" style="width:${w}%"></span>`).join('')}</div>`;
    return;
  }
  if (!Chat.chats.length) {
    list.innerHTML = `<p class="chat-list-empty">${Chat.listFailed
      ? 'Your chats could not be loaded. Reload the page to try again.'
      : 'Your chats are saved here, so you can pick any conversation up again later.'}</p>`;
    return;
  }

  const before = new Map([...list.querySelectorAll('.chat-item')].map(el => [el.dataset.key, {
    top: el.getBoundingClientRect().top,
    active: el.classList.contains('active'),
    pinned: el.classList.contains('pinned'),
  }]));
  let i = 0;
  list.innerHTML = [...chatGroups()].map(([label, chats]) => `
    <div class="chat-group" role="group" aria-label="${esc(label)}">
      <h3 class="chat-group-label">${esc(label)}</h3>
      ${chats.map(c => chatItemHtml(c, i++)).join('')}
    </div>`).join('');

  list.classList.toggle('intro', intro);
  if (intro) setTimeout(() => list.classList.remove('intro'), 1200);
  if (intro || Motion.reduced) return;
  list.querySelectorAll('.chat-item').forEach(el => {
    const was = before.get(el.dataset.key);
    if (!was) { if (before.size) el.classList.add('arrive'); return; }
    // The accent and the pin animate only as they appear, not on every redraw.
    if (el.classList.contains('active') && !was.active) el.classList.add('became-active');
    if (el.classList.contains('pinned') && !was.pinned) el.classList.add('became-pinned');
    const dy = was.top - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) {
      Motion.play(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: 440, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  });
}

function chatItemHtml(c, i) {
  const active = c === Chat.open;
  const cls = ['chat-item', active && 'active', c.pinned && 'pinned', c.unread && 'unread',
               Chat.streaming === c && 'writing'].filter(Boolean).join(' ');
  return `
    <div class="${cls}" data-key="${esc(c.key)}" style="--i:${i}">
      <button class="chat-item-open" type="button" title="${esc(c.title)}"${active ? ' aria-current="true"' : ''}>
        ${c.pinned ? `<span class="chat-item-pin">${CHAT_ICONS.pin}</span>` : ''}
        <span class="chat-item-title">${esc(c.title)}</span>
      </button>
      ${c.id ? `<button class="chat-item-more" type="button" aria-label="Options for ${esc(c.title)}"
        aria-haspopup="menu" aria-expanded="false">${CHAT_ICONS.more}</button>` : ''}
    </div>`;
}

function chatItemEl(key) {
  return [...document.querySelectorAll('#chat-list .chat-item')].find(el => el.dataset.key === key) || null;
}

// ── A chat's menu: pin, rename, delete ───────────────────────
function chatMenuEl() {
  let menu = document.getElementById('chat-menu');
  if (menu) return menu;
  // It lives on <body>, clear of the list's scrolling and the panel's slide.
  menu = document.createElement('div');
  menu.id = 'chat-menu';
  menu.className = 'chat-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.appendChild(menu);

  menu.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const chat = Chat.chats.find(c => c.key === Chat.menuFor);
    if (!act || !chat) return;
    closeChatMenu();
    ({ pin: togglePin, rename: startRename, delete: deleteChat })[act](chat);
  });
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      closeChatMenu();
    }
  });
  return menu;
}

function openChatMenu(chat, button) {
  if (Chat.menuFor === chat.key) { closeChatMenu(true); return; }
  closeChatMenu();
  const menu = chatMenuEl();
  menu.innerHTML = `
    <button type="button" role="menuitem" data-act="pin">${chat.pinned ? `${CHAT_ICONS.unpin} Unpin` : `${CHAT_ICONS.pin} Pin`}</button>
    <button type="button" role="menuitem" data-act="rename">${CHAT_ICONS.rename} Rename</button>
    <button type="button" role="menuitem" data-act="delete" class="danger">${CHAT_ICONS.delete} Delete</button>`;
  Chat.menuFor = chat.key;
  button.setAttribute('aria-expanded', 'true');
  button.closest('.chat-item')?.classList.add('menu-open');

  // Below the button, or above it when there is no room underneath.
  menu.hidden = false;
  const r = button.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const below = r.bottom + 6 + h <= window.innerHeight - 8;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  menu.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  menu.style.transformOrigin = below ? 'top right' : 'bottom right';
  menu.classList.remove('open');
  void menu.offsetWidth;
  menu.classList.add('open');
  menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
}

function closeChatMenu(returnFocus = false) {
  if (!Chat.menuFor) return;
  const item = chatItemEl(Chat.menuFor);
  Chat.menuFor = null;
  const menu = document.getElementById('chat-menu');
  if (menu) { menu.hidden = true; menu.classList.remove('open'); }
  item?.classList.remove('menu-open');
  const button = item?.querySelector('.chat-item-more');
  button?.setAttribute('aria-expanded', 'false');
  if (returnFocus) button?.focus();
}

// One chat can be pinned at a time: pinning another takes the pin from it.
async function togglePin(chat) {
  const pin = !chat.pinned;
  const was = Chat.chats.find(c => c.pinned && c !== chat);
  if (pin && was) was.pinned = false;
  chat.pinned = pin;
  drawChatList();
  const { error } = await db.rpc('ai_pin_chat', { p_chat: chat.id, p_pinned: pin });
  if (error) {
    chat.pinned = !pin;
    if (pin && was) was.pinned = true;
    drawChatList();
    UI.toast('That chat could not be pinned. Try again.', 'error');
    return;
  }
  if (pin && was) UI.toast(`Pinned. “${esc(was.title)}” was unpinned — one chat can be pinned at a time.`, 'info', 4500);
}

// The name is edited where it stands in the list. Enter or clicking away
// saves it; Escape leaves it as it was.
function startRename(chat) {
  const item = chatItemEl(chat.key);
  if (!item) return;
  Chat.renaming = chat.key;
  item.classList.add('renaming');
  const input = document.createElement('input');
  input.className = 'chat-item-input';
  input.type = 'text';
  input.maxLength = 80;
  input.value = chat.title;
  input.setAttribute('aria-label', 'Chat name');
  item.querySelector('.chat-item-open').after(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    Chat.renaming = null;
    const name = input.value.replace(/\s+/g, ' ').trim().slice(0, 80);
    const before = { title: chat.title, named: chat.named };
    const changed = save && name && name !== chat.title;
    if (changed) Object.assign(chat, { title: name, named: true });
    drawChatList();
    if (!changed) return;
    drawChatHead();
    const { error } = await db.from('ai_chats').update({ title: name, named: true }).eq('id', chat.id);
    if (error) {
      Object.assign(chat, before);
      drawChatList();
      drawChatHead();
      UI.toast('That chat could not be renamed. Try again.', 'error');
    }
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function deleteChat(chat) {
  if (Chat.streaming === chat) {
    UI.toast('Wait for the answer to finish before deleting this chat.', 'info');
    return;
  }
  UI.confirm(`Delete “${chat.title}”? The whole conversation will be gone for good.`, async () => {
    const { error } = await db.from('ai_chats').delete().eq('id', chat.id);
    if (error) { UI.toast('That chat could not be deleted. Try again.', 'error'); return; }

    // The row folds away, and the ones below close up behind it.
    const el = chatItemEl(chat.key);
    if (el) {
      el.style.overflow = 'hidden';
      await Motion.play(el, [
        { opacity: 1, height: `${el.offsetHeight}px`, transform: 'none' },
        { opacity: 0, height: '0px', transform: 'translateX(-14px)' },
      ], { duration: 280, fill: 'forwards' });
    }
    Chat.chats = Chat.chats.filter(c => c !== chat);
    if (Chat.open === chat) {
      Chat.open = null;
      Chat.messages = [];
      rememberChat(null);
      drawChatHead();
      drawChatList();
      await Motion.leave(document.getElementById('chat-log')?.children || [], 200);
      if (!Chat.open) drawChat({ intro: true });
      return;
    }
    drawChatList();
  });
}

// ── Drawing the conversation ─────────────────────────────────
// The whole log is built only when a chat is opened, when its history
// arrives, and for a new chat. Everything else adds to it or updates one
// message, so nothing already on screen replays its entrance.
function drawChat({ intro = false } = {}) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const chat = Chat.open;
  if (chat?.loadError && !chat.messages) {
    log.innerHTML = `<div class="chat-load-error" role="alert">
      <p>This chat could not be loaded.</p>
      <button class="btn btn-ghost btn-sm chat-reload" type="button">Try again</button></div>`;
  } else if ((!Chat.listReady && !chat) || (chat && !chat.messages)) {
    log.innerHTML = chatSkeletonHtml();
  } else if (!Chat.messages.length) {
    log.innerHTML = chatWelcomeHtml();
    // The welcome reads from the top, however tall it is.
    log.scrollTop = 0;
    // The figures start counting as the chart around them finishes fading in.
    log.querySelectorAll('[data-count]').forEach(el => Motion.countUp(el, { delay: 280 }));
  } else {
    log.replaceChildren(...Chat.messages.map(chatMessageEl));
    if (intro) {
      // The last few — the ones in view — settle in one after another.
      Chat.messages.slice(-6).forEach((m, k) => {
        m.el.classList.add('enter');
        m.el.style.setProperty('--d', `${k * 50}ms`);
      });
    }
  }
  log.setAttribute('aria-busy', String(Chat.busy));
  updateComposer();
  checkJump();
}

function chatMessageEl(m) {
  const el = document.createElement('div');
  if (m.role === 'user') {
    el.className = 'chat-msg user';
    el.innerHTML = `<div class="chat-bubble">${esc(m.content)}</div>`;
  } else {
    el.className = `chat-msg bot${m.error ? ' error' : ''}${m.live ? ' live' : ''}`;
    el.innerHTML = `<div class="chat-avatar" aria-hidden="true">✦</div><div class="chat-bubble md"></div>`;
    const bubble = el.querySelector('.chat-bubble');
    bubble.innerHTML = chatBotBody(m);
    placeCaret(bubble, m);
  }
  m.el = el;
  return el;
}

// What the line beside the typing dots says while an answer is on its way.
// Only a question about money says it is looking at the user's figures — and
// then at the ones the question is about. "Hi" or "What's your name?" is just
// being thought about.
const THINKING_TOPICS = [
  [/\b(cut|spend|expens|cost|subscri|bill|cheaper|reduce)|hemat|pengeluaran|biaya|langganan|مصروف|مصاريف|نفق|اشتراك|فاتور/,
    'Going through your expenses…'],
  [/\b(last|until|payday|run out|runs out|cover|coming up|next week|next month|this month|short)|cukup|gajian|يكفي|راتبي القادم/,
    'Checking what’s coming up…'],
  [/\b(sav|goal|plan|afford|buy|target|emergency|holiday|trip|cars?\b|house|home)|tabung|nabung|beli|rencana|ادخار|توفير|هدف|خطة|شراء|سيارة|بيت/,
    'Working out a plan…'],
  [/\bbudget|anggaran|ميزانية/, 'Sketching out a budget…'],
  [/\b(income|salary|earn|raise|paid)|gaji|pendapatan|pemasukan|راتب|دخل/, 'Looking at your income…'],
  [/\b(debt|loan|credit|owe|interest|repay)|utang|hutang|cicil|pinjam|kredit|دين|قرض|قسط/, 'Looking at what you owe…'],
  [/\b(balance|bank|account)|saldo|rekening|رصيد|حساب|بنك/, 'Checking your balances…'],
];
const MONEY_WORDS = /\b(money|cash|financ|price|worth|invest|doing|picture|shape|situation|overview)|\d|[$€£¥₹]|\brp\b|uang|duit|keuangan|kondisi|مال|فلوس|نقود|وضع/;

function thinkingSteps(text) {
  const t = String(text).toLowerCase();
  const topics = THINKING_TOPICS.filter(([re]) => re.test(t)).map(([, line]) => line);
  if (!topics.length && !MONEY_WORDS.test(t)) return ['Thinking…', 'Writing a reply…'];
  return [...(topics.length ? topics.slice(0, 2) : ['Looking at your numbers…']),
          'Running the numbers…', 'Writing a reply…'];
}

function chatBotBody(m) {
  const text = m.live ? revealedText(m) : m.content;
  if (!text && !m.error) {
    return `<div class="chat-typing" role="status"><span class="chat-dots"><i></i><i></i><i></i></span>` +
      `<em class="chat-status">${esc(m.status || 'Thinking…')}</em></div>`;
  }
  let html = text ? ChatMarkdown.render(text) : '';
  if (m.error && !m.live) {
    html += `<div class="chat-error"><span>${esc(m.error)}</span>` +
      (m.retry ? `<button class="btn btn-ghost btn-sm chat-retry" type="button">Try again</button>` : '') +
      `</div>`;
  }
  return html;
}

// What of a streaming answer to show right now. Unfinished Markdown is tidied
// so it never flashes on screen: an open **bold** or `code` is closed early,
// and a line holding nothing yet but a list, heading or table marker waits
// until it has words in it.
function revealedText(m) {
  let s = m.content.slice(0, m.shown || 0);
  s = s.replace(/(^|\n)[ \t]*[#>*+\-|\d.)]{1,4}[ \t]*$/, '$1');
  if ((s.match(/\*\*/g) || []).length % 2) s += '**';
  if ((s.match(/`/g) || []).length % 2) s += '`';
  return s;
}

// A pulsing dot after the last word, while the answer is still coming.
function placeCaret(bubble, m) {
  bubble.querySelector('.chat-caret')?.remove();
  if (!m.live || !bubble.querySelector('p, li, h3, h4, td, th, pre')) return;
  const blocks = bubble.querySelectorAll('p, li, h3, h4, td, th, pre');
  const caret = document.createElement('span');
  caret.className = 'chat-caret';
  caret.setAttribute('aria-hidden', 'true');
  blocks[blocks.length - 1].appendChild(caret);
}

function chatSkeletonHtml() {
  return `<div class="chat-skeleton" aria-label="Loading your conversation">
    <div class="sk-row user"><span class="sk" style="width:44%"></span></div>
    <div class="sk-row bot"><span class="sk-dot"></span>
      <div class="sk-lines"><span class="sk" style="width:94%"></span><span class="sk" style="width:80%"></span>
        <span class="sk" style="width:56%"></span></div></div>
    <div class="sk-row user"><span class="sk" style="width:32%"></span></div>
  </div>`;
}

function chatWelcomeHtml() {
  const accounts = App.balances || [];
  const inc = activeIncomes(), exp = activeExpenses();
  const balance = balancesTotal();
  const inMonth  = inc.reduce((s, i) => s + monthlyCost(i), 0);
  const outMonth = exp.reduce((s, e) => s + monthlyCost(e), 0);
  const most = Math.max(inMonth, outMonth, 1);
  const money = v => `<span data-count="${Math.round(v)}">${UI.currency(v)}</span>`;
  const bar = (kind, label, v, n, noun) => `
    <div class="snap-row">
      <span class="snap-label">${label}</span>
      <span class="snap-bar"><i class="${kind}" style="--w:${(v / most) * 100}%"></i></span>
      <span class="snap-val">${n ? `${money(v)}<small>/mo</small>` : `<em>No ${noun} yet</em>`}</span>
    </div>`;
  const spent = Chat.remaining === 0 ? ' spent' : '';

  // --k orders the entrance: each piece rises a beat after the one before.
  let k = 0;
  const next = () => `style="--k:${k++}"`;
  return `
    <div class="chat-welcome">
      <div class="chat-welcome-icon" aria-hidden="true" ${next()}>✦</div>
      <h2 ${next()}>Your money, talked through</h2>
      <p ${next()}>I can see what's in your accounts, what comes in and what goes out. Tell me what you're
        aiming for and I'll work out how to get there — or start with one of these.</p>
      <div class="chat-snapshot" ${next()} aria-label="What the assistant can see">
        <div class="snap-row snap-balance">
          <span class="snap-label">In the bank</span>
          <span class="snap-meta">${accounts.length
            ? `across ${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}` : 'no accounts added'}</span>
          <span class="snap-val">${accounts.length ? money(balance) : '—'}</span>
        </div>
        ${bar('in', 'Coming in', inMonth, inc.length, 'income')}
        ${bar('out', 'Going out', outMonth, exp.length, 'expenses')}
      </div>
      <div class="chat-suggest">
        ${ASSISTANT_STARTERS.map(q =>
          `<button class="chat-chip${spent}" type="button" data-ask="${esc(q)}" ${next()}>${esc(q)}</button>`).join('')}
      </div>
      <p class="chat-privacy" ${next()}>Don’t share your real bank details in this chat or any AI chat, for your
        security.</p>
    </div>`;
}

// Redraws one answer in place: morphed rather than replaced, so a streaming
// answer only ever adds to what is already on screen.
function paintChatMessage(m) {
  const el = m.el;
  if (!el?.isConnected) return;
  el.classList.toggle('error', !!m.error && !m.live);
  el.classList.toggle('live', !!m.live);
  const bubble = el.querySelector('.chat-bubble');
  morphInto(bubble, chatBotBody(m));
  placeCaret(bubble, m);
}

function scrollChat() {
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

// Keeps a growing answer in view without chasing its last line: the log scrolls
// down as the answer arrives until the question reaches the top, and stops
// there, so a long answer is read from its beginning while the rest streams in.
// Scrolling by hand at any point hands control back to the reader.
function followAnswer(answer) {
  const question = answer.question?.el;
  if (!Chat.follow || !question?.isConnected) return;
  const log = document.getElementById('chat-log');
  const target = Math.min(log.scrollHeight - log.clientHeight, question.offsetTop - 12);
  if (target > log.scrollTop) log.scrollTop = target;
}

// ── Letting the answer out ───────────────────────────────────
// Streamed text arrives in bursts. It is let out at a steady pace instead —
// faster when a lot is waiting — so the answer reads as it flows rather than
// jumping a sentence at a time.
function revealAnswer(m) {
  if (m.revealing) return;
  // No one is watching a background tab, and it gets no animation frames, so
  // the text goes straight in rather than waiting there to be let out.
  if (Motion.reduced || document.hidden) {
    m.shown = m.content.length;
    paintChatMessage(m);
    followAnswer(m);
    return;
  }
  m.revealing = true;
  let last = performance.now();
  const tick = now => {
    const dt = Math.min(64, now - last);
    last = now;
    const waiting = m.content.length - (m.shown || 0);
    if (waiting > 0) {
      // Whatever has arrived drains over about a third of a second, and more
      // quickly once the whole answer is in.
      const span = m.streaming ? 340 : 150;
      m.shown = Math.min(m.content.length, (m.shown || 0) + Math.max(1, Math.round(waiting * dt / span)));
      paintChatMessage(m);
      followAnswer(m);
    }
    if (m.shown < m.content.length || m.streaming) { requestAnimationFrame(tick); return; }
    m.revealing = false;
    settleAnswer(m);
  };
  requestAnimationFrame(tick);
}

// The answer is complete and fully shown: drop the live styling, and show any
// error that came with it.
function settleAnswer(m) {
  m.live = false;
  m.shown = m.content.length;
  paintChatMessage(m);
  followAnswer(m);
}

// ── Asking ───────────────────────────────────────────────────
// A new chat's name, the moment its first question is asked — the same one
// the server gives it (titleFrom in supabase/functions/ai-chat/index.ts).
function chatTitleFrom(question) {
  const weak = t => t.trim().split(/\s+/).filter(Boolean).length < 3 && t.length < 16;
  const flat = String(question).replace(/\s+/g, ' ').trim();
  const cut = flat.search(/[.?!](\s|$)|\s[—–-]\s/);
  const first = cut > 0 ? flat.slice(0, cut + (flat[cut] === '?' ? 1 : 0)) : flat;
  let title = (weak(first) ? flat : first).replace(/[\s.,;:!—–-]+$/, '');
  if (title.length > 60) title = title.slice(0, 60).replace(/\s+\S*$/, '').replace(/[\s.,;:!—–-]+$/, '') + '…';
  return title || 'New chat';
}

// `from` is where on screen the question came from — the chip that was tapped,
// or the box it was typed in — so it can be seen to travel into the chat.
async function sendChat(text, from) {
  text = String(text || '').trim();
  if (!text || Chat.busy) return;
  if (text.length > ASSISTANT_MAX_QUESTION) {
    UI.toast(`Keep a question under ${ASSISTANT_MAX_QUESTION.toLocaleString('en-US')} characters.`, 'error');
    return;
  }
  if (Chat.remaining === 0) { UI.toast(esc(outOfMessages()), 'info', 5000); return; }

  Chat.busy = true;
  updateComposer();
  // Whatever opens on arrival is on screen first, so this question lands in it
  // rather than being swept away when it loads.
  await startAssistant();
  if (Chat.open && !Chat.open.messages) await loadChatMessages(Chat.open);
  if (Chat.open?.loadError) {
    Chat.busy = false;
    updateComposer();
    UI.toast('This chat could not be loaded, so your question was not sent.', 'error');
    return;
  }

  // A new chat joins the list with its first question; an existing one moves
  // to the top of it.
  let chat = Chat.open;
  const now = new Date().toISOString();
  if (!chat) {
    chat = { key: `new-${Date.now()}`, id: null, title: chatTitleFrom(text), named: false, pinned: false,
             created_at: now, updated_at: now, messages: [] };
    Chat.chats.push(chat);
    Chat.open = chat;
    Chat.messages = chat.messages;
  }
  chat.updated_at = now;
  Chat.streaming = chat;
  drawChatList();
  drawChatHead();
  const onScreen = () => Chat.open === chat;

  const log = document.getElementById('chat-log');
  const welcome = log.querySelector('.chat-welcome');
  if (welcome) {
    await Motion.leave([welcome], 220);
    if (onScreen()) log.replaceChildren();
  }

  const steps = thinkingSteps(text);
  const question = { role: 'user', content: text };
  const answer = { role: 'assistant', content: '', shown: 0, pending: true, live: true, streaming: true, question,
                   status: steps[0] };
  chat.messages.push(question, answer);
  if (onScreen()) {
    const qEl = chatMessageEl(question);
    const aEl = chatMessageEl(answer);
    if (!from || Motion.reduced) qEl.classList.add('enter');
    aEl.classList.add('enter');
    aEl.style.setProperty('--d', '160ms');
    log.append(qEl, aEl);
    log.setAttribute('aria-busy', 'true');
    Chat.follow = true;
    scrollChat();
    Motion.flyFrom(qEl.querySelector('.chat-bubble'), from);
  }
  // The server takes the message as the question arrives; the count shows it
  // straight away, and is put right from the server if no answer comes.
  if (Chat.remaining > 0) Chat.remaining--;
  updateComposer();

  // While waiting, the status line moves on every couple of seconds, so a
  // slow answer never looks like a stuck one.
  const asked = Date.now();
  let step = 0;
  const status = setInterval(() => {
    if (!answer.live || answer.shown) return;
    step++;
    const next = Date.now() - asked > 14000
      ? 'Taking a little longer than usual — hang on…'
      : steps[Math.min(step, steps.length - 1)];
    const el = answer.el?.querySelector('.chat-status');
    answer.status = next;
    if (!el || el.textContent === next) return;
    el.textContent = next;
    Motion.play(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 340 });
  }, 2400);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASSISTANT_TIMEOUT_MS);

  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw chatError('auth', 'Your session has expired — sign in again.');

    const res = await fetch(ASSISTANT_URL, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ message: text, context: AssistantContext.build(), chat: chat.id }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw chatError(j.code || 'http', j.message || `The assistant could not answer (error ${res.status}).`,
        { limit: j.limit, resetsAt: j.resets_at });
    }

    await readChatStream(res.body, ev => {
      if (ev.type === 'delta') {
        answer.content += ev.text;
        answer.pending = false;
        revealAnswer(answer);
      } else if (ev.type === 'done') {
        if (typeof ev.limit === 'number') Chat.limit = ev.limit;
        if (typeof ev.remaining === 'number') Chat.remaining = ev.remaining;
        if (ev.chat) chatSaved(chat, ev.chat);
      } else if (ev.type === 'error') {
        throw chatError(ev.code, ev.message);
      }
    });
    if (!answer.content.trim()) throw chatError('empty', 'The assistant came back with nothing. Try again.');
  } catch (err) {
    answer.error = err.name === 'AbortError'
      ? 'That took too long to answer. Try again.'
      : (err.message && err.code ? err.message : 'Could not reach the assistant. Check your connection and try again.');
    if (err.code === 'daily_limit') {
      if (typeof err.limit === 'number') Chat.limit = err.limit;
      if (err.resetsAt) Chat.resetsAt = new Date(err.resetsAt);
      Chat.remaining = 0;
      answer.error = outOfMessages();
      scheduleAllowanceReset();
    } else {
      // No answer, so no message spent: the server has given it back.
      if (Chat.remaining !== null) Chat.remaining = Math.min(Chat.limit, Chat.remaining + 1);
      loadAllowance();
    }
    if (err.code === 'chat_gone') {
      // Deleted on another device: what is on screen stays, as a chat that
      // was never saved.
      chat.id = null;
    }
    // Nothing is stored for a question that failed, so it can simply be asked
    // again — except once the day's messages are used up.
    if (!['daily_limit', 'not_configured', 'chat_gone'].includes(err.code)) answer.retry = text;
  } finally {
    clearTimeout(timer);
    clearInterval(status);
    answer.pending = false;
    answer.streaming = false;
    Chat.busy = false;
    Chat.streaming = null;
    // A first question that got no answer, in a chat no longer on screen,
    // leaves nothing behind.
    if (!chat.id && !onScreen()) Chat.chats = Chat.chats.filter(c => c !== chat);
    drawChatList();
    drawChatHead();
    updateComposer();
    document.getElementById('chat-log')?.setAttribute('aria-busy', 'false');
    // Still letting text out? It settles itself when it catches up.
    if (!answer.revealing) settleAnswer(answer);
  }
}

// The server has saved the exchange: the chat takes its id and its name, and
// is flagged if the answer arrived while another chat was being read.
function chatSaved(chat, row) {
  Object.assign(chat, {
    id: row.id, title: row.title, named: row.named, pinned: row.pinned,
    created_at: row.created_at, updated_at: row.updated_at,
  });
  if (Chat.open === chat) rememberChat(chat.id);
  else chat.unread = true;
}

function chatError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  return Object.assign(err, extra);
}

// Server-sent events: one JSON object per `data:` line, blank line between.
async function readChatStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = block => {
    const line = block.split('\n').find(l => l.startsWith('data:'));
    if (!line) return;
    let ev;
    try { ev = JSON.parse(line.slice(5)); } catch (_) { return; }
    onEvent(ev);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        take(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
      }
    }
    if (buffer.trim()) take(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
}

// Drops the failed exchange and asks the same question again.
async function retryChat(failed) {
  if (!failed?.retry || Chat.busy) return;
  const i = Chat.messages.indexOf(failed);
  const pair = Chat.messages.splice(i - 1, 2);
  await Motion.leave(pair.map(m => m.el).filter(Boolean), 180);
  pair.forEach(m => m.el?.remove());
  sendChat(failed.retry);
}
