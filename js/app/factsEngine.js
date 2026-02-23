(function(global) {
    'use strict';

    function asObject(value) {
        return value && typeof value === 'object' ? value : null;
    }

    function safeNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function toDateISO(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number' && Number.isFinite(value)) {
            const ms = value < 1e12 ? value * 1000 : value;
            const d = new Date(ms);
            return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
        }
        const str = String(value).trim();
        if (!str) return null;
        const dateOnly = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (dateOnly) {
            const y = Number(dateOnly[1]);
            const m = Number(dateOnly[2]);
            const d = Number(dateOnly[3]);
            if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
            const dt = new Date(Date.UTC(y, m - 1, d));
            if (Number.isNaN(dt.getTime())) return null;
            return dt.toISOString().slice(0, 10);
        }
        const parsed = new Date(str);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    }

    function normalizeEventType(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return 'other';
        if (/dispense|unload|issue|administer|remove/.test(raw)) return 'dispense';
        if (/restock|load|receive|refill|replenish|add/.test(raw)) return 'restock';
        if (/transfer|move/.test(raw)) return 'transfer';
        if (/adjust|cyclecount|cycle\s*count|correction/.test(raw)) return 'adjust';
        return 'other';
    }

    function firstString(obj, keys) {
        if (!obj) return '';
        for (const k of keys) {
            const v = obj[k];
            if (v == null) continue;
            const s = String(v).trim();
            if (s) return s;
        }
        return '';
    }

    function firstNumber(obj, keys) {
        if (!obj) return null;
        for (const k of keys) {
            const n = safeNumber(obj[k]);
            if (n != null) return n;
        }
        return null;
    }

    function ensureLocation(dimLocation, sublocation, sublocationMap) {
        const key = String(sublocation || '').trim();
        if (!key) return null;
        if (dimLocation.has(key)) return dimLocation.get(key);
        const ref = asObject(sublocationMap && sublocationMap[key]) || {};
        const row = {
            sublocation: key,
            mainLocation: String(ref.mainLocation || key),
            department: String(ref.department || 'Other'),
            label: ref.label ? String(ref.label) : undefined
        };
        dimLocation.set(key, row);
        return row;
    }

    function extractLots(row) {
        const lots = [];
        if (!row || typeof row !== 'object') return lots;
        if (Array.isArray(row.lots)) {
            for (const lot of row.lots) {
                if (!lot || typeof lot !== 'object') continue;
                lots.push({
                    expires: toDateISO(lot.expires ?? lot.expiry ?? lot.expiryDate ?? lot.expDate),
                    curQty: firstNumber(lot, ['curQty', 'qty', 'onHand', 'current', 'stock'])
                });
            }
        }
        return lots;
    }

    function iterInventoryRows(invEntry, stats) {
        const rows = [];
        if (!invEntry || typeof invEntry !== 'object') return rows;

        if (Array.isArray(invEntry.sublocations)) {
            stats.inventoryShapeAcount += 1;
            for (const rawRow of invEntry.sublocations) {
                if (!rawRow || typeof rawRow !== 'object') continue;
                const sublocation = firstString(rawRow, ['sublocation', 'loc', 'location', 'pocket', 'station']);
                if (!sublocation) continue;
                rows.push({
                    sublocation,
                    minQty: firstNumber(rawRow, ['minQty', 'min', 'par', 'min_level']),
                    maxQty: firstNumber(rawRow, ['maxQty', 'max', 'max_level']),
                    curQty: firstNumber(rawRow, ['curQty', 'qty', 'onHand', 'current', 'stock']),
                    expires: toDateISO(rawRow.expires ?? rawRow.expiry ?? rawRow.expiryDate ?? rawRow.expDate),
                    lots: extractLots(rawRow)
                });
            }
            return rows;
        }

        let foundShapeB = false;
        for (const [key, rawRow] of Object.entries(invEntry)) {
            if (!rawRow || typeof rawRow !== 'object') continue;
            if (key === 'sublocations' || key === 'itemCode' || key === 'code' || key === 'id' || key === 'meta' || key === 'metadata') continue;
            const sublocation = firstString(rawRow, ['sublocation', 'loc', 'location', 'pocket', 'station']) || String(key).trim();
            if (!sublocation) continue;
            foundShapeB = true;
            rows.push({
                sublocation,
                minQty: firstNumber(rawRow, ['minQty', 'min', 'par', 'min_level']),
                maxQty: firstNumber(rawRow, ['maxQty', 'max', 'max_level']),
                curQty: firstNumber(rawRow, ['curQty', 'qty', 'onHand', 'current', 'stock']),
                expires: toDateISO(rawRow.expires ?? rawRow.expiry ?? rawRow.expiryDate ?? rawRow.expDate),
                lots: extractLots(rawRow)
            });
        }
        if (foundShapeB) stats.inventoryShapeBcount += 1;
        return rows;
    }

    function flattenTxRoot(root) {
        if (!root) return [];
        if (Array.isArray(root)) return root;
        if (root instanceof Map) {
            const all = [];
            for (const value of root.values()) all.push(...flattenTxRoot(value));
            return all;
        }
        if (typeof root === 'object') {
            const all = [];
            for (const value of Object.values(root)) {
                if (Array.isArray(value)) all.push(...value);
                else if (value && typeof value === 'object') all.push(value);
            }
            return all;
        }
        return [];
    }

    const FactsEngine = {
        findTransactionsRoot(mockData) {
            if (mockData && typeof mockData === 'object') {
                const keys = ['transactions', 'tx', 'transactionHistory', 'transactionMap'];
                for (const key of keys) {
                    if (mockData[key]) return mockData[key];
                }
            }
            if (typeof window !== 'undefined') {
                const txKeys = Object.keys(window).filter((k) => /^TRANSACTION_/i.test(k));
                if (txKeys.length === 1) return window[txKeys[0]];
                if (txKeys.length > 1) {
                    const combo = [];
                    for (const key of txKeys) combo.push(window[key]);
                    return combo;
                }
            }
            return null;
        },

        build(mockData, options) {
            const opts = options || {};
            const sublocationMap = asObject(opts.sublocationMap) || {};
            const dimLocation = new Map();
            for (const [subloc, ref] of Object.entries(sublocationMap)) {
                const key = String(subloc || '').trim();
                if (!key) continue;
                const r = asObject(ref) || {};
                dimLocation.set(key, {
                    sublocation: key,
                    mainLocation: String(r.mainLocation || key),
                    department: String(r.department || 'Other'),
                    label: r.label ? String(r.label) : undefined
                });
            }

            const dimItem = new Map();
            const factInventory = [];
            const factTx = [];
            const factDailyUsage = [];
            const stats = {
                inventoryShapeAcount: 0,
                inventoryShapeBcount: 0,
                txCount: 0,
                txRawCount: 0
            };

            const items = Array.isArray(mockData && mockData.items) ? mockData.items : [];
            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                const itemCode = firstString(item, ['itemCode', 'code', 'id']);
                if (!itemCode) continue;
                if (!dimItem.has(itemCode)) {
                    dimItem.set(itemCode, {
                        itemCode,
                        name: firstString(item, ['description', 'drugName', 'name']) || itemCode,
                        unitCost: firstNumber(item, ['unitCost', 'cost', 'avgCost', 'price'])
                    });
                }
            }

            const inventory = asObject(mockData && mockData.inventory) || {};
            for (const [rawItemCode, invEntry] of Object.entries(inventory)) {
                const itemCode = String(rawItemCode || '').trim();
                if (!itemCode || !invEntry || typeof invEntry !== 'object') continue;
                if (!dimItem.has(itemCode)) {
                    dimItem.set(itemCode, { itemCode, name: itemCode, unitCost: null });
                }

                const rows = iterInventoryRows(invEntry, stats);
                for (const row of rows) {
                    const location = ensureLocation(dimLocation, row.sublocation, sublocationMap);
                    if (!location) continue;

                    if (Array.isArray(row.lots) && row.lots.length > 0) {
                        for (const lot of row.lots) {
                            factInventory.push({
                                itemCode,
                                sublocation: location.sublocation,
                                expires: lot.expires || row.expires || null,
                                curQty: lot.curQty != null ? lot.curQty : row.curQty,
                                minQty: row.minQty,
                                maxQty: row.maxQty,
                                mainLocation: location.mainLocation,
                                department: location.department
                            });
                        }
                    } else {
                        factInventory.push({
                            itemCode,
                            sublocation: location.sublocation,
                            expires: row.expires || null,
                            curQty: row.curQty,
                            minQty: row.minQty,
                            maxQty: row.maxQty,
                            mainLocation: location.mainLocation,
                            department: location.department
                        });
                    }
                }
            }

            const txRoot = this.findTransactionsRoot(mockData);
            const txRows = flattenTxRoot(txRoot);
            stats.txRawCount = txRows.length;

            for (const tx of txRows) {
                if (!tx || typeof tx !== 'object') continue;
                const itemCode = firstString(tx, ['itemCode', 'code', 'ndc', 'item']);
                const sublocation = firstString(tx, ['sublocation', 'loc', 'location', 'pocket', 'station']);
                const dateISO = toDateISO(tx.date ?? tx.dt ?? tx.time ?? tx.timestamp);
                const qty = firstNumber(tx, ['qty', 'quantity', 'count', 'delta']);
                const eventType = normalizeEventType(tx.type ?? tx.action ?? tx.event ?? tx.trxType);

                if (!itemCode || !sublocation || !dateISO || qty == null) continue;
                if (!dimItem.has(itemCode)) {
                    dimItem.set(itemCode, { itemCode, name: itemCode, unitCost: null });
                }
                const location = ensureLocation(dimLocation, sublocation, sublocationMap);
                if (!location) continue;

                factTx.push({
                    itemCode,
                    sublocation: location.sublocation,
                    dateISO,
                    qty,
                    eventType
                });
            }
            stats.txCount = factTx.length;

            const usageMap = new Map();
            for (const tx of factTx) {
                if (tx.eventType !== 'dispense') continue;
                const key = tx.dateISO + '|' + tx.itemCode + '|' + tx.sublocation;
                const prev = usageMap.get(key) || 0;
                usageMap.set(key, prev + Math.abs(tx.qty));
            }

            for (const [key, dailyDispenseQty] of usageMap.entries()) {
                const parts = key.split('|');
                const dateISO = parts[0];
                const itemCode = parts[1];
                const sublocation = parts.slice(2).join('|');
                const location = ensureLocation(dimLocation, sublocation, sublocationMap);
                if (!location) continue;
                factDailyUsage.push({
                    dateISO,
                    itemCode,
                    sublocation,
                    dailyDispenseQty,
                    mainLocation: location.mainLocation,
                    department: location.department
                });
            }

            factDailyUsage.sort((a, b) => {
                if (a.dateISO === b.dateISO) {
                    if (a.sublocation === b.sublocation) return a.itemCode.localeCompare(b.itemCode);
                    return a.sublocation.localeCompare(b.sublocation);
                }
                return a.dateISO.localeCompare(b.dateISO);
            });

            function groupBy(list, keyFn) {
                const out = new Map();
                for (const row of list) {
                    const key = keyFn(row);
                    if (!out.has(key)) out.set(key, []);
                    out.get(key).push(row);
                }
                return out;
            }

            const index = {
                inventoryByItem: groupBy(factInventory, (r) => r.itemCode),
                inventoryBySubloc: groupBy(factInventory, (r) => r.sublocation),
                inventoryByMain: groupBy(factInventory, (r) => r.mainLocation),
                txByItemSubloc: groupBy(factTx, (r) => r.sublocation + '|' + r.itemCode),
                dailyByItemSubloc: groupBy(factDailyUsage, (r) => r.sublocation + '|' + r.itemCode),
                dailyUsageBySublocItem: new Map(),
                dailyUsageByMainLocation: groupBy(factDailyUsage, (r) => r.mainLocation),
                latest14dUsage: new Map()
            };

            for (const [key, list] of index.dailyByItemSubloc.entries()) {
                const points = list
                    .map((r) => ({ dateISO: r.dateISO, dailyDispenseQty: r.dailyDispenseQty }))
                    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
                index.dailyUsageBySublocItem.set(key, points);

                const latest = points.slice(-14);
                const sumDaily = latest.reduce((sum, p) => sum + (Number(p.dailyDispenseQty) || 0), 0);
                const days = latest.length;
                index.latest14dUsage.set(key, {
                    avgDaily: days > 0 ? (sumDaily / days) : 0,
                    sumDaily,
                    days
                });
            }

            return {
                dimLocation,
                dimItem,
                factInventory,
                factTx,
                factDailyUsage,
                index,
                meta: {
                    builtAt: new Date().toISOString(),
                    sourceNotes: stats
                }
            };
        },

        debugSummary(facts) {
            if (!facts) return;
            const invDept = {};
            const dailyDept = {};
            let expCount = 0;
            const mainToSubloc = new Map();

            for (const row of facts.factInventory || []) {
                const dept = row.department || 'Other';
                invDept[dept] = (invDept[dept] || 0) + 1;
                if (row.expires) expCount += 1;
                if (dept === 'Pyxis') {
                    const main = row.mainLocation || row.sublocation;
                    if (!mainToSubloc.has(main)) mainToSubloc.set(main, new Set());
                    mainToSubloc.get(main).add(row.sublocation);
                }
            }

            for (const row of facts.factDailyUsage || []) {
                const dept = row.department || 'Other';
                dailyDept[dept] = (dailyDept[dept] || 0) + 1;
            }

            const topMain = Array.from(mainToSubloc.entries())
                .map(([mainLocation, sublocSet]) => ({ mainLocation, sublocationCount: sublocSet.size }))
                .sort((a, b) => b.sublocationCount - a.sublocationCount)
                .slice(0, 5);

            const lastDate = (facts.factDailyUsage || []).reduce((max, row) => {
                if (!max) return row.dateISO;
                return row.dateISO > max ? row.dateISO : max;
            }, null);

            console.log('[FactsEngine] summary', {
                counts: {
                    dimItem: facts.dimItem ? facts.dimItem.size : 0,
                    dimLocation: facts.dimLocation ? facts.dimLocation.size : 0,
                    factInventory: (facts.factInventory || []).length,
                    factTx: (facts.factTx || []).length,
                    factDailyUsage: (facts.factDailyUsage || []).length
                },
                departmentBreakdown: {
                    inventory: invDept,
                    dailyUsage: dailyDept
                },
                inventoryWithExpiryPct: (facts.factInventory || []).length
                    ? Number(((expCount / facts.factInventory.length) * 100).toFixed(2))
                    : 0,
                topMainLocationsByPyxisSublocations: topMain,
                lastDailyUsageDate: lastDate,
                meta: facts.meta || null
            });
        }
    };

    global.FactsEngine = FactsEngine;
})(typeof window !== 'undefined' ? window : globalThis);
