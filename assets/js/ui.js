// ============================================================
// MrWiseMax — UI Utilities
// ============================================================

const UI = (() => {

  // ── Toast Notifications ──────────────────────────────────
  function toast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    t.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(t);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => t.classList.add('toast-show'));
    });
    setTimeout(() => {
      t.classList.remove('toast-show');
      setTimeout(() => t.remove(), 400);
    }, duration);
  }

  // ── Modal System ─────────────────────────────────────────
  // Opening and closing are the same single class toggle; the fade in both
  // directions is a CSS transition, so the browser owns the timing. An
  // earlier version timed the fade-out with setTimeout, which browsers are
  // free to throttle — the modal would sometimes snap away instead.
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('modal-open');
    modal.removeAttribute('aria-hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal || !modal.classList.contains('modal-open')) return;
    modal.classList.remove('modal-open');
    modal.setAttribute('aria-hidden', 'true');
    releaseScrollLock();
  }

  function closeAllModals() {
    document.querySelectorAll('.modal.modal-open').forEach(m => closeModal(m.id));
    releaseScrollLock();
  }

  // Every modal starts shut.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal:not(.modal-open)')
      .forEach(m => m.setAttribute('aria-hidden', 'true'));
  });

  // Only give the page its scrollbar back once nothing is still open —
  // the confirm dialog stacks on top of other modals.
  function releaseScrollLock() {
    if (!document.querySelector('.modal.modal-open')) document.body.style.overflow = '';
  }

  // ── Dismissing a modal ───────────────────────────────────
  // A click closes only when the press *and* the release both landed on the
  // backdrop, so dragging from inside the box and letting go outside it —
  // selecting text in a field, say — never dismisses.
  let pressedOn = null;
  document.addEventListener('pointerdown', e => { pressedOn = e.target; }, true);

  document.addEventListener('click', e => {
    const modal = e.target.closest?.('.modal.modal-open');
    if (!modal || e.target !== modal || pressedOn !== modal) return;
    closeModal(modal.id);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal.modal-open')].pop();
    if (open) closeModal(open.id);
  });

  // ── Confirm Dialog ───────────────────────────────────────
  function confirm(message, onConfirm, danger = true) {
    const msgEl = document.getElementById('confirm-message');
    const btn   = document.getElementById('confirm-ok-btn');
    if (!msgEl || !btn) return;
    msgEl.textContent = message;
    btn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    btn.onclick = () => { closeModal('confirm-modal'); onConfirm(); };
    openModal('confirm-modal');
  }

  // ── Loading State ────────────────────────────────────────
  function setLoading(el, loading) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    if (loading) {
      el.dataset.originalHtml = el.innerHTML;
      el.innerHTML = '<span class="spinner"></span>';
      el.disabled = true;
    } else {
      el.innerHTML = el.dataset.originalHtml || el.innerHTML;
      el.disabled = false;
    }
  }

  // ── Section Navigation ───────────────────────────────────
  function showSection(sectionId) {
    document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`section-${sectionId}`);
    if (target) target.classList.add('active');
  }

  // ── Format Utilities ─────────────────────────────────────
  // Whole units only — no trailing ".00" anywhere in the app. Display is
  // rounded to the nearest unit; the stored amount keeps its full precision.
  // The sign comes from the rounded value so we render "-$5", not "$-5".
  function currency(amount, symbol = '$') {
    const rounded = Math.round(parseFloat(amount) || 0);
    const digits  = Math.abs(rounded).toLocaleString('en-US', { maximumFractionDigits: 0 });
    return (rounded < 0 ? '-' : '') + symbol + digits;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    toast, openModal, closeModal, closeAllModals, confirm,
    setLoading, showSection, currency, formatDate,
  };
})();
