
/* js/app/spikeFactors.js
 * Trend spike multipliers (cached to Google Sheets via Apps Script Web App)
 *
 * Current model:
 * - Dispense-only
 * - Weekly totals
 * - Primary granularity for projections: itemCode + sendToLocation
 * - Also computes itemCode (ALL locations) as a cheap fallback
 * - Backwards compatible getters for older min-suggestion code paths
 */

(function () {
  const EPS = 1e-9;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function _txDateISO(rec) {
    return rec.transDate || rec.transactionDate || rec.date || null;
  }
  function _txTypeLower(rec) {
    return String(rec.transactionType || '').toLowerCase();
  }
  function _txQty(rec) {
    const n = Number(rec.TransQty ?? rec.qty ?? 0);
    return Math.abs(isFinite(n) ? n : 0);
  }
  function _txLocation(rec) {
    return String(rec.sendToLocation || rec.sublocation || '').trim().toUpperCase();
  }

  // Sublocation / destination-unit extractor used by itemLocSubloc aggregations.
  // Tries multiple common field names across exports.
  function _txSublocation(rec) {
    const v = (
      rec.sendToSublocation ??
      rec.sendToSubLocation ??
      rec.sendToSubLoc ??
      rec.sendToUnit ??
      rec.sendToDept ??
      rec.sendToDepartment ??
      rec.subLocation ??
      rec.subLoc ??
      rec.sublocation ??
      rec.unit ??
      rec.unitName ??
      ''
    );
    return String(v || '').trim().toUpperCase();
  }

  function _txItemCode(rec) {
    // When loaded as object buckets, _flattenTransactions injects itemCode.
    return String(rec.itemCode || rec.item || rec.code || rec.ItemCode || '').trim();
  }

  function _flattenTransactions(tx) {
    if (!tx) return [];
    if (Array.isArray(tx)) return tx;
    const out = [];
    for (const k of Object.keys(tx)) {
      const h = tx[k] && tx[k].history;
      if (Array.isArray(h)) {
        for (const rec of h) out.push(Object.assign({ itemCode: k }, rec));
      }
    }
    return out;
  }

  function _isoWeekKey(d) {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
    const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((dt - firstThu) / (7 * 24 * 3600 * 1000));
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
  }

  function _buildWeekIndex(transactions, endDateISO, weeksBack) {
    const tx = _flattenTransactions(transactions);
    const end = new Date(endDateISO);
    const start = new Date(end.getTime() - weeksBack * 7 * 86400000);

    const weekIndex = new Map();
    const weeks = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate()+7)) {
      const wk = _isoWeekKey(d);
      if (!weekIndex.has(wk)) {
        weekIndex.set(wk, weeks.length);
        weeks.push(wk);
      }
    }

    return { tx, start, end, weekIndex, weeks };
  }

  function _ensureSeries(map, key, len) {
    let arr = map.get(key);
    if (!arr) {
      arr = new Array(len).fill(0);
      map.set(key, arr);
    }
    return arr;
  }

  function _buildWeeklyByItemAndLocation(transactions, endDateISO, weeksBack) {
    const { tx, start, end, weekIndex, weeks } = _buildWeekIndex(transactions, endDateISO, weeksBack);

    const itemMap = new Map();      // itemCode -> series
    const itemLocMap = new Map();   // itemCode|LOC -> series
    const locMap = new Map();       // LOC -> series (optional)

    for (const rec of tx) {
      if (_txTypeLower(rec) !== 'dispense') continue;
      const code = _txItemCode(rec);
      if (!code) continue;
      const dISO = _txDateISO(rec);
      if (!dISO) continue;
      const d = new Date(dISO);
      if (d < start || d > end) continue;

      const loc = _txLocation(rec);
      if (!loc) continue;
      const wk = _isoWeekKey(d);
      const idx = weekIndex.get(wk);
      if (idx == null) continue;

      const q = _txQty(rec);
      if (!q) continue;

      _ensureSeries(itemMap, code, weeks.length)[idx] += q;
      _ensureSeries(itemLocMap, `${code}|${loc}`, weeks.length)[idx] += q;
      _ensureSeries(locMap, loc, weeks.length)[idx] += q;
    }

    return { itemMap, itemLocMap, locMap, weeks };
  }


function _buildWeeklyByItemLocSubloc(transactions, endDateISO, weeksBack) {
  const { tx, start, end, weekIndex, weeks } = _buildWeekIndex(transactions, endDateISO, weeksBack);

  const itemMap = new Map();                // itemCode -> series
  const itemLocMap = new Map();             // itemCode|LOC -> series
  const itemLocSublocMap = new Map();       // itemCode|LOC|SUBLOC -> series
  const locMap = new Map();                 // LOC -> series
  const sublocMap = new Map();              // SUBLOC -> series

  for (const rec of tx) {
    if (_txTypeLower(rec) !== 'dispense') continue;
    const code = _txItemCode(rec);
    if (!code) continue;
    const dISO = _txDateISO(rec);
    if (!dISO) continue;
    const d = new Date(dISO);
    if (d < start || d > end) continue;

    const loc = _txLocation(rec);
    if (!loc) continue;

    const subloc = _txSublocation(rec) || 'UNKNOWN';

    const wk = _isoWeekKey(d);
    const idx = weekIndex.get(wk);
    if (idx == null) continue;

    const q = _txQty(rec);
    if (!q) continue;

    _ensureSeries(itemMap, code, weeks.length)[idx] += q;
    _ensureSeries(itemLocMap, `${code}|${loc}`, weeks.length)[idx] += q;
    _ensureSeries(itemLocSublocMap, `${code}|${loc}|${subloc}`, weeks.length)[idx] += q;
    _ensureSeries(locMap, loc, weeks.length)[idx] += q;
    _ensureSeries(sublocMap, subloc, weeks.length)[idx] += q;
  }

  return { itemMap, itemLocMap, itemLocSublocMap, locMap, sublocMap, weeks };
}

function _weekKeyToOrdinal(weekKey) {
  // weekKey: "YYYY-Www"
  const m = /^(\d{4})-W(\d{2})$/.exec(String(weekKey || '').trim());
  if (!m) return null;
  return (parseInt(m[1], 10) * 100) + parseInt(m[2], 10);
}

function _buildAllTimeWeeklyMaps(transactions) {
  const tx = _flattenTransactions(transactions);

  const itemWeekly = new Map();            // item -> Map(weekKey -> qty)
  const itemLocWeekly = new Map();         // item|LOC -> Map
  const itemLocSublocWeekly = new Map();   // item|LOC|SUBLOC -> Map

  function add(map, key, weekKey, qty) {
    let wkMap = map.get(key);
    if (!wkMap) { wkMap = new Map(); map.set(key, wkMap); }
    wkMap.set(weekKey, (wkMap.get(weekKey) || 0) + qty);
  }

  for (const rec of tx) {
    if (_txTypeLower(rec) !== 'dispense') continue;
    const code = _txItemCode(rec);
    if (!code) continue;

    const dISO = _txDateISO(rec);
    if (!dISO) continue;

    const d = new Date(dISO);
    if (!Number.isFinite(d.getTime())) continue;

    const loc = _txLocation(rec);
    if (!loc) continue;

    const subloc = _txSublocation(rec) || 'UNKNOWN';

    const weekKey = _isoWeekKey(d);
    const qty = _txQty(rec);
    if (!qty) continue;

    add(itemWeekly, String(code), weekKey, qty);
    add(itemLocWeekly, `${code}|${loc}`, weekKey, qty);
    add(itemLocSublocWeekly, `${code}|${loc}|${subloc}`, weekKey, qty);
  }

  return { itemWeekly, itemLocWeekly, itemLocSublocWeekly };
}

function _computeSeasonalityTrendStats(weekMap) {
  if (!weekMap || weekMap.size < 12) return null;

  // Sort week keys chronologically
  const entries = Array.from(weekMap.entries())
    .map(([wk, v]) => ({ wk, ord: _weekKeyToOrdinal(wk), v: Number(v) || 0 }))
    .filter(x => x.ord != null);

  entries.sort((a, b) => a.ord - b.ord);

  // Use up to last 156 weeks (3 years) for trend/sigma stability
  const maxWeeks = 156;
  const tail = entries.slice(Math.max(0, entries.length - maxWeeks));

  const values = tail.map(x => x.v);
  const mean = _mean(values);
  if (!(mean > 0)) return null;

  // Week-of-year seasonality
  const woySum = Array(54).fill(0);
  const woyCnt = Array(54).fill(0);
  for (const x of entries) {
    const m = /-W(\d{2})$/.exec(x.wk);
    if (!m) continue;
    const w = parseInt(m[1], 10);
    if (w < 1 || w > 53) continue;
    woySum[w] += x.v;
    woyCnt[w] += 1;
  }
  const woy = Array(54).fill(1);
  for (let w = 1; w <= 53; w++) {
    if (woyCnt[w] <= 0) { woy[w] = 1; continue; }
    let f = (woySum[w] / woyCnt[w]) / mean;
    // shrink sparse weeks toward 1.0
    const shrink = clamp(woyCnt[w] / 6, 0, 1);
    f = 1 + (f - 1) * shrink;
    woy[w] = clamp(f, 0.6, 1.6);
  }

  // Trend (relative per week) via simple linear regression on tail
  const n = tail.length;
  const xVals = tail.map((_, i) => i);
  const yVals = values;

  const xMean = (n - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xVals[i] - xMean;
    num += dx * (yVals[i] - mean);
    den += dx * dx;
  }
  const slope = (den > 0) ? (num / den) : 0; // qty per week
  let trendRel = slope / Math.max(mean, EPS); // relative per week
  trendRel = clamp(trendRel, -0.02, 0.02);

  // Residual sigma (relative) on tail after removing trend+seasonality
  let resid = [];
  for (let i = 0; i < n; i++) {
    const wk = tail[i].wk;
    const m = /-W(\d{2})$/.exec(wk);
    const w = m ? parseInt(m[1], 10) : 0;
    const seasonF = (w >= 1 && w <= 53) ? (woy[w] || 1) : 1;
    const trendF = 1 + trendRel * (i - (n - 1) / 2);
    const pred = mean * seasonF * trendF;
    resid.push(yVals[i] - pred);
  }
  const residMean = _mean(resid);
  const residVar = resid.reduce((a, r) => a + Math.pow(r - residMean, 2), 0) / Math.max(resid.length, 1);
  let sigmaRel = Math.sqrt(residVar) / Math.max(mean, EPS);
  sigmaRel = clamp(sigmaRel, 0, 1);

  return { woy, mean, trendRel, sigmaRel, weeksUsed: entries.length };
}


  function _mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a,b)=>a+b,0)/arr.length;
  }

  function _computeSpike(series) {
  if (!series || series.length < 16) return null;
  const recent = series.slice(-4);
  const base = series.slice(-16, -4);
  const recentMean = _mean(recent);
  const baseMean = _mean(base);
  const ratio = recentMean / Math.max(baseMean, EPS);
  if (!Number.isFinite(ratio) || ratio < 1.15) return null;
  const spike = clamp(Math.pow(ratio, 0.5), 1.0, 1.6);
  const confidence = clamp(base.filter(x => x > 0).length / Math.max(base.length, 1), 0, 1);
  return { spike, confidence, ratio, baseMean, recentMean };
}

  
function computeSpikeFactorTable(params) {
  const transactions = params.transactions;
  const endDateISO = params.endDateISO || new Date().toISOString();
  const computedOn = new Date().toISOString();

  const spikeWindowTag = 'weekly_recent4_vs_base12';
  const seasonWindowTag = 'seasonality_woy_v2';
  const trendWindowTag = 'trend_annual_v1';

  // Spike factors (recent vs baseline) for last N weeks
  const weeksBackForSpike = 26;
  const { itemMap, itemLocMap, itemLocSublocMap, locMap, sublocMap, weeks } =
    _buildWeeklyByItemLocSubloc(transactions, endDateISO, weeksBackForSpike);

  // All-time weekly maps for multi-year seasonality/trend
  const allTime = _buildAllTimeWeeklyMaps(transactions);

  const rows = [];
  let itemN = 0, itemLocN = 0, itemLocSublocN = 0, locN = 0, sublocN = 0;
  let itemSeasonN = 0, itemLocSeasonN = 0, itemLocSublocSeasonN = 0;

  // --- Spike rows (multiplier) ---
  for (const [k, series] of itemLocSublocMap.entries()) {
    const r = _computeSpike(series);
    if (!r) continue;
    itemLocSublocN++;
    rows.push(['itemLocSubloc', k, +r.spike.toFixed(2), +r.confidence.toFixed(2), computedOn, spikeWindowTag,
      `ratio=${r.ratio.toFixed(2)};base=${r.baseMean.toFixed(2)};recent=${r.recentMean.toFixed(2)}`]);
  }

  for (const [k, series] of itemLocMap.entries()) {
    const r = _computeSpike(series);
    if (!r) continue;
    itemLocN++;
    rows.push(['itemLoc', k, +r.spike.toFixed(2), +r.confidence.toFixed(2), computedOn, spikeWindowTag,
      `ratio=${r.ratio.toFixed(2)};base=${r.baseMean.toFixed(2)};recent=${r.recentMean.toFixed(2)}`]);
  }

  for (const [code, series] of itemMap.entries()) {
    const r = _computeSpike(series);
    if (!r) continue;
    itemN++;
    rows.push(['item', code, +r.spike.toFixed(2), +r.confidence.toFixed(2), computedOn, spikeWindowTag,
      `ratio=${r.ratio.toFixed(2)};base=${r.baseMean.toFixed(2)};recent=${r.recentMean.toFixed(2)}`]);
  }

  for (const [loc, series] of locMap.entries()) {
    const r = _computeSpike(series);
    if (!r) continue;
    locN++;
    rows.push(['location', loc, +r.spike.toFixed(2), +r.confidence.toFixed(2), computedOn, spikeWindowTag,
      `ratio=${r.ratio.toFixed(2)};base=${r.baseMean.toFixed(2)};recent=${r.recentMean.toFixed(2)}`]);
  }

  for (const [subloc, series] of sublocMap.entries()) {
    const r = _computeSpike(series);
    if (!r) continue;
    sublocN++;
    rows.push(['subloc', subloc, +r.spike.toFixed(2), +r.confidence.toFixed(2), computedOn, spikeWindowTag,
      `ratio=${r.ratio.toFixed(2)};base=${r.baseMean.toFixed(2)};recent=${r.recentMean.toFixed(2)}`]);
  }

  // --- Seasonality + trend rows (stored in notes as JSON) ---
  // Note: spikeMultiplier column is set to 1.0 for seasonality rows.
  function _pushSeasonRow(keyType, key, stats) {
    if (!stats) return;
    const quality = clamp((stats.weeksUsed || 0) / 52, 0, 1);
    rows.push([keyType, key, 1.0, +quality.toFixed(2), computedOn, seasonWindowTag,
      JSON.stringify({
        woy: stats.woy,
        mean: +stats.mean.toFixed(6),
        trendRel: +stats.trendRel.toFixed(6),
        sigmaRel: +stats.sigmaRel.toFixed(6),
        weeksUsed: stats.weeksUsed,
        tags: [seasonWindowTag, trendWindowTag]
      })
    ]);
  }

  for (const [k, wkMap] of allTime.itemLocSublocWeekly.entries()) {
    const stats = _computeSeasonalityTrendStats(wkMap);
    if (!stats) continue;
    itemLocSublocSeasonN++;
    _pushSeasonRow('itemLocSublocSeason', k, stats);
  }
  for (const [k, wkMap] of allTime.itemLocWeekly.entries()) {
    const stats = _computeSeasonalityTrendStats(wkMap);
    if (!stats) continue;
    itemLocSeasonN++;
    _pushSeasonRow('itemLocSeason', k, stats);
  }
  for (const [k, wkMap] of allTime.itemWeekly.entries()) {
    const stats = _computeSeasonalityTrendStats(wkMap);
    if (!stats) continue;
    itemSeasonN++;
    _pushSeasonRow('itemSeason', k, stats);
  }

  const counts = {
    pocket: 0,
    subloc: sublocN,
    item: itemN,
    itemLoc: itemLocN,
    itemLocSubloc: itemLocSublocN,
    location: locN,
    itemSeason: itemSeasonN,
    itemLocSeason: itemLocSeasonN,
    itemLocSublocSeason: itemLocSublocSeasonN,
    total: rows.length
  };

  return { rows, allRows: rows, meta: { computedOn, spikeWindowTag, seasonWindowTag }, counts, computedOn };
}

let _cache = null;


  
function _ingestRows(rows) {
  const locationMap = {};
  const sublocMap = {};
  const itemMap = {};
  const itemLocMap = {};
  const itemLocSublocMap = {};

  const seasonItemMap = {};
  const seasonItemLocMap = {};
  const seasonItemLocSublocMap = {};

  // Weighting index: item|LOC -> [{ subloc, key, base }]
  const itemLocToSubloc = {};

  let maxComputedOn = null;

  function parseBaseFromNotes(notes) {
    const s = String(notes || '');
    const m = /(?:^|;|\s)base=([0-9.]+)/i.exec(s);
    if (m) return Number(m[1]) || 0;
    return 0;
  }

  function parseSeasonNotes(notes) {
    try {
      const obj = JSON.parse(String(notes || ''));
      if (obj && Array.isArray(obj.woy)) return obj;
    } catch (e) {}
    return null;
  }

  function _isLikelyHeaderRow(r) {
    if (!Array.isArray(r)) return false;
    const c0 = String(r[0] || '').trim().toLowerCase();
    const c1 = String(r[1] || '').trim().toLowerCase();
    const c2 = String(r[2] || '').trim().toLowerCase();
    const headers0 = new Set(['keytype', 'key_type', 'type', 'kt']);
    const headers1 = new Set(['key', 'k']);
    const headers2 = new Set(['spikemultiplier', 'spike_multiplier', 'multiplier', 'mult', 'spike']);
    return headers0.has(c0) && headers1.has(c1) && headers2.has(c2);
  }

  for (const r0 of rows) {
    if (_isLikelyHeaderRow(r0)) continue;

    // Accept either array rows: [keyType,key,spikeMultiplier,confidence,computedOn,window,notes]
    // or object rows: {keyType,key,spikeMultiplier,confidence,computedOn,window,notes}
    const r = Array.isArray(r0)
      ? r0
      : [
          r0 && (r0.keyType ?? r0.key_type ?? r0.kt ?? r0.type),
          r0 && (r0.key ?? r0.k),
          r0 && (r0.spikeMultiplier ?? r0.spike_multiplier ?? r0.multiplier ?? r0.mult),
          r0 && (r0.confidence ?? r0.conf),
          r0 && (r0.computedOn ?? r0.computed_on ?? r0.computed_at ?? r0.computed),
          r0 && (r0.window ?? r0.win),
          r0 && (r0.notes ?? r0.note),
        ];

    const kt = String(r[0] || '').trim();

    const key = String(r[1] || '').trim();
    const mult = Number(r[2]);
    const computedOn = r[4] ? String(r[4]) : null;
    const notes = r[6];

    if (computedOn && (!maxComputedOn || new Date(computedOn) > new Date(maxComputedOn))) {
      maxComputedOn = computedOn;
    }

    if (kt === 'location') locationMap[key.toUpperCase()] = Number.isFinite(mult) ? mult : 1;
    else if (kt === 'subloc') sublocMap[key.toUpperCase()] = Number.isFinite(mult) ? mult : 1;
    else if (kt === 'item') itemMap[key] = Number.isFinite(mult) ? mult : 1;
    else if (kt === 'itemLoc') itemLocMap[key.toUpperCase()] = Number.isFinite(mult) ? mult : 1;
    else if (kt === 'itemLocSubloc') {
      itemLocSublocMap[key.toUpperCase()] = Number.isFinite(mult) ? mult : 1;

      // index for blending
      const parts = key.split('|');
      if (parts.length >= 3) {
        const item = parts[0];
        const loc = parts[1].toUpperCase();
        const sub = parts.slice(2).join('|').toUpperCase();
        const base = parseBaseFromNotes(notes);
        const il = `${item}|${loc}`;
        if (!itemLocToSubloc[il]) itemLocToSubloc[il] = [];
        itemLocToSubloc[il].push({ subloc: sub, key: key.toUpperCase(), base });
      }
    } else if (kt === 'itemSeason') {
      const obj = parseSeasonNotes(notes);
      if (obj) seasonItemMap[key] = obj;
    } else if (kt === 'itemLocSeason') {
      const obj = parseSeasonNotes(notes);
      if (obj) seasonItemLocMap[key.toUpperCase()] = obj;
    } else if (kt === 'itemLocSublocSeason') {
      const obj = parseSeasonNotes(notes);
      if (obj) seasonItemLocSublocMap[key.toUpperCase()] = obj;
    }
  }

  _cache = {
    locationMap,
    sublocMap,
    itemMap,
    itemLocMap,
    itemLocSublocMap,
    seasonItemMap,
    seasonItemLocMap,
    seasonItemLocSublocMap,
    itemLocToSubloc,
    maxComputedOn,
    loadedAt: new Date().toISOString()
  };

  return _cache;
}
function loadFromLocalStorage() {
    try { _cache = JSON.parse(localStorage.getItem('__spikeFactorCache') || 'null'); } catch (_) { _cache = null; }
    return _cache;
  }

  function getCacheSummary() {
  if (!_cache) loadFromLocalStorage();
  const c = _cache || {};
  return {
    location: c.locationMap ? Object.keys(c.locationMap).length : 0,
    subloc: c.sublocMap ? Object.keys(c.sublocMap).length : 0,
    item: c.itemMap ? Object.keys(c.itemMap).length : 0,
    itemLoc: c.itemLocMap ? Object.keys(c.itemLocMap).length : 0,
    itemLocSubloc: c.itemLocSublocMap ? Object.keys(c.itemLocSublocMap).length : 0,
    itemSeason: c.seasonItemMap ? Object.keys(c.seasonItemMap).length : 0,
    itemLocSeason: c.seasonItemLocMap ? Object.keys(c.seasonItemLocMap).length : 0,
    itemLocSublocSeason: c.seasonItemLocSublocMap ? Object.keys(c.seasonItemLocSublocMap).length : 0,
    maxComputedOn: c.maxComputedOn || null
  };
}

  function getSpikeMultiplierForLocation(loc){
    if(!_cache){
      loadFromLocalStorage();
    }
    if(!_cache||!_cache.locationMap) return 1.0;
    return _cache.locationMap[String(loc).toUpperCase()]||1.0;
  }

  function getSpikeMultiplierForItem(itemCode) {
    if (!_cache) loadFromLocalStorage();
    if (!_cache || !_cache.itemMap) return 1.0;
    return _cache.itemMap[String(itemCode)] || 1.0;
  }

  function getSpikeMultiplierForItemLocation(itemCode, loc) {
    if (!_cache) loadFromLocalStorage();
    if (!_cache || !_cache.itemLocMap) return 1.0;
    const k = `${String(itemCode)}|${String(loc || '').trim().toUpperCase()}`;
    return _cache.itemLocMap[k] || 1.0;
  }

  function getSpikeMultiplierForItemLocSubloc(itemCode, loc, subloc) {
  if (!_cache) loadFromLocalStorage();
  if (!_cache || !_cache.itemLocSublocMap) return 1.0;
  const k = `${String(itemCode)}|${String(loc || '').trim().toUpperCase()}|${String(subloc || '').trim().toUpperCase()}`;
  return _cache.itemLocSublocMap[k] || 1.0;
}

// If subloc is ALL, blend sublocation multipliers using baseline ("base=") weights when available.
function getSpikeMultiplierForScope(itemCode, loc, subloc) {
  const code = String(itemCode || '').trim();
  const L = String(loc || '').trim().toUpperCase();
  const S = String(subloc || '').trim().toUpperCase();

  if (!code) return 1.0;

  if (!_cache) loadFromLocalStorage();
  const c = _cache || {};

  // Most specific
  if (L && L !== 'ALL' && S && S !== 'ALL') {
    return getSpikeMultiplierForItemLocSubloc(code, L, S);
  }

  // Blend across subloc when loc is specific but subloc is ALL
  if (L && L !== 'ALL' && (!S || S === 'ALL')) {
    const il = `${code}|${L}`;
    const list = c.itemLocToSubloc ? c.itemLocToSubloc[il] : null;
    if (Array.isArray(list) && list.length) {
      let num = 0, den = 0;
      for (const it of list) {
        const w = Number(it.base) || 0;
        const m = c.itemLocSublocMap ? (c.itemLocSublocMap[it.key] || 1.0) : 1.0;
        if (w > 0) { num += m * w; den += w; }
      }
      if (den > 0) return num / den;
    }
    // fallback to itemLoc
    if (c.itemLocMap) return c.itemLocMap[il] || 1.0;
  }

  // fallback to item
  if (c.itemMap) return c.itemMap[code] || 1.0;
  return 1.0;
}

function _getSeasonObjForScope(itemCode, loc, subloc) {
  if (!_cache) loadFromLocalStorage();
  const c = _cache || {};
  const code = String(itemCode || '').trim();
  const L = String(loc || '').trim().toUpperCase();
  const S = String(subloc || '').trim().toUpperCase();

  if (code && L && L !== 'ALL' && S && S !== 'ALL') {
    const k = `${code}|${L}|${S}`;
    return (c.seasonItemLocSublocMap && c.seasonItemLocSublocMap[k]) || null;
  }
  if (code && L && L !== 'ALL') {
    const k = `${code}|${L}`;
    return (c.seasonItemLocMap && c.seasonItemLocMap[k]) || null;
  }
  if (code) return (c.seasonItemMap && c.seasonItemMap[code]) || null;
  return null;
}

function getSeasonalityFactorForScope(itemCode, loc, subloc, weekOfYear) {
  const obj = _getSeasonObjForScope(itemCode, loc, subloc);
  const w = Number(weekOfYear) || 0;
  if (!obj || !Array.isArray(obj.woy) || w < 1 || w > 53) return 1.0;
  return Number(obj.woy[w]) || 1.0;
}

function getTrendRelForScope(itemCode, loc, subloc) {
  const obj = _getSeasonObjForScope(itemCode, loc, subloc);
  return obj && Number.isFinite(Number(obj.trendRel)) ? Number(obj.trendRel) : 0.0;
}

function getSigmaRelForScope(itemCode, loc, subloc) {
  const obj = _getSeasonObjForScope(itemCode, loc, subloc);
  return obj && Number.isFinite(Number(obj.sigmaRel)) ? Number(obj.sigmaRel) : 0.0;
}

// Pocket helpers live at module scope (inside IIFE). A stray brace previously
// closed the module early, causing a parse error ("Unexpected token 'function'").
function getSpikeMultiplierForPocket(pocketKey, itemCode, sublocOrLoc) {
    if (!_cache) loadFromLocalStorage();
    const c = _cache || {};
    const pk = String(pocketKey || '').trim();
    if (pk && c.pocketMap && c.pocketMap[pk] != null) return Number(c.pocketMap[pk]) || 1.0;

    const code = String(itemCode || '').trim();
    const loc = String(sublocOrLoc || '').trim().toUpperCase();

    if (code && loc && c.itemLocMap && c.itemLocMap[`${code}|${loc}`] != null) return Number(c.itemLocMap[`${code}|${loc}`]) || 1.0;
    if (code && c.itemMap && c.itemMap[code] != null) return Number(c.itemMap[code]) || 1.0;
    if (loc && c.locationMap && c.locationMap[loc] != null) return Number(c.locationMap[loc]) || 1.0;
    if (loc && c.sublocMap && c.sublocMap[loc] != null) return Number(c.sublocMap[loc]) || 1.0;
    return 1.0;
}

  function _getSpikeBridgeFrame(){
  return document.getElementById('spikeBridgeFrame');
}

function _callSpikeBridge(op, payload, timeoutMs = 15000){
  return new Promise((resolve, reject) => {
    const frame = _getSpikeBridgeFrame();
    if (!frame || !frame.contentWindow) {
      reject(new Error('Spike bridge iframe not ready'));
      return;
    }
    const reqId = 'req_' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('Spike bridge timeout'));
    }, timeoutMs);

    function onMsg(evt){
      const msg = evt && evt.data ? evt.data : null;
      if (!msg || msg.__spikeBridge !== true) return;
      if (msg.reqId !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      if (!msg.ok) reject(new Error(msg.error || 'bridge error'));
      else resolve(msg);
    }

    window.addEventListener('message', onMsg);
    frame.contentWindow.postMessage({ __spikeBridge: true, reqId, op, ...(payload||{}) }, '*');
  });
}

  
// ===== Local-file safe transport (no CORS) =====
function _isLocalFileOrigin(){
  return (window.location && (window.location.protocol === 'file:' || window.location.origin === 'null'));
}

function _buildReadQuery(sheetId, tabName){
  const p = new URLSearchParams();
  // Keep canonical params + common aliases used by different Apps Script handlers.
  p.set('action', 'read');
  p.set('op', 'read');
  p.set('mode', 'read');
  p.set('sheetId', sheetId || '');
  p.set('spreadsheetId', sheetId || '');
  p.set('tabName', tabName || '');
  p.set('sheetName', tabName || '');
  return p.toString();
}

// JSONP: load data via <script> tag (works from file://)
function _jsonp(url, timeoutMs = 15000){
  return new Promise((resolve, reject) => {
    const cbName = '__spike_jsonp_cb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, timeoutMs);

    function cleanup(){
      clearTimeout(timer);
      try{ delete window[cbName]; }catch(_){}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const sep = url.includes('?') ? '&' : '?';
    script.src = url + sep + 'callback=' + encodeURIComponent(cbName);
    script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
    document.head.appendChild(script);
  });
}

// Form POST to hidden iframe (works from file:// for cross-origin POST)
function _formPost(url, fields, timeoutMs = 2000){
  return new Promise((resolve) => {
    const iframeName = '__spike_post_iframe_' + Math.random().toString(36).slice(2);
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = iframeName;
    form.style.display = 'none';

    for(const [k,v] of Object.entries(fields || {})){
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = (v == null) ? '' : String(v);
      form.appendChild(input);
    }

    document.body.appendChild(form);

    const cleanup = () => {
      try{ form.remove(); }catch(_){}
      try{ iframe.remove(); }catch(_){}
    };

    iframe.onload = () => { cleanup(); resolve({ ok:true }); };
    form.submit();

    // Best-effort resolve even if onload doesn't fire
    setTimeout(() => { cleanup(); resolve({ ok:true }); }, timeoutMs);
  });
}

async function saveToWebApp(webAppUrl,sheetId,tabName,rows){
  // Local file origin: use form POST (no CORS) + ingest locally
  if(_isLocalFileOrigin()){
    // Use form POST to avoid CORS on file://. Many Apps Script handlers read e.parameter.*
    await _formPost(webAppUrl, {
      action: 'write',
      op: 'write',
      mode: 'write',
      sheetId: sheetId,
      spreadsheetId: sheetId,
      tabName: tabName,
      sheetName: tabName,
      payload: JSON.stringify({ rows: rows }),
      rows: JSON.stringify(rows),
      data: JSON.stringify(rows),
      json: JSON.stringify({ rows: rows })
    });
    // Optimistically ingest locally.
    _ingestRows(rows);

    // Verify write by reading back a sample (Apps Script can silently fail if permissions/deployment are wrong).
    try{
      await new Promise(r=>setTimeout(r, 500));
      const qs = _buildReadQuery(sheetId, tabName);
      const raw = await _jsonp(`${webAppUrl}?${qs}`, 15000);
      const norm = _normalizeReadResponse(raw);
      if(!norm.ok) throw new Error(norm.error || 'read-back failed');
      if(!norm.rows || !norm.rows.length) throw new Error('read-back returned 0 rows');
    }catch(e){
      throw new Error('Write POST was sent, but verification failed (' + (e && e.message ? e.message : String(e)) + '). Check: (1) Web App is deployed as "Anyone" can access, (2) script has permission to edit the target sheet, (3) sheetId/tabName are correct.');
    }

    return { ok:true, method:'formpost' };
  }

  // Non-local origins: try fetch JSON
  const res=await fetch(webAppUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'write',sheetId,tabName,rows})});
  const json=await res.json();
  if(!json.ok) throw new Error(json.error||'write failed');
  _ingestRows(rows);
  return json;
}


  
function _normalizeReadResponse(payload){
  // Apps Script responses vary: {ok,rows}, {rows}, array, {data}, {result:{rows}}, etc.
  if (payload == null) return { ok: false, rows: [], error: 'empty response' };

  // If JSONP returns a string, attempt parse.
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) {
      return { ok: false, rows: [], error: 'non-json response' };
    }
  }

  // Direct array
  if (Array.isArray(payload)) return { ok: true, rows: payload };

  // Common nesting
  const rows =
    payload.rows ??
    payload.data ??
    payload.values ??
    (payload.result && payload.result.rows) ??
    (payload.payload && payload.payload.rows) ??
    (payload.response && payload.response.rows) ??
    null;

  if (Array.isArray(rows)) return { ok: payload.ok !== false, rows };

  // Sometimes the sheet API returns {ok:true, values:[[...]]}
  const values = payload.values ?? payload.value ?? null;
  if (Array.isArray(values)) return { ok: payload.ok !== false, rows: values };

  // Fallback: if ok is true but rows missing, treat as empty.
  return { ok: payload.ok === true, rows: [], error: payload.error || 'rows missing' };
}

async function loadFromWebApp(webAppUrl,sheetId,tabName){
  const qs = _buildReadQuery(sheetId, tabName);

  // Local file origin: use JSONP (no CORS)
  if(_isLocalFileOrigin()){
    const url = `${webAppUrl}?${qs}`;
    const raw = await _jsonp(url, 15000);
    const norm = _normalizeReadResponse(raw);
    if(!norm.ok) throw new Error(norm.error || (raw && raw.error) || 'read failed');
    return _ingestRows(norm.rows || []);
  }

  const url = `${webAppUrl}?${qs}`;
  const res = await fetch(url, { method: 'GET' });

  // Apps Script sometimes returns text/html on errors; parse defensively
  const txt = await res.text();
  let raw = null;
  try { raw = JSON.parse(txt); } catch (e) { raw = txt; }

  const norm = _normalizeReadResponse(raw);
  if(!res.ok || !norm.ok){
    const hint = (typeof txt === 'string' && txt.slice) ? txt.slice(0, 220) : '';
    throw new Error(norm.error || (raw && raw.error) || `read failed (http ${res.status}) ${hint}`);
  }
  return _ingestRows(norm.rows || []);
}

async function pingWebApp(webAppUrl){
  // Local file origin: JSONP ping
  if(_isLocalFileOrigin()){
    const json = await _jsonp(`${webAppUrl}?action=ping`, 10000);
    if(!json || json.ok !== true) throw new Error((json && json.error) || 'ping failed');
    return json;
  }

  const res=await fetch(`${webAppUrl}?action=ping`);
  // ping may return JSON or text; attempt json
  const txt = await res.text();
  let json;
  try{ json = JSON.parse(txt); }catch(_){ json = { ok: res.ok, status: res.status, text: txt }; }
  if(!json.ok) throw new Error(json.error||('ping failed: '+(json.status||res.status)));
  return json;
}

window.SpikeFactors={
    // compute + cache
    computeSpikeFactorTable,
    saveToWebApp,
    loadFromWebApp,
    pingWebApp,
    loadFromLocalStorage,
    getCacheSummary,

    // multipliers
    getSpikeMultiplierForLocation,
    getSpikeMultiplierForSubloc: (s)=>{ if(!_cache) loadFromLocalStorage(); return (_cache&&_cache.sublocMap)?(_cache.sublocMap[String(s||'').toUpperCase()]||1.0):1.0; },
    getSpikeMultiplierForItem,
    getSpikeMultiplierForItemLocation,
    getSpikeMultiplierForItemLocSubloc,
    getSpikeMultiplierForScope,

    // seasonality + trend + uncertainty
    getSeasonalityFactorForScope,
    getTrendRelForScope,
    getSigmaRelForScope,

    // tx helpers used by dashboard/admin
    flattenTransactions: _flattenTransactions,
    getTxDateISO: _txDateISO
  };
})();
