(function(global) {
    'use strict';

    function toKey(value) {
        return String(value == null ? '' : value).trim();
    }

    function toDateISO(value) {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }

    function dateAddDays(dateISO, days) {
        const d = new Date(dateISO + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    }

    function detectRange(dailyUsage, windowDays) {
        let maxDate = null;
        for (const row of dailyUsage) {
            const dateISO = toDateISO(row && row.dateISO);
            if (!dateISO) continue;
            if (!maxDate || dateISO > maxDate) maxDate = dateISO;
        }
        const dateTo = maxDate || new Date().toISOString().slice(0, 10);
        const dateFrom = dateAddDays(dateTo, -(windowDays - 1));
        return { dateFrom, dateTo };
    }

    function build(facts, options) {
        const opts = options || {};
        const windowDays = Number(opts.windowDays) || 180;
        const seasonalityPeriod = Number(opts.seasonalityPeriod) || 7;
        const dailyUsage = Array.isArray(facts && facts.factDailyUsage) ? facts.factDailyUsage : [];
        const { dateFrom, dateTo } = detectRange(dailyUsage, windowDays);

        const allDates = [];
        for (let i = 0; i < windowDays; i += 1) {
            allDates.push(dateAddDays(dateFrom, i));
        }

        const byItemDate = new Map();
        const totalByItem = new Map();
        for (const row of dailyUsage) {
            if (!row || typeof row !== 'object') continue;
            const itemCode = toKey(row.itemCode);
            const dateISO = toDateISO(row.dateISO);
            if (!itemCode || !dateISO) continue;
            if (dateISO < dateFrom || dateISO > dateTo) continue;
            const qty = Number(row.dailyDispenseQty) || 0;
            const key = itemCode + '|' + dateISO;
            byItemDate.set(key, (byItemDate.get(key) || 0) + qty);
            totalByItem.set(itemCode, (totalByItem.get(itemCode) || 0) + qty);
        }

        const allItemCodes = new Set();
        for (const key of byItemDate.keys()) {
            const itemCode = key.split('|')[0];
            allItemCodes.add(itemCode);
        }

        const globalSeriesByItemCode = new Map();
        for (const itemCode of allItemCodes) {
            const values = allDates.map((dateISO) => byItemDate.get(itemCode + '|' + dateISO) || 0);
            globalSeriesByItemCode.set(itemCode, {
                dateFrom,
                dateTo,
                dates: allDates.slice(),
                values
            });
        }

        const factTrendGlobal = [];
        const globalByItemCode = new Map();
        const shortageStartByItemCode = {};
        const pulseStartsByItemCode = {};

        const engine = global.TrendAnalysisEngine ? new global.TrendAnalysisEngine() : null;
        for (const [itemCode, series] of globalSeriesByItemCode.entries()) {
            let analysis = null;
            if (engine && Array.isArray(series.values) && series.values.length) {
                try {
                    analysis = engine.analyze(series.values, { period: seasonalityPeriod, seasonalityPeriod });
                } catch (error) {
                    console.warn('[TrendFacts] analyze failed for', itemCode, error);
                }
            }

            const trendRow = {
                itemCode,
                dateFrom,
                dateTo,
                analysis,
                overallDirection: analysis ? analysis.overallDirection : null,
                overallConfidence: analysis ? analysis.overallConfidence : null,
                seasonalDetected: analysis && analysis.seasonal ? analysis.seasonal.detected : null,
                seasonalStrength: analysis && analysis.seasonal ? analysis.seasonal.strength : null
            };

            const shortageSignals = analysis && Array.isArray(analysis.shortageSignals) ? analysis.shortageSignals : null;
            const pulsePatterns = analysis && Array.isArray(analysis.pulsePatterns) ? analysis.pulsePatterns : null;
            shortageStartByItemCode[itemCode] = shortageSignals && shortageSignals.length
                ? (shortageSignals[0].startDate || shortageSignals[0].dateISO || null)
                : null;
            pulseStartsByItemCode[itemCode] = pulsePatterns && pulsePatterns.length
                ? pulsePatterns.map((p) => p.startDate || p.dateISO).filter(Boolean)
                : [];

            factTrendGlobal.push(trendRow);
            globalByItemCode.set(itemCode, trendRow);
        }

        const topItemCodes = Array.from(totalByItem.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 150)
            .map((entry) => entry[0]);

        return {
            factTrendGlobal,
            index: {
                globalByItemCode
            },
            series: {
                globalSeriesByItemCode
            },
            eventMarkers: {
                shortageStartByItemCode,
                pulseStartsByItemCode
            },
            meta: {
                builtAt: new Date().toISOString(),
                windowDays,
                seasonalityPeriod,
                topItemCodes
            }
        };
    }

    global.TrendFacts = {
        build
    };
})(typeof window !== 'undefined' ? window : globalThis);
