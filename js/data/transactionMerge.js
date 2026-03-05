(function () {
  const ns = (window.InventoryApp = window.InventoryApp || {});

  function getGlobalByName(root, name) {
    const r = root || window;
    if (!name || typeof name !== 'string') return undefined;
    if (Object.prototype.hasOwnProperty.call(r, name)) return r[name];
    if (!/^[A-Z0-9_]+$/.test(name)) return undefined;
    try {
      // eslint-disable-next-line no-new-func
      return Function('try { return ' + name + '; } catch (e) { return undefined; }')();
    } catch (e) {
      return undefined;
    }
  }

  function listTransactionGlobals(root) {
    const r = root || window;

    const fromWindow = Object.keys(r).filter(
      (k) => /^TRANSACTION_\d{4}_\d{2}(?:_\d{2})?$/.test(k) || k === 'ITEM_TRANSACTION'
    );

    const fromManifest = [];
    const scripts = Array.isArray(r.TRANSACTION_SCRIPTS) ? r.TRANSACTION_SCRIPTS : [];
    for (let i = 0; i < scripts.length; i++) {
      const file = String(scripts[i] || '');
      const m = file.match(/transaction_(\d{4})_(\d{2})(?:_(\d{2}))?_mockdata\.js$/i);
      if (m) {
        const yyyy = m[1], mm = m[2], dd = m[3];
        fromManifest.push(dd ? `TRANSACTION_${yyyy}_${mm}_${dd}` : `TRANSACTION_${yyyy}_${mm}`);
      }
    }

    return Array.from(new Set([...fromWindow, ...fromManifest, 'ITEM_TRANSACTION']))
      .filter(Boolean)
      .filter((k) => /^TRANSACTION_\d{4}_\d{2}(?:_\d{2})?$/.test(k) || k === 'ITEM_TRANSACTION')
      .sort()
      .reverse();
  }

  function coerceHistoryContainer(obj) {
    // Expected: { [itemCode]: { history: [...] } }
    return obj && typeof obj === 'object' ? obj : null;
  }

  function txDedupeKey(itemCode, tx) {
    if (!tx || typeof tx !== 'object') return null;
    const id = tx.id || tx.txId || tx.transactionId || tx.uuid || '';
    const date = tx.transDate || tx.transactionDate || tx.date || tx.trans_date || '';
    const location = tx.location || tx.locationName || tx.area || '';
    const qty = tx.quantity != null ? tx.quantity : (tx.qty != null ? tx.qty : '');
    const type = tx.type || tx.transactionType || '';
    return [itemCode || '', id, date, type, qty, location].join('|');
  }

  function mergeTransactionsFromGlobals(root) {
    const r = root || window;
    const keys = listTransactionGlobals(r);
    const merged = {};
    const seen = new Set();

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const src = coerceHistoryContainer(getGlobalByName(r, key));
      if (!src) continue;

      Object.keys(src).forEach((itemCode) => {
        const container = src[itemCode];
        const h = container && Array.isArray(container.history) ? container.history : [];
        if (!merged[itemCode]) merged[itemCode] = { history: [] };
        for (let j = 0; j < h.length; j++) {
          const row = h[j];
          const key2 = txDedupeKey(itemCode, row);
          if (key2 && seen.has(key2)) continue;
          if (key2) seen.add(key2);
          merged[itemCode].history.push(row);
        }
      });
    }

    // Sort each item's history by date, oldest -> newest.
    Object.keys(merged).forEach((itemCode) => {
      merged[itemCode].history.sort((a, b) => {
        const da = new Date(a && a.transDate).getTime() || 0;
        const db = new Date(b && b.transDate).getTime() || 0;
        return da - db;
      });
    });

    return merged;
  }

  ns.TransactionMerge = {
    listTransactionGlobals,
    mergeMonthlyTransactions: mergeTransactionsFromGlobals,
    mergeTransactions: mergeTransactionsFromGlobals
  };
})();
