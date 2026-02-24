(function(global) {
    'use strict';

    function toKey(value) {
        return String(value == null ? '' : value).trim();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function pearson(xs, ys) {
        if (!Array.isArray(xs) || !Array.isArray(ys)) return null;
        const n = Math.min(xs.length, ys.length);
        if (n < 7) return null;

        let sumX = 0;
        let sumY = 0;
        let sumXX = 0;
        let sumYY = 0;
        let sumXY = 0;
        let count = 0;

        for (let i = 0; i < n; i += 1) {
            const x = Number(xs[i]);
            const y = Number(ys[i]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            sumX += x;
            sumY += y;
            sumXX += x * x;
            sumYY += y * y;
            sumXY += x * y;
            count += 1;
        }

        if (count < 7) return null;
        const numerator = (count * sumXY) - (sumX * sumY);
        const denominator = Math.sqrt(Math.max(0, ((count * sumXX) - (sumX * sumX)) * ((count * sumYY) - (sumY * sumY))));
        if (!denominator) return null;
        return numerator / denominator;
    }

    function buildIndexes(itemDetailsByCodeObjectOrMap) {
        const detailsByCode = new Map();
        const itemsByClass = new Map();

        let entries = [];
        if (itemDetailsByCodeObjectOrMap instanceof Map) {
            entries = Array.from(itemDetailsByCodeObjectOrMap.entries());
        } else if (itemDetailsByCodeObjectOrMap && typeof itemDetailsByCodeObjectOrMap === 'object') {
            if (Array.isArray(itemDetailsByCodeObjectOrMap.items)) {
                entries = itemDetailsByCodeObjectOrMap.items.map((item) => [toKey(item && item.itemCode), item]);
            } else {
                entries = Object.entries(itemDetailsByCodeObjectOrMap);
            }
        }

        for (const [rawCode, detailObj] of entries) {
            if (!detailObj || typeof detailObj !== 'object') continue;
            const itemCode = toKey(detailObj.itemCode || rawCode);
            if (!itemCode) continue;
            detailsByCode.set(itemCode, detailObj);

            const className = toKey(detailObj.class || detailObj.itemClass);
            if (!className) continue;
            if (!itemsByClass.has(className)) itemsByClass.set(className, []);
            itemsByClass.get(className).push(itemCode);
        }

        return { detailsByCode, itemsByClass };
    }

    function resolveCandidates(itemCode, ctx) {
        const code = toKey(itemCode);
        const manualRef = ctx && ctx.manualRef;
        const detailsByCode = ctx && ctx.detailsByCode;
        const itemsByClass = ctx && ctx.itemsByClass;
        const maxCandidates = Number(ctx && ctx.maxCandidates) || 5;

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
                .slice(0, maxCandidates)
                .map((candidateCode) => ({ itemCode: toKey(candidateCode), relationship: 'same_class' }));

            if (classCandidates.length > 0) {
                return { source: 'class', candidates: classCandidates };
            }
        }

        return { source: 'inferred', candidates: inferCandidates(code, ctx) };
    }

    function inferCandidates(itemCode, ctx) {
        const code = toKey(itemCode);
        const seriesMap = ctx && ctx.globalSeriesByItemCode;
        if (!(seriesMap instanceof Map)) return [];

        const sourceSeries = seriesMap.get(code);
        const sourceValues = sourceSeries && Array.isArray(sourceSeries.values) ? sourceSeries.values : null;
        if (!sourceValues || sourceValues.length < 14) return [];

        const n = 90;
        const sourceTail = sourceValues.slice(-n);
        const universe = Array.isArray(ctx && ctx.topItemCodes) && ctx.topItemCodes.length
            ? ctx.topItemCodes.map(toKey)
            : Array.from(seriesMap.keys()).map(toKey);

        const scored = [];
        for (const candidateCode of universe) {
            if (!candidateCode || candidateCode === code) continue;
            const candidateSeries = seriesMap.get(candidateCode);
            const candidateValues = candidateSeries && Array.isArray(candidateSeries.values) ? candidateSeries.values : null;
            if (!candidateValues || candidateValues.length < 14) continue;

            const candidateTail = candidateValues.slice(-n);
            const len = Math.min(sourceTail.length, candidateTail.length);
            if (len < 14) continue;
            const corr = pearson(sourceTail.slice(-len), candidateTail.slice(-len));
            if (!Number.isFinite(corr)) continue;
            const score = Math.max(0, -corr);
            if (score <= 0) continue;

            scored.push({
                itemCode: candidateCode,
                confidence: clamp(score, 0, 1),
                evidence: { corr: Number(corr.toFixed(4)) }
            });
        }

        scored.sort((a, b) => b.confidence - a.confidence);
        return scored.slice(0, 3);
    }

    function buildAll(derived, indexes, manualRef) {
        const out = new Map();
        const globalSeriesByItemCode = derived && derived.globalSeriesByItemCode;
        const topItemCodes = derived && derived.meta && Array.isArray(derived.meta.topItemCodes) ? derived.meta.topItemCodes : [];

        const allCodes = globalSeriesByItemCode instanceof Map
            ? Array.from(globalSeriesByItemCode.keys())
            : [];

        for (const itemCode of allCodes) {
            out.set(toKey(itemCode), resolveCandidates(itemCode, {
                manualRef: manualRef || null,
                detailsByCode: indexes && indexes.detailsByCode,
                itemsByClass: indexes && indexes.itemsByClass,
                globalSeriesByItemCode,
                topItemCodes,
                maxCandidates: 5
            }));
        }

        return out;
    }

    function audit(substitutesByItemCode) {
        const substitutes = substitutesByItemCode instanceof Map
            ? substitutesByItemCode
            : (substitutesByItemCode && substitutesByItemCode.substitutesByItemCode);
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
