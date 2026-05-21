// ============================================================
// NavHistory — SPA back-button navigation for MrWiseMax
// ============================================================
// Stamps each section visit into the browser's History API so
// the native back button steps through in-app sections instead
// of leaving the page.
//
// Usage (one-time setup per page):
//   NavHistory.init(initialSection, navigateFn)
//
// Usage (on every programmatic navigation):
//   NavHistory.push(section)

const NavHistory = (() => {
  let navigateFn   = null;
  let currentSection = null;
  let handlingPop  = false;
  let ready        = false;

  function init(initialSection, onNavigate) {
    navigateFn     = onNavigate;
    currentSection = initialSection;
    ready          = true;

    // Stamp the current history entry so we can recognise it on popstate.
    // replaceState (not pushState) so the user's pre-app back history is untouched.
    history.replaceState({ navSection: initialSection }, '');

    window.addEventListener('popstate', (e) => {
      // Ignore history entries that don't belong to this app's session
      if (!e.state || !e.state.navSection) return;

      handlingPop    = true;
      currentSection = e.state.navSection;
      navigateFn(e.state.navSection);
      handlingPop    = false;
    });
  }

  // Call on every navigation. No-op when:
  //   • init hasn't been called yet (safe to call before init)
  //   • we're inside a popstate handler (prevents double-push)
  //   • the destination is already the current section (no duplicate entries)
  function push(section) {
    if (!ready || handlingPop || section === currentSection) return;
    currentSection = section;
    history.pushState({ navSection: section }, '');
  }

  return { init, push };
})();
