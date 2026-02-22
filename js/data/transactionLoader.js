(function () {
  const ns = (window.InventoryApp = window.InventoryApp || {});

  /**
   * Transaction Script Loader (incremental)
   *
   * Supports:
   *  - Loading a minimal recent window first (fast startup)
   *  - Ensuring a specific month range is loaded on demand
   *  - Background preloading of all remaining months (for 24mo analytics/spikes)
   *
   * Source of truth:
   *  - window.TRANSACTION_SCRIPTS: array of script src strings
   *  - Scripts must define globals like: const TRANSACTION_YYYY_MM = {...}
   */

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => !!s);
  }

  // ---------- Month parsing / indexing ----------

  function parseMonthKeyFromSrc(src) {
    // Accept: transaction_2025_01_mockdata.js OR transaction_2025_01.js etc.
    const m = String(src || '').match(/transaction[_-](\d{4})[_-](\d{2})/i);
    if (!m) return null;
    return m[1] + '_' + m[2];
  }

  function monthKeyToDate(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})_(\d{2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    return new Date(y, mo, 1);
  }

  function monthKeysBetween(fromISO, toISO) {
    // inclusive month list
    const from = new Date(fromISO);
    const to = new Date(toISO);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return [];
    const start = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    const out = [];
    let d = start;
    while (d <= end) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      out.push(y + '_' + m);
      d = new Date(y, d.getMonth() + 1, 1);
    }
    return out;
  }

  function buildIndex() {
    const scripts = normalizeList(window.TRANSACTION_SCRIPTS || []);
    const byMonth = {};
    const months = [];
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i];
      const mk = parseMonthKeyFromSrc(src);
      if (!mk) continue;
      if (!byMonth[mk]) {
        byMonth[mk] = src;
        months.push(mk);
      }
    }
    months.sort(); // YYYY_MM lexicographic sorts correctly
    return { scripts, byMonth, months };
  }

  // ---------- Script loading ----------

  function writeScriptsSync(list) {
    const scripts = normalizeList(list);
    if (!scripts.length) return { loaded: false, count: 0 };

    // Only safe during HTML parse.
    if (document.readyState !== 'loading' || typeof document.write !== 'function') {
      return { loaded: false, count: 0 };
    }

    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i];
      // eslint-disable-next-line no-useless-escape
      document.write('<script src="' + src.replace(/"/g, '&quot;') + '"><\/script>');
    }
    return { loaded: true, count: scripts.length };
  }

  function loadScriptsAsync(list, opts) {
    const scripts = normalizeList(list);
    const yieldEvery = (opts && opts.yieldEvery) || 2;
    const yieldMs = (opts && opts.yieldMs) || 0;

    if (!scripts.length) return Promise.resolve({ loaded: true, count: 0 });

    let idx = 0;
    return new Promise((resolve) => {
      function next() {
        if (idx >= scripts.length) {
          resolve({ loaded: true, count: scripts.length });
          return;
        }

        const src = scripts[idx++];
        const el = document.createElement('script');
        el.src = src;
        el.async = false;

        const after = () => {
          // Mark loaded month key
          const mk = parseMonthKeyFromSrc(src);
          if (mk) ns.DataLoader.__loadedMonths.add(mk);
          ns.DataLoader.__txVersion++;

          if (typeof ns.DataLoader.onMonthLoaded === 'function') {
            try { ns.DataLoader.onMonthLoaded(mk, src); } catch (e) {}
          }

          // Yield periodically to keep UI responsive
          if (yieldEvery && idx % yieldEvery === 0) {
            setTimeout(next, yieldMs);
          } else {
            next();
          }
        };

        el.onload = after;
        el.onerror = () => {
          console.warn('⚠️ Failed to load transaction script:', src);
          after();
        };
        document.head.appendChild(el);
      }

      next();
    });
  }

  // ---------- Public API ----------

  function getIndex() {
    ns.DataLoader.__index = ns.DataLoader.__index || buildIndex();
    return ns.DataLoader.__index;
  }

  function getLoadedMonthKeys() {
    return Array.from(ns.DataLoader.__loadedMonths || []);
  }

  function ensureMonthsLoaded(monthKeys, opts) {
    const wanted = Array.isArray(monthKeys) ? monthKeys : [];
    const idx = getIndex();
    const toLoad = [];
    for (let i = 0; i < wanted.length; i++) {
      const mk = wanted[i];
      if (!mk) continue;
      if (ns.DataLoader.__loadedMonths.has(mk)) continue;
      const src = idx.byMonth[mk];
      if (src) toLoad.push(src);
    }
    if (!toLoad.length) return Promise.resolve({ loaded: true, count: 0 });
    return loadScriptsAsync(toLoad, opts);
  }

  function ensureRangeLoaded(fromISO, toISO, opts) {
    const keys = monthKeysBetween(fromISO, toISO);
    return ensureMonthsLoaded(keys, opts);
  }

  function preloadAllInBackground(opts) {
    const idx = getIndex();
    const toLoad = [];
    for (let i = 0; i < idx.months.length; i++) {
      const mk = idx.months[i];
      if (!ns.DataLoader.__loadedMonths.has(mk)) {
        const src = idx.byMonth[mk];
        if (src) toLoad.push(src);
      }
    }
    if (!toLoad.length) return Promise.resolve({ loaded: true, count: 0 });
    return loadScriptsAsync(toLoad, Object.assign({ yieldEvery: 1, yieldMs: 0 }, opts || {}));
  }

  function ensureTransactionsLoaded(options) {
    // Backwards compatible entry point.
    // Default behavior: load recent N months first (fast), then optionally preload the rest.
    if (ns.__transactionsLoadedPromise) return ns.__transactionsLoadedPromise;

    const opts = options || {};
    const initialMonths = Math.max(1, parseInt(opts.initialMonths || 6, 10));
    const preloadAll = opts.preloadAll !== false; // default true

    const idx = getIndex();
    const recent = idx.months.slice(Math.max(0, idx.months.length - initialMonths));
    const initialSrc = recent.map((mk) => idx.byMonth[mk]).filter(Boolean);

    // Mark initial months as loaded if scripts are already present (e.g., if hardcoded in HTML)
    // We'll still attempt to load missing ones.
    for (let i = 0; i < recent.length; i++) {
      const mk = recent[i];
      // If the global exists, count as loaded.
      const g = 'TRANSACTION_' + mk;
      if (typeof window[g] !== 'undefined') ns.DataLoader.__loadedMonths.add(mk);
    }

    const sync = writeScriptsSync(initialSrc);
    if (sync.loaded) {
      // During parse, scripts will be available synchronously.
      for (let i = 0; i < recent.length; i++) ns.DataLoader.__loadedMonths.add(recent[i]);
      ns.DataLoader.__txVersion++;
      ns.__transactionsLoadedPromise = Promise.resolve(sync);

      // Background preload after parse
      if (preloadAll) {
        setTimeout(() => preloadAllInBackground(), 0);
      }
      return ns.__transactionsLoadedPromise;
    }

    ns.__transactionsLoadedPromise = loadScriptsAsync(initialSrc).then((r) => {
      if (preloadAll) {
        // Keep loading remaining months without blocking the app.
        setTimeout(() => preloadAllInBackground(), 0);
      }
      return r;
    });
    return ns.__transactionsLoadedPromise;
  }

  // Namespace init
  ns.DataLoader = ns.DataLoader || {};
  ns.DataLoader.__loadedMonths = ns.DataLoader.__loadedMonths || new Set();
  ns.DataLoader.__txVersion = ns.DataLoader.__txVersion || 0;

  ns.DataLoader.getIndex = getIndex;
  ns.DataLoader.getLoadedMonthKeys = getLoadedMonthKeys;
  ns.DataLoader.ensureMonthsLoaded = ensureMonthsLoaded;
  ns.DataLoader.ensureRangeLoaded = ensureRangeLoaded;
  ns.DataLoader.preloadAllInBackground = preloadAllInBackground;
  ns.DataLoader.ensureTransactionsLoaded = ensureTransactionsLoaded;
})();
