(function () {
  const ns = (window.InventoryApp = window.InventoryApp || {});

  const txByKey = new Map();                 // key -> normalized tx
  const txKeysByMonth = new Map();           // monthKey -> Set(txKey)
  const dailyRollup = new Map();             // YYYY-MM-DD -> { totalQty, txCount }
  const itemDayRollup = new Map();           // day|item|location -> { day,itemCode,location,qtySum,txCount }
  const loadedMonths = new Set();

  function normalizeDay(input) {
    if (!input) return '';
    const s = String(input);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!isFinite(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function normalizeTx(raw, fallbackItemCode) {
    const tx = raw && typeof raw === 'object' ? raw : {};
    const day = normalizeDay(tx.date || tx.transDate || tx.transactionDate || tx.trans_date || tx.datetime);
    const itemCode = String(tx.itemCode || tx.item_code || tx.code || tx.ndc || tx.NDC || fallbackItemCode || '').trim();
    const location = String(tx.location || tx.locationName || tx.area || tx.station || 'UNKNOWN').trim() || 'UNKNOWN';
    const qtyRaw = (tx.qty ?? tx.quantity ?? tx.transQty ?? tx.TransQty ?? tx.Qty ?? tx.TRANSQTY ?? tx.amount ?? tx.delta ?? null);
    const qty = Number(qtyRaw);
    if (!day || !itemCode || !isFinite(qty)) return null;

    return {
      date: day,
      itemCode: itemCode,
      location: location,
      qty: qty,
      transactionId: tx.transactionId || tx.txId || tx.id || tx.uuid || '',
      patientId: tx.patientId || tx.encounterId || tx.encounter || '',
      ndc: tx.ndc || tx.NDC || '',
      transactionType: tx.transactionType || tx.transType || tx.type || '',
      raw: tx
    };
  }

  // Stable key: always include date/item/location/qty dimensions.
  // NOTE: some monthly feeds can reuse transactionId values across snapshots,
  // so using id-only dedupe can incorrectly drop older months.
  function computeTxKey(tx) {
    if (!tx || typeof tx !== 'object') return '';
    const id = String(tx.transactionId || tx.txId || tx.id || tx.uuid || '').trim();
    return [
      id,
      tx.date || '',
      tx.itemCode || '',
      tx.location || 'UNKNOWN',
      Number(tx.qty || 0),
      tx.patientId || tx.encounterId || '',
      tx.ndc || ''
    ].join('|');
  }


  function classifyType(tx) {
    const t = String(tx.transactionType || '').toLowerCase();
    if (t.includes('dispense') || t.includes('issue') || t.includes('admin') || t.includes('use')) return 'usage';
    if (t.includes('waste') || t.includes('expire') || t.includes('dispose') || t.includes('return')) return 'waste';
    if (t.includes('restock') || t.includes('receive') || t.includes('receipt') || t.includes('purchase')) return 'restock';
    return tx.qty >= 0 ? 'restock' : 'usage';
  }

  function addToRollups(tx) {
    const day = tx.date;
    const d = dailyRollup.get(day) || { day: day, totalQty: 0, txCount: 0 };
    d.totalQty += tx.qty;
    d.txCount += 1;
    dailyRollup.set(day, d);

    const k = day + '|' + tx.itemCode + '|' + tx.location;
    const e = itemDayRollup.get(k) || { day: day, itemCode: tx.itemCode, location: tx.location, qtySum: 0, txCount: 0, usageQty: 0, wasteQty: 0, restockQty: 0 };
    e.qtySum += tx.qty;
    e.txCount += 1;
    const kind = classifyType(tx);
    if (kind === 'usage') e.usageQty += Math.abs(tx.qty);
    else if (kind === 'waste') e.wasteQty += Math.abs(tx.qty);
    else e.restockQty += Math.abs(tx.qty);
    itemDayRollup.set(k, e);
  }

  function addTransactions(monthKey, transactionsArray) {
    const month = String(monthKey || 'unknown');
    const rows = Array.isArray(transactionsArray) ? transactionsArray : [];
    const monthKeys = txKeysByMonth.get(month) || new Set();
    let addedCount = 0;
    let skippedCount = 0;
    const dirtyDays = new Set();

    for (let i = 0; i < rows.length; i++) {
      const normalized = normalizeTx(rows[i]);
      if (!normalized) { skippedCount++; continue; }
      const key = computeTxKey(normalized);
      if (!key || txByKey.has(key)) { skippedCount++; continue; }
      txByKey.set(key, normalized);
      monthKeys.add(key);
      addToRollups(normalized);
      dirtyDays.add(normalized.date);
      addedCount++;
    }

    txKeysByMonth.set(month, monthKeys);
    loadedMonths.add(month);
    return { addedCount: addedCount, skippedCount: skippedCount, dirtyDays: Array.from(dirtyDays).sort() };
  }

  function addLegacyHistoryMap(monthKey, historyMap) {
    const out = [];
    const src = historyMap && typeof historyMap === 'object' ? historyMap : {};
    Object.keys(src).forEach((itemCode) => {
      const h = src[itemCode] && Array.isArray(src[itemCode].history) ? src[itemCode].history : [];
      for (let i = 0; i < h.length; i++) {
        const row = Object.assign({}, h[i], { itemCode: h[i] && h[i].itemCode ? h[i].itemCode : itemCode });
        out.push(row);
      }
    });
    return addTransactions(monthKey, out);
  }

  function toArray() {
    return Array.from(txByKey.values()).map((tx) => Object.assign({}, tx.raw, {
      itemCode: tx.itemCode,
      transDate: tx.date,
      location: tx.location,
      qty: tx.qty,
      transactionType: tx.transactionType,
      transactionId: tx.transactionId || ''
    }));
  }

  function toLegacyTransactions() {
    const out = {};
    txByKey.forEach((tx) => {
      const code = tx.itemCode;
      out[code] = out[code] || { history: [] };
      out[code].history.push(Object.assign({}, tx.raw, {
        transDate: tx.date,
        itemCode: code,
        location: tx.location,
        qty: tx.qty,
        transactionType: tx.transactionType,
        transactionId: tx.transactionId || ''
      }));
    });
    Object.keys(out).forEach((code) => {
      out[code].history.sort((a, b) => new Date(a.transDate) - new Date(b.transDate));
    });
    return out;
  }

  function inRange(day, start, end) {
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  }

  function getTransactionsInRange(startDate, endDate, filters) {
    const start = normalizeDay(startDate);
    const end = normalizeDay(endDate);
    const f = filters || {};
    const item = f.itemCode ? String(f.itemCode) : '';
    const loc = f.location ? String(f.location) : '';
    const out = [];
    txByKey.forEach((tx) => {
      if (!inRange(tx.date, start, end)) return;
      if (item && String(tx.itemCode) !== item) return;
      if (loc && String(tx.location) !== loc) return;
      out.push(Object.assign({}, tx));
    });
    return out;
  }

  function getAggregatesInRange(startDate, endDate, groupBy, filters) {
    const start = normalizeDay(startDate);
    const end = normalizeDay(endDate);
    const f = filters || {};
    if (groupBy === 'day') {
      const out = [];
      dailyRollup.forEach((v, day) => { if (inRange(day, start, end)) out.push(Object.assign({}, v)); });
      return out.sort((a, b) => a.day.localeCompare(b.day));
    }
    if (groupBy === 'itemDay') {
      const item = f.itemCode ? String(f.itemCode) : '';
      const loc = f.location ? String(f.location) : '';
      const out = [];
      itemDayRollup.forEach((v) => {
        if (!inRange(v.day, start, end)) return;
        if (item && String(v.itemCode) !== item) return;
        if (loc && String(v.location) !== loc) return;
        out.push(Object.assign({}, v));
      });
      return out;
    }
    if (groupBy === 'item') {
      const loc = f.location ? String(f.location) : '';
      const map = new Map();
      itemDayRollup.forEach((v) => {
        if (!inRange(v.day, start, end)) return;
        if (loc && String(v.location) !== loc) return;
        const k = String(v.itemCode);
        const cur = map.get(k) || { itemCode: k, qtySum: 0, txCount: 0 };
        cur.qtySum += v.qtySum;
        cur.txCount += v.txCount;
        map.set(k, cur);
      });
      return Array.from(map.values()).sort((a, b) => b.qtySum - a.qtySum);
    }
    return [];
  }

  function getTopItems(startDate, endDate, location, limit) {
    const rows = getAggregatesInRange(startDate, endDate, 'item', { location: location || '' });
    return rows.slice(0, Math.max(1, parseInt(limit || 10, 10)));
  }

  function hasMonth(monthKey) {
    return loadedMonths.has(String(monthKey || ''));
  }

  ns.TransactionStore = {
    normalizeTx: normalizeTx,
    computeTxKey: computeTxKey,
    addTransactions: addTransactions,
    addLegacyHistoryMap: addLegacyHistoryMap,
    hasMonth: hasMonth,
    getTransactionsInRange: getTransactionsInRange,
    getAggregatesInRange: getAggregatesInRange,
    getTopItems: getTopItems,
    toArray: toArray,
    toLegacyTransactions: toLegacyTransactions
  };

  window.__txDebug = window.__txDebug || {};
  window.__txDebug.store = ns.TransactionStore;
})();
