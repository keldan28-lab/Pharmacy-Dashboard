(function(global) {
    'use strict';

    function toKey(value) {
        return String(value == null ? '' : value).trim();
    }

    function toDateOnly(value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function dateISO(dateObj) {
        return dateObj.toISOString().slice(0, 10);
    }

    function addDays(dateObj, days) {
        const next = new Date(dateObj.getTime());
        next.setDate(next.getDate() + days);
        return next;
    }

    function buildGlobalSeriesByItemCode(factDailyUsage, dateFromObj, dateToObj, windowDays) {
        const byItemDate = new Map();
        const dateFromISO = dateISO(dateFromObj);
        const dateToISO = dateISO(dateToObj);

        for (const row of factDailyUsage) {
            if (!row || typeof row !== 'object') continue;
            const itemCode = toKey(row.itemCode);
            const rowDateISO = toKey(row.dateISO);
            const qty = Number(row.dailyDispenseQty) || 0;
            if (!itemCode || !rowDateISO) continue;
            if (rowDateISO < dateFromISO || rowDateISO > dateToISO) continue;

            if (!byItemDate.has(itemCode)) byItemDate.set(itemCode, new Map());
            const bucket = byItemDate.get(itemCode);
            bucket.set(rowDateISO, (bucket.get(rowDateISO) || 0) + qty);
        }

        const out = new Map();
        for (const [itemCode, dateMap] of byItemDate.entries()) {
            const values = [];
            for (let i = 0; i < windowDays; i += 1) {
                const d = addDays(dateFromObj, i);
                const iso = dateISO(d);
                values.push(Number(dateMap.get(iso)) || 0);
            }
            out.set(itemCode, {
                dateFrom: dateFromISO,
                dateTo: dateToISO,
                values
            });
        }

        return out;
    }

    function findItemDetailsGlobal() {
        return global.items_details_mockdata ||
            global.ITEMS_DETAILS ||
            global.ITEM_DETAILS ||
            global.ITEM_DETAILS_MOCKDATA ||
            global.ITEMS_DATA ||
            null;
    }

    function build(facts, options) {
        const opts = options || {};
        const windowDays = Math.max(1, Number(opts.windowDays) || 180);
        const defaultPeriod = Number(opts.defaultPeriod) || 7;
        const usageRows = Array.isArray(facts && facts.factDailyUsage) ? facts.factDailyUsage : [];

        let maxDate = null;
        for (const row of usageRows) {
            const d = toDateOnly(row && row.dateISO);
            if (!d) continue;
            if (!maxDate || d > maxDate) maxDate = d;
        }

        if (!maxDate) {
            const fallbackDate = toDateOnly(new Date()) || new Date();
            maxDate = fallbackDate;
        }

        const dateToObj = maxDate;
        const dateFromObj = addDays(dateToObj, -(windowDays - 1));
        const dateFrom = dateISO(dateFromObj);
        const dateTo = dateISO(dateToObj);

        const globalSeriesByItemCode = buildGlobalSeriesByItemCode(usageRows, dateFromObj, dateToObj, windowDays);
        const trendGlobalByItemCode = new Map();
        const factTrendGlobal = [];

        if (global.TrendAnalysisEngine) {
            const engine = new global.TrendAnalysisEngine();
            for (const [itemCode, series] of globalSeriesByItemCode.entries()) {
                const analysis = engine.analyze(series.values, { defaultPeriod: defaultPeriod });
                const trendRow = {
                    itemCode,
                    dateFrom,
                    dateTo,
                    windowDays,
                    analysis,
                    metrics: {
                        overallDirection: analysis.overallDirection,
                        overallConfidence: analysis.overallConfidence,
                        seasonalDetected: analysis.seasonal && analysis.seasonal.detected ? true : false,
                        seasonalStrength: analysis.seasonal && Number.isFinite(analysis.seasonal.strength) ? analysis.seasonal.strength : 0,
                        nextPeakOffset: analysis.forecast && Number.isFinite(analysis.forecast.nextPeakOffset) ? analysis.forecast.nextPeakOffset : null,
                        projectedPeakTrendAdj: analysis.forecast && Number.isFinite(analysis.forecast.projectedPeakTrendAdj) ? analysis.forecast.projectedPeakTrendAdj : null
                    }
                };
                factTrendGlobal.push(trendRow);
                trendGlobalByItemCode.set(itemCode, trendRow);
            }
        }

        const derived = {
            factTrendGlobal,
            index: { trendGlobalByItemCode },
            globalSeriesByItemCode,
            substitutesByItemCode: new Map(),
            meta: {
                builtAt: new Date().toISOString(),
                windowDays,
                dateFrom,
                dateTo
            }
        };

        if (global.SubstituteResolver && typeof global.SubstituteResolver.buildAll === 'function') {
            const details = findItemDetailsGlobal();
            if (!details) {
                console.warn('[DerivedFacts] item details not found; class fallback may be limited');
            }
            const indexes = global.SubstituteResolver.buildIndexes(details || {});
            derived.substitutesByItemCode = global.SubstituteResolver.buildAll(derived, indexes, global.ITEM_SUBSTITUTE_REF || null);
        }

        return derived;
    }

    function audit(derived) {
        if (!derived || typeof derived !== 'object') {
            console.warn('[DerivedFacts] audit skipped: missing derived payload');
            return;
        }

        const trendRows = Array.isArray(derived.factTrendGlobal) ? derived.factTrendGlobal : [];
        const seasonalCount = trendRows.filter((row) => row && row.metrics && row.metrics.seasonalDetected).length;
        const seasonalPct = trendRows.length ? ((seasonalCount / trendRows.length) * 100).toFixed(1) : '0.0';

        console.log('[DerivedFacts] summary', {
            globalSeriesItems: derived.globalSeriesByItemCode instanceof Map ? derived.globalSeriesByItemCode.size : 0,
            factTrendGlobalRows: trendRows.length,
            lastDateTo: derived.meta && derived.meta.dateTo,
            seasonalDetectedPercent: seasonalPct + '%'
        });

        if (global.SubstituteResolver && typeof global.SubstituteResolver.audit === 'function') {
            global.SubstituteResolver.audit(derived.substitutesByItemCode);
        }
    }

    global.DerivedFacts = { build, audit };
})(typeof window !== 'undefined' ? window : globalThis);
