// ============================================================
// NavHistory — SPA back-button navigation for MrWiseMax
// ============================================================
// • Steps through in-app sections on back (instead of leaving the page)
// • Shows "Tap again to exit" toast when the user backs past all sections
// • Intercepts back on open modals — closes the modal first
//
// Usage (one-time setup per page):
//   NavHistory.init(initialSection, navigateFn)
//
// Usage (on every programmatic section navigation):
//   NavHistory.push(section)

const NavHistory = (() => {
  let navigateFn        = null;
  let currentSection    = null;
  let handlingPop       = false;
  let handlingModalClose= false;
  let ready             = false;

  // "Tap again to exit" state
  let pendingExit = false;
  let exitTimer   = null;

  // Track whether a modal history entry is currently in the stack
  let hasModalInHistory = false;

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
  // Watches for .modal-open additions/removals on .modal elements
  // so back-button modal interception works without touching ui.js.
  function initModalObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;
        const el = mutation.target;

        // Only care about elements that have the base .modal class
        if (!el.classList.contains('modal')) continue;

        const prevClasses = (mutation.oldValue || '').split(/\s+/);
        const wasOpen = prevClasses.includes('modal-open');
        const isOpen  = el.classList.contains('modal-open');

        if (isOpen && !wasOpen && !handlingPop && !handlingModalClose) {
          // Modal just opened — push a modal history entry
          hasModalInHistory = true;
          history.pushState({ navSection: currentSection, navModal: el.id }, '');

        } else if (!isOpen && wasOpen && hasModalInHistory && !handlingPop && !handlingModalClose) {
          // Modal was closed by normal UI (not by back button) — consume the modal entry
          hasModalInHistory = false;
          history.back();
        }
      }
    });

    observer.observe(document.body, {
      subtree:         true,
      attributes:      true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  }

  // ── Popstate Handler ────────────────────────────────────────
  function handlePop(e) {
    if (!e.state) return;

    // ① Exit sentinel — user backed past all app section history
    if (e.state.navSection === '__exit__') {
      if (pendingExit) {
        // Second back within the timeout window → actually leave
        clearTimeout(exitTimer);
        document.getElementById('nav-exit-toast')?.remove();
        pendingExit = false;
        history.back();
        return;
      }
      // First time hitting sentinel → show toast, restore position
      pendingExit = true;
      showExitToast();
      // Push the current section back so the user stays in the app
      history.pushState({ navSection: currentSection }, '');
      return;
    }

    // ② Modal state — close the modal, stay on the current section
    if (e.state.navModal) {
      handlingPop        = true;
      hasModalInHistory  = false;
      handlingModalClose = true;
      if (typeof UI !== 'undefined') UI.closeAllModals();
      handlingModalClose = false;
      handlingPop        = false;
      return;
    }

    // ③ Section state — navigate within the app
    if (e.state.navSection) {
      handlingPop    = true;
      currentSection = e.state.navSection;
      navigateFn(e.state.navSection);
      handlingPop    = false;
    }
  }

  // ── Public API ──────────────────────────────────────────────

  // Call once on page load.
  // Stamps an exit sentinel on the current history entry, then pushes
  // the initial section on top so the first back press goes through
  // sections before hitting the sentinel.
  function init(initialSection, onNavigate) {
    navigateFn     = onNavigate;
    currentSection = initialSection;
    ready          = true;

    history.replaceState({ navSection: '__exit__' }, '');
    history.pushState({ navSection: initialSection }, '');

    window.addEventListener('popstate', handlePop);
    initModalObserver();
  }

  // Call on every programmatic navigation.
  // No-op before init, during popstate handling, or on duplicate sections.
  function push(section) {
    if (!ready || handlingPop || section === currentSection) return;
    currentSection = section;
    history.pushState({ navSection: section }, '');
  }

  return { init, push };
})();
