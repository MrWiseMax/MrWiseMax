// ============================================================
// NavHistory — SPA back-button exit guard for MrWiseMax
// ============================================================
// Drop-in for any page. On back press the page stays exactly
// as-is (no URL change, no view change). The user sees a
// "Tap again to exit" toast; a second press within 2.5 s
// lets the browser navigate away normally.
//
// Also intercepts back when a modal is open: closes the modal
// first, then resets the guard for the next press.
//
// How the two-entry stack works:
//   history: [...prev_pages, {sentinel}, {guard}]   ← guard is current
//   Back press → arrive at {sentinel} → show toast, push {guard} back
//   Back press again (within 2.5 s) → arrive at {sentinel} → exit
//
// Usage (one-time setup per page):
//   NavHistory.init()
//
// No other calls needed — push() is kept as a no-op so
// existing call sites don't break.

const NavHistory = (() => {
  let pendingExit        = false;
  let exitTimer          = null;
  let handlingPop        = false;
  let handlingModalClose = false;
  let hasModalInHistory  = false;

  // ── Exit Toast ──────────────────────────────────────────────
  function showExitToast() {
    document.getElementById('nav-exit-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'nav-exit-toast';
    toast.textContent = 'Tap again to exit';
    Object.assign(toast.style, {
      position:      'fixed',
      bottom:        'calc(80px + env(safe-area-inset-bottom, 0px))',
      left:          '50%',
      transform:     'translateX(-50%)',
      background:    'rgba(24, 24, 28, 0.93)',
      color:         '#fff',
      padding:       '10px 24px',
      borderRadius:  '999px',
      fontSize:      '0.875rem',
      fontWeight:    '500',
      letterSpacing: '0.01em',
      zIndex:        '99999',
      pointerEvents: 'none',
      opacity:       '0',
      transition:    'opacity 0.18s ease',
      whiteSpace:    'nowrap',
      boxShadow:     '0 4px 20px rgba(0,0,0,0.35)',
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => { toast.style.opacity = '1'; }));

    clearTimeout(exitTimer);
    exitTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
      pendingExit = false;
    }, 2500);
  }

  // ── Modal Tracking via MutationObserver ─────────────────────
  // Watches .modal elements for modal-open class changes so the
  // back button closes an open modal before triggering the exit guard.
  function initModalObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;
        const el = mutation.target;
        if (!el.classList.contains('modal')) continue;

        const prevClasses = (mutation.oldValue || '').split(/\s+/);
        const wasOpen = prevClasses.includes('modal-open');
        const isOpen  = el.classList.contains('modal-open');

        if (isOpen && !wasOpen && !handlingPop && !handlingModalClose) {
          // Modal opened → push a modal entry on top of the guard
          hasModalInHistory = true;
          history.pushState({ navType: 'modal', navModal: el.id }, '');

        } else if (!isOpen && wasOpen && hasModalInHistory && !handlingPop && !handlingModalClose) {
          // Modal closed by normal UI (not back button) → consume modal entry
          hasModalInHistory = false;
          history.back();
        }
      }
    });

    observer.observe(document.body, {
      subtree:           true,
      attributes:        true,
      attributeFilter:   ['class'],
      attributeOldValue: true,
    });
  }

  // ── Popstate Handler ────────────────────────────────────────
  function handlePop(e) {
    if (!e.state || !e.state.navType) return;

    // ① Arrived at guard — came back from a modal entry via back button
    if (e.state.navType === 'guard') {
      if (hasModalInHistory) {
        handlingPop        = true;
        hasModalInHistory  = false;
        handlingModalClose = true;
        if (typeof UI !== 'undefined') UI.closeAllModals();
        handlingModalClose = false;
        handlingPop        = false;
      }
      return;
    }

    // ② Arrived at sentinel — user backed past the guard
    if (e.state.navType === 'sentinel') {
      if (pendingExit) {
        // Second press within the timeout → let the browser navigate away
        clearTimeout(exitTimer);
        document.getElementById('nav-exit-toast')?.remove();
        pendingExit = false;
        history.back();
        return;
      }

      // First press → show toast, restore the guard so the page stays put
      pendingExit = true;
      showExitToast();
      history.pushState({ navType: 'guard' }, '');
    }
  }

  // ── Public API ──────────────────────────────────────────────

  // Call once on DOMContentLoaded (or page load).
  // Works on any page — no arguments needed.
  function init() {
    // Two-entry stack: sentinel anchors the bottom, guard sits on top.
    // Pressing back moves from guard → sentinel, which we catch and handle.
    history.replaceState({ navType: 'sentinel' }, '');
    history.pushState({ navType: 'guard' }, '');
    window.addEventListener('popstate', handlePop);
    initModalObserver();
  }

  // No-op kept for call-site compatibility.
  function push() {}

  return { init, push };
})();
