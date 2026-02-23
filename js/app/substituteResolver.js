(function(global) {
    'use strict';

    function toKey(value) {
        return String(value == null ? '' : value).trim();
    }

    function getSeriesFromMap(seriesMap, itemCode) {
        if (!(seriesMap instanceof Map)) return null;
        return seriesMap.get(toKey(itemCode)) || null;
    }

    function movingAverage(values, windowSize) {
        const out = [];
        const win = Math.max(1, Number(windowSize) || 1);
        for (let i = 0; i < values.length; i += 1) {
            let sum = 0;
            let count = 0;
            for (let j = Math.max(0, i - win + 1); j <= i; j += 1) {
                const v = Number(values[j]);
                if (!Number.isFinite(v)) continue;
                sum += v;
                count += 1;
            }
            out.push(count ? (sum / count) : 0);
        }
        return out;
    }

    function pearson(xs, ys) {
        if (!Array.isArray(xs) || !Array.isArray(ys)) return 0;
        const n = Math.min(xs.length, ys.length);
        if (n < 7) return 0;

        let sx = 0;
        let sy = 0;
        let sxx = 0;
        let syy = 0;
        let sxy = 0;

        for (let i = 0; i < n; i += 1) {
            const x = Number(xs[i]);
            const y = Number(ys[i]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            sx += x;
            sy += y;
            sxx += x * x;
            syy += y * y;
            sxy += x * y;
        }

        const num = (n * sxy) - (sx * sy);
        const den = Math.sqrt(Math.max(0, ((n * sxx) - (sx * sx)) * ((n * syy) - (sy * sy))));
        if (!den) return 0;
        return num / den;
    }

    function parseDate(value) {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function calcLagDays(aDateISO, bDateISO) {
        const a = parseDate(aDateISO);
        const b = parseDate(bDateISO);
        if (!a || !b) return null;
        return Math.round((b.getTime() - a.getTime()) / 86400000);
    }

    function inferCandidates(itemCode, ctx) {
        const code = toKey(itemCode);
        const seriesMap = ctx && ctx.globalSeriesByItemCode;
        const topItemCodes = Array.isArray(ctx && ctx.topItemCodes) ? ctx.topItemCodes : null;
        const nDays = Number(ctx && ctx.inferenceWindowDays) || 90;
        const sourceSeries = getSeriesFromMap(seriesMap, code);
        if (!sourceSeries || !Array.isArray(sourceSeries.values) || sourceSeries.values.length < 14) {
            return [];
        }

        const sourceSmooth = movingAverage(sourceSeries.values.slice(-nDays), 7);
        const shortlist = topItemCodes && topItemCodes.length
            ? topItemCodes.map(toKey)
            : Array.from(seriesMap instanceof Map ? seriesMap.keys() : []).map(toKey);

        const shortageMap = ctx && ctx.shortageStartByItemCode;
        const pulseMap = ctx && ctx.pulseStartsByItemCode;
        const shortageStart = shortageMap && shortageMap[code] ? shortageMap[code] : null;

        const scored = [];
        for (const candidateCode of shortlist) {
            if (!candidateCode || candidateCode === code) continue;
            const candidateSeries = getSeriesFromMap(seriesMap, candidateCode);
            if (!candidateSeries || !Array.isArray(candidateSeries.values)) continue;
            const candidateSmooth = movingAverage(candidateSeries.values.slice(-nDays), 7);
            const corr = pearson(sourceSmooth, candidateSmooth);

            const pulses = pulseMap && Array.isArray(pulseMap[candidateCode]) ? pulseMap[candidateCode] : [];
            let bestLag = null;
            let lagBonus = 0;
            if (shortageStart && pulses.length > 0) {
                for (const pulseStart of pulses) {
                    const lag = calcLagDays(shortageStart, pulseStart);
                    if (lag == null) continue;
                    if (lag >= 0 && lag <= 21) {
                        if (bestLag == null || lag < bestLag) bestLag = lag;
                        lagBonus = Math.max(lagBonus, 0.2);
                    }
                }
            }

            const negCorr = Math.max(0, -corr);
            const confidence = Math.max(0, Math.min(1, (0.8 * negCorr) + lagBonus));
            if (confidence <= 0) continue;

            scored.push({
                itemCode: candidateCode,
                confidence,
                evidence: {
                    corr: Number(corr.toFixed(4)),
                    lagDays: bestLag
                }
            });
        }

        scored.sort((a, b) => b.confidence - a.confidence);
        return scored.slice(0, 3);
    }

    function buildIndexes(itemDetails) {
        const detailsByCode = new Map();
        const itemsByClass = new Map();

        const detailsItems = Array.isArray(itemDetails && itemDetails.items)
            ? itemDetails.items
            : (Array.isArray(itemDetails) ? itemDetails : []);

        for (const raw of detailsItems) {
            if (!raw || typeof raw !== 'object') continue;
            const code = toKey(raw.itemCode || raw.code || raw.id);
            if (!code) continue;
            detailsByCode.set(code, raw);

            const cls = toKey(raw.class || raw.itemClass);
            if (!cls) continue;
            if (!itemsByClass.has(cls)) itemsByClass.set(cls, []);
            itemsByClass.get(cls).push(code);
        }

        return { itemsByClass, detailsByCode };
    }

    function resolveCandidates(itemCode, ctx) {
        const code = toKey(itemCode);
        const manualRef = ctx && ctx.manualRef;
        const detailsByCode = ctx && ctx.detailsByCode;
        const itemsByClass = ctx && ctx.itemsByClass;
        const topCandidatesLimit = Number(ctx && ctx.topCandidatesLimit) || 5;

        const manual = manualRef && manualRef.items && manualRef.items[code]
            ? manualRef.items[code].substitutes
            : null;

        if (Array.isArray(manual) && manual.length > 0) {
            const sortedManual = manual.slice().sort((a, b) => {
                const pa = Number(a && a.priority);
                const pb = Number(b && b.priority);
                if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0;
                if (!Number.isFinite(pa)) return 1;
                if (!Number.isFinite(pb)) return -1;
                return pa - pb;
            });
            return { source: 'manual', candidates: sortedManual };
        }

        const details = detailsByCode instanceof Map ? detailsByCode.get(code) : null;
        const cls = toKey(details && (details.class || details.itemClass));
        if (cls && itemsByClass instanceof Map && itemsByClass.has(cls)) {
            const classCandidates = itemsByClass
                .get(cls)
                .filter((candidateCode) => toKey(candidateCode) !== code)
                .slice(0, topCandidatesLimit)
                .map((candidateCode) => ({ itemCode: toKey(candidateCode), relationship: 'same_class' }));

            if (classCandidates.length > 0) {
                return { source: 'class', candidates: classCandidates };
            }
        }

        return { source: 'inferred', candidates: inferCandidates(code, ctx) };
    }

    function buildAll(factsTrends, indexes, manualRef) {
        const out = new Map();
        const globalSeriesByItemCode = factsTrends && factsTrends.series ? factsTrends.series.globalSeriesByItemCode : null;
        const topItemCodes = factsTrends && factsTrends.meta && Array.isArray(factsTrends.meta.topItemCodes)
            ? factsTrends.meta.topItemCodes
            : [];

        const allCodes = globalSeriesByItemCode instanceof Map
            ? Array.from(globalSeriesByItemCode.keys())
            : [];

        for (const itemCode of allCodes) {
            out.set(toKey(itemCode), resolveCandidates(itemCode, {
                manualRef: manualRef || null,
                detailsByCode: indexes && indexes.detailsByCode,
                itemsByClass: indexes && indexes.itemsByClass,
                globalSeriesByItemCode,
                shortageStartByItemCode: factsTrends && factsTrends.eventMarkers ? factsTrends.eventMarkers.shortageStartByItemCode : null,
                pulseStartsByItemCode: factsTrends && factsTrends.eventMarkers ? factsTrends.eventMarkers.pulseStartsByItemCode : null,
                topItemCodes,
                topCandidatesLimit: 5
            }));
        }

        return out;
    }

    function audit(factsTrends) {
        const substitutes = factsTrends && factsTrends.substitutesByItemCode;
        if (!(substitutes instanceof Map)) {
            console.warn('[SubstituteResolver] audit skipped: substitutesByItemCode missing');
            return;
        }

        const buckets = { manual: [], class: [], inferred: [] };
        for (const [itemCode, result] of substitutes.entries()) {
            const source = result && result.source ? result.source : 'inferred';
            if (!buckets[source]) buckets[source] = [];
            buckets[source].push(itemCode);
        }

        console.log('[SubstituteResolver] counts by source', {
            manual: buckets.manual.length,
            class: buckets.class.length,
            inferred: buckets.inferred.length
        });
        console.log('[SubstituteResolver] sample manual', buckets.manual.slice(0, 5));
        console.log('[SubstituteResolver] sample class', buckets.class.slice(0, 5));
        console.log('[SubstituteResolver] sample inferred', buckets.inferred.slice(0, 5));
    }

    global.SubstituteResolver = {
        buildIndexes,
        resolveCandidates,
        inferCandidates,
        buildAll,
        audit
    };
})(typeof window !== 'undefined' ? window : globalThis);
