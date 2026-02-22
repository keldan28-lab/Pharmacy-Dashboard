// ------------------------------------------------------------------------------------
// TRANSACTIONS MANIFEST (STATIC HTML)
//
// Add new daily or monthly transaction files here.
// The dashboard will load every script in this list BEFORE it builds the compute store.
//
// Supported global formats (defined by your transaction mockdata files):
//   - TRANSACTION_YYYY_MM      (monthly)
//   - TRANSACTION_YYYY_MM_DD   (daily)
//   - ITEM_TRANSACTION         (legacy)
//
// Example (daily):
//   'transaction_2026_01_19_mockdata.js'
//
// NOTE: Keep paths relative to the HTML file that loads this manifest.
//
// 💡 Editing tip (avoid commas):
//   Put one filename per line in TRANSACTION_SCRIPTS_RAW. No commas needed.
// ------------------------------------------------------------------------------------

(function initTransactionManifest() {
  // If something else already set the scripts array, keep it.
  if (Array.isArray(window.TRANSACTION_SCRIPTS) && window.TRANSACTION_SCRIPTS.length) return;

  // ✅ Edit this list: ONE filename per line (commas optional)
  const TRANSACTION_SCRIPTS_RAW = `
transaction_2026_01_mockdata.js
`;

  window.TRANSACTION_SCRIPTS = TRANSACTION_SCRIPTS_RAW
    .split(/[\r\n,]+/g)
    .map(s => String(s || '').trim())
    .filter(Boolean);
})();
