#!/usr/bin/env node
const fs = require('node:fs');
const vm = require('node:vm');

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const storeSrc = fs.readFileSync('js/data/transactionStore.js', 'utf8');
const loaderSrc = fs.readFileSync('js/data/transactionLoader.js', 'utf8');

const monthPayloads = {
  '2025_10': { A: { history: [{ transDate: '2025-10-02', transQty: -3, transactionType: 'Dispense', location: 'MAIN' }] } },
  '2025_11': { A: { history: [{ transDate: '2025-11-02', transQty: -4, transactionType: 'Dispense', location: 'MAIN' }] } },
  '2025_12': { A: { history: [{ transDate: '2025-12-03', transQty: -5, transactionType: 'Dispense', location: 'MAIN' }] } },
  '2026_01': { A: { history: [{ transDate: '2026-01-04', transQty: -6, transactionType: 'Dispense', location: 'MAIN' }] } },
  '2026_02': { A: { history: [{ transDate: '2026-02-05', transQty: -7, transactionType: 'Dispense', location: 'MAIN' }] } },
  '2026_03': { A: { history: [{ transDate: '2026-03-06', transQty: -8, transactionType: 'Dispense', location: 'MAIN' }] } }
};

const appendedScripts = [];
const context = {
  window: {
    TRANSACTION_SCRIPTS: [
      'transaction_2025_10_mockdata.js',
      'transaction_2025_11_mockdata.js',
      'transaction_2025_12_mockdata.js',
      'transaction_2026_01_mockdata.js',
      'transaction_2026_02_mockdata.js',
      'transaction_2026_03_mockdata.js'
    ],
    InventoryApp: {}
  },
  location: { hostname: 'localhost', protocol: 'http:' },
  console,
  setTimeout,
  clearTimeout,
  document: {
    createElement() { return { onload: null, onerror: null, async: false, src: '' }; },
    head: {
      appendChild(el) {
        appendedScripts.push(el.src);
        const m = String(el.src).match(/transaction_(\d{4})_(\d{2})/);
        if (m) context.window['TRANSACTION_' + m[1] + '_' + m[2]] = monthPayloads[m[1] + '_' + m[2]];
        setTimeout(() => el.onload && el.onload(), 0);
      }
    }
  }
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(storeSrc, context, { filename: 'transactionStore.js' });
vm.runInContext(loaderSrc, context, { filename: 'transactionLoader.js' });

(async () => {
  const dl = context.window.InventoryApp.DataLoader;
  const store = context.window.InventoryApp.TransactionStore;

  assert(dl.parseMonthKeyFromFilename('transaction_2026_01_mockdata.js') === '2026-01', 'parse failed');
  assert(JSON.stringify(dl.listAvailableMonths()) === JSON.stringify(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']), 'months ordering failed');

  const boot = await dl.loadRecentMonths({ count: 2 });
  assert(boot.count === 2, 'default boot should load exactly 2 months');
  assert(appendedScripts.length === 2, 'expected two script requests');

  const within = await dl.ensureRangeLoaded('2026-02-01', '2026-03-31');
  assert(within.count === 0, 'within preloaded range should load none');

  const four = await dl.ensureRangeLoaded('2025-12-01', '2026-03-31');
  assert(four.count === 2, '4-month range should load missing two months');

  const year = await dl.ensureRangeLoaded('2025-10-01', '2026-03-31');
  assert(year.count === 2, 'year range should load remaining two months');

  const repeated = await dl.ensureMonthsLoaded(['2025-10', '2025-10']);
  assert(repeated.count === 0, 're-loading same month should no-op');

  const allTx = store.toArray();
  assert(allTx.length === 6, 'store should dedupe and keep one tx per month payload');

  const dayAgg = store.getAggregatesInRange('2025-10-01', '2026-03-31', 'day');
  assert(dayAgg.length === 6, 'daily rollup should have 6 days');

  const itemDay = store.getAggregatesInRange('2025-10-01', '2026-03-31', 'itemDay', { itemCode: 'A' });
  assert(itemDay.length === 6, 'item-day rollup should have 6 rows');

  const legacy = store.toLegacyTransactions();
  assert(legacy.A && legacy.A.history && legacy.A.history.length === 6, 'legacy history map should include all deduped tx');

  console.log('✓ transaction loader/store tests passed');
})().catch((err) => {
  console.error('✗ transaction loader/store tests failed');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
