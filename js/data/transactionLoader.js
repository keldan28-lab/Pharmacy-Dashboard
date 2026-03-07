(function () {
  const ns = (window.InventoryApp = window.InventoryApp || {});

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => !!s);
  }

  function isDevLoggingEnabled() {
    try {
      if (localStorage.getItem('log_txLoader') === '0') return false;
      if (localStorage.getItem('log_txLoader') === '1') return true;
    } catch (_) {}
    return !!(window.__PB_DEV_TRANSACTIONS || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:');
  }

  function devLog() {
    if (!isDevLoggingEnabled()) return;
    try {
      const args = Array.prototype.slice.call(arguments);
      args.unshift('[DataLoader]');
      console.log.apply(console, args);
    } catch (e) {}
  }

  // ---------- Month parsing / indexing ----------

  // e.g. transaction_2026_01_mockdata.js -> "2026-01"
  function parseMonthKeyFromFilename(filename) {
    const m = String(filename || '').match(/transaction[_-](\d{4})[_-](\d{2})/i);
    if (!m) return null;
    return m[1] + '-' + m[2];
  }

  function normalizeMonthKey(monthKey) {
    const mk = String(monthKey || '').trim().replace('_', '-');
    const m = mk.match(/^(\d{4})-(\d{2})$/);
    return m ? m[1] + '-' + m[2] : null;
  }

  function monthKeyToLegacy(monthKey) {
    const mk = normalizeMonthKey(monthKey);
    return mk ? mk.replace('-', '_') : null;
  }


  function getGlobalByName(name) {
    if (!name || typeof name !== 'string') return undefined;
    if (Object.prototype.hasOwnProperty.call(window, name)) return window[name];
    if (!/^[A-Z0-9_]+$/.test(name)) return undefined;
    try {
      // eslint-disable-next-line no-new-func
      return Function('try { return ' + name + '; } catch (e) { return undefined; }')();
    } catch (e) {
      return undefined;
    }
  }

  function ingestMonthIntoStore(monthKey) {
    const store = ns.TransactionStore;
    if (!store || typeof store.addLegacyHistoryMap !== 'function') return { addedCount: 0, skippedCount: 0, dirtyDays: [] };
    const legacy = monthKeyToLegacy(monthKey);
    const globalName = legacy ? ('TRANSACTION_' + legacy) : '';
    const payload = globalName ? getGlobalByName(globalName) : null;
    if (!payload || typeof payload !== 'object') return { addedCount: 0, skippedCount: 0, dirtyDays: [] };
    const result = store.addLegacyHistoryMap(monthKey, payload);
    devLog('Ingested month into TransactionStore', monthKey, result);
    return result;
  }

  function monthGlobalExists(monthKey) {
    const legacy = monthKeyToLegacy(monthKey);
    if (!legacy) return false;
    const g = 'TRANSACTION_' + legacy;
    return typeof window[g] !== 'undefined';
  }

  function monthKeyToDate(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
  }

  function listAvailableMonths(manifestScripts) {
    const scripts = normalizeList(manifestScripts);
    const found = [];
    for (let i = 0; i < scripts.length; i++) {
      const mk = parseMonthKeyFromFilename(scripts[i]);
      if (mk) found.push(mk);
    }
    return Array.from(new Set(found)).sort();
  }

  function monthsForRange(startDateISO, endDateISO) {
    const from = new Date(startDateISO);
    const to = new Date(endDateISO);
    if (!isFinite(from.getTime()) || !isFinite(to.getTime())) return [];

    const fromDate = from <= to ? from : to;
    const toDate = from <= to ? to : from;

    const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    const out = [];

    for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      out.push(y + '-' + m);
    }

    return out;
  }

  function buildIndex() {
    const scripts = normalizeList(window.TRANSACTION_SCRIPTS || []);
    const byMonth = {};
    const months = [];

    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i];
      const mk = parseMonthKeyFromFilename(src);
      if (!mk || byMonth[mk]) continue;
      byMonth[mk] = src;
      months.push(mk);
    }

    months.sort();
    return { scripts, byMonth, months };
  }

  function monthKeyToFilename(monthKey) {
    const mk = normalizeMonthKey(monthKey);
    if (!mk) return null;
    const idx = getIndex();
    return idx.byMonth[mk] || null;
  }

  // ---------- Script loading ----------

  function markMonthLoaded(monthKey) {
    const mk = normalizeMonthKey(monthKey);
    if (!mk) return;
    ns.DataLoader.__loadedMonths.add(mk);
    ns.DataLoader.__loadingMonths.delete(mk);
    ns.DataLoader.__txVersion++;
  }

  function loadMonthScript(monthKey, opts) {
    const mk = normalizeMonthKey(monthKey);
    if (!mk) return Promise.resolve({ loaded: true, count: 0 });
    if (ns.DataLoader.__loadedMonths.has(mk)) return Promise.resolve({ loaded: true, count: 0 });
    if (monthGlobalExists(mk)) {
      const storeResult = ingestMonthIntoStore(mk);
      markMonthLoaded(mk);
      return Promise.resolve({ loaded: true, count: 0, monthKey: mk, store: storeResult });
    }

    const inflight = ns.DataLoader.__loadingMonths.get(mk);
    if (inflight) return inflight;

    const src = monthKeyToFilename(mk);
    if (!src) return Promise.resolve({ loaded: true, count: 0 });

    const promise = new Promise((resolve) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = false;

      const done = () => {
        const storeResult = ingestMonthIntoStore(mk);
        markMonthLoaded(mk);
        if (typeof ns.DataLoader.onMonthLoaded === 'function') {
          try { ns.DataLoader.onMonthLoaded(mk, src, storeResult); } catch (e) {}
        }
        resolve({ loaded: true, count: 1, monthKey: mk, src: src, store: storeResult });
      };

      el.onload = done;
      el.onerror = () => {
        console.warn('⚠️ Failed to load transaction script:', src);
        done();
      };

      devLog('Loading month script', mk, '=>', src, opts && opts.reason ? '(' + opts.reason + ')' : '');
      document.head.appendChild(el);
    });

    ns.DataLoader.__loadingMonths.set(mk, promise);
    return promise;
  }

  // ---------- Public API ----------

  function getIndex() {
    ns.DataLoader.__index = ns.DataLoader.__index || buildIndex();
    return ns.DataLoader.__index;
  }

  function getLoadedMonthKeys() {
    return Array.from(ns.DataLoader.__loadedMonths || []).sort();
  }

  function ensureMonthsLoaded(monthKeys, opts) {
    const requested = Array.isArray(monthKeys) ? monthKeys : [];
    const unique = [];
    const seen = new Set();

    for (let i = 0; i < requested.length; i++) {
      const mk = normalizeMonthKey(requested[i]);
      if (!mk || seen.has(mk)) continue;
      seen.add(mk);
      unique.push(mk);
    }

    if (!unique.length) return Promise.resolve({ loaded: true, count: 0, requested: [], loadedNow: [] });

    const idx = getIndex();
    const existing = unique.filter((mk) => !!idx.byMonth[mk]);
    const missing = existing.filter((mk) => !ns.DataLoader.__loadedMonths.has(mk));

    if (!missing.length) {
      devLog('Range/month request already satisfied', existing);
      return Promise.resolve({ loaded: true, count: 0, requested: existing, loadedNow: [] });
    }

    devLog('Ensuring months loaded', { requested: unique, existing: existing, missing: missing, reason: opts && opts.reason });

    const chain = missing.reduce((p, mk, i) => {
      return p.then((acc) => loadMonthScript(mk, opts).then((info) => {
        if (info && info.count) acc.loadedNow.push(mk);
        const yieldEvery = (opts && opts.yieldEvery) || 0;
        if (yieldEvery && (i + 1) % yieldEvery === 0) {
          const yieldMs = (opts && opts.yieldMs) || 0;
          return new Promise((r) => setTimeout(() => r(acc), yieldMs));
        }
        return acc;
      }));
    }, Promise.resolve({ loadedNow: [] }));

    return chain.then((acc) => ({ loaded: true, count: acc.loadedNow.length, requested: existing, loadedNow: acc.loadedNow }));
  }

  function ensureRangeLoaded(fromISO, toISO, opts) {
    const keys = monthsForRange(fromISO, toISO);
    devLog('ensureRangeLoaded', {
      fromISO: fromISO,
      toISO: toISO,
      derivedMonths: keys,
      currentlyLoaded: getLoadedMonthKeys()
    });
    return ensureMonthsLoaded(keys, Object.assign({}, opts || {}, { reason: 'range:' + String(fromISO) + '->' + String(toISO) })).then((info) => {
      devLog('ensureRangeLoaded done', {
        fromISO: fromISO,
        toISO: toISO,
        loadedNow: info && info.loadedNow ? info.loadedNow : [],
        requested: info && info.requested ? info.requested : [],
        currentlyLoaded: getLoadedMonthKeys()
      });
      return info;
    });
  }

  function loadRecentMonths(options) {
    const opts = options || {};
    const count = Math.max(1, parseInt(opts.count || 2, 10));
    const idx = getIndex();
    const recent = idx.months.slice(Math.max(0, idx.months.length - count));
    devLog('Default preload recent months', recent);
    return ensureMonthsLoaded(recent, Object.assign({}, opts, { reason: 'startup:recent' }));
  }

  function ensureTransactionsLoaded(options) {
    // Backward-compatible entry point for existing callers.
    if (ns.__transactionsLoadedPromise) return ns.__transactionsLoadedPromise;
    const opts = options || {};
    const count = Math.max(1, parseInt(opts.initialMonths || 2, 10));
    ns.__transactionsLoadedPromise = loadRecentMonths({ count: count, yieldEvery: opts.yieldEvery, yieldMs: opts.yieldMs });
    return ns.__transactionsLoadedPromise;
  }

  ns.DataLoader = ns.DataLoader || {};
  ns.DataLoader.__loadedMonths = ns.DataLoader.__loadedMonths || new Set();
  ns.DataLoader.__loadingMonths = ns.DataLoader.__loadingMonths || new Map();
  ns.DataLoader.__txVersion = ns.DataLoader.__txVersion || 0;

  ns.DataLoader.parseMonthKeyFromFilename = parseMonthKeyFromFilename;
  ns.DataLoader.listAvailableMonths = function () { return listAvailableMonths(window.TRANSACTION_SCRIPTS || []); };
  ns.DataLoader.monthsForRange = monthsForRange;
  ns.DataLoader.monthKeyToFilename = monthKeyToFilename;
  ns.DataLoader.monthKeyToLegacy = monthKeyToLegacy;
  ns.DataLoader.getIndex = getIndex;
  ns.DataLoader.getLoadedMonthKeys = getLoadedMonthKeys;
  ns.DataLoader.ensureMonthsLoaded = ensureMonthsLoaded;
  ns.DataLoader.ensureRangeLoaded = ensureRangeLoaded;
  ns.DataLoader.loadRecentMonths = loadRecentMonths;
  ns.DataLoader.ensureTransactionsLoaded = ensureTransactionsLoaded;
})();
