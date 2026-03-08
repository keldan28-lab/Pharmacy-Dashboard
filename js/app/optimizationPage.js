
(function(){

// Keyboard search (same UX pattern as Charts page)
let __optSearchTerm = '';
let __optSearchTimeout = null;

function _num(n,d){ n=Number(n); return Number.isFinite(n)?n:(d||0); }

function _datasetEndISO(){
  try {
    const md = (window.MOCK_DATA && typeof window.MOCK_DATA === 'object') ? window.MOCK_DATA : null;
    const iso = String((md && md.meta && md.meta.datasetEndISO) || '').slice(0,10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  } catch(_){}
  return new Date().toISOString().slice(0,10);
}

function _trendValueFromRow(row){
  if (row == null) return NaN;
  if (typeof row === 'number') return _num(row, NaN);
  return _num(row && row.trendMult, NaN);
}

function _fallbackTrendFromRecentUsage(locationKey, itemCode){
  try {
    const md = (window.MOCK_DATA && typeof window.MOCK_DATA === 'object') ? window.MOCK_DATA : null;
    const txRoot = (md && md.transactions && typeof md.transactions === 'object') ? md.transactions : null;
    if (!txRoot) return { trendMult: 1, trendSource: 'fallback_none', trendWindowDays: 56 };
    const hist = txRoot[String(itemCode || '')] && Array.isArray(txRoot[String(itemCode || '')].history)
      ? txRoot[String(itemCode || '')].history
      : [];
    if (!hist.length) return { trendMult: 1, trendSource: 'fallback_none', trendWindowDays: 56 };

    const locNeedle = String(locationKey || '').trim().toUpperCase();
    let maxTs = 0;
    const byIso = Object.create(null);
    for (const row of hist){
      if (!row || typeof row !== 'object') continue;
      const iso = String(row.transDate || row.TransDate || row.date || row.Date || row.txDate || '').slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      const dt = Date.parse(iso + 'T00:00:00');
      if (!Number.isFinite(dt)) continue;
      const tType = String(row.transactionType || row.TransactionType || '').toLowerCase();
      if (tType && !(tType.includes('disp') || tType.includes('issue') || tType.includes('use') || tType.includes('consum'))) continue;
      const loc = String(row.sublocation || row.Sublocation || row.subLocation || row.SubLocation || row.location || row.sendToLocation || '').trim().toUpperCase();
      if (locNeedle && loc !== locNeedle) continue;
      const q = Math.abs(_num(row.TransQty ?? row.qty ?? row.quantity ?? row.Qty ?? 0, 0));
      if (!(q > 0)) continue;
      byIso[iso] = _num(byIso[iso], 0) + q;
      if (dt > maxTs) maxTs = dt;
    }
    if (!maxTs) return { trendMult: 1, trendSource: 'fallback_none', trendWindowDays: 56 };

    const dayMs = 86400000;
    let recentSum = 0;
    let priorSum = 0;
    for (let i=0;i<14;i++){
      const d = new Date(maxTs - (i * dayMs)).toISOString().slice(0,10);
      recentSum += _num(byIso[d], 0);
    }
    for (let i=14;i<56;i++){
      const d = new Date(maxTs - (i * dayMs)).toISOString().slice(0,10);
      priorSum += _num(byIso[d], 0);
    }

    const recentAvg = recentSum / 14;
    const priorAvg = priorSum / 42;
    const ratio = recentAvg / Math.max(priorAvg, 1e-9);
    return { trendMult: _clamp(ratio, 0.6, 1.6), trendSource: 'tx_fallback_14v42', trendWindowDays: 56 };
  } catch(_){
    return { trendMult: 1, trendSource: 'fallback_error', trendWindowDays: 56 };
  }
}

function _trendContextFor(dateISO, locationKey, itemCode){
  try {
    const md = (window.MOCK_DATA && typeof window.MOCK_DATA === 'object') ? window.MOCK_DATA : null;
    const tl = md && md.trendTimeline;
    const meta = (tl && tl.meta && typeof tl.meta === 'object') ? tl.meta : {};
    const minMult = _num(meta.minMult, 0.6) || 0.6;
    const maxMult = _num(meta.maxMult, 1.6) || 1.6;
    const byDate = tl && tl.byLocation && tl.byLocation[String(locationKey||'')] && tl.byLocation[String(locationKey||'')][String(itemCode||'')];
    const row = byDate && byDate[String(dateISO||'')];
    const raw = _trendValueFromRow(row);
    if (Number.isFinite(raw) && raw > 0){
      return {
        trendMult: _clamp(raw, minMult, maxMult),
        trendSource: 'sheet',
        trendWindowDays: _num(meta.windowRecentDays, 14) + _num(meta.windowPriorDays, 42)
      };
    }
  } catch(_){}
  const fb = _fallbackTrendFromRecentUsage(locationKey, itemCode);
  return {
    trendMult: _clamp(_num(fb.trendMult, 1), 0.6, 1.6),
    trendSource: fb.trendSource,
    trendWindowDays: _num(fb.trendWindowDays, 56)
  };
}

function _trendMultFor(dateISO, locationKey, itemCode){
  return _trendContextFor(dateISO, locationKey, itemCode).trendMult;
}
function _str(x){ return String(x||'').trim(); }
function _esc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function _clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }

function _setOptSearchTerm(t){
  __optSearchTerm = String(t||'');
  try{ window.__optSearchTerm = __optSearchTerm; }catch(_){ }
}

function _getOptSearchTerm(){
  try{ if (typeof window.__optSearchTerm === 'string') return window.__optSearchTerm; }catch(_){ }
  return __optSearchTerm;
}

function _showSearchBar(){
  const searchBar = document.getElementById('keyboardSearchBar');
  if (searchBar) searchBar.classList.add('visible');
}
function _hideSearchBar(){
  const searchBar = document.getElementById('keyboardSearchBar');
  if (searchBar) searchBar.classList.remove('visible');
}

function _initKeyboardSearch(){
  const searchBar = document.getElementById('keyboardSearchBar');
  const searchInput = document.getElementById('searchInput');
  if (!searchBar || !searchInput) return;

  document.addEventListener('keydown', function(e){
    // Don't intercept if user is typing in an input field
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // Ignore arrows and special keys except Backspace / Escape
    if (e.key === 'Escape'){
      if (searchBar.classList.contains('visible')){
        _hideSearchBar();
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    if (e.key.length > 1 && e.key !== 'Backspace') return;

    // Show bar and reset on first key
    if (!searchBar.classList.contains('visible')){
      _showSearchBar();
      _setOptSearchTerm('');
    }

    let term = _getOptSearchTerm();
    if (e.key === 'Backspace'){
      e.preventDefault();
      term = term.slice(0, -1);
    } else if (e.key.length === 1){
      term += e.key;
    }
    _setOptSearchTerm(term);
    searchInput.value = term;

    if (__optSearchTimeout) clearTimeout(__optSearchTimeout);
    _render();

    // Auto-hide after a short idle period
    __optSearchTimeout = setTimeout(_hideSearchBar, 3000);
  });

  // Hide on mouse move like Charts
  let mmT;
  document.addEventListener('mousemove', function(){
    if (!searchBar.classList.contains('visible')) return;
    if (mmT) clearTimeout(mmT);
    mmT = setTimeout(_hideSearchBar, 500);
  });
}

// Pyxis restock frequency (restocks per day).
// Default = 1 (assumes one restock cycle per day).
const _DEFAULT_PYXIS_RESTOCK_FREQ_PER_DAY = 1.0;

function _getPyxisRestockFreqPerDay(){
  try{
    const raw = localStorage.getItem('pyxisRestockFreqPerDay');
    const v = raw == null ? _DEFAULT_PYXIS_RESTOCK_FREQ_PER_DAY : parseFloat(raw);
    return (Number.isFinite(v) && v > 0) ? v : _DEFAULT_PYXIS_RESTOCK_FREQ_PER_DAY;
  }catch(_){
    return _DEFAULT_PYXIS_RESTOCK_FREQ_PER_DAY;
  }
}

function _unitCostFromMeta(meta){
  // Inventory cost tiers are based on inventory valuation, not transactions.
  // unitPrice is the canonical field in this project.
  return _num(
    meta.unitPrice
    || meta.unit_price
    || meta.UnitPrice
    || meta.gpoPrice
    || meta.phsPrice
    || meta.wacPrice
    || meta.unitCost
    || meta.cost
    || 0,
    0
  );
}

function _buildItemMetaByCode(){
  const m = Object.create(null);
  try{
    if (typeof ITEMS_DATA !== 'undefined' && ITEMS_DATA && Array.isArray(ITEMS_DATA.items)){
      for (const it of ITEMS_DATA.items){
        const code = _str(it.itemCode || it.code);
        if (!code) continue;
        m[code] = it;
      }
    }
  }catch(_){}
  return m;
}

function _getSublocationMap(){
  try{ if (window.SUBLOCATION_MAP) return window.SUBLOCATION_MAP; }catch(_){}
  try{ if (typeof SUBLOCATION_MAP !== 'undefined' && SUBLOCATION_MAP) return SUBLOCATION_MAP; }catch(_){}
  return null;
}

function _mapEntryForSubloc(subloc, ref){
  if (!ref || !subloc) return null;
  if (ref[subloc]) return ref[subloc];

  // Fallback to case-insensitive match so keys like "Frig R107" are found
  // even when incoming transaction/inventory sublocation casing differs.
  const target = _normLocToken(subloc);
  for (const k of Object.keys(ref)) {
    if (_normLocToken(k) === target) return ref[k];
  }
  return null;
}

function _departmentForSubloc(subloc, ref){
  const e = _mapEntryForSubloc(subloc, ref);
  return e ? _str(e.department || '') : '';
}



const __OPT_HIDDEN_PHARMACY_LOCATIONS = new Set([
  'VC', 'FRIDGE', 'FRID', 'DEPT ORDER', 'CHEMO ROOM', 'FREEZER', 'CW1524'
]);

function _normLocToken(v){
  return String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function _isHiddenPharmacyLocationLabel(locLabel){
  const n = _normLocToken(locLabel);
  if (!n) return false;
  if (__OPT_HIDDEN_PHARMACY_LOCATIONS.has(n)) return true;
  if (n.indexOf('FRID') >= 0 || n.indexOf('FRIDGE') >= 0) return true;
  return false;
}

function _locationLabelForSubloc(subloc, ref){
  const e = _mapEntryForSubloc(subloc, ref);
  if (e){
    return _str(e.mainLocation || e.location || subloc) || subloc;
  }
  return subloc || 'UNKNOWN';
}

function _getVisibleLocationChoices(ref){
  const out = new Set();
  const src = (ref && typeof ref === 'object') ? ref : null;
  if (!src) return [];
  for (const k of Object.keys(src)){
    const row = src[k] || {};
    const loc = String(row.mainLocation || row.location || '').trim().toUpperCase();
    const dep = String(row.department || '').trim().toUpperCase();
    if (!loc) continue;
    if (_isHiddenPharmacyLocationLabel(loc) || dep === 'PHARMACY') continue;
    out.add(loc);
  }
  return Array.from(out).sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' }));
}


function _getTxLocationChoicesForItems(txRoot, itemCodes, ref){
  const out = new Set();
  const codes = Array.isArray(itemCodes) ? itemCodes.filter(Boolean) : [];
  if (!txRoot || !codes.length) return [];

  const getBucket = (root, codeStr) => {
    const s = String(codeStr || '').trim();
    if (!s || !root) return null;
    const noLead = s.replace(/^0+/, '') || s;
    const noDash = s.replace(/[\s-]/g, '');
    const noDashNoLead = (noDash || '').replace(/^0+/, '') || noDash;
    return root[s] || root[noLead] || (noDash ? root[noDash] : null) || (noDashNoLead ? root[noDashNoLead] : null) || null;
  };

  for (const code of codes){
    const bucket = getBucket(txRoot, code);
    const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
    if (!Array.isArray(hist)) continue;
    for (const row of hist){
      const t = String((row && (row.transactionType || row.type || row.transType || '')) || '').toLowerCase();
      const isWasteTxn = (t.indexOf('waste') >= 0 || t.indexOf('expire') >= 0 || t.indexOf('return') >= 0 || t.indexOf('discard') >= 0 || t.indexOf('adjust') >= 0);
      const destRaw = String((row && (row.sendToLocation || row.toLocation || row.destinationLocation || row.destLocation || '')) || '').trim();
      const srcRaw = String((row && (row.sublocation || row.location || row.fromLocation || row.sourceLocation || row.device || '')) || '').trim();
      const raw = destRaw || (isWasteTxn ? srcRaw : '');
      if (!raw) continue;
      const loc = String(_locationLabelForSubloc(raw, ref) || raw).trim().toUpperCase();
      if (!loc) continue;
      if (_isHiddenPharmacyLocationLabel(loc)) continue;
      out.add(loc);
    }
  }
  return Array.from(out).sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' }));
}

// Build an index of itemCodes that currently have inventory remaining past expiry.
// Used for the "unused" (translucent teal) segment in Optimization.
//
// Definition: any inventory lot with an expiry date < today AND qty > 0.
// Counted distinctly per (location, sublocation) by itemCode.
function _buildExpiredLeftoverIndex(raw, computed, ref){
  // NOTE: This function previously bucketed gray by "expired leftover".
  // It is now replaced with a projected leftover-at-expiry waste model.
  //
  // Model:
  // - Treat each (itemCode + sublocation) as a distinct pocket.
  // - Compute daily usage per pocket from dispense transactions (last N days).
  // - For each pocket with an expiry date: leftoverUnits = max(0, qty - dailyUsage * daysToExpiry)
  // - Roll up leftoverUnits to Location via sublocation->location mapping.
  // - Allocation rule for Location rollup:
  //   For each itemCode, find the location where its leftoverUnits is MAX and assign that itemCode to that location’s gray set.
  //
  // Output:
  // - bySublocationPocket[subloc] => Set(pocketKey) where leftoverUnits>0
  // - byLocation[loc] => Set(itemCode) where that loc is the max-leftover location for the itemCode
  const out = {
    byLocation: Object.create(null),           // loc -> Set(itemCode)
    bySublocation: Object.create(null),        // kept for compatibility (locally mirrors pocket sets as itemCodes)
    byLocationPocket: Object.create(null),     // not used for location anymore (kept empty)
    bySublocationPocket: Object.create(null),  // subloc -> Set(pocketKey)
    // debug
    __meta: { horizonDays: 14 }
  };

  const pocketWasteRecs = [];


  const data = computed || raw || null;
  const inv = data && data.inventory ? data.inventory : null;
  const tx = data && data.transactions ? data.transactions : (raw && raw.transactions ? raw.transactions : null);
  if (!inv) return out;

  const today = new Date();
  today.setHours(0,0,0,0);

  // -------------------------
  // Build daily usage by pocket (last N days)
  // -------------------------
  const N = 14;
  const startD = new Date(today);
  startD.setDate(startD.getDate() - (N - 1));
  const startISO = startD.toISOString().slice(0,10);
  const usageByPocket = Object.create(null); // "code|subloc" -> total used in last N days

  if (tx && typeof tx === 'object'){
    for (const [codeRaw, entry] of Object.entries(tx)){
      const code = _str(codeRaw);
      const hist = entry && Array.isArray(entry.history) ? entry.history : [];
      for (let i=0;i<hist.length;i++){
        const r = hist[i] || {};
        const t = String(r.transactionType || '').toLowerCase();
        if (!t.includes('dispense')) continue;
        const dateStr = (typeof r.transDate === 'string') ? r.transDate.slice(0,10) : '';
        if (!dateStr || dateStr < startISO) continue;
        const qtyRaw = (r.transQty != null) ? r.transQty : (r.TransQty != null ? r.TransQty : (r.qty != null ? r.qty : r.Qty));
        const q = Number(qtyRaw) || 0;
        const used = q < 0 ? -q : q;
        if (used <= 0) continue;
        const sub = (typeof r.sublocation === 'string' && r.sublocation.trim()) ? r.sublocation.trim() : 'UNKNOWN';
        const pk = code + '|' + sub;
        usageByPocket[pk] = (usageByPocket[pk] || 0) + used;
      }
    }
  }

  // daily usage = total last N / N
  const dailyByPocket = Object.create(null);
  for (const [pk, total] of Object.entries(usageByPocket)){
    dailyByPocket[pk] = Math.max(0, (Number(total)||0) / N);
  }

  // -------------------------
  // Iterate pockets, compute leftover at expiry
  // -------------------------
  const leftoverByItemLoc = Object.create(null); // itemCode -> loc -> leftoverUnits
  const addPocketWaste = (locKey, subKey, code, pocketKey, leftoverUnits) => {
    if (!(leftoverUnits > 0)) return;
    const lk = _str(locKey) || 'UNKNOWN';
    const sk = _str(subKey) || 'UNKNOWN';
    const c = _str(code);
    if (!c) return;

    if (!out.bySublocationPocket[sk]) out.bySublocationPocket[sk] = new Set();
    out.bySublocationPocket[sk].add(pocketKey);

    // compatibility mirror: itemCodes per sublocation
    if (!out.bySublocation[sk]) out.bySublocation[sk] = new Set();
    out.bySublocation[sk].add(c);

    if (!leftoverByItemLoc[c]) leftoverByItemLoc[c] = Object.create(null);
    leftoverByItemLoc[c][lk] = (leftoverByItemLoc[c][lk] || 0) + leftoverUnits;

    pocketWasteRecs.push({ loc: lk, sub: sk, code: c, pocketKey, leftoverUnits });
  };

  const handlePocket = (code, sub, rec) => {
    const c = _str(code);
    const sk = _str(sub) || 'UNKNOWN';
    const qty = Number(rec && (rec.qty ?? rec.quantity ?? rec.curQty)) || 0;
    if (!(qty > 0)) return;

    const expISO = _str(rec && (rec.expires || rec.expiration || rec.expiry));
    if (!expISO) return;
    const d = new Date(expISO);
    if (Number.isNaN(d.getTime())) return;
    d.setHours(0,0,0,0);
    // If already expired, it's definitely waste (leftover at expiry == qty)
    const daysToExpiry = Math.max(0, Math.round((d.getTime() - today.getTime()) / 86400000));
    const pk = c + '|' + sk;
    const daily = dailyByPocket[pk] != null ? Number(dailyByPocket[pk])||0 : 0;
    const expectedUse = daily * daysToExpiry;
    const leftover = Math.max(0, qty - expectedUse);

    const lk = _locationLabelForSubloc(sk, ref) || 'UNKNOWN';
    addPocketWaste(lk, sk, c, pk, leftover);
  };

  for (const [code, invEntry] of Object.entries(inv)){
    if (!invEntry) continue;

    // Shape A: inv[code] = { sublocations:[{sublocation, qty, expires}] }
    if (Array.isArray(invEntry.sublocations)){
      for (let i=0;i<invEntry.sublocations.length;i++){
        const r = invEntry.sublocations[i] || {};
        handlePocket(code, r.sublocation, r);
      }
      continue;
    }

    // Shape B: inv[code] = { "SUB": { qty, expires }, ... }
    if (typeof invEntry === 'object'){
      for (const [sub, rec] of Object.entries(invEntry)){
        if (!rec || typeof rec !== 'object') continue;
        handlePocket(code, sub, rec);
      }
    }
  }

  // -------------------------
  // Location allocation: choose max location per itemCode, bucket item there
  // -------------------------
  const bestLocByCode = Object.create(null); // code -> bestLoc
  for (const [code, byLoc] of Object.entries(leftoverByItemLoc)){
    let bestLoc = null;
    let bestVal = 0;
    for (const [loc, vRaw] of Object.entries(byLoc || {})){
      const v = Number(vRaw)||0;
      if (v > bestVal){
        bestVal = v;
        bestLoc = loc;
      }
    }
    if (!bestLoc || !(bestVal > 0)) continue;
    bestLocByCode[code] = bestLoc;

    if (!out.byLocation[bestLoc]) out.byLocation[bestLoc] = new Set();
    out.byLocation[bestLoc].add(code);
  }

  // IMPORTANT: location-level gray tier must be pocket-based to stay equivalent to the
  // sum of sublocation pockets (and to match drill-down behavior).
  for (let i=0;i<pocketWasteRecs.length;i++){
    const r = pocketWasteRecs[i];
    const bestLoc = bestLocByCode[r.code];
    if (!bestLoc) continue;
    if (r.loc !== bestLoc) continue;
    if (!out.byLocationPocket[bestLoc]) out.byLocationPocket[bestLoc] = new Set();
    out.byLocationPocket[bestLoc].add(r.pocketKey);
  }

  return out;
}

// Build pocket daily usage statistics over the last `days` (inclusive) ending at max TransDate.
// Returns worst/mean/sigma/nonzero percentile maps so downstream features (min suggestions, safety stock)
// can stay pocket-first without changing existing IUR invariants.
function _buildDailyUsageStatsByPocket(tx, want, days, percentileCutoff){
  const worstByPocket = Object.create(null);
  const meanByPocket = Object.create(null);
  const sigmaByPocket = Object.create(null);
  const qnzByPocket = Object.create(null);

  // Support multiple transaction shapes:
  // 1) Flat array: [{ itemCode, transDate, transactionType, TransQty, sublocation, ... }, ...]
  // 2) Wrapped: { transactions: [...] }
  // 3) Legacy mergedTransactions: { ITEMCODE: { history: [...] }, ... }
  let txArr = Array.isArray(tx) ? tx : (tx && Array.isArray(tx.transactions) ? tx.transactions : []);
  if ((!txArr || txArr.length === 0) && tx && typeof tx === 'object' && !Array.isArray(tx)){
    // Flatten legacy object-of-histories into array records
    const flat = [];
    for (const [codeRaw, entry] of Object.entries(tx)){
      const code = String(codeRaw||'').trim();
      if (!code) continue;
      const hist = entry && Array.isArray(entry.history) ? entry.history : [];
      for (const h of hist){
        if (!h) continue;
        // attach itemCode so downstream logic can treat uniformly
        flat.push(Object.assign({ itemCode: code }, h));
      }
    }
    txArr = flat;
  }

  // Anchor window to max transaction date (dataset-aware)
  let maxD = null;
  for (const h of txArr){
    const d = h && (h.transDate || h.TransDate || h.date || h.Date || h.txDate);
    const t = d ? new Date(d) : null;
    if (t && !isNaN(+t)) { if (!maxD || t > maxD) maxD = t; }
  }
  if (!maxD){
    return { worstByPocket, meanByPocket, sigmaByPocket, qnzByPocket };
  }

  const daysN = Math.max(1, days||14);
  const end = new Date(maxD);
  end.setHours(0,0,0,0);
  const start = new Date(end);
  start.setDate(start.getDate() - (daysN - 1));

  const dailyByPocket = Object.create(null);
  const wantLower = String(want||'').toLowerCase();
  const preferSublocFirst = (wantLower === 'dispense' || wantLower === 'usage');

  for (const h of txArr){
    const d = h && (h.transDate || h.TransDate || h.date || h.Date || h.txDate);
    const t = d ? new Date(d) : null;
    if (!t || isNaN(+t)) continue;
    if (t < start || t > end) continue;

    const type = String(h.transactionType || h.TransactionType || h.type || h.Type || '').toLowerCase();
    if (wantLower === 'dispense' || wantLower === 'usage'){
      if (!(type.includes('disp') || type.includes('issue') || type.includes('use') || type.includes('consum'))) continue;
    } else if (wantLower === 'refill'){
      if (!(type.includes('refill') || type.includes('restock') || type.includes('receiv') || type.includes('replen'))) continue;
    } else if (wantLower === 'waste'){
      if (!(type.includes('waste') || type.includes('expire') || type.includes('return') || type.includes('dispose'))) continue;
    }

    const code = String(h.itemCode || h.ItemCode || h.ndc || h.NDC || h.code || '').trim();
    if (!code) continue;
    const q = Math.abs(_num(h.TransQty ?? h.qty ?? h.quantity ?? h.Qty ?? 0, 0));
    if (!(q > 0)) continue;

    let sub = '';
    if (preferSublocFirst){
      sub = String(h.sublocation || h.Sublocation || h.subLocation || h.SubLocation || h.cabinet || h.Cabinet || '').trim();
      if (!sub) sub = String(h.sendToLocation || h.SendToLocation || h.destination || h.Destination || '').trim();
    } else {
      sub = String(h.sendToLocation || h.SendToLocation || h.destination || h.Destination || '').trim();
      if (!sub) sub = String(h.sublocation || h.Sublocation || h.subLocation || h.SubLocation || h.cabinet || h.Cabinet || '').trim();
    }
    sub = (sub || 'UNKNOWN');
    // Normalize to match inventory sublocation keys
    sub = String(sub).trim().toUpperCase();

    const pk = String(code) + '|' + sub;
    const iso = _toISODate(t);
    if (!iso) continue;

    const obj = dailyByPocket[pk] || (dailyByPocket[pk] = Object.create(null));
    obj[iso] = _num(obj[iso], 0) + q;
  }

  const cutoff = _clamp(_num(percentileCutoff, 100), 1, 100);

  // Pre-build the list of iso days in the window (inclusive) so zeros are represented.
  const isoDays = [];
  {
    const cur = new Date(start);
    for (let i=0;i<daysN;i++){
      isoDays.push(_toISODate(cur));
      cur.setDate(cur.getDate()+1);
    }
  }

  for (const pk of Object.keys(dailyByPocket)){
    const map = dailyByPocket[pk] || {};
    const series = isoDays.map(iso => _num(map[iso], 0));

    let sum = 0;
    for (let i=0;i<series.length;i++) sum += series[i];
    const mean = sum / daysN;

    const nz = series.filter(v => v > 0).sort((a,b)=>a-b);
    let qnz = 0;
    if (nz.length){
      const p = cutoff / 100;
      const qIndex = Math.max(0, Math.min(nz.length - 1, Math.ceil(nz.length * p) - 1));
      qnz = _num(nz[qIndex], 0);
    }

    let sigma = 0;
    if (series.length > 1){
      let ss = 0;
      for (let i=0;i<series.length;i++){
        const d = series[i] - mean;
        ss += d*d;
      }
      const variance = ss / (series.length - 1);
      sigma = Math.sqrt(Math.max(0, variance));
    }

    // UCB on mean (one-sided 95% z ≈ 1.64)
    const z = 1.64;
    const ucb = mean + (series.length > 1 ? (z * (sigma / Math.sqrt(series.length))) : 0);

    const worst = Math.max(mean, qnz, ucb);

    worstByPocket[pk] = worst;
    meanByPocket[pk] = mean;
    sigmaByPocket[pk] = sigma;
    qnzByPocket[pk] = qnz;
  }

  return { worstByPocket, meanByPocket, sigmaByPocket, qnzByPocket };
}
function _getRawFromMessage(msg){
  return msg && (msg.raw || msg.rawData || msg.legacyRaw || msg.rawMock || null);
}
function _getComputedFromMessage(msg){
  return msg && (msg.data || msg.computed || msg.computedLegacy || msg.payload || null);
}

function _getInventory(raw, computed){
  if (raw && raw.inventory) return raw.inventory;
  try{ if (typeof ITEMS_INVENTORY !== 'undefined' && ITEMS_INVENTORY) return ITEMS_INVENTORY; }catch(_){}
  if (computed && computed.inventory) return computed.inventory;
  return null;
}
function _getTransactions(raw, computed){
  if (raw && raw.transactions) return raw.transactions;
  if (computed && computed.transactions) return computed.transactions;

  // Fallbacks: in some builds, transactions are stored on shared/cached state
  // rather than being passed into the Optimization iframe payload.
  try{ if (window.costChartState && window.costChartState.cachedMockData && window.costChartState.cachedMockData.transactions) return window.costChartState.cachedMockData.transactions; }catch(_){ }
  try{ if (window.cachedMockData && window.cachedMockData.transactions) return window.cachedMockData.transactions; }catch(_){ }
  try{ if (window.MOCK_DATA && window.MOCK_DATA.transactions) return window.MOCK_DATA.transactions; }catch(_){ }

  // Iframe-safe fallbacks: parent often owns the canonical cached data.
  // (Same-origin dashboards commonly host Optimization in an iframe.)
  try{ if (window.parent && window.parent !== window){
    const p = window.parent;
    if (p.costChartState && p.costChartState.cachedMockData && p.costChartState.cachedMockData.transactions) return p.costChartState.cachedMockData.transactions;
    if (p.cachedMockData && p.cachedMockData.transactions) return p.cachedMockData.transactions;
    if (p.MOCK_DATA && p.MOCK_DATA.transactions) return p.MOCK_DATA.transactions;
    // Some builds expose the merge helper only on parent
    if (typeof p.mergeMonthlyTransactions === 'function') return p.mergeMonthlyTransactions();
    if (p.InventoryApp && p.InventoryApp.TransactionMerge && typeof p.InventoryApp.TransactionMerge.mergeMonthlyTransactions === 'function') return p.InventoryApp.TransactionMerge.mergeMonthlyTransactions(p);
  }}catch(_){ }

  return null;
}

const __optPocketParseCache = Object.create(null);

function _parsePocketDescriptor(rawPocket){
  const src = String(rawPocket || '').trim();
  if (!src) {
    return { cabinet: '', drawer: '', drawerLoc: '', size: '', pocketType: '', medLoaded: '', medLoadedLabel: '', raw: '' };
  }
  if (__optPocketParseCache[src]) return __optPocketParseCache[src];
  const parts = src.split('|').map((v)=>String(v || '').trim());
  const cabinetDrawer = parts[0] || '';
  const cdSplit = cabinetDrawer.split(/\s+(?=Drw\b)/i);
  const medLoaded = String(parts[4] || '').trim().toUpperCase();
  const parsed = {
    cabinet: String(cdSplit[0] || '').trim(),
    drawer: String(cdSplit[1] || '').trim(),
    drawerLoc: String(parts[1] || '').trim(),
    size: String(parts[2] || '').trim(),
    pocketType: String(parts[3] || '').trim(),
    medLoaded: medLoaded,
    medLoadedLabel: (medLoaded === 'L') ? 'loaded' : ((medLoaded === 'P') ? 'pended' : ''),
    raw: src
  };
  __optPocketParseCache[src] = parsed;
  return parsed;
}

function _isMinSuggestionLoggingEnabled(){
  try {
    if (localStorage.getItem('log_minSuggestion') === '0') return false;
    if (localStorage.getItem('log_minSuggestion') === '1') return true;
  } catch(_){ }
  return false;
}

function _minSuggestionLog(){
  if (!_isMinSuggestionLoggingEnabled()) return;
  try {
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[Min Suggestion Report]');
    console.log.apply(console, args);
  } catch(_){ }
}

function _iterInventoryRecords(inv){
  const out = [];
  if (!inv || typeof inv !== 'object') return out;
  for (const itemCode of Object.keys(inv)){
    const slots = inv[itemCode];
    if (!slots || typeof slots !== 'object') continue;
    for (const subloc of Object.keys(slots)){
      const r = slots[subloc] || {};
      const pocketRaw = String(r.pocket || r.Pocket || '').trim();
      out.push({
        itemCode,
        // Normalize sublocation keys to match transaction records (which may vary in case)
        sublocation: String(subloc||'').trim().toUpperCase(),
        qty: _num((r.qty ?? r.qtyOnHand ?? r.onHand ?? r.on_hand ?? r.quantity ?? r.Qty ?? 0), 0),
        min: _num((r.min ?? r.minQty ?? r.min_qty ?? r.parMin ?? r.minQuantity ?? 0), 0),
        max: _num((r.max ?? r.maxQty ?? r.max_qty ?? r.parMax ?? r.maxQuantity ?? 0), 0),
        pocket: pocketRaw,
        pocketParsed: _parsePocketDescriptor(pocketRaw),
        // Some pockets are marked "standard" in inventory (e.g., Pyxis standard pockets).
        // Preserve this so Item view can render the min-tick border as coral.
        standard: !!(r.standard ?? r.isStandard ?? r.Standard ?? false),
      });
    }
  }
  return out;
}

// ---------- Transactions helpers (use quantities) ----------
function _txTypeMatch(ttype, want){
  const t = String(ttype||'').toLowerCase();
  if (want === 'dispense') return t.includes('disp') || t.includes('unload') || t.includes('remove');
  if (want === 'refill') return t.includes('refill') || t.includes('restock') || t.includes('load');
  if (want === 'waste') return t.includes('waste') || t.includes('expire') || t.includes('return');
  return false;
}

// RAW mergedTransactions: { itemCode: {history:[...]} }
function _buildQtyByCode(tx, want){
  const qty = Object.create(null);
  let total = 0;

  if (!tx) return { qty, total };

  // Support array-shaped tx: [{ itemCode, transactionType, TransQty, ... }, ...]
  if (Array.isArray(tx)){
    for (const h of tx){
      if (!h) continue;
      if (!_txTypeMatch(h.transactionType || h.txType || h.type || h.TransactionType || h.Type, want)) continue;
      const code = String(h.itemCode || h.ItemCode || h.ndc || h.NDC || h.code || '').trim();
      if (!code) continue;
      const q = _num((h.TransQty ?? h.qty ?? h.quantity ?? h.Qty ?? 0), 0);
      const add = Math.abs(q);
      if (!(add > 0)) continue;
      qty[code] = _num(qty[code], 0) + add;
      total += add;
    }
    return { qty, total };
  }

  if (typeof tx !== 'object') return { qty, total };

  // Legacy mergedTransactions shape: { itemCode: {history:[...]}, ... }
  for (const code of Object.keys(tx)){
    const bucket = tx[code];
    const hist = bucket && Array.isArray(bucket.history) ? bucket.history : [];
    let sum = 0;
    for (const h of hist){
      if (!_txTypeMatch(h.transactionType || h.txType || h.type, want)) continue;
      const q = _num((h.TransQty ?? h.qty ?? h.quantity ?? 0), 0);
      sum += Math.abs(q);
    }
    if (sum > 0){
      qty[code] = sum;
      total += sum;
    }
  }
  return { qty, total };
}

// RAW mergedTransactions: { itemCode: {history:[...]} }
// Returns qty totals keyed by pocket "<itemCode>|<sublocation>".
// For dispense-like events, the pocket is the destination/sublocation.
function _buildQtyByPocket(tx, want){
  const qty = Object.create(null);
  let total = 0;

  if (!tx) return { qty, total };

  // Array-shaped tx
  if (Array.isArray(tx)){
    for (const h of tx){
      if (!h) continue;
      if (!_txTypeMatch(h.transactionType || h.txType || h.type || h.TransactionType || h.Type, want)) continue;
      const code = String(h.itemCode || h.ItemCode || h.ndc || h.NDC || h.code || '').trim();
      if (!code) continue;
      const q = Math.abs(_num((h.TransQty ?? h.qty ?? h.quantity ?? h.Qty ?? 0), 0));
      if (q <= 0) continue;
      const sub = String((h.sendToLocation ?? h.SendToLocation ?? h.sendTo ?? h.destination ?? h.Destination ?? h.dest ?? h.sublocation ?? h.Sublocation ?? h.subLocation ?? h.SubLocation ?? h.subloc ?? h.cabinet ?? h.Cabinet ?? '') || '').trim() || 'UNKNOWN';
      const pk = String(code) + '|' + sub;
      qty[pk] = _num(qty[pk], 0) + q;
      total += q;
    }
    return { qty, total };
  }

  if (typeof tx !== 'object') return { qty, total };

  // Legacy mergedTransactions shape
  for (const code of Object.keys(tx)){
    const bucket = tx[code];
    const hist = bucket && Array.isArray(bucket.history) ? bucket.history : [];
    for (const h of hist){
      if (!_txTypeMatch(h.transactionType || h.txType || h.type, want)) continue;
      const q = Math.abs(_num((h.TransQty ?? h.qty ?? h.quantity ?? 0), 0));
      if (q <= 0) continue;
      // Prefer destination for dispense/refill, fall back to sublocation.
      let sub = String((h.sendToLocation ?? h.sendTo ?? h.destination ?? h.dest ?? h.sublocation ?? h.subLocation ?? h.subloc ?? '') || '').trim() || 'UNKNOWN';
      sub = String(sub).trim().toUpperCase();
      const pk = String(code) + '|' + sub;
      qty[pk] = _num(qty[pk], 0) + q;
      total += q;
    }
  }
  return { qty, total };
}



// Daily usage by pocket (itemCode|sublocation) computed over a trailing window anchored to the
// most recent transaction date in the dataset. Applies percentile trimming to reduce spikes.
function _getUsagePercentileCutoff(){
  const v = parseFloat(localStorage.getItem('usagePercentileCutoff') || (window.__usagePercentileCutoff ?? '100'));
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : 100;
}

function _toISODate(d){
  try{ return new Date(d).toISOString().slice(0,10); }catch(_){ return ''; }
}

// Build pocket average daily usage over the last `days` (inclusive) ending at max TransDate.
// Percentile cutoff removes the top (100-cutoff)% daily values before averaging.
function _buildDailyUsageByPocket(tx, want, days, percentileCutoff){
  const dailyByPocket = Object.create(null); // pocketKey -> {isoDay: qty}
  if (!tx) return dailyByPocket;

  // Normalize tx into a flat array of records
  let txArr = Array.isArray(tx) ? tx : (tx && Array.isArray(tx.transactions) ? tx.transactions : []);
  if ((!txArr || txArr.length === 0) && tx && typeof tx === 'object' && !Array.isArray(tx)){
    const flat = [];
    for (const [codeRaw, entry] of Object.entries(tx)){
      const code = String(codeRaw||'').trim();
      if (!code) continue;
      const hist = entry && Array.isArray(entry.history) ? entry.history : [];
      for (const h of hist){
        if (!h) continue;
        flat.push(Object.assign({ itemCode: code }, h));
      }
    }
    txArr = flat;
  }
  if (!txArr || txArr.length === 0) return dailyByPocket;

  let maxDate = null;
  for (const h of txArr){
    if (!h) continue;
    if (!_txTypeMatch(h.transactionType || h.txType || h.type || h.TransactionType || h.Type, want)) continue;
    const dt = h.TransDate || h.transDate || h.TransDate || h.date || h.Date || h.txDate;
    if (!dt) continue;
    const d = new Date(dt);
    if (!isFinite(d)) continue;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  if (!maxDate) return dailyByPocket;

  const end = new Date(maxDate);
  const start = new Date(maxDate);
  start.setDate(start.getDate() - (Math.max(1, days||14) - 1));

  const wantLower = String(want||'').toLowerCase();
  const preferSublocFirst = (wantLower === 'dispense' || wantLower === 'usage');

  // Second pass: accumulate per day per pocket within window
  for (const h of txArr){
    if (!h) continue;
    if (!_txTypeMatch(h.transactionType || h.txType || h.type || h.TransactionType || h.Type, want)) continue;

    const dt = h.TransDate || h.transDate || h.date || h.Date || h.txDate;
    if (!dt) continue;
    const d = new Date(dt);
    if (!isFinite(d) || d < start || d > end) continue;

    const q = Math.abs(_num((h.TransQty ?? h.transQty ?? h.qty ?? h.quantity ?? h.Qty ?? 0), 0));
    if (q <= 0) continue;

    const code = String(h.itemCode || h.ItemCode || h.ndc || h.NDC || h.code || '').trim();
    if (!code) continue;

    let sub = '';
    if (preferSublocFirst){
      sub = String((h.sublocation ?? h.Sublocation ?? h.subLocation ?? h.SubLocation ?? h.subloc ?? h.sub_loc ?? h.cabinet ?? h.Cabinet ?? '') || '').trim()
         || String((h.sendToLocation ?? h.SendToLocation ?? h.sendTo ?? h.destination ?? h.dest ?? '') || '').trim();
    } else {
      sub = String((h.sendToLocation ?? h.SendToLocation ?? h.sendTo ?? h.destination ?? h.dest ?? '') || '').trim()
         || String((h.sublocation ?? h.Sublocation ?? h.subLocation ?? h.SubLocation ?? h.subloc ?? h.sub_loc ?? h.cabinet ?? h.Cabinet ?? '') || '').trim();
    }
    sub = String(sub || 'UNKNOWN').trim().toUpperCase();

    const pk = String(code) + '|' + sub;
    const iso = _toISODate(d);
    if (!iso) continue;

    const obj = dailyByPocket[pk] || (dailyByPocket[pk] = Object.create(null));
    obj[iso] = _num(obj[iso], 0) + q;
  }

  // Convert daily totals into average daily usage with percentile trimming.
  const cutoff = _clamp(_num(percentileCutoff, 100), 1, 100);
  const out = Object.create(null);
  const daysN = Math.max(1, days||14);

  // Pre-build the list of iso days in the window (inclusive) so zeros are represented.
  const isoDays = [];
  {
    const cur = new Date(start);
    for (let i=0;i<daysN;i++){
      isoDays.push(_toISODate(cur));
      cur.setDate(cur.getDate()+1);
    }
  }

  for (const pk of Object.keys(dailyByPocket)){
    const map = dailyByPocket[pk] || {};
    // Full daily series for the window (zeros included)
    const series = isoDays.map(iso => _num(map[iso], 0));

    // Baseline mean over the full window
    let sum = 0;
    for (let i=0;i<series.length;i++) sum += series[i];
    const mean = sum / daysN;

    // Non-zero percentile (captures "busy day" rate without being dominated by zero-days)
    const nz = series.filter(v => v > 0).sort((a,b)=>a-b);
    let qnz = 0;
    if (nz.length){
      const p = cutoff / 100;
      const qIndex = Math.max(0, Math.min(nz.length - 1, Math.ceil(nz.length * p) - 1));
      qnz = _num(nz[qIndex], 0);
    }

    // Upper confidence bound on mean (conservative usage estimate)
    // Use a one-sided 95% z ≈ 1.64 for "worst-case" planning.
    let ucb = mean;
    if (series.length > 1){
      let ss = 0;
      for (let i=0;i<series.length;i++){
        const d = series[i] - mean;
        ss += d*d;
      }
      const variance = ss / (series.length - 1);
      const sigma = Math.sqrt(Math.max(0, variance));
      const z = 1.64;
      ucb = mean + z * (sigma / Math.sqrt(series.length));
    }

    // Worst-case daily usage = max of (non-zero percentile, UCB, mean)
    out[pk] = Math.max(mean, qnz, ucb);
  }

  return out;
}

function _computeBinsByCode(qtyByCode){
  const entries = Object.entries(qtyByCode).map(([k,v])=>[k,_num(v,0)]);
  entries.sort((a,b)=>b[1]-a[1]);
  const n = entries.length || 0;
  const cut1 = Math.ceil(n * 0.25);
  const cut2 = Math.ceil(n * 0.50);
  const bin = Object.create(null);
  for (let i=0;i<n;i++){
    const code = entries[i][0];
    if (i < cut1) bin[code] = 'coral';
    else if (i < cut2) bin[code] = 'orange';
    else bin[code] = 'gray';
  }
  return bin;
}

// ---------- Optimization settings (localStorage-driven) ----------
function _getPyxisRestockFreqPerDay(){
  const v = parseFloat(localStorage.getItem('pyxisRestockFreqPerDay') || (window.__pyxisRestockFreqPerDay ?? '1'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function _getIurTrendWeightW(){
  const v = parseFloat(localStorage.getItem('iurTrendWeightW') || (window.__iurTrendWeightW ?? '2'));
  return Number.isFinite(v) && v >= 0 ? v : 2;
}


function _getWhatIfLeadTimeMultiplier(){
  const v = parseFloat(localStorage.getItem('whatIfLeadTimeMultiplier') || (window.__whatIfLeadTimeMultiplier ?? '1'));
  return Number.isFinite(v) ? v : 1;
}
function _getWhatIfLeadTimeAddDays(){
  const v = parseFloat(localStorage.getItem('whatIfLeadTimeAddDays') || (window.__whatIfLeadTimeAddDays ?? '0'));
  return Number.isFinite(v) ? v : 0;
}
function _getWhatIfSurgeMultiplier(){
  const v = parseFloat(localStorage.getItem('whatIfSurgeMultiplier') || (window.__whatIfSurgeMultiplier ?? '1'));
  return Number.isFinite(v) ? v : 1;
}
function _getWhatIfReviewPeriodDays(){
  const v = parseInt(localStorage.getItem('whatIfReviewPeriodDays') || (window.__whatIfReviewPeriodDays ?? '1'), 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
}
function _getWhatIfServiceLevelPreset(){
  const p = String(localStorage.getItem('whatIfServiceLevelPreset') || (window.__whatIfServiceLevelPreset ?? '95'));
  return (p === '90' || p === '95' || p === '975' || p === '99') ? p : '95';
}
function _getWhatIfServiceLevelZ(){
  const p = _getWhatIfServiceLevelPreset();
  if (p === '90') return 1.28;
  if (p === '975') return 1.96;
  if (p === '99') return 2.33;
  return 1.64; // 95
}
function _getWhatIfHorizonDays(){
  const v = parseInt(localStorage.getItem('whatIfHorizonDays') || (window.__whatIfHorizonDays ?? '14'), 10);
  return (v === 7 || v === 14 || v === 30) ? v : 14;
}
function _getWhatIfApplyLeadTimeTo(){
  const v = String(localStorage.getItem('whatIfApplyLeadTimeTo') || (window.__whatIfApplyLeadTimeTo ?? 'ALL'));
  return (v === 'PHARMACY_ONLY' || v === 'PYXIS_ONLY') ? v : 'ALL';
}


function _getMinSuggestionDeltaThreshold(){
  // Minimum absolute ΔMin units required to classify as Increase/Decrease.
  // Defaults to 2 (matches report + UI).
  const v = parseInt(localStorage.getItem('minSuggestionDeltaThreshold') || (window.__minSuggestionDeltaThreshold ?? '2'), 10);
  return Number.isFinite(v) && v >= 1 ? v : 2;
}
function _getMinSuggestionSortMode(){
  const v = String(localStorage.getItem('minSuggestionSortMode') || (window.__minSuggestionSortMode ?? 'alpha'));
  return (v === 'impact') ? 'impact' : 'alpha';
}



// Trend score: prefer memoized analytics output if available; otherwise compute from tx dispense history
function _buildTrendScoreMap(tx){
  const memo = (window.MOCK_DATA && window.MOCK_DATA.trendingItems) ? window.MOCK_DATA.trendingItems : (window.trendingItems || null);
  if (memo && (memo.trendingUp || memo.trendingDown)){
    const m = Object.create(null);
    const up = Array.isArray(memo.trendingUp) ? memo.trendingUp : [];
    for (const t of up){
      const code = String(t.itemCode || t.item_code || t.code || t.ndc || '').trim();
      if (!code) continue;
      const pct = _num(t.percentChange ?? t.pctChange ?? t.changePct ?? t.change ?? 0, 0);
      const conf = _num(t.confidence ?? t.conf ?? 1, 1);
      const isNew = !!(t.isNew || t.newlyActive || t.is_new);
      let f;
      if (isNew) f = 0.7;
      else {
        const pos = Math.max(0, pct);
        f = 1 - Math.exp(-pos / 50);
      }
      m[code] = Math.max(0, Math.min(1, conf)) * f;
    }
    return m;
  }

  const m = Object.create(null);
  if (!tx || typeof tx !== 'object') return m;

  const now = Date.now();
  const MS_DAY = 86400000;
  const start = now - 28 * MS_DAY;

  function iso10FromAny(d){
    if (!d) return '';
    if (typeof d === 'string'){
      const s = d.trim();
      return s.length >= 10 ? s.slice(0,10) : s;
    }
    if (d instanceof Date) return d.toISOString().slice(0,10);
    return '';
  }

  for (const code of Object.keys(tx)){
    const bucket = tx[code];
    const hist = bucket && Array.isArray(bucket.history) ? bucket.history : [];
    if (!hist.length) continue;

    let a=0, b=0;
    for (const h of hist){
      if (!_txTypeMatch(h.transactionType || h.txType || h.type, 'dispense')) continue;
      const ds = iso10FromAny(h.transDate || h.TransDate || h.transactionDate || h.TransactionDate || h.date || h.Date || h.postDate || h.PostDate);
      let t = NaN;
      if (ds){
        const parsed = Date.parse(ds);
        if (Number.isFinite(parsed)) t = parsed;
      }
      if (!Number.isFinite(t)) t = now;
      if (t < start) continue;
      const q = Math.abs(_num(h.TransQty ?? h.qty ?? h.quantity ?? 0, 0));
      const age = now - t;
      if (age > 14*MS_DAY) a += q; else b += q;
    }

    if (a <= 0 && b <= 0) continue;
    if (a <= 0 && b > 0){
      m[code] = 0.7;
      continue;
    }
    const pct = a > 0 ? ((b - a) / a) * 100 : 0;
    const pos = Math.max(0, pct);
    const f = 1 - Math.exp(-pos / 50);
    const vol = a + b;
    const conf = Math.max(0.2, Math.min(1, vol / 50));
    m[code] = conf * f;
  }
  return m;
}

// ---------- UI ----------
const OPT_METRICS = [
  { key: 'cost', title: 'Cost', icon: 'currency' },
  { key: 'reorder', title: 'Reorder', icon: 'reorder' },
  { key: 'min', title: 'Min Suggestions', icon: 'min' },
  { key: 'tx_dispense', title: 'Dispense', icon: 'dispense' },
  { key: 'tx_refill', title: 'Refill', icon: 'refill' },
  { key: 'tx_waste', title: 'Waste', icon: 'waste' },
  { key: 'qty', title: 'Quantity', icon: 'qty' },
];

function _svgFor(icon){
  switch(icon){
    // Use the inline sprite (file:// safe) so icon styling matches Charts.
    case 'chart-line': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-trend"></use></svg>';
    case 'currency': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-money"></use></svg>';
    case 'dispense': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-save"></use></svg>';
    case 'refill': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-refresh"></use></svg>';
    case 'waste': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-trash"></use></svg>';
    case 'qty': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-list"></use></svg>';
    case 'reorder': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-flow"></use></svg>';
    case 'min': return '<svg class="ui-icon" viewBox="0 0 24 24"><use href="#icon-list"></use></svg>';
    default: return '<svg viewBox="0 0 24 24"><path d="M12 2 2 7v10l10 5 10-5V7L12 2Z"/></svg>';
  }
}

function _renderMetricIcons(){
  const host = document.getElementById('optChartTypeIcons');
  if (!host) return;
  // Ensure scale header exists before use
  scaleHeader = document.getElementById('optScaleHeader');
  if (!scaleHeader){
    scaleHeader = document.createElement('div');
    scaleHeader.id = 'optScaleHeader';
    scaleHeader.className = 'opt-scale-header';
  }
  scaleHeader.innerHTML = '';
  host.innerHTML = '';

  const makeBtn = (m) => {
    const b = document.createElement('div');
    b.className = 'chart-icon-btn' + ((window.__optMetric || 'min') === m.key ? ' active' : '');
    b.setAttribute('data-metric', m.key);
    b.setAttribute('title', m.title);
    b.innerHTML = _svgFor(m.icon);
    b.addEventListener('click', (e) => { e.stopPropagation(); _setMetric(m.key); });
    return b;
  };

  // Primary metrics
  const primary = ['min','reorder','cost'];
  for (const k of primary){
    const m = OPT_METRICS.find(x=>x.key===k);
    if (m) host.appendChild(makeBtn(m));
  }

  const sep1=document.createElement('div'); sep1.className='chart-icon-separator'; sep1.textContent='|'; host.appendChild(sep1);

  // Transaction metrics
  const tx = ['tx_dispense','tx_refill','tx_waste'];
  for (const k of tx){
    const m = OPT_METRICS.find(x=>x.key===k);
    if (m) host.appendChild(makeBtn(m));
  }

  const sep2=document.createElement('div'); sep2.className='chart-icon-separator'; sep2.textContent='|'; host.appendChild(sep2);

  // Quantity
  {
    const m = OPT_METRICS.find(x=>x.key==='qty');
    if (m) host.appendChild(makeBtn(m));
  }
}

function _leadTimeDaysForSubloc(subloc, ref){
  const e = _mapEntryForSubloc(subloc, ref);
  const dept = e ? _str(e.department || '') : '';
  let lt = (e && e.leadTime != null) ? Number(e.leadTime) : NaN;

  // Defaults
  if (!Number.isFinite(lt)){
    if (dept === 'Pyxis') lt = 0.5;
    else if (dept === 'Pharmacy') lt = 7;
    else lt = 7;
  }

  // Pyxis rule: restocked from Pharmacy; keep lead time <= 0.5 day.
  if (dept === 'Pyxis') lt = Math.min(lt, 0.5);

  // What-if overrides (department-aware)
  const applyTo = _getWhatIfApplyLeadTimeTo();
  const shouldApply = (applyTo === 'ALL') || (applyTo === 'PHARMACY_ONLY' && dept === 'Pharmacy') || (applyTo === 'PYXIS_ONLY' && dept === 'Pyxis');
  if (shouldApply){
    lt = (lt * _getWhatIfLeadTimeMultiplier()) + _getWhatIfLeadTimeAddDays();
  }

  // Clamp for sanity
  lt = _clamp(lt, 0, 30);
  return lt;
}

function _setMetric(k){
  window.__optMetric = k;

  const host = document.getElementById('optChartTypeIcons');
  if (host){
    host.querySelectorAll('.chart-icon-btn').forEach(x=>x.classList.remove('active'));
    const btn = host.querySelector(`.chart-icon-btn[data-metric="${k}"]`);
    if (btn) btn.classList.add('active');
  }

  _render();
}

function _setViewBy(k){
  window.__optViewBy = k;
  const sel = document.getElementById('optDropdownSelected');
  if (sel) sel.textContent = (k==='item'?'Item':'Location');
  // If the user manually changes the view, clear any segment-drill filters.
  if (k !== 'item'){
    window.__optDrillScope = null;
    window.__optItemFilterSet = null;
    window.__optPocketFilterSet = null;
    window.__optSortByIUR = false;
    window.__optSortByCost = false;
    window.__optLastDrillTier = null;
    window.__optItemSublocFilter = 'ALL';
    window.__optItemIURRateFilter = 'ALL';
  window.__optItemIURRateFilter = 'ALL';
  }
  // Manual view changes reset the drill navigation stack
  window.__optNavStack = [];
  _render();
}

// -------- Drill navigation stack (location/sublocation -> item) --------
function _ensureNavStack(){
  if (!Array.isArray(window.__optNavStack)) window.__optNavStack = [];
  return window.__optNavStack;
}

function _snapshotState(){
  return {
    viewBy: window.__optViewBy,
    metric: window.__optMetric,
    // Item drill state
    drillScope: window.__optDrillScope ? { type: window.__optDrillScope.type, key: window.__optDrillScope.key } : null,
    itemFilter: window.__optItemFilterSet ? Array.from(window.__optItemFilterSet) : null,
    sortByIUR: !!window.__optSortByIUR,
    sortIURAsc: !!window.__optSortIURAsc,
    sortByCost: !!window.__optSortByCost,
    sortCostAsc: !!window.__optSortCostAsc,
    lastDrillTier: window.__optLastDrillTier || null,
    // Accordion focus state
    expandedLocKey: window.__optExpandedLocKey || null,
    focusMode: !!window.__optFocusMode
  };
}

function _restoreState(s){
  if (!s) return;
  window.__optViewBy = s.viewBy || 'location';
  window.__optMetric = s.metric || window.__optMetric || 'min';
  window.__optDrillScope = s.drillScope ? { type: s.drillScope.type, key: s.drillScope.key } : null;
  window.__optItemFilterSet = s.itemFilter ? new Set(s.itemFilter) : null;
  window.__optSortByIUR = !!s.sortByIUR;
  window.__optSortIURAsc = !!s.sortIURAsc;
  window.__optSortByCost = !!s.sortByCost;
  window.__optSortCostAsc = !!s.sortCostAsc;
  window.__optLastDrillTier = s.lastDrillTier;
  window.__optExpandedLocKey = s.expandedLocKey;
  window.__optFocusMode = !!s.focusMode;

  const sel = document.getElementById('optDropdownSelected');
  if (sel) sel.textContent = (window.__optViewBy==='item'?'Item':'Location');
}

function _pushNav(){
  const stack = _ensureNavStack();
  stack.push(_snapshotState());
}

function _navBack(){
  const stack = _ensureNavStack();
  if (stack.length){
    const prev = stack.pop();
    _restoreState(prev);
    _render();
    return;
  }
  // Fallback: collapse focus accordion if present
  if (window.__optExpandedLocKey){
    window.__optExpandedLocKey = null;
    window.__optFocusMode = false;
    _render();
  }
}


// -------- Drill to item description view (from location/sublocation) --------
// In location/sublocation view, segments represent the distribution of ALL itemCodes in that scope across IUR tiers.
// Drilling to item view should show ALL itemCodes in the selected scope, sorted by lowest IUR first.
function _drillToItemScope(scopeType, scopeKey, opts){
  if (!scopeKey) return;
  _pushNav();

  const tier = (opts && opts.tier) ? String(opts.tier) : null;
  window.__optDrillScope = { type: scopeType, key: scopeKey, tier: tier || null };
  // Default to showing ALL sublocations when drilling from a location.
  window.__optItemSublocFilter = 'ALL';
  window.__optItemIURRateFilter = 'ALL';
  // Min Suggestions bucket filter (Increase/No-demand/Decrease/OK)
  window.__optItemMinBucketFilter = 'ALL';
  if (opts && opts.sublocation) window.__optItemSublocFilter = String(opts.sublocation);
  if (opts && opts.iurRate) window.__optItemIURRateFilter = String(opts.iurRate);
  if (opts && opts.minBucket) window.__optItemMinBucketFilter = String(opts.minBucket);

  // Switch to item view
  window.__optViewBy = 'item';
  const sel = document.getElementById('optDropdownSelected');
  if (sel) sel.textContent = 'Item';
  // Sorting: alphabetical (A→Z)
  window.__optAlphaSort = true;

  // Optional: a segment drill can pass a specific tier's member pockets/itemCodes.
  // IMPORTANT: for Min Suggestions and Reorder, segment clicks provide member pockets; we must
  // apply the filter even if the caller didn't pass a tier string (or passed an empty one).
  const pocketKeys = (opts && Array.isArray(opts.pocketKeys)) ? opts.pocketKeys : null;
  const codes = (opts && Array.isArray(opts.itemCodes)) ? opts.itemCodes : null;
  // If pocketKeys are provided, treat each (itemCode,sublocation) as a distinct member in Item view.
  if (pocketKeys){
    // Normalize to avoid casing / whitespace mismatches between inventory and computed members.
    window.__optPocketFilterSet = new Set(pocketKeys.map(_normPocketKeyFromAny));
    window.__optItemFilterSet = null;
    // IMPORTANT: even if the set is empty, we still want to apply it (show 0 items)
    // when the user clicks a segment with 0 members.
    window.__optForcePocketFilter = true;
    window.__optLastDrillTier = tier || (opts && opts.bucket) || null;
  } else if (codes){
    window.__optPocketFilterSet = null;
    window.__optItemFilterSet = new Set(codes.map(String));
    window.__optForcePocketFilter = false;
    window.__optForceItemFilter = true;
    window.__optLastDrillTier = tier || (opts && opts.bucket) || null;
  } else {
    // Default: show all items in the scope
    window.__optPocketFilterSet = null;
    window.__optItemFilterSet = null;
    window.__optForcePocketFilter = false;
    window.__optForceItemFilter = false;
    window.__optLastDrillTier = null;
  }

  // Close any expanded accordions when drilling
  window.__optExpandedLocKey = null;
  window.__optFocusMode = false;

  _render();
}

// Pocket key normalization
function _normPocketKey(code, subloc){
  const c = String(code || '').trim();
  const s = String(subloc || 'UNKNOWN').trim().toUpperCase();
  return c + '|' + s;
}

function _normPocketKeyFromAny(pk){
  const s = String(pk || '');
  const i = s.indexOf('|');
  if (i < 0) return s.trim();
  const c = s.slice(0, i);
  const sub = s.slice(i + 1);
  return _normPocketKey(c, sub);
}

function _closeOptTransientPopups(except){
  const keep = String(except || '');
  try {
    const dd = document.getElementById('optDropdown');
    const opts = document.getElementById('optDropdownOptions');
    if (keep !== 'dropdown' && dd && opts) { dd.classList.remove('open'); opts.style.display = 'none'; }
  } catch(_) {}
  try {
    const pop = document.getElementById('optMinFilterPopover');
    if (keep !== 'minFilter' && pop) pop.style.display = 'none';
  } catch(_) {}
  try {
    const rangePop = document.getElementById('chartRangePopover');
    if (keep !== 'date' && rangePop) rangePop.setAttribute('aria-hidden', 'true');
  } catch(_) {}
}


function _wireDropdown(){
  const dd = document.getElementById('optDropdown');
  const head = document.getElementById('optDropdownHeader');
  const opts = document.getElementById('optDropdownOptions');
  if (!dd || !head || !opts) return;

  function close(){ dd.classList.remove('open'); opts.style.display='none'; }
  function open(){ _closeOptTransientPopups('dropdown'); dd.classList.add('open'); opts.style.display='block'; }

  close();

  head.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dd.classList.contains('open')) close(); else open();
  });

  opts.addEventListener('click', (e) => {
    const opt = e.target && e.target.closest ? e.target.closest('.dropdown-option') : null;
    if (!opt) return;
    _setViewBy(opt.getAttribute('data-value'));
    close();
  });

  document.addEventListener('click', close);
}

// ---------- Render ----------
function _render(){
  let scaleHeader;
  const root = document.getElementById('stockoutFullTimeline');
  if (!root) return;

  const host = document.getElementById('stockoutFullTimeline');
  if (!host) return;

  const viewBy = window.__optViewBy || 'location';
  const metric = window.__optMetric || 'min';

  // Report button (metric-aware)
  const rptBtn = document.getElementById('optPrintMinReportBtn');
  if (rptBtn){
    const show = (metric === 'min' || metric === 'tx_waste');
    rptBtn.style.display = show ? 'inline-flex' : 'none';
    rptBtn.title = (metric === 'tx_waste') ? 'Print Waste Optimization Report' : 'Print Min Suggestions';
  }
  const minFilterCtl = document.getElementById('optMinFilterControl');
  const minFilterPop = document.getElementById('optMinFilterPopover');
  if (minFilterCtl){
    minFilterCtl.style.display = (metric === 'min') ? 'inline-flex' : 'none';
    if (metric !== 'min' && minFilterPop) minFilterPop.style.display = 'none';
  }

  // ---- Search + context chips (Charts-style) ----
  (function _renderChips(){
    const searchChip = document.getElementById('optSearchChip');
    const searchLabel = document.getElementById('optSearchChipLabel');
    const clearSearchBtn = document.getElementById('optClearSearchBtn');
    const contextChip = document.getElementById('optContextChip');
    const contextLabel = document.getElementById('optContextChipLabel');
    const clearContextBtn = document.getElementById('optClearContextBtn');

    // Search chip
    const term = (_getOptSearchTerm() || '').trim();
    if (searchChip && searchLabel){
      if (term){
        searchLabel.textContent = `Search: ${term}`;
        searchChip.style.display = 'inline-flex';
      } else {
        searchChip.style.display = 'none';
      }
    }
    if (clearSearchBtn && !clearSearchBtn.__wired){
      clearSearchBtn.__wired = true;
      clearSearchBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        _setOptSearchTerm('');
        const si = document.getElementById('searchInput');
        if (si) si.value = '';
        _render();
      });
    }

    // Context chip removed (breadcrumb handles drill context + navigation)
    if (contextChip) contextChip.style.display = 'none';
// ---- Breadcrumb (Charts-style) ----
  // Show only when drilled from location/sublocation -> item description.
  (function _renderBreadcrumb(){
    const el = document.getElementById('optScale');
    if (!el) return;

    const canShow = (viewBy === 'item') && !!window.__optDrillScope && (_ensureNavStack().length > 0);
    if (!canShow){
      el.innerHTML = '';
      return;
    }

    const scope = window.__optDrillScope;
    const ref = window.__optSubMap || _getSublocationMap();

    // Root crumb (consistent with Charts page wording)
    const parts = [{ type:'root', label:'All Items' }];

    if (scope.type === 'location'){
      parts.push({ type:'current', label: String(scope.key || '').trim() || 'UNKNOWN' });
    } else if (scope.type === 'sublocation'){
      const sub = String(scope.key || '').trim() || 'UNKNOWN';
      const loc = _locationLabelForSubloc(sub, ref) || 'UNKNOWN';
      parts.push({ type:'mid', label: loc });
      parts.push({ type:'current', label: sub });
    } else {
      parts.push({ type:'current', label: String(scope.key || '').trim() || 'UNKNOWN' });
    }

    // Render using the same breadcrumb classes as Charts.html (charts_v23k.css)
    const html = parts.map((p,i)=>{
      const isLast = i === parts.length - 1;
      const cls = isLast ? 'breadcrumb-current' : 'breadcrumb-item';
      const seg = `<span class="${cls}" data-crumb-idx="${i}">${_esc(p.label)}</span>`;
      if (isLast) return seg;
      return seg + `<span class="breadcrumb-separator">›</span>`;
    }).join('');
    el.innerHTML = html;

    // Optional: make the root crumb behave like "back" (same as Charts breadcrumb drilling).
    // This keeps UX consistent, but the arrow remains the primary affordance.
    const root = el.querySelector('[data-crumb-idx="0"]');
    if (root){
      root.addEventListener('click', () => {
        // Only back when drilled
        const stack = _ensureNavStack();
        if (!stack.length) return;
        _navBack();
      });
    }
  })();
})();

  const metaByCode = window.__optMetaByCode || (window.__optMetaByCode = _buildItemMetaByCode());
  const ref = window.__optSubMap || (window.__optSubMap = _getSublocationMap());

  // Item view always exposes location + sublocation toggle bars.
  // Ensure we have a location scope selected when entering Item view.
  if (viewBy === 'item' && (!window.__optDrillScope || window.__optDrillScope.type !== 'location')){
    const locChoices = _getVisibleLocationChoices(ref);
    if (locChoices.length){
      window.__optDrillScope = { type: 'location', key: locChoices[0] };
      window.__optItemSublocFilter = 'ALL';
    }
  }

  const raw = window.__optLastRaw || null;
  const computed = window.__optLastComputed || null;

  // Index of expired-leftover itemCodes per location/sublocation for the "unused" segment.
  // Recompute each render because requestMockData payload can change by date range/filters.
  const expiredIdx = _buildExpiredLeftoverIndex(raw, computed, ref);
  try{ window.__optExpiredLeftoverIdx = expiredIdx; }catch(_){ }

  const inv = _getInventory(raw, computed);
  const tx = _getTransactions(raw, computed);

  // If transactions are missing, usage-derived metrics (IUR, Min Suggestions) will
  // skew toward Overstock/No-demand. Warn loudly to help diagnose wiring issues.
  try{
    let txLen = 0;
    if (Array.isArray(tx)) txLen = tx.length;
    else if (tx && Array.isArray(tx.transactions)) txLen = tx.transactions.length;
    else if (tx && typeof tx === 'object') {
      // legacy mergedTransactions: { ITEM: {history:[...]}, ... }
      const keys = Object.keys(tx);
      if (keys.length) {
        // Count history rows approximately (cap work)
        for (let i=0;i<Math.min(keys.length, 2000);i++){
          const h = tx[keys[i]] && Array.isArray(tx[keys[i]].history) ? tx[keys[i]].history.length : 0;
          txLen += h;
          if (txLen > 0) break;
        }
      }
    }
    if (!txLen) console.warn('[Optimization] No transactions found for usage calculations. Check requestMockData wiring / cachedMockData fallbacks.');
  }catch(_){ }

  const invRecs = _iterInventoryRecords(inv);

  // IMPORTANT: Do NOT department-filter inventory records.
  // The Optimization model is pocket-scoped across ALL departments.
  // Filtering here breaks reconciliation (location != sum of sublocations)
  // and can collapse demand signals (leading to Waste/Overstock-only views).
  const filteredInv = Array.isArray(invRecs) ? invRecs.slice() : [];

  if (!filteredInv.length){
    host.innerHTML = '<div style="padding:12px;opacity:0.7;">No inventory records found.</div>';
    const scaleEl = document.getElementById('optScale');
    if (scaleEl) scaleEl.textContent = '';
    return;
  }

  // Pocket daily usage for IUR (anchored to most recent tx date; percentile-trimmed).
  // IMPORTANT: IUR bucketing is pocket-based (itemCode|sublocation)
  // so location/sublocation segments reconcile exactly.
  const _duStats = _buildDailyUsageStatsByPocket(tx, 'dispense', 14, _getUsagePercentileCutoff());
  const dailyUsageByPocket = _duStats.worstByPocket;
  const dailyMeanByPocket = _duStats.meanByPocket;
  const dailySigmaByPocket = _duStats.sigmaByPocket;

  // Trend adjustment inputs (IUR_adj = IUR - w * TrendScore)
  const trendWeightW = _getIurTrendWeightW();
  const trendMap = window.__optTrendMap && window.__optTrendMap._src === tx
    ? window.__optTrendMap.map
    : (() => {
        const map = _buildTrendScoreMap(tx);
        window.__optTrendMap = { _src: tx, map };
        return map;
      })();

  let txQty = null, txTotal = 0, binByCode = null;
  if (metric.startsWith('tx_')){
    const want = metric === 'tx_dispense' ? 'dispense' : (metric === 'tx_refill' ? 'refill' : 'waste');
    const res = _buildQtyByCode(tx, want);
    txQty = res.qty;
    txTotal = res.total;
    binByCode = _computeBinsByCode(txQty);
  }

  const groups = Object.create(null);
  // Nested grouping used for location-view expansion (location -> sublocation -> itemCode).
  const locSublocGroups = Object.create(null);
  // Groups are typically distinct per itemCode; however for IUR in Location view,
  // we must preserve the (itemCode,sublocation) granularity so Location tier counts
  // are the sum of sublocation tier counts (i.e., no silent re-tiering from summed mins).
  function addToGroup(key, itemKey, itemCode, rec){
    if (!groups[key]) groups[key] = Object.create(null);
    const byItem = groups[key];
    const subRaw = rec.sublocation || 'UNKNOWN';
    const sub = String(subRaw).trim().toUpperCase();
    const isPocketKey = (String(itemKey).indexOf('|') !== -1);
    const std = !!(rec.standard || rec.isStandard || rec.Standard);
    if (!byItem[itemKey]) {
      byItem[itemKey] = {
        itemCode,
        sublocation: sub,
        qty: 0,
        min: 0,
        max: 0,
        standard: false,
        // In Item view, we group by itemCode but keep pocket-level breakdown for sublocation compare.
        __pockets: isPocketKey ? null : Object.create(null)
      };
    }
    const tgt = byItem[itemKey];
    tgt.qty += rec.qty;
    tgt.min += rec.min;
    tgt.max += rec.max;
    tgt.standard = !!(tgt.standard || std);

    if (!isPocketKey && tgt.__pockets) {
      if (!tgt.__pockets[sub]) tgt.__pockets[sub] = { qty: 0, min: 0, max: 0, standard: false };
      const p = tgt.__pockets[sub];
      p.qty += rec.qty;
      p.min += rec.min;
      p.max += rec.max;
      p.standard = !!(p.standard || std);
    }
  }

  function addToLocSubloc(locKey, sublocKey, itemCode, rec){
    if (!locSublocGroups[locKey]) locSublocGroups[locKey] = Object.create(null);
    const byS = locSublocGroups[locKey];
    const sub = String(sublocKey || 'UNKNOWN').trim().toUpperCase();
    if (!byS[sub]) byS[sub] = Object.create(null);
    const byItem = byS[sub];
    const std = !!(rec.standard || rec.isStandard || rec.Standard);
    if (!byItem[itemCode]) byItem[itemCode] = { itemCode, sublocation: sub, qty: 0, min: 0, max: 0, standard: false };
    byItem[itemCode].qty += rec.qty;
    byItem[itemCode].min += rec.min;
    byItem[itemCode].max += rec.max;
    byItem[itemCode].standard = !!(byItem[itemCode].standard || std);
  }

  // Optional item filter (used when drilling from a segment click to item view)
  const forceItemFilter = !!window.__optForceItemFilter;
  const forcePocketFilter = !!window.__optForcePocketFilter;
  const itemFilter = (window.__optItemFilterSet && (forceItemFilter || window.__optItemFilterSet.size)) ? window.__optItemFilterSet : null;
  const pocketFilter = (window.__optPocketFilterSet && (forcePocketFilter || window.__optPocketFilterSet.size)) ? window.__optPocketFilterSet : null;

  // When drilling from a Location into Item view, allow the user to switch between
  // (All sublocations) and an individual sublocation's items.
  // Stored as a string: 'ALL' | <sublocation>
  const itemIURRateFilter = (viewBy === 'item' && metric === 'iur' && window.__optDrillScope && window.__optDrillScope.type === 'location')
    ? (String(window.__optItemIURRateFilter || 'ALL'))
    : 'ALL';
const itemSublocFilter = (viewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location')
    ? (String(window.__optItemSublocFilter || 'ALL'))
    : 'ALL';
  const itemSublocChoices = new Set();

  for (const rec of filteredInv){
    // Item view can be scoped by a prior drill from location/sublocation.
    if (viewBy === 'item' && window.__optDrillScope){
      const st = window.__optDrillScope.type;
      const sk = window.__optDrillScope.key;
      if (st === 'location'){
        const loc = _locationLabelForSubloc(rec.sublocation, ref) || 'UNKNOWN';
        if (loc !== sk) continue;
      } else if (st === 'sublocation'){
        if ((rec.sublocation || 'UNKNOWN') !== sk) continue;
      }
    }
    // Optional item filter (segment drill)
    if (viewBy === 'item' && pocketFilter){
      const pk = _normPocketKey(rec.itemCode || '', rec.sublocation || 'UNKNOWN');
      if (!pocketFilter.has(pk)) continue;
    } else if (viewBy === 'item' && itemFilter && !itemFilter.has(rec.itemCode)) {
      continue;
    }

    // Standard toggle (Min Suggestions): allow hiding standard pockets/items in the Item view.
    if (viewBy === 'item' && metric === 'min' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
      const showStd = (window.__optShowStandardItems !== false);
      if (!showStd && rec.standard) continue;
    }

    // Collect sublocation choices for the location->item drill toggle.
// NOTE: In list-comparison mode, toggles do NOT filter the list; they only affect rendering (dim/collapse non-matching items).
    if (viewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
      itemSublocChoices.add(String(rec.sublocation || 'UNKNOWN').trim().toUpperCase());
    }

    // IURRate tier filter (only in item view when drilled from a location)
    // NOTE: In list-comparison mode, toggles do NOT filter the list; they only affect rendering (dim/collapse non-matching items).
    // We still compute tiers later for display logic.

    const subKeyRaw = rec.sublocation || 'UNKNOWN';
    const locKeyRaw = _locationLabelForSubloc(rec.sublocation, ref) || 'UNKNOWN';

    // Hide Pharmacy department locations in Optimization location/sublocation views.
    const dep = _departmentForSubloc(subKeyRaw, ref);
    const hidePharmacyScope = (
      (viewBy === 'location' && (_isHiddenPharmacyLocationLabel(locKeyRaw) || dep.toUpperCase() === 'PHARMACY')) ||
      (viewBy === 'sublocation' && dep.toUpperCase() === 'PHARMACY')
    );
    if (hidePharmacyScope) continue;

    const key =
      (viewBy === 'sublocation') ? subKeyRaw :
      (viewBy === 'location') ? locKeyRaw :
      (() => {
        const meta = metaByCode[rec.itemCode] || {};
        const base = _str(meta.description || meta.name || '') || rec.itemCode || 'UNKNOWN';
        return base;
      })();

    // Preserve per-sublocation granularity for IUR in Location view so parent tiers
    // match the sum of child tiers.
    // Preserve pocket granularity ONLY in Location view so location tiers
    // equal the sum of sublocation tiers. In Item view we keep a stable
    // itemCode list and store pocket details on the row for sublocation toggles.
    const itemKey = ((metric === 'iur' || metric === 'reorder' || metric === 'min') && (viewBy === 'location'))
      ? (String(rec.itemCode || '') + '|' + String(rec.sublocation || 'UNKNOWN'))
      : String(rec.itemCode || '');
    addToGroup(key, itemKey, rec.itemCode, rec);

    // Build nested sublocation groups when in location view so we can expand rows.
    if (viewBy === 'location'){
      const locKey = locKeyRaw;
      const subKey = subKeyRaw;
      addToLocSubloc(locKey, subKey, rec.itemCode, rec);
    }
  }

  // Persist the sublocation choices for the Location→Item drill toggle.
  // If the current selection is no longer available, fall back to ALL.
  if (viewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
    const arr = Array.from(itemSublocChoices).filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b), undefined, { sensitivity:'base' }));
    window.__optItemSublocChoices = arr;
    const cur = String(window.__optItemSublocFilter || 'ALL');
    if (cur !== 'ALL' && arr.indexOf(cur) === -1){
      window.__optItemSublocFilter = 'ALL';
  window.__optItemIURRateFilter = 'ALL';
  if (opts && opts.sublocation) window.__optItemSublocFilter = String(opts.sublocation);
  if (opts && opts.iurRate) window.__optItemIURRateFilter = String(opts.iurRate);
    }
  } else {
    window.__optItemSublocChoices = null;
  }

  
  // --- List comparison mode (Item view): toggles should dim/collapse non-matching items, not filter them out.
  // Build membership maps from the same inventory records used to build the item list.
  let __itemPocketTierMap = null; // { itemCode: { sublocation: tier } }
  let __itemHasPocketMap = null;  // { itemCode: Set(sublocation) }

  if (viewBy === 'item' && metric === 'iur' && window.__optDrillScope){
    __itemPocketTierMap = Object.create(null);
    __itemHasPocketMap = Object.create(null);
    const locKeyForScope = String(window.__optDrillScope.key || '');
    let locExpired = null;
    if (expiredIdx){
      const st0 = String(window.__optDrillScope.type || '');
      if (st0 === 'location') locExpired = (expiredIdx.byLocationPocket && expiredIdx.byLocationPocket[locKeyForScope]) ? expiredIdx.byLocationPocket[locKeyForScope] : null;
      else if (st0 === 'sublocation') locExpired = (expiredIdx.bySublocationPocket && expiredIdx.bySublocationPocket[locKeyForScope]) ? expiredIdx.bySublocationPocket[locKeyForScope] : null;
    }
    const restockFreqPerDay = _getPyxisRestockFreqPerDay();
    const trendWeightW = _getIurTrendWeightW();

    // Build from filteredInv, respecting the same drill scope + segment drill filters already applied above.
    for (const rec of filteredInv){
      // Apply the same scope constraints as the main grouping loop:
      const st = window.__optDrillScope.type;
      const sk = window.__optDrillScope.key;
      if (st === 'location'){
        const loc = _locationLabelForSubloc(rec.sublocation, ref) || 'UNKNOWN';
        if (loc !== sk) continue;
      }
      // Segment drill filters (pocketFilter/itemFilter) already applied above may not apply here,
      // so re-apply them so membership matches the list exactly.
      if (pocketFilter){
        const pk = String(rec.itemCode || '') + '|' + String(rec.sublocation || 'UNKNOWN');
        if (!pocketFilter.has(pk)) continue;
      } else if (itemFilter && !itemFilter.has(rec.itemCode)) {
        continue;
      }

      const code = String(rec.itemCode || '');
      if (!code) continue;
      const sub = String(rec.sublocation || 'UNKNOWN');
      const pk = code + '|' + sub;

      if (!__itemHasPocketMap[code]) __itemHasPocketMap[code] = new Set();
      __itemHasPocketMap[code].add(sub);
      if (!__itemPocketTierMap[code]) __itemPocketTierMap[code] = Object.create(null);

      // Determine tier for this pocket using the same rules as row tiering.
      let tier = null;
      if (locExpired && locExpired.has(pk)){
        tier = 'gray';
      } else {
        const dailyDisp = _num(dailyUsageByPocket[pk], 0);
        const baseIur = dailyDisp > 0 ? ((_num(rec.min,0) * restockFreqPerDay) / dailyDisp) : Number.POSITIVE_INFINITY;
        const tScore = _num(trendMap && trendMap[String(code)], 0);
        const iur = (baseIur === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : (baseIur - (trendWeightW * tScore));
        if (iur > 6) tier = 'blue';
        else if (iur > 2) tier = 'green';
        else if (iur > 1) tier = 'yellow';
        else tier = 'coral';
      }
      __itemPocketTierMap[code][sub] = tier;
    }
  }
const rows = [];
  for (const key of Object.keys(groups)){
    const items = Object.values(groups[key]);
    const total = Math.max(1, items.length);
    const __codes = Array.from(new Set(items.map(it => String(it && it.itemCode ? it.itemCode : '')).filter(Boolean)));

    let coral=0, orange=0, yellow=0, green=0, blue=0, gray=0;
    // For cost metric, also track dollar-weighted tier totals so segments can represent cost magnitude
    let coralCost=0, orangeCost=0, greenCost=0, blueCost=0, grayCost=0;
    let costTotal = 0;
    // For transaction metrics, keep the raw transaction count available for scaling.
    let txCount = 0;
    let value = 0;

    if (metric === 'iur'){
      const restockFreqPerDay = _getPyxisRestockFreqPerDay();
      const tierItems = { gray:[], blue:[], green:[], yellow:[], coral:[] };
      let iurSum = 0;
      let iurCount = 0;

      // In location/sublocation view, the first ("unused"/translucent teal) segment should represent
      // distinct itemCodes that have inventory remaining past expiry within this scope.
      // (If an item is counted here, it is excluded from the IUR tier distribution so totals match.)
      // IMPORTANT: waste-risk bucketing is pocket-based. Do not fall back to itemCode membership,
      // otherwise a single pocket can incorrectly mark all pockets for that code as gray and
      // the sublocation segments won't sum to the location segment.
      const expiredSet = (viewBy === 'location')
        ? ((expiredIdx.byLocationPocket && expiredIdx.byLocationPocket[key]) || null)
        : (viewBy === 'sublocation')
          ? ((expiredIdx.bySublocationPocket && expiredIdx.bySublocationPocket[key]) || null)
          : null;

      // IMPORTANT: In Location view, ensure tier counts reconcile exactly with the sum of
      // the expanded Sublocation rows. We do this by computing tiers per sublocation
      // (pocket-based) and summing the counts, rather than re-tiering from any aggregated totals.
      if (viewBy === 'location' && locSublocGroups && locSublocGroups[key]) {
        const subMap = locSublocGroups[key];
        for (const subKey of Object.keys(subMap)) {
          const byItem = subMap[subKey] || {};
          const subItems = Object.values(byItem);
          const subRow = _computeIURRow(subKey, subItems, 'sublocation');
          coral += subRow.coral || 0;
          yellow += subRow.yellow || 0;
          green += subRow.green || 0;
          blue += subRow.blue || 0;
          gray += subRow.gray || 0;

          // Merge tier members for drilldown. Keep pocketKey for accurate filtering.
          if (subRow.tierItems) {
            tierItems.coral.push(...(subRow.tierItems.coral || []));
            tierItems.yellow.push(...(subRow.tierItems.yellow || []));
            tierItems.green.push(...(subRow.tierItems.green || []));
            tierItems.blue.push(...(subRow.tierItems.blue || []));
            tierItems.gray.push(...(subRow.tierItems.gray || []));
          }

          // Aggregate average IUR stats for sorting
          if (Number.isFinite(subRow.avgIUR)) { iurSum += subRow.avgIUR * (subRow._iurCount || 0); iurCount += (subRow._iurCount || 0); }
        }
      } else {
        for (const it of items){
          const pocketKey = String(it.itemCode || '') + '|' + String(it.sublocation || 'UNKNOWN');
          if (expiredSet && expiredSet.has(pocketKey)){
            gray++;
            tierItems.gray.push({ itemCode: it.itemCode, sublocation: it.sublocation || 'UNKNOWN', pocketKey, iur: NaN, reason: 'projected_leftover' });
            continue;
          }
          const dailyDisp = _num(dailyUsageByPocket[pocketKey], 0);
          const baseIur = dailyDisp > 0 ? ((it.min * restockFreqPerDay) / dailyDisp) : Number.POSITIVE_INFINITY;
          const tScore = _num(trendMap[it.itemCode], 0);
          const iur = (baseIur === Number.POSITIVE_INFINITY)
            ? Number.POSITIVE_INFINITY
            : (baseIur - (trendWeightW * tScore));

          if (iur > 6) { blue++; tierItems.blue.push({ itemCode: it.itemCode, sublocation: it.sublocation || 'UNKNOWN', pocketKey, iur }); }
          else if (iur > 2) { green++; tierItems.green.push({ itemCode: it.itemCode, sublocation: it.sublocation || 'UNKNOWN', pocketKey, iur }); }
          else if (iur > 1) { yellow++; tierItems.yellow.push({ itemCode: it.itemCode, sublocation: it.sublocation || 'UNKNOWN', pocketKey, iur }); }
          else if (iur >= 0) { coral++; tierItems.coral.push({ itemCode: it.itemCode, sublocation: it.sublocation || 'UNKNOWN', pocketKey, iur }); }
          else { coral++; tierItems.coral.push({ itemCode: it.itemCode, sublocation: it.sublocation || 'UNKNOWN', pocketKey, iur }); }

          if (Number.isFinite(iur) && iur !== Number.POSITIVE_INFINITY) { iurSum += iur; iurCount++; }
        }
      }

      value = (coral + yellow) / total;
      // Average IUR for sorting in item view.
      const avgIUR = iurCount ? (iurSum / iurCount) : NaN;
      // Aggregate min/max qty across this scope for Item view tooltip.
      let minQty = 0, maxQty = 0;
      if (viewBy === 'item'){
        const seenMM = new Set();
        for (const it of items){
          const mmk = String(it.itemCode || '') + '|' + String(it.sublocation || '');
          if (seenMM.has(mmk)) continue;
          seenMM.add(mmk);
          minQty += _num(it.min, 0);
          maxQty += _num(it.max, 0);
        }
      }


      // Waste-risk pocket membership for the current drill scope (location or sublocation).
      // Used when computing pocket-level IUR values in Item view.
      let locExpired = null;
      if (viewBy === 'item' && window.__optDrillScope && expiredIdx){
        const sk = String(window.__optDrillScope.key || '');
        if (window.__optDrillScope.type === 'location'){
          locExpired = (expiredIdx.byLocationPocket && expiredIdx.byLocationPocket[sk]) ? expiredIdx.byLocationPocket[sk] : null;
        } else if (window.__optDrillScope.type === 'sublocation'){
          locExpired = (expiredIdx.bySublocationPocket && expiredIdx.bySublocationPocket[sk]) ? expiredIdx.bySublocationPocket[sk] : null;
        }
      }

      // Per-sublocation aggregates for tooltip when toggling sublocation pills in Item view.
      // Keys are raw sublocation strings (dataset already standardized).
      let __mmBySubloc = null;
      let __duBySubloc = null;
      let __iurBySubloc = null;
      if (viewBy === 'item'){
        __mmBySubloc = {};
        __duBySubloc = {};
        __iurBySubloc = {};
        const seen = new Set();
        for (const it of items){
          const code = String(it.itemCode || '');
          const sub = String(it.sublocation || 'UNKNOWN');
          const pk = code + '|' + sub;
          if (!code) continue;
          if (seen.has(pk)) continue;
          seen.add(pk);
          if (!__mmBySubloc[sub]) __mmBySubloc[sub] = { min: 0, max: 0 };
          __mmBySubloc[sub].min += _num(it.min, 0);
          __mmBySubloc[sub].max += _num(it.max, 0);
          __duBySubloc[sub] = (_num(__duBySubloc[sub], 0) + _num(dailyUsageByPocket[pk], 0));
          // Cache pocket-level IUR value for sublocation toggle bar scaling
          {
            const dailyDisp = _num(dailyUsageByPocket[pk], 0);
            const baseIur = (dailyDisp > 0) ? ((_num(it.min,0) * restockFreqPerDay) / dailyDisp) : Number.POSITIVE_INFINITY;
            const tScore = _num(trendMap && trendMap[String(code)], 0);
            let iurVal = (baseIur === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : (baseIur - (trendWeightW * tScore));
            if (locExpired && locExpired.has(pk)) iurVal = Number.POSITIVE_INFINITY;
            __iurBySubloc[sub] = iurVal;
          }
        }
      }

      // Item tier (for Item view single-color bars)
      let itemTier = null;
      if (viewBy === 'item'){
        const vTier = (Number.isFinite(avgIUR) ? avgIUR : Number.POSITIVE_INFINITY);
        if (vTier > 6) itemTier = 'blue';
        else if (vTier > 2) itemTier = 'green';
        else if (vTier > 1) itemTier = 'yellow';
        else if (vTier >= 0) itemTier = 'coral';
        else itemTier = 'coral';

        // If we arrived here via a segment click drill, force the item color to the
        // clicked segment's tier to guarantee visual consistency (especially for Waste Risk).
        if (window.__optDrillScope && window.__optDrillScope.tier){
          itemTier = String(window.__optDrillScope.tier);
        }
      }

      // Store tier members for segment click drill-down.
      // (Note: for location/sublocation view this is the set of itemCodes in each tier.)
      rows.push({
        key,
        total,
        coral, orange, yellow, green, blue, gray,
        coralCost, orangeCost, greenCost, blueCost, grayCost,
        costTotal,
        value,
        tierItems,
        avgIUR,
        minQty,
        maxQty,
        __mmBySubloc,
        __duBySubloc,
        __iurBySubloc,
        // Daily usage is pocket-based: sum last-14-day dispense totals across distinct pockets in this row.
        dailyUsage: (viewBy === 'item' ? (() => {
          let sum14 = 0;
          const seen = new Set();
          for (const it2 of items){
            const pk2 = String(it2.itemCode || '') + '|' + String(it2.sublocation || 'UNKNOWN');
            if (!pk2 || seen.has(pk2)) continue;
            seen.add(pk2);
            sum14 += _num(dailyUsageByPocket[pk2], 0);
          }
          return sum14;
        })() : 0),
        itemTier,
        __codes: Array.from(new Set(items.map(it => String(it && it.itemCode ? it.itemCode : '')).filter(Boolean))),
        __primaryCode: (viewBy === 'item' ? (Array.from(new Set(items.map(it => String(it && it.itemCode ? it.itemCode : '')).filter(Boolean)))[0] || '') : '')
      });
      continue;
    }
    else if (metric === 'reorder'){
      const tierItems = { gray:[], green:[], orange:[], coral:[] };
      const surge = _getWhatIfSurgeMultiplier();
      const reviewDays = _getWhatIfReviewPeriodDays();
      const z = _getWhatIfServiceLevelZ(); // reserved for future when std is available

      // Item view needs pocket-level overlays per sublocation.
      const __actionBySubloc = Object.create(null); // subloc -> action summary
      const __mmBySubloc = Object.create(null);
      const __duBySubloc = Object.create(null);
      const __hasSubloc = new Set();

      let reorderNow = 0;
      let reorderSoon = 0;
      let ok = 0;
      let noDemand = 0;
      let estCost = 0;
      let estQty = 0;
      let minDays = Number.POSITIVE_INFINITY;
      let minQty = Number.POSITIVE_INFINITY;
      let maxQty = 0;

      for (const it of items){
        const code = String(it.itemCode || '');
        const sub = String(it.sublocation || 'UNKNOWN');
        const pk = code + '|' + sub;
        const qty = _num(it.qty, 0);
        const minQ = _num(it.min, 0);
        const maxQ = _num(it.max, 0);

        if (Number.isFinite(minQ) && minQ < minQty) minQty = minQ;
        if (Number.isFinite(maxQ) && maxQ > maxQty) maxQty = maxQ;

        const du = _num(dailyUsageByPocket[pk], 0);
        const trendCtx = _trendContextFor(_datasetEndISO(), String(it.sublocation || ''), String(it.itemCode || ''));
        const trendMult = trendCtx.trendMult;
    const demand = du * surge * trendMult;
        const lt = _leadTimeDaysForSubloc(sub, ref);
        const cover = lt + reviewDays;

        // Reorder point model (v1): min + demand during (lead time + review).
        // Safety stock term reserved; std not currently available in this build.
        const safetyStock = 0; // z * sigma * sqrt(cover)
        const reorderPoint = minQ + (demand * cover) + safetyStock;

        const needNow = (demand > 0) ? (qty < reorderPoint) : false;
        const recQty = needNow ? Math.max(0, maxQ - qty) : 0;
        const daysUntil = (demand > 0) ? Math.max(0, (qty - reorderPoint) / demand) : Number.POSITIVE_INFINITY;

        // Bucket assignment
        let bucket = 'green';
        if (!(demand > 0)) bucket = 'gray';
        else if (needNow) bucket = 'coral';
        else if (daysUntil <= 3) bucket = 'orange';
        else bucket = 'green';

        if (bucket === 'gray') noDemand++;
        else if (bucket === 'coral') reorderNow++;
        else if (bucket === 'orange') reorderSoon++;
        else ok++;

        const meta = metaByCode[code] || {};
        const unit = _unitCostFromMeta(meta);
        estQty += recQty;
        estCost += recQty * unit;
        if (Number.isFinite(daysUntil) && daysUntil < minDays) minDays = daysUntil;

        // Keep members for tooltip + segment drill
        tierItems[bucket].push({ itemCode: code, sublocation: sub, pocketKey: pk, reorderPoint, leadTimeDays: lt, demand, recQty, daysUntil });

        // Item-view overlays per sublocation
        if (viewBy === 'item'){
          __hasSubloc.add(sub);
          __mmBySubloc[sub] = { min: minQ, max: maxQ };
          __duBySubloc[sub] = demand;
          __actionBySubloc[sub] = { bucket, reorderPoint, leadTimeDays: lt, recQty, daysUntil, demand };
        }
      }

      // value = primarily reorder-now pockets; secondary reorder-soon; tertiary cost
      value = (reorderNow * 1.0) + (reorderSoon * 0.25) + (Math.min(1e6, estCost) / 1e6) * 0.01;

      // Map into existing tier slots
      coral = reorderNow;
      orange = reorderSoon;
      green = ok;
      gray = noDemand;

      rows.push({
        key,
        total,
        coral, orange, yellow, green, blue, gray,
        value,
        tierItems,
        estCost,
        estQty,
        minDaysUntil: Number.isFinite(minDays) ? minDays : Number.POSITIVE_INFINITY,
        minQty: Number.isFinite(minQty) ? minQty : 0,
        maxQty: Number.isFinite(maxQty) ? maxQty : 0,
        __mmBySubloc,
        __duBySubloc,
        __actionBySubloc,
        __hasSubloc: Array.from(__hasSubloc),
        __codes,
        __primaryCode: (viewBy === 'item' ? (__codes[0] || '') : '')
      });
      continue;
    }
    else if (metric === 'min'){
      // Pocket-first min level suggestions
      // SuggestedMin = demand*(leadTime+review) + safetyStock
      // where demand = dailyUsageWorst * surge, safetyStock = z * sigma * sqrt(coverDays)
      const tierItems = { gray:[], green:[], blue:[], coral:[] }; // gray=no demand, coral=increase, blue=decrease, green=ok

      const surge = _getWhatIfSurgeMultiplier();
      const reviewDays = _getWhatIfReviewPeriodDays();
      const z = _getWhatIfServiceLevelZ();
      const thr = _getMinSuggestionDeltaThreshold();

      // Item view overlays per sublocation
      const __minBySubloc = Object.create(null);      // subloc -> { curMin, sugMin, delta, leadTimeDays, demand, sigma, coverDays, safetyStock }
      const __mmBySubloc = Object.create(null);
      const __duBySubloc = Object.create(null);
      const __hasSubloc = new Set();

      let inc=0, dec=0, ok=0, noDem=0;
      let netDeltaUnits = 0;
      let netDeltaCost = 0;
      let incUnits = 0;
      let decUnits = 0;
      let absDeltaSum = 0;
      let minQty = Number.POSITIVE_INFINITY;
      let maxQty = 0;
      let minDelta = Number.POSITIVE_INFINITY;
      let maxDelta = Number.NEGATIVE_INFINITY;

      for (const it of items){
        const code = String(it.itemCode || '');
        if (!code) continue;

        // In Item view, each row aggregates multiple pockets; keep pocket-level math here.
        const pocketMap = (viewBy === 'item' && it.__pockets) ? it.__pockets : null;
        const pocketEntries = pocketMap ? Object.keys(pocketMap) : [String(it.sublocation || 'UNKNOWN')];

        for (const subKey of pocketEntries){
          const sub = String(subKey || 'UNKNOWN').trim().toUpperCase();
          const pk = _normPocketKey(code, sub);

          const pocket = pocketMap ? (pocketMap[sub] || {}) : it;

          const qty = _num(pocket.qty, 0);
          const curMin = _num(pocket.min, 0);
          const maxQ = _num(pocket.max, 0);
          const standard = !!(pocket.standard || it.standard);

        if (Number.isFinite(curMin) && curMin < minQty) minQty = curMin;
        if (Number.isFinite(maxQ) && maxQ > maxQty) maxQty = maxQ;

        // Use *worst-case* daily demand for min suggestions.
        // This matches the conservative philosophy of preventing stockouts under variability.
        // dailyUsageByPocket is the pocket-level worst-case (max(mean, NZ percentile, UCB)).
        const duWorst = _num(dailyUsageByPocket && dailyUsageByPocket[pk], 0);
        const sigma = _num(dailySigmaByPocket && dailySigmaByPocket[pk], 0);

        // Optional: apply cached trend spike multiplier (computed once & saved to Google Sheets)
        // Priority: pocketKey -> itemCode -> sublocation -> default 1.0
        let spike = 1.0;
        try {
          if (window.SpikeFactors && typeof window.SpikeFactors.getSpikeMultiplierForPocket === 'function') {
            spike = _num(window.SpikeFactors.getSpikeMultiplierForPocket(pk, code, sub), 1.0);
            if (!(spike > 0)) spike = 1.0;
          }
        } catch (_) { spike = 1.0; }

        const trendCtx = _trendContextFor(_datasetEndISO(), sub, code);
        const trendMult = trendCtx.trendMult;
        const demand = duWorst * surge * spike * trendMult;
        const lt = _leadTimeDaysForSubloc(sub, ref);
        const cover = lt + reviewDays;

        // Safety stock uses demand volatility estimate (sigma from daily series)
        const safetyStock = (sigma > 0 && cover > 0) ? (z * sigma * Math.sqrt(cover)) : 0;

        // Suggested min units (round up to integer)
        let sugMin = (demand * cover) + safetyStock;
        // Keep mins sane relative to max (never suggest min > max if max is set)
        if (Number.isFinite(maxQ) && maxQ > 0) sugMin = Math.min(sugMin, maxQ);
        sugMin = Math.max(0, sugMin);
        const sugMinInt = Math.ceil(sugMin);

        const delta = sugMinInt - curMin;
const meta = metaByCode[code] || {};
        const unit = _unitCostFromMeta(meta);
        const deltaCost = delta * unit;
        netDeltaUnits += delta;
        netDeltaCost += deltaCost;
        if (delta > 0) incUnits += delta; else if (delta < 0) decUnits += delta;
        absDeltaSum += Math.abs(delta);
        if (delta < minDelta) minDelta = delta;
        if (delta > maxDelta) maxDelta = delta;

        let bucket = 'green';
        if (!(demand > 0)) bucket = 'gray';
        else if (delta >= thr) bucket = 'coral';
        else if (delta <= -thr) bucket = 'blue';
        else bucket = 'green';

        if (bucket === 'gray') noDem++;
        else if (bucket === 'coral') inc++;
        else if (bucket === 'blue') dec++;
        else ok++;

        tierItems[bucket].push({
          itemCode: code,
          sublocation: sub,
          pocketKey: pk,
          curMin,
          sugMin: sugMinInt,
          delta,
          standard,
          leadTimeDays: lt,
          demand,
          spikeMultiplier: spike,
          trendMultiplier: trendMult,
          trendMultUsed: trendMult,
          trendSource: trendCtx.trendSource,
          trendWindowDays: trendCtx.trendWindowDays,
          sigma,
          coverDays: cover,
          safetyStock,
          unitCost: unit,
          deltaCost
        });

          if (viewBy === 'item'){
            __hasSubloc.add(sub);
            __mmBySubloc[sub] = { min: curMin, max: maxQ };
            __duBySubloc[sub] = demand;
            __minBySubloc[sub] = { curMin, max: maxQ, sugMin: sugMinInt, delta, standard, leadTimeDays: lt, demand, trendMultUsed: trendMult, trendSource: trendCtx.trendSource, trendWindowDays: trendCtx.trendWindowDays, sigma, coverDays: cover, safetyStock, unitCost: unit, deltaCost };
          }
        }
      }

      // Map to existing tier slots
      coral = inc;
      blue = dec;
      green = ok;
      gray = noDem;

      // value used for sorting (when not in alpha mode): total magnitude of adjustments
      value = absDeltaSum;

      rows.push({
        key,
        total,
        coral, orange, yellow, green, blue, gray,
        value,
        tierItems,
        netDeltaUnits,
        netDeltaCost,
        incUnits,
        decUnits,
        minQty: Number.isFinite(minQty) ? minQty : 0,
        maxQty: Number.isFinite(maxQty) ? maxQty : 0,
        minDelta: Number.isFinite(minDelta) ? minDelta : 0,
        maxDelta: Number.isFinite(maxDelta) ? maxDelta : 0,
        __mmBySubloc,
        __duBySubloc,
        __minBySubloc,
        __hasSubloc: Array.from(__hasSubloc),
        __codes,
        __primaryCode: (viewBy === 'item' ? (__codes[0] || '') : '')
      });
      continue;
    }

    else if (metric === 'cost'){
      const tierItems = { gray:[], green:[], orange:[], coral:[] };
      for (const it of items){
        const meta = metaByCode[it.itemCode] || {};
        const c = it.qty * _unitCostFromMeta(meta);
        if (!Number.isFinite(c) || c <= 0) {
          gray++;
          tierItems.gray.push({ itemCode: it.itemCode, cost: NaN });
        } else if (c > 5000) {
          coral++;
          coralCost += c;
          costTotal += c;
          tierItems.coral.push({ itemCode: it.itemCode, cost: c });
        } else if (c > 2000) {
          orange++;
          orangeCost += c;
          costTotal += c;
          tierItems.orange.push({ itemCode: it.itemCode, cost: c });
        } else {
          green++;
          greenCost += c;
          costTotal += c;
          tierItems.green.push({ itemCode: it.itemCode, cost: c });
        }
      }
      value = costTotal;
    }
    else if (metric.startsWith('tx_')){
      let groupQty = 0;
      let top25=0, mid25=0, rest=0;
      for (const it of items){
        const q = _num(txQty && txQty[it.itemCode], 0);
        groupQty += q;

        const bin = (binByCode && binByCode[it.itemCode]) ? binByCode[it.itemCode] : 'gray';
        if (bin === 'coral') top25++;
        else if (bin === 'orange') mid25++;
        else rest++;
      }
      coral = top25; orange = mid25; gray = rest;
      value = (txTotal > 0) ? (groupQty / txTotal) : 0;
      // Preserve raw transaction count so the Refill view can scale bar lengths by
      // transaction volume (instead of share-of-total).
      txCount = groupQty;
    }
    else if (metric === 'qty'){
      const avg = items.reduce((s,it)=>s+_num(it.qty,0),0) / total;
      value = avg;
      for (const it of items){
        const q = _num(it.qty,0);
        if (!Number.isFinite(q) || q<=0) gray++;
        else if (q > avg*1.5) coral++;
        else if (q > avg*0.8) orange++;
        else green++;
      }
    }

    rows.push({
      key,
      total,
      coral, orange, yellow, green, blue, gray,
      coralCost, orangeCost, greenCost, blueCost, grayCost,
      costTotal,
      value,
      tierItems: (typeof tierItems !== 'undefined') ? tierItems : undefined,
      txCount: (typeof txCount !== 'undefined') ? txCount : undefined,
      __codes
    });
  }

  // Search filter (applies to current list view)
  {
    const term = (_getOptSearchTerm() || '').trim().toLowerCase();
    if (term){
      const kept = rows.filter(r=>{
        const k = String(r.key||'').toLowerCase();
        if (k.includes(term)) return true;
        const codes = Array.isArray(r.__codes) ? r.__codes : [];
        for (const c of codes){
          if (String(c||'').toLowerCase().includes(term)) return true;
        }
        return false;
      });
      rows.length = 0;
      rows.push(...kept);
    }
  }

  
// Sorting
  // - Item view defaults to alphabetical (A→Z), but Min Suggestions can optionally sort by impact.
  if (viewBy === 'item'){
    if (metric === 'min' && _getMinSuggestionSortMode() === 'impact'){
      const subSel = (window.__optDrillScope && window.__optDrillScope.type === 'location') ? String(window.__optItemSublocFilter || 'ALL') : 'ALL';
      rows.sort((a,b)=>{
        const av = (subSel !== 'ALL' && a.__minBySubloc && a.__minBySubloc[subSel]) ? Math.abs(_num(a.__minBySubloc[subSel].delta,0)) : Math.abs(_num(a.value,0));
        const bv = (subSel !== 'ALL' && b.__minBySubloc && b.__minBySubloc[subSel]) ? Math.abs(_num(b.__minBySubloc[subSel].delta,0)) : Math.abs(_num(b.value,0));
        if (av !== bv) return bv - av;
        return String(a.key||'').localeCompare(String(b.key||''), undefined, { sensitivity:'base' });
      });
    } else {
      rows.sort((a,b)=> String(a.key||'').localeCompare(String(b.key||''), undefined, { sensitivity:'base' }));
    }
  }
  else if (metric === 'cost' && viewBy === 'item' && window.__optSortByCost){
    const dir = window.__optSortCostAsc ? 1 : -1;
    rows.sort((a,b)=>{
      const av = Number.isFinite(a.costTotal) ? a.costTotal : Number.POSITIVE_INFINITY;
      const bv = Number.isFinite(b.costTotal) ? b.costTotal : Number.POSITIVE_INFINITY;
      if (av !== bv) return (av - bv) * dir;
      return String(a.key||'').localeCompare(String(b.key||''), undefined, { sensitivity:'base' });
    });
  }
  else if (window.__optAlphaSort){
    rows.sort((a,b)=> String(a.key||'').localeCompare(String(b.key||''), undefined, { sensitivity:'base' }));
  } else {
    rows.sort((a,b)=> (b.value||0) - (a.value||0) || (b.total - a.total));
  }

  const scaleEl = document.getElementById('optScale');
  if (scaleEl){
    if (metric.startsWith('tx_')){
      const maxPct = rows.reduce((m,r)=>Math.max(m,_num(r.value,0)),0);
      scaleEl.textContent = `0 → ${(maxPct*100).toFixed(2)}%`;
    } else {
      scaleEl.textContent = '';
    }
  }

  const maxVal = rows.reduce((m,r)=>Math.max(m,_num(r.value,0)),0);
  const maxTxCount = rows.reduce((m,r)=>Math.max(m,_num(r.txCount,0)),0);

  // Ensure scale header exists before use
  scaleHeader = document.getElementById('optScaleHeader');
  if (!scaleHeader){
    scaleHeader = document.createElement('div');
    scaleHeader.id = 'optScaleHeader';
    scaleHeader.className = 'opt-scale-header';
  }
  scaleHeader.innerHTML = '';
  host.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'optimization-list';
  const postMountAnims = [];
  const maxItems = rows.reduce((m,r)=> Math.max(m, _num(r.total,0)), 0) || 1;
  const maxIUR = (metric === 'iur' && viewBy === 'item')
    ? (()=>{
        let mx = 0;
        for (const rr of rows){
          const v = (Number.isFinite(rr.avgIUR) ? rr.avgIUR : 0);
          if (v > mx) mx = v;
        }
        // Keep scale stable; cap extremely large values.
        mx = Math.min(mx || 0, 10);
        return mx > 0 ? mx : 6;
      })()
    : 0;

  const maxMinDeltaAbs = (metric === 'min' && viewBy === 'item')
    ? (()=>{
        let mx = 0;
        for (const rr of rows){
          const m = rr && rr.__minBySubloc ? rr.__minBySubloc : null;
          if (!m) continue;
          for (const k in m){
            const d = Math.abs(_num(m[k] && m[k].delta, 0));
            if (d > mx) mx = d;
          }
        }
        return mx > 0 ? mx : 1;
      })()
    : 0;
  // Render scale header (aligned to bar column)
  const track = document.createElement('div'); track.className='opt-scale-track';
  // Left side controls inside the scale track
  const trackLeft = document.createElement('div');
  trackLeft.className = 'opt-scale-track-left';


  const leftGroup = document.createElement('div');
  leftGroup.className = 'opt-scale-left-group';
  const rightGroup = document.createElement('div');
  rightGroup.className = 'opt-scale-right-group';

  const _mkArrowToggleBar = (values, currentValue, onPick, typeClass, includeAll) => {
    const bar = document.createElement('div');
    const controlsClass = (typeClass === 'chart-toggle-bar-loc') ? 'loc-controls' : 'subloc-controls';
    bar.className = 'chart-toggle-bar ' + typeClass + ' ' + controlsClass;

    const left = document.createElement('button');
    left.className = 'chart-toggle-arrow left toggle-arrow-left';
    left.type = 'button';
    left.setAttribute('aria-label', 'Scroll left');
    left.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

    const right = document.createElement('button');
    right.className = 'chart-toggle-arrow right toggle-arrow-right';
    right.type = 'button';
    right.setAttribute('aria-label', 'Scroll right');
    right.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

    const scroller = document.createElement('div');
    scroller.className = 'opt-subloc-toggle chart-toggle-scroll ' + (typeClass === 'chart-toggle-bar-loc' ? 'loc-toggles' : 'subloc-toggles');
    const kind = (typeClass === 'chart-toggle-bar-loc') ? 'loc' : 'subloc';

    try {
      window.__optToggleScroll = window.__optToggleScroll || {};
      const saved = window.__optToggleScroll[kind];
      if (typeof saved === 'number' && isFinite(saved)) scroller.scrollLeft = Math.max(0, saved);
    } catch(_) {}
    scroller.addEventListener('scroll', ()=>{
      try {
        window.__optToggleScroll = window.__optToggleScroll || {};
        window.__optToggleScroll[kind] = scroller.scrollLeft;
      } catch(_) {}
    }, { passive: true });

    const list = (includeAll === false ? [] : ['ALL']).concat(Array.isArray(values) ? values.filter(Boolean) : []);
    const seen = new Set();
    for (const rawVal of list){
      const val = String(rawVal || '').trim().toUpperCase();
      if (!val || seen.has(val)) continue;
      seen.add(val);
      const btn = document.createElement('div');
      btn.className = 'opt-subloc-btn' + ((String(currentValue || 'ALL').toUpperCase() === val) ? ' active' : '');
      btn.textContent = (val === 'ALL') ? 'All' : val;
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.addEventListener('click', (e)=>{ try { window.__optToggleScroll = window.__optToggleScroll || {}; window.__optToggleScroll[kind] = scroller.scrollLeft; } catch(_) {} e.stopPropagation(); onPick(val); });
      btn.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') btn.click(); });
      scroller.appendChild(btn);
    }

    left.addEventListener('click', (e)=>{ e.stopPropagation(); scroller.scrollBy({ left: -220, behavior: 'smooth' }); });
    right.addEventListener('click', (e)=>{ e.stopPropagation(); scroller.scrollBy({ left: 220, behavior: 'smooth' }); });

    const updateArrows = ()=>{
      const overflow = (scroller.scrollWidth - scroller.clientWidth) > 2;
      left.style.display = overflow ? 'flex' : 'none';
      right.style.display = overflow ? 'flex' : 'none';
      bar.classList.toggle('no-arrows', !overflow);
    };

    const postMountAdjust = ()=>{
      try {
        const active = scroller.querySelector('.opt-subloc-btn.active');
        if (!active) return;
        const aLeft = active.offsetLeft;
        const aRight = aLeft + active.offsetWidth;
        const vLeft = scroller.scrollLeft;
        const vRight = vLeft + scroller.clientWidth;
        if (aLeft < vLeft) scroller.scrollLeft = Math.max(0, aLeft - 18);
        else if (aRight > vRight) scroller.scrollLeft = aRight - scroller.clientWidth + 18;
        window.__optToggleScroll = window.__optToggleScroll || {};
        window.__optToggleScroll[kind] = scroller.scrollLeft;
      } catch(_) {}
    };

    try {
      requestAnimationFrame(()=>requestAnimationFrame(()=>{ postMountAdjust(); updateArrows(); }));
      if (typeof ResizeObserver !== 'undefined'){
        const ro = new ResizeObserver(updateArrows);
        ro.observe(scroller);
        ro.observe(bar);
      } else {
        window.addEventListener('resize', updateArrows);
      }
    } catch(_){ postMountAdjust(); updateArrows(); }

    bar.appendChild(left);
    bar.appendChild(scroller);
    bar.appendChild(right);
    return bar;
  };

  // Item view controls: location + sublocation segmented toggles (with left/right arrows)
  if (viewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
    const currentLoc = String(window.__optDrillScope.key || '').toUpperCase();
    const __itemCodesForScope = (()=>{
      const out = new Set();
      try {
        if (window.__optItemFilterSet && window.__optItemFilterSet.size) {
          for (const c of window.__optItemFilterSet) out.add(String(c || '').trim());
        }
        if (window.__optPocketFilterSet && window.__optPocketFilterSet.size) {
          for (const pk of window.__optPocketFilterSet) {
            const c = String(pk || '').split('|')[0] || '';
            if (c) out.add(c);
          }
        }
      } catch(_) {}
      return Array.from(out).filter(Boolean);
    })();
    const txLocChoices = _getTxLocationChoicesForItems(tx, __itemCodesForScope, ref);
    const locChoices = txLocChoices.length ? txLocChoices : _getVisibleLocationChoices(ref);
    if (locChoices.length){
      leftGroup.appendChild(_mkArrowToggleBar(locChoices, currentLoc || 'ALL', (val)=>{
        if (String(window.__optDrillScope.key || '').toUpperCase() === val) return;
        window.__optDrillScope = { type: 'location', key: val };
        window.__optItemSublocFilter = 'ALL';
        _render();
      }, 'chart-toggle-bar-loc', false));
    }

    const choices = Array.isArray(window.__optItemSublocChoices) ? window.__optItemSublocChoices : [];
    if (choices.length){
      const cur = String(window.__optItemSublocFilter || 'ALL').toUpperCase();
      leftGroup.appendChild(_mkArrowToggleBar(choices, cur, (val)=>{
        window.__optItemSublocFilter = val;
        _render();
      }, 'chart-toggle-bar-subloc', true));
    }
  }


  // IURRate toggle (filters Item view by IUR tier color)
  if (metric === 'iur' && viewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
    const cur = String(window.__optItemIURRateFilter || 'ALL');
    const group = document.createElement('div');
    group.className = 'opt-iurrate-toggle';

    const leftLbl = document.createElement('div');
    leftLbl.className = 'opt-iurrate-end';
    leftLbl.textContent = 'Waste';
    group.appendChild(leftLbl);

    const btnWrap = document.createElement('div');
    btnWrap.className = 'opt-iurrate-btnwrap';

    const tierLabel = (t)=>{
      if (t === 'coral') return 'High Stock Out Risk';
      if (t === 'yellow') return 'Stock Out Risk';
      if (t === 'green') return 'Healthy Stock';
      if (t === 'blue') return 'Overstock Risk';
      if (t === 'gray') return 'Waste Risk';
      return '';
    };

    const mk = (tier)=>{
      const b = document.createElement('div');
      b.className = 'opt-iurrate-btn tier-' + tier + ((cur === tier) ? ' active' : '');
      b.setAttribute('role','button');
      b.setAttribute('tabindex','0');
      b.setAttribute('title', tierLabel(tier));
      b.addEventListener('click', (e)=>{
        e.stopPropagation();
        window.__optItemIURRateFilter = (cur === tier) ? 'ALL' : tier;
        _render();
      });
      b.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') b.click(); });
      return b;
    };

    // Left-to-right: Waste -> Stock Out
    ['gray','blue','green','yellow','coral'].forEach(t=>btnWrap.appendChild(mk(t)));
    group.appendChild(btnWrap);

    const rightLbl = document.createElement('div');
    rightLbl.className = 'opt-iurrate-end';
    rightLbl.textContent = 'Stock Out';
    group.appendChild(rightLbl);

    trackLeft.appendChild(group);
  }


// Min Suggestions controls + legend
if (metric === 'min'){
  // Legend
  const legend = document.createElement('div');
  legend.className = 'opt-min-legend';
  const leg = (cls, label) => {
    const it = document.createElement('div');
    it.className = 'opt-min-legend-item ' + cls + ((String(window.__optItemMinBucketFilter||'ALL')===cls)?' active':'');
    it.setAttribute('data-bucket', cls);
    it.setAttribute('role','button');
    it.setAttribute('tabindex','0');
    it.innerHTML = `<span class="opt-min-dot ${cls}"></span><span class="opt-min-lbl">${_esc(label)}</span>`;

    const onPick = ()=>{
      // Clicking legend should filter the current Item list to that bucket.
      // If the user is still in Location view but has a focused/expanded location,
      // drill into Item view for that location with the selected bucket.
      const cur = String(window.__optItemMinBucketFilter || 'ALL');
      const next = (cur === cls) ? 'ALL' : cls;

      if (window.__optViewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
        window.__optItemMinBucketFilter = next;
        _render();
        return;
      }

      // Location view: if a location is expanded/focused, drill into it.
      const locKey = String(window.__optExpandedLocKey || '');
      if (locKey){
        _drillToItemScope('location', locKey, { minBucket: next, sublocation: 'ALL' });
      }
    };

    it.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); onPick(); });
    it.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); onPick(); } });
    return it;
  };
  legend.appendChild(leg('gray','No demand'));
  legend.appendChild(leg('blue','Decrease'));
  legend.appendChild(leg('green','OK'));
  legend.appendChild(leg('coral','Increase'));

  // Replace the old adjustment-threshold badge with a "Standard" toggle.
  // This hides/unhides standard pockets/items in the Item view list.
  if (viewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
    // Persisted setting (default: show standard items)
    if (window.__optShowStandardItems == null){
      try {
        const raw = localStorage.getItem('optShowStandardItems');
        if (raw != null) window.__optShowStandardItems = (String(raw) !== 'false');
      } catch(_){ }
      if (window.__optShowStandardItems == null) window.__optShowStandardItems = true;
    }

    const showStd = (window.__optShowStandardItems !== false);
    const stdBtn = document.createElement('div');
    stdBtn.className = 'opt-min-pill' + (showStd ? ' active' : '');
    stdBtn.setAttribute('role','button');
    stdBtn.setAttribute('tabindex','0');
    stdBtn.textContent = 'Standard';
    stdBtn.title = showStd ? 'Click to hide standard items' : 'Click to show standard items';
    const toggleStd = ()=>{
      window.__optShowStandardItems = !(window.__optShowStandardItems !== false);
      try{ localStorage.setItem('optShowStandardItems', String(window.__optShowStandardItems)); }catch(_){ }
      _render();
    };
    stdBtn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleStd(); });
    stdBtn.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') toggleStd(); });
    rightGroup.appendChild(stdBtn);
  }

  const filterControl = document.getElementById('optMinFilterControl');
  const filterBtn = document.getElementById('optMinFilterIconBtn');
  const legendPop = document.getElementById('optMinFilterPopover');
  if (filterControl && filterBtn && legendPop){
    filterControl.style.display = 'inline-flex';
    legendPop.innerHTML = '';
    const frame = document.createElement('div');
    frame.className = 'opt-min-legend-pop';
    frame.appendChild(legend);
    legendPop.appendChild(frame);

    const closePop = ()=>{ legendPop.style.display = 'none'; };
    if (!filterBtn.__optBound){
      filterBtn.__optBound = true;
      filterBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        if (legendPop.style.display === 'none') { _closeOptTransientPopups('minFilter'); legendPop.style.display = 'block'; } else legendPop.style.display = 'none';
      });
    }

    window.__optMinLegendPopover = { pop: legendPop, btn: filterBtn };
    if (!window.__optMinLegendPopoverBound){
      window.__optMinLegendPopoverBound = true;
      document.addEventListener('click', (ev)=>{
        try {
          const st = window.__optMinLegendPopover || null;
          if (!st || !st.pop || !st.btn) return;
          if (!st.pop.contains(ev.target) && ev.target !== st.btn && !st.btn.contains(ev.target)) {
            st.pop.style.display = 'none';
          }
        } catch(_){ }
      });
    }
  }
}
  // Build track content
  trackLeft.appendChild(leftGroup);
  trackLeft.appendChild(rightGroup);
  track.appendChild(trackLeft);
  scaleHeader.appendChild(track);

  // Mount scale header into the sticky strip under the header controls (like Charts page)
  const scaleStrip = document.getElementById('optScaleStrip');
  if (scaleStrip){
    scaleStrip.innerHTML = '';
    scaleStrip.appendChild(scaleHeader);
  } else {
    // Fallback: mount inside the scroll area
    root.appendChild(scaleHeader);
  }


  // Helper to compute IUR composition for a list of aggregated item records.
  // IMPORTANT: Treat each (itemCode,sublocation) as a distinct "pocket" when scopeType === 'location'.
  function _computeIURRow(key, items, scopeType){
    const sType = scopeType || 'location';

    // Collapse only within the same pocket (itemCode|sublocation). For sublocation scope,
    // itemCode is already unique, but we keep the same pocket logic for consistency.
    const byPocket = new Map();
    for (const it of (items || [])){
      const code = _str(it && it.itemCode);
      if (!code) continue;
      const sub = _str(it && it.sublocation) || 'UNKNOWN';
      const pk = code + '|' + sub;
      const cur = byPocket.get(pk) || { itemCode: code, sublocation: sub, pocketKey: pk, min: 0, qty: 0, max: 0 };
      cur.min += _num(it.min, 0);
      cur.qty += _num(it.qty, 0);
      cur.max += _num(it.max, 0);
      byPocket.set(pk, cur);
    }

    const totalDistinct = Math.max(1, byPocket.size);
    let coral=0, yellow=0, green=0, blue=0, gray=0;
    const tierItems = { gray:[], blue:[], green:[], yellow:[], coral:[] };
    const restockFreqPerDay = _getPyxisRestockFreqPerDay();
    let iurSum = 0, iurCount = 0;

    const expiredSet = (sType === 'location')
      ? (expiredIdx && expiredIdx.byLocationPocket && expiredIdx.byLocationPocket[key] ? expiredIdx.byLocationPocket[key] : null)
      : (sType === 'sublocation')
        ? (expiredIdx && expiredIdx.bySublocationPocket && expiredIdx.bySublocationPocket[key] ? expiredIdx.bySublocationPocket[key] : null)
        : null;

    for (const it of byPocket.values()){
      const pk = it.pocketKey;
      if (expiredSet && expiredSet.has(pk)){
        gray++;
        tierItems.gray.push({ itemCode: it.itemCode, sublocation: it.sublocation, pocketKey: pk, iur: NaN, reason: 'projected_leftover' });
        continue;
      }

      const dailyDisp = _num(dailyUsageByPocket[pk], 0);
      const baseIur = dailyDisp > 0 ? ((it.min * restockFreqPerDay) / dailyDisp) : Number.POSITIVE_INFINITY;
      const tScore = _num(trendMap && trendMap[it.itemCode], 0);
      const iur = (baseIur === Number.POSITIVE_INFINITY)
        ? Number.POSITIVE_INFINITY
        : (baseIur - (trendWeightW * tScore));

      const m = { itemCode: it.itemCode, sublocation: it.sublocation, pocketKey: pk, iur };
      if (iur > 6) { blue++; tierItems.blue.push(m); }
      else if (iur > 2) { green++; tierItems.green.push(m); }
      else if (iur > 1) { yellow++; tierItems.yellow.push(m); }
      else { coral++; tierItems.coral.push(m); }

      if (Number.isFinite(iur) && iur !== Number.POSITIVE_INFINITY) { iurSum += iur; iurCount++; }
    }

    const avgIUR = iurCount ? (iurSum / iurCount) : NaN;

    return {
      key,
      total: totalDistinct,
      coral, yellow, green, blue, gray,
      // keep other tier fields present so downstream rendering doesn't branch
      orange: 0,
      coralCost:0, orangeCost:0, greenCost:0, blueCost:0, grayCost:0,
      costTotal:0,
      value: (coral + yellow) / totalDistinct,
      tierItems,
      avgIUR,
      _iurSum: iurSum,
      _iurCount: iurCount
    };
  }

  // Helper to compute Cost tier composition for a list of aggregated item records.
  function _computeCostRow(key, items){
    // Count DISTINCT items per tier; collapse by itemCode and sum qty.
    const byCode = new Map();
    for (const it of items){
      const code = it.itemCode;
      if (!code) continue;
      const cur = byCode.get(code) || { itemCode: code, qty: 0 };
      cur.qty += _num(it.qty, 0);
      byCode.set(code, cur);
    }

    const totalDistinct = Math.max(1, byCode.size);
    let coral=0, orange=0, green=0, gray=0;
    const tierItems = { gray:[], green:[], orange:[], coral:[] };
    let coralCost=0, orangeCost=0, greenCost=0, grayCost=0;
    let costTotal = 0;

    for (const it of byCode.values()){
      const meta = metaByCode[it.itemCode] || {};
      const c = it.qty * _unitCostFromMeta(meta);
      if (!Number.isFinite(c) || c <= 0){
        gray++;
        tierItems.gray.push({ itemCode: it.itemCode, cost: NaN });
      } else if (c > 5000){
        coral++; coralCost += c; costTotal += c;
        tierItems.coral.push({ itemCode: it.itemCode, cost: c });
      } else if (c > 2000){
        orange++; orangeCost += c; costTotal += c;
        tierItems.orange.push({ itemCode: it.itemCode, cost: c });
      } else {
        green++; greenCost += c; costTotal += c;
        tierItems.green.push({ itemCode: it.itemCode, cost: c });
      }
    }
    return {
      key,
      total: totalDistinct,
      coral, orange, yellow:0, green, blue:0, gray,
      coralCost, orangeCost, greenCost, blueCost:0, grayCost,
      costTotal,
      value: costTotal,
      tierItems
    };
  }

  function _computeReorderRow(key, items){
    const surge = _getWhatIfSurgeMultiplier();
    const reviewDays = _getWhatIfReviewPeriodDays();

    let coral=0, orange=0, green=0, gray=0;
    const tierItems = { gray:[], green:[], orange:[], coral:[] };
    let estCost = 0;
    let estQty = 0;
    let minDays = Number.POSITIVE_INFINITY;

    const byPocket = new Map();
    for (const it of (items || [])){
      const code = _str(it && it.itemCode);
      if (!code) continue;
      const sub = _str(it && it.sublocation) || 'UNKNOWN';
      const pk = code + '|' + sub;
      // Consolidate duplicates if present
      const cur = byPocket.get(pk) || { itemCode: code, sublocation: sub, pocketKey: pk, min: 0, qty: 0, max: 0 };
      cur.min = _num(it.min ?? cur.min, cur.min);
      cur.max = _num(it.max ?? cur.max, cur.max);
      cur.qty = _num(it.qty ?? cur.qty, cur.qty);
      byPocket.set(pk, cur);
    }

    for (const it of byPocket.values()){
      const pk = it.pocketKey;
      const trendCtx = _trendContextFor(_datasetEndISO(), it.sublocation, it.itemCode);
      const trendMult = trendCtx.trendMult;
      const demand = _num(dailyUsageByPocket[pk], 0) * surge * trendMult;
      if (!(demand > 0)){
        gray++;
        tierItems.gray.push({ itemCode: it.itemCode, sublocation: it.sublocation, pocketKey: pk, demand, trendMultUsed: trendMult, trendSource: trendCtx.trendSource, trendWindowDays: trendCtx.trendWindowDays, recQty: 0, daysUntil: Number.POSITIVE_INFINITY });
        continue;
      }
      const lt = _leadTimeDaysForSubloc(it.sublocation, ref);
      const cover = lt + reviewDays;
      const reorderPoint = _num(it.min,0) + (demand * cover);
      const needNow = _num(it.qty,0) < reorderPoint;
      const recQty = needNow ? Math.max(0, _num(it.max,0) - _num(it.qty,0)) : 0;
      const daysUntil = Math.max(0, (_num(it.qty,0) - reorderPoint) / demand);
      let bucket = 'green';
      if (needNow) bucket = 'coral';
      else if (daysUntil <= 3) bucket = 'orange';
      else bucket = 'green';

      if (bucket === 'coral') coral++;
      else if (bucket === 'orange') orange++;
      else green++;

      const meta = metaByCode[it.itemCode] || {};
      const unit = _unitCostFromMeta(meta);
      estQty += recQty;
      estCost += recQty * unit;
      if (Number.isFinite(daysUntil) && daysUntil < minDays) minDays = daysUntil;
      tierItems[bucket].push({ itemCode: it.itemCode, sublocation: it.sublocation, pocketKey: pk, reorderPoint, leadTimeDays: lt, demand, trendMultUsed: trendMult, trendSource: trendCtx.trendSource, trendWindowDays: trendCtx.trendWindowDays, recQty, daysUntil });
    }

    const total = Math.max(1, coral + orange + green + gray);
    const value = (coral * 1.0) + (orange * 0.25);
    return {
      key,
      total,
      coral,
      orange,
      yellow: 0,
      green,
      blue: 0,
      gray,
      value,
      tierItems,
      estCost,
      estQty,
      minDaysUntil: Number.isFinite(minDays) ? minDays : Number.POSITIVE_INFINITY
    };
  }

  // Helper to compute Min Suggestions composition for a list of aggregated item records.
  // IMPORTANT: Min Suggestions are ALWAYS computed at pocket granularity (itemCode|sublocation).
  // For sublocation scope, itemCode is typically unique already, but we still collapse by pocket
  // to be defensive against duplicate inventory records.
  function _computeMinRow(key, items){
    const surge = _getWhatIfSurgeMultiplier();
    const reviewDays = _getWhatIfReviewPeriodDays();
    const z = _getWhatIfServiceLevelZ();
    const thr = _getMinSuggestionDeltaThreshold();

    const byPocket = new Map();
    for (const it of (items || [])){
      const code = _str(it && it.itemCode);
      if (!code) continue;
      const sub = _str(it && it.sublocation) || 'UNKNOWN';
      const pk = _normPocketKey(code, sub);
      const cur = byPocket.get(pk) || { itemCode: code, sublocation: sub, pocketKey: pk, qty: 0, min: 0, max: 0 };
      cur.qty += _num(it.qty, 0);
      cur.min += _num(it.min, 0);
      cur.max += _num(it.max, 0);
      byPocket.set(pk, cur);
    }

    const totalDistinct = Math.max(1, byPocket.size);
    let coral=0, blue=0, green=0, gray=0;
    const tierItems = { gray:[], green:[], blue:[], coral:[] };

    let netDeltaUnits = 0;
    let netDeltaCost = 0;
    let incUnits = 0;
    let decUnits = 0;
    let absDeltaSum = 0;

    for (const it of byPocket.values()){
      const code = it.itemCode;
      const sub = it.sublocation;
      const pk = it.pocketKey;

      const qty = _num(it.qty, 0);
      const curMin = _num(it.min, 0);
      const maxQ = _num(it.max, 0);

      // Min Suggestions uses worst-case daily demand (same conservative philosophy as IUR worst-case).
      const duWorst = _num(dailyUsageByPocket && dailyUsageByPocket[pk], 0);
      const sigma = _num(dailySigmaByPocket && dailySigmaByPocket[pk], 0);
      // Apply what-if surge multiplier (and optional spike cache multiplier is handled downstream in SpikeFactors module).
      const trendMult = _trendMultFor(_datasetEndISO(), sub, code);
      const demand = duWorst * surge * trendMult;
      const lt = _leadTimeDaysForSubloc(sub, ref);
      const cover = lt + reviewDays;
      const safetyStock = (sigma > 0 && cover > 0) ? (z * sigma * Math.sqrt(cover)) : 0;

      let sugMin = (demand * cover) + safetyStock;
      if (Number.isFinite(maxQ) && maxQ > 0) sugMin = Math.min(sugMin, maxQ);
      sugMin = Math.max(0, sugMin);
      const sugMinInt = Math.ceil(sugMin);

      const delta = sugMinInt - curMin;
      const meta = metaByCode[code] || {};
      const unit = _unitCostFromMeta(meta);
      const deltaCost = delta * unit;

      netDeltaUnits += delta;
      netDeltaCost += deltaCost;
      if (delta > 0) incUnits += delta; else if (delta < 0) decUnits += delta;
      absDeltaSum += Math.abs(delta);

      let bucket = 'green';
      if (!(demand > 0)) bucket = 'gray';
      else if (delta >= thr) bucket = 'coral';
      else if (delta <= -thr) bucket = 'blue';
      else bucket = 'green';

      if (bucket === 'gray') gray++;
      else if (bucket === 'coral') coral++;
      else if (bucket === 'blue') blue++;
      else green++;

      tierItems[bucket].push({
        itemCode: code,
        sublocation: sub,
        pocketKey: pk,
        curMin,
        sugMin: sugMinInt,
        delta,
        leadTimeDays: lt,
        demand,
        sigma,
        coverDays: cover,
        safetyStock,
        unitCost: unit,
        deltaCost
      });
    }

    return {
      key,
      total: totalDistinct,
      coral,
      orange: 0,
      yellow: 0,
      green,
      blue,
      gray,
      coralCost:0, orangeCost:0, greenCost:0, blueCost:0, grayCost:0,
      costTotal:0,
      // Use total adjustment magnitude for sorting in Min Suggestions.
      value: absDeltaSum,
      tierItems,
      netDeltaUnits,
      netDeltaCost,
      incUnits,
      decUnits
    };
  }


  // Focus mode: only one expanded location at a time.
  const isDrillMetric = (metric === 'iur' || metric === 'cost' || metric === 'reorder' || metric === 'min');
  const expandedKey = (isDrillMetric && viewBy === 'location') ? (window.__optExpandedLocKey || null) : null;
  if (expandedKey) list.classList.add('has-focus');

  // Min Suggestions (Item view): scale daily-dispense bars by the max daily dispense in-view.
  // This is independent from min/max tick positioning (which remains quantity-based).
  let __maxMinDailyDisp = 0;
  if (metric === 'min' && viewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location') {
    const subSelRaw = String(window.__optItemSublocFilter || 'ALL');
    const subSel = (subSelRaw && subSelRaw !== 'ALL') ? subSelRaw.trim().toUpperCase() : 'ALL';
    for (const rr of rows) {
      // Skip items that are not present in the selected sublocation (compare mode)
      const hasArr = Array.isArray(rr.__hasSubloc) ? rr.__hasSubloc : [];
      const inSub = (subSel === 'ALL') ? true : (hasArr.indexOf(subSel) !== -1);
      if (!inSub) continue;

      let aSel = null;
      if (subSel !== 'ALL' && rr.__minBySubloc && rr.__minBySubloc[subSel]) {
        aSel = rr.__minBySubloc[subSel];
      } else if (rr.__minBySubloc) {
        let best = null;
        let bestAbs = -1;
        for (const k in rr.__minBySubloc) {
          const a = rr.__minBySubloc[k];
          const d = Math.abs(_num(a && a.delta, 0));
          if (d > bestAbs) { bestAbs = d; best = a; }
        }
        aSel = best;
      }
      const du = _num(aSel && aSel.demand, 0);
      if (du > __maxMinDailyDisp) __maxMinDailyDisp = du;
    }
  }
  window.__optMinMaxDailyDispense = (__maxMinDailyDisp > 0) ? __maxMinDailyDisp : 1;

  for (const r of rows){
    // Item view refinement:
    // - Tier toggle FILTERS the list to items that have ANY pocket in the selected tier within this drilled Location scope.
    // - Sublocation toggle does NOT filter; it only dims/collapses items that do not exist in the selected sublocation.
    if (viewBy === 'item' && metric === 'iur' && window.__optDrillScope && window.__optDrillScope.type === 'location') {
      const tierSel = String(window.__optItemIURRateFilter || 'ALL');
      if (tierSel && tierSel !== 'ALL') {
        const code = String(r.__primaryCode || (r.__codes && r.__codes[0]) || '');
        let keep = true;
        if (code && __itemPocketTierMap && __itemPocketTierMap[code]) {
          const tmap = __itemPocketTierMap[code];
          let any = false;
          for (const k in tmap) { if (tmap[k] === tierSel) { any = true; break; } }
          keep = any;
        }
        if (!keep) continue;
      }
    }

    // Item view (Min Suggestions): optional bucket filter driven by segment click or legend click.
    // Buckets are the Min categories (Increase=coral, No demand=gray, Decrease=blue, OK=green).
    if (viewBy === 'item' && metric === 'min' && window.__optDrillScope && window.__optDrillScope.type === 'location') {
      const bucketSelRaw = String(window.__optItemMinBucketFilter || 'ALL');
      const bucketSel = (bucketSelRaw && bucketSelRaw !== 'ALL') ? bucketSelRaw.trim().toLowerCase() : 'ALL';
      if (bucketSel && bucketSel !== 'ALL') {
        const thr = _getMinSuggestionDeltaThreshold();
        const subSelRaw = String(window.__optItemSublocFilter || 'ALL');
        const subSel = (subSelRaw && subSelRaw !== 'ALL') ? subSelRaw.trim().toUpperCase() : 'ALL';
        let delta = 0;
        let demand = 0;
        if (subSel && subSel !== 'ALL' && r.__minBySubloc && r.__minBySubloc[subSel]) {
          const a = r.__minBySubloc[subSel];
          delta = _num(a && a.delta, 0);
          demand = _num(a && a.demand, 0);
        } else if (r.__minBySubloc) {
          // ALL: strongest adjustment (abs delta)
          let bestD = 0;
          let bestDem = 0;
          for (const k in r.__minBySubloc) {
            const a = r.__minBySubloc[k];
            const d = _num(a && a.delta, 0);
            if (Math.abs(d) > Math.abs(bestD)) {
              bestD = d;
              bestDem = _num(a && a.demand, 0);
            }
          }
          delta = bestD;
          demand = bestDem;
        }

        let bucket = 'green';
        if (!(demand > 0)) bucket = 'gray';
        else if (delta >= thr) bucket = 'coral';
        else if (delta <= -thr) bucket = 'blue';
        else bucket = 'green';

        if (bucket !== bucketSel) continue;
      }
    }

    const row = document.createElement('div');
    row.className = 'opt-row';

    const left = document.createElement('div');
    left.className = 'opt-row-left';
    const title = document.createElement('div');
    title.className = 'opt-row-title' + ((isDrillMetric && viewBy === 'location') ? ' opt-clickable' : '');
    title.title = String(r.key);
    title.textContent = r.key;
    // Item view: clicking the item name jumps to Charts and opens the vertical bar usage view
    // for the current itemCode + selected sublocation filter.
    if (viewBy === 'item'){
      title.classList.add('opt-clickable');
      title.addEventListener('click', (e)=>{
        try {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        } catch (_) {}

        // In item view, r.key is typically the display name. Use the canonical code field.
        const itemCode = String(
          (r && (r.__primaryCode || r.itemCode || r.ItemCode))
          || (r && r.__codes && r.__codes[0])
          || ''
        ).trim();
        if (!itemCode) return;

        const subRaw = String(window.__optItemSublocFilter || 'ALL');
        const sublocation = (subRaw && subRaw !== 'ALL') ? subRaw.trim().toUpperCase() : '';

        // If the user drilled from a location row (not a sublocation), also pass the current location scope
        // so Charts can pre-select the location toggle when sublocation is blank.
        let location = '';
        try {
          const ds = window.__optDrillScope;
          if (ds && ds.type === 'location' && ds.key) location = String(ds.key).trim().toUpperCase();
        } catch (_) {}
// Tell the parent dashboard to switch to Analytics (Charts) and drill to this item.
        // Dashboard will handle tab switching + forwarding to Charts iframe.
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'drillToItemInVerticalBar', itemCode, sublocation, location }, '*');
          } else {
            window.postMessage({ type: 'drillToItemInVerticalBar', itemCode, sublocation, location }, '*');
          }
        } catch (_) {}
      });
    }
    left.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'opt-row-sub';
    left.appendChild(sub);

    const barWrap = document.createElement('div');
    barWrap.className = 'opt-bar-wrap';
    // Clicking the bar navigates to Item view.
    // - Location rows: show all items for that location (filters via toggles in Item view).
    // - Expanded sublocation rows: show items and preselect the sublocation toggle.
    if ((metric === 'iur' || metric === 'reorder' || metric === 'min') && viewBy === 'location'){
      barWrap.classList.add('opt-clickable');
      barWrap.addEventListener('click', (e)=>{
        // If the user clicked a specific segment, defer to segment-drill behavior.
        // (Some layouts end up capturing the click on the bar wrapper rather than the segment div.)
        try {
          const seg = (e.target && e.target.closest) ? e.target.closest('.opt-seg') : null;
          if (seg && r && r.tierItems){
            const tierCls = seg.getAttribute('data-bucket') || seg.getAttribute('data-tier') || '';
            if (tierCls){
              // Mirror the segment click drill logic
              const scopeType = String(r.__scopeType||'location');
              if (scopeType === 'location' || scopeType === 'sublocation'){
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();

                const subKey = (scopeType === 'sublocation') ? String(r.__scopeKey || r.key || '') : 'ALL';
                const locKey = (scopeType === 'location')
                  ? String(r.__scopeKey || r.key || '')
                  : (_locationLabelForSubloc(subKey, ref) || String(window.__optExpandedLocKey || 'UNKNOWN'));
                const drillType = (scopeType === 'sublocation') ? 'sublocation' : 'location';
                const drillKey  = (scopeType === 'sublocation') ? subKey : locKey;

                if (metric === 'iur'){
                  _drillToItemScope(drillType, drillKey, { sublocation: subKey, iurRate: String(tierCls||'') });
                } else if (metric === 'min'){
                  _drillToItemScope(drillType, drillKey, { sublocation: subKey, minBucket: String(tierCls||'') });
                } else {
                  // Reorder: move to item view with location/sublocation scope only.
                  // Do not hard-filter by member pockets from segment clicks.
                  _drillToItemScope(drillType, drillKey, { sublocation: subKey });
                }
                return;
              }
            }
          }
        } catch (_) {}

        e.stopPropagation();
        const scopeType = String(r.__scopeType || 'location');
        if (scopeType === 'sublocation'){
          const subKey = String(r.__scopeKey || r.key || '');
          const locKey = _locationLabelForSubloc(subKey, ref) || String(window.__optExpandedLocKey || 'UNKNOWN');
          _drillToItemScope('location', locKey, { sublocation: subKey });
        } else {
          _drillToItemScope('location', String(r.key||''), {});
        }
      });
    }

            

    const barTrack = document.createElement('div');
    barTrack.className = 'opt-bar-track';

    // Bar length scaling + segments
    // - tx_*: bar length is proportional to share (value), segments are tier counts.
    // - others: bar length is proportional to group item count, segments are tier composition.
    const outer = document.createElement('div');
    outer.style.display = 'flex';
    outer.style.height = '100%';
    outer.style.width = '100%';
    // Flat rectangular bars (no rounding)
    outer.style.borderRadius = '0';
    outer.style.overflow = 'hidden';

    // Tooltip for segment hover (singleton)
    function _getSegTooltip(){
      let t = document.getElementById('optSegTooltip');
      if (t) return t;
      t = document.createElement('div');
      t.id = 'optSegTooltip';
      t.className = 'opt-tooltip';
      t.style.display = 'none';
      document.body.appendChild(t);
      return t;
    }


    function _tierLabel(tierCls){
      const k = String(tierCls||'').toLowerCase();
      if (metric === 'min'){
        if (k === 'coral') return 'Increase Min';
        if (k === 'blue') return 'Decrease Min';
        if (k === 'green') return 'OK';
        if (k === 'gray') return 'No Demand';
        return '';
      }
      if (metric === 'reorder'){
        if (k === 'coral') return 'Reorder Now';
        if (k === 'orange') return 'Reorder Soon';
        if (k === 'green') return 'OK';
        if (k === 'gray') return 'No Demand';
        return '';
      }
      if (k === 'coral') return 'High Stock Out Risk';
      if (k === 'yellow') return 'Stock Out Risk';
      if (k === 'green') return 'Healthy Stock';
      if (k === 'blue') return 'Overstock Risk';
      if (k === 'gray') return 'Waste Risk';
      if (k === 'orange') return 'Mid';
      return '';
    }

    const attachSegInteractivity = (segEl, tierCls, rowObj) => {
      if (!segEl) return;
      // Tag segments so the bar wrapper can detect segment clicks reliably.
      try {
        segEl.setAttribute('data-bucket', String(tierCls||''));
        segEl.setAttribute('data-tier', String(tierCls||''));
        segEl.style.pointerEvents = 'auto';
      } catch (_) {}

      // Hover highlight + tooltip count
      segEl.addEventListener('mouseenter', (e)=>{
        segEl.classList.add('opt-seg-hover');
        if (!(metric === 'iur' || metric === 'reorder' || metric === 'min') || !rowObj || !rowObj.tierItems) return;
        const tooltip = _getSegTooltip();
        const members = rowObj.tierItems[tierCls] || [];
        const uniq = new Set(members.map(m => String((m && (m.pocketKey || m.itemCode)) ? (m.pocketKey || m.itemCode) : '')).filter(Boolean));
        if (metric === 'reorder'){
          let qSum = 0;
          for (const m of members){ qSum += _num(m && m.recQty, 0); }
          tooltip.innerHTML = `<div class="opt-tt-title">${_esc(_tierLabel(tierCls))}</div><div class="opt-tt-sub">Pockets: ${uniq.size}  •  Est Order Qty: ${Math.round(qSum)}</div>`;
        } else if (metric === 'min') {
          let dSum = 0;
          for (const m of members){ dSum += _num(m && m.delta, 0); }
          const sign = (dSum > 0) ? '+' : '';
          tooltip.innerHTML = `<div class="opt-tt-title">${_esc(_tierLabel(tierCls))}</div><div class="opt-tt-sub">Pockets: ${uniq.size}  •  Net ΔMin: ${sign}${Math.round(dSum)}</div>`;
        } else {
          tooltip.innerHTML = `<div class="opt-tt-title">${_esc(_tierLabel(tierCls))}</div><div class="opt-tt-sub">Items: ${uniq.size}</div>`;
        }
        tooltip.style.display = 'block';
      });
      segEl.addEventListener('mousemove', (e)=>{
        const tooltip = document.getElementById('optSegTooltip');
        if (!tooltip || tooltip.style.display === 'none') return;
        const pad = 12;
        tooltip.style.left = (e.clientX + pad) + 'px';
        tooltip.style.top = (e.clientY + pad) + 'px';
      });
      segEl.addEventListener('mouseleave', ()=>{
        segEl.classList.remove('opt-seg-hover');
        const tooltip = document.getElementById('optSegTooltip');
        if (tooltip) tooltip.style.display = 'none';
      });

      // Click: drill to item view filtered to ONLY the items/pockets in this segment
      if (!(metric === 'iur' || metric === 'reorder' || metric === 'min')) return;
      if (!rowObj || !rowObj.tierItems) return;
      if (!(viewBy === 'location')) return;
      // Allow segment drill from both the location row and expanded sublocation rows.
      const scopeType = String(rowObj.__scopeType||'');
      if (!(scopeType === 'location' || scopeType === 'sublocation')) return;

      segEl.classList.add('opt-clickable');
      segEl.addEventListener('click', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        // In expanded sublocation rows, segment click routes to Item view
        // and preselects the sublocation + IURRate filters.
        const subKey = (scopeType === 'sublocation') ? String(rowObj.__scopeKey || rowObj.key || '') : 'ALL';
        const locKey = (scopeType === 'location')
          ? String(rowObj.__scopeKey || rowObj.key || '')
          : (_locationLabelForSubloc(subKey, ref) || String(window.__optExpandedLocKey || 'UNKNOWN'));

        // IMPORTANT:
        // - Clicking a segment on a LOCATION row should drill to Item view scoped to that location.
        // - Clicking a segment on a SUBLOCATION row should drill to Item view scoped to that sublocation.
        //   (Otherwise the Item list stays location-wide and just dims/collapses, which looks like a "full list".)
        const drillType = (scopeType === 'sublocation') ? 'sublocation' : 'location';
        const drillKey  = (scopeType === 'sublocation') ? subKey : locKey;

        if (metric === 'iur'){
          _drillToItemScope(drillType, drillKey, { sublocation: subKey, iurRate: String(tierCls||'') });
        } else if (metric === 'min'){
          _drillToItemScope(drillType, drillKey, { sublocation: subKey, minBucket: String(tierCls||'') });
        } else {
          // Reorder: only scope to toggle context; do not apply pocket-level hard filters.
          _drillToItemScope(drillType, drillKey, { sublocation: subKey });
        }
      });;
    };

    const attachItemInteractivity = (el, rowObj) => {
      if (!el || !rowObj) return;
      const _calcItemTooltip = () => {
        const subSel = String(window.__optItemSublocFilter || 'ALL');
        if (metric === 'min'){
          const mm = (subSel && subSel !== 'ALL') ? (rowObj.__mmBySubloc && rowObj.__mmBySubloc[subSel]) : null;
          const a = (subSel && subSel !== 'ALL') ? (rowObj.__minBySubloc && rowObj.__minBySubloc[subSel]) : null;
          const curMin = mm ? _num(mm.min, 0) : _num(rowObj.minQty, 0);
          const maxQ = mm ? _num(mm.max, 0) : _num(rowObj.maxQty, 0);
          if (!a){
            return { curMin, maxQ, sugMin: NaN, delta: NaN, lt: NaN, demand: NaN, cover: NaN, ss: NaN, deltaCost: _num(rowObj.netDeltaCost, 0), netDeltaUnits: _num(rowObj.netDeltaUnits, 0), isAll: true };
          }
          return { curMin, maxQ, sugMin: _num(a.sugMin, 0), delta: _num(a.delta, 0), lt: _num(a.leadTimeDays, 0), demand: _num(a.demand, 0), cover: _num(a.coverDays, 0), ss: _num(a.safetyStock, 0), deltaCost: _num(a.deltaCost, 0), unitCost: _num(a.unitCost, 0), isAll: false };
        }

        if (metric === 'reorder'){
          // Reorder tooltip
          const mm = (subSel && subSel !== 'ALL') ? (rowObj.__mmBySubloc && rowObj.__mmBySubloc[subSel]) : null;
          const a = (subSel && subSel !== 'ALL') ? (rowObj.__actionBySubloc && rowObj.__actionBySubloc[subSel]) : null;
          const minQ = mm ? _num(mm.min, 0) : _num(rowObj.minQty, 0);
          const maxQ = mm ? _num(mm.max, 0) : _num(rowObj.maxQty, 0);
          if (!a){
            const dtr = (rowObj.minDaysUntil === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : _num(rowObj.minDaysUntil, Number.POSITIVE_INFINITY);
            const dtrTxt = (dtr === Number.POSITIVE_INFINITY) ? '∞' : (Number.isFinite(dtr) ? dtr.toFixed(1) : '');
            return { minQ, maxQ, demand: NaN, lt: NaN, rp: NaN, recQty: _num(rowObj.estQty, 0), dtrTxt, estCost: _num(rowObj.estCost, 0), isAll: true };
          }
          const demand = _num(a.demand, 0);
          const lt = _num(a.leadTimeDays, 0);
          const rp = _num(a.reorderPoint, 0);
          const recQty = _num(a.recQty, 0);
          const dtr = a.daysUntil;
          const dtrTxt = (dtr === Number.POSITIVE_INFINITY) ? '∞' : (Number.isFinite(dtr) ? dtr.toFixed(1) : '');
          return { minQ, maxQ, demand, lt, rp, recQty, dtrTxt, isAll: false };
        }

        // Default (IUR) tooltip
        let minQ = _num(rowObj.minQty, 0);
        let maxQ = _num(rowObj.maxQty, 0);
        let du = _num(rowObj.dailyUsage, 0);
        if (subSel && subSel !== 'ALL'){
          const mm = rowObj.__mmBySubloc && rowObj.__mmBySubloc[subSel];
          if (mm){ minQ = _num(mm.min, 0); maxQ = _num(mm.max, 0); }
          if (rowObj.__duBySubloc && (subSel in rowObj.__duBySubloc)) du = _num(rowObj.__duBySubloc[subSel], 0);
        }
        const duTxt = Number.isFinite(du) ? (Math.abs(du - Math.round(du)) < 1e-6 ? String(Math.round(du)) : du.toFixed(1)) : '0';
        return { minQ, maxQ, duTxt };
      };
      el.addEventListener('mouseenter', (e)=>{
        el.classList.add('opt-seg-hover');
        const tooltip = _getSegTooltip();
        const v = _calcItemTooltip();
        if (metric === 'reorder'){
          if (v.isAll){
            tooltip.textContent = `Est Order: ${Math.round(v.recQty)}  •  Est Cost: $${Math.round(_num(v.estCost,0)).toLocaleString()}  •  Earliest DTR: ${v.dtrTxt}d`;
          } else {
            const demTxt = Number.isFinite(v.demand) ? (Math.abs(v.demand - Math.round(v.demand)) < 1e-6 ? String(Math.round(v.demand)) : v.demand.toFixed(2)) : '0';
            tooltip.textContent = `Lead: ${v.lt}d  •  Demand: ${demTxt}/d  •  RP: ${v.rp.toFixed(1)}  •  Order: ${Math.round(v.recQty)}  •  DTR: ${v.dtrTxt}d`;
          }
        } else if (metric === 'min'){
          if (v.isAll){
            {
            const nd = _num(v.netDeltaUnits, 0);
            const s1 = (nd > 0) ? '+' : '';
            tooltip.textContent = `Min Suggestions: Net ΔMin ${s1}${Math.round(nd)}  (select a sublocation for pocket details)`;
          }
          } else {
            const demTxt = Number.isFinite(v.demand) ? (Math.abs(v.demand - Math.round(v.demand)) < 1e-6 ? String(Math.round(v.demand)) : v.demand.toFixed(2)) : '0';
            const sign = (v.delta > 0) ? '+' : '';
            {
            tooltip.textContent = `Demand: ${demTxt}/d  •  Min: ${v.curMin} → ${v.sugMin} (${sign}${Math.round(v.delta)})`;
          }
          }
        } else {
          tooltip.textContent = `Min: ${v.minQ} M  •  Max: ${v.maxQ}  •  Daily Usage: ${v.duTxt}`;
        }
        tooltip.style.display = 'block';
      });
      el.addEventListener('mousemove', (e)=>{
        const tooltip = document.getElementById('optSegTooltip');
        if (!tooltip || tooltip.style.display === 'none') return;
        // Recompute tooltip content on move so sublocation toggle changes are reflected
        // immediately even if the pointer stays within the same bar.
        const v = _calcItemTooltip();
        if (metric === 'reorder'){
          if (v.isAll){
            tooltip.textContent = `Est Order: ${Math.round(v.recQty)}  •  Est Cost: $${Math.round(_num(v.estCost,0)).toLocaleString()}  •  Earliest DTR: ${v.dtrTxt}d`;
          } else {
            const demTxt = Number.isFinite(v.demand) ? (Math.abs(v.demand - Math.round(v.demand)) < 1e-6 ? String(Math.round(v.demand)) : v.demand.toFixed(2)) : '0';
            tooltip.textContent = `Lead: ${v.lt}d  •  Demand: ${demTxt}/d  •  RP: ${v.rp.toFixed(1)}  •  Order: ${Math.round(v.recQty)}  •  DTR: ${v.dtrTxt}d`;
          }
        } else if (metric === 'min'){
          if (v.isAll){
            {
            const nd = _num(v.netDeltaUnits, 0);
            const s1 = (nd > 0) ? '+' : '';
            tooltip.textContent = `Min Suggestions: Net ΔMin ${s1}${Math.round(nd)}  (select a sublocation for pocket details)`;
          }
          } else {
            const demTxt = Number.isFinite(v.demand) ? (Math.abs(v.demand - Math.round(v.demand)) < 1e-6 ? String(Math.round(v.demand)) : v.demand.toFixed(2)) : '0';
            const sign = (v.delta > 0) ? '+' : '';
            {
            tooltip.textContent = `Demand: ${demTxt}/d  •  Min: ${v.curMin} → ${v.sugMin} (${sign}${Math.round(v.delta)})`;
          }
          }
        } else {
          tooltip.textContent = `Min: ${v.minQ} M  •  Max: ${v.maxQ}  •  Daily Usage: ${v.duTxt}`;
        }
        const pad = 12;
        tooltip.style.left = (e.clientX + pad) + 'px';
        tooltip.style.top = (e.clientY + pad) + 'px';
      });
      el.addEventListener('mouseleave', ()=>{
        el.classList.remove('opt-seg-hover');
        const tooltip = document.getElementById('optSegTooltip');
        if (tooltip) tooltip.style.display = 'none';
      });
    };


    if (metric.startsWith('tx_')){
      // Refill view: scale bar length by raw refill transaction count.
      // Other tx views keep their existing scaling.
      const w = (metric === 'tx_refill')
        ? ((maxTxCount>0) ? (_num(r.txCount,0)/maxTxCount) : 0)
        : ((maxVal>0) ? (_num(r.value,0)/maxVal) : 0);
      outer.style.width = (_clamp(w,0,1)*100).toFixed(2)+'%';
      const parts = [['gray',r.gray],['orange',r.orange],['coral',r.coral]];
      for (const [cls,cnt] of parts){
        if (!cnt) continue;
        const seg = document.createElement('div');
        seg.className = 'opt-seg ' + cls;
        seg.style.width = ((cnt/r.total)*100).toFixed(2)+'%';
        outer.appendChild(seg);

        // List comparison mode: do not filter item rows when toggles are selected.
        // Instead, dim the label and collapse the bar for items that do NOT match the selected sublocation and/or tier.
        if (window.__optDrillScope && window.__optDrillScope.type === 'location'){
          const subSel = String(window.__optItemSublocFilter || 'ALL');
          const tierSel = String(window.__optItemIURRateFilter || 'ALL');
          const hasS = (subSel && subSel !== 'ALL');
          const hasT = (tierSel && tierSel !== 'ALL');
          if (hasS || hasT){
            const code = String(r.__primaryCode || (r.__codes && r.__codes[0]) || '');
            let matches = true;

            if (code && __itemPocketTierMap && __itemHasPocketMap){
              if (hasS){
                const sset = __itemHasPocketMap[code];
                if (!sset || !sset.has(subSel)) matches = false;
              }
              if (matches && hasT){
                const tmap = __itemPocketTierMap[code] || null;
                if (hasS){
                  const t = tmap ? tmap[subSel] : null;
                  if (t !== tierSel) matches = false;
                } else {
                  // any pocket tier matches
                  let any = false;
                  if (tmap){
                    for (const k in tmap){ if (tmap[k] === tierSel){ any = true; break; } }
                  }
                  if (!any) matches = false;
                }
              }
            } else {
              // If we can't identify the itemCode, default to keeping it visible.
              matches = true;
            }

            if (!matches){
              // collapse the bar and dim label; keep the row visible for comparison.
              row.classList.add('opt-item-dim');
              outer.style.width = '0%';
              outer.dataset.targetWidth = '0%';
            } else {
              row.classList.remove('opt-item-dim');
              // If a specific sublocation is selected, align the bar color to that pocket's tier (more intuitive comparison).
              if (hasS && code && __itemPocketTierMap && __itemPocketTierMap[code] && __itemPocketTierMap[code][subSel]){
                const forcedTier = String(__itemPocketTierMap[code][subSel] || '');
                seg.className = 'opt-seg ' + forcedTier;
              }
            }
          } else {
            row.classList.remove('opt-item-dim');
          }
        }

      }
    } else {
      // Default bar scaling is by item count, but Cost view should scale by total valuation.
      const w = (metric === 'cost')
        ? ((maxVal>0) ? (_num(r.costTotal,0)/maxVal) : 0)
        : ((maxItems>0) ? (_num(r.total,0)/maxItems) : 0);
      const pct = (_clamp(w,0,1)*100).toFixed(2)+'%';
      outer.style.width = pct;
      outer.dataset.targetWidth = pct;


      // Item view (IUR): single bar scaled by IUR value and colored by tier (matches location/sublocation segment colors)
      if (metric === 'iur' && viewBy === 'item'){
        const subSelForScale = (window.__optDrillScope && window.__optDrillScope.type === 'location') ? String(window.__optItemSublocFilter || 'ALL') : 'ALL';
        let vRaw = (Number.isFinite(r.avgIUR) ? r.avgIUR : Number.POSITIVE_INFINITY);
        if (subSelForScale && subSelForScale !== 'ALL' && r.__iurBySubloc && (subSelForScale in r.__iurBySubloc)){
          vRaw = r.__iurBySubloc[subSelForScale];
        }
        const v = (vRaw === Number.POSITIVE_INFINITY) ? maxIUR : Math.max(0, Math.min(vRaw, maxIUR));
        const ww = (maxIUR > 0) ? (v / maxIUR) : 0;
        const pct2 = (_clamp(ww,0,1)*100).toFixed(2)+'%';
        outer.style.width = pct2;
        outer.dataset.targetWidth = pct2;

        const cls = r.itemTier || 'gray';
        const seg = document.createElement('div');
        seg.className = 'opt-seg ' + cls;
        seg.style.width = '100%';
        attachItemInteractivity(seg, r);
        outer.appendChild(seg);
        // Sublocation toggle dims/collapses items that are NOT present in the selected sublocation.
        if (window.__optDrillScope && window.__optDrillScope.type === 'location') {
          const subSel = String(window.__optItemSublocFilter || 'ALL');
          const hasS = (subSel && subSel !== 'ALL');
          if (hasS) {
            const code = String(r.__primaryCode || (r.__codes && r.__codes[0]) || '');
            let inSub = true;
            if (code && __itemHasPocketMap && __itemHasPocketMap[code]) {
              inSub = __itemHasPocketMap[code].has(subSel);
            }
            if (!inSub) {
              row.classList.add('opt-item-dim');
              outer.style.width = '0%';
              outer.dataset.targetWidth = '0%';
            } else {
              row.classList.remove('opt-item-dim');
              // If this item has a pocket tier for the selected sublocation, align the bar color for clarity.
              if (code && __itemPocketTierMap && __itemPocketTierMap[code] && __itemPocketTierMap[code][subSel]) {
                seg.className = 'opt-seg ' + String(__itemPocketTierMap[code][subSel]);
              }
            }
          } else {
            row.classList.remove('opt-item-dim');
          }
        }


      }
      else if (metric === 'reorder' && viewBy === 'item'){
        const subSel = (window.__optDrillScope && window.__optDrillScope.type === 'location') ? String(window.__optItemSublocFilter || 'ALL') : 'ALL';
        const hasS = (subSel && subSel !== 'ALL');
        const hasArr = Array.isArray(r.__hasSubloc) ? r.__hasSubloc : [];
        const inSub = (!hasS) ? true : (hasArr.indexOf(subSel) !== -1);

        if (!inSub){
          row.classList.add('opt-item-dim');
          outer.style.width = '0%';
          outer.dataset.targetWidth = '0%';
        } else {
          row.classList.remove('opt-item-dim');

          let bucket = 'green';
          if (hasS && r.__actionBySubloc && r.__actionBySubloc[subSel] && r.__actionBySubloc[subSel].bucket){
            bucket = String(r.__actionBySubloc[subSel].bucket);
          } else {
            // All sublocations: choose worst bucket present
            if (_num(r.coral,0) > 0) bucket = 'coral';
            else if (_num(r.orange,0) > 0) bucket = 'orange';
            else if (_num(r.green,0) > 0) bucket = 'green';
            else bucket = 'gray';
          }

          const score = (bucket === 'coral') ? 1.0 : (bucket === 'orange') ? 0.6 : (bucket === 'green') ? 0.25 : 0.0;
          const pct2 = (_clamp(score,0,1)*100).toFixed(2)+'%';
          outer.style.width = pct2;
          outer.dataset.targetWidth = pct2;

          const seg = document.createElement('div');
          seg.className = 'opt-seg ' + bucket;
          seg.style.width = '100%';
          attachItemInteractivity(seg, r);
          outer.appendChild(seg);
        }
      }
      else if (metric === 'min' && viewBy === 'item'){
        const subSelRaw = (window.__optDrillScope && window.__optDrillScope.type === 'location') ? String(window.__optItemSublocFilter || 'ALL') : 'ALL';
        const subSel = (subSelRaw && subSelRaw !== 'ALL') ? subSelRaw.trim().toUpperCase() : 'ALL';
        const hasS = (subSel && subSel !== 'ALL');
        const hasArr = Array.isArray(r.__hasSubloc) ? r.__hasSubloc : [];
        const inSub = (!hasS) ? true : (hasArr.indexOf(subSel) !== -1);

        if (!inSub){
          // Sublocation compare mode: keep the row but collapse the bar.
          row.classList.add('opt-item-dim');
          outer.style.width = '0%';
          outer.dataset.targetWidth = '0%';
        } else {
          row.classList.remove('opt-item-dim');

          // Pull pocket-level stats for the selected sublocation (or, in ALL mode, the pocket with strongest adjustment).
          let aSel = null;
          if (hasS && r.__minBySubloc && r.__minBySubloc[subSel]){
            aSel = r.__minBySubloc[subSel];
          } else if (r.__minBySubloc){
            let best = null;
            let bestAbs = -1;
            for (const k in r.__minBySubloc){
              const a = r.__minBySubloc[k];
              const d = Math.abs(_num(a && a.delta, 0));
              if (d > bestAbs){ bestAbs = d; best = a; }
            }
            aSel = best;
          }

          const curMin = _num(aSel && aSel.curMin, 0);
          const maxQ   = _num(aSel && aSel.max, 0);
          const du     = _num(aSel && aSel.demand, 0); // daily demand (worst-case * surge * spike)
          const coverDays = _num(aSel && aSel.coverDays, 0);
          const delta  = _num(aSel && aSel.delta, 0);
          const isStd  = !!(aSel && aSel.standard);

          // Bucket determines the color encoding for Min Suggestions.
          const thr = _getMinSuggestionDeltaThreshold();
          let bucket = 'green';
          if (!(du > 0)) bucket = 'gray';
          else if (delta >= thr) bucket = 'coral';
          else if (delta <= -thr) bucket = 'blue';
          else bucket = 'green';

          // Option A (Units axis): draw the bar as expected units consumed over the replenishment horizon.
          // This makes min/max ticks (units) comparable to the bar (units).
          const barUnits = du * Math.max(0, coverDays);

          // Scale everything on the same UNITS axis so ticks and the bar share a coherent coordinate system.
          // Denom is per-row so the visual story is "how close is horizon consumption to min/max for THIS pocket".
          const denom = Math.max(1, maxQ, curMin, barUnits);
          const minPos0 = _clamp(curMin / denom, 0, 1);
          const maxPos0 = _clamp((maxQ > 0 ? (maxQ / denom) : 1), 0, 1);
          // Inset tick marks slightly so borders don't get clipped by the bar-wrap overflow.
          const minPos = _clamp(minPos0, 0.015, 0.985);
          const maxPos = _clamp(maxPos0, 0.015, 0.985);

          // Bar is drawn in units (expected consumption over coverDays).
          const barPos  = _clamp(barUnits / denom, 0, 1);

          // Min Suggestions item bar is always rendered (even with no usage). Daily bar will be 0-length if du==0.
          outer.style.width = '100%';
          outer.dataset.targetWidth = '100%';

          const wrap = document.createElement('div');
          wrap.className = 'opt-min-itembar';

          const duBar = document.createElement('div');
          duBar.className = 'opt-min-du ' + bucket;
          duBar.style.width = (barPos*100).toFixed(2) + '%';
          wrap.appendChild(duBar);

          const tMin = document.createElement('div');
          tMin.className = 'opt-min-tick min' + (isStd ? ' standard' : '');
          tMin.style.left = (minPos*100).toFixed(2) + '%';
          // Hover tooltip: show the numeric min only.
          tMin.title = String(curMin);
          tMin.addEventListener('mouseenter', (e)=>{
            try { e.stopPropagation(); } catch(_){}
            const tt = document.getElementById('optSegTooltip');
            if (!tt) return;
            tt.textContent = String(curMin);
            tt.style.display = 'block';
          });
          tMin.addEventListener('mousemove', (e)=>{
            const tt = document.getElementById('optSegTooltip');
            if (!tt || tt.style.display === 'none') return;
            const pad = 12;
            tt.style.left = (e.clientX + pad) + 'px';
            tt.style.top = (e.clientY + pad) + 'px';
          });
          tMin.addEventListener('mouseleave', ()=>{
            const tt = document.getElementById('optSegTooltip');
            if (tt) tt.style.display = 'none';
          });
          wrap.appendChild(tMin);

          const tMax = document.createElement('div');
          tMax.className = 'opt-min-tick max';
          tMax.style.left = (maxPos*100).toFixed(2) + '%';
          // Hover tooltip: show the numeric max only.
          tMax.title = String(maxQ);
          tMax.addEventListener('mouseenter', (e)=>{
            try { e.stopPropagation(); } catch(_){}
            const tt = document.getElementById('optSegTooltip');
            if (!tt) return;
            tt.textContent = String(maxQ);
            tt.style.display = 'block';
          });
          tMax.addEventListener('mousemove', (e)=>{
            const tt = document.getElementById('optSegTooltip');
            if (!tt || tt.style.display === 'none') return;
            const pad = 12;
            tt.style.left = (e.clientX + pad) + 'px';
            tt.style.top = (e.clientY + pad) + 'px';
          });
          tMax.addEventListener('mouseleave', ()=>{
            const tt = document.getElementById('optSegTooltip');
            if (tt) tt.style.display = 'none';
          });
          wrap.appendChild(tMax);

          attachItemInteractivity(wrap, r);
          outer.appendChild(wrap);
        }
      }
      else if (metric === 'cost'){
        const denom = Math.max(1, _num(r.costTotal,0));
        // Cost tiers: no-cost on the left; then low -> mid -> high
        const parts = [['gray',r.grayCost],['green',r.greenCost],['orange',r.orangeCost],['coral',r.coralCost]];
        for (const [cls,amt] of parts){
          const v = _num(amt,0);
          if (!v) continue;
          const seg = document.createElement('div');
          seg.className = 'opt-seg ' + cls;
          seg.setAttribute('data-bucket', cls);
          seg.style.width = ((v/denom)*100).toFixed(2)+'%';
          attachSegInteractivity(seg, cls, r);
          outer.appendChild(seg);
        }
      } else {
        // Composition bars
        const parts = (metric === 'reorder')
          ? [['gray',r.gray],['green',r.green],['orange',r.orange],['coral',r.coral]]
          : (metric === 'min')
            ? [['gray',r.gray],['blue',r.blue],['green',r.green],['coral',r.coral]]
            // IUR + other composition bars: order left->right must be gray -> blue -> green -> yellow -> coral
            : [['gray',r.gray],['blue',r.blue],['green',r.green],['yellow',r.yellow],['coral',r.coral]];
        for (const [cls,cnt] of parts){
          if (!cnt) continue;
          const seg = document.createElement('div');
          seg.className = 'opt-seg ' + cls;
          seg.setAttribute('data-bucket', cls);
          seg.style.width = ((cnt/r.total)*100).toFixed(2)+'%';
          attachSegInteractivity(seg, cls, r);
          outer.appendChild(seg);
        }
      }
    }

    barTrack.appendChild(outer);

    barWrap.appendChild(barTrack);

    // Location view: label click drills into Item view; caret toggles expanded sublocation rows.
    if (isDrillMetric && viewBy === 'location'){
      const isOpen = expandedKey === r.key;
      title.classList.toggle('expanded', isOpen);

      // Add a small caret for expanding/collapsing sublocations (prevents conflict with drill click).
      if (!title.__hasCaret){
        title.__hasCaret = true;
        const caret = document.createElement('span');
        caret.className = 'opt-expand-caret';
        caret.setAttribute('title','Expand');
        caret.innerHTML = '&#9656;'; // ▶
        caret.addEventListener('click', (e)=>{
          e.stopPropagation();
          if (window.__optExpandedLocKey === r.key){
            window.__optExpandedLocKey = null;
            window.__optFocusMode = false;
          } else {
            window.__optExpandedLocKey = r.key;
            window.__optFocusMode = true;
          }
          _render();
        });
        title.appendChild(caret);
      }
      const caret = title.querySelector('.opt-expand-caret');
      if (caret){
        caret.classList.toggle('open', isOpen);
        caret.setAttribute('title', isOpen ? 'Collapse' : 'Expand');
      }

      // Drill when clicking the label text area.
      if (!title.__wiredDrill){
        title.__wiredDrill = true;
        title.addEventListener('click', (e)=>{
          // Ignore clicks on the caret itself
          if (e.target && e.target.classList && e.target.classList.contains('opt-expand-caret')) return;
          e.stopPropagation();
          _drillToItemScope('location', String(r.key||''), {});
        });
      }
    }

    row.appendChild(left);
    row.appendChild(barWrap);
    list.appendChild(row);

    // Focus styling: dim non-focused rows and animate parent→children transitions.
    if (expandedKey){
      if (r.key === expandedKey){
        row.classList.add('focus-parent');
        // Retract the parent bar to 0 while children expand.
        const startW = outer.dataset.targetWidth || outer.style.width || '0%';
        outer.style.width = startW;
        postMountAnims.push(()=>{
          outer.classList.add('is-collapsing');
          outer.style.width = '0%';
        });
      } else {
        row.classList.add('dim');
      }
    }

    // Render nested sublocation rows when expanded.
    if (isDrillMetric && viewBy === 'location'){
      const isOpen = expandedKey === r.key;
      if (isOpen){
        const subMap = locSublocGroups[r.key];
        if (subMap){
          const nested = document.createElement('div');
          nested.className = 'opt-nested-list';
          const subKeys = Object.keys(subMap);
          // Sort nested rows by risk (coral+yellow fraction) desc, then name.
          const subRows = subKeys.map(k=> {
            const rowObj = (metric === 'cost')
              ? _computeCostRow(k, Object.values(subMap[k] || {}))
	              : (metric === 'reorder')
	                ? _computeReorderRow(k, Object.values(subMap[k] || {}))
	                : (metric === 'min')
	                  ? _computeMinRow(k, Object.values(subMap[k] || {}))
	                  : _computeIURRow(k, Object.values(subMap[k] || {}), 'sublocation');
            // Mark nested rows as sublocation-scope so segment clicks drill correctly.
            rowObj.__scopeType = 'sublocation';
            rowObj.__scopeKey = k;
            return rowObj;
          });
          subRows.sort((a,b)=> (b.value||0)-(a.value||0) || String(a.key||'').localeCompare(String(b.key||''), undefined, { sensitivity:'base' }));

          for (const sr of subRows){
            const sRow = document.createElement('div');
            sRow.className = 'opt-row opt-row-nested';

            const sLeft = document.createElement('div');
            sLeft.className = 'opt-row-left';
            const sTitle = document.createElement('div');
            sTitle.className = 'opt-row-title opt-row-title-nested';
            sTitle.title = String(sr.key);
            sTitle.textContent = sr.key;
            sLeft.appendChild(sTitle);
            const sSub = document.createElement('div');
            sSub.className = 'opt-row-sub';
            sLeft.appendChild(sSub);

            const sBarWrap = document.createElement('div');
            sBarWrap.className = 'opt-bar-wrap';
            const sBarTrack = document.createElement('div');
            sBarTrack.className = 'opt-bar-track';
            const sOuter = document.createElement('div');
            sOuter.style.display='flex';
            sOuter.style.height='100%';
            sOuter.style.width='0%';
            sOuter.style.borderRadius='0';
            sOuter.style.overflow='hidden';

            const w = (metric === 'cost')
              ? ((maxVal>0) ? (_num(sr.costTotal,0)/maxVal) : 0)
              : ((maxItems>0) ? (_num(sr.total,0)/maxItems) : 0);
            const tW = (_clamp(w,0,1)*100).toFixed(2)+'%';
            sOuter.dataset.targetWidth = tW;
            const parts = (metric === 'cost')
              ? [['gray',sr.grayCost],['green',sr.greenCost],['orange',sr.orangeCost],['coral',sr.coralCost]]
              : (metric === 'reorder')
                ? [['gray',sr.gray],['green',sr.green],['orange',sr.orange],['coral',sr.coral]]
                : [['gray',sr.gray],['blue',sr.blue],['green',sr.green],['yellow',sr.yellow],['coral',sr.coral]];
            for (const [cls,cnt] of parts){
              if (!cnt) continue;
              const seg = document.createElement('div');
              seg.className = 'opt-seg ' + cls;
        
      // Item view (IUR): single bar scaled by IUR value and colored by tier (matches location/sublocation segment colors)
      if (metric === 'iur' && viewBy === 'item'){
        const vRaw = (Number.isFinite(r.avgIUR) ? r.avgIUR : Number.POSITIVE_INFINITY);
        const v = (vRaw === Number.POSITIVE_INFINITY) ? maxIUR : Math.max(0, Math.min(vRaw, maxIUR));
        const ww = (maxIUR > 0) ? (v / maxIUR) : 0;
        const pct2 = (_clamp(ww,0,1)*100).toFixed(2)+'%';
        outer.style.width = pct2;
        outer.dataset.targetWidth = pct2;

        const cls = r.itemTier || 'gray';
        const seg = document.createElement('div');
        seg.className = 'opt-seg ' + cls;
        seg.style.width = '100%';
        attachItemInteractivity(seg, r);
        outer.appendChild(seg);
      }
      else if (metric === 'cost'){
                const denom = Math.max(1, _num(sr.costTotal,0));
                seg.style.width = ((_num(cnt,0)/denom)*100).toFixed(2)+'%';
              } else {
                seg.style.width = ((cnt/sr.total)*100).toFixed(2)+'%';
              }
              attachSegInteractivity(seg, cls, sr);
              sOuter.appendChild(seg);
            }
            sBarTrack.appendChild(sOuter);
            sBarWrap.appendChild(sBarTrack);

            sRow.appendChild(sLeft);
            sRow.appendChild(sBarWrap);
            sRow.classList.add('focus-child');
            nested.appendChild(sRow);

            // Animate nested bars from 0 → target simultaneously with parent collapse.
            postMountAnims.push(()=>{
              const tw = sOuter.dataset.targetWidth || '0%';
              sOuter.style.width = tw;
            });
          }
          list.appendChild(nested);
        }
      }
    }
  }


  // Mount list, then run simultaneous animations.
  host.appendChild(list);
  requestAnimationFrame(()=>{
    for (const fn of postMountAnims) fn();
  });
}


// Back-button style navigation parity with Inventory/Charts pages
let optimizationPreviousPage = null;
let optimizationBackButtonVisible = false;

function ensureOptimizationBackButton() {
  let backButton = document.getElementById('backButton');
  if (backButton) return backButton;

  const headerContent = document.querySelector('.charts-header .header-content');
  if (!headerContent) return null;

  let headerRight = headerContent.querySelector('.header-right');
  if (!headerRight) {
    headerRight = document.createElement('div');
    headerRight.className = 'header-right';
    headerContent.appendChild(headerRight);
  }

  backButton = document.createElement('div');
  backButton.id = 'backButton';
  backButton.className = 'back-button';
  backButton.setAttribute('role', 'button');
  backButton.setAttribute('tabindex', '0');
  backButton.setAttribute('aria-label', 'Back');
  backButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg>';
  headerRight.appendChild(backButton);

  const goBack = () => {
    if (optimizationPreviousPage && window.parent) {
      window.parent.postMessage({
        type: 'navigateToTab',
        tab: optimizationPreviousPage,
        isBackNavigation: true
      }, '*');
      backButton.classList.remove('visible');
      optimizationBackButtonVisible = false;
      optimizationPreviousPage = null;
    }
  };

  backButton.addEventListener('click', goBack);
  backButton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goBack();
    }
  });

  return backButton;
}
// Messaging
window.addEventListener('message', function(e){
  const msg = e && e.data;
  if (!msg || typeof msg !== 'object' || !msg.type) return;

  const backButton = ensureOptimizationBackButton();
  if (msg.type === 'setReferrer') {
    if (msg.referrer && msg.referrer !== null) {
      optimizationPreviousPage = msg.referrer;
      if (backButton) {
        backButton.classList.add('visible');
        optimizationBackButtonVisible = true;
      }
    }
    return;
  }
  if (msg.type === 'navigateWithFilter') {
    if (msg.referrer && msg.referrer !== null) {
      optimizationPreviousPage = msg.referrer;
      if (backButton) {
        backButton.classList.add('visible');
        optimizationBackButtonVisible = true;
      }
    }
  }

  if (msg.type === 'mockDataResponse' || msg.type === 'sendMockData'){
    window.__optLastRaw = _getRawFromMessage(msg);
    window.__optLastComputed = _getComputedFromMessage(msg);
    _render();
  } else if (msg.type === 'updateSettings'){
    const s = msg.settings || {};
    if (s.pyxisRestockFreqPerDay != null){
      window.__pyxisRestockFreqPerDay = s.pyxisRestockFreqPerDay;
      try{ localStorage.setItem('pyxisRestockFreqPerDay', String(s.pyxisRestockFreqPerDay)); }catch(_){ }
    }
    if (s.iurTrendWeightW != null){
      window.__iurTrendWeightW = s.iurTrendWeightW;
      try{ localStorage.setItem('iurTrendWeightW', String(s.iurTrendWeightW)); }catch(_){ }
    }
    
    // What-if (Optimization)
    if (s.whatIfLeadTimeMultiplier != null){
      window.__whatIfLeadTimeMultiplier = s.whatIfLeadTimeMultiplier;
      try{ localStorage.setItem('whatIfLeadTimeMultiplier', String(s.whatIfLeadTimeMultiplier)); }catch(_){ }
    }
    if (s.whatIfLeadTimeAddDays != null){
      window.__whatIfLeadTimeAddDays = s.whatIfLeadTimeAddDays;
      try{ localStorage.setItem('whatIfLeadTimeAddDays', String(s.whatIfLeadTimeAddDays)); }catch(_){ }
    }
    if (s.whatIfSurgeMultiplier != null){
      window.__whatIfSurgeMultiplier = s.whatIfSurgeMultiplier;
      try{ localStorage.setItem('whatIfSurgeMultiplier', String(s.whatIfSurgeMultiplier)); }catch(_){ }
    }
    if (s.whatIfReviewPeriodDays != null){
      window.__whatIfReviewPeriodDays = s.whatIfReviewPeriodDays;
      try{ localStorage.setItem('whatIfReviewPeriodDays', String(s.whatIfReviewPeriodDays)); }catch(_){ }
    }
    if (s.whatIfServiceLevelPreset != null){
      window.__whatIfServiceLevelPreset = s.whatIfServiceLevelPreset;
      try{ localStorage.setItem('whatIfServiceLevelPreset', String(s.whatIfServiceLevelPreset)); }catch(_){ }
    }
    if (s.whatIfHorizonDays != null){
      window.__whatIfHorizonDays = s.whatIfHorizonDays;
      try{ localStorage.setItem('whatIfHorizonDays', String(s.whatIfHorizonDays)); }catch(_){ }
    }
    if (s.whatIfApplyLeadTimeTo != null){
      window.__whatIfApplyLeadTimeTo = s.whatIfApplyLeadTimeTo;
      try{ localStorage.setItem('whatIfApplyLeadTimeTo', String(s.whatIfApplyLeadTimeTo)); }catch(_){ }
    }

    // Clear cached trend map so it recomputes with fresh tx if needed
    window.__optTrendMap = null;
    _render();
  } else if (msg.type === 'darkModeToggle'){
    document.body.classList.toggle('dark-mode', !!msg.enabled);
  }
});

function _requestMock(){
  try{ window.parent.postMessage({ type: 'requestMockData', target: 'optimization' }, '*'); }catch(_){}
}



function _openWasteOptimizationReport(){
  const raw = window.__optLastRaw;
  const computed = window.__optLastComputed;
  const inv = _getInventory(raw, computed);
  const tx = _getTransactions(raw, computed);
  const ref = window.__optSubMap || (window.__optSubMap = _getSublocationMap());
  const metaByCode = window.__optMetaByCode || (window.__optMetaByCode = _buildItemMetaByCode());
  const invRecs = _iterInventoryRecords(inv);
  const wasteByPocket = _buildQtyByPocket(tx, 'waste').qty || {};

  const norm = (s)=>String(s||'').trim().toUpperCase();
  const scope = window.__optDrillScope || null;
  const scopeLoc = (scope && scope.type === 'location') ? norm(scope.key||'') : '';
  const scopeSubloc = (scope && scope.type === 'sublocation') ? norm(scope.key||'') : '';
  const bySubloc = Object.create(null);
  const minSortMode = _getMinSuggestionSortMode();

  for (const it of invRecs){
    const code = String(it.itemCode||'').trim();
    if (!code) continue;
    const subRaw = String(it.sublocation||'UNKNOWN');
    const sub = norm(subRaw);
    const loc = norm(_locationLabelForSubloc(subRaw, ref) || '');
    if (scopeLoc && loc !== scopeLoc) continue;
    if (scopeSubloc && sub !== scopeSubloc) continue;

    const pk = code + '|' + sub;
    const wasteQty = _num(wasteByPocket[pk], 0);
    const curQty = _num(it.curQty, _num(it.qty, 0));
    if (!(wasteQty > 0) && !(curQty > 0)) continue;

    const meta = metaByCode[code] || {};
    const unit = _unitCostFromMeta(meta);
    const estWasteCost = wasteQty * unit;

    const row = {
      itemCode: code,
      itemName: String(meta.description || meta.drugName || meta.name || code),
      sublocation: sub,
      location: loc,
      onHand: curQty,
      wasteQty,
      unitCost: unit,
      estWasteCost
    };

    const arr = bySubloc[sub] || (bySubloc[sub] = []);
    arr.push(row);
  }

  const sublocKeys = Object.keys(bySubloc).sort((a,b)=>a.localeCompare(b));
  const title = scopeSubloc
    ? `Waste Optimization Report — ${scopeSubloc}`
    : (scopeLoc ? `Waste Optimization Report — ${scopeLoc}` : 'Waste Optimization Report — All Locations');

  const w = window.open('', '_blank');
  if (!w) return;

  const css = `
    body{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#111; padding:18px; }
    h1{ font-size:18px; margin:0 0 10px 0; }
    h2{ font-size:14px; margin:18px 0 8px 0; }
    .meta{ color:#444; font-size:12px; margin-bottom:12px; }
    table{ width:100%; border-collapse:collapse; font-size:12px; }
    th,td{ padding:6px 8px; border-bottom:1px solid #ddd; text-align:left; vertical-align:top; }
    th{ background:#f6f6f6; position:sticky; top:0; }
    .num{ text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
    .item-col{ width: 320px; max-width: 320px; }
    .item-wrap{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient: vertical; overflow:hidden; line-height:1.25; }
    @media print{ button{ display:none; } h2{ page-break-after: avoid; } }
  `;

  const esc = (s)=>_esc(String(s==null?'':s));
  const now = new Date();
  let html = `<!doctype html><html><head><title>${esc(title)}</title><style>${css}</style></head><body>`;
  html += `<h1>${esc(title)}</h1>`;
  html += `<div class="meta">Generated: ${esc(now.toLocaleString())} • Metric: Waste Transactions</div>`;
  html += `<button onclick="window.print()" style="padding:8px 10px; border-radius:10px; border:1px solid #ccc; background:#fff; cursor:pointer; margin-bottom:10px;">Print</button>`;

  if (!sublocKeys.length){
    html += `<div class="meta">No waste candidates found for the current scope.</div>`;
  } else {
    for (const sub of sublocKeys){
      const rows = bySubloc[sub] || [];
      rows.sort((a,b)=>_num(b.estWasteCost,0)-_num(a.estWasteCost,0) || _num(b.wasteQty,0)-_num(a.wasteQty,0));
      const totalWasteQty = rows.reduce((s,r)=>s + _num(r.wasteQty,0), 0);
      const totalWasteCost = rows.reduce((s,r)=>s + _num(r.estWasteCost,0), 0);
      html += `<h2>${esc(sub)} ${scopeLoc ? '' : (rows[0] && rows[0].location ? '— '+esc(rows[0].location) : '')}</h2>`;
      html += `<div class="meta">Waste Qty: ${esc(String(Math.round(totalWasteQty)))} • Est Cost: ${esc('$'+Math.round(totalWasteCost).toLocaleString())}</div>`;
      html += `<table><thead><tr><th class="item-col">Items</th><th class="num">On Hand</th><th class="num">Waste Qty</th><th class="num">Unit Cost</th><th class="num">Est Waste Cost</th></tr></thead><tbody>`;
      for (const r of rows){
        html += `<tr>`+
                `<td class="item-col"><div class="item-wrap">${esc(r.itemName)}<br><span style="opacity:.72">${esc(r.itemCode)}</span></div></td>`+
                `<td class="num">${esc(String(Math.round(_num(r.onHand,0))))}</td>`+
                `<td class="num">${esc(String(Math.round(_num(r.wasteQty,0))))}</td>`+
                `<td class="num">${esc(_currency(_num(r.unitCost,0), 2))}</td>`+
                `<td class="num">${esc(_currency(_num(r.estWasteCost,0), 0))}</td>`+
                `</tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  html += `</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function _openMinSuggestionReport(){
  const raw = window.__optLastRaw;
  const computed = window.__optLastComputed;
  const inv = _getInventory(raw, computed);
  const tx = _getTransactions(raw, computed);

  try{
    const txLen = Array.isArray(tx) ? tx.length : (tx && Array.isArray(tx.transactions) ? tx.transactions.length : 0);
    if (!txLen) console.warn('[Min Suggestion Report] No transactions found; report will be dominated by No-demand items.');
    _minSuggestionLog('tx root diagnostics', {
      txShape: Array.isArray(tx) ? 'array' : (tx && typeof tx === 'object' ? 'object' : typeof tx),
      txLen: txLen,
      txItemCodes: (tx && typeof tx === 'object' && !Array.isArray(tx)) ? Object.keys(tx).length : null
    });
  }catch(_){ }
  const ref = window.__optSubMap || (window.__optSubMap = _getSublocationMap());
  const metaByCode = window.__optMetaByCode || (window.__optMetaByCode = _buildItemMetaByCode());

  const invRecs = _iterInventoryRecords(inv);
  const duStats = _buildDailyUsageStatsByPocket(tx, 'dispense', 14, _getUsagePercentileCutoff());
  const duWorst = duStats.worstByPocket;
  const duSigma = duStats.sigmaByPocket;

  const surge = _getWhatIfSurgeMultiplier();
  const reviewDays = _getWhatIfReviewPeriodDays();
  const z = _getWhatIfServiceLevelZ();
  const thr = _getMinSuggestionDeltaThreshold();
  const minSortMode = _getMinSuggestionSortMode();

  // Respect current drill scope if present
  const norm = (s)=>String(s||'').trim().toUpperCase();
  const scope = window.__optDrillScope || null;
  const scopeLoc = (scope && scope.type === 'location') ? norm(scope.key||'') : '';

  const scopeSubloc = (scope && scope.type === 'sublocation') ? norm(scope.key||'') : '';
  const uiSubloc = (window.__optViewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location')
    ? norm(window.__optItemSublocFilter || 'ALL')
    : 'ALL';
  const activeSubloc = scopeSubloc || ((uiSubloc && uiSubloc !== 'ALL') ? uiSubloc : '');
  const activeBucket = String(window.__optItemMinBucketFilter || 'ALL'); // gray/blue/green/coral or ALL
  const searchTerm = (_getOptSearchTerm ? String((_getOptSearchTerm()||'')).trim().toLowerCase() : '');
  const isItemLocDrill = (window.__optViewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location');
  let showStandardItems = (window.__optShowStandardItems !== false);
  if (isItemLocDrill && window.__optShowStandardItems == null){
    try {
      const rawStd = localStorage.getItem('optShowStandardItems');
      if (rawStd != null) showStandardItems = (String(rawStd) !== 'false');
    } catch(_){ }
  }

  const bySubloc = Object.create(null);

  for (const it of invRecs){
    const code = String(it.itemCode||'');
    const subRaw = String(it.sublocation||'UNKNOWN');
    const sub = norm(subRaw);
    const loc = norm(_locationLabelForSubloc(subRaw, ref) || '');
    if (scopeLoc && loc !== scopeLoc) continue;
    if (activeSubloc && sub !== activeSubloc) continue;
    if (searchTerm){
      const hay = (String(code||'') + ' ' + String((metaByCode[code]&&metaByCode[code].name)||'')).toLowerCase();
      if (!hay.includes(searchTerm)) continue;
    }

    // Match Item view "Standard" toggle behavior used in the on-screen Min list.
    if (isItemLocDrill && !showStandardItems && it.standard) continue;

    const pk = code + '|' + sub;
    const curMin = _num(it.min, 0);
    const maxQ = _num(it.max, 0);

    const du = _num(duWorst && duWorst[pk], 0);
    const sigma = _num(duSigma[pk], 0);
    const trendCtx = _trendContextFor(_datasetEndISO(), String(it.sublocation || ''), String(it.itemCode || ''));
    const trendMult = trendCtx.trendMult;
    const demand = du * surge * trendMult;
    const lt = _leadTimeDaysForSubloc(sub, ref);
    const cover = lt + reviewDays;
    const safetyStock = (sigma > 0 && cover > 0) ? (z * sigma * Math.sqrt(cover)) : 0;

    let sugMin = (demand * cover) + safetyStock;
    if (Number.isFinite(maxQ) && maxQ > 0) sugMin = Math.min(sugMin, maxQ);
    sugMin = Math.max(0, sugMin);
    const sugMinInt = Math.ceil(sugMin);

    const delta = sugMinInt - curMin;

    const meta = metaByCode[code] || {};
    const unit = _unitCostFromMeta(meta);
    const deltaCost = delta * unit;

    // Classify into Min buckets (matches UI)
    const bucketCls =
      (demand <= 0) ? 'gray' :
      (Math.abs(delta) < thr) ? 'green' :
      (delta >= thr) ? 'coral' : 'blue';

    // Respect active bucket filter if user has clicked legend/segment in Item view
    if (activeBucket !== 'ALL' && bucketCls !== activeBucket) continue;

    // Default report behavior: when no explicit bucket filter is active, include only actionable adjustments
    // (Increase/Decrease with demand). If bucket filter is set (including No demand / OK), include that bucket.
    if (activeBucket === 'ALL'){
      if (!(demand > 0)) continue;
      if (Math.abs(delta) < thr) continue;
    }

    const bucket = (bucketCls === 'coral') ? 'Increase'
                 : (bucketCls === 'blue') ? 'Decrease'
                 : (bucketCls === 'green') ? 'OK'
                 : 'No demand';

    const parsedPocket = it.pocketParsed || null;
    const pocketSize = String((parsedPocket && parsedPocket.size) || '').trim();
    const pocketType = String((parsedPocket && parsedPocket.pocketType) || '').trim();
    const pocketDisplay = (!pocketSize || pocketSize.toUpperCase() === 'N/A')
      ? (pocketType || '—')
      : pocketSize;

    const row = {
      itemCode: code,
      itemName: String(meta.description || meta.drugName || meta.name || code),
      sublocation: sub,
      location: loc,
      pocketSize,
      pocketType,
      pocketDisplay,
      curMin,
      sugMin: sugMinInt,
      delta,
      leadTimeDays: lt,
      demand,
      trendMultUsed: trendMult,
      trendSource: trendCtx.trendSource,
      trendWindowDays: trendCtx.trendWindowDays,
      sigma,
      coverDays: cover,
      safetyStock,
      unitCost: unit,
      deltaCost,
      bucket
    };

    const arr = bySubloc[sub] || (bySubloc[sub] = []);
    arr.push(row);
  }

  const sublocKeys = Object.keys(bySubloc).sort((a,b)=>a.localeCompare(b));
  _minSuggestionLog('report scope summary', {
    sublocations: sublocKeys.length,
    activeSubloc: activeSubloc || 'ALL',
    scopeLoc: scopeLoc || 'ALL',
    activeBucket: activeBucket,
    rowCount: sublocKeys.reduce((sum, key)=> sum + ((bySubloc[key] || []).length), 0)
  });
  const title = (activeSubloc ? `Min Suggestions Report — ${activeSubloc}` : (scopeLoc ? `Min Suggestions Report — ${scopeLoc}` : 'Min Suggestions Report — All Locations'));

  const w = window.open('', '_blank');
  if (!w) return;

  const css = `
    body{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#111; padding:18px; }
    h1{ font-size:18px; margin:0 0 10px 0; }
    h2{ font-size:14px; margin:18px 0 8px 0; }
    .meta{ color:#444; font-size:12px; margin-bottom:12px; }
    table{ width:100%; border-collapse:collapse; font-size:12px; }
    th,td{ padding:6px 8px; border-bottom:1px solid #ddd; text-align:left; vertical-align:top; }
    th{ background:#f6f6f6; position:sticky; top:0; }
    .num{ text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
    .item-col{ width: 260px; max-width: 260px; }
    .item-wrap{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient: vertical; overflow:hidden; line-height:1.25; }
    .inc{ font-weight:700; }
    .dec{ font-weight:700; }
    @media print{ button{ display:none; } h2{ page-break-after: avoid; } }
  `;

  const esc = (s)=>_esc(String(s==null?'':s));
  const fmt = (x, d=2)=>{ const v=_num(x,0); return (Math.abs(v - Math.round(v))<1e-6) ? String(Math.round(v)) : v.toFixed(d); };

  const now = new Date();
  const ts = now.toLocaleString();

  let html = `<!doctype html><html><head><title>${esc(title)}</title><style>${css}</style></head><body>`;
  html += `<h1>${esc(title)}</h1>`;
  html += `<div class="meta">Generated: ${esc(ts)} • Window: 14d • Surge: ${esc(String(surge))} • Review: ${esc(String(reviewDays))}d • Service: ${esc(String(window.__whatIfServiceLevelPreset||''))} • Threshold: ±${esc(String(thr))} • Bucket: ${esc(String(activeBucket))}</div>`;
  html += `<button onclick="window.print()" style="padding:8px 10px; border-radius:10px; border:1px solid #ccc; background:#fff; cursor:pointer; margin-bottom:10px;">Print</button>`;

  if (!sublocKeys.length){
    html += `<div class="meta">No adjustments found for the current scope.</div>`;
  } else {
    for (const sub of sublocKeys){
      const rows = bySubloc[sub] || [];
      if (minSortMode === 'impact') {
        rows.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta) || a.itemName.localeCompare(b.itemName));
      } else {
        rows.sort((a,b)=>a.itemName.localeCompare(b.itemName) || String(a.itemCode||'').localeCompare(String(b.itemCode||''), undefined, { sensitivity:'base' }));
      }
      html += `<h2>${esc(sub)} ${scopeLoc ? '' : (rows[0] && rows[0].location ? '— '+esc(rows[0].location) : '')}</h2>`;
      
// Sublocation summary
let sInc=0,sDec=0,sNet=0,sCost=0;
for (const r of rows){
  if (r.delta >= thr) sInc++; else if (r.delta <= -thr) sDec++;
  sNet += _num(r.delta,0);
  sCost += _num(r.deltaCost,0);
}
const sNetSign = (sNet>0)?'+':'';
const sCostSign = (sCost>0)?'+':'';
html += `<div class="meta">Adjustments: ${esc(String(sInc))} increase • ${esc(String(sDec))} decrease • Net ΔMin: ${esc(sNetSign+String(Math.round(sNet)))} • Est $: ${esc(sCostSign+'$'+Math.round(Math.abs(sCost)).toLocaleString())}</div>`;
      html += `<table><thead><tr>`+
              `<th class="item-col">Items</th><th>ADS</th><th>Pocket</th>`+
              `<th class="num">Min</th><th class="num">Suggested</th><th class="num">Δ</th>`+
              `<th class="num">Lead</th><th class="num">Demand/d</th><th class="num">Cover</th><th class="num">SS</th><th class="num">Δ</th>`+
              `</tr></thead><tbody>`;
      for (const r of rows){
        const cls = (r.delta >= thr) ? 'inc' : 'dec';
        const sign = (r.delta > 0) ? '+' : '';
        html += `<tr>`+
                `<td class="item-col"><div class="item-wrap">${esc(r.itemName||'')}</div></td>`+
                `<td>${esc(r.itemCode||'')}</td>`+
                `<td>${esc(r.pocketDisplay || '—')}</td>`+
                `<td class="num">${esc(fmt(r.curMin,0))}</td>`+
                `<td class="num">${esc(fmt(r.sugMin,0))}</td>`+
                `<td class="num ${cls}">${esc(sign+String(Math.round(r.delta)))}</td>`+
                `<td class="num">${esc(fmt(r.leadTimeDays,1))}d</td>`+
                `<td class="num">${esc(fmt(r.demand,2))}</td>`+
                `<td class="num">${esc(fmt(r.coverDays,1))}d</td>`+
                `<td class="num">${esc(fmt(r.safetyStock,1))}</td>`+
                `<td class="num">${esc((r.deltaCost>=0?'+':'-')+String(Math.round(Math.abs(_num(r.deltaCost,0))).toLocaleString()))}</td>`+
                `</tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  html += `</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ----- Date range pill (Charts-style placement in Optimization header) -----
function _setupOptDateRange(){
  const pillBtn = document.getElementById('chartRangePill');
  const pillText = document.getElementById('chartRangePillText');
  const popover = document.getElementById('chartRangePopover');
  const fromEl = document.getElementById('chartFromDate');
  const toEl = document.getElementById('chartToDate');
  const presetHidden = document.getElementById('chartDatePreset');
  if (!pillBtn || !pillText || !popover || !fromEl || !toEl) return;

  const fmt = (iso)=>{
    if (!iso) return '—';
    // ISO YYYY-MM-DD -> MM-DD-YYYY
    const p = iso.split('-');
    if (p.length !== 3) return iso;
    return `${p[1]}-${p[2]}-${p[0]}`;
  };

  const setStorage = (fromISO, toISO, preset)=>{
    try{ localStorage.setItem('chartsFromDate', fromISO || ''); }catch(_){ }
    try{ localStorage.setItem('chartsToDate', toISO || ''); }catch(_){ }
    try{ localStorage.setItem('chartsDatePreset', preset || 'custom'); }catch(_){ }
  };

  const getStorage = ()=>{
    let fromISO = '';
    let toISO = '';
    let preset = 'all';
    try{ fromISO = (localStorage.getItem('chartsFromDate') || ''); }catch(_){ }
    try{ toISO = (localStorage.getItem('chartsToDate') || ''); }catch(_){ }
    try{ preset = (localStorage.getItem('chartsDatePreset') || 'all'); }catch(_){ }
    return { fromISO, toISO, preset };
  };

  const updatePill = ()=>{
    const s = getStorage();
    // keep inputs in sync
    fromEl.value = s.fromISO || '';
    toEl.value = s.toISO || '';
    if (presetHidden) presetHidden.value = s.preset || 'all';
    pillText.textContent = `${fmt(s.fromISO)} → ${fmt(s.toISO)}`;
  };

  const closePopover = ()=>{ popover.setAttribute('aria-hidden','true'); };
  const openPopover = ()=>{ _closeOptTransientPopups('date'); popover.setAttribute('aria-hidden','false'); };
  const togglePopover = ()=>{
    const isOpen = popover.getAttribute('aria-hidden') !== 'true';
    if (isOpen) closePopover(); else openPopover();
  };

  const applyPresetDays = (days)=>{
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (days - 1));
    const toISO = end.toISOString().slice(0,10);
    const fromISO = start.toISOString().slice(0,10);
    setStorage(fromISO, toISO, String(days));
    updatePill();
    try{ window.parent.postMessage({ type:'optimizationDateRangeChanged', fromISO, toISO, preset: String(days) }, '*'); }catch(_){ }
    _requestMock();
  };

  const applyAll = ()=>{
    setStorage('', '', 'all');
    updatePill();
    try{ window.parent.postMessage({ type:'optimizationDateRangeChanged', fromISO:'', toISO:'', preset:'all' }, '*'); }catch(_){ }
    _requestMock();
  };

  // initial sync
  updatePill();
  closePopover();

  pillBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); togglePopover(); });

  // Preset buttons
  popover.querySelectorAll('.range-preset-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      const p = btn.getAttribute('data-preset');
      if (p === 'all') return applyAll();
      if (p === 'custom'){
        // just reveal inputs; user will pick dates
        if (fromEl) fromEl.focus();
        try{ localStorage.setItem('chartsDatePreset','custom'); }catch(_){ }
        return;
      }
      const d = parseInt(p,10);
      if (!isNaN(d) && d > 0) applyPresetDays(d);
    });
  });

  // Custom date changes
  const onCustomChange = ()=>{
    const fromISO = fromEl.value || '';
    const toISO = toEl.value || '';
    setStorage(fromISO, toISO, 'custom');
    updatePill();
    try{ window.parent.postMessage({ type:'optimizationDateRangeChanged', fromISO, toISO, preset:'custom' }, '*'); }catch(_){ }
    _requestMock();
  };
  fromEl.addEventListener('change', onCustomChange);
  toEl.addEventListener('change', onCustomChange);

  // Click outside closes popover
  document.addEventListener('click', (ev)=>{
    const t = ev.target;
    if (!t) return;
    if (popover.contains(t) || pillBtn.contains(t)) return;
    closePopover();
  });
}

function _init(){
  window.__optAlphaSort = !!window.__optAlphaSort;

  window.__optViewBy = window.__optViewBy || 'location';
  window.__optMetric = window.__optMetric || 'min';

  _wireDropdown();
  _initKeyboardSearch();
  // Date range controls live on Charts page header; Optimization does not host a date picker.
  const sortBtn = document.getElementById('optAlphaSortToggle');
  if (sortBtn){
    const useEl = sortBtn.querySelector('use');
    const sync=()=>{
      // Min Suggestions uses its own sort mode: alpha vs impact
      if (window.__optMetric === 'min' && window.__optViewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
        const mode = _getMinSuggestionSortMode();
        const isImpact = (mode === 'impact');
        // In Min Suggestions, the sort button becomes a mode toggle with the label embedded in the icon.
        sortBtn.classList.add('opt-min-sort-mode');
        sortBtn.classList.toggle('active', isImpact);
        if (useEl) useEl.setAttribute('href', isImpact ? '#icon-sort-impact' : '#icon-sort-a');
        sortBtn.title = isImpact ? 'Sort: Impact' : 'Sort: A→Z';
      } else {
        sortBtn.classList.remove('opt-min-sort-mode');
        sortBtn.classList.toggle('active', !!window.__optAlphaSort);
        if (useEl) useEl.setAttribute('href', '#icon-sort-az');
        sortBtn.title = 'Sort A→Z';
      }
    };
    sync();
    sortBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      // Min Suggestions: toggle alpha vs impact
      if (window.__optMetric === 'min' && window.__optViewBy === 'item' && window.__optDrillScope && window.__optDrillScope.type === 'location'){
        const next = (_getMinSuggestionSortMode() === 'impact') ? 'alpha' : 'impact';
        window.__minSuggestionSortMode = next;
        try{ localStorage.setItem('minSuggestionSortMode', next); }catch(_){ }
        sync();
        _render();
        return;
      }
      // In item drill view, toggle between default metric sort (IUR/cost) and A→Z.
      if (window.__optViewBy === 'item' && window.__optDrillScope){
        window.__optAlphaSort = !window.__optAlphaSort;
        if (window.__optAlphaSort){
          window.__optSortByIUR = false;
          window.__optSortByCost = false;
        } else {
          if (window.__optMetric === 'iur'){
            window.__optSortByIUR = true;
            window.__optSortIURAsc = true;
          }
          if (window.__optMetric === 'cost'){
            window.__optSortByCost = true;
            window.__optSortCostAsc = true;
          }
        }
        sync();
        _render();
        return;
      }
      window.__optAlphaSort = !window.__optAlphaSort;
      sync();
      _render();
    });
  }

  _renderMetricIcons();

  const rptBtn = document.getElementById('optPrintMinReportBtn');
  if (rptBtn){
    rptBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const metric = window.__optMetric || 'min';
      if (metric === 'tx_waste') _openWasteOptimizationReport();
      else _openMinSuggestionReport();
    });
  }

  // do not double-render; just set labels
  const sel = document.getElementById('optDropdownSelected');
  if (sel) sel.textContent = (window.__optViewBy==='item'?'Item':'Location');

  _requestMock();
  setTimeout(_requestMock, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
else _init();

})(); 
