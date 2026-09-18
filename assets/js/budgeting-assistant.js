// ============================================================
// MrWiseMax — Assistant
// ============================================================
// A chat page that already knows the user's money. Everything it is told about
// their finances is worked out here, by the same code that draws the Overview,
// so the assistant quotes exactly the figures on screen. The server half
// (supabase/functions/ai-chat) holds the Gemini key, keeps the conversation,
// and streams each answer back as it is written.

// The function is pinned to the database's region: every question reads and
// writes the conversation there, and Gemini is available from it.
const ASSISTANT_URL = `${SUPABASE_URL}/functions/v1/ai-chat?forceFunctionRegion=us-east-1`;
const ASSISTANT_MAX_QUESTION = 2000;
const ASSISTANT_TIMEOUT_MS = 120000;

const Chat = {
  wired: false,
  loaded: false,
  loading: null,
  // { role: 'user' | 'assistant', content, el?, and while an answer streams:
  //   pending, live, streaming, shown, question; error and retry if it failed }
  messages: [],
  busy: false,
  remaining: null,
  // Whether a streaming answer may still scroll the log (see followAnswer).
  follow: false,
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
  if (!Chat.loaded) loadChat();
  drawChat();
  // Put the cursor in the box on a wide screen; on a phone that would throw
  // the keyboard up over the page before anyone asked for it.
  if (!isNarrow()) setTimeout(() => document.getElementById('chat-input')?.focus(), 60);
}

async function loadChat() {
  if (Chat.loading) return Chat.loading;
  Chat.loading = (async () => {
    try {
      const { data, error } = await db.from('ai_chat_messages')
        .select('role,content,created_at')
        .eq('user_id', App.user.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      Chat.messages = (data || []).reverse().map(m => ({ role: m.role, content: m.content }));
    } catch (e) {
      // Not fatal: the assistant still works, it just opens on a fresh page.
      console.warn('[Assistant] could not load the conversation:', e.message);
    }
    Chat.loaded = true;
    const log = document.getElementById('chat-log');
    await Motion.leave(log?.querySelectorAll('.chat-skeleton') || [], 160);
    drawChat({ intro: true });
    if (Chat.messages.length) scrollChat();
  })();
  return Chat.loading;
}

function wireAssistant() {
  if (Chat.wired) return;
  Chat.wired = true;

  const form  = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log   = document.getElementById('chat-log');
  const send  = document.getElementById('chat-send');

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
    if (!text || Chat.busy) return;
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
      starter.classList.add('picked');
      sendChat(starter.dataset.ask, starter.getBoundingClientRect());
      return;
    }
    const retry = e.target.closest('.chat-retry');
    if (retry) retryChat(Chat.messages.find(m => m.el === retry.closest('.chat-msg')));
  });

  document.getElementById('chat-new')?.addEventListener('click', resetChat);
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
  if (send && input) send.disabled = Chat.busy || !input.value.trim();
  document.getElementById('chat-form')?.classList.toggle('busy', Chat.busy);
  const reset = document.getElementById('chat-new');
  if (reset) reset.hidden = !Chat.messages.length;
  if (reset) reset.disabled = Chat.busy;

  const foot = document.getElementById('chat-foot');
  if (foot) {
    const left = Chat.remaining;
    foot.textContent = 'Gemini can make mistakes. Treat answers as guidance, not professional financial advice.' +
      (left !== null && left <= 5 ? ` ${left} ${left === 1 ? 'question' : 'questions'} left today.` : '');
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

// ── Drawing the conversation ─────────────────────────────────
// The whole log is built only when the page is opened, when the history
// arrives, and after a new chat. Everything else adds to it or updates one
// message, so nothing already on screen replays its entrance.
function drawChat({ intro = false } = {}) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  if (!Chat.loaded && !Chat.messages.length) {
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

const THINKING = [
  'Looking at your numbers…',
  'Checking what’s coming up…',
  'Weighing up the options…',
  'Putting it into words…',
];

function chatBotBody(m) {
  const text = m.live ? revealedText(m) : m.content;
  if (!text && !m.error) {
    return `<div class="chat-typing" role="status"><span class="chat-dots"><i></i><i></i><i></i></span>` +
      `<em class="chat-status">${esc(m.status || THINKING[0])}</em></div>`;
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
          `<button class="chat-chip" type="button" data-ask="${esc(q)}" ${next()}>${esc(q)}</button>`).join('')}
      </div>
      <p class="chat-privacy" ${next()}>To answer, your figures and questions are sent to Google Gemini.
        Never type passwords or card numbers here.</p>
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
// `from` is where on screen the question came from — the chip that was tapped,
// or the box it was typed in — so it can be seen to travel into the chat.
async function sendChat(text, from) {
  text = String(text || '').trim();
  if (!text || Chat.busy) return;
  if (text.length > ASSISTANT_MAX_QUESTION) {
    UI.toast(`Keep a question under ${ASSISTANT_MAX_QUESTION.toLocaleString('en-US')} characters.`, 'error');
    return;
  }

  Chat.busy = true;
  updateComposer();
  // The earlier conversation goes on screen first, so this question lands
  // after it rather than being swept away when it arrives.
  if (!Chat.loaded) await loadChat();

  const log = document.getElementById('chat-log');
  const welcome = log.querySelector('.chat-welcome');
  if (welcome) {
    await Motion.leave([welcome], 220);
    log.replaceChildren();
  }

  const question = { role: 'user', content: text };
  const answer = { role: 'assistant', content: '', shown: 0, pending: true, live: true, streaming: true, question };
  Chat.messages.push(question, answer);
  const qEl = chatMessageEl(question);
  const aEl = chatMessageEl(answer);
  if (!from || Motion.reduced) qEl.classList.add('enter');
  aEl.classList.add('enter');
  aEl.style.setProperty('--d', '160ms');
  log.append(qEl, aEl);
  log.setAttribute('aria-busy', 'true');
  Chat.follow = true;
  updateComposer();
  scrollChat();
  Motion.flyFrom(qEl.querySelector('.chat-bubble'), from);

  // While waiting, the status line moves on every couple of seconds, so a
  // slow answer never looks like a stuck one.
  const asked = Date.now();
  let step = 0;
  const status = setInterval(() => {
    if (!answer.live || answer.shown) return;
    step++;
    const next = Date.now() - asked > 14000
      ? 'Taking a little longer than usual — hang on…'
      : THINKING[Math.min(step, THINKING.length - 1)];
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
      body: JSON.stringify({ message: text, context: AssistantContext.build() }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw chatError(j.code || 'http', j.message || `The assistant could not answer (error ${res.status}).`);
    }

    await readChatStream(res.body, ev => {
      if (ev.type === 'delta') {
        answer.content += ev.text;
        answer.pending = false;
        revealAnswer(answer);
      } else if (ev.type === 'done') {
        if (typeof ev.remaining === 'number') Chat.remaining = ev.remaining;
      } else if (ev.type === 'error') {
        throw chatError(ev.code, ev.message);
      }
    });
    if (!answer.content.trim()) throw chatError('empty', 'The assistant came back with nothing. Try again.');
  } catch (err) {
    answer.error = err.name === 'AbortError'
      ? 'That took too long to answer. Try again.'
      : (err.message && err.code ? err.message : 'Could not reach the assistant. Check your connection and try again.');
    // Nothing is stored for a question that failed, so it can simply be asked
    // again — except once the daily allowance is used up.
    if (err.code !== 'daily_limit' && err.code !== 'not_configured') answer.retry = text;
    if (err.code === 'daily_limit') Chat.remaining = 0;
  } finally {
    clearTimeout(timer);
    clearInterval(status);
    answer.pending = false;
    answer.streaming = false;
    Chat.busy = false;
    updateComposer();
    document.getElementById('chat-log')?.setAttribute('aria-busy', 'false');
    // Still letting text out? It settles itself when it catches up.
    if (!answer.revealing) settleAnswer(answer);
  }
}

function chatError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
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

function resetChat() {
  if (Chat.busy || !Chat.messages.length) return;
  UI.confirm('Start a new conversation? This one will be deleted.', async () => {
    const { error } = await db.from('ai_chat_messages').delete().eq('user_id', App.user.id);
    if (error) { UI.toast(error.message, 'error'); return; }
    await Motion.leave(document.getElementById('chat-log')?.children || [], 220);
    Chat.messages = [];
    drawChat();
    document.getElementById('chat-input')?.focus();
  });
}
