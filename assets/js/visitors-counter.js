// ============================================================
// MrWiseMax — Visitors Counter
// ============================================================
// Counts every page load on mrwisemax.com. A refresh by the same
// person counts again — this is a raw page-view counter, not a
// unique-visitor counter.
//
// Calls the increment_visitor() RPC, which adds 1 to the cell for
// the current (UTC) month in public.visitors_counter and returns
// the new total. The table itself is read-only to the anon key,
// so a visitor can add +1 but cannot set an arbitrary value.
//
// Standalone by design: no supabase-js dependency, so it can run
// on the landing page without pulling in the whole SDK.
// Drop <script src="assets/js/visitors-counter.js"></script>
// before </body> on any page that should be counted.
// ============================================================

(function () {
  'use strict';

  // Mirrors assets/js/supabase.js — kept inline so this file has no load-order
  // dependency and works on pages that don't load the Supabase SDK.
  const SUPABASE_URL      = 'https://ezfzlwaeymmvmazvozyx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6Znpsd2FleW1tdm1henZvenl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjI4NDksImV4cCI6MjA5NDIzODg0OX0.pXIJFXEp_AHkVblHycRh_ER_ti0iOGYPQN0dcVp6iZk';

  function countVisit() {
    // keepalive lets the request finish even if the visitor navigates
    // away immediately after landing.
    fetch(SUPABASE_URL + '/rest/v1/rpc/increment_visitor', {
      method:  'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type':  'application/json',
      },
      body:      '{}',
      keepalive: true,
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(total => console.log('[Visitors] Counted this visit. Month total:', total))
      .catch(err  => console.warn('[Visitors] Could not count this visit:', err.message));
  }

  countVisit();
})();
