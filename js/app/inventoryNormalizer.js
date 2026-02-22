(function (global) {
  'use strict';

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function pickNumber(record, keys) {
    for (const key of keys) {
      if (!record || typeof record !== 'object') continue;
      if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
        return toNumberOrNull(record[key]);
      }
    }
    return null;
  }

  function isLikelySublocationRecord(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value));
  }

  function normalizeInventoryToFacts(inventory, sublocationMap) {
    const facts = [];
    const factsByItemCode = Object.create(null);
    const factsByMainLocation = Object.create(null);
    const factsBySublocation = Object.create(null);
    const map = (sublocationMap && typeof sublocationMap === 'object') ? sublocationMap : {};

    const pushFact = function (fact) {
      facts.push(fact);
      if (!factsByItemCode[fact.itemCode]) factsByItemCode[fact.itemCode] = [];
      factsByItemCode[fact.itemCode].push(fact);
      if (!factsByMainLocation[fact.mainLocation]) factsByMainLocation[fact.mainLocation] = [];
      factsByMainLocation[fact.mainLocation].push(fact);
      if (!factsBySublocation[fact.sublocation]) factsBySublocation[fact.sublocation] = [];
      factsBySublocation[fact.sublocation].push(fact);
    };

    const inv = (inventory && typeof inventory === 'object') ? inventory : {};

    Object.keys(inv).forEach(function (itemCode) {
      const entry = inv[itemCode];
      if (!entry || typeof entry !== 'object') return;

      const appendRecord = function (sublocationCode, record) {
        const code = String(sublocationCode || '').trim();
        if (!code) return;
        const locInfo = map[code] || {};
        const department = String(locInfo.department || 'Other');
        const mainLocation = String(locInfo.mainLocation || code);
        const minQty = pickNumber(record, ['minQty', 'min', 'par', 'min_level']);
        const maxQty = pickNumber(record, ['maxQty', 'max', 'max_level']);
        const curQty = pickNumber(record, ['curQty', 'qty', 'onHand', 'current']);
        const unitCost = pickNumber(record, ['unitCost', 'unitPrice', 'costPerUnit']);
        const onHandValue = pickNumber(record, ['onHandValue', 'inventoryValue']);

        pushFact({
          itemCode: String(itemCode),
          sublocation: code,
          mainLocation,
          department,
          minQty,
          maxQty,
          curQty,
          unitCost,
          onHandValue
        });
      };

      if (Array.isArray(entry.sublocations)) {
        entry.sublocations.forEach(function (sub) {
          if (!sub || typeof sub !== 'object') return;
          appendRecord(sub.sublocation || sub.location || sub.code, sub);
        });
        return;
      }

      Object.keys(entry).forEach(function (key) {
        if (key === 'sublocations' || key === 'itemCode' || key === 'metadata') return;
        const value = entry[key];
        if (!isLikelySublocationRecord(value)) return;
        const hasQtyishField = (
          value.minQty !== undefined || value.min !== undefined || value.par !== undefined || value.min_level !== undefined ||
          value.maxQty !== undefined || value.max !== undefined || value.max_level !== undefined ||
          value.curQty !== undefined || value.qty !== undefined || value.onHand !== undefined || value.current !== undefined
        );
        if (!hasQtyishField) return;
        appendRecord(key, value);
      });
    });

    return {
      facts,
      factsByItemCode,
      factsByMainLocation,
      factsBySublocation
    };
  }

  global.InventoryNormalizer = global.InventoryNormalizer || {};
  global.InventoryNormalizer.normalizeInventoryToFacts = normalizeInventoryToFacts;
})(typeof window !== 'undefined' ? window : globalThis);
