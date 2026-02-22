(function () {
  const ns = (window.InventoryApp = window.InventoryApp || {});
  const win = window;

  // -------------------------------------------------------------------------------------
  // InventoryApp.Compute
  // Centralized normalization + summarization + trend computation for STATIC HTML projects.
  // - No build tools
  // - No ES module imports
  // - Deterministic aggregation (anchored to available transaction dates)
  // -------------------------------------------------------------------------------------

  // ------------------------------
  // Utilities
  // ------------------------------
  function deepClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return obj;
    }
  }

  function safeNumber(v, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function percentile(sorted, p) {
    if (!sorted || !sorted.length) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const w = idx - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }

  function robustWeeklyBaseline(usageRateArray) {
    if (!Array.isArray(usageRateArray) || usageRateArray.length === 0) {
      return { weeklyBaseline: 0, dailyBaseline: 0, confidence: 0, method: 'none' };
    }

    const values = usageRateArray
      .map((v) => safeNumber(v, 0))
      .filter((v) => Number.isFinite(v) && v >= 0);

    if (values.length === 0) {
      return { weeklyBaseline: 0, dailyBaseline: 0, confidence: 0, method: 'none' };
    }

    // Use only complete weeks if caller pre-trimmed; otherwise use all.
    // Remove zeros from baseline estimation but keep them for confidence.
    const nonZero = values.filter((v) => v > 0);
    if (nonZero.length === 0) {
      return { weeklyBaseline: 0, dailyBaseline: 0, confidence: 10, method: 'all-zero' };
    }

    const sorted = nonZero.slice().sort((a, b) => a - b);
    const q1 = percentile(sorted, 0.25);
    const q3 = percentile(sorted, 0.75);
    const iqr = Math.max(0, q3 - q1);
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const filtered = sorted.filter((v) => v >= lo && v <= hi);
    const used = filtered.length ? filtered : sorted;
    const mean = used.reduce((s, v) => s + v, 0) / used.length;

    // Confidence: based on data availability + how many points survived filtering.
    const coverage = Math.min(100, Math.round((values.length / 12) * 100));
    const retention = Math.min(100, Math.round((used.length / Math.max(1, sorted.length)) * 100));
    const confidence = Math.round(0.6 * retention + 0.4 * coverage);

    return {
      weeklyBaseline: mean,
      dailyBaseline: mean / 7,
      confidence,
      method: used === sorted ? 'mean' : 'iqr-filtered'
    };
  }

  function normalizeRestockRate(v) {
    if (Array.isArray(v)) return v.map((x) => safeNumber(x, 0));
    if (typeof v === 'string') {
      return v
        .split(',')
        .map((s) => safeNumber(s.trim(), 0))
        .filter((n) => Number.isFinite(n));
    }
    return [];
  }

  function normalizeInventoryToSublocations(inventoryByItem) {
    // Input might be:
    //  - { [itemCode]: { [locationName]: { qty/min/max/... } } }
    // Output also includes:
    //  - { [itemCode]: { ..., sublocations: [{sublocation, curQty, minQty, maxQty}] } }
    const inv = inventoryByItem || {};
    const out = deepClone(inv);

    Object.keys(out).forEach((itemCode) => {
      const entry = out[itemCode];
      if (!entry || typeof entry !== 'object') return;
      if (Array.isArray(entry.sublocations)) return; // already present

      const subs = [];
      Object.keys(entry).forEach((k) => {
        if (k === 'sublocations') return;
        const loc = entry[k];
        if (!loc || typeof loc !== 'object') return;
        // Heuristic: treat any nested object with qty/curQty as a location bucket
        const curQty = safeNumber(loc.curQty, safeNumber(loc.qty, 0));
        const minQty = safeNumber(loc.minQty, safeNumber(loc.min, 0));
        const maxQty = safeNumber(loc.maxQty, safeNumber(loc.max, 0));
        const standard = !!loc.standard;
        const standardQty = safeNumber(loc.standardQty, 0);
        const expires = typeof loc.expires === 'string' ? loc.expires : '';
        const pocket = typeof loc.pocket === 'string' ? loc.pocket : '';

        if (curQty !== 0 || minQty !== 0 || maxQty !== 0 || k.toLowerCase().includes('pyxis')) {
          subs.push({ sublocation: k, curQty, minQty, maxQty, standard, standardQty, expires, pocket });
        }
      });

      entry.sublocations = subs;
    });

    return out;
  }

  function computeLocationTotalsForItem(itemCode, inventoryByItem, sublocationMap) {
    // Returns { pyxis, pharmacy, total }
    const inv = inventoryByItem && inventoryByItem[itemCode];
    const subs = inv && Array.isArray(inv.sublocations) ? inv.sublocations : [];

    let pyxis = 0;
    let pharmacy = 0;

    for (let i = 0; i < subs.length; i++) {
      const s = subs[i] || {};
      const code = s.sublocation;
      const qty = safeNumber(s.curQty, safeNumber(s.qty, 0));
      const info = (sublocationMap && code && sublocationMap[code]) || null;
      const dept = info && info.department ? String(info.department).toLowerCase() : '';

      if (dept === 'pyxis') pyxis += qty;
      else pharmacy += qty;
    }

    const total = pyxis + pharmacy;
    return { pyxis, pharmacy, total };
  }

  function sumSeriesCostByWeek(items, seriesKey) {
    // seriesKey: 'wasteRate' or 'restockRate'
    const maxLen = items.reduce((m, it) => {
      const arr = it && Array.isArray(it[seriesKey]) ? it[seriesKey] : [];
      return Math.max(m, arr.length);
    }, 0);
    const out = new Array(maxLen).fill(0);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const unitCost = safeNumber(it.unitCost, safeNumber(it.unitPrice, safeNumber(it.costPerUnit, 0)));
      const arr = it && Array.isArray(it[seriesKey]) ? it[seriesKey] : [];
      for (let w = 0; w < maxLen; w++) {
        const qty = safeNumber(arr[w], 0);
        out[w] += qty * unitCost;
      }
    }

    return out;
  }

  // ------------------------------
  // Dispense-only daily usage maps (for forecasting + inactivity)
  // ------------------------------
  function buildDailyDispenseMaps(transactions) {
    // transactions: { [itemCode]: { history: [{transDate,sublocation,transactionType,transQty}, ...] } }
    const byItem = Object.create(null); // item -> date -> qty
    const byItemSubloc = Object.create(null); // item -> subloc -> date -> qty
    let minDate = null;
    let maxDate = null;

    const items = transactions && typeof transactions === 'object' ? Object.keys(transactions) : [];
    for (let ii = 0; ii < items.length; ii++) {
      const itemCode = items[ii];
      const entry = transactions[itemCode];
      const hist = entry && Array.isArray(entry.history) ? entry.history : [];
      for (let j = 0; j < hist.length; j++) {
        const r = hist[j] || {};
        const t = String(r.transactionType || '').toLowerCase();
        // Treat any variant containing the word "dispense" as usage
        if (!t.includes('dispense')) continue;
        const dateStr = typeof r.transDate === 'string' ? r.transDate.slice(0, 10) : '';
        if (!dateStr) continue;
        // Support multiple field casings from different exports (e.g., TransQty)
        const qtyRaw = safeNumber(
          (r.transQty != null ? r.transQty : (r.TransQty != null ? r.TransQty : (r.qty != null ? r.qty : r.Qty))),
          0
        );
        const used = qtyRaw < 0 ? -qtyRaw : qtyRaw; // dispense is usually negative
        if (used <= 0) continue;
        const subloc = typeof r.sublocation === 'string' ? r.sublocation : 'UNKNOWN';

        if (!byItem[itemCode]) byItem[itemCode] = Object.create(null);
        byItem[itemCode][dateStr] = (byItem[itemCode][dateStr] || 0) + used;

        if (!byItemSubloc[itemCode]) byItemSubloc[itemCode] = Object.create(null);
        if (!byItemSubloc[itemCode][subloc]) byItemSubloc[itemCode][subloc] = Object.create(null);
        byItemSubloc[itemCode][subloc][dateStr] = (byItemSubloc[itemCode][subloc][dateStr] || 0) + used;

        if (!minDate || dateStr < minDate) minDate = dateStr;
        if (!maxDate || dateStr > maxDate) maxDate = dateStr;
      }
    }

    return { byItem, byItemSubloc, minDate, maxDate };
  }

  // Build daily maps for dispense/restock/waste in one pass.
  // Returns sparse maps keyed by ISO date (yyyy-mm-dd).
  function buildDailyTransactionMaps(transactions) {
    const byItemDispense = Object.create(null);
    const byItemRestock = Object.create(null);
    const byItemWaste = Object.create(null);
    let minDate = null;
    let maxDate = null;

    const tx = transactions && typeof transactions === 'object' ? transactions : {};
    for (const itemCode of Object.keys(tx)) {
      const entry = tx[itemCode];
      const hist = entry && Array.isArray(entry.history) ? entry.history : [];
      if (!hist.length) continue;

      for (let i = 0; i < hist.length; i++) {
        const r = hist[i] || {};
        const d = typeof r.transDate === 'string' ? r.transDate.slice(0, 10)
              : (typeof r.date === 'string' ? r.date.slice(0, 10)
              : (typeof r.transdate === 'string' ? r.transdate.slice(0, 10) : ''));
        if (!d || d.length !== 10) continue;

        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;

        const rawQty = (r.transQty ?? r.TransQty ?? r.qty ?? r.Qty ?? r.TRANSQTY ?? 0);
        const absQty = Math.abs(parseFloat(rawQty) || 0);
        if (!absQty) continue;

        const t = String(r.transactionType || '').toLowerCase();
        let bucket = null;
        if (t.includes('dispense')) bucket = byItemDispense;
        else if (t.includes('restock')) bucket = byItemRestock;
        else if (t.includes('waste')) bucket = byItemWaste;
        else continue;

        const code = String(itemCode);
        const m = bucket[code] || (bucket[code] = Object.create(null));
        m[d] = safeNumber(m[d], 0) + absQty;
      }
    }

    return { byItemDispense, byItemRestock, byItemWaste, minDate, maxDate };
  }

  // ------------------------------
  // Inactivity risk scoring (deterministic, auditable)
  // ------------------------------
  function mean(arr) {
    if (!arr || !arr.length) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function stddevSample(arr) {
    const n = arr ? arr.length : 0;
    if (n <= 1) return 0;
    const mu = mean(arr);
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const d = arr[i] - mu;
      ss += d * d;
    }
    return Math.sqrt(ss / (n - 1));
  }

  function daysBetweenISO(aISO, bISO) {
    const a = parseISODate(aISO);
    const b = parseISODate(bISO);
    if (!a || !b) return 0;
    const ms = b.getTime() - a.getTime();
    return Math.floor(ms / 86400000);
  }

  function addDaysISO(iso, days) {
    const d = parseISODate(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  function buildDailySeriesFromDateMap(dateMapObj, startISO, endISO) {
    // dateMapObj: { 'YYYY-MM-DD': number }
    const series = [];
    const nDays = daysBetweenISO(startISO, endISO);
    for (let i = 0; i <= nDays; i++) {
      const day = addDaysISO(startISO, i);
      const v = dateMapObj && Object.prototype.hasOwnProperty.call(dateMapObj, day) ? safeNumber(dateMapObj[day], 0) : 0;
      series.push(v);
    }
    return series;
  }

  function computeBaselineDailyNonZero(series) {
    if (!series || !series.length) return 0;
    let s = 0;
    let c = 0;
    for (let i = 0; i < series.length; i++) {
      const v = safeNumber(series[i], 0);
      if (v > 0) { s += v; c++; }
    }
    return c ? (s / c) : 0;
  }

  function computeInactivityRiskFromSeries(series, thresholdPct) {
    const baselineDaily = computeBaselineDailyNonZero(series);
    const thr = baselineDaily * (safeNumber(thresholdPct, 90) / 100);

    // inactive boolean series
    const inactive = new Array(series.length);
    for (let i = 0; i < series.length; i++) inactive[i] = safeNumber(series[i], 0) < thr;

    // streak lengths
    const streaks = [];
    let run = 0;
    for (let i = 0; i < inactive.length; i++) {
      if (inactive[i]) run++;
      else {
        if (run > 0) streaks.push(run);
        run = 0;
      }
    }
    if (run > 0) streaks.push(run);

    const mu = mean(streaks);
    const sd = stddevSample(streaks);
    const maxStreak = streaks.length ? Math.max.apply(null, streaks) : 0;

    // current streak: consecutive inactive days from end backwards
    let cur = 0;
    for (let i = inactive.length - 1; i >= 0; i--) {
      if (inactive[i]) cur++;
      else break;
    }

    let z;
    if (sd === 0) {
      if (cur === mu) z = 0;
      else if (cur > mu) z = Infinity;
      else z = -Infinity;
    } else {
      z = (cur - mu) / sd;
    }

    let riskCategory;
    if (z < 0) riskCategory = 'Normal inactivity';
    else if (z < 1) riskCategory = 'Slightly elevated risk';
    else if (z < 2) riskCategory = 'High risk';
    else riskCategory = 'Very high risk';

    const explanation = (sd === 0)
      ? `Current inactivity streak is ${cur} day(s) vs a historical mean of ${mu.toFixed(2)} day(s).`
      : `Current inactivity streak (${cur} day(s)) is ${(Number.isFinite(z) ? z.toFixed(2) : String(z))}σ vs historical mean (${mu.toFixed(2)} day(s)).`;

    return {
      baselineDaily,
      thresholdDaily: thr,
      meanStreak: mu,
      stdDevStreak: sd,
      maxStreak,
      currentStreak: cur,
      zScore: z,
      riskCategory,
      explanation
    };
  }

  function buildInactivityRiskMaps(daily, asOfISO, thresholdPct) {
    // daily: return of buildDailyDispenseMaps
    const byItem = daily && daily.byItem ? daily.byItem : {};
    const byItemSubloc = daily && daily.byItemSubloc ? daily.byItemSubloc : {};
    const startISO = daily && daily.minDate ? daily.minDate : asOfISO;
    const endISO = asOfISO;

    const riskByItem = {};
    const riskByItemSubloc = {};

    const itemCodes = Object.keys(byItemSubloc);
    for (let i = 0; i < itemCodes.length; i++) {
      const itemCode = itemCodes[i];

      // Item-level series (sum across sublocs) from byItem map if present, else sum subloc maps.
      const itemDateMap = byItem[itemCode] || null;
      let itemSeries;
      if (itemDateMap) {
        itemSeries = buildDailySeriesFromDateMap(itemDateMap, startISO, endISO);
      } else {
        // sum subloc maps
        const sublocsObj = byItemSubloc[itemCode] || {};
        const tmp = {};
        const subs = Object.keys(sublocsObj);
        for (let s = 0; s < subs.length; s++) {
          const dm = sublocsObj[subs[s]] || {};
          const dks = Object.keys(dm);
          for (let k = 0; k < dks.length; k++) {
            const day = dks[k];
            tmp[day] = (tmp[day] || 0) + safeNumber(dm[day], 0);
          }
        }
        itemSeries = buildDailySeriesFromDateMap(tmp, startISO, endISO);
      }
      riskByItem[itemCode] = computeInactivityRiskFromSeries(itemSeries, thresholdPct);

      // Sublocation-level
      const sublocsObj = byItemSubloc[itemCode] || {};
      const subs = Object.keys(sublocsObj);
      riskByItemSubloc[itemCode] = {};
      for (let s = 0; s < subs.length; s++) {
        const sub = subs[s];
        const dm = sublocsObj[sub] || {};
        const series = buildDailySeriesFromDateMap(dm, startISO, endISO);
        riskByItemSubloc[itemCode][sub] = computeInactivityRiskFromSeries(series, thresholdPct);
      }
    }

    return { riskByItem, riskByItemSubloc, startISO, endISO };
  }


  function dateToLocalISO(d) {
    // local date yyyy-mm-dd
    const dt = d instanceof Date ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Historical helper name used throughout this file.
  // Keep as a thin wrapper around the canonical local ISO formatter.
  function toISODate(d) {
    return dateToLocalISO(d);
  }

  function parseISODate(s) {
    if (typeof s !== 'string' || s.length < 10) return null;
    const d = new Date(s.slice(0, 10) + 'T00:00:00');
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function daysBetweenISO(startISO, endISO) {
    const a = parseISODate(startISO);
    const b = parseISODate(endISO);
    if (!a || !b) return 0;
    const ms = b.getTime() - a.getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }

  function computeUsageVsRestock(items, threshold) {
    const th = safeNumber(threshold, 0.5);
    const flagged = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const usageTotal = Array.isArray(it.usageRate) ? it.usageRate.reduce((s, v) => s + safeNumber(v, 0), 0) : 0;
      const restockTotal = Array.isArray(it.restockRate) ? it.restockRate.reduce((s, v) => s + safeNumber(v, 0), 0) : 0;
      if (restockTotal <= 0) continue;
      const ratio = usageTotal / restockTotal;
      if (ratio < th) {
        flagged.push({
          itemCode: it.itemCode,
          description: it.description,
          drugName: it.drugName,
          usageTotal,
          restockTotal,
          ratio
        });
      }
    }

    // Sort worst ratio first
    flagged.sort((a, b) => a.ratio - b.ratio);

    return {
      threshold: th,
      itemCount: flagged.length,
      items: flagged
    };
  }

  function deriveAsOfDateFromTransactions(transactions) {
    // Deterministic anchor: latest transDate found across all items.
    let maxTs = 0;
    if (transactions && typeof transactions === 'object') {
      Object.keys(transactions).forEach((code) => {
        const h = transactions[code] && transactions[code].history;
        if (!Array.isArray(h)) return;
        for (let i = 0; i < h.length; i++) {
          const d = new Date(h[i].transDate);
          const ts = d && d.getTime ? d.getTime() : 0;
          if (ts > maxTs) maxTs = ts;
        }
      });
    }
    return maxTs ? new Date(maxTs) : new Date();
  }

  // ------------------------------
  // Core store builder
  // ------------------------------
  let _store = null;

  // Read a global even if it was declared as a top-level `const` in a script
  // (those do NOT attach to window/globalThis).
  function readGlobal(name, fallback) {
    try {
      if (typeof window !== 'undefined' && window[name] !== undefined) return window[name];
    } catch (_) {}
    try {
      // Access global lexical binding safely
      const v = Function('return (typeof ' + name + ' !== "undefined") ? ' + name + ' : undefined')();
      if (v !== undefined) return v;
    } catch (_) {}
    return fallback;
  }

  function buildStoreFromGlobals(options) {
    const opts = options || {};

    // 1) Build/refresh legacy MOCK_DATA (existing compatibility layer)
    if (typeof window.initializeMockDataCompatibility === 'function') {
      try {
        window.initializeMockDataCompatibility();
      } catch (e) {
        console.warn('Compute: initializeMockDataCompatibility failed:', e);
      }
    }

    // 2) Identify raw source
    const rawLegacy = window.MOCK_DATA
      ? deepClone(window.MOCK_DATA)
      : {
          lastUpdated: opts.lastUpdated || '',
          items: deepClone(readGlobal('ITEMS_DATA', [])),
          inventory: deepClone(readGlobal('ITEMS_INVENTORY', {})),
          transactions: {},
          stockFlow: { flows: [] },
          stockOutsByArea: []
        };

    // Ensure transactions are present (merge monthly globals if needed)
    if (!rawLegacy.transactions || Object.keys(rawLegacy.transactions).length === 0) {
      if (ns.TransactionMerge && typeof ns.TransactionMerge.mergeMonthlyTransactions === 'function') {
        rawLegacy.transactions = ns.TransactionMerge.mergeMonthlyTransactions() || {};
      }
    }

    // 3) Normalize raw -> normalized
    const raw = deepClone(rawLegacy);
    raw.items = Array.isArray(raw.items) ? raw.items : [];
    raw.inventory = normalizeInventoryToSublocations(raw.inventory || {});
    raw.transactions = raw.transactions || {};

    const SUBLOCATION_MAP = (typeof window !== 'undefined' && window.SUBLOCATION_MAP) ? window.SUBLOCATION_MAP : null;

    // 4) Enrich items with deterministic rates (if helper exists)
    // NOTE: calculateRatesFromTransactions() in data_migration_helpers was made deterministic
    // in the earlier refactor (anchored to available transaction dates).
    if (typeof window.enrichItemsWithTransactionRates === 'function') {
      try {
        window.enrichItemsWithTransactionRates(raw.items, raw.transactions);
      } catch (e) {
        console.warn('Compute: enrichItemsWithTransactionRates failed:', e);
      }
    }

    // 5) Normalize key per-item fields + compute baselines
    const items = raw.items.map((item) => {
      const it = item || {};
      const unitCost = safeNumber(it.unitCost, safeNumber(it.unitPrice, safeNumber(it.costPerUnit, 0)));
      it.unitCost = unitCost;
      it.unitPrice = unitCost; // keep legacy consumers stable
      it.costPerUnit = unitCost; // some pages still use costPerUnit

      // Derive per-item location totals from inventory if present
      const code = it.itemCode;
      const totals = computeLocationTotalsForItem(code, raw.inventory, SUBLOCATION_MAP);
      it.pyxis = safeNumber(it.pyxis, totals.pyxis);
      it.pharmacy = safeNumber(it.pharmacy, totals.pharmacy);
      it.quantity = safeNumber(it.quantity, totals.total);

      it.usageRate = Array.isArray(it.usageRate) ? it.usageRate.map((v) => safeNumber(v, 0)) : [];
      it.wasteRate = Array.isArray(it.wasteRate) ? it.wasteRate.map((v) => safeNumber(v, 0)) : [];
      it.restockRate = normalizeRestockRate(it.restockRate);
      it.restockRateCsv = it.restockRate.join(',');

      const baseline = robustWeeklyBaseline(it.usageRate);
      it._cachedWeeklyUsage = baseline.weeklyBaseline;
      it._cachedDailyUsage = baseline.dailyBaseline;
      it._usageConfidence = baseline.confidence;
      it._usageBaselineMethod = baseline.method;

      // Inventory projection fields used by details modals (Shortage Bulletin)
      const weekly = safeNumber(it._cachedWeeklyUsage, 0);
      const projectedUsage = weekly * safeNumber(opts.shelfLifeWeeks, safeNumber(localStorage.getItem('budPeriod'), 52));
      const invTotal = safeNumber(it.quantity, 0);
      const invPyxis = safeNumber(it.pyxis, 0);
      const excess = invTotal - projectedUsage;
      const excessPyxis = invPyxis - projectedUsage;
      it.projectedUsage = projectedUsage;
      it.excessInventory = excess;
      it.projectedWasteValue = excess > 0 ? excess * unitCost : 0;
      it.pyxisProjectedWasteValue = excessPyxis > 0 ? excessPyxis * unitCost : 0;
      it.daysSupply = weekly > 0 ? (invTotal / weekly) * 7 : (invTotal > 0 ? 999 : 0);

      return it;
    });

    // 6) Projected waste calculations (V2)
    // Option B: item-level daily usage forecast (selector: EWMA/median/Croston/changing)
    // Then predict expected units used until EARLIEST expiration among on-hand inventory.
    const todayISO = dateToLocalISO(new Date());
    // "asOf" date used for inactivity/trend computations.
    // Prefer explicit option, then lastUpdated from legacy data, then today.
    const asOfISO = String(
      (opts && (opts.asOfISO || (opts.usageParams && opts.usageParams.asOfISO))) ||
      rawLegacy.lastUpdated ||
      todayISO
    );
    const forecast = (ns.Forecast && typeof ns.Forecast.forecastFromDailySeries === 'function') ? ns.Forecast : null;

    // Build daily transaction maps once (dispense/restock/waste)
    const txDailyMaps = buildDailyTransactionMaps(rawLegacy.transactions || {});

    // Dispense-only daily usage maps (kept for backward-compat + inactivity/forecast helpers)
    // Prefer the dispense map we just built to avoid re-walking histories.
    const usageMaps = {
      byItem: txDailyMaps.byItemDispense,
      byItemSubloc: Object.create(null),
      minDate: txDailyMaps.minDate,
      maxDate: txDailyMaps.maxDate
    };

    // NOTE: byItemSubloc is only required for inactivity-by-sublocation.
    // Rebuild it only when needed by the caller (keeps load time down).
    if (opts && opts.includeSublocationUsageMaps) {
      try {
        const full = buildDailyDispenseMaps(rawLegacy.transactions || {});
        usageMaps.byItemSubloc = full.byItemSubloc || Object.create(null);
      } catch (e) {
        usageMaps.byItemSubloc = Object.create(null);
      }
    }

    // Inactivity risk (Option A: item+sublocation, Option B: item-level)
    const inactivityThresholdPct = safeNumber(
      (opts && (opts.inactivityThresholdPct || (opts.usageParams && opts.usageParams.inactivityThresholdPct))) || 
      safeNumber((win.localStorage && win.localStorage.getItem('inactivityThresholdPct')), 90) ||
      90,
      90
    );
    const inactivityMaps = buildInactivityRiskMaps(usageMaps, asOfISO, inactivityThresholdPct);
    const byItemDaily = usageMaps.byItem;

    // ---------------------------------------------------------------------------------
    // Precompute full-range weekly bins once at load time.
    // This prevents week/day views from "dropping" prior months and avoids expensive
    // per-render recomputation in chartsPage.js.
    // ---------------------------------------------------------------------------------
    const precomputeWeeklyBins = (opts && Object.prototype.hasOwnProperty.call(opts, 'precomputeWeeklyBins'))
      ? !!opts.precomputeWeeklyBins
      : true;

    const globalMinISO = txDailyMaps && txDailyMaps.minDate ? txDailyMaps.minDate : null;
    const globalMaxISO = txDailyMaps && txDailyMaps.maxDate ? txDailyMaps.maxDate : null;

    function _buildWeeklyBinsForItem(hist, anchorISO, weeks) {
      const usage = new Array(weeks).fill(0);
      const restock = new Array(weeks).fill(0);
      const waste = new Array(weeks).fill(0);
      if (!hist || !hist.length || !anchorISO) return { usage, restock, waste };
      const minISO = addDaysISO(anchorISO, -(weeks * 7));

      for (let i = 0; i < hist.length; i++) {
        const r = hist[i] || {};
        const iso = typeof r.transDate === 'string' ? r.transDate.slice(0, 10)
          : (typeof r.date === 'string' ? r.date.slice(0, 10)
          : (typeof r.transdate === 'string' ? r.transdate.slice(0, 10) : ''));
        if (!iso || iso.length !== 10) continue;
        if (iso > anchorISO) continue;
        if (iso <= minISO) continue;

        const diffDays = daysBetweenISO(iso, anchorISO);
        const idxFromEnd = Math.floor(diffDays / 7);
        const idx = (weeks - 1) - idxFromEnd;
        if (idx < 0 || idx >= weeks) continue;

        const rawQty = (r.transQty ?? r.TransQty ?? r.qty ?? r.Qty ?? r.TRANSQTY ?? 0);
        const absQty = Math.abs(parseFloat(rawQty) || 0);
        if (!absQty) continue;

        const t = String(r.transactionType || '').toLowerCase();
        if (t.includes('dispense')) usage[idx] += absQty;
        else if (t.includes('restock')) restock[idx] += absQty;
        else if (t.includes('waste')) waste[idx] += absQty;
      }

      return { usage, restock, waste };
    }

    if (precomputeWeeklyBins && globalMaxISO && Array.isArray(items)) {
      // Weeks needed to cover min..max, capped for performance
      let weeksSpan = 12;
      if (globalMinISO) {
        const spanDays = Math.max(1, daysBetweenISO(globalMinISO, globalMaxISO) + 1);
        weeksSpan = Math.max(1, Math.ceil(spanDays / 7));
      }
      weeksSpan = Math.min(104, weeksSpan);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const code = String(it && it.itemCode != null ? it.itemCode : '');
        if (!code) continue;
        const entry = rawLegacy.transactions && rawLegacy.transactions[code];
        const hist = entry && Array.isArray(entry.history) ? entry.history : [];
        const bins = _buildWeeklyBinsForItem(hist, globalMaxISO, weeksSpan);

        // Attach for fast reuse by charts
        it.__txWeekly = {
          anchorISO: globalMaxISO,
          minISO: globalMinISO,
          maxISO: globalMaxISO,
          weeks: weeksSpan
        };

        // Use these as the canonical weekly series (so week view spans all loaded months)
        it.usageRate = bins.usage;
        it.restockRate = bins.restock;
        it.wasteRate = bins.waste;
        it.restockRateCsv = bins.restock.join(',');

        // Refresh baselines now that full-range weekly series is available
        const baseline = robustWeeklyBaseline(it.usageRate);
        it._cachedWeeklyUsage = baseline.weeklyBaseline;
        it._cachedDailyUsage = baseline.dailyBaseline;
        it._usageConfidence = baseline.confidence;
        it._usageBaselineMethod = baseline.method;
      }
    }

    // ---------------------------------------------------------------------------------
    // OPTIONAL IMPROVEMENTS (v23k):
    // Expose normalized usage series for Trend Line charts + richer forecasting outputs.
    // - If enrichItemsWithTransactionRates did not populate usageRate, rebuild weekly bins
    //   from the daily dispense maps so time-series charts can render.
    // - Also expose dense daily history + simple forward projection + forecasting metadata.
    // ---------------------------------------------------------------------------------
    const _weeksForRates = safeNumber((opts && opts.usageParams && opts.usageParams.weeks), 12) || 12;

    function _buildWeeklyUsageBinsFromSparseDaily(sparseDailyMap, anchorISO, weeks) {
      const out = new Array(weeks).fill(0);
      if (!sparseDailyMap || typeof sparseDailyMap !== 'object') return out;

      // Anchor to the provided date (asOfISO) for deterministic bins.
      // Bin index 0 = oldest, last index = most recent (matches calculateRatesFromTransactions)
      for (let i = weeks - 1; i >= 0; i--) {
        const weekEndISO = addDaysISO(anchorISO, -(i * 7));
        const weekStartISO = addDaysISO(weekEndISO, -7);

        let sum = 0;
        // Sparse map keys are yyyy-mm-dd
        for (const k in sparseDailyMap) {
          if (!Object.prototype.hasOwnProperty.call(sparseDailyMap, k)) continue;
          // Include dates in (weekStart, weekEnd] to align with legacy logic
          if (k > weekStartISO && k <= weekEndISO) sum += safeNumber(sparseDailyMap[k], 0);
        }
        out[weeks - 1 - i] = sum;
      }
      return out;
    }

    // Attach richer usage/forecast fields per item (non-breaking: charts can ignore extra fields)
    if (forecast && byItemDaily && Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const code = String(it && it.itemCode != null ? it.itemCode : '');
        if (!code) continue;

        const sparse = byItemDaily[code] || {};

        // Dense daily history (numbers), ending at asOfISO
        const dailyHistory = forecast.materializeDailySeries(
          sparse,
          usageMaps.minDate || asOfISO,
          asOfISO
        );

        it.usageActualDailySeries = Array.isArray(dailyHistory) ? dailyHistory.map((v) => safeNumber(v, 0)) : [];
        it.usageHistoryStartISO = usageMaps.minDate || asOfISO;
        it.usageHistoryEndISO = asOfISO;

        // Forecast summary + meta (expected daily usage, method, metrics, etc.)
        const f = forecast.forecastFromDailySeries(it.usageActualDailySeries, (opts && opts.usageParams) || {});
        it.usageForecast = f || { expectedDailyUsage: 0, seriesType: 'none', method: 'none', metrics: {} };
        it.usageExpectedDaily = safeNumber(it.usageForecast.expectedDailyUsage, 0);
        it.usageSeriesType = it.usageForecast.seriesType || 'none';
        it.usageForecastMethod = it.usageForecast.method || 'none';
        it.usageForecastMetrics = it.usageForecast.metrics || {};

        // Simple forward projection series (constant expected daily usage)
        const projectionDays = safeNumber((opts && opts.usageParams && opts.usageParams.projectionDays), 90) || 90;
        it.usageForecastDailySeries = new Array(projectionDays).fill(it.usageExpectedDaily);
        it.usageForecastStartISO = addDaysISO(asOfISO, 1);
        it.usageForecastEndISO = addDaysISO(asOfISO, projectionDays);

        // Ensure weekly usageRate exists for time-series charts (variance / usage vs restock)
        const hasWeekly = Array.isArray(it.usageRate) && it.usageRate.some((v) => safeNumber(v, 0) !== 0);
        if (!hasWeekly) {
          it.usageRate = _buildWeeklyUsageBinsFromSparseDaily(sparse, asOfISO, _weeksForRates);
        }

        // Recompute baselines using the now-available weekly usageRate
        const baseline = robustWeeklyBaseline(it.usageRate);
        it._cachedWeeklyUsage = baseline.weeklyBaseline;
        it._cachedDailyUsage = baseline.dailyBaseline;
        it._usageConfidence = baseline.confidence;
        it._usageBaselineMethod = baseline.method;
      }
    }

    let projectedWasteTotal = 0;
    const projectedWasteItems = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const itemCode = String(it.itemCode || '');
      if (!itemCode) continue;

      const unitPrice = safeNumber(it.unitPrice, safeNumber(it.unitCost, 0));
      if (unitPrice <= 0) continue;

      // Find earliest expiration among on-hand inventory (qty > 0) across all sublocations
      const invEntry = raw.inventory && raw.inventory[itemCode];
      const subs = invEntry && Array.isArray(invEntry.sublocations) ? invEntry.sublocations : [];
      let earliest = null;
      let totalQty = 0;
      let pyxisQty = 0;
      let pharmacyQty = 0;

      for (let s = 0; s < subs.length; s++) {
        const sub = subs[s] || {};
        const qty = safeNumber(sub.curQty, 0);
        if (qty <= 0) continue;
        totalQty += qty;
        const code = sub.sublocation;
        const info = (SUBLOCATION_MAP && code && SUBLOCATION_MAP[code]) || null;
        const dept = info && info.department ? String(info.department).toLowerCase() : 'pharmacy';
        if (dept === 'pyxis') pyxisQty += qty;
        else pharmacyQty += qty;

        const exp = typeof sub.expires === 'string' ? sub.expires : '';
        if (exp && exp.length >= 10) {
          const d = exp.slice(0, 10);
          if (d >= todayISO) {
            if (!earliest || d < earliest) earliest = d;
          }
        }
      }

      if (totalQty <= 0) continue;
      if (!earliest) continue; // no expiration info => do not include in V2 list

      const daysToExpire = daysBetweenISO(todayISO, earliest);

      // Build daily series from sparse map (full history as available, ending today)
      const sparse = byItemDaily[itemCode] || {};
      const series = forecast ? forecast.materializeDailySeries(sparse, usageMaps.minDate || todayISO, todayISO) : [];
      const f = forecast ? forecast.forecastFromDailySeries(series) : { expectedDailyUsage: 0, seriesType: 'none', method: 'none', metrics: {} };
      const expectedDaily = safeNumber(f.expectedDailyUsage, 0);
      const expectedUsed = expectedDaily * daysToExpire;
      const willUse = Math.min(totalQty, expectedUsed);
      const leftover = Math.max(0, totalQty - willUse);
      const wasteCost = leftover * unitPrice;

      if (wasteCost <= 0) continue;

      projectedWasteTotal += wasteCost;
      projectedWasteItems.push({
        itemCode,
        description: it.description,
        drugName: it.drugName,
        unitPrice,
        currentQty: totalQty,
        pyxisQty,
        pharmacyQty,
        earliestExpiration: earliest,
        daysToExpire,
        expectedDailyUsage: expectedDaily,
        expectedUseUntilExpire: willUse,
        leftoverQty: leftover,
        projectedWasteCost: wasteCost,
        seriesType: f.seriesType,
        forecastMethod: f.method,
        forecastMetrics: f.metrics
      });
    }

    // Sort highest waste cost first
    projectedWasteItems.sort((a, b) => safeNumber(b.projectedWasteCost, 0) - safeNumber(a.projectedWasteCost, 0));

    // Keep legacy shelf-life projected waste for reference (do not drive UI)
    const shelfLifeWeeks = safeNumber(opts.shelfLifeWeeks, safeNumber(localStorage.getItem('budPeriod'), 52));

    const asOfDate = deriveAsOfDateFromTransactions(raw.transactions);

    // 6.5) Weekly cost series (used by Analytics)
    const wasteCostsByWeek = sumSeriesCostByWeek(items, 'wasteRate');
    const restockCostsByWeek = sumSeriesCostByWeek(items, 'restockRate');

    const usageVsRestockThreshold = safeNumber(opts.usageRestockThreshold, safeNumber(localStorage.getItem('usageRestockThreshold'), 0.5));
    const usageVsRestock = computeUsageVsRestock(items, usageVsRestockThreshold);

    // 7) Trends (usage / waste / restock)
    // Prefer the integrated multi-series wrapper when available.
    let trends = null;
    if (typeof window.calculateAllTrendsAdvanced === 'function') {
      try {
        trends = window.calculateAllTrendsAdvanced(items, safeNumber(opts.trendThresholdWeeks, 2));
      } catch (e) {
        console.warn('Compute: calculateAllTrendsAdvanced failed:', e);
      }
    } else if (typeof window.calculateTrendingItemsAdvanced === 'function') {
      try {
        trends = { usage: window.calculateTrendingItemsAdvanced(items, safeNumber(opts.trendThresholdWeeks, 2)) };
      } catch (e) {
        console.warn('Compute: calculateTrendingItemsAdvanced failed:', e);
      }
    }

    const computed = {
      asOfDate: asOfDate.toISOString(),
      shelfLifeWeeks,
      wasteCostsByWeek,
      restockCostsByWeek,
      usageVsRestock,
      projectedWaste: {
        totalCost: projectedWasteTotal,
        itemCount: projectedWasteItems.length,
        items: projectedWasteItems,
        shelfLife: shelfLifeWeeks
      },
      // Legacy field kept for compatibility; V2 projected waste is computed item-level
      // (across all sublocations) based on earliest expiration.
      pyxisProjectedWaste: {
        totalCost: 0,
        itemCount: 0,
        items: [],
        shelfLife: shelfLifeWeeks
      },
      trends,
      dailyDispense: {
        byItem: usageMaps.byItem,
        byItemSubloc: usageMaps.byItemSubloc,
        minDate: usageMaps.minDate,
        maxDate: usageMaps.maxDate
      },
      dailyTransactions: {
        // Sparse daily maps keyed by ISO date (yyyy-mm-dd)
        byItemDispense: txDailyMaps.byItemDispense,
        byItemRestock: txDailyMaps.byItemRestock,
        byItemWaste: txDailyMaps.byItemWaste,
        minDate: txDailyMaps.minDate,
        maxDate: txDailyMaps.maxDate
      },
      inactivityRisk: {
        thresholdPct: inactivityThresholdPct,
        startISO: inactivityMaps.startISO,
        endISO: inactivityMaps.endISO,
        byItem: inactivityMaps.riskByItem,
        byItemSubloc: inactivityMaps.riskByItemSubloc
      }
    };

    // 8) Build computed legacy shape (what your iframes already expect)
    const computedLegacy = deepClone(raw);
    computedLegacy.items = items;
    computedLegacy.projectedWaste = computed.projectedWaste;
    computedLegacy.pyxisProjectedWaste = computed.pyxisProjectedWaste;
    computedLegacy.wasteCostsByWeek = wasteCostsByWeek;
    computedLegacy.restockCostsByWeek = restockCostsByWeek;
    computedLegacy.usageVsRestock = usageVsRestock;
    computedLegacy.trends = trends;
    // Backwards compatibility: some UIs expect `trendingItems` at top level.
    // Use usage trends as the canonical default.
    computedLegacy.trendingItems = trends && trends.usage ? trends.usage : (trends && trends.trendingUp ? trends : null);
    computedLegacy.asOfDate = computed.asOfDate;

    _store = {
      rawLegacy: rawLegacy,
      raw,
      computed,
      computedLegacy
    };

    return _store;
  }

  function getStore() {
    return _store;
  }

  ns.Compute = {
    buildStoreFromGlobals,
    getStore
  };
})();
