(function(){
  if (window.__chartsLogsPatched) return;
  window.__chartsLogsPatched = true;
  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _err = console.error.bind(console);
  function enabled(){ try { return localStorage.getItem('log_charts') !== '0'; } catch (_) { return true; } }
  console.log = function(...args){ if (enabled()) _log(...args); };
  console.warn = function(...args){ if (enabled()) _warn(...args); };
  console.error = function(...args){ if (enabled()) _err(...args); };
})();
        // ==================================================================================
        // BACK BUTTON FUNCTIONALITY
        // ==================================================================================
        let previousPage = null;
        let backButtonVisible = false;

function getTrendFactsState() {
    if (!window.TrendFactsState || typeof window.TrendFactsState !== 'object') {
        window.TrendFactsState = { source: 'unknown', calculatedAt: '', up: [], down: [], loadedAt: '' };
    }
    return window.TrendFactsState;
}

const PROJECTION_DEBUG_FLAG = '__projectionDebug';

function _projectionClamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function getTrendFactForItem(itemCode) {
    const code = String(itemCode || '').trim();
    if (!code) return null;
    const state = getTrendFactsState();
    state._itemLookup = state._itemLookup || {};
    if (state._itemLookup[code] !== undefined) return state._itemLookup[code];

    const up = Array.isArray(state.up) ? state.up : [];
    const down = Array.isArray(state.down) ? state.down : [];
    const match = up.find((x) => String(x.itemCode || '').trim() === code) || down.find((x) => String(x.itemCode || '').trim() === code);
    if (!match) {
        state._itemLookup[code] = null;
        return null;
    }

    const directionRaw = String(match.direction || match.trendDirection || '').toLowerCase();
    const direction = directionRaw.includes('down') || directionRaw.includes('decreas') ? 'down' : 'up';
    const confidenceRaw = Number(match.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? (confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw) : 0;
    const avgWeeklyUsage = Number(match.avgWeeklyUsage);
    const trendFact = {
        itemCode: code,
        direction,
        confidence: _projectionClamp(confidence, 0, 1),
        avgWeeklyUsage: Number.isFinite(avgWeeklyUsage) ? avgWeeklyUsage : null
    };
    state._itemLookup[code] = trendFact;
    return trendFact;
}

function getSpikeFactorForItem(itemCode) {
    const code = String(itemCode || '').trim();
    if (!code) return 1;
    if (window.SpikeFactors && typeof window.SpikeFactors.getSpikeMultiplierForItem === 'function') {
        return Number(window.SpikeFactors.getSpikeMultiplierForItem(code)) || 1;
    }
    // Accessing window.parent can throw SecurityError under file:// iframe isolation.
    try {
        const parentSpike = window.parent && window.parent !== window ? window.parent.SpikeFactors : null;
        if (parentSpike && typeof parentSpike.getSpikeMultiplierForItem === 'function') {
            return Number(parentSpike.getSpikeMultiplierForItem(code)) || 1;
        }
    } catch (_) {
        // Safe fallback: keep baseline behavior (multiplier 1)
    }
    return 1;
}


function getTrendFactorForItemCode(itemCode) {
    const trend = getTrendFactForItem(itemCode);
    if (!trend) return 1;
    if (trend.direction === 'up') return 1 + (0.5 * _projectionClamp(trend.confidence, 0, 1));
    if (trend.direction === 'down') return Math.max(0.6, 1 - (0.25 * _projectionClamp(trend.confidence, 0, 1)));
    return 1;
}
function getWeightedWeeklyUsage(itemCode, baselineWeeklyUsage, ctx) {
    const baseline = Number.isFinite(Number(baselineWeeklyUsage)) ? Number(baselineWeeklyUsage) : 0;
    if (!(baseline > 0)) {
        return {
            baselineWeeklyUsage: 0,
            weightedWeeklyUsage: 0,
            trendMult: 1,
            spikeMult: 1,
            trendFact: null,
            spikeFactor: 1
        };
    }

    const trendFact = (ctx && typeof ctx.getTrendFactForItem === 'function') ? ctx.getTrendFactForItem(itemCode) : null;
    const spikeFactor = (ctx && typeof ctx.getSpikeFactorForItem === 'function') ? ctx.getSpikeFactorForItem(itemCode) : 1;

    let trendMult = 1;
    if (trendFact && trendFact.direction === 'up') {
        const c = _projectionClamp(trendFact.confidence, 0, 1);
        trendMult = 1 + (0.5 * c);
    } else if (trendFact && trendFact.direction === 'down') {
        const c = _projectionClamp(trendFact.confidence, 0, 1);
        trendMult = Math.max(0.6, 1 - (0.25 * c));
    }

    let spikeMult = 1;
    if (Number.isFinite(Number(spikeFactor))) {
        spikeMult = _projectionClamp(Number(spikeFactor), 1, 2.5);
    }

    let weightedWeeklyUsage = baseline * trendMult * spikeMult;
    weightedWeeklyUsage = _projectionClamp(weightedWeeklyUsage, baseline * 0.25, baseline * 3);

    if (!Number.isFinite(weightedWeeklyUsage)) weightedWeeklyUsage = baseline;

    return {
        baselineWeeklyUsage: baseline,
        weightedWeeklyUsage,
        trendMult,
        spikeMult,
        trendFact,
        spikeFactor
    };
}
        
        // Listen for navigation messages that include referrer information
        window.addEventListener('message', (event) => {
            try {
                if (event && event.data && event.data.type && (event.data.type === 'navigateToFlowFromStockoutSegment' || event.data.type === 'drillToItemInVerticalBar')) {
                    console.log('📨 Charts: received', event.data.type, { itemCode: event.data.itemCode, sublocation: event.data.sublocation, location: event.data.location });
                }
            } catch(e) {}

            // Always ACK direct navigation immediately (even before charts are initialized)
            // so the parent can stop retrying.
            try {
                if (event && event.data && (event.data.type === 'drillToItemInVerticalBar' || event.data.type === 'navigateToFlowFromStockoutSegment')) {
                    const navId = event.data && event.data.navId ? String(event.data.navId) : '';
                    window.__chartsAckedNavIds = window.__chartsAckedNavIds || {};
                    if (navId && !window.__chartsAckedNavIds[navId]) {
                        window.__chartsAckedNavIds[navId] = true;
                        window.parent && window.parent.postMessage({ type: 'directNavAck', navId: navId }, '*');


// Parent (Dashboard) can request the latest projection state for debugging.
try {
    if (event && event.data && event.data.type === 'PB_REQUEST_CHART_STATE') {
        const payload = {};
        try {
            if (typeof costChartState !== 'undefined' && costChartState) {
                if (costChartState._projUsageCI) payload.projUsageCI = costChartState._projUsageCI;
                if (costChartState._projUsageSigmaRel != null) payload.projUsageSigmaRel = costChartState._projUsageSigmaRel;
                if (costChartState._projUsagePiMethod) payload.projUsagePiMethod = costChartState._projUsagePiMethod;
                if (costChartState._projUsagePiN != null) payload.projUsagePiN = costChartState._projUsagePiN;
            }
        } catch (_) {}
        // Reply to the requester if available; otherwise fall back to parent/top.
        try {
            const target = (event && event.source) ? event.source : (window.parent || window.top);
            target && target.postMessage({ type: 'COST_CHART_STATE', payload }, '*');
        } catch (_) {
            try { window.parent && window.parent.postMessage({ type: 'COST_CHART_STATE', payload }, '*'); } catch(e) {}
        }
        return;
    }
} catch(e) {}
                    }
                }
            } catch(e) {}

            // Queue actions until charts state is ready
            window.__pendingAnalyticsActions = window.__pendingAnalyticsActions || [];
            // NOTE: Charts runs as a plain script (often under file:// => origin "null").
            // Do NOT rely on window.* for internal module variables; most are declared in
            // this script scope (e.g. cachedMockData, costChartState).
            function __chartsReady(){
                try {
                    const hasState = (typeof costChartState !== 'undefined') && !!(costChartState && costChartState.items);
                    const hasData = (typeof cachedMockData !== 'undefined') && !!(cachedMockData && cachedMockData.items && cachedMockData.items.length);
                    return hasState && hasData && (typeof switchChartType === 'function');
                } catch(e){ return false; }
            }
            function __enqueueAnalyticsAction(payload){
                window.__pendingAnalyticsActions.push(payload);
                // Try a few times to flush once charts are initialized
                let tries = 0;
                (function tick(){
                    // If data isn't loaded yet, proactively request it once.
                    try {
                        if (tries === 0 && typeof requestMockDataFromParent === 'function') {
                            const hasData = (typeof cachedMockData !== 'undefined') && !!(cachedMockData && cachedMockData.items && cachedMockData.items.length);
                            if (!hasData) requestMockDataFromParent().catch(() => {});
                        }
                    } catch(e) {}
                    if (__chartsReady()) {
                        try { __flushPendingAnalyticsActions(); } catch(e){}
                        return;
                    }
                    if (tries++ < 20) setTimeout(tick, 150);
                })();
            }
            function __flushPendingAnalyticsActions(){
                if (!__chartsReady()) return;
                const q = window.__pendingAnalyticsActions.splice(0);
                q.forEach(pl => { try { window.dispatchEvent(new MessageEvent('message', { data: pl })); } catch(e){} });
            }

            
            // NOTE: Do not expose callable handlers on the iframe window.
            // In file:// (origin "null"), cross-frame property access can throw SecurityError.
const backButton = document.getElementById('backButton');
            
            // Handle setReferrer message (for back button without applying filter)
            if (event.data.type === 'setReferrer') {
                if (event.data.referrer && event.data.referrer !== null) {
                    previousPage = event.data.referrer;
                    if (backButton) {
                        backButton.classList.add('visible');
                        backButtonVisible = true;
                    }
                    console.log('📍 Charts: Referrer set (state preserved):', previousPage);
                    costChartState._isBackNavigation = !!event.data.isBackNavigation;
                    if (costChartState._isBackNavigation) {
                        // Suppress any auto navigation shortcuts during a back-button return.
                        costChartState._suppressListViewNav = true;
                    }

                    // If we are returning from inventory/shortage bulletin, restore the last
                    // chart state snapshot captured before navigation.
                    if (previousPage === 'inventory') {
                        try { restoreAnalyticsStateIfPresent(); } catch (e) {}
                    }

                    // If this Charts iframe was kept alive (tab switch) and we're coming back
                    // via back-navigation, the script may not re-run initialization. Ensure
                    // we have data (and trigger a redraw) when referrer is set.
                    try {
                        const hasData = !!(cachedMockData && cachedMockData.items && cachedMockData.items.length);
                        const hasTx = hasUsableTransactions(cachedMockData);
                        if (!hasData || !hasTx) {
                            console.log('🔄 Charts: No cached data on referrer set; requesting from parent...');
                            requestMockDataFromParent()
                                .then(() => {
                                    // Reset any Option-B aggregates so the bar chart can rebuild.
                                    costChartState.__txDailyAggBuilt = false;
                                    scheduleChartsRedraw('referrer');
                                })
                                .catch((e) => console.warn('⚠️ Charts: Data request failed on referrer set', e));
                        } else {
                            // Data exists; just redraw to reflect any preserved filters.
                            scheduleChartsRedraw('referrer');
                        }
                    } catch (e) {
                        // non-fatal
                    }
                }
                return; // Exit early
            }
            
            // Show back button when navigating TO this page with a referrer
            if (event.data.type === 'applyFilterWithHighlight') {
                // Only show back button if referrer is explicitly set and not null
                if (event.data.referrer && event.data.referrer !== null) {
                    previousPage = event.data.referrer;
                    if (backButton) {
                        backButton.classList.add('visible');
                        backButtonVisible = true;
                    }
                    console.log('📍 Charts: Referrer detected:', previousPage);
                } else {
                    // Hide back button if referrer is null or undefined
                    if (backButton && backButtonVisible) {
                        backButton.classList.remove('visible');
                        backButtonVisible = false;
                        previousPage = null;
                    }
                    console.log('📍 Charts: No referrer (back button hidden)');
                }
            }
            
            // Hide back button when we're being told to do something else (navigating away)
            if (event.data.type === 'requestMockData' || 
                event.data.type === 'applyDarkMode') {
                if (backButton && backButtonVisible) {
                    backButton.classList.remove('visible');
                    backButtonVisible = false;
                    previousPage = null;
                    console.log('👋 Charts: Hiding back button (navigated away)');
                }
            }
            
            // Handle clearFilters message - reset chart to root view
            if (event.data.type === 'clearFilters') {
                console.log('🧹 Charts: Clearing filters and resetting to root view');
                
                // Restore original items if search was active
                if (window.originalItems) {
                    costChartState.items = window.originalItems;
                    window.originalItems = null;
                    console.log('✓ Restored original items from search');
                }
                
                // Restore original items if filter was active (from Analytics cards)
                if (costChartState.originalItems && costChartState.originalItems.length > 0) {
                    costChartState.items = [...costChartState.originalItems];
                    costChartState.originalItems = null;
                    console.log('✓ Restored original items from filter');
                }
                
                // Reset chart state
                costChartState.drillDownStack = [];
                costChartState.viewMode = 'itemClass';
                costChartState.currentPage = 0;
                costChartState.highlightKey = null;
                costChartState.filterData = null;
                costChartState.selectedIndex = -1;
                costChartState.hoveredIndex = -1;
                
                // Hide back button
                if (backButton && backButtonVisible) {
                    backButton.classList.remove('visible');
                    backButtonVisible = false;
                    previousPage = null;
                }
                
                // Reset dropdown selector
                const selector = document.getElementById('costChartViewSelector');
                if (selector) {
                    selector.value = 'itemClass';
                }
                
                // Redraw chart at root level
                if (costChartState.chartType === 'cost-bar') {
                // Re-render breadcrumb immediately so the DOM levels match the current drillDownStack
                try { updateBreadcrumb(costChartState.lastTotalCost ?? 0); } catch(e) {}

	                if (costChartState && costChartState.chartType === 'flow-chart') invalidateFlowCache();
	                scheduleChartsRedraw('dateRange');
                } else if (costChartState.chartType === 'time-chart') {
                    drawTimeSeriesChart();
                } else if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                }
            }
            
            
            // Drill to a single item in the vertical bar chart (Class → Name → Description)
            if (event.data.type === 'drillToItemInVerticalBar') {
                if (typeof __chartsReady === 'function' && !__chartsReady()) { __enqueueAnalyticsAction(event.data); return; }
                try {
                    // Ack receipt so parent stops retrying (deduped)
                    try {
                        const navId = event.data && event.data.navId ? String(event.data.navId) : '';
                        window.__chartsAckedNavIds = window.__chartsAckedNavIds || {};
                        if (navId && !window.__chartsAckedNavIds[navId]) {
                            window.__chartsAckedNavIds[navId] = true;
                            window.parent && window.parent.postMessage({ type: 'directNavAck', navId: navId }, '*');
                        }
                    } catch(e) {}

                    // Dedup identical drill messages caused by parent retry + tab/darkmode churn
                    try {
                        window.__lastDirectNav = window.__lastDirectNav || { sig: '', ts: 0 };
                        const sig = String(event.data.type || '') + '|' + String(event.data.itemCode || '') + '|' + String(event.data.sublocation || '') + '|' + String(event.data.location || '');
                        if (window.__lastDirectNav.sig === sig && (Date.now() - window.__lastDirectNav.ts) < 2500) {
                            return;
                        }
                        window.__lastDirectNav = { sig: sig, ts: Date.now() };
                    } catch(e) {}
                    const itemCode = String(event.data.itemCode || '').trim();
                    // NOTE:
                    // Optimization passes a *destination unit* (sendToLocation) in event.data.sublocation
                    // for the vertical bar drill. Transaction "sublocation" is the *source* (cabinet/device)
                    // and must NOT be used to derive the destination mainLocation for the bar chart.
                    const subloc = String(event.data.sublocation || '').trim();
                    const locFromMsg = String(event.data.location || '').trim();
                    if (!itemCode) return;

                    // Set the per-view location/sublocation filters BEFORE switching views so header controls render correctly.
                    try {
                        costChartState.itemSublocItemCode = itemCode;
                        costChartState.itemSublocMap = computeSublocMapForItem(itemCode);
                        if (subloc) {
                            const subRaw = String(subloc || '').trim();
                            const subCanon = _canonSublocExact(subRaw);

                            // Derive destination mainLocation from the SUBLOCATION_MAP.
                            // IMPORTANT: SUBLOCATION_MAP keys may include spaces/punctuation; avoid using only
                            // canonicalized keys here or we can miss exact matches.
                            let locKey = '';
                            try {
                                const subMap = (window.SUBLOCATION_MAP || window.__optSubMap || window.__optSubLocMap || null);
                                if (subMap) {
                                    const candidates = [
                                        subRaw,
                                        subRaw.toUpperCase(),
                                        subRaw.toLowerCase(),
                                        subCanon,
                                        subCanon ? subCanon.toUpperCase() : '',
                                        subCanon ? subCanon.toLowerCase() : ''
                                    ].filter(Boolean);
                                    for (let i = 0; i < candidates.length; i++) {
                                        const k = candidates[i];
                                        const entry = subMap[k];
                                        if (entry && entry.mainLocation) {
                                            locKey = String(entry.mainLocation).trim().toUpperCase();
                                            break;
                                        }
                                    }
                                }
                            } catch(_) {}

                            // Fallback to the same helper used elsewhere (still prefers exact raw lookup)
                            if (!locKey) {
                                locKey = String(_mainLocFromSublocToken(subRaw) || _mainLocFromSublocToken(subCanon) || '').trim().toUpperCase();
                            }
                            if (!locKey) {
                                locKey = _locKeyFromCanon(_canonLocKey(subCanon || subRaw));
                            }

                            costChartState.itemLocFilter = locKey || (locFromMsg ? locFromMsg.trim().toUpperCase() : 'ALL');
                            // Keep the user's original display string for the toggle label selection
                            costChartState.itemSublocFilter = String(subRaw);
                        } else if (locFromMsg) {
                            costChartState.itemLocFilter = locFromMsg.trim().toUpperCase();
                            costChartState.itemSublocFilter = 'ALL';
                        } else {
                            costChartState.itemLocFilter = 'ALL';
                            costChartState.itemSublocFilter = 'ALL';
                        }
                    } catch(e) {}

                    // Ensure bar-chart is active and default to Usage view when arriving from Optimization.
                    try { costChartState.verticalBarView = 'usage'; } catch(e) {}
                    switchChartType('bar-chart');

                    // Ensure monthly transaction scripts for the selected range are available BEFORE drawing.
                    // Without this, direct nav can switch to bar-chart but never render (no tx history yet).
                    try {
                        // IMPORTANT: During direct navigation the date-range UI may not be hydrated yet.
                        // getSelectedDateRangeISO() can be null, so fall back to localStorage/presets.
                        const getRangeFallback = () => {
                            try {
                                const r0 = (typeof getSelectedDateRangeISO === 'function') ? getSelectedDateRangeISO() : null;
                                if (r0 && r0.from && r0.to) return r0;
                            } catch (e) {}
                            try {
                                const fromLS = (localStorage.getItem('chartsFromDate') || '').toString();
                                const toLS   = (localStorage.getItem('chartsToDate') || '').toString();
                                if (fromLS && toLS) return { from: fromLS, to: toLS };
                            } catch (e) {}
                            let preset = '30';
                            try {
                                preset = (localStorage.getItem('chartsDatePreset') || costChartState.dateRangeDays || '30').toString();
                            } catch (e) {}
                            const toD = new Date();
                            const toISO = (typeof toISODate === 'function') ? toISODate(toD) : toD.toISOString().slice(0, 10);
                            // Avoid requesting "all" months during direct nav; default to 90d for all.
                            const days = (preset === '60' ? 60 : preset === '90' ? 90 : preset === 'all' ? 90 : 30);
                            const fromD = new Date(toD.getTime() - (days * 24 * 60 * 60 * 1000));
                            const fromISO = (typeof toISODate === 'function') ? toISODate(fromD) : fromD.toISOString().slice(0, 10);
                            return { from: fromISO, to: toISO };
                        };

                        const rr = getRangeFallback();

                        // Align the date-range UI + localStorage to the range we are about to ensure.
                        // This prevents downstream bar-chart logic from reading a stale range and
                        // firing an additional ensureTxRange request.
                        try {
                            if (rr && rr.from && rr.to) {
                                const fromEl = document.getElementById('chartsFromDate');
                                const toEl   = document.getElementById('chartsToDate');
                                if (fromEl) fromEl.value = rr.from;
                                if (toEl)   toEl.value = rr.to;
                                try { localStorage.setItem('chartsFromDate', rr.from); } catch(e) {}
                                try { localStorage.setItem('chartsToDate', rr.to); } catch(e) {}
                            }
                        } catch(e) {}

                        // Mark direct nav as in-flight so the draw pipeline doesn't duplicate range ensures.
                        try {
                            costChartState.__directNavInProgress = true;
                            clearTimeout(costChartState.__directNavInProgressT);
                            costChartState.__directNavInProgressT = setTimeout(() => {
                                try { costChartState.__directNavInProgress = false; } catch(_) {}
                            }, 2500);
                        } catch(e) {}
                        if (rr && rr.from && rr.to && typeof ensureTxRangeFromParent === 'function' && !costChartState.__directNavEnsuringTx) {
                            costChartState.__directNavEnsuringTx = true;
                            try { console.log('📨 Charts: ensureTxRange (direct nav):', rr); } catch (e) {}
                            ensureTxRangeFromParent(rr.from, rr.to)
                                .then(() => (typeof requestMockDataFromParent === 'function' ? requestMockDataFromParent() : null))
                                .then(() => {
                                    costChartState.__directNavEnsuringTx = false;
                                    try { costChartState.__vbEnsuredRangeKey = rr.from + '|' + rr.to; } catch (e) {}
                                    costChartState.__txDailyAggBuilt = false;
                                    scheduleChartsRedraw('directNavTx');
                                })
                                .catch(() => {
                                    costChartState.__directNavEnsuringTx = false;
                                    scheduleChartsRedraw('directNavTxFail');
                                });
                        }
                    } catch (_) {}

                    // Find the item metadata to build the drill path
                    const universe = (costChartState.absoluteOriginalItems && costChartState.absoluteOriginalItems.length) ? costChartState.absoluteOriginalItems
                                   : ((costChartState.originalItems && costChartState.originalItems.length) ? costChartState.originalItems : costChartState.items);
                    const it = (universe || []).find(x => String(x.itemCode || x.ItemCode || '').replace(/^0+/, '') === itemCode.replace(/^0+/, '')) 
                            || (universe || []).find(x => String(x.itemCode || x.ItemCode || '') === itemCode);

                    if (!it) {
                        console.warn('⚠️ drillToItemInVerticalBar: item not found for', itemCode);
                        return;
                    }

                    // Reset state then set drill stack to description level
                    costChartState.drillDownStack = [
                        { mode: 'itemClass', key: (it.itemClass || 'Unknown') },
                        { mode: 'drugName',  key: (it.drugName  || 'Unknown') },
                        { mode: 'description', key: (it.description || 'Unknown') }
                    ];
                    costChartState.viewMode = 'description';
                    costChartState.currentPage = 0;
                    costChartState.selectedIndex = -1;
                    costChartState.hoveredIndex = -1;

                    // Redraw + breadcrumb
                    try { if (typeof updateBreadcrumb === 'function') updateBreadcrumb(costChartState.lastTotalCost ?? 0); } catch(e) {}
                    // Use a scheduled redraw so the chart has time to finish switching canvases.
                    try { scheduleChartsRedraw('directNav'); } catch(e) {}
                    try {
                        if (typeof drawEnhancedVerticalBarChart === 'function') {
                            setTimeout(() => { try { drawEnhancedVerticalBarChart(); } catch(_){} }, 0);
                        }
                    } catch(e) {}

                } catch (e) {
                    console.warn('⚠️ drillToItemInVerticalBar failed', e);
                }
            }

            // Navigate to Flow chart from Stock-out timeline segment (item + sublocation constrained)
            if (event.data.type === 'navigateToFlowFromStockoutSegment') {
                if (typeof __chartsReady === 'function' && !__chartsReady()) { __enqueueAnalyticsAction(event.data); return; }
                try {
                    const itemCode = String(event.data.itemCode || '').trim();
                    const subloc = String(event.data.sublocation || '').trim();
                    const locFromMsg = String(event.data.location || '').trim();
                    if (!itemCode) return;

                    // Clear any legacy chip/search filters so the breadcrumb can be shown.
                    try { costChartState.filterData = null; } catch (e) {}
                    try { costChartState.searchTerm = ''; } catch (e) {}


                    // Store a flow-segment filter. This will be shown as an extra breadcrumb level.
                    costChartState.flowSegmentFilter = {
                        itemCode: itemCode,
                        sublocation: subloc,
                        avgDailyTx: Number(event.data.avgDailyTx) || 0
                    };

                    // Mark that flow was activated directly from a stockout segment click.
                    // Used to show the per-day (14d) tx breakdown and to keep segment state separate
                    // from user-driven flow navigation.
                    costChartState.flowSegmentActivated = true;

                    // Set breadcrumb drill path the same way as scatter-dot drill:
                    // Class → Name → Description for this item.
                    try {
                        const base = (costChartState.absoluteOriginalItems && costChartState.absoluteOriginalItems.length)
                            ? costChartState.absoluteOriginalItems
                            : (costChartState.originalItems || costChartState.items || []);
                        const it = (base || []).find(x => {
                            const c = String(x.itemCode || x.ItemCode || '').trim();
                            if (!c) return false;
                            return c === itemCode || ((c.replace(/^0+/, '') || c) === (itemCode.replace(/^0+/, '') || itemCode));
                        });
                        if (it) {
                            costChartState.drillDownStack = [
                                { mode: 'itemClass', key: (it.itemClass || 'Unknown') },
                                { mode: 'drugName',  key: (it.drugName  || 'Unknown') },
                                { mode: 'description', key: (it.description || 'Unknown') }
                            ];
                            costChartState.viewMode = 'description';
                        } else {
                            costChartState.drillDownStack = [];
                        }
                    } catch(e) {}

                    // Narrow item universe for consistency across charts
                    try {
                        if (!costChartState.originalItems || !costChartState.originalItems.length) {
                            costChartState.originalItems = [...costChartState.items];
                        }
                        const base = (costChartState.absoluteOriginalItems && costChartState.absoluteOriginalItems.length) ? costChartState.absoluteOriginalItems : (costChartState.originalItems || costChartState.items || []);
                        costChartState.items = base.filter(it => {
                            const c = String(it.itemCode || it.ItemCode || '').trim();
                            return c === itemCode || (c.replace(/^0+/, '') === itemCode.replace(/^0+/, ''));
                        });
                    } catch(e) {}


                    // Switch to flow chart (Sankey)
                    switchChartType('flow-chart');
                    try { if (typeof invalidateFlowCache === 'function') invalidateFlowCache(); } catch(e) {}
                    // Re-assert flow mode shortly after to override any pending redraws
                    try { setTimeout(()=>{ try{ switchChartType('flow-chart'); }catch(_){ } }, 60); } catch(e) {}

                    // Refresh breadcrumb (now includes location)
                    try { if (typeof updateBreadcrumb === 'function') updateBreadcrumb(costChartState.lastTotalCost ?? 0); } catch(e) {}

                } catch (e) {
                    console.warn('⚠️ navigateToFlowFromStockoutSegment failed', e);
                }
            }

// Handle trending items filter from Analytics page
            if (event.data.type === 'applyTrendingItemsFilter') {
                console.log('📈 Charts: Received trending items filter');
                console.log('   Item codes:', event.data.itemCodes.length);
                console.log('   Filter type:', event.data.filterType);
                
                // Store original items if not already stored
                if (!costChartState.originalItems || costChartState.originalItems.length === 0) {
                    costChartState.originalItems = [...costChartState.items];
                    console.log('✓ Stored original items:', costChartState.originalItems.length);
                }
                
                // Filter items to only trending items
                const trendingItemCodes = event.data.itemCodes.map(code => String(code));
                costChartState.items = costChartState.originalItems.filter(item => 
                    trendingItemCodes.includes(String(item.itemCode))
                );
                
                console.log('✓ Filtered to', costChartState.items.length, 'trending items');
                
                // Set filter data for chip display
                costChartState.filterData = {
                    filterType: event.data.filterType || 'Trending Items',
                    itemCodes: event.data.itemCodes,
                    threshold: event.data.threshold
                };
                
                // Reset view to root
                costChartState.drillDownStack = [];
                costChartState.viewMode = 'itemClass';
                costChartState.currentPage = 0;
                costChartState.highlightKey = null;
                costChartState.selectedIndex = -1;
                costChartState.hoveredIndex = -1;
                
                // Redraw chart with filtered data
                if (costChartState.chartType === 'cost-bar') {
                    scheduleChartsRedraw('dateRange');
                } else if (costChartState.chartType === 'time-chart') {
                    drawTimeSeriesChart();
                } else if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                }
                
                console.log('✅ Trending items filter applied to Charts');
            }
        });
        
        // Handle back button click
        document.addEventListener('DOMContentLoaded', () => {
            const backButton = document.getElementById('backButton');
            if (backButton) {
                backButton.addEventListener('click', () => {
                    if (previousPage && window.parent) {
                        console.log('⬅️ Navigating back to:', previousPage);
                        
                        // Send navigation request to parent with back button flag
                        window.parent.postMessage({
                            type: 'navigateToTab',
                            tab: previousPage,
                            isBackNavigation: true  // Flag to indicate this is from back button
                        }, '*');
                        
                        // Hide the back button immediately
                        backButton.classList.remove('visible');
                        backButtonVisible = false;
                        previousPage = null;
                    }
                });
            }
        });
        
        // ==================================================================================
        // COST CHART
        // ==================================================================================
        
        // Cost Chart State
        const costChartState = {
            items: [],
            canvas: null,
            ctx: null,
            currentData: [],
            allSortedData: [],
            viewMode: 'itemClass',
            drillDownStack: [],
            hoveredIndex: -1,
            selectedIndex: -1,
            currentPage: 0,
            showAllItems: false,
            rootLevelPage: 0,
            savedScrollPosition: 0,
            chartType: 'cost-bar', // Current active chart type
            hoveredChartIcon: null, // Track hovered icon
            chartIconPositions: [], // Store icon positions for hit detection
            highlightKey: null, // Key to highlight in the chart
            filterData: null, // Store full filter data for cross-view highlighting
            searchTerm: '', // Current search term
            stockFlowData: null, // Store stock flow data for Sankey chart
            flowMode: (localStorage.getItem('flowMode') || 'location'), // 'location' | 'group' | 'shift'
            pieSlices: [], // Store pie slice data for tooltip hover detection
            hoveredPieSlice: null, // Track hovered pie slice
            absoluteOriginalItems: null, // ABSOLUTE original items - never modified, used as source of truth
            // NEW: Sub-menu metric states
            costBarMetric: 'cost', // 'cost' | 'usage' | 'qty' for cost-bar chart
            inventoryStackMode: 'both', // 'both' | 'pyxis' | 'pharmacy' (used for quantity-on-hand view)
            dateRangeDays: (localStorage.getItem('chartsDateRangeDays') || 'all'), // 'all' | '30' | '60' | '90' (bar views)
            verticalBarView: 'all', // 'all', 'usage', 'restock', 'waste' for bar-chart
            verticalDrillLevel: parseInt(localStorage.getItem('verticalDrillLevel') || '1', 10), // 0=month,1=week,2=day
            verticalDrillContext: JSON.parse(localStorage.getItem('verticalDrillContext') || 'null'), // { monthKey, weekEndISO }
            timeSeriesMetric: 'variance', // 'variance' or 'restock-usage' for time-chart
            usageVsRestockThreshold: (parseFloat(localStorage.getItem('usageRestockThreshold')) || 0.5), // Threshold line for usage vs restock chart (0.2 to 1.0), loads from localStorage
            // NEW: per-view sublocation filter (used by vertical bar usage view)
            itemLocFilter: 'ALL',
            itemSublocFilter: 'ALL',
            itemSublocMap: null,
            itemSublocItemCode: ''
        };

        // Restore last selected chart state (prevents dark-mode toggle from jumping back to defaults)
        try {
            const saved = localStorage.getItem('charts_last_state_v23k');
            if (saved) {
                const st = JSON.parse(saved);
                if (st && typeof st === 'object') {
                    if (st.chartType) costChartState.chartType = st.chartType;
                    if (st.timeSeriesMetric) costChartState.timeSeriesMetric = st.timeSeriesMetric;
                    if (st.costBarMetric) costChartState.costBarMetric = st.costBarMetric;
                    if (st.verticalBarView) costChartState.verticalBarView = st.verticalBarView;
                }
            }
        } catch (e) {
            console.warn('⚠️ Failed to restore chart state', e);
        }


        // ==================================================================================
        // Persist / restore chart state when navigating to Shortage Bulletin and back
        // ==================================================================================
        function snapshotAnalyticsState() {
            try {
                const fromEl = document.getElementById('chartFromDate');
                const toEl = document.getElementById('chartToDate');
                const presetEl = document.getElementById('chartDatePreset');
                const outlookEl = document.getElementById('chartOutlookDays');
                return {
                    v: 1,
                    ts: Date.now(),
                    chartType: costChartState.chartType,
                    viewMode: costChartState.viewMode,
                    drillDownStack: Array.isArray(costChartState.drillDownStack) ? costChartState.drillDownStack : [],
                    highlightKey: costChartState.highlightKey || null,
                    verticalBarView: costChartState.verticalBarView || 'all',
                    verticalDrillLevel: Number.isFinite(costChartState.verticalDrillLevel) ? costChartState.verticalDrillLevel : 1,
                    verticalDrillContext: costChartState.verticalDrillContext || null,
                    timeSeriesMetric: costChartState.timeSeriesMetric || 'variance',
                    costBarMetric: costChartState.costBarMetric || 'cost',
                    inventoryStackMode: costChartState.inventoryStackMode || 'both',
                    dateRange: {
                        fromISO: fromEl ? (fromEl.value || '') : (localStorage.getItem('chartsFromDate') || ''),
                        toISO: toEl ? (toEl.value || '') : (localStorage.getItem('chartsToDate') || ''),
                        preset: presetEl ? (presetEl.value || 'all') : (localStorage.getItem('chartsDatePreset') || 'all')
                    },
                    outlookDays: outlookEl ? (parseInt(outlookEl.value || '0', 10) || 0) : (parseInt(localStorage.getItem('chartsOutlookDays') || '0', 10) || 0)
                };
            } catch (e) {
                return null;
            }
        }

        function persistAnalyticsStateForReturn() {
            try {
                const snap = snapshotAnalyticsState();
                if (!snap) return;
                sessionStorage.setItem('analyticsReturnState', JSON.stringify(snap));
            } catch (e) {}
        }

        function restoreAnalyticsStateIfPresent() {
            try {
                const raw = sessionStorage.getItem('analyticsReturnState');
                if (!raw) return false;
                const snap = JSON.parse(raw);
                if (!snap || !snap.chartType) return false;

                // Restore core state
                costChartState.viewMode = snap.viewMode || costChartState.viewMode;
                costChartState.drillDownStack = Array.isArray(snap.drillDownStack) ? snap.drillDownStack : [];
                costChartState.highlightKey = snap.highlightKey || null;
                costChartState.verticalBarView = snap.verticalBarView || costChartState.verticalBarView;
                costChartState.verticalDrillLevel = Number.isFinite(snap.verticalDrillLevel) ? snap.verticalDrillLevel : costChartState.verticalDrillLevel;
                costChartState.verticalDrillContext = snap.verticalDrillContext || null;
                costChartState.timeSeriesMetric = snap.timeSeriesMetric || costChartState.timeSeriesMetric;
                costChartState.costBarMetric = snap.costBarMetric || costChartState.costBarMetric;
                costChartState.inventoryStackMode = snap.inventoryStackMode || costChartState.inventoryStackMode;

                // Restore date range inputs
                const fromEl = document.getElementById('chartFromDate');
                const toEl = document.getElementById('chartToDate');
                const presetEl = document.getElementById('chartDatePreset');
                const outlookEl = document.getElementById('chartOutlookDays');
                if (fromEl && snap.dateRange) fromEl.value = snap.dateRange.fromISO || '';
                if (toEl && snap.dateRange) toEl.value = snap.dateRange.toISO || '';
                if (presetEl && snap.dateRange) presetEl.value = snap.dateRange.preset || 'all';
                if (outlookEl) outlookEl.value = String(snap.outlookDays || 0);

                try {
                    localStorage.setItem('chartsFromDate', fromEl ? (fromEl.value || '') : (snap.dateRange ? (snap.dateRange.fromISO || '') : ''));
                    localStorage.setItem('chartsToDate', toEl ? (toEl.value || '') : (snap.dateRange ? (snap.dateRange.toISO || '') : ''));
                    localStorage.setItem('chartsDatePreset', presetEl ? (presetEl.value || 'all') : (snap.dateRange ? (snap.dateRange.preset || 'all') : 'all'));
                    localStorage.setItem('chartsOutlookDays', String(snap.outlookDays || 0));
                    localStorage.setItem('verticalDrillLevel', String(costChartState.verticalDrillLevel));
                    localStorage.setItem('verticalDrillContext', JSON.stringify(costChartState.verticalDrillContext || null));
                } catch (e) {}

                // IMPORTANT: Some chart types cache derived datasets (e.g., Flow/Sankey).
                // When the calendar range changes, we must invalidate those caches so the
                // next draw respects the new From/To window.
                try {
                    costChartState.stockFlowData = null;
                } catch (e) {}

                // Invalidate drill bin caches (weekly/day) so the next draw recomputes
                // aggregates for the new range.
                try {
                    if (costChartState._verticalDrillBinCache) {
                        const c = costChartState._verticalDrillBinCache;
                        if (c.dailyAggByRange && c.dailyAggByRange.clear) c.dailyAggByRange.clear();
                        if (c.binsByKey && c.binsByKey.clear) c.binsByKey.clear();
                    }
                } catch (e) {}

                // Invalidate drill bin caches (weekly/day) so the next draw recomputes
                // aggregates for the new range.
                try {
                    if (costChartState._verticalDrillBinCache) {
                        const c = costChartState._verticalDrillBinCache;
                        if (c.dailyAggByRange && c.dailyAggByRange.clear) c.dailyAggByRange.clear();
                        if (c.binsByKey && c.binsByKey.clear) c.binsByKey.clear();
                    }
                } catch (e) {}

                // Sync UI elements if present
                const selector = document.getElementById('costChartViewSelector');
                if (selector && snap.viewMode) selector.value = snap.viewMode;
                const slider = document.getElementById('chartDrillSlider');
                if (slider) slider.value = String(costChartState.verticalDrillLevel);

                // Switch chart last so the correct mode is active
                
                // Prevent list-view from auto-opening shortage bulletin during restore/back.
                costChartState._suppressListViewNav = true;
if (snap.chartType && typeof switchChartType === 'function') {
                    switchChartType(snap.chartType);
                    // Allow list-view navigation again after restore completes.
                    setTimeout(() => { costChartState._suppressListViewNav = false; }, 0);
                } else {
                    scheduleChartsRedraw('restore');
                }

                // Do not clear the state; keep it so repeated back/forward works.
                return true;
            } catch (e) {
                return false;
            }
        }
// ==================================================================================
// Unified redraw scheduler (prevents partial/duplicated redraws on rapid UI changes)
// ==================================================================================
let __chartsRedrawRAF = null;
let __chartsRedrawReason = '';

// Debug logging: very noisy logs must be opt-in.
// Enable by running: window.__CHARTS_DEBUG_VERBOSE = true
function chartsDebugLog() {
    try {
        if (typeof window !== 'undefined' && window.__CHARTS_DEBUG_VERBOSE) {
            // eslint-disable-next-line no-console
            console.log.apply(console, arguments);
        }
    } catch (e) {}
}
function scheduleChartsRedraw(reason = '') {
    __chartsRedrawReason = reason || __chartsRedrawReason;
    if (__chartsRedrawRAF) cancelAnimationFrame(__chartsRedrawRAF);
    __chartsRedrawRAF = requestAnimationFrame(() => {
        __chartsRedrawRAF = null;

        // Avoid drawing while the canvas container is collapsed (height 0) during strip transitions
        try {
            const canvas = costChartState && costChartState.canvas;
            const container = canvas && canvas.parentElement;
            const h = container ? container.clientHeight : 1;
            if (h === 0) {
                // Try again on the next frame once layout settles
                scheduleChartsRedraw(__chartsRedrawReason || 'deferred');
                return;
            }
        } catch (e) {}

        if (!costChartState) return;

        // IMPORTANT: This function must DRAW, not reschedule itself indefinitely.
        if (costChartState.chartType === 'bar-chart') {
            drawVerticalBarChart();
        } else if (costChartState.chartType === 'cost-bar') {
            drawCostChart(null);
        } else if (costChartState.chartType === 'time-series' && typeof drawTimeSeriesChart === 'function') {
            drawTimeSeriesChart();
        } else if (costChartState.chartType === 'line-chart') {
            // Line charts include "Usage vs Restock" and other trend views.
            // Delegate to the current line-chart renderer when present.
            try {
                if (typeof drawUsageVsRestockChart === 'function' && costChartState.lineChartMetric === 'usageVsRestock') {
                    drawUsageVsRestockChart();
                } else if (typeof drawTimeSeriesChart === 'function') {
                    // Fallback: the time-series renderer also draws the trend line charts.
                    drawTimeSeriesChart();
                }
            } catch (e) {
                console.warn('⚠️ Line chart redraw failed', e);
            }
        } else if (costChartState.chartType === 'flow-chart') {
            try {
                const sankeyDiv = document.getElementById('sankeyChart');
                try { if (typeof updateBreadcrumbAndFilterChips === 'function') updateBreadcrumbAndFilterChips(); } catch (e) {}

                const flow = (typeof ensureFlowDataReady === 'function') ? ensureFlowDataReady() : null;
                // Clear first so empty results don't leave stale Sankey visible
                try { if (sankeyDiv) sankeyDiv.innerHTML = ''; } catch (e) {}
                if (flow && typeof drawSankeyChart === 'function' && flow.flows && flow.flows.length) {
                    drawSankeyChart(flow);
                } else {
                    if (sankeyDiv) {
                        sankeyDiv.innerHTML = '<div style="padding:12px; color: var(--text-secondary); font: 13px system-ui;">No flow data for the selected range/filter.</div>';
                    }
                }
            } catch (e) {
                console.warn('⚠️ Flow chart redraw failed', e);
            }
        }

        // Keep chart icon selection highlights in sync across views.
        try { updateFlowIconRangeHighlight(); } catch (e) {}
        try { updateVBarIconSelectionHighlight(); } catch (e) {}
        try { updateCostBarIconSelectionHighlight(); } catch (e) {}
    });
}

// Invalidate flow-chart cache so Sankey always reflects the latest filter/search state.
function invalidateFlowCache() {
    try {
        if (costChartState) {
            costChartState._flowCacheKey = null;
            costChartState.stockFlowData = null;
        }
    } catch (e) {}
}

// Force an authoritative Flow rebuild + redraw.
// Use this when a selection/override changes in a different view and we need to guarantee
// the Sankey can't render an old cached result later (e.g., async google charts callback).
function forceRebuildFlowNow(reason = '') {
    try {
        if (!costChartState) return;
        // Bump a monotonically increasing render token.
        costChartState._flowRenderNonce = (Number(costChartState._flowRenderNonce) || 0) + 1;
        const token = costChartState._flowRenderNonce;

        invalidateFlowCache();

        // If we're not in flow view, just invalidate; the next enter will rebuild.
        if (costChartState.chartType !== 'flow-chart') return;

        // Clear immediately so stale drawings can't remain visible.
        const sankeyDiv = document.getElementById('sankeyChart');
        if (sankeyDiv) sankeyDiv.innerHTML = '';

        const flowData = (typeof ensureFlowDataReady === 'function') ? ensureFlowDataReady(true) : null;
        if (typeof drawSankeyChart === 'function') {
            drawSankeyChart(flowData, token);
        }
    } catch (e) {
        console.warn('⚠️ forceRebuildFlowNow failed', reason, e);
    }
}

// ==================================================================================
// FLOW CHART OVERRIDES (vertical bar day-selection -> flow date range)
// ==================================================================================

function updateFlowIconRangeHighlight() {
    try {
        const icons = document.getElementById('chartTypeIcons');
        if (!icons) return;
        const btn = icons.querySelector('.chart-icon-btn[data-chart-type="flow-chart"], .chart-icon-btn[data-chartType="flow-chart"], .chart-icon-btn[data-charttype="flow-chart"]');
        // Icons are created with dataset.chartType; the DOM attribute becomes data-chart-type
        const flowBtn = btn || icons.querySelector('.chart-icon-btn[data-chart-type="flow-chart"]');
        if (!flowBtn) {
            // Fallback: find by wrapper dataset
            const wrap = icons.querySelector('[data-chart-type="flow-chart"] .chart-icon-btn');
            if (wrap) return;
            return;
        }
        const active = !!(costChartState && costChartState.flowRangeOverride && costChartState.flowRangeOverride.active);
        if (active) {
            // Match the yellow translucent selection vibe from selected bars.
            flowBtn.style.outline = '1px solid rgba(255, 215, 0, 0.55)';
            flowBtn.style.background = 'rgba(255, 215, 0, 0.18)';
            flowBtn.style.boxShadow = '0 0 0 2px rgba(255, 215, 0, 0.12)';
        } else {
            flowBtn.style.outline = '';
            flowBtn.style.background = '';
            flowBtn.style.boxShadow = '';
        }
    } catch (e) {}
}


function updateVBarIconSelectionHighlight() {
    try {
        const icons = document.getElementById('chartTypeIcons');
        if (!icons) return;
        // vertical bar chart uses chartType id 'bar-chart'
        const btn = icons.querySelector('.chart-icon-btn[data-chart-type="bar-chart"], .chart-icon-btn[data-chartType="bar-chart"], .chart-icon-btn[data-charttype="bar-chart"]');
        const vbarBtn = btn || icons.querySelector('.chart-icon-btn[data-chart-type="bar-chart"]');
        if (!vbarBtn) return;

        const hasSelection = !!(costChartState &&
            Number(costChartState.verticalDrillLevel) === 2 &&
            Array.isArray(costChartState.verticalBarSelectedBars) &&
            costChartState.verticalBarSelectedBars.length > 0);

        if (hasSelection) {
            // Match the selected-bar highlight: translucent yellow
            vbarBtn.style.background = 'rgba(255, 215, 0, 0.25)';
            vbarBtn.style.borderColor = 'rgba(255, 215, 0, 0.55)';
            vbarBtn.style.boxShadow = '0 0 0 1px rgba(255, 215, 0, 0.25) inset';
        } else {
            vbarBtn.style.background = '';
            vbarBtn.style.borderColor = '';
            vbarBtn.style.boxShadow = '';
        }
    } catch (e) {}
}

// Highlight the horizontal bar chart icon when a single-item selection is active
// (selection is represented by highlightKey and/or a description-level breadcrumb).
function updateCostBarIconSelectionHighlight() {
    try {
        const icons = document.getElementById('chartTypeIcons');
        if (!icons) return;
        const btn = icons.querySelector('.chart-icon-btn[data-chart-type="cost-bar"], .chart-icon-btn[data-chartType="cost-bar"], .chart-icon-btn[data-charttype="cost-bar"]');
        const costBtn = btn || icons.querySelector('.chart-icon-btn[data-chart-type="cost-bar"]');
        if (!costBtn) return;

        const hasSel = !!(
            costChartState &&
            (costChartState.highlightKey ||
             (Array.isArray(costChartState.drillDownStack) && costChartState.drillDownStack.some(l => l && l.mode === 'description')))
        );

        if (hasSel) {
            costBtn.style.background = 'rgba(255, 215, 0, 0.25)';
            costBtn.style.borderColor = 'rgba(255, 215, 0, 0.55)';
            costBtn.style.boxShadow = '0 0 0 1px rgba(255, 215, 0, 0.25) inset';
        } else {
            costBtn.style.background = '';
            costBtn.style.borderColor = '';
            costBtn.style.boxShadow = '';
        }
    } catch (e) {}
}

function setFlowDateRangeOverride(fromISO, toISO) {
    try {
        if (!costChartState) return;
        if (fromISO && toISO) {
            costChartState.flowRangeOverride = {
                active: true,
                from: String(fromISO).slice(0, 10),
                to: String(toISO).slice(0, 10),
                source: 'vbar-day-selection'
            };
        } else {
            costChartState.flowRangeOverride = { active: false };
        }
        updateFlowIconRangeHighlight();
        // Guaranteed Flow refresh (covers: override changes, view switches, async Sankey draw callbacks)
        forceRebuildFlowNow('setFlowDateRangeOverride');
    } catch (e) {}
}

function clearFlowDateRangeOverride() {
    try {
        if (!costChartState) return;
        if (costChartState.flowRangeOverride && costChartState.flowRangeOverride.active) {
            costChartState.flowRangeOverride = { active: false };
            updateFlowIconRangeHighlight();
            try { updateVBarIconSelectionHighlight(); } catch (e) {}
            // Guaranteed Flow refresh
            forceRebuildFlowNow('clearFlowDateRangeOverride');
        }
    } catch (e) {}
}

function applyFlowOverrideFromVerticalBarSelection() {
    try {
        if (!costChartState) return;
        // Only apply at last drill level (day view)
        if (Number(costChartState.verticalDrillLevel) !== 2) {
            clearFlowDateRangeOverride();
            return;
        }
        const sel = Array.isArray(costChartState.verticalBarSelectedBars) ? costChartState.verticalBarSelectedBars.slice() : [];
        if (!sel.length) {
            clearFlowDateRangeOverride();
            return;
        }
        const bins = Array.isArray(costChartState.verticalBarBins) ? costChartState.verticalBarBins : [];
        const dates = [];
        sel.forEach(idx => {
            const b = bins[idx];
            if (b && b.key) dates.push(String(b.key).slice(0, 10));
        });
        if (!dates.length) {
            clearFlowDateRangeOverride();
            return;
        }
        dates.sort();
        const from = dates[0];
        const to = dates[dates.length - 1];
        setFlowDateRangeOverride(from, to);
    } catch (e) {}
}



        // ==================================================================================
        // PIE CHART ZOOM LEVEL MANAGEMENT
        // ==================================================================================
        // PIE CHART ZOOM LEVELS (3 LEVELS TOTAL)
        // ==================================================================================
        // Level 0 (itemClass): Shows classes (SERUMS, etc.) - 1x zoom
        // Level 1 (drugName): Shows names within class - 2x zoom
        // Level 2 (description): Shows items within name - 4x zoom (final level, selection acts as filter)
        // ==================================================================================
        
        function getPieRadiusForLevel(drillDownLevel, baseRadius) {
            // Fixed zoom multipliers for each drill-down level
            // Level 0 (Class): 1x (normal)
            // Level 1 (Name): 2x (zoomed in)
            // Level 2 (Item): 4x (most zoomed in)
            const zoomMultipliers = [1, 2, 4];
            const level = Math.min(drillDownLevel, zoomMultipliers.length - 1);
            return baseRadius * zoomMultipliers[level];
        }
        
        // ==================================================================================
        // PIE CHART ANIMATION SYSTEM
        // ==================================================================================
        
        // Animation state for pie chart
        const pieAnimation = {
            isAnimating: false,
            progress: 0,
            duration: 900, // Slowed down from 600ms
            startTime: null,
            clickedSlice: null,
            targetData: null,
            sliceLabel: null, // Store label for drill-down
            phase: 'expand', // 'expand', 'slice', 'reverse'
            lastLoggedPhase: null, // For debugging phase transitions
            // Store initial dimensions
            initialBaseRadius: null,
            initialSliverRadius: null,
            initialCenterX: null,
            initialCenterY: null,
            // Store all slivers for drawing non-clicked ones
            allSlivers: null,
            // Store parent slices for reverse animation
            parentSlices: null,
            // Store chart width for positioning
            chartWidth: null,
            // Store target radius for reverse animation
            targetRadius: null
        };
        
        function animatePieDrillDown(clickedSlice, nextViewMode, nextKey, allSlivers) {
            console.log('🎬 Starting pie animation for:', clickedSlice.label);
            console.log('📐 Current slice radius:', clickedSlice.radius);
            console.log('📐 Current center:', clickedSlice.centerX, clickedSlice.centerY);
            
            // Calculate current dimensions from canvas
            const canvas = costChartState.canvas;
            const displayWidth = canvas.width / (window.devicePixelRatio || 1);
            const displayHeight = canvas.height / (window.devicePixelRatio || 1);
            const chartWidth = displayWidth * (2/3);
            
            // Store animation data with current dimensions as starting point
            pieAnimation.clickedSlice = clickedSlice;
            pieAnimation.sliceLabel = clickedSlice.label;
            pieAnimation.allSlivers = allSlivers; // Store all current slivers
            pieAnimation.isAnimating = true;
            pieAnimation.progress = 0;
            pieAnimation.startTime = null;
            pieAnimation.phase = 'expand';
            pieAnimation.lastLoggedPhase = null; // Reset for new animation
            
            // Use ACTUAL current dimensions from the clicked slice (not recalculated)
            pieAnimation.initialSliverRadius = clickedSlice.radius;
            pieAnimation.initialBaseRadius = clickedSlice.radius * 0.93;
            pieAnimation.initialCenterX = clickedSlice.centerX;
            pieAnimation.initialCenterY = clickedSlice.centerY;
            pieAnimation.chartWidth = chartWidth; // Store for positioning calculations
            
            // Validate initial values
            if (!isFinite(pieAnimation.initialSliverRadius) || pieAnimation.initialSliverRadius <= 0) {
                console.error('❌ Invalid initial radius:', pieAnimation.initialSliverRadius);
                pieAnimation.isAnimating = false;
                return;
            }
            
            console.log('📏 Animation setup:');
            console.log('  Current level:', costChartState.drillDownStack.length);
            console.log('  Initial radius:', pieAnimation.initialSliverRadius);
            console.log('  Initial center:', pieAnimation.initialCenterX, pieAnimation.initialCenterY);
            
            // Calculate what the next level data will be
            const itemsForTotal = window.originalItems || costChartState.items;
            let filteredItems = itemsForTotal;
            
            // Apply existing drill-down filters
            if (costChartState.drillDownStack) {
                costChartState.drillDownStack.forEach(level => {
                    if (level.mode === 'itemClass') {
                        filteredItems = filteredItems.filter(item => (item.itemClass || 'Unknown') === level.key);
                    } else if (level.mode === 'drugName') {
                        filteredItems = filteredItems.filter(item => (item.drugName || 'Unknown') === level.key);
                    } else if (level.mode === 'description') {
                        filteredItems = filteredItems.filter(item => (item.description || 'Unknown') === level.key);
                    }
                });
            }
            
            // Apply the clicked filter
            if (costChartState.viewMode === 'itemClass') {
                filteredItems = filteredItems.filter(item => (item.itemClass || 'Unknown') === clickedSlice.label);
            } else if (costChartState.viewMode === 'drugName') {
                filteredItems = filteredItems.filter(item => (item.drugName || 'Unknown') === clickedSlice.label);
            }
            
            // Group by next view mode
            const grouped = {};
            filteredItems.forEach(item => {
                let key;
                if (nextViewMode === 'drugName') {
                    key = item.drugName || 'Unknown';
                } else if (nextViewMode === 'description') {
                    key = item.description || 'Unknown';
                } else {
                    key = item.itemClass || 'Unknown';
                }
                
                if (!grouped[key]) grouped[key] = 0;
                // Use wasteValue if available, otherwise calculate inventory cost
                const itemCost = item.wasteValue !== undefined 
                    ? item.wasteValue 
                    : (item.quantity || 0) * parseFloat(item.unitPrice || 0);
                grouped[key] += itemCost;
            });
            
            // Convert to slivers array
            pieAnimation.targetData = Object.entries(grouped)
                .map(([key, cost]) => ({ key, cost }))
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 10);
            
            console.log('🎯 Target slivers:', pieAnimation.targetData.length);
            console.log('📐 Initial dimensions - Base:', pieAnimation.initialBaseRadius, 'Sliver:', pieAnimation.initialSliverRadius);
            console.log('⏰ Animation duration:', pieAnimation.duration, 'ms');
            console.log('🚀 Calling requestAnimationFrame to start animation loop...');
            
            // Start animation loop
            requestAnimationFrame(animatePieFrame);
        }
        
        function animatePieFrame(timestamp) {
            if (!pieAnimation.isAnimating) {
                console.log('⚠️ Animation stopped - isAnimating is false');
                return;
            }
            
            if (!pieAnimation.startTime) {
                pieAnimation.startTime = timestamp;
                console.log('⏱️ Animation start time set:', timestamp);
            }
            
            const elapsed = timestamp - pieAnimation.startTime;
            pieAnimation.progress = Math.min(elapsed / pieAnimation.duration, 1);
            
            console.log(`⏳ Frame: elapsed=${elapsed.toFixed(0)}ms, progress=${pieAnimation.progress.toFixed(3)}, duration=${pieAnimation.duration}ms`);
            
            // Easing function (ease-in-out)
            const eased = pieAnimation.progress < 0.5
                ? 2 * pieAnimation.progress * pieAnimation.progress
                : 1 - Math.pow(-2 * pieAnimation.progress + 2, 2) / 2;
            
            // Draw the animation frame
            drawPieChartAnimated(eased);
            
            // Continue or finish
            if (pieAnimation.progress < 1) {
                requestAnimationFrame(animatePieFrame);
            } else {
                console.log('🏁 Animation reached end (progress = 1)');
                // Animation complete - finish the drill-down
                finishPieDrillDown();
            }
        }
        
        function finishPieDrillDown() {
            console.log('✅ Animation complete, finishing drill-down');
            
            const labelToDrill = pieAnimation.sliceLabel;
            const currentMode = costChartState.viewMode;
            const slice = pieAnimation.clickedSlice;
            
            // Don't store radius here - let drawPieChart calculate it based on drill-down level
            // This ensures zoom always matches the drill-down state
            
            // Determine next mode
            let nextMode;
            if (currentMode === 'itemClass') {
                nextMode = 'drugName';
            } else if (currentMode === 'drugName') {
                nextMode = 'description';
            } else if (currentMode === 'formulary') {
                nextMode = 'description';
            }
            
            // Update drill-down state WITHOUT redrawing (to preserve animation result)
            if (nextMode && labelToDrill) {
                const currentPage = costChartState.currentPage;
                
                if (costChartState.drillDownStack.length === 0) {
                    costChartState.rootLevelPage = currentPage;
                }
                
                costChartState.drillDownStack.push({
                    mode: currentMode,
                    key: labelToDrill,
                    scrollPosition: 0,
                    page: currentPage,
                    selectedKey: labelToDrill
                });
                
                costChartState.viewMode = nextMode;
                costChartState.currentPage = 0;
                costChartState.selectedIndex = -1;
                costChartState.highlightKey = null;
                // Don't clear filterData - preserve it so filter chip label is maintained
                // costChartState.filterData = null;
                
                // Update dropdown
                const selector = document.getElementById('costChartViewSelector');
                if (selector) {
                    selector.value = nextMode;
                    console.log('✓ Dropdown updated to:', nextMode);
                }
                
                // Update breadcrumb navigation
                // Sum up the costs of items (will use wasteValue if present)
                const baseItems = costChartState.items;
                const totalCost = baseItems.reduce((sum, item) => {
                    // Use wasteValue if available, otherwise calculate inventory cost
                    const itemCost = item.wasteValue !== undefined 
                        ? item.wasteValue 
                        : ((item.quantity || 0) * parseFloat(item.unitPrice || 0));
                    return sum + itemCost;
                }, 0);
                updateBreadcrumb(totalCost);
                
                // Update bar chart
                if (costChartState.chartType === 'cost-bar') {
                    drawCostChart(labelToDrill);
                }
                
                // Redraw pie chart
                drawPieChart();
            }
            
            // Clear animation state
            pieAnimation.isAnimating = false;
            pieAnimation.clickedSlice = null;
            pieAnimation.targetData = null;
            pieAnimation.sliceLabel = null;
            pieAnimation.allSlivers = null;
        }
        
        // ==================================================================================
        // PIE CHART REVERSE ANIMATION (GO BACK)
        // ==================================================================================
        
        function animatePieGoBack() {
            console.log('🔄 Starting reverse animation to go back');
            
            if (costChartState.drillDownStack.length === 0) {
                console.log('⚠️ Already at root - cannot go back');
                return;
            }
            
            const canvas = costChartState.canvas;
            const displayWidth = canvas.width / (window.devicePixelRatio || 1);
            const displayHeight = canvas.height / (window.devicePixelRatio || 1);
            const chartWidth = displayWidth * (2/3);
            
            // Store current state for reverse animation
            const currentLevel = costChartState.drillDownStack.length;
            const targetLevel = currentLevel - 1; // Going back one level
            
            // Get current pie slices (these will shrink and fade out)
            const currentSlices = costChartState.pieSlices.slice();
            
            // Calculate parent level slices (these will fade in during phase 2)
            // We need to regenerate what the parent view looks like
            const itemsForTotal = window.originalItems || costChartState.items;
            
            // Filter items based on drill-down stack (excluding last level)
            let filteredItems = itemsForTotal;
            for (let i = 0; i < costChartState.drillDownStack.length - 1; i++) {
                const level = costChartState.drillDownStack[i];
                if (level.mode === 'itemClass') {
                    filteredItems = filteredItems.filter(item => (item.itemClass || 'Unknown') === level.key);
                } else if (level.mode === 'drugName') {
                    filteredItems = filteredItems.filter(item => (item.drugName || 'Unknown') === level.key);
                }
            }
            
            // Group by parent mode
            const parentMode = costChartState.drillDownStack[costChartState.drillDownStack.length - 1].mode;
            const grouped = {};
            filteredItems.forEach(item => {
                let key;
                if (parentMode === 'itemClass') {
                    key = item.itemClass || 'Unknown';
                } else if (parentMode === 'drugName') {
                    key = item.drugName || 'Unknown';
                }
                if (!grouped[key]) grouped[key] = 0;
                // Use wasteValue if available, otherwise calculate inventory cost
                const itemCost = item.wasteValue !== undefined 
                    ? item.wasteValue 
                    : (item.quantity || 0) * parseFloat(item.unitPrice || 0);
                grouped[key] += itemCost;
            });
            
            // Convert to parent slices array with colors
            const totalCost = Object.values(grouped).reduce((sum, cost) => sum + cost, 0);
            const parentData = Object.entries(grouped)
                .map(([key, cost]) => ({ 
                    key, 
                    cost,
                    percentage: (cost / totalCost) * 100
                }))
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 10);
            
            // Calculate colors for parent slices
            const tealPrimary = getComputedStyle(document.body).getPropertyValue('--teal-primary').trim();
            const tealRGB = hexToRgb(tealPrimary);
            const maxPercentage = parentData[0]?.percentage || 100;
            const minPercentage = parentData[parentData.length - 1]?.percentage || 0;
            
            const parentSlices = [];
            const totalAngle = parentData.reduce((sum, s) => sum + Math.max((s.cost / totalCost) * 2 * Math.PI, Math.PI / 180), 0);
            let currentAngle = -totalAngle / 2;
            
            parentData.forEach((item, index) => {
                const normalizedValue = (item.percentage - minPercentage) / (maxPercentage - minPercentage);
                const alpha = 0.5 + (normalizedValue * 0.5);
                const color = `rgba(${tealRGB.r}, ${tealRGB.g}, ${tealRGB.b}, ${alpha})`;
                
                const angle = Math.max((item.cost / totalCost) * 2 * Math.PI, Math.PI / 180);
                const endAngle = currentAngle + angle;
                
                parentSlices.push({
                    startAngle: currentAngle,
                    endAngle: endAngle,
                    color: color,
                    label: item.key,
                    isWholePie: false
                });
                
                currentAngle = endAngle;
            });
            
            // Find base radius (unscaled)
            const baseRadiusCalc = currentSlices[0]?.baseRadius || 250;
            
            // Calculate dimensions
            const currentRadius = getPieRadiusForLevel(currentLevel, baseRadiusCalc);
            const targetRadius = getPieRadiusForLevel(targetLevel, baseRadiusCalc);
            
            const currentCenterX = chartWidth - currentRadius;
            const currentCenterY = displayHeight / 2;
            
            // Set up reverse animation
            pieAnimation.isAnimating = true;
            pieAnimation.progress = 0;
            pieAnimation.startTime = null;
            pieAnimation.phase = 'reverse';
            pieAnimation.lastLoggedPhase = null; // Reset for new animation
            pieAnimation.allSlivers = currentSlices; // Current slices (will fade out)
            pieAnimation.parentSlices = parentSlices; // Parent slices (will fade in)
            pieAnimation.initialSliverRadius = currentRadius;
            pieAnimation.initialBaseRadius = currentRadius * 0.93;
            pieAnimation.initialCenterX = currentCenterX;
            pieAnimation.initialCenterY = currentCenterY;
            pieAnimation.targetRadius = targetRadius;
            pieAnimation.chartWidth = chartWidth;
            
            // Start animation
            requestAnimationFrame(animatePieGoBackFrame);
        }
        
        function animatePieGoBackFrame(timestamp) {
            if (!pieAnimation.startTime) pieAnimation.startTime = timestamp;
            const elapsed = timestamp - pieAnimation.startTime;
            pieAnimation.progress = Math.min(elapsed / pieAnimation.duration, 1);
            
            // Easing
            const t = pieAnimation.progress;
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            
            // Draw reverse animation
            drawPieChartReverseAnimation(eased);
            
            // Continue or finish
            if (pieAnimation.progress < 1) {
                requestAnimationFrame(animatePieGoBackFrame);
            } else {
                finishPieGoBack();
            }
        }
        
        function drawPieChartReverseAnimation(progress) {
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            if (!canvas || !ctx) return;
            
            const displayWidth = canvas.width / (window.devicePixelRatio || 1);
            const displayHeight = canvas.height / (window.devicePixelRatio || 1);
            const chartWidth = pieAnimation.chartWidth;
            
            // Clear canvas
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            const tealPrimary = getComputedStyle(document.body).getPropertyValue('--teal-primary').trim();
            
            const initialRadius = pieAnimation.initialSliverRadius;
            const targetRadius = pieAnimation.targetRadius;
            const initialCenterX = pieAnimation.initialCenterX;
            const initialCenterY = pieAnimation.initialCenterY;
            const targetCenterX = chartWidth - targetRadius;
            
            // Three-phase reverse animation (reverse of forward):
            // Phase 1 (0-33%): Rotate sub-slices from center to parent position (stay zoomed)
            // Phase 2 (33-66%): Fade in parent slices
            // Phase 3 (66-100%): Fade out sub-slices + zoom out
            
            const phase1End = 0.33;
            const phase2End = 0.66;
            
            let phase = 1;
            let phaseProgress = 0;
            
            if (progress <= phase1End) {
                phase = 1;
                phaseProgress = progress / phase1End;
            } else if (progress <= phase2End) {
                phase = 2;
                phaseProgress = (progress - phase1End) / (phase2End - phase1End);
            } else {
                phase = 3;
                phaseProgress = (progress - phase2End) / (1 - phase2End);
            }
            
            // Log phase transitions
            if (phase !== pieAnimation.lastLoggedPhase) {
                console.log(`🔙 Reverse Phase ${phase}/3`);
                pieAnimation.lastLoggedPhase = phase;
            }
            
            // Calculate current dimensions
            let currentRadius, currentCenterX, siblingOpacity, subSliceOpacity;
            
            if (phase < 3) {
                // Phases 1-2: Stay at current (zoomed) size
                currentRadius = initialRadius;
                currentCenterX = initialCenterX;
                
                if (phase === 1) {
                    siblingOpacity = 0;
                    subSliceOpacity = 1.0;
                } else {
                    // Phase 2: Fade in parent
                    siblingOpacity = phaseProgress; // 0 → 1
                    subSliceOpacity = 1.0;
                }
            } else {
                // Phase 3: Fade out sub-slices + zoom out
                currentRadius = initialRadius - (initialRadius - targetRadius) * phaseProgress;
                currentCenterX = initialCenterX + (targetCenterX - initialCenterX) * phaseProgress;
                siblingOpacity = 1.0;
                subSliceOpacity = 1.0 - phaseProgress; // 1 → 0
            }
            
            const currentBaseRadius = currentRadius * 0.93;
            const currentCenterY = initialCenterY;
            
            // Draw base pie
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = tealPrimary;
            ctx.beginPath();
            ctx.arc(currentCenterX, currentCenterY, currentBaseRadius, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = isDarkMode ? '#666666' : '#333333';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            
            // Draw sibling slices (fading in during phase 2 - these are PARENT slices)
            if (siblingOpacity > 0 && pieAnimation.parentSlices) {
                ctx.save();
                ctx.globalAlpha = siblingOpacity;
                
                pieAnimation.parentSlices.forEach(s => {
                    ctx.shadowColor = s.color || 'rgba(0, 0, 0, 0.3)';
                    ctx.shadowBlur = 5;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    
                    ctx.fillStyle = s.color || tealPrimary;
                    ctx.beginPath();
                    ctx.moveTo(currentCenterX, currentCenterY);
                    ctx.arc(currentCenterX, currentCenterY, currentRadius, s.startAngle, s.endAngle);
                    ctx.closePath();
                    ctx.fill();
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = isDarkMode ? '#555555' : '#666666';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                });
                
                ctx.restore();
            }
            
            // Draw current slivers (rotating/compressing in phase 1, fading out in phase 3)
            if (subSliceOpacity > 0 && pieAnimation.allSlivers) {
                const currentSlicesNoWhole = pieAnimation.allSlivers.filter(s => !s.isWholePie);
                if (currentSlicesNoWhole.length === 0) return;
                
                const totalCurrentAngle = currentSlicesNoWhole.reduce((sum, s) => {
                    return sum + (s.endAngle - s.startAngle);
                }, 0);
                
                // Find parent slice to superimpose on
                const lastDrillDown = costChartState.drillDownStack[costChartState.drillDownStack.length - 1];
                const parentKey = lastDrillDown ? lastDrillDown.key : null;
                
                let targetSlice = null;
                if (pieAnimation.parentSlices && parentKey) {
                    targetSlice = pieAnimation.parentSlices.find(s => s.label === parentKey);
                }
                if (!targetSlice && pieAnimation.parentSlices && pieAnimation.parentSlices.length > 0) {
                    targetSlice = pieAnimation.parentSlices[0];
                }
                if (!targetSlice) {
                    targetSlice = { startAngle: -Math.PI / 4, endAngle: Math.PI / 4 };
                }
                
                const targetSliceAngle = targetSlice.endAngle - targetSlice.startAngle;
                
                ctx.save();
                ctx.globalAlpha = subSliceOpacity;
                
                // Phase-based positioning:
                // Phase 1: Rotate + compress from centered to parent position (superimposed)
                // Phases 2-3: Stay superimposed on parent
                let angleScale, angleOffset;
                
                if (phase === 1) {
                    // Phase 1: Rotate from centered to parent + compress
                    const startAngleScale = 1.0;
                    const endAngleScale = targetSliceAngle / totalCurrentAngle;
                    angleScale = startAngleScale + (endAngleScale - startAngleScale) * phaseProgress;
                    
                    const startOffset = -totalCurrentAngle * angleScale / 2; // Centered (adjusting for scale)
                    const endOffset = targetSlice.startAngle; // Parent slice start
                    angleOffset = startOffset + (endOffset - startOffset) * phaseProgress;
                } else {
                    // Phases 2-3: Stay superimposed on parent
                    angleScale = targetSliceAngle / totalCurrentAngle;
                    angleOffset = targetSlice.startAngle;
                }
                
                let cumulativeAngle = 0;
                
                currentSlicesNoWhole.forEach(s => {
                    const originalAngle = s.endAngle - s.startAngle;
                    const scaledAngle = originalAngle * angleScale;
                    const actualStart = angleOffset + cumulativeAngle;
                    const actualEnd = angleOffset + cumulativeAngle + scaledAngle;
                    
                    ctx.shadowColor = s.color || 'rgba(0, 0, 0, 0.3)';
                    ctx.shadowBlur = 5;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    
                    ctx.fillStyle = s.color || tealPrimary;
                    ctx.beginPath();
                    ctx.moveTo(currentCenterX, currentCenterY);
                    ctx.arc(currentCenterX, currentCenterY, currentRadius, actualStart, actualEnd);
                    ctx.closePath();
                    ctx.fill();
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = isDarkMode ? '#555555' : '#666666';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    
                    cumulativeAngle += scaledAngle;
                });
                
                ctx.restore();
            }
        }
        
        function finishPieGoBack() {
            console.log('✅ Reverse animation complete');
            
            // Clear animation state
            pieAnimation.isAnimating = false;
            pieAnimation.clickedSlice = null;
            pieAnimation.targetData = null;
            pieAnimation.sliceLabel = null;
            pieAnimation.allSlivers = null;
            pieAnimation.phase = 'expand';
            
            // Now actually go back
            handleBackButtonClick();
        }
        
        function drawPieChartAnimated(progress) {
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            if (!canvas || !ctx) return;
            
            const displayWidth = canvas.width / (window.devicePixelRatio || 1);
            const displayHeight = canvas.height / (window.devicePixelRatio || 1);
            
            // Clear canvas
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            const tealPrimary = getComputedStyle(document.body).getPropertyValue('--teal-primary').trim();
            
            // Get initial dimensions from animation state
            const chartWidth = pieAnimation.chartWidth || (displayWidth * (2/3));
            const initialSliverRadius = pieAnimation.initialSliverRadius;
            const initialBaseRadius = pieAnimation.initialBaseRadius;
            const initialCenterX = pieAnimation.initialCenterX;
            const initialCenterY = pieAnimation.initialCenterY;
            
            // Animate the clicked slice
            const slice = pieAnimation.clickedSlice;
            if (!slice || slice.isWholePie) return;
            
            // Three-phase animation for perfect superimposition:
            // Phase 1 (0-33%): Fade in new sub-slices EXACTLY superimposed on clicked slice
            // Phase 2 (33-66%): Fade out old layer (siblings)
            // Phase 3 (66-100%): Rotate to center + zoom to final size
            
            const phase1End = 0.33;
            const phase2End = 0.66;
            
            let phase = 1;
            let phaseProgress = 0;
            
            if (progress <= phase1End) {
                phase = 1;
                phaseProgress = progress / phase1End;
            } else if (progress <= phase2End) {
                phase = 2;
                phaseProgress = (progress - phase1End) / (phase2End - phase1End);
            } else {
                phase = 3;
                phaseProgress = (progress - phase2End) / (1 - phase2End);
            }
            
            // Log phase transitions
            if (phase !== pieAnimation.lastLoggedPhase) {
                console.log(`📍 Animation Phase ${phase}/3`);
                pieAnimation.lastLoggedPhase = phase;
            }
            
            // Calculate dimensions
            const baseRadius = slice.baseRadius || initialSliverRadius;
            const currentLevel = costChartState.drillDownStack.length;
            const targetLevel = currentLevel + 1;
            const targetRadius = getPieRadiusForLevel(targetLevel, baseRadius);
            
            let currentRadius, currentBaseRadius, currentCenterX, currentCenterY;
            
            if (phase < 3) {
                // Phases 1-2: Stay at initial position/size (no changes yet)
                currentRadius = initialSliverRadius;
                currentBaseRadius = initialBaseRadius;
                currentCenterX = initialCenterX;
                currentCenterY = initialCenterY;
            } else {
                // Phase 3: Zoom and reposition
                const targetCenterX = chartWidth - targetRadius;
                currentRadius = initialSliverRadius + (targetRadius - initialSliverRadius) * phaseProgress;
                currentBaseRadius = initialBaseRadius + ((targetRadius * 0.93) - initialBaseRadius) * phaseProgress;
                currentCenterX = initialCenterX + (targetCenterX - initialCenterX) * phaseProgress;
                currentCenterY = initialCenterY;
            }
            
            // Clicked slice angles
            const clickedSliceStart = slice.startAngle;
            const clickedSliceEnd = slice.endAngle;
            const sliceAngle = clickedSliceEnd - clickedSliceStart;
            
            // Calculate fade levels based on phase
            let siblingOpacity, subSliceOpacity;
            
            if (phase === 1) {
                // Phase 1: Fade in sub-slices (0→1), siblings stay visible (1)
                siblingOpacity = 1.0;
                subSliceOpacity = phaseProgress;
            } else if (phase === 2) {
                // Phase 2: Fade out siblings (1→0), sub-slices stay visible (1)
                siblingOpacity = 1.0 - phaseProgress;
                subSliceOpacity = 1.0;
            } else {
                // Phase 3: Siblings gone, sub-slices visible, rotating
                siblingOpacity = 0;
                subSliceOpacity = 1.0;
            }
                
            // Draw animated base pie
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = tealPrimary;
            ctx.beginPath();
            ctx.arc(currentCenterX, currentCenterY, currentBaseRadius, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = isDarkMode ? '#666666' : '#333333';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            
            // Draw sibling slices (fading based on phase)
            if (siblingOpacity > 0 && pieAnimation.allSlivers) {
                ctx.save();
                // Don't use globalAlpha - it makes dark colors look washed out
                // Instead, blend colors toward white for fade effect
                
                pieAnimation.allSlivers.forEach((s, idx) => {
                    if (s.isWholePie || s === slice) return;
                    
                    // Parse the stored color and blend it toward white based on fade
                    let fillColor = s.color || tealPrimary;
                    
                    if (siblingOpacity < 1.0) {
                        // Extract RGB from the color
                        const match = fillColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                        if (match) {
                            const r = parseInt(match[1]);
                            const g = parseInt(match[2]);
                            const b = parseInt(match[3]);
                            
                            // Blend toward white (255, 255, 255)
                            const fadeAmount = 1 - siblingOpacity; // 0 = no fade, 1 = full white
                            const newR = Math.round(r + (255 - r) * fadeAmount);
                            const newG = Math.round(g + (255 - g) * fadeAmount);
                            const newB = Math.round(b + (255 - b) * fadeAmount);
                            
                            fillColor = `rgba(${newR}, ${newG}, ${newB}, 1.0)`;
                        }
                    }
                    
                    // Use each slice's own stored properties
                    ctx.shadowColor = fillColor;
                    ctx.shadowBlur = 5;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    
                    ctx.fillStyle = fillColor;
                    ctx.beginPath();
                    ctx.moveTo(s.centerX, s.centerY);
                    // Draw at original position and size (no changes)
                    ctx.arc(s.centerX, s.centerY, s.radius, s.startAngle, s.endAngle);
                    ctx.closePath();
                    ctx.fill();
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = isDarkMode ? '#555555' : '#666666';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                });
                
                ctx.restore();
            }
            
            // Draw clicked slice background (phases 1-2 only, hidden in phase 3)
            if (phase < 3) {
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = 15;
                ctx.shadowOffsetX = 3;
                ctx.shadowOffsetY = 3;
                
                // Use the stored color from the clicked slice
                ctx.fillStyle = slice.color || tealPrimary;
                ctx.beginPath();
                ctx.moveTo(currentCenterX, currentCenterY);
                ctx.arc(currentCenterX, currentCenterY, currentRadius, clickedSliceStart, clickedSliceEnd);
                ctx.closePath();
                ctx.fill();
                
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.strokeStyle = isDarkMode ? '#555555' : '#666666';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }
            
            // Draw sub-slices (fading and expanding based on phase)
            const subSliceAlpha = subSliceOpacity;
                
            // Draw sub-slices
            if (subSliceAlpha > 0 && pieAnimation.targetData && pieAnimation.targetData.length > 0) {
                const totalInventoryCost = (window.originalItems || costChartState.items).reduce((sum, item) => {
                    // Use wasteValue if available, otherwise calculate inventory cost
                    const itemCost = item.wasteValue !== undefined 
                        ? item.wasteValue 
                        : ((item.quantity || 0) * parseFloat(item.unitPrice || 0));
                    return sum + itemCost;
                }, 0);
                
                const minAngle = (1 * Math.PI) / 180;
                
                // Calculate final angles for sub-slices
                const subSliverAngles = pieAnimation.targetData.map(s => {
                    let angle = (s.cost / totalInventoryCost) * 2 * Math.PI;
                    if (angle < minAngle) angle = minAngle;
                    return { ...s, angle };
                });
                
                const totalSubAngle = subSliverAngles.reduce((sum, s) => sum + s.angle, 0);
                const subRadius = currentRadius * 0.9;
                
                const tealRGB = hexToRgb(tealPrimary);
                const maxPercentage = (pieAnimation.targetData[0].cost / totalInventoryCost) * 100;
                const minPercentage = (pieAnimation.targetData[pieAnimation.targetData.length - 1].cost / totalInventoryCost) * 100;
                
                ctx.save();
                ctx.globalAlpha = subSliceAlpha;
                
                // Phase-based positioning:
                // Phases 1-2: Sub-slices EXACTLY superimposed on clicked slice
                //             (scaled to fit within clicked slice angle)
                // Phase 3: Rotate to centered position
                
                let angleScale, angleOffset;
                
                if (phase < 3) {
                    // Phases 1-2: Perfectly superimposed on clicked slice
                    // Scale sub-slices to fit EXACTLY within the clicked slice's angular range
                    angleScale = sliceAngle / totalSubAngle;
                    angleOffset = clickedSliceStart; // Start exactly at clicked slice start
                } else {
                    // Phase 3: Rotate from clicked position to centered + expand
                    // Calculate how much we need to rotate to center the midpoint
                    const originalMidpoint = (clickedSliceStart + clickedSliceEnd) / 2;
                    const rotationNeeded = -originalMidpoint; // Negative because we want to move it to 0
                    
                    // Scale from compressed (fitting in clicked slice) to full size (natural size)
                    const compressedScale = sliceAngle / totalSubAngle;
                    angleScale = compressedScale + (1.0 - compressedScale) * phaseProgress;
                    
                    // Start offset: where clicked slice starts
                    // End offset: centered at 0 (which means -half of total angle after scaling)
                    const startOffset = clickedSliceStart;
                    const endOffset = -totalSubAngle * angleScale / 2;
                    
                    // Simply interpolate from start to end (rotation is built into this)
                    angleOffset = startOffset + (endOffset - startOffset) * phaseProgress;
                }
                
                let subCurrentAngle = 0;
                
                pieAnimation.targetData.forEach((subSliver, index) => {
                    const subAngle = subSliverAngles[index].angle * angleScale;
                    const actualStart = angleOffset + subCurrentAngle;
                    const actualEnd = angleOffset + subCurrentAngle + subAngle;
                    
                    const percentage = (subSliver.cost / totalInventoryCost) * 100;
                    const normalizedValue = (percentage - minPercentage) / (maxPercentage - minPercentage);
                    // Use brightness variation (0.5 to 1.0) instead of alpha
                    const brightness = 0.5 + (normalizedValue * 0.5);
                    const color = `rgba(${Math.round(tealRGB.r * brightness)}, ${Math.round(tealRGB.g * brightness)}, ${Math.round(tealRGB.b * brightness)}, 1.0)`;
                    
                    ctx.fillStyle = color;
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 5;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    
                    ctx.beginPath();
                    ctx.moveTo(currentCenterX, currentCenterY);
                    ctx.arc(currentCenterX, currentCenterY, subRadius, actualStart, actualEnd);
                    ctx.closePath();
                    ctx.fill();
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = isDarkMode ? '#555555' : '#666666';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    
                    subCurrentAngle += subAngle;
                });
                
                ctx.restore();
            }
        }

        // ==================================================================================
        // DATA REQUEST FROM PARENT DASHBOARD
        // ==================================================================================
        let cachedMockData = null;
        let dataRequestCallbacks = [];

        // Ensure monthly transaction scripts for a date range are loaded in the parent dashboard.
        // IMPORTANT: this must be idempotent (charts redraws can call this repeatedly).
        const __ensureTxRangePending = {}; // reqId -> {resolve,reject,ts,key}
        const __ensureTxRangeByKey = {};   // key -> Promise
        function ensureTxRangeFromParent(fromISO, toISO) {
            try {
                if (!fromISO || !toISO) return Promise.resolve({ loaded: true, count: 0 });
                const key = String(fromISO) + '|' + String(toISO);
                if (__ensureTxRangeByKey[key]) return __ensureTxRangeByKey[key];

                __ensureTxRangeByKey[key] = new Promise((resolve, reject) => {
                    try {
                        const reqId = 'txr_' + Math.random().toString(36).slice(2) + '_' + Date.now();
                        __ensureTxRangePending[reqId] = { resolve, reject, ts: Date.now(), key };
                        // Charts runs in an iframe (Dashboard_Tabbed.html) so parent is the dashboard.
                        window.parent && window.parent.postMessage({ type: 'ensureTxRange', fromISO, toISO, reqId }, '*');
                        // Safety timeout
                        setTimeout(() => {
                            if (__ensureTxRangePending[reqId]) {
                                const k = __ensureTxRangePending[reqId].key;
                                delete __ensureTxRangePending[reqId];
                                if (k && __ensureTxRangeByKey[k]) delete __ensureTxRangeByKey[k];
                                reject(new Error('ensureTxRange timeout'));
                            }
                        }, 20000);
                    } catch (e) {
                        if (__ensureTxRangeByKey[key]) delete __ensureTxRangeByKey[key];
                        reject(e);
                    }
                });

                return __ensureTxRangeByKey[key];
            } catch (e) {
                return Promise.reject(e);
            }
        }


        function hasUsableTransactions(md) {
            if (!md || !md.transactions) return false;
            const t = md.transactions;
            if (Array.isArray(t)) return t.length > 0;
            if (typeof t === 'object') return Object.keys(t).length > 0;
            return false;
        }

        
        function requestMockDataFromParent() {
            return new Promise((resolve, reject) => {
                // If we already have non-empty computed items AND usable transactions, reuse it.
                // Bar-chart Option B needs raw transactions; if cachedMockData has items but missing/empty transactions,
                // we must re-request from parent so we can attach raw merged monthly data.
                const _hasUsableTx = (md) => {
                    const t = md && md.transactions;
                    if (!t) return false;
                    if (Array.isArray(t)) return t.length > 0;
                    if (typeof t === 'object') {
                        // count only keys that look like item buckets
                        return Object.keys(t).length > 0;
                    }
                    return false;
                };
                if (cachedMockData && cachedMockData.items && cachedMockData.items.length > 0 && _hasUsableTx(cachedMockData)) {
                    resolve(cachedMockData);
                    return;
                }

                const startedAt = Date.now();
                const TIMEOUT_MS = 12000;
                const RETRY_MS = 300;

                const tryRequest = () => {
                    // Prefer shared helper (supports {raw, computed} payload)
                    if (window.InventoryApp && window.InventoryApp.postMessage && window.InventoryApp.postMessage.requestMockData) {
                        // Prefer {computed, raw} so the Charts page can recompute range-aware series
                        // directly from raw transactions (avoids stale/partial computed artifacts).
                        window.InventoryApp.postMessage.requestMockData(({ computed, raw }) => {
                            const payload = computed || { lastUpdated: new Date().toISOString().split('T')[0], items: [] };

                            // Attach raw transactions so vertical charts can reflect newly added month files (e.g., 2026_01).
                            // We keep computed as the primary shape (items, projected waste, etc.).
	                            // IMPORTANT: computed payload may include an empty `transactions` object.
	                            // In that case we MUST override with the merged raw monthly transactions.
	                            const hasTx = payload.transactions && (typeof payload.transactions === 'object') && (Object.keys(payload.transactions).length > 0);
	                            if (raw && raw.transactions && (!payload.transactions || !hasTx)) {
	                                payload.transactions = raw.transactions;
	                            }

                            // If empty, retry until timeout (do NOT cache empties).
                            if (!payload.items || payload.items.length === 0) {
                                if (Date.now() - startedAt >= TIMEOUT_MS) {
                                    console.warn('⚠️ Charts: Mock data still empty after timeout; rendering empty state.');
                                    cachedMockData = payload; // cache last known (empty) so UI can show empty state
                                    // Keep a reference on state for renderers that read from costChartState.
                                    // NOTE: The InventoryApp.postMessage.requestMockData callback path does not
                                    // trigger the window 'mockDataResponse' handler, so we must set this here.
                                    costChartState.cachedMockData = cachedMockData;
                                    // Invalidate tx aggregation caches when the dataset changes.
                                    costChartState.__txDailyAggBuilt = false;

                            // --- Ensure vertical bar chart has an item source ---
                            // Some chart types read from costChartState.items (not cachedMockData.items).
                            // If we don't sync here, vertical bars can render empty even though other charts have data.
                            if (payload && Array.isArray(payload.items)) {
                                const needSync =
                                    !Array.isArray(costChartState.items) ||
                                    costChartState.items.length === 0 ||
                                    !Array.isArray(costChartState.absoluteOriginalItems) ||
                                    costChartState.absoluteOriginalItems.length === 0;

                                if (needSync) {
                                    costChartState.items = [...payload.items];
                                    costChartState.originalItems = [...payload.items];
                                    costChartState.absoluteOriginalItems = [...payload.items];
                                }
                            }

                                    resolve(payload);
                                    return;
                                }
                                setTimeout(tryRequest, RETRY_MS);
                                return;
                            }

                            cachedMockData = payload;
                            // Keep a reference on state for renderers that read from costChartState.
                            costChartState.cachedMockData = cachedMockData;
                            // Invalidate tx aggregation caches when the dataset changes.
                            costChartState.__txDailyAggBuilt = false;

                            // --- Ensure vertical bar chart has an item source ---
                            // Some chart types read from costChartState.items (not cachedMockData.items).
                            // If we don't sync here, vertical bars can render empty even though other charts have data.
                            if (payload && Array.isArray(payload.items)) {
                                const needSync =
                                    !Array.isArray(costChartState.items) ||
                                    costChartState.items.length === 0 ||
                                    !Array.isArray(costChartState.absoluteOriginalItems) ||
                                    costChartState.absoluteOriginalItems.length === 0;

                                if (needSync) {
                                    costChartState.items = [...payload.items];
                                    costChartState.originalItems = [...payload.items];
                                    costChartState.absoluteOriginalItems = [...payload.items];
                                }
                            }

                            resolve(payload);
                        });
                        return;
                    }

                    // Legacy postMessage path
                    dataRequestCallbacks.push({ resolve, reject, startedAt });
                    window.parent.postMessage({ type: 'requestMockData' }, '*');

                    // In legacy mode, retry by re-posting if no response arrives quickly
                    if (Date.now() - startedAt < TIMEOUT_MS) {
                        setTimeout(() => {
                            // If still no cached data, retry
                            if (!cachedMockData || !cachedMockData.items || cachedMockData.items.length === 0) {
                                tryRequest();
                            }
                        }, RETRY_MS);
                    } else {
                        reject(new Error('Data request timeout'));
                    }
                };

                tryRequest();
            });
        }
        
        function getMockData() {
            if (cachedMockData) {
                return cachedMockData;
            }
            console.warn('⚠️ Charts: Mock data not loaded yet');
            return null;
        }
        
        window.addEventListener('message', function(event) {
            // Dashboard asking Charts for raw transactions (used for spike compute under file:// iframe separation)
            if (event && event.data && event.data.type === 'PB_REQUEST_TX' && event.data.requestId) {
                try {
                    const md = getMockData && getMockData();
                    const txAny = (md && md.transactions) || (cachedMockData && cachedMockData.transactions) || null;

                    // Flatten legacy object-of-history into row array if needed
                    let txArr = null;
                    if (Array.isArray(txAny)) {
                        txArr = txAny;
                    } else if (txAny && typeof txAny === 'object') {
                        const out = [];
                        for (const code of Object.keys(txAny)) {
                            const h = txAny[code] && txAny[code].history;
                            if (!Array.isArray(h)) continue;
                            for (const rec of h) out.push(Object.assign({ itemCode: code }, rec));
                        }
                        txArr = out;
                    }

                    // Reply to the actual requester when possible (Dashboard/Analytics forwarding chains under file://)
                    const target = (event && event.source && typeof event.source.postMessage === 'function')
                        ? event.source
                        : (window.parent && typeof window.parent.postMessage === 'function' ? window.parent : null);

                    if (target && typeof target.postMessage === 'function') {
                        target.postMessage({
                            type: 'PB_TX_DATA',
                            requestId: String(event.data.requestId),
                            transactions: txArr || []
                        }, '*');
                    }
                } catch (e) {
                    try {
                        const target = (event && event.source && typeof event.source.postMessage === 'function')
                            ? event.source
                            : (window.parent && typeof window.parent.postMessage === 'function' ? window.parent : null);

                        target && target.postMessage({
                            type: 'PB_TX_DATA',
                            requestId: String(event.data.requestId),
                            transactions: []
                        }, '*');
                    } catch (_) {}
                }
                return;
            }

            // On-demand monthly transaction range loader response
            if (event && event.data && event.data.type === 'txRangeReady') {
                const reqId = event.data.reqId;
                const pending = reqId && __ensureTxRangePending ? __ensureTxRangePending[reqId] : null;
                if (pending) {
                    const key = pending.key;
                    delete __ensureTxRangePending[reqId];
                    // IMPORTANT: Do NOT delete __ensureTxRangeByKey[key] here.
                    // Charts can redraw multiple times during tab switches / dark-mode sync.
                    // Keeping the resolved promise cached prevents spamming the dashboard
                    // with repeated ensureTxRange requests for the same (from,to) range.
                    if (event.data.ok) pending.resolve(event.data.info || { loaded: true, count: 0 });
                    else pending.reject(new Error(event.data.error || 'txRangeReady failed'));
                }
                // Fallback: if we didn't find the reqId (e.g., intermediate frame forwarding),
                // attempt to match any pending request by rangeKey / (fromISO|toISO).
                if (!pending) {
                    const key2 = event.data.rangeKey || (String(event.data.fromISO || '') + '|' + String(event.data.toISO || ''));
                    if (key2) {
                        const ids = Object.keys(__ensureTxRangePending || {});
                        for (let i = 0; i < ids.length; i++) {
                            const id = ids[i];
                            const p2 = __ensureTxRangePending[id];
                            if (p2 && p2.key === key2) {
                                delete __ensureTxRangePending[id];
                                if (event.data.ok) p2.resolve(event.data.info || { loaded: true, count: 0 });
                                else p2.reject(new Error(event.data.error || 'txRangeReady failed'));
                            }
                        }
                    }
                }
                return;
            }

            if (event.data.type === 'mockDataResponse') {
                console.log('📦 Charts: Received mock data from parent Dashboard');
                const payload = (window.InventoryApp && window.InventoryApp.postMessage && window.InventoryApp.postMessage.pickPayload)
                    ? window.InventoryApp.postMessage.pickPayload(event.data)
                    : { computed: event.data.data, raw: null };
                // Cache only non-empty computed payloads; empty payloads are usually a timing race.
                const computedPayload = payload.computed || { lastUpdated: new Date().toISOString().split('T')[0], items: [] };

                // Attach raw transactions so Charts can recompute range-aware series.
                // IMPORTANT: The computed payload may come from the centralized compute pipeline
                // and omit transactions entirely. Even if a transactions field exists but is empty,
                // prefer the raw merged monthly transactions.
                if (payload.raw && payload.raw.transactions) {
                    computedPayload.transactions = payload.raw.transactions;
                }
                if (computedPayload.items && computedPayload.items.length > 0) {
                    cachedMockData = computedPayload;
                    // Keep a reference on state for renderers that read from costChartState.
                    costChartState.cachedMockData = cachedMockData;
                } else {
                    console.warn('⚠️ Charts: Received empty computed payload; will retry shortly.');
                    cachedMockData = null;
                    costChartState.cachedMockData = null;
                    // retry once more quickly
                    setTimeout(() => {
                        try { requestMockDataFromParent().then(() => populateCharts()).catch(()=>{}); } catch(e){}
                    }, 300);
                }
                
                // Store stock flow data for Sankey chart
                if (cachedMockData && cachedMockData.stockFlow) {
                    costChartState.stockFlowData = cachedMockData.stockFlow;
                    console.log('✓ Stock flow data stored for Sankey chart');
                }
                
                dataRequestCallbacks.forEach(cb => cb.resolve(cachedMockData));
                dataRequestCallbacks = [];
                
                console.log('✓ Charts: Mock data cached:', cachedMockData.items.length, 'items');
            }
            
            if (event.data.type === 'trendingItemsUpdate' && event.data.trendingItems) {
                const ti = event.data.trendingItems || {};
                window.TrendFactsState = {
                    source: ti.source || 'unknown',
                    calculatedAt: ti.calculatedAt || '',
                    up: Array.isArray(ti.trendingUp) ? ti.trendingUp : [],
                    down: Array.isArray(ti.trendingDown) ? ti.trendingDown : [],
                    loadedAt: new Date().toISOString()
                };
            }

            if (event.data.type === 'updateSettings') {
                console.log('⚙️ Charts: Received settings update', event.data.settings);
                
                // Update threshold value
                if (event.data.settings.usageRestockThreshold !== undefined) {
                    costChartState.usageVsRestockThreshold = event.data.settings.usageRestockThreshold;
                    console.log('✓ Updated threshold to:', costChartState.usageVsRestockThreshold);
                    
                    // Redraw Usage Vs Restock chart if it's currently visible
                    if (costChartState.showUsageVsRestock && costChartState.chartType === 'time-chart') {
                        drawUsageVsRestockChart();
                        console.log('✓ Redrawn Usage Vs Restock chart with new threshold');
                    }
                }
            }
            
            if (event.data.type === 'darkModeToggle') {
                document.body.classList.toggle('dark-mode', event.data.enabled);
                console.log('📦 Charts: Dark mode', event.data.enabled ? 'enabled' : 'disabled');

                // Redraw the CURRENT chart (do not switch chart types on theme change)
                const chartType = costChartState.chartType;

                if (chartType === 'cost-bar') {
                    scheduleChartsRedraw('darkMode');
                } else if (chartType === 'horizontal-bar') {
                    if (costChartState.currentData && costChartState.currentData.length > 0) {
                        drawHorizontalBarChart(costChartState.currentData);
                    } else {
                        scheduleChartsRedraw('darkMode');
                    }
                } else if (chartType === 'line-chart') {
                    if (costChartState.timeSeriesMetric === 'restock-usage') {
                        drawUsageVsRestockChart();
                    } else {
                        drawTimeSeriesChart();
                    }
                } else if (chartType === 'time-chart') {
                    // Projection/historical time charts
                    if (costChartState.timeSeriesMetric === 'projection') {
                        drawInventoryProjection();
                    } else {
                        drawChartPlaceholder('historical-shortages');
                    }
                } else if (chartType === 'bar-chart') {
                    scheduleChartsRedraw('darkMode');
                } else {
                    // safe fallback
                    scheduleChartsRedraw('darkMode');
                }
            }
            
            if (event.data.type === 'applyFilterWithHighlight') {
                console.log('========================================');
                console.log('📊 Charts: applyFilterWithHighlight received!');
                console.log('📦 Filter data:', event.data.filterData);
                console.log('========================================');
                
                const filterData = event.data.filterData;
                
                // Store the full filter data for cross-view highlighting
                costChartState.filterData = filterData;
                
                // Determine the most specific view mode based on filterData
                let viewMode = 'itemClass'; // Default to broadest view
                let highlightKey = '';
                
                // Build drill-down stack based on filter specificity
                costChartState.drillDownStack = [];
                
                if (filterData.description) {
                    // Most specific - drill all the way to description
                    viewMode = 'description';
                    highlightKey = filterData.description;
                    
                    // Add class level to stack if available
                    if (filterData.itemClass) {
                        costChartState.drillDownStack.push({
                            key: filterData.itemClass,
                            mode: 'itemClass'
                        });
                    }
                    
                    // Add drug name level to stack if available
                    if (filterData.drugName) {
                        costChartState.drillDownStack.push({
                            key: filterData.drugName,
                            mode: 'drugName'
                        });
                    }
                } else if (filterData.drugName) {
                    // Medium specificity - drill to drug name
                    viewMode = 'drugName';
                    highlightKey = filterData.drugName;
                    
                    // Add class level to stack if available
                    if (filterData.itemClass) {
                        costChartState.drillDownStack.push({
                            key: filterData.itemClass,
                            mode: 'itemClass'
                        });
                    }
                } else if (filterData.itemClass) {
                    // Least specific - just show class level
                    viewMode = 'itemClass';
                    highlightKey = filterData.itemClass;
                }
                
                costChartState.viewMode = viewMode;
                costChartState.highlightKey = highlightKey;
                
                console.log('✓ View mode set to:', viewMode);
                console.log('✓ Highlight key:', highlightKey);
                console.log('✓ Drill-down stack:', costChartState.drillDownStack);
                
                // Update dropdown
                const selector = document.getElementById('costChartViewSelector');
                if (selector) {
                    selector.value = costChartState.viewMode;
                    console.log('✓ Dropdown updated');
                }
                
                // Reset pagination
                costChartState.currentPage = 0;
                
                console.log('🎨 Redrawing chart...');
                scheduleChartsRedraw('dateRange');
                
                // If pie chart is active, also redraw it
                if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                    console.log('✓ Pie chart redrawn with filter!');
                }
                
                console.log('✓ Chart redrawn!');
                console.log('========================================');
            }
            
            // Handle navigateToPage messages from Analytics
            if (event.data.type === 'navigateToPage' && event.data.page === 'charts') {
                console.log('📊 Charts: navigateToPage received', event.data);
                
                // Handle Total Cost navigation - horizontal bar, no filters
                if (event.data.chartType === 'cost-bar' && event.data.clearFilters) {
                    console.log('💰 Total Cost clicked - showing horizontal bar chart');
                    
                    // Restore original items if filter was active
                    if (costChartState.originalItems && costChartState.originalItems.length > 0) {
                        costChartState.items = [...costChartState.originalItems];
                        costChartState.originalItems = null;
                        console.log('✓ Restored original items from filter');
                    }
                    
                    // Clear all filters
                    costChartState.filterData = null;
                    costChartState.drillDownStack = [];
                    costChartState.viewMode = 'itemClass';
                    costChartState.highlightKey = null;
                    costChartState.currentPage = 0;
                    
                    // Switch to horizontal bar chart
                    switchChartType('cost-bar');
                    
                    console.log('✓ Switched to horizontal bar chart, no filters');
                }
                
                // Handle Projected Waste filter
                
                else if (event.data.filterType === 'projectedWaste') {
                    console.log('♻️ Projected Waste clicked - filtering items');
                    const filterData = event.data.filterData || {};

                    // If costChartState doesn't have items yet, wait for data to load
                    if (!costChartState.items || costChartState.items.length === 0) {
                        console.log('⏳ No items in costChartState yet, waiting for data...');
                        window.pendingProjectedWasteFilter = filterData;
                        return;
                    }

                    // Always reset to absolute original items as the base for any new filter
                    if (costChartState.absoluteOriginalItems) {
                        costChartState.items = [...costChartState.absoluteOriginalItems];
                        costChartState.originalItems = [...costChartState.absoluteOriginalItems];
                    } else if (costChartState.originalItems && costChartState.originalItems.length) {
                        costChartState.items = [...costChartState.originalItems];
                    } else {
                        costChartState.originalItems = [...costChartState.items];
                    }

                    // Clear any active search
                    costChartState.searchTerm = '';
                    window.originalItems = null;
                    const searchInput = document.getElementById('searchInput');
                    if (searchInput) searchInput.value = '';

                    // Store projected waste records and enter special dataset mode
                    const records = Array.isArray(filterData.items) ? filterData.items : [];
                    costChartState.specialDataset = 'projectedWaste';
                    costChartState.projectedWasteRecords = records;
                    costChartState.projectedWasteTotalCost = Number(filterData.totalCost || 0);

                    // Build quick lookup by itemCode (preferred) and by description (fallback)
                    costChartState.projectedWasteMap = {};
                    costChartState.projectedWasteDescMap = {};
                    records.forEach(r => {
                        const code = r.itemCode != null ? String(r.itemCode) : null;
                        if (code) costChartState.projectedWasteMap[code] = r;
                        if (r.description) costChartState.projectedWasteDescMap[String(r.description)] = r;
                    });

                    // Filter items to only those in projected waste records
                    const wantedCodes = new Set(records.map(r => String(r.itemCode)));
                    const wantedDescriptions = new Set(records.map(r => String(r.description)));

                    costChartState.items = costChartState.originalItems.filter(it => {
                        const codeMatch = wantedCodes.has(String(it.itemCode));
                        const descMatch = wantedDescriptions.has(String(it.description || ''));
                        return codeMatch || descMatch;
                    });

                    console.log('✓ Projected waste dataset active:', costChartState.items.length, 'items');

                    // Force view selector to Item level for projected waste
                    const selector = document.getElementById('costChartViewSelector');
                    if (selector) selector.value = 'description';
                    costChartState.viewMode = 'description';
                    costChartState.drillDownStack = [];
                    costChartState.currentPage = 0;

                    // Trigger redraw
                    updateFilterIndicator();
                    scheduleChartsRedraw('dateRange');
                }

                
                // Handle Items Below Threshold filter
                else if (event.data.filterType === 'itemsBelowThreshold') {
                    console.log('📈 Items Below Threshold clicked - filtering items');
                    
                    const filterData = event.data.filterData;
                    
                    // Always use absoluteOriginalItems as the base for any new filter
                    // This ensures we're filtering from the full dataset, not a previously filtered one
                    if (costChartState.absoluteOriginalItems) {
                        costChartState.items = [...costChartState.absoluteOriginalItems];
                        costChartState.originalItems = [...costChartState.absoluteOriginalItems];
                        console.log('✓ Reset to absolute original items:', costChartState.items.length);
                    } else {
                        // Fallback: use current items as original if absolute not available
                        if (!costChartState.originalItems) {
                            costChartState.originalItems = [...costChartState.items];
                        }
                    }
                    
                    // Clear any active search
                    costChartState.searchTerm = '';
                    window.originalItems = null;
                    const searchInput = document.getElementById('searchInput');
                    if (searchInput) {
                        searchInput.value = '';
                    }
                    
                    // Store filter data
                    costChartState.filterData = {
                        filterType: filterData.filterType,
                        filteredItems: filterData.items
                    };
                    
                    // Filter the items to show only items below threshold
                    const belowThresholdDescriptions = filterData.items.map(item => item.description);
                    costChartState.items = costChartState.originalItems.filter(item => 
                        belowThresholdDescriptions.includes(item.description)
                    );
                    
                    // Reset view to show all filtered items
                    costChartState.drillDownStack = [];
                    costChartState.viewMode = 'itemClass';
                    costChartState.highlightKey = null;
                    costChartState.currentPage = 0;
                    
                    // Update dropdown
                    const selector = document.getElementById('costChartViewSelector');
                    if (selector) {
                        selector.value = 'itemClass';
                    }
                    
                    // Switch to horizontal bar chart and redraw
                    switchChartType('cost-bar');
                    
                    console.log('✓ Items Below Threshold filter applied:', belowThresholdDescriptions.length, 'items');
                }
                
                // Handle Usage Vs Restock navigation
                else if (event.data.chartType === 'time-chart' && event.data.subChart === 'usageVsRestock') {
                    console.log('📈 Usage Vs Restock clicked - showing ratio line chart');
                    
                    // Don't clear filters or drill-down - we want to preserve them
                    // Only clear filterData if it's a specific external filter
                    if (costChartState.filterData && costChartState.filterData.filterType) {
                        costChartState.filterData = null;
                    }
                    
                    // Switch to time-chart
                    switchChartType('time-chart');
                    
                    // Set the metric and flag
                    costChartState.timeSeriesMetric = 'restock-usage';
                    costChartState.showUsageVsRestock = true;
                    
                    // Update sub-icon active state
                    setTimeout(() => {
                        const subIconMenu = document.querySelector('[data-parent="time-chart"] .sub-icons-menu');
                        if (subIconMenu) {
                            subIconMenu.querySelectorAll('.sub-icon-btn').forEach(btn => {
                                btn.classList.remove('active');
                            });
                            const restockBtn = subIconMenu.querySelector('[data-tooltip="Restock vs Usage"]');
                            if (restockBtn) {
                                restockBtn.classList.add('active');
                            }
                        }
                    }, 100);
                    
                    // Draw the usage vs restock ratio chart (respects drill-down)
                    drawUsageVsRestockChart();
                    
                    console.log('✓ Switched to Usage Vs Restock ratio chart');
                }
                
                // Handle generic navigation to Charts (e.g., from sidebar) - clear filters
                else if (!event.data.filterType && !event.data.chartType) {
                    console.log('📊 Generic Charts navigation - clearing filters');
                    
                    // Restore original items if filtered
                    if (costChartState.originalItems && costChartState.originalItems.length > 0) {
                        costChartState.items = [...costChartState.originalItems];
                        costChartState.originalItems = null;
                        console.log('✓ Restored original items');
                    }
                    
                    // Clear all filter state
                    costChartState.filterData = null;
                    costChartState.drillDownStack = [];
                    costChartState.viewMode = 'itemClass';
                    costChartState.highlightKey = null;
                    costChartState.currentPage = 0;
                    
                    // Update dropdown
                    const selector = document.getElementById('costChartViewSelector');
                    if (selector) {
                        selector.value = 'itemClass';
                    }
                    
                    // Redraw current chart type
                    if (costChartState.chartType === 'cost-bar') {
                        scheduleChartsRedraw('dateRange');
                    } else if (costChartState.chartType === 'pie-chart') {
                        drawPieChart();
                    } else if (costChartState.chartType === 'time-chart') {
                        if (costChartState.showUsageVsRestock) {
                            drawUsageVsRestockChart();
                        } else {
                            drawTimeSeriesChart();
                        }
                    } else if (costChartState.chartType === 'bar-chart') {
                        scheduleChartsRedraw('dateRange');
                    }
                    
                    console.log('✓ Filters cleared, chart redrawn');
                }
            }
        });

        // ==================================================================================
        // HELPER FUNCTIONS
        // ==================================================================================
        
        /**
         * Get effective inventory for an item based on excludeStandardInventory setting
         * If setting is ON, subtracts pyxisStandard from pyxis
         * @param {Object} item - The item object with pyxis, pyxisStandard, pharmacy fields
         * @returns {Object} - Object with effectivePyxis, effectivePharmacy, effectiveQuantity
         */
        /**
         * Derive Pyxis/Pharmacy quantities from the inventory map using SUBLOCATION_MAP.
         * This matches the grouping used in the Shortage Bulletin details modal.
         * Supports both inventory shapes:
         *  - inventory[itemCode].sublocations = [{sublocation, curQty/minQty/maxQty, standard, standardQty}, ...]
         *  - inventory[itemCode] = { "3TWA": {qty,min,max,standard,standardQty,...}, ... }
         */
        function getInventoryBreakdownFromMockData(itemCode) {
            const invRoot = cachedMockData && cachedMockData.inventory ? cachedMockData.inventory : null;
            if (!invRoot || !itemCode || !invRoot[itemCode]) {
                return { pyxisQty: 0, pharmacyQty: 0, pyxisStandardQty: 0 };
            }

            const entry = invRoot[itemCode];

            // Normalize to sublocation rows
            let rows = [];
            if (entry && Array.isArray(entry.sublocations)) {
                rows = entry.sublocations.map(s => ({
                    sublocation: s.sublocation,
                    qty: Number(s.curQty ?? s.qty ?? 0) || 0,
                    min: Number(s.minQty ?? s.min ?? 0) || 0,
                    max: Number(s.maxQty ?? s.max ?? 0) || 0,
                    standard: !!(s.standard),
                    standardQty: Number(s.standardQty ?? 0) || 0
                }));
            } else if (entry && typeof entry === 'object') {
                rows = Object.keys(entry).map(code => {
                    const v = entry[code] || {};
                    return {
                        sublocation: code,
                        qty: Number(v.qty ?? 0) || 0,
                        min: Number(v.min ?? 0) || 0,
                        max: Number(v.max ?? 0) || 0,
                        standard: !!(v.standard),
                        standardQty: Number(v.standardQty ?? 0) || 0
                    };
                });
            }

            const map = (typeof window !== 'undefined' && window.SUBLOCATION_MAP) ? window.SUBLOCATION_MAP : null;
            let pyxisQty = 0;
            let pharmacyQty = 0;
            let pyxisStandardQty = 0;

            for (const r of rows) {
                const info = map && r.sublocation ? map[r.sublocation] : null;
                const dept = (info && info.department ? String(info.department) : 'Pharmacy').toLowerCase();
                const isPyxis = dept.includes('pyxis');

                if (isPyxis) {
                    pyxisQty += r.qty;
                    if (r.standard) pyxisStandardQty += (r.standardQty || 0);
                } else {
                    pharmacyQty += r.qty;
                }
            }

            return { pyxisQty, pharmacyQty, pyxisStandardQty };
        }

        function getEffectiveInventory(item) {
            const excludeStandard = localStorage.getItem('excludeStandardInventory') === 'true';

            // Prefer inventory-derived grouping when possible (ensures charts match the details modal).
            const itemCode = item && (item.itemCode || item.itemcode || item.code);
            const derived = getInventoryBreakdownFromMockData(String(itemCode || ''));

            // Fall back to item fields if inventory isn't available for this item.
            const pyxis = (derived.pyxisQty || derived.pharmacyQty)
                ? derived.pyxisQty
                : (item.pyxis || 0);
            const pharmacy = (derived.pyxisQty || derived.pharmacyQty)
                ? derived.pharmacyQty
                : (item.pharmacy || 0);
            const pyxisStandard = (derived.pyxisQty || derived.pharmacyQty)
                ? derived.pyxisStandardQty
                : (item.pyxisStandard || 0);

            if (excludeStandard) {
                const effectivePyxis = Math.max(0, pyxis - pyxisStandard);
                return {
                    effectivePyxis,
                    effectivePharmacy: pharmacy,
                    effectiveQuantity: effectivePyxis + pharmacy
                };
            }

            return {
                effectivePyxis: pyxis,
                effectivePharmacy: pharmacy,
                effectiveQuantity: pyxis + pharmacy
            };
        }

        // ==================================================================================
        // COST CHART INITIALIZATION AND DRAWING
        // ==================================================================================
        
        function initInventoryCostChart(items) {
            costChartState.items = items.filter(item => item.unitPrice && parseFloat(item.unitPrice) > 0);
            
            // Store the ABSOLUTE original items - this never gets modified
            if (!costChartState.absoluteOriginalItems) {
                costChartState.absoluteOriginalItems = [...costChartState.items];
                console.log('💾 Stored absolute original items:', costChartState.absoluteOriginalItems.length);
            }
            
            costChartState.canvas = document.getElementById('costChart');
            costChartState.ctx = costChartState.canvas.getContext('2d');
            
            const titleSelector = document.getElementById('costChartViewSelector');
            if (titleSelector) {
                titleSelector.addEventListener('change', handleViewModeChange);
            }
            
            // Initialize chart type buttons in the header
            initializeChartTypeButtons();
            initializeFlowModeButtons();
            
            // Setup vertical bar chart mouse interactions
            setupVerticalBarChartInteractions();
            
            // Check if there's a pending projected waste filter to apply
            if (window.pendingProjectedWasteFilter) {
                console.log('⏳ Applying pending projected waste filter...');
                const filterData = window.pendingProjectedWasteFilter;
                
                // Backup original items
                costChartState.originalItems = [...costChartState.items];
                
                // Store filter data
                costChartState.filterData = {
                    filterType: filterData.filterType,
                    filteredItems: filterData.items,
                    totalCost: filterData.totalCost
                };
                
                // Use the items from Dashboard directly - they already have wasteValue
                costChartState.items = filterData.items;
                console.log('✓ Pending filter applied:', costChartState.items.length, 'items with wasteValue');
                
                // Reset view settings
                costChartState.drillDownStack = [];
                costChartState.viewMode = 'itemClass';
                costChartState.highlightKey = null;
                costChartState.currentPage = 0;
                
                // Update dropdown
                if (titleSelector) {
                    titleSelector.value = 'itemClass';
                }
                
                // Clear pending filter
                window.pendingProjectedWasteFilter = null;
            }
            
            scheduleChartsRedraw('dateRange');
        }
        
        function handleViewModeChange(event) {
            // Reset drill-down, pagination, and showAllItems flag when changing view mode
            costChartState.drillDownStack = [];
            costChartState.showAllItems = false;
            costChartState.currentPage = 0;
            costChartState.rootLevelPage = 0;
            costChartState.viewMode = event.target.value;
            
            // If we have filter data, update the highlight key for the new view mode
            if (costChartState.filterData) {
                let newHighlightKey = '';
                if (costChartState.viewMode === 'itemClass') {
                    // Handle empty itemClass - it becomes 'Unknown' in the grouping
                    newHighlightKey = costChartState.filterData.itemClass || 'Unknown';
                } else if (costChartState.viewMode === 'drugName') {
                    newHighlightKey = costChartState.filterData.drugName || 'Unknown';
                } else if (costChartState.viewMode === 'description') {
                    newHighlightKey = costChartState.filterData.description || 'Unknown';
                } else if (costChartState.viewMode === 'formulary') {
                    // For formulary, determine if the item is formulary or non-formulary
                    // Find the item in the data
                    const item = costChartState.items.find(i => 
                        i.description === costChartState.filterData.description
                    );
                    if (item) {
                        const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                        newHighlightKey = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                        console.log(`📋 Formulary status: ${newHighlightKey}`);
                    } else {
                        newHighlightKey = null;
                        console.log('⚠️ Item not found for formulary status check');
                    }
                }
                
                costChartState.highlightKey = newHighlightKey;
                console.log(`🔄 View changed to ${costChartState.viewMode}, highlight key updated to: "${newHighlightKey}"`);
            } else {
                // No filter data, clear highlight
                costChartState.highlightKey = null;
            }
            
            scheduleChartsRedraw('dateRange');
            
            // If a different chart type is active, redraw it
            if (costChartState.chartType === 'pie-chart') {
                drawPieChart();
            } else if (costChartState.chartType === 'time-chart') {
                drawTimeSeriesChart();
            }
        }
        
        function initializeChartTypeButtons() {
            const iconContainer = document.getElementById('chartTypeIcons');
            if (!iconContainer) return;
            
            const chartTypes = [
                { id: 'cost-bar', icon: createCostBarIcon(), tooltip: 'Cost Analysis', hasSubMenu: true },
                { id: 'line-chart', icon: createLineChartIcon(), tooltip: 'Trend Lines', hasSubMenu: true },
                { id: 'time-chart', icon: createTimeChartIcon(), tooltip: 'Time Series', hasSubMenu: true },
                { id: 'bar-chart', icon: createBarChartIcon(), tooltip: 'Bar Chart', hasSubMenu: true },
                { id: 'pie-chart', icon: createPieChartIcon(), tooltip: 'Distribution', hasSubMenu: false },
                { id: 'flow-chart', icon: createFlowChartIcon(), tooltip: 'Flow Diagram', hasSubMenu: false },
                { id: 'list-view', icon: createListIcon(), tooltip: 'View Items List', hasSubMenu: false }
            ];
            
            chartTypes.forEach(chartType => {
                // Create wrapper for icon + sub-menu
                const wrapper = document.createElement('div');
                wrapper.style.position = 'relative';
                wrapper.style.display = 'inline-block';
                wrapper.dataset.chartType = chartType.id; // Add for submenu identification
                
                const iconBtn = document.createElement('div');
                iconBtn.className = 'chart-icon-btn';
                if (costChartState.chartType === chartType.id) {
                    iconBtn.classList.add('active');
                }
                iconBtn.innerHTML = chartType.icon;
                iconBtn.dataset.chartType = chartType.id;
                iconBtn.dataset.tooltip = chartType.tooltip;
                iconBtn.title = chartType.tooltip;
                
                iconBtn.addEventListener('click', function() {
                    // Show sub-menu if this chart has one
                    if (chartType.hasSubMenu) {
                        const subMenu = wrapper.querySelector('.sub-icons-menu');
                        if (subMenu) {
                            // Close all other sub-menus first
                            document.querySelectorAll('.sub-icons-menu').forEach(menu => {
                                if (menu !== subMenu) menu.classList.remove('visible');
                            });
                            
                            // Only switch chart type if we're not already on it
                            // This prevents resetting the metric when reopening submenu
                            if (costChartState.chartType !== chartType.id) {
                                switchChartType(chartType.id);
                            }
                            
                            // Toggle submenu visibility
                            subMenu.classList.toggle('visible');
                        }
                    } else {
                        // No submenu - just switch
                        // List-view icon should ALWAYS navigate, even if we are returning via back navigation.
                        if (chartType.id === 'list-view') {
                            costChartState._suppressListViewNav = false;
                        }
                        switchChartType(chartType.id);
                    }
                });
                
                wrapper.appendChild(iconBtn);
                
                // Add sub-menu if needed
                if (chartType.hasSubMenu) {
                    const subMenu = createSubMenu(chartType.id);
                    wrapper.appendChild(subMenu);
                    
                    // Add hover handlers for auto-hide
                    let hideTimeout = null;
                    
                    const startHideTimer = () => {
                        if (hideTimeout) clearTimeout(hideTimeout);
                        hideTimeout = setTimeout(() => {
                            subMenu.classList.remove('visible');
                        }, 1000); // Hide after 1 second
                    };
                    
                    const cancelHideTimer = () => {
                        if (hideTimeout) {
                            clearTimeout(hideTimeout);
                            hideTimeout = null;
                        }
                    };
                    
                    // When mouse leaves icon button, start timer
                    iconBtn.addEventListener('mouseleave', () => {
                        if (subMenu.classList.contains('visible')) {
                            startHideTimer();
                        }
                    });
                    
                    // When mouse enters icon button, cancel timer
                    iconBtn.addEventListener('mouseenter', () => {
                        cancelHideTimer();
                    });
                    
                    // When mouse enters sub-menu, cancel timer
                    subMenu.addEventListener('mouseenter', () => {
                        cancelHideTimer();
                    });
                    
                    // When mouse leaves sub-menu, start timer
                    subMenu.addEventListener('mouseleave', () => {
                        startHideTimer();
                    });
                }
                
                iconContainer.appendChild(wrapper);
            });

            // Add inventory stack controls (for Quantity On Hand horizontal bars)
            addInventoryStackControls(iconContainer);
            
            // Click outside to close sub-menus
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.chart-type-icons')) {
                    document.querySelectorAll('.sub-icons-menu').forEach(menu => {
                        menu.classList.remove('visible');
                    });
                }
            });
        }

        function addInventoryStackControls(iconContainer) {
            // Avoid duplicates on re-init
            if (iconContainer.querySelector('.inventory-stack-controls')) return;

            const separator = document.createElement('span');
            separator.className = 'chart-icon-separator';
            separator.textContent = '|';

            const controls = document.createElement('div');
            controls.className = 'inventory-stack-controls';
            controls.title = 'Stack quantity bars by inventory source';

            const makeBtn = (mode, label) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'inventory-stack-btn';
                btn.dataset.mode = mode;
                btn.textContent = label;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setInventoryStackMode(mode);
                });
                return btn;
            };

            controls.appendChild(makeBtn('both', 'Both'));
            controls.appendChild(makeBtn('pyxis', 'Pyxis'));
            controls.appendChild(makeBtn('pharmacy', 'Pharmacy'));

            iconContainer.appendChild(separator);
            iconContainer.appendChild(controls);

            updateInventoryStackControlsVisibility();
            updateInventoryStackControlsActiveState();
        }

        function setInventoryStackMode(mode) {
            costChartState.inventoryStackMode = mode;
            updateInventoryStackControlsActiveState();

            // Only impacts cost-bar quantity view
            if (costChartState.chartType === 'cost-bar' && costChartState.costBarMetric === 'qty') {
                scheduleChartsRedraw('dateRange');
            }
        }

        function updateInventoryStackControlsActiveState() {
            const controls = document.querySelector('.inventory-stack-controls');
            if (!controls) return;
            controls.querySelectorAll('.inventory-stack-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === costChartState.inventoryStackMode);
            });
        }

        function updateInventoryStackControlsVisibility() {
            const sep = document.querySelector('.chart-icon-separator');
            const controls = document.querySelector('.inventory-stack-controls');
            if (!sep || !controls) return;

            const shouldShow = (costChartState.chartType === 'cost-bar' && costChartState.costBarMetric === 'qty');
            sep.style.display = shouldShow ? 'inline-flex' : 'none';
            controls.style.display = shouldShow ? 'inline-flex' : 'none';
        }

        function updateDateRangeControlsVisibility() {
            const rangeContainer = document.getElementById('chartDateRangeContainer');
            const drillContainer = document.getElementById('verticalDrillContainer');

            // Per UX: date range + drill controls should appear ONLY in the vertical bar chart view.
            // The horizontal cost-bar view should show the numeric scale unobstructed.
            const showRange = true;
            const showDrill = (costChartState.chartType === 'bar-chart');

            // These controls are now mounted into the animated scale container.
            // We still toggle their internal visibility here.
            if (rangeContainer) rangeContainer.style.display = showRange ? 'inline-flex' : 'none';
            if (drillContainer) drillContainer.style.display = showDrill ? 'inline-flex' : 'none';

            // If the range controls are hidden (e.g., navigating away to cost-bar or another page),
            // ensure any open popover/backdrop is closed so it doesn't block clicks when returning.
            if (!showRange) {
                try {
                    if (typeof costChartState._closeRangePopover === 'function') {
                        costChartState._closeRangePopover();
                    }
                } catch (e) {}
            }
        }

        // --- Location/Sublocation toggle helpers (Charts header) ---
        // IMPORTANT:
        // - For LOCATION grouping we use canonicalizeLocationCode() when available.
        // - For SUBLOCATION exact matching we use strict uppercase+trim (do NOT canonicalize),
        //   because canonicalizeLocationCode often collapses sublocations into their parent location.
        function _canonLocKey(raw){
            const s0 = String(raw || '').trim();
                const s = _canonSublocExact(s0) || s0.toUpperCase();
            if (!s) return '';
            try {
                if (typeof canonicalizeLocationCode === 'function') return canonicalizeLocationCode(s);
            } catch (e) {}
            // Fallback grouping when canonicalizeLocationCode() is not available.
            // Common pattern in this app is that LOCATION is a short prefix of a more specific
            // sublocation token (e.g., "2EA"/"2EBC" should group under location "2E").
            // Heuristic: if token starts with digit+letter and is longer than 2, group by first 2.
            const up = s.toUpperCase();
            if (/^\d[A-Z]/.test(up) && up.length > 2) return up.slice(0, 2);
            return up;
        }

        function _canonSublocExact(raw){
            // Strict-ish sublocation canonicalization for matching.
            // Avoid canonicalizeLocationCode() here because it can collapse sublocations.
            // Normalize whitespace and common separators so filters match tx payloads.
            const s = String(raw || '').trim();
            return s ? s.toUpperCase().replace(/\s+/g, '').replace(/[_/]+/g, '-') : '';
        }

        function _locKeyFromCanon(canon){
            const s = String(canon || '').trim();
            if (!s) return '';
            const up = s.toUpperCase();
            // Some datasets encode location as a short prefix of the sublocation token
            // with no separators (e.g., "2EA", "2EBC"). Group under the first 2 chars ("2E").
            if (/^\d[A-Z]/.test(up) && up.length > 2) return up.slice(0, 2);
            // Heuristic: leading token before separators. Works for patterns like EDA-01, EDA_01, EDA/01.
            const m = up.match(/^([A-Z0-9]+)/);
            if (m && m[1]) return m[1];
            const parts = up.split(/[-_/\s]+/).filter(Boolean);
            return (parts[0] || up);
        }

        function _mainLocFromSublocToken(raw){
            // Use shared sublocation reference map when available.
            // location_ref_mockdata.js exposes SUBLOCATION_MAP globally.
            try {
                const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : this);
                const m = g && g.SUBLOCATION_MAP;
                if (!m) return '';
                const s = String(raw || '').trim();
                if (!s) return '';
                const hit = m[s] || m[s.toUpperCase()] || m[s.toLowerCase()];
                const ml = hit && hit.mainLocation ? String(hit.mainLocation).trim() : '';
                return ml;
            } catch (e) {
                return '';
            }
        }

        function _getTxnSublocRaw(row){
            const r = row || {};
            // IMPORTANT:
            // For chart Location/Sublocation toggles we want the *destination* bucket when it exists.
            // Many transaction feeds encode the cabinet/device as `sublocation`, but the clinical unit
            // (what matches SUBLOCATION_MAP / mainLocation) is `sendToLocation`.
            // Example:
            //   { sublocation: "VC1", sendToLocation: "EDD" }
            // Here the expected Location bucket is ED (via sendToLocation), not VC1.
            // So we prefer sendTo/destination fields first, then fall back to sublocation.
            return r.sendToLocation || r.toLocation || r.sendTo || r.destinationLocation ||
                   r.sublocation || r.subLocation || r.subLoc || r.subloc || r.sub_loc || r.subLocCode || r.sublocCode ||
                   r.location || r.fromLocation || r.from || r.sendFromLocation || r.sourceLocation || '';
        }

        function computeSublocMapForItem(itemCode){
            try {
                const code = String(itemCode || "").trim();
                if (!code) return [];
                const txRoot = (costChartState && costChartState.cachedMockData && costChartState.cachedMockData.transactions)
                    ? costChartState.cachedMockData.transactions
                    : ((typeof cachedMockData === "object" && cachedMockData && cachedMockData.transactions) ? cachedMockData.transactions : null);
                if (!txRoot || typeof txRoot !== "object") return [];

                // Robust lookup: transaction buckets may be keyed by padded/unpadded/dashed variants.
                const _getTxnBucketForCode = (root, codeStr) => {
                    if (!root || !codeStr) return null;
                    const s = String(codeStr).trim();
                    if (!s) return null;
                    const noLead = s.replace(/^0+/, '') || s;
                    const noDash = s.replace(/[\s-]/g, '');
                    const noDashNoLead = (noDash || '').replace(/^0+/, '') || noDash;
                    return root[s]
                        || root[noLead]
                        || (noDash ? root[noDash] : null)
                        || (noDashNoLead ? root[noDashNoLead] : null)
                        || null;
                };

                const bucket = _getTxnBucketForCode(txRoot, code);
                const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
                if (!Array.isArray(hist) || !hist.length) return [];

                // locKey -> { label, sublocs: Map(canon -> display) }
                const locMap = new Map();
                for (let i = 0; i < hist.length; i++) {
                    const r = hist[i] || {};
                    const disp = String(_getTxnSublocRaw(r) || "").trim();
                    if (!disp) continue;
                    const canon = _canonSublocExact(disp);
                    if (!canon) continue;

                    // Prefer authoritative mapping (sublocation -> mainLocation) when present.
                    // Fallback to heuristics if mapping is missing.
                    const mappedMainLoc = _mainLocFromSublocToken(disp);
                    const locKey = mappedMainLoc ? String(mappedMainLoc).trim().toUpperCase() : _locKeyFromCanon(_canonLocKey(canon));
                    if (!locKey) continue;
                    if (!locMap.has(locKey)) locMap.set(locKey, { label: locKey, sublocs: new Map() });
                    const entry = locMap.get(locKey);
                    if (!entry.sublocs.has(canon)) entry.sublocs.set(canon, disp);
                }
                const out = { locations: [], byLocation: Object.create(null) };
                const locKeys = Array.from(locMap.keys()).sort((a,b)=> String(a).localeCompare(String(b)));
                out.locations = locKeys;
                for (const lk of locKeys) {
                    const entry = locMap.get(lk);
                    const sublocs = Array.from(entry.sublocs.values()).sort((a,b)=> String(a).localeCompare(String(b)));
                    out.byLocation[lk] = sublocs;
                }
                return out;
            } catch (e) {
                return [];
            }
        }

	        function _mkToggleBar(items, curVal, onPick, kind){
	            // Inline, scrollable toggle bar with arrows + drag scrolling.
	            // kind: 'loc' | 'subloc'
	            const bar = document.createElement('div');
	            bar.className = 'chart-toggle-bar ' + (kind === 'loc' ? 'chart-toggle-bar-loc' : 'chart-toggle-bar-subloc');

	            const left = document.createElement('div');
	            left.className = 'chart-toggle-arrow left';
	            left.setAttribute('role','button');
	            left.setAttribute('tabindex','0');
	            left.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24">\n      <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>\n    </svg>';

	            const right = document.createElement('div');
	            right.className = 'chart-toggle-arrow right';
	            right.setAttribute('role','button');
	            right.setAttribute('tabindex','0');
	            right.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24">\n      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>\n    </svg>';

	            const scroller = document.createElement('div');
	            scroller.className = 'opt-subloc-toggle chart-toggle-scroll';
	            scroller.setAttribute('data-kind', kind || '');

	            // Restore saved scroll position (avoid jumping back to start on rerender)
	            try {
	                costChartState.__toggleScroll = costChartState.__toggleScroll || {};
	                const saved = costChartState.__toggleScroll[kind];
	                if (typeof saved === 'number' && isFinite(saved)) scroller.scrollLeft = Math.max(0, saved);
	            } catch(e) {}
	            scroller.addEventListener('scroll', ()=>{
	                try {
	                    costChartState.__toggleScroll = costChartState.__toggleScroll || {};
	                    costChartState.__toggleScroll[kind] = scroller.scrollLeft;
	                } catch(e) {}
	            });

	            const mkBtn = (text, val) => {
	                const b = document.createElement('div');
	                b.className = 'opt-subloc-btn' + ((String(curVal) === String(val)) ? ' active' : '');
	                b.textContent = String(text);
	                b.setAttribute('role','button');
	                b.setAttribute('tabindex','0');
	                b.addEventListener('click', (e)=>{
	                    // Preserve current scroll window position at time of selection.
	                    // This prevents the toggle strip from jumping when we rebuild the controls.
	                    try {
	                        costChartState.__toggleScroll = costChartState.__toggleScroll || {};
	                        costChartState.__toggleScroll[kind] = scroller.scrollLeft;
	                        costChartState.__toggleScrollLock = costChartState.__toggleScrollLock || {};
	                        costChartState.__toggleScrollLock[kind] = { left: scroller.scrollLeft, ts: Date.now() };
	                    } catch(_e) {}
	                    e.stopPropagation();
	                    onPick(val);
	                });
	                b.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') b.click(); });
	                return b;
	            };

	            scroller.appendChild(mkBtn('All', 'ALL'));
	            for (const it of (items || [])) scroller.appendChild(mkBtn(it, it));

	            // Keep toggle strip stable on user selection (restore prior scrollLeft).
	            // For programmatic changes (direct nav), gently ensure the active item is visible.
	            const postMountAdjust = ()=>{
	                try {
	                    const lock = costChartState.__toggleScrollLock && costChartState.__toggleScrollLock[kind];
	                    const now = Date.now();
	                    if (lock && typeof lock.left === 'number' && (now - (lock.ts || 0)) < 800) {
	                        scroller.scrollLeft = Math.max(0, lock.left);
	                        costChartState.__toggleScroll = costChartState.__toggleScroll || {};
	                        costChartState.__toggleScroll[kind] = scroller.scrollLeft;
	                        // Clear lock so future programmatic changes can auto-reveal selection.
	                        try { delete costChartState.__toggleScrollLock[kind]; } catch(_e) {}
	                        return;
	                    }
	
	                    const active = scroller.querySelector('.opt-subloc-btn.active');
	                    if (!active) return;
	                    const aLeft = active.offsetLeft;
	                    const aRight = aLeft + active.offsetWidth;
	                    const vLeft = scroller.scrollLeft;
	                    const vRight = vLeft + scroller.clientWidth;
	                    // Minimal scroll only if the active button is off-screen.
	                    if (aLeft < vLeft) scroller.scrollLeft = Math.max(0, aLeft - 18);
	                    else if (aRight > vRight) scroller.scrollLeft = aRight - scroller.clientWidth + 18;
	
	                    costChartState.__toggleScroll = costChartState.__toggleScroll || {};
	                    costChartState.__toggleScroll[kind] = scroller.scrollLeft;
	                } catch(e) {}
	            };
	            requestAnimationFrame(()=>requestAnimationFrame(postMountAdjust));


	            // Hide arrows when all items fit. Recompute after mount + on resize.
	            const updateArrows = () => {
	                try {
	                    const overflow = (scroller.scrollWidth - scroller.clientWidth) > 2;
	                    left.style.display = overflow ? 'flex' : 'none';
	                    right.style.display = overflow ? 'flex' : 'none';
	                    bar.classList.toggle('no-arrows', !overflow);
	                } catch(e) {}
	            };

	            // Arrow scrolling
	            const doScroll = (dir) => {
	                const amt = Math.max(140, Math.floor(scroller.clientWidth * 0.6));
	                try { scroller.scrollBy({ left: dir * amt, behavior: 'smooth' }); }
	                catch(e){ scroller.scrollLeft += dir * amt; }
	            };
	            const bindArrow = (el, dir) => {
	                el.addEventListener('click', (e)=>{ e.stopPropagation(); doScroll(dir); });
	                el.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); doScroll(dir); } });
	            };
	            bindArrow(left, -1);
	            bindArrow(right, +1);

	            // Drag scrolling (mouse + touch)
	            let isDown = false;
	            let startX = 0;
	            let startLeft = 0;
	            const onDown = (e) => {
	                // Do not start drag from a button click.
	                if (e && e.target && e.target.closest && e.target.closest('.opt-subloc-btn')) return;
	                isDown = true;
	                scroller.classList.add('dragging');
	                startX = (e.touches && e.touches[0] ? e.touches[0].pageX : e.pageX);
	                startLeft = scroller.scrollLeft;
	            };
	            const onMove = (e) => {
	                if (!isDown) return;
	                const x = (e.touches && e.touches[0] ? e.touches[0].pageX : e.pageX);
	                const dx = x - startX;
	                scroller.scrollLeft = startLeft - dx;
	                try { e.preventDefault(); } catch(_e) {}
	            };
	            const onUp = () => {
	                isDown = false;
	                scroller.classList.remove('dragging');
	            };
	            scroller.addEventListener('mousedown', onDown);
	            window.addEventListener('mousemove', onMove);
	            window.addEventListener('mouseup', onUp);
	            scroller.addEventListener('mouseleave', onUp);
	            scroller.addEventListener('touchstart', onDown, { passive: false });
	            scroller.addEventListener('touchmove', onMove, { passive: false });
	            scroller.addEventListener('touchend', onUp);
	            scroller.addEventListener('touchcancel', onUp);

	            bar.appendChild(left);
	            bar.appendChild(scroller);
	            bar.appendChild(right);
	            try { requestAnimationFrame(()=>requestAnimationFrame(updateArrows)); } catch(e) {}
	            try {
	                if (typeof ResizeObserver !== 'undefined') {
	                    const ro = new ResizeObserver(()=>updateArrows());
	                    ro.observe(scroller);
	                    ro.observe(bar);
	                } else {
	                    window.addEventListener('resize', updateArrows);
	                }
	            } catch(e) {}
	            return bar;
	        }

	        function buildLocationAndSublocControls(){
            const map = (costChartState && costChartState.itemSublocMap && typeof costChartState.itemSublocMap === 'object')
                ? costChartState.itemSublocMap
                : null;
            if (!map || !Array.isArray(map.locations) || !map.locations.length) return null;

	            // Single-row, side-by-side controls (Location bar + Sublocation bar)
	            const container = document.createElement('div');
	            container.className = 'chart-loc-subloc-controls chart-loc-subloc-inline';
	            container.style.cssText = 'display:flex; flex-direction:row; gap:10px; align-items:center; max-width:100%; overflow:hidden;';

            const curLoc = String(costChartState.itemLocFilter || 'ALL');
            const curSub = String(costChartState.itemSublocFilter || 'ALL');

	            // Location toggles (scrollable)
	            container.appendChild(_mkToggleBar(map.locations, curLoc, (val)=>{
                    costChartState.itemLocFilter = String(val);
                    costChartState.itemSublocFilter = 'ALL';
                    try {
                        console.log('🧭 Toggle pick (Location):', {
                            itemCode: costChartState.itemSublocItemCode || '',
                            itemLocFilter: costChartState.itemLocFilter,
                            itemSublocFilter: costChartState.itemSublocFilter,
                            chartType: costChartState.chartType
                        });
                    } catch (e) {}
                    try { refreshLocationAndSublocControls(); } catch(e) {}
                    if (costChartState.chartType === 'bar-chart') {
                        try { scheduleChartsRedraw('locFilter'); } catch(e) {}
                    }
}, 'loc'));

            // Keep sublocation toggle visible in vertical view.
            const subChoices = (curLoc && curLoc !== 'ALL' && map.byLocation && map.byLocation[curLoc]) ? map.byLocation[curLoc] : ['ALL'];
            container.appendChild(_mkToggleBar(subChoices, curSub, (val)=>{
                        costChartState.itemSublocFilter = String(val);
                        try {
                            console.log('🧭 Toggle pick (Sublocation):', {
                                itemCode: costChartState.itemSublocItemCode || '',
                                itemLocFilter: costChartState.itemLocFilter,
                                itemSublocFilter: costChartState.itemSublocFilter,
                                chartType: costChartState.chartType
                            });
                        } catch (e) {}
                        try { refreshLocationAndSublocControls(); } catch(e) {}
                        if (costChartState.chartType === 'bar-chart') {
                            try { scheduleChartsRedraw('sublocFilter'); } catch(e) {}
                        }
}, 'subloc'));
            return container;
        }

	        // Rebuild the location/sublocation toggle DOM in-place.
	        // Needed because setScaleContainerModeForChartType() does not rebuild when mode stays 'context'.
	        function refreshLocationAndSublocControls(){
	            try {
	                const scaleDiv = document.getElementById('costChartScaleContainer');
	                if (!scaleDiv) return;
	                if ((scaleDiv.dataset && scaleDiv.dataset.mode) !== 'context') return;
	                const wrapper = scaleDiv.querySelector('.cost-scale-wrapper');
	                if (!wrapper) return;
	                const existing = wrapper.querySelector('.chart-loc-subloc-controls');
	                if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
	                const fresh = buildLocationAndSublocControls();
	                if (!fresh) return;
	                fresh.style.marginRight = '12px';
	                const anchor = wrapper.querySelector('.scale-context-control') || wrapper.querySelector('.cost-scale-context') || null;
	                if (anchor && anchor.parentNode === wrapper) wrapper.insertBefore(fresh, anchor);
	                else wrapper.insertBefore(fresh, wrapper.firstChild);
	            } catch(e) {}
	        }


        // --- Scale container mode management ---
        function setScaleContainerModeForChartType(chartType) {
            const scaleDiv = document.getElementById('costChartScaleContainer');
            if (!scaleDiv) return;

            const desiredMode = (chartType === 'cost-bar') ? 'scale' : (chartType === 'bar-chart') ? 'context' : 'hidden';

            // Per requirement: sublocation filter is for the current chart view only.
            // Reset it when leaving the vertical bar chart view.
            if (desiredMode !== 'context') {
                // NOTE: keep location filter sticky across chart views
                // try { costChartState.itemLocFilter = 'ALL'; } catch(e) {}
                try { costChartState.itemSublocFilter = 'ALL'; } catch(e) {}
                try { costChartState.itemSublocMap = null; } catch(e) {}
                try { costChartState.itemSublocItemCode = ''; } catch(e) {}
            }
            const currentMode = scaleDiv.dataset.mode || '';

            if (desiredMode === 'hidden') {
                // Always park controls back into the parking node before clearing,
                // otherwise they can get orphaned / overlap other chart modes.
                try { parkChartControls(); } catch (e) {}
                scaleDiv.dataset.mode = 'hidden';
                scaleDiv.classList.add('hidden');
                scaleDiv.innerHTML = '';
                // Also explicitly hide the controls themselves (they remain parked in DOM)
                try { updateDateRangeControlsVisibility(); } catch (e) {}
                return;
            }

            const animateSwap = (currentMode && currentMode !== desiredMode);
            if (animateSwap) {
                scaleDiv.classList.add('hidden');
            }

            const apply = () => {
                scaleDiv.dataset.mode = desiredMode;
                parkChartControls();
                try { ensureDateRangeInHeader(); } catch(e) {}
                scaleDiv.innerHTML = '';

                const wrapper = document.createElement('div');
                wrapper.className = 'cost-scale-wrapper';
                wrapper.style.cssText = `
                    position: relative;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    padding: 0 14px;
                    box-sizing: border-box;
                `;

                // Keep the same visual language as the horizontal scale strip
                wrapper.style.borderBottom = '5px solid var(--teal-primary)';

                const outerRow = document.createElement('div');
                outerRow.className = 'cost-scale-row';
                outerRow.style.cssText = `
                    position: relative;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                `;

                // Per UX: put the toggle bars INSIDE the cost-scale-wrapper, before scale-context-control.
                // This keeps toggles + scale controls on the same row and preserves the sticky strip feel.
                if (desiredMode === 'context') {
                    try {
                        const t = buildLocationAndSublocControls();
                        if (t) {
                            t.style.marginRight = '12px';
                            wrapper.appendChild(t);
                        }
                    } catch (e) {}
                }

                outerRow.appendChild(wrapper);

                if (desiredMode === 'context') {
                    // toggles on left, scale controls on right
                    wrapper.style.justifyContent = 'space-between';
                    mountChartControlsIntoScale(wrapper, { showRange: true, showDrill: true, absolute: false });
                    scaleDiv.appendChild(outerRow);
                } else {
                    // 'scale' mode: drawCostChart() will rebuild numeric labels via createStickyScale().
                    // Do NOT mount date/drill controls here (they would overlap the numeric scale).
                    wrapper.style.justifyContent = 'flex-start';
                    scaleDiv.appendChild(outerRow);
                }

                scaleDiv.classList.remove('hidden');
                updateDateRangeControlsVisibility();
            };

            if (animateSwap) {
                setTimeout(apply, 220);} else {
                apply();
            }
        }

        function mountChartControlsIntoScale(scaleWrapper, opts = {}) {
            const { showRange = true, showDrill = false, absolute = true } = opts;

            // NOTE: Date range stays in the main header (do not remount/move it into the scale strip).
            const drillContainer = document.getElementById('verticalDrillContainer');
            if (!drillContainer) return;
const holder = document.createElement('div');
            holder.className = 'scale-context-controls';
            holder.style.display = 'flex';
            holder.style.alignItems = 'center';
            holder.style.gap = '14px';
            holder.style.maxWidth = '100%';
            holder.style.flexWrap = 'wrap';
            holder.style.justifyContent = 'flex-end';
            holder.style.overflow = 'visible';

            if (absolute) {
                holder.style.position = 'absolute';
                holder.style.right = '14px';
                holder.style.top = '50%';
                holder.style.transform = 'translateY(-50%)';
            } else {
                // In-context (non-absolute) mounts should not push content offscreen.
                holder.style.marginLeft = 'auto';
            }
if (drillContainer) {
                drillContainer.style.display = showDrill ? 'inline-flex' : 'none';
                holder.appendChild(drillContainer);
            }

            scaleWrapper.appendChild(holder);
            // Re-bind controls after remount (DOM moves can drop listeners if elements were recreated)
            try { setupVerticalDrillControls(); } catch(e) {}
            try { setupDateRangeControls && setupDateRangeControls(); } catch(e) {}

        }


        
// Ensure chart controls are never destroyed when we rebuild the scale strip.
// We "park" them back into the hidden #chartContextControls container before clearing #costChartScaleContainer.
function getChartControlsParkingNode() {
    const inner = document.querySelector('#chartContextControls .chart-context-inner');
    if (inner) return inner;

    // Fallback: create an offscreen parking lot
    let lot = document.getElementById('chartControlsParkingLot');
    if (!lot) {
        lot = document.createElement('div');
        lot.id = 'chartControlsParkingLot';
        lot.style.cssText = 'position:absolute; left:-9999px; top:-9999px; width:1px; height:1px; overflow:hidden;';
        document.body.appendChild(lot);
    }
    return lot;
}

function parkChartControls() {
    const parking = getChartControlsParkingNode();
    const drillContainer = document.getElementById('verticalDrillContainer');

    // Date range should remain in the main header (persistent across chart views).
    // Only park drill controls when they are mounted into the scale strip.
    if (drillContainer && drillContainer.closest('#costChartScaleContainer')) {
        parking.appendChild(drillContainer);
    }
}

// Keep the date range control in the main header row, even after chart type swaps / scale strip rebuilds.
function ensureDateRangeInHeader() {
    const rangeContainer = document.getElementById('chartDateRangeContainer');
    const controlsLeft = document.querySelector('.chart-controls-header .controls-left');

    // Header may not be mounted yet during cached re-init / fast chart swaps.
    // Retry a few frames so the date picker never gets stranded in the parking node.
    if (!rangeContainer || !controlsLeft) {
        try {
            costChartState.__dateRangeHeaderRetry = (costChartState.__dateRangeHeaderRetry || 0) + 1;
            if (costChartState.__dateRangeHeaderRetry <= 12) {
                requestAnimationFrame(ensureDateRangeInHeader);
            } else {
                costChartState.__dateRangeHeaderRetry = 0;
            }
        } catch (e) {}
        return;
    }
    try { costChartState.__dateRangeHeaderRetry = 0; } catch (e) {}

    // Already in the right place
    if (rangeContainer.parentElement === controlsLeft) {
        rangeContainer.style.display = 'inline-flex';
        return;
    }

    // Insert after the first vertical divider (after View By)
    const dividers = controlsLeft.querySelectorAll('.controls-divider');
    if (dividers && dividers.length) {
        dividers[0].insertAdjacentElement('afterend', rangeContainer);
    } else {
        controlsLeft.appendChild(rangeContainer);
    }

    rangeContainer.style.display = 'inline-flex';
}


function setupDateRangeControls() {
            const fromEl = document.getElementById('chartFromDate');
            try { ensureDateRangeInHeader(); } catch(e) {}
            const toEl = document.getElementById('chartToDate');
            const presetEl = document.getElementById('chartDatePreset');
            const outlookEl = document.getElementById('chartOutlookDays');
            const pillBtn = document.getElementById('chartRangePill');
            const pillText = document.getElementById('chartRangePillText');
            const popover = document.getElementById('chartRangePopover');


            if (!fromEl || !toEl || !presetEl) return;

            // Load saved values
            const savedPreset = (localStorage.getItem('chartsDatePreset') || costChartState.dateRangeDays || 'all').toString();
            const savedFrom = localStorage.getItem('chartsFromDate') || '';
            const savedTo = localStorage.getItem('chartsToDate') || '';

            let savedOutlook = parseInt(localStorage.getItem('chartsOutlookDays') || (costChartState.outlookDays || 0), 10);
            if (!Number.isFinite(savedOutlook)) savedOutlook = 0;
            // We now expose Projection in months (3/6/9). Clamp old day-based values.
            const allowedOutlook = new Set([0, 90, 180, 270]);
            if (!allowedOutlook.has(savedOutlook)) savedOutlook = 0;

            presetEl.value = (['all','7','30','90','180','270','custom'].includes(savedPreset) ? savedPreset : 'all');
            fromEl.value = savedFrom;
            toEl.value = savedTo;

            if (outlookEl) outlookEl.value = String(savedOutlook);
            costChartState.outlookDays = savedOutlook;

            
            // Constrain date picker to actual transaction dates (excluding outlook)
            // IMPORTANT: must cover *all* loaded months (Dec + Jan, etc.), not a single hardcoded file.
            const getTransactionDateBoundsISO = () => {
                try {
                    // Prefer the merged raw transactions shipped from the Dashboard.
                    const tx = (costChartState && costChartState.cachedMockData && costChartState.cachedMockData.transactions)
                        ? costChartState.cachedMockData.transactions
                        : (cachedMockData && cachedMockData.transactions ? cachedMockData.transactions : null);

                    let minISO = null, maxISO = null;
                    if (tx && typeof tx === 'object') {
                        for (const k of Object.keys(tx)) {
                            const hist = tx[k] && Array.isArray(tx[k].history) ? tx[k].history : null;
                            if (!hist || !hist.length) continue;
                            for (let i = 0; i < hist.length; i++) {
                                const t = hist[i] || {};
                                const d = t && (t.transDate || t.date || t.transdate);
                                if (!d || typeof d !== 'string' || d.length < 10) continue;
                                const iso = d.slice(0, 10);
                                if (!minISO || iso < minISO) minISO = iso;
                                if (!maxISO || iso > maxISO) maxISO = iso;
                            }
                        }
                        if (minISO && maxISO) return { minISO, maxISO };
                    }

                    // Fallback: scan global transaction variables if present in this iframe context.
                    const targetWindow = globalThis;
                    const keys = Object.keys(targetWindow).filter(k => /^TRANSACTION_\d{4}_\d{2}(?:_\d{2})?$/.test(k));
                    for (const varName of keys) {
                        const src = targetWindow[varName];
                        if (!src || typeof src !== 'object') continue;
                        for (const kk of Object.keys(src)) {
                            const hist = src[kk] && Array.isArray(src[kk].history) ? src[kk].history : null;
                            if (!hist) continue;
                            for (let i = 0; i < hist.length; i++) {
                                const t = hist[i] || {};
                                const d = t && (t.transDate || t.date || t.transdate);
                                if (!d || typeof d !== 'string' || d.length < 10) continue;
                                const iso = d.slice(0, 10);
                                if (!minISO || iso < minISO) minISO = iso;
                                if (!maxISO || iso > maxISO) maxISO = iso;
                            }
                        }
                    }
                    if (!minISO || !maxISO) return null;
                    return { minISO, maxISO };
                } catch (e) {
                    return null;
                }
            };

            const __bounds = getTransactionDateBoundsISO();
            // Expose bounds for other helpers (e.g., usage totals in cost-bar)
            costChartState._txDateBounds = __bounds || null;
            if (__bounds) {
                fromEl.min = __bounds.minISO;
                fromEl.max = __bounds.maxISO;
                toEl.min = __bounds.minISO;
                toEl.max = __bounds.maxISO;

                
                // Restrict To-date to not exceed today (projection is controlled separately)
                const __todayISO = new Date().toISOString().split('T')[0];
                const __toMaxISO = (__bounds.maxISO && __bounds.maxISO < __todayISO) ? __bounds.maxISO : __todayISO;
                fromEl.max = __toMaxISO;
                toEl.max = __toMaxISO;

// Clamp any stored values into bounds
                if (fromEl.value && fromEl.value < __bounds.minISO) fromEl.value = __bounds.minISO;
                if (fromEl.value && fromEl.value > __toMaxISO) fromEl.value = __toMaxISO;
                if (toEl.value && toEl.value < __bounds.minISO) toEl.value = __bounds.minISO;
                if (toEl.value && toEl.value > __toMaxISO) toEl.value = __toMaxISO;

                // Ensure ordering
                if (fromEl.value && toEl.value && fromEl.value > toEl.value) fromEl.value = toEl.value;

            // Disable/gray-out presets that exceed available historical data
            const updatePresetAvailability = () => {
                try {
                    const pop = document.getElementById('chartRangePopover');
                    const minISO = __bounds && __bounds.minISO ? __bounds.minISO : null;
                    const maxISO = (__bounds && __bounds.maxISO) ? __bounds.maxISO : null;
                    const todayISO = new Date().toISOString().split('T')[0];
                    const maxSelectableISO = maxISO && maxISO < todayISO ? maxISO : todayISO;
                    if (!minISO || !maxSelectableISO) return;

                    const start = new Date(minISO + 'T00:00:00');
                    const end = new Date(maxSelectableISO + 'T00:00:00');
                    const availableDays = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));

                    const shouldDisable = (days) => (Number.isFinite(days) && days > 0 && availableDays < days);

                    // Popover buttons
                    if (pop) {
                        pop.querySelectorAll('.range-preset-btn').forEach(btn => {
                            const p = (btn.getAttribute('data-preset') || '').trim();
                            const d = parseInt(p, 10);
                            const dis = shouldDisable(d);
                            btn.classList.toggle('is-disabled', dis);
                            btn.disabled = !!dis;
                            btn.setAttribute('aria-disabled', dis ? 'true' : 'false');
                            if (dis) btn.title = 'Not enough historical data for this preset';
                            else btn.title = '';
                        });
                    }

                    // Select options
                    if (presetEl && presetEl.options) {
                        Array.from(presetEl.options).forEach(opt => {
                            const v = (opt.value || '').trim();
                            const d = parseInt(v, 10);
                            opt.disabled = shouldDisable(d);
                        });
                        const cur = (presetEl.value || '').trim();
                        const curDays = parseInt(cur, 10);
                        if (shouldDisable(curDays)) {
                            presetEl.value = 'all';
                        }
                    }
                } catch (e) {}
            };

            } else {
                const __todayISO = new Date().toISOString().split('T')[0];
                try {
                    fromEl.max = __todayISO;
                    toEl.max = __todayISO;
                    if (fromEl.value && fromEl.value > __todayISO) fromEl.value = __todayISO;
                    if (toEl.value && toEl.value > __todayISO) toEl.value = __todayISO;
                } catch (e) {}
            }

const applyPreset = (preset) => {
                const __anchorISO = (__bounds && __bounds.maxISO) ? __bounds.maxISO : (new Date()).toISOString().split('T')[0];
                const today = new Date(__anchorISO + 'T00:00:00');
                const todayKey = __anchorISO;

                if (preset === 'all') {
                    fromEl.value = '';
                    toEl.value = '';
                } else if (preset === 'custom') {
                    // keep user-entered values
                    if (!toEl.value) toEl.value = todayKey;
                } else {
                    const days = parseInt(preset, 10);
                    if (isFinite(days) && days > 0) {
                        const from = new Date(today);
                        from.setDate(from.getDate() - days);
                        let __fromISO = from.toISOString().split('T')[0];
                        if (__bounds && __bounds.minISO && __fromISO < __bounds.minISO) __fromISO = __bounds.minISO;
                        fromEl.value = __fromISO;
                        toEl.value = todayKey;
                    }
                }

                // Persist
                try {
                    localStorage.setItem('chartsDatePreset', preset);
                    localStorage.setItem('chartsFromDate', fromEl.value || '');
                    localStorage.setItem('chartsToDate', toEl.value || '');
                } catch (e) {}
            };

            const triggerRedrawIfRelevant = () => {
                try {
                    localStorage.setItem('chartsDatePreset', presetEl.value);
                    localStorage.setItem('chartsFromDate', fromEl.value || '');
                    localStorage.setItem('chartsToDate', toEl.value || '');
                } catch (e) {}

                // IMPORTANT: Some chart types cache derived datasets (e.g., Flow/Sankey).
                // When the calendar range changes, invalidate those caches so the
                // next draw respects the new From/To window.
                try {
                    costChartState.stockFlowData = null;
                } catch (e) {}

                // Invalidate drill bin caches (weekly/day) so the next draw recomputes
                // aggregates for the new range.
                try {
                    if (costChartState._verticalDrillBinCache) {
                        const c = costChartState._verticalDrillBinCache;
                        if (c.dailyAggByRange && c.dailyAggByRange.clear) c.dailyAggByRange.clear();
                        if (c.binsByKey && c.binsByKey.clear) c.binsByKey.clear();
                    }
                } catch (e) {}

	                // Date range affects multiple chart types (bar, cost-bar, line trend charts, and flow/Sankey).
	                // Always redraw when the range changes so every view respects the same filter.
	                const ct = costChartState.chartType;
	                if (ct === 'bar-chart' || ct === 'cost-bar' || ct === 'line-chart' || ct === 'flow-chart') {
	                    if (costChartState && costChartState.chartType === 'flow-chart') invalidateFlowCache();
	                    scheduleChartsRedraw('dateRange');
	                }
            };

            const fmtPill = (iso) => {
                if (!iso || typeof iso !== 'string' || iso.length < 10) return '—';
                const [y,m,d] = iso.slice(0,10).split('-');
                return `${m}/${d}/${y}`;
            };

            const updateRangePill = () => {
                if (!pillText) return;
                const fromISO = fromEl.value || '';
                const toISO = toEl.value || '';
                pillText.textContent = `${fmtPill(fromISO)} → ${fmtPill(toISO)}`;
            };

            // Keep a single instance of the positioning handler per setup.
            let __rangePopoverPosHandler = null;
            const positionRangePopover = () => {
                if (!popover || !pillBtn) return;
                // Anchor to pill button and keep within viewport.
                const r = pillBtn.getBoundingClientRect();
                const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
                const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

                // Ensure fixed positioning so we're not clipped by overflow:hidden parents.
                popover.style.position = 'fixed';
                popover.style.zIndex = '5000';

                const margin = 10;
                // Prefer anchoring so the popover's RIGHT edge aligns with the pill's right edge.
                // This prevents clipping when the pill sits near the right side of the header.
                let top = Math.round(r.bottom + margin);

                // Measure intended width.
                // IMPORTANT: This popover is a 3-column layout (presets + 2 calendars + projection).
                // A 980px cap can squeeze the middle calendars enough that their internal content
                // overflows into the projection column, *appearing* as overlap.
                const leftPad = 20;
                const rightPad = 25;
                const popW = Math.min(1200, vw - (leftPad + rightPad));

                // Start by aligning the right edge to the pill button's right edge.
                let left = Math.round(r.right - popW);

                // Clamp horizontally and preserve right padding.
                left = Math.min(left, vw - rightPad - popW);
                left = Math.max(left, leftPad);

                // Clamp vertically; if not enough room below, flip above.
                const maxBelow = vh - top - 14;
                if (maxBelow < 260) {
                    const aboveTop = Math.round(r.top - margin);
                    // place above with some breathing room
                    top = Math.max(14, aboveTop - 320);
                }

                popover.style.left = left + 'px';
                popover.style.top = top + 'px';
                popover.style.width = popW + 'px';

                // Keep content visible even on small viewports.
                const maxH = Math.max(240, vh - top - 14);
                popover.style.maxHeight = maxH + 'px';
                popover.style.overflowY = 'auto';
            };

            const openPopover = () => {
                if (!popover) return;
                popover.classList.add('is-open');
                popover.setAttribute('aria-hidden', 'false');
                document.body.classList.add('chart-range-popover-open');
                positionRangePopover();
                if (!__rangePopoverPosHandler) {
                    __rangePopoverPosHandler = () => {
                        if (!popover || !popover.classList.contains('is-open')) return;
                        positionRangePopover();
                    };
                    window.addEventListener('resize', __rangePopoverPosHandler, { passive: true });
                    window.addEventListener('scroll', __rangePopoverPosHandler, { passive: true, capture: true });
                }
            };
            const closePopover = () => {
                if (!popover) return;
                popover.classList.remove('is-open');
                popover.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('chart-range-popover-open');
                // Reset positioning styles so CSS can govern when remounted.
                popover.style.position = '';
                popover.style.left = '';
                popover.style.top = '';
                popover.style.width = '';
                popover.style.maxHeight = '';
                popover.style.overflowY = '';
                popover.style.zIndex = '';
            };

            // Expose a safe close hook so other navigation / chart-type switches can ensure
            // no invisible popover/backdrop blocks clicks when returning.
            costChartState._closeRangePopover = closePopover;

            // -----------------------------
            
            // Prevent clicks inside the popover from being interpreted as "outside" clicks.
            // This keeps the window open while selecting days/months/years.
            if (popover) {
                // IMPORTANT: Do NOT stop propagation during the capture phase.
                // Doing so prevents the event from reaching the actual day/month buttons
                // inside the calendar, making the popover appear "static".
                // We only stop bubbling so the global outside-click closer doesn't fire.
                popover.addEventListener('mousedown', (e) => { e.stopPropagation(); }, false);
                popover.addEventListener('click', (e) => { e.stopPropagation(); }, false);
                popover.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, false);
            }

// Robust click handling
            // -----------------------------
            // The dashboard sometimes parks/unparks the controls into different containers.
            // If the pill element is re-mounted, its direct listener can be lost.
            // Add a single delegated listener (capture) so the date picker always opens.
            if (!document.body.dataset.boundRangePillDelegation) {
                document.body.dataset.boundRangePillDelegation = '1';
                document.addEventListener('click', (e) => {
                    const btn = e.target && e.target.closest ? e.target.closest('#chartRangePill') : null;
                    if (!btn) return;
                    // Allow date picker for any chart type where the range controls are visible.
                    // (Range controls are shown for bar-chart and cost-bar.)
                    const rangeContainer = document.getElementById('chartDateRangeContainer');
                    if (rangeContainer && getComputedStyle(rangeContainer).display === 'none') return;
                    e.preventDefault();
                    e.stopPropagation();
                    const pop = document.getElementById('chartRangePopover');
                    if (!pop) return;
                    const isOpen = pop.classList.contains('is-open');
                    if (isOpen) {
                        try { costChartState._closeRangePopover && costChartState._closeRangePopover(); } catch (err) {}
                    } else {
                        openPopover();
                    }
                }, true);
            }

            if (pillBtn && pillBtn.dataset.bound !== '1') {
                pillBtn.dataset.bound = '1';
                pillBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!popover) return;
                    const isOpen = popover.classList.contains('is-open');
                    if (isOpen) closePopover(); else openPopover();
                });
                document.addEventListener('click', (e) => {
                    if (!popover || !popover.classList.contains('is-open')) return;
                    const container = document.getElementById('chartDateRangeContainer');
                    // popover is positioned fixed and may live outside the container; do not close when clicking inside it.
                    const clickedInside = (container && container.contains(e.target)) || (popover && popover.contains(e.target));
                    if (!clickedInside) closePopover();
                });
            }

            // -----------------------------
            // Calendar UI (two panes: From/To)
            // -----------------------------
            const calendarsHost = popover ? popover.querySelector('.chart-range-calendars') : null;
            const fmtMonthTitle = (d) => {
                const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                return `${months[d.getMonth()]} ${d.getFullYear()}`;
            };
            const toISO = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2,'0');
                const day = String(d.getDate()).padStart(2,'0');
                return `${y}-${m}-${day}`;
            };
            const parseISO = (iso) => {
                if (!iso || typeof iso !== 'string' || iso.length < 10) return null;
                const [y,m,d] = iso.slice(0,10).split('-').map(n => parseInt(n,10));
                if (!y || !m || !d) return null;
                return new Date(y, m-1, d);
            };

            // Year bounds for month/year dropdowns
            const getYearBounds = () => {
                try {
                    if (__bounds && __bounds.minISO && __bounds.maxISO) {
                        const minY = parseInt(__bounds.minISO.slice(0,4), 10);
                        const maxY = parseInt(__bounds.maxISO.slice(0,4), 10);
                        if (Number.isFinite(minY) && Number.isFinite(maxY)) {
                            return { minY, maxY };
                        }
                    }
                } catch (e) {}
                const nowY = new Date().getFullYear();
                return { minY: nowY - 2, maxY: nowY + 2 };
            };

            // Display months for the two panes.
            let calLeftMonth = null;
            let calRightMonth = null;
            const syncDisplayedMonths = () => {
                const toD = parseISO(toEl.value) || ( __bounds ? new Date(__bounds.maxISO + 'T00:00:00') : new Date());
                const fromD = parseISO(fromEl.value) || new Date(toD);
                calLeftMonth = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
                calRightMonth = new Date(toD.getFullYear(), toD.getMonth(), 1);
            };

            const buildMonthGrid = (monthDate, selectedFromISO, selectedToISO) => {
                const year = monthDate.getFullYear();
                const month = monthDate.getMonth();
                const __todayISO_cal = new Date().toISOString().split('T')[0];
                const __maxSelectableISO = (__bounds && __bounds.maxISO && __bounds.maxISO < __todayISO_cal) ? __bounds.maxISO : __todayISO_cal;

                const first = new Date(year, month, 1);
                const startDow = first.getDay(); // 0=Sun
                const start = new Date(year, month, 1 - startDow);
                const cells = [];
                const fromISO = selectedFromISO || '';
                const toISOv = selectedToISO || '';
                const inRange = (iso) => {
                    if (!fromISO || !toISOv) return false;
                    return iso >= fromISO && iso <= toISOv;
                };
                for (let i=0;i<42;i++) {
                    const d = new Date(start);
                    d.setDate(start.getDate() + i);
                    const iso = toISO(d);
                    const isOtherMonth = (d.getMonth() !== month);
                    const isStart = (fromISO && iso === fromISO);
                    const isEnd = (toISOv && iso === toISOv);
                    const isBetween = inRange(iso) && !isStart && !isEnd;
                    // bounds clamp
                    let disabled = false;
                    let hidden = false;
                    // Never allow selecting future dates in the calendar UI (To-date max is today)
                    if (iso > __todayISO_cal) { disabled = true; hidden = true; }
                    // If we know transaction bounds, also clamp to available history and max selectable
                    if (__bounds && __bounds.minISO && iso < __bounds.minISO) { disabled = true; }
                    if (__bounds && __bounds.maxISO && iso > __maxSelectableISO) { disabled = true; hidden = true; }
                    // Also hide any day that is after the max selectable date (even if bounds missing)
                    if (!__bounds && iso > __todayISO_cal) { hidden = true; disabled = true; }
                    cells.push({ day: d.getDate(), iso, isOtherMonth, isStart, isEnd, isBetween, disabled, hidden });
                }
                return cells;
            };

            const renderCalendars = () => {
                if (!calendarsHost) return;
                if (!calLeftMonth || !calRightMonth) syncDisplayedMonths();
                const fromISO = fromEl.value || '';
                const toISOv = toEl.value || '';


                const { minY: __minY, maxY: __maxY } = getYearBounds();
                const yearsList = [];
                for (let y = __minY; y <= __maxY; y++) yearsList.push(y);

                const renderPane = (side, monthDate) => {
                    const title = fmtMonthTitle(monthDate);
                    const cells = buildMonthGrid(monthDate, fromISO, toISOv);
                    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                    const year = monthDate.getFullYear();
                    const monthIdx = monthDate.getMonth();

                    return `
                        <div class="chart-cal-card ${(()=>{try{const d=costChartState._calSlideDir&&costChartState._calSlideDir[side];return d?(`cal-slide-${d}`):"";}catch(e){return "";}})()}" data-side="${side}">
                          <div class="chart-cal-head">
                            <button type="button" class="chart-cal-nav-btn is-year" data-side="${side}" data-nav="year-prev" aria-label="Previous year">«</button>
                            <button type="button" class="chart-cal-nav-btn is-month" data-side="${side}" data-nav="month-prev" aria-label="Previous month">‹</button>

                            <div class="chart-cal-title-box" role="group" aria-label="Month and year selector">
                              <button type="button" class="chart-cal-title-btn" data-side="${side}" data-zoom="month" aria-label="Select month">
                                <span class="chart-cal-title-month">${months[monthIdx]}</span>
                              </button>
                              <span class="chart-cal-title-sep">·</span>
                              <button type="button" class="chart-cal-title-btn" data-side="${side}" data-zoom="year" aria-label="Select year">
                                <span class="chart-cal-title-year">${year}</span>
                              </button>
                            </div>

                            <button type="button" class="chart-cal-nav-btn is-month" data-side="${side}" data-nav="month-next" aria-label="Next month">›</button>
                            <button type="button" class="chart-cal-nav-btn is-year" data-side="${side}" data-nav="year-next" aria-label="Next year">»</button>

                            <div class="chart-cal-zoom-layer" data-side="${side}">
                              <div class="chart-cal-zoom-panel chart-cal-zoom-month" data-side="${side}">
                                ${months.map((m, i) => `<button type="button" class="chart-cal-zoom-option ${i===monthIdx ? 'is-active' : ''}" data-side="${side}" data-kind="month" data-value="${i}">${m}</button>`).join('')}
                              </div>
                              <div class="chart-cal-zoom-panel chart-cal-zoom-year" data-side="${side}">
                                ${yearsList.map((y) => `<button type="button" class="chart-cal-zoom-option ${y===year ? 'is-active' : ''}" data-side="${side}" data-kind="year" data-value="${y}">${y}</button>`).join('')}
                              </div>
                            </div>
                          </div>

                          <div class="chart-cal-dow">${dow.map(d=>`<div>${d}</div>`).join('')}</div>
                          <div class="chart-cal-grid">
                            ${cells.map(c => {
                                const cls = [
                                    'chart-cal-day',
                                    c.isOtherMonth ? 'is-muted' : '',
                                    c.isBetween ? 'is-between' : '',
                                    c.isStart ? 'is-from' : '',
                                    c.isEnd ? 'is-to' : ''
                                ].filter(Boolean).join(' ');
                                if (c.hidden) return `<div class="chart-cal-day chart-cal-day-empty" aria-hidden="true"></div>`;
                                return `<button type="button" class="${cls}" data-iso="${c.iso}" ${c.disabled ? 'disabled' : ''}>${c.day}</button>`;
                            }).join('')}
                          </div>
                        </div>
                    `;
                };

                calendarsHost.innerHTML = `
                    ${renderPane('from', calLeftMonth)}
                    ${renderPane('to', calRightMonth)}
                `;
            };

            // Keep calendar UI in sync when dates are changed via presets / inputs.
            const refreshCalendarsUI = () => {
                try {
                    syncDisplayedMonths();
                    renderCalendars();
                    positionRangePopover();
                } catch (e) {}
            };

            // Click handling for calendar UI (single delegated handler)
            if (popover && popover.dataset.boundCalendar !== '1') {
                popover.dataset.boundCalendar = '1';
                popover.addEventListener('click', (e) => {
                    // Close any open dropdowns when clicking outside them
                    const clickedDropdown = e.target && e.target.closest ? e.target.closest('.chart-cal-dropdown') : null;
                    if (!clickedDropdown) {
                        popover.querySelectorAll('.chart-cal-dropdown.is-open').forEach(dd => dd.classList.remove('is-open'));
                    }

                                        // Month/year navigation arrows
                    const navBtn = e.target && e.target.closest ? e.target.closest('.chart-cal-nav-btn') : null;
                    if (navBtn) {
                        const side = navBtn.getAttribute('data-side') || 'from';
                        const nav = navBtn.getAttribute('data-nav') || '';
                        const todayISO = new Date().toISOString().split('T')[0];
                        const maxISO = (__bounds && __bounds.maxISO) ? __bounds.maxISO : todayISO;
                        const maxSelectableISO = (maxISO && maxISO < todayISO) ? maxISO : todayISO;

                        const applyDir = (dir) => {
                            try {
                                if (!costChartState._calSlideDir) costChartState._calSlideDir = {};
                                costChartState._calSlideDir[side] = dir;
                            } catch (e) {}
                        };

                        // Clamp the *month being displayed* to the actual selectable range.
                        // Important: do NOT wrap Jan<->Dec within the same year at boundaries.
                        // Example: if we're already at the earliest month, month-prev should stop,
                        // not jump to Dec of the same year.
                        const clampMonthToBounds = (d) => {
                            try {
                                const minD = (__bounds && __bounds.minISO) ? (parseISO(__bounds.minISO) || null) : null;
                                const maxD = parseISO(maxSelectableISO) || null;
                                const minMonth = minD ? new Date(minD.getFullYear(), minD.getMonth(), 1) : null;
                                const maxMonth = maxD ? new Date(maxD.getFullYear(), maxD.getMonth(), 1) : null;
                                if (minMonth && d < minMonth) return minMonth;
                                if (maxMonth && d > maxMonth) return maxMonth;
                                return d;
                            } catch (e) { return d; }
                        };

                        const dir = (nav.includes('prev')) ? 'left' : 'right';
                        applyDir(dir);

                        if (side === 'from' && calLeftMonth) {
                            let d = new Date(calLeftMonth);
                            if (nav === 'month-prev') d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
                            if (nav === 'month-next') d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
                            if (nav === 'year-prev')  d = new Date(d.getFullYear() - 1, d.getMonth(), 1);
                            if (nav === 'year-next')  d = new Date(d.getFullYear() + 1, d.getMonth(), 1);
                            d = clampMonthToBounds(d);
                            calLeftMonth = d;
                        }
                        if (side === 'to' && calRightMonth) {
                            let d = new Date(calRightMonth);
                            if (nav === 'month-prev') d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
                            if (nav === 'month-next') d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
                            if (nav === 'year-prev')  d = new Date(d.getFullYear() - 1, d.getMonth(), 1);
                            if (nav === 'year-next')  d = new Date(d.getFullYear() + 1, d.getMonth(), 1);
                            d = clampMonthToBounds(d);
                            calRightMonth = d;
                        }

                        renderCalendars();
                        positionRangePopover();
                        // Clear slide dir after animation window
                        setTimeout(() => {
                            try {
                                if (costChartState._calSlideDir) costChartState._calSlideDir[side] = null;
                            } catch (e) {}
                        }, 260);
                        return;
                    }



// Month/year zoom toggle (in-frame overlay)
                    const zoomBtn = e.target && e.target.closest ? e.target.closest('.chart-cal-title-btn') : null;
                    if (zoomBtn) {
                        const side = zoomBtn.getAttribute('data-side') || 'from';
                        const zoom = zoomBtn.getAttribute('data-zoom') || '';
                        const card = zoomBtn.closest('.chart-cal-card');
                        if (!card) return;

                        // Close zoom layers on all other calendars
                        popover.querySelectorAll('.chart-cal-card.is-zoom-month, .chart-cal-card.is-zoom-year').forEach(other => {
                            if (other !== card) other.classList.remove('is-zoom-month', 'is-zoom-year');
                        });

                        // Zoom level hierarchy: day(0) -> month(1) -> year(2)
                        const levelMap = { day: 0, month: 1, year: 2 };
                        const curLevel = Number(card.getAttribute('data-zoom-level') || '0') || 0;
                        let nextLevel = curLevel;

                        if (zoom === 'month') {
                            // Toggle month layer (day <-> month)
                            nextLevel = (curLevel === 1) ? 0 : 1;
                        } else if (zoom === 'year') {
                            // Toggle year layer (month/year)
                            nextLevel = (curLevel === 2) ? 1 : 2;
                        }

                        // Direction: moving to higher level => zoom OUT, moving lower => zoom IN
                        const dir = (nextLevel > curLevel) ? 'zoom-out' : 'zoom-in';
                        card.classList.remove('zoom-out', 'zoom-in');
                        card.classList.add(dir);

                        // Apply level classes
                        card.classList.toggle('is-zoom-month', nextLevel === 1);
                        card.classList.toggle('is-zoom-year',  nextLevel === 2);

                        // Track current zoom level
                        card.setAttribute('data-zoom-level', String(nextLevel));

                        // Clean up direction class after animation
                        setTimeout(() => {
                            try { card.classList.remove('zoom-out', 'zoom-in'); } catch (e) {}
                        }, 220);

                        positionRangePopover();
                        return;
                    }

// Month/year dropdown option click
                    const ddOpt = e.target && e.target.closest ? e.target.closest('.chart-cal-zoom-option') : null;
                    if (ddOpt) {
                        const side = ddOpt.getAttribute('data-side') || 'from';
                        const kind = ddOpt.getAttribute('data-kind') || 'month';
                        const val = ddOpt.getAttribute('data-value');
                        if (kind === 'month') {
                            const m = parseInt(val || '0', 10);
                            if (Number.isFinite(m)) {
                                if (side === 'from' && calLeftMonth) calLeftMonth = new Date(calLeftMonth.getFullYear(), m, 1);
                                if (side === 'to' && calRightMonth) calRightMonth = new Date(calRightMonth.getFullYear(), m, 1);
                            }
                        } else if (kind === 'year') {
                            const y = parseInt(val || '0', 10);
                            if (Number.isFinite(y)) {
                                if (side === 'from' && calLeftMonth) calLeftMonth = new Date(y, calLeftMonth.getMonth(), 1);
                                if (side === 'to' && calRightMonth) calRightMonth = new Date(y, calRightMonth.getMonth(), 1);
                            }
                        }
                        // Close / cascade zoom layer with directional animation:
                        // - Selecting a YEAR should zoom IN to the month grid (year -> month)
                        // - Selecting a MONTH should zoom IN to the day grid (month -> day)
                        const card = ddOpt.closest('.chart-cal-card');
                        if (card) {
                            const curLevel = Number(card.getAttribute('data-zoom-level') || '0') || 0;
                            let nextLevel = curLevel;

                            if (kind === 'year') nextLevel = 1;
                            else if (kind === 'month') nextLevel = 0;

                            const dir = (nextLevel > curLevel) ? 'zoom-out' : 'zoom-in';
                            card.classList.remove('zoom-out', 'zoom-in');
                            card.classList.add(dir);

                            card.classList.toggle('is-zoom-month', nextLevel === 1);
                            card.classList.toggle('is-zoom-year',  nextLevel === 2);
                            card.setAttribute('data-zoom-level', String(nextLevel));

                            setTimeout(() => {
                                try { card.classList.remove('zoom-out', 'zoom-in'); } catch (e) {}
                            }, 220);
                        }

                        renderCalendars();
                        positionRangePopover();
                        return;
                    }

                    
                    // Close zoom overlays when clicking elsewhere inside the popover
                    if (! (e.target && e.target.closest && e.target.closest('.chart-cal-zoom-layer, .chart-cal-title-btn'))) {
                        popover.querySelectorAll('.chart-cal-card.is-zoom-month, .chart-cal-card.is-zoom-year').forEach(card => {
                            card.classList.remove('is-zoom-month','is-zoom-year');
                        });
                    }

const nav = e.target && e.target.closest ? e.target.closest('.chart-cal-nav-btn') : null;
                    if (nav) {
                        const side = nav.getAttribute('data-side');
                        const dir = parseInt(nav.getAttribute('data-dir') || '0', 10);
                        if (!dir) return;
                        if (side === 'from' && calLeftMonth) {
                            calLeftMonth = new Date(calLeftMonth.getFullYear(), calLeftMonth.getMonth() + dir, 1);
                        } else if (side === 'to' && calRightMonth) {
                            calRightMonth = new Date(calRightMonth.getFullYear(), calRightMonth.getMonth() + dir, 1);
                        }
                        renderCalendars();
                        positionRangePopover();
                        return;
                    }

                    const dayBtn = e.target && e.target.closest ? e.target.closest('.chart-cal-day') : null;
                    if (!dayBtn) return;
                    const iso = dayBtn.getAttribute('data-iso');
                    if (!iso) return;

                    // Hard guard: never allow selecting dates outside available history or beyond today,
                    // even if a button is accidentally rendered without the disabled attribute.
                    try {
                        const __todayISO_sel = new Date().toISOString().split('T')[0];
                        const __b = (__bounds && __bounds.minISO && __bounds.maxISO) ? __bounds : (costChartState._txDateBounds || null);
                        const __maxSelectableISO_sel = (__b && __b.maxISO && __b.maxISO < __todayISO_sel) ? __b.maxISO : __todayISO_sel;
                        if (iso > __maxSelectableISO_sel) return;
                        if (__b && __b.minISO && iso < __b.minISO) return;
                    } catch (e) {}

                    // Selection logic is side-aware:
                    // - Clicking in the LEFT calendar primarily edits From
                    // - Clicking in the RIGHT calendar primarily edits To
                    // This fixes the "To date can't be changed" bug caused by restarting selection when both were set.
                    const side = (dayBtn.closest && dayBtn.closest('.chart-cal-card'))
                        ? (dayBtn.closest('.chart-cal-card').getAttribute('data-side') || 'from')
                        : 'from';

                    const curFrom = fromEl.value || '';
                    const curTo = toEl.value || '';

                    if (side === 'to') {
                        // If range is empty, setting To should initialize both.
                        if (!curFrom && !curTo) {
                            fromEl.value = iso;
                            toEl.value = iso;
                        } else {
                            toEl.value = iso;
                            // Keep ordering sane
                            if (fromEl.value && toEl.value && toEl.value < fromEl.value) {
                                fromEl.value = toEl.value;
                            }
                        }
                    } else {
                        // side === 'from'
                        fromEl.value = iso;
                        // Keep ordering sane
                        if (fromEl.value && toEl.value && toEl.value < fromEl.value) {
                            toEl.value = fromEl.value;
                        }
                        // If To is empty, initialize it to From for a valid range.
                        if (!toEl.value) toEl.value = fromEl.value;
                    }

                    // Ensure preset is custom
                    presetEl.value = (fromEl.value || toEl.value) ? 'custom' : 'all';
                    updateRangePill();
                    try {
                        localStorage.setItem('chartsFromDate', fromEl.value || '');
                        localStorage.setItem('chartsToDate', toEl.value || '');
                        localStorage.setItem('chartsDatePreset', presetEl.value);
                    } catch (err) {}
                    renderCalendars();
                    triggerRedrawIfRelevant();
                });
            }

            // Preset buttons (left list)
            if (popover) {
                const btns = popover.querySelectorAll('.range-preset-btn');
                btns.forEach(btn => {
                    if (btn.dataset.bound === '1') return;
                    btn.dataset.bound = '1';
                    btn.addEventListener('click', () => {
                        const p = btn.getAttribute('data-preset') || 'all';
                        presetEl.value = p;
                        applyPreset(p);
                        btns.forEach(b => b.classList.toggle('is-active', b === btn));
                        updateRangePill();
                        refreshCalendarsUI();
                        try { updatePresetAvailability(); } catch(e) {}
                        triggerRedrawIfRelevant();
                    });
                });
            }

            presetEl.addEventListener('change', () => {
                applyPreset(presetEl.value);
                updateRangePill();
                refreshCalendarsUI();
                try { updatePresetAvailability(); } catch(e) {}
                triggerRedrawIfRelevant();
            });

            // Preset buttons inside the popover
            if (popover && popover.dataset.boundPresets !== '1') {
                popover.dataset.boundPresets = '1';
                popover.addEventListener('click', (e) => {
                    const btn = e.target && e.target.closest ? e.target.closest('.range-preset-btn') : null;
                    if (!btn) return;
                    const p = btn.getAttribute('data-preset') || 'custom';
                    presetEl.value = (['all','7','30','90','180','270','custom'].includes(p) ? p : 'custom');
                    // UI active state
                    popover.querySelectorAll('.range-preset-btn').forEach(b => b.classList.toggle('is-active', b === btn));
                    applyPreset(presetEl.value);
                    updateRangePill();
                    refreshCalendarsUI();
                    triggerRedrawIfRelevant();
                });
            }

            fromEl.addEventListener('change', () => {
                // user moved custom dates -> ensure preset is custom unless all blank
                if (!fromEl.value && !toEl.value) presetEl.value = 'all';
                else presetEl.value = 'custom';
                updateRangePill();
                refreshCalendarsUI();
                try { updatePresetAvailability(); } catch(e) {}
                triggerRedrawIfRelevant();
            });

            toEl.addEventListener('change', () => {
                if (!fromEl.value && !toEl.value) presetEl.value = 'all';
                else presetEl.value = 'custom';
                updateRangePill();
                refreshCalendarsUI();
                try { updatePresetAvailability(); } catch(e) {}
                triggerRedrawIfRelevant();
            });

            // Preset buttons inside the popover
            if (popover && popover.dataset.bound !== '1') {
                popover.dataset.bound = '1';
                popover.addEventListener('click', (e) => {
                    // Projection buttons (right column)
                    const pbtn = e.target && e.target.closest ? e.target.closest('.projection-btn') : null;
                    if (pbtn) {
                        const v = parseInt(pbtn.getAttribute('data-outlook') || '0', 10);
                        const val = Number.isFinite(v) ? v : 0;
                        if (outlookEl) outlookEl.value = String(val);
                        costChartState.outlookDays = val;
                        try { localStorage.setItem('chartsOutlookDays', String(val)); } catch (e) {}
                        // mark active
                        popover.querySelectorAll('.projection-btn').forEach(b => b.classList.toggle('is-active', b === pbtn));
                        scheduleChartsRedraw('outlook-change');
                        return;
                    }

                    const btn = e.target && e.target.closest ? e.target.closest('.range-preset-btn') : null;
                    if (!btn) return;
                    const preset = btn.getAttribute('data-preset') || 'custom';
                    presetEl.value = preset;
                    applyPreset(preset);
                    // mark active
                    popover.querySelectorAll('.range-preset-btn').forEach(b => b.classList.toggle('is-active', b === btn));
                    updateRangePill();
                    refreshCalendarsUI();
                    triggerRedrawIfRelevant();
                });
            }

            // Sync projection buttons active state on init
            try {
                if (popover) {
                    const cur = parseInt((outlookEl && outlookEl.value) ? outlookEl.value : '0', 10) || 0;
                    popover.querySelectorAll('.projection-btn').forEach(b => {
                        const v = parseInt(b.getAttribute('data-outlook') || '0', 10) || 0;
                        b.classList.toggle('is-active', v === cur);
                    });
                }
            } catch (e) {}

            // Projection (outlook) selector – months (3/6/9)
            if (outlookEl && outlookEl.dataset.bound !== '1') {
                outlookEl.dataset.bound = '1';
                outlookEl.addEventListener('change', () => {
                    const v = parseInt(outlookEl.value || '0', 10);
                    costChartState.outlookDays = Number.isFinite(v) ? v : 0;
                    try { localStorage.setItem('chartsOutlookDays', String(costChartState.outlookDays)); } catch (e) {}
                    scheduleChartsRedraw('outlook-change');
                });
            }

            // Apply initial preset effect
            applyPreset(presetEl.value);
            updateRangePill();
            syncDisplayedMonths();
            try { updatePresetAvailability(); } catch(e) {}
            renderCalendars();
        }


        function setupVerticalDrillControls() {
            const slider = document.getElementById('chartDrillSlider');
            if (!slider) return;

            // Initialize from state
            let lvl = costChartState.verticalDrillLevel;
            if (!Number.isFinite(lvl)) lvl = 1;
            lvl = Math.max(0, Math.min(2, lvl));
            slider.value = String(lvl);

            const persist = () => {
                try {
                    localStorage.setItem('verticalDrillLevel', String(costChartState.verticalDrillLevel));
                    localStorage.setItem('verticalDrillContext', JSON.stringify(costChartState.verticalDrillContext || null));
                } catch (e) {}
            };

                        if (slider.dataset && slider.dataset.boundInput === '1') {
                // already bound
            } else {
                if (slider.dataset) slider.dataset.boundInput = '1';
                slider.addEventListener('input', (e) => {
                const next = parseInt(slider.value, 10);
                costChartState.verticalDrillLevel = Math.max(0, Math.min(2, next));
                // When moving "up" to month, clear week scope; when moving "down" to day, keep last week scope if present
                if (costChartState.verticalDrillLevel === 0) {
                    costChartState.verticalDrillContext = null;
                }
                persist();
                if (costChartState.chartType === 'bar-chart') {
	                    if (costChartState && costChartState.chartType === 'flow-chart') invalidateFlowCache();
	                    scheduleChartsRedraw('dateRange');
                }
            });
            }

            persist();
        }

        function getSelectedDateRangeISO() {
            const fromEl = document.getElementById('chartFromDate');
            const toEl = document.getElementById('chartToDate');
            const presetEl = document.getElementById('chartDatePreset');

            const preset = (presetEl && presetEl.value) ? presetEl.value : (localStorage.getItem('chartsDatePreset') || 'all');
            const from = (fromEl && fromEl.value) ? fromEl.value : (localStorage.getItem('chartsFromDate') || '');
            const to = (toEl && toEl.value) ? toEl.value : (localStorage.getItem('chartsToDate') || '');

            if (preset === 'all' && !from && !to) return null;

            // Anchor to the latest transaction date when possible so ranges remain deterministic
            // even when the system clock is ahead of available history.
            const anchorISO = (costChartState && costChartState._txDateBounds && costChartState._txDateBounds.maxISO)
                ? costChartState._txDateBounds.maxISO
                : new Date().toISOString().split('T')[0];
            const toKey = to || anchorISO;
            const fromKey = from || '';

            return { from: fromKey, to: toKey };
        }


        
// ---------------------------------------------------------------------------------
// Transaction rates recompute (date-range aware)
// Vertical bar charts previously relied on precomputed 12-week arrays built at load time.
// That made date range pickers misleading and could hide recent month files (e.g., 2026_01).
// We rebuild usageRate/restockRate/wasteRate anchored to the selected range TO date.
// ---------------------------------------------------------------------------------
function ensureTransactionRatesForSelectedRange() {
    // If we are in true "All" mode (no from/to), prefer the precomputed weekly bins
    // shipped from the compute pipeline. This avoids a full O(items * tx * weeks) recompute
    // on every view switch and preserves multi-month visibility.
    const fromEl = document.getElementById('chartFromDate');
    const toEl = document.getElementById('chartToDate');
    const presetEl = document.getElementById('chartDatePreset');
    const isAllMode = (!fromEl || !fromEl.value) && (!toEl || !toEl.value) && (!presetEl || presetEl.value === 'all');

    if (isAllMode) {
        // Mark cache key so we don't thrash
        costChartState.__lastRatesRangeKey = '__ALL_PRECOMPUTED__';
        return;
    }

    const range = getSelectedDateRangeISO(); // {from,to} or null
    // IMPORTANT: use the canonical payload stored on costChartState when available.
    // Some navigation paths do not populate a global `cachedMockData`.
    const __md = (costChartState && costChartState.cachedMockData)
        ? costChartState.cachedMockData
        : ((typeof cachedMockData !== 'undefined' && cachedMockData) ? cachedMockData : null);
    const tx = (__md && __md.transactions) ? __md.transactions : null;
    if (!tx) return;

    // Build transaction aggregates once for fast filtered binning
    try { ensureTxDailyAggCache(); } catch (e) {}


    // Build a stable cache key
    const key = range ? `${range.from || ''}|${range.to || ''}` : '__ALL__';
    if (costChartState.__lastRatesRangeKey === key) return;
    costChartState.__lastRatesRangeKey = key;

    // Determine anchor + number of weeks
    let anchorISO = null;
    let fromISO = null;
    if (range) {
        anchorISO = range.to || new Date().toISOString().split('T')[0];
        fromISO = range.from || null;
    } else {
        // Anchor to the latest transaction date across all items for deterministic results
        let maxISO = null;
        for (const itemCode of Object.keys(tx)) {
            const h = tx[itemCode] && Array.isArray(tx[itemCode].history) ? tx[itemCode].history : [];
            if (!h.length) continue;
            const d = (h[h.length - 1].transDate || '').slice(0, 10);
            if (d && (!maxISO || d > maxISO)) maxISO = d;
        }
        anchorISO = maxISO || new Date().toISOString().split('T')[0];
    }

    const anchorDate = new Date(anchorISO + 'T00:00:00');
    const startDate = fromISO ? new Date(fromISO + 'T00:00:00') : null;

    let weeks = 12;
    if (startDate) {
        const diffDays = Math.max(1, Math.ceil((anchorDate - startDate) / (24 * 3600 * 1000)) + 1);
        weeks = Math.max(1, Math.ceil(diffDays / 7));
        weeks = Math.min(104, weeks); // cap at 2 years to protect render
    }

    // Precompute week boundaries once (shared across all items)
    const weekBoundaries = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const weekEnd = new Date(anchorDate);
        weekEnd.setDate(anchorDate.getDate() - (i * 7));
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekEnd.getDate() - 7);
        weekBoundaries.push({ start: weekStart, end: weekEnd, index: weeks - 1 - i });
    }

    const withinRange = (iso) => {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
        if (fromISO && iso < fromISO) return false;
        if (anchorISO && iso > anchorISO) return false;
        return true;
    };

    // Recompute rates for items currently loaded
    const items = Array.isArray(costChartState.items) ? costChartState.items : [];
    for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        const code = String(item.itemCode || item.ndc || '');
        const entry = tx[code];
        const hist = entry && Array.isArray(entry.history) ? entry.history : [];

        const usageRate = new Array(weeks).fill(0);
        const wasteRate = new Array(weeks).fill(0);
        const restockRate = new Array(weeks).fill(0);

        for (let j = 0; j < hist.length; j++) {
            const r = hist[j] || {};
            const iso = typeof r.transDate === 'string' ? r.transDate.slice(0, 10) : '';
            if (range && !withinRange(iso)) continue;

            const transDate = new Date(iso + 'T00:00:00');
            for (let w = 0; w < weekBoundaries.length; w++) {
                const wk = weekBoundaries[w];
                if (transDate >= wk.start && transDate < wk.end) {
                    const rawQty = (r.transQty ?? r.TransQty ?? r.qty ?? r.Qty ?? r.TRANSQTY ?? 0);
                    const absQty = Math.abs(parseFloat(rawQty) || 0);
                    if (!absQty) break;

                    const t = String(r.transactionType || '').toLowerCase();
                    if (t.includes('dispense')) usageRate[wk.index] += absQty;
                    else if (t.includes('waste')) wasteRate[wk.index] += absQty;
                    else if (t.includes('restock')) restockRate[wk.index] += absQty;
                    break;
                }
            }
        }

        item.usageRate = usageRate;
        item.wasteRate = wasteRate;
        item.restockRate = restockRate;
        item.restockRateCsv = restockRate.join(',');
    }
}

// ==================================================================================
// OPTION B: PRE-AGGREGATE TRANSACTIONS ONCE, THEN FILTER+BIN+CACHE FAST
// ==================================================================================
function ensureTxDailyAggCache() {
    // Builds a compact per-code per-day aggregate so charts can bin without rescanning raw rows.
    if (costChartState.__txDailyAggBuilt) return;
    // IMPORTANT: always read raw transactions from the charts state's cached payload.
    // Some navigation paths do not populate a global `cachedMockData` variable, but
    // `costChartState.cachedMockData` is the canonical source for Charts.
    const __md = (costChartState && costChartState.cachedMockData) ? costChartState.cachedMockData : (typeof cachedMockData !== 'undefined' ? cachedMockData : null);
    // If Charts state doesn't yet hold the payload but a global does, adopt it so all chart types stay consistent.
    if (__md && (!costChartState.cachedMockData)) { try { costChartState.cachedMockData = __md; } catch (e) {} }
    const txnRoot = (__md && __md.transactions) ? __md.transactions : null;
    if (!txnRoot) return;

    costChartState.__txDailyAggBuilt = true;
    costChartState.__txDailyAggByCode = Object.create(null); // code -> [{iso, u, r, w}]
    // Optional location-aware aggregates (code -> sublocCanon -> [{iso,u,r,w}])
    // This enables fast filtering by mainLocation / sublocation without rescanning raw histories every redraw.
    costChartState.__txDailyAggByCodeSubloc = Object.create(null);
    costChartState.__txDailyAggSublocMeta = Object.create(null); // code -> canon -> rawToken
    costChartState.__weekEndByISO = Object.create(null);      // iso -> weekEndISO (memo)
    costChartState.__vbinsCache = Object.create(null);        // cacheKey -> cached bins

    const parseISO10 = (s) => (typeof s === 'string' ? s.slice(0, 10) : '');
    const toWeekEndISO = (iso) => {
        if (!iso || iso.length < 10) return '';
        const cached = costChartState.__weekEndByISO[iso];
        if (cached) return cached;
        const d = new Date(iso + 'T00:00:00');
        const wEnd = endOfWeek(d);
        const wIso = toISODate(wEnd);
        costChartState.__weekEndByISO[iso] = wIso;
        return wIso;
    };

    const classify = (type, qty) => {
        // IMPORTANT:
        // Many datasets store DISPENSE as a positive quantity. If we infer solely from sign,
        // dispense rows get misclassified as restock and Usage totals become wildly wrong.
        // We therefore prioritize explicit type keywords first.
        const t = String(type || '').toLowerCase();
        if (t.includes('dispense') || t.includes('issue') || t.includes('admin') || t.includes('use') || t.includes('consum')) return 'usage';
        if (t.includes('waste') || t.includes('expire') || t.includes('return') || t.includes('dispose')) return 'waste';
        if (t.includes('restock') || t.includes('receive') || t.includes('receipt') || t.includes('inbound') || t.includes('purchase')) return 'restock';
        // Default: infer from sign
        return (qty >= 0) ? 'restock' : 'usage';
    };

    
    // Support raw merged transactions array format: [{ itemCode/ndc/..., transDate, qty, type, ... }]
    if (Array.isArray(txnRoot)) {
        const byCodeDay = Object.create(null); // code -> iso -> {u,r,w}
        const byCodeSublocDay = Object.create(null); // code -> canon -> iso -> {u,r,w}
        const byCodeSublocMeta = Object.create(null); // code -> canon -> raw
        for (let i = 0; i < txnRoot.length; i++) {
            const row = txnRoot[i] || {};
            const iso = parseISO10(row.transDate || row.TransDate || row.transactionDate || row.TransactionDate || row.date || row.Date);
            if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;

            // Determine code key used by items. Prefer itemCode, then alt_itemCode, then ndc.
            let code = row.itemCode || row.item_code || row.code || row.ndc || row.NDC || row.ItemCode;
            if (code == null) continue;
            code = String(code).trim();
            if (!code) continue;

            // Normalize variants to reduce key mismatches (leading zeros, dashed strings, etc.)
            const codeNorm = code.replace(/^0+/, '') || code;
            const codeNoDash = code.replace(/[\s-]/g, '');
            const codeNoDashNorm = codeNoDash ? (codeNoDash.replace(/^0+/, '') || codeNoDash) : '';
            const rawQty = (row.transQty ?? row.TransQty ?? row.qty ?? row.Qty ?? row.quantity ?? row.amount ?? row.delta ?? row.TRANSQTY ?? 0);
            const qty = Number(rawQty) || 0;
            if (!qty) continue;
            const kind = classify(row.type || row.transType || row.transactionType || row.category, qty);

            // Sublocation token (optional)
            const subRaw = _getTxnSublocRaw(row);
            const subCanon = _canonSublocExact(subRaw);

            const mapForCode = (byCodeDay[code] = byCodeDay[code] || Object.create(null));
            const mapForNorm = (byCodeDay[codeNorm] = byCodeDay[codeNorm] || mapForCode);
            // Also alias a de-dashed form (commonly seen with NDC-like ids)
            if (codeNoDash && codeNoDash !== code) byCodeDay[codeNoDash] = byCodeDay[codeNoDash] || mapForCode;
            if (codeNoDashNorm && codeNoDashNorm !== codeNoDash) byCodeDay[codeNoDashNorm] = byCodeDay[codeNoDashNorm] || mapForCode;

            const agg = (mapForCode[iso] = mapForCode[iso] || { u: 0, r: 0, w: 0 });
            if (kind === 'usage') agg.u += Math.abs(qty);
            else if (kind === 'waste') agg.w += Math.abs(qty);
            else agg.r += Math.abs(qty);

            // Also build code->subloc->day aggregates when sublocation exists
            if (subCanon) {
                const applyS = (k) => {
                    if (!byCodeSublocDay[k]) byCodeSublocDay[k] = Object.create(null);
                    if (!byCodeSublocDay[k][subCanon]) byCodeSublocDay[k][subCanon] = Object.create(null);
                    const day = byCodeSublocDay[k][subCanon];
                    if (!day[iso]) day[iso] = { u: 0, r: 0, w: 0 };
                    const a = day[iso];
                    if (kind === 'usage') a.u += Math.abs(qty);
                    else if (kind === 'waste') a.w += Math.abs(qty);
                    else a.r += Math.abs(qty);

                    if (!byCodeSublocMeta[k]) byCodeSublocMeta[k] = Object.create(null);
                    if (!byCodeSublocMeta[k][subCanon]) byCodeSublocMeta[k][subCanon] = String(subRaw || '').trim().toUpperCase();
                };
                applyS(code);
                if (codeNorm !== code) applyS(codeNorm);
                if (codeNoDash && codeNoDash !== code) applyS(codeNoDash);
                if (codeNoDashNorm && codeNoDashNorm !== codeNoDash) applyS(codeNoDashNorm);
            }
        }

        // Emit sorted daily arrays
        for (const code of Object.keys(byCodeDay)) {
            const dayAgg = byCodeDay[code];
            const isos = Object.keys(dayAgg).sort();
            if (!isos.length) continue;
            const arr = new Array(isos.length);
            for (let j = 0; j < isos.length; j++) {
                const iso = isos[j];
                const a = dayAgg[iso];
                arr[j] = { iso, u: a.u || 0, r: a.r || 0, w: a.w || 0 };
            }
            costChartState.__txDailyAggByCode[code] = arr;
        }

        // Emit sorted daily arrays for location-aware aggregates
        for (const code of Object.keys(byCodeSublocDay)) {
            const subMap = byCodeSublocDay[code];
            const outSub = Object.create(null);
            for (const canon of Object.keys(subMap)) {
                const dayAgg = subMap[canon];
                const isos = Object.keys(dayAgg).sort();
                const arr = new Array(isos.length);
                for (let j = 0; j < isos.length; j++) {
                    const iso = isos[j];
                    const a = dayAgg[iso] || {u:0,r:0,w:0};
                    arr[j] = { iso, u: a.u || 0, r: a.r || 0, w: a.w || 0 };
                }
                outSub[canon] = arr;
            }
            costChartState.__txDailyAggByCodeSubloc[code] = outSub;
        }
        costChartState.__txDailyAggSublocMeta = byCodeSublocMeta;
        return;
    }


    // Generic object format support. txnRoot may be:
    //  - code -> {history:[...]} / {records:[...]} / array
    //  - array-like object with numeric keys
    //  - wrapper object with .records / .history
    const looksLikeRow = (o) => {
        if (!o || typeof o !== 'object') return false;
        return !!(o.transDate || o.TransDate || o.transactionDate || o.TransactionDate || o.date || o.Date || o.postDate || o.PostDate);
    };
    const getRowsFromAny = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'object') {
            if (Array.isArray(v.records)) return v.records;
            if (Array.isArray(v.Records)) return v.Records;
            if (Array.isArray(v.history)) return v.history;
            if (Array.isArray(v.History)) return v.History;
            if (Array.isArray(v.transactions)) return v.transactions;
            if (Array.isArray(v.Transactions)) return v.Transactions;
            if (Array.isArray(v.tx)) return v.tx;
            if (Array.isArray(v.Tx)) return v.Tx;
            if (looksLikeRow(v)) return [v];
        }
        return [];
    };
    const parseDateToISO10 = (d) => {
        if (!d) return '';
        if (typeof d === 'string') {
            const s = d.trim();
            // ISO already
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
            // MM/DD/YYYY or M/D/YYYY
            const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (m) {
                const mm = String(m[1]).padStart(2,'0');
                const dd = String(m[2]).padStart(2,'0');
                return `${m[3]}-${mm}-${dd}`;
            }
        }
        // Date object or timestamp
        const dt = (d instanceof Date) ? d : new Date(d);
        if (!isFinite(dt.getTime())) return '';
        return toISODate(dt);
    };
    const readQty = (row) => {
        const q = (row.transQty ?? row.TransQty ?? row.TRANSQTY ??
                   row.qty ?? row.Qty ?? row.QTY ??
                   row.quantity ?? row.Quantity ??
                   row.amount ?? row.Amount ??
                   row.delta ?? row.Delta ??
                   row.dispenseQty ?? row.DispenseQty ??
                   row.receiveQty ?? row.ReceiveQty ??
                   0);
        const n = Number(q);
        return isFinite(n) ? n : 0;
    };

    // Flatten all rows we can find, group by code+day
    const byCodeDay = Object.create(null); // code -> iso -> {u,r,w}
    const byCodeSublocDay = Object.create(null); // code -> canon -> iso -> {u,r,w}
    const byCodeSublocMeta = Object.create(null); // code -> canon -> raw
    const entries = Object.entries(txnRoot);

    // If txnRoot is a wrapper object (e.g., {records:[...]}) treat it directly.
    const wrapperRows = getRowsFromAny(txnRoot);
    const processRows = (rows, fallbackCode) => {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] || {};
            const iso = parseDateToISO10(row.transDate || row.TransDate || row.transactionDate || row.TransactionDate || row.date || row.Date || row.postDate || row.PostDate || row.serviceDate || row.ServiceDate);
            if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;

            let code = row.itemCode || row.ItemCode || row.item_code || row.code || row.Code || row.ndc || row.NDC || row.drugCode || row.DrugCode || fallbackCode;
            if (code == null) continue;
            code = String(code).trim();
            if (!code) continue;

            const qty = readQty(row);
            if (!qty) continue;

            const type = row.type || row.Type || row.transType || row.TransType || row.transactionType || row.TransactionType || '';
            const cls = classify(type, qty);

            const subRaw = _getTxnSublocRaw(row);
            const subCanon = _canonSublocExact(subRaw);

            const codeKey = code;
            const codeKeyNorm = code.replace(/^0+/, '') || code;
            const codeKeyNoDash = code.replace(/[\s-]/g, '');
            const codeKeyNoDashNorm = codeKeyNoDash ? (codeKeyNoDash.replace(/^0+/, '') || codeKeyNoDash) : '';

            const apply = (k) => {
                if (!byCodeDay[k]) byCodeDay[k] = Object.create(null);
                const day = byCodeDay[k];
                if (!day[iso]) day[iso] = { u: 0, r: 0, w: 0 };
                const a = day[iso];
                if (cls === 'usage') a.u += Math.abs(qty);
                else if (cls === 'restock') a.r += Math.abs(qty);
                else a.w += Math.abs(qty);
            };
            apply(codeKey);
            if (codeKeyNorm !== codeKey) apply(codeKeyNorm);
            if (codeKeyNoDash && codeKeyNoDash !== codeKey) apply(codeKeyNoDash);
            if (codeKeyNoDashNorm && codeKeyNoDashNorm !== codeKeyNoDash) apply(codeKeyNoDashNorm);

            if (subCanon) {
                const applyS = (k) => {
                    if (!byCodeSublocDay[k]) byCodeSublocDay[k] = Object.create(null);
                    if (!byCodeSublocDay[k][subCanon]) byCodeSublocDay[k][subCanon] = Object.create(null);
                    const day = byCodeSublocDay[k][subCanon];
                    if (!day[iso]) day[iso] = { u: 0, r: 0, w: 0 };
                    const a = day[iso];
                    if (cls === 'usage') a.u += Math.abs(qty);
                    else if (cls === 'restock') a.r += Math.abs(qty);
                    else a.w += Math.abs(qty);

                    if (!byCodeSublocMeta[k]) byCodeSublocMeta[k] = Object.create(null);
                    if (!byCodeSublocMeta[k][subCanon]) byCodeSublocMeta[k][subCanon] = String(subRaw || '').trim().toUpperCase();
                };
                applyS(codeKey);
                if (codeKeyNorm !== codeKey) applyS(codeKeyNorm);
                if (codeKeyNoDash && codeKeyNoDash !== codeKey) applyS(codeKeyNoDash);
                if (codeKeyNoDashNorm && codeKeyNoDashNorm !== codeKeyNoDash) applyS(codeKeyNoDashNorm);
            }
        }
    };

    if (wrapperRows.length) {
        processRows(wrapperRows, '');
    } else {
        for (let ei = 0; ei < entries.length; ei++) {
            const k = entries[ei][0];
            const v = entries[ei][1];
            const rows = getRowsFromAny(v);
            if (rows.length) processRows(rows, k);
        }
    }

    // Materialize to sorted arrays
    for (const code of Object.keys(byCodeDay)) {
        const dayAgg = byCodeDay[code];
        const isos = Object.keys(dayAgg).sort();
        const arr = new Array(isos.length);
        for (let j = 0; j < isos.length; j++) {
            const iso = isos[j];
            const a = dayAgg[iso] || {u:0,r:0,w:0};
            arr[j] = { iso, u: a.u || 0, r: a.r || 0, w: a.w || 0 };
        }
        costChartState.__txDailyAggByCode[code] = arr;
    }

    // Materialize location-aware aggregates
    for (const code of Object.keys(byCodeSublocDay)) {
        const subMap = byCodeSublocDay[code];
        const outSub = Object.create(null);
        for (const canon of Object.keys(subMap)) {
            const dayAgg = subMap[canon];
            const isos = Object.keys(dayAgg).sort();
            const arr = new Array(isos.length);
            for (let j = 0; j < isos.length; j++) {
                const iso = isos[j];
                const a = dayAgg[iso] || {u:0,r:0,w:0};
                arr[j] = { iso, u: a.u || 0, r: a.r || 0, w: a.w || 0 };
            }
            outSub[canon] = arr;
        }
        costChartState.__txDailyAggByCodeSubloc[code] = outSub;
    }
    costChartState.__txDailyAggSublocMeta = byCodeSublocMeta;

}

function getFilterSignatureForBins() {
    // Stable-ish signature of current filter state for caching.
    const fd = costChartState.filterData || null;
    const stack = Array.isArray(costChartState.drillDownStack) ? costChartState.drillDownStack : [];
    const view = costChartState.verticalBarView || 'all';
    const lvl = costChartState.verticalDrillLevel ?? 0;
    const q = (costChartState.searchTerm || '').trim().toLowerCase();

    // Keep it small + stable
    const sigObj = {
        view,
        lvl,
        q,
        highlight: costChartState.highlightKey || '',
        // Include vertical bar location/sublocation toggles so drill-bin caches
        // are invalidated when the user changes these selections.
        // Without this, Day/Week bins can be reused across different toggle states,
        // making it look like sublocation filtering "does nothing".
        loc: (costChartState.itemLocFilter || 'ALL'),
        subloc: (costChartState.itemSublocFilter || 'ALL'),
        // include only the identifying bits of filterData (avoid massive payloads)
        fd: fd ? { mode: fd.mode || fd.viewMode || '', key: fd.key || fd.highlightKey || '' } : null,
        stack: stack.map(s => ({ mode: s.mode || '', key: s.key || s.value || '' }))
    };
    try { return JSON.stringify(sigObj); } catch (e) { return String(Date.now()); }
}

function dateToISO(d) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        function getDateRangeStartISO() {
            const v = (costChartState.dateRangeDays || 'all').toString();
            if (v === 'all') return null;
            const days = parseInt(v, 10);
            if (!isFinite(days) || days <= 0) return null;

            // Anchor presets to the latest transaction date (not system "today")
            const anchorISO = (costChartState._txDateBounds && costChartState._txDateBounds.maxISO)
                ? costChartState._txDateBounds.maxISO
                : (new Date()).toISOString().split('T')[0];

            const start = new Date(anchorISO + 'T00:00:00');
            // include anchor as day 0
            start.setDate(start.getDate() - (days - 1));
            return dateToISO(start);
        }

        function getActiveRangeDayCount() {
            // Computes inclusive day-count for the active From/To window.
            // Used for average-usage calculations in horizontal bars.
            const fromEl = document.getElementById('chartFromDate');
            const toEl = document.getElementById('chartToDate');
            const fromISO = (fromEl && fromEl.value) ? String(fromEl.value).slice(0, 10) : '';
            const toISO = (toEl && toEl.value) ? String(toEl.value).slice(0, 10) : '';

            // If no explicit end is selected, anchor to the latest tx date when available.
            const anchorISO = (costChartState._txDateBounds && costChartState._txDateBounds.maxISO)
                ? costChartState._txDateBounds.maxISO
                : (new Date()).toISOString().split('T')[0];

            const startISO = fromISO || getDateRangeStartISO();
            const endISO = toISO || anchorISO;

            // If we're truly in 'all' mode (no start computed), use tx bounds as best effort.
            if (!startISO) {
                const minISO = (costChartState._txDateBounds && costChartState._txDateBounds.minISO)
                    ? costChartState._txDateBounds.minISO
                    : '';
                if (minISO) {
                    const a = new Date(minISO + 'T00:00:00');
                    const b = new Date(anchorISO + 'T00:00:00');
                    const ms = Math.max(0, b.getTime() - a.getTime());
                    return Math.max(1, Math.floor(ms / 86400000) + 1);
                }
                return null;
            }

            const a = new Date(startISO + 'T00:00:00');
            const b = new Date(endISO + 'T00:00:00');
            if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
            const ms = Math.max(0, b.getTime() - a.getTime());
            return Math.max(1, Math.floor(ms / 86400000) + 1);
        }

        function sumDailyDispenseForItemInRange(itemOrCode) {
            // Prefer the same transaction-driven daily aggregates used by the vertical bar chart
            // so the horizontal cost/usage bars always match.
            try { ensureTxDailyAggCache(); } catch (e) {}

            // Accept either an item object or a raw code string.
            const itemObj = (itemOrCode && typeof itemOrCode === 'object') ? itemOrCode : null;
            const codeKey = itemObj ? String(itemObj.itemCode || itemObj.ItemCode || '') : String(itemOrCode);

            // Build a set of candidate identifiers that may appear in transactions.
            // IMPORTANT: transactions can be keyed by itemCode OR alt_itemCode OR NDC; the vertical bar chart
            // aggregates from raw tx rows and may align to any of those.
            const candidates = [];
            const pushKey = (k) => {
                if (k == null) return;
                const s = String(k).trim();
                if (!s) return;
                candidates.push(s);
                const norm = s.replace(/^0+/, '') || s;
                if (norm !== s) candidates.push(norm);
            };
            if (itemObj) {
                pushKey(itemObj.itemCode);
                pushKey(itemObj.alt_itemCode);
                pushKey(itemObj.altItemCode);
                pushKey(itemObj.ndc);
                pushKey(itemObj.NDC);
                pushKey(itemObj.drugCode);
                pushKey(itemObj.DrugCode);
            }
            // Always include the primary key passed.
            pushKey(codeKey);

            // Dedupe tx arrays by reference to avoid double-counting (some keys intentionally alias).
            const txArrays = [];
            const seenArr = new Set();

            // Read From/To from the picker.
            // IMPORTANT: Presets may NOT populate the From/To inputs (they often only set costChartState.dateRangeDays).
            // So we must fall back to preset-derived start and tx-bounds anchored end.
            const fromEl = document.getElementById('chartFromDate');
            const toEl = document.getElementById('chartToDate');
            const fromISO = (fromEl && fromEl.value) ? String(fromEl.value).slice(0,10) : '';
            const toISO = (toEl && toEl.value) ? String(toEl.value).slice(0,10) : '';

            // Anchor end to the latest transaction date when available (not system "today").
            const anchorISO = (costChartState._txDateBounds && costChartState._txDateBounds.maxISO)
                ? costChartState._txDateBounds.maxISO
                : (new Date()).toISOString().split('T')[0];

            // Compute start from explicit From input OR preset window.
            // Prefer the canonical helper which also respects localStorage + preset state.
            const __range = (typeof getSelectedDateRangeISO === 'function') ? getSelectedDateRangeISO() : null;
            let startISO = fromISO || (__range && __range.from ? __range.from : '') || getDateRangeStartISO();
            let endISO = toISO || (__range && __range.to ? __range.to : '') || anchorISO;

            // If we're in true 'all' mode (no preset + no from), try to use tx min bound.
            if (!startISO) {
                const minISO = (costChartState._txDateBounds && costChartState._txDateBounds.minISO)
                    ? costChartState._txDateBounds.minISO
                    : '';
                startISO = minISO || '';
            }

            // If we have the tx daily cache, sum usage (u) in-range.
            const txMap = (costChartState && costChartState.__txDailyAggByCode) ? costChartState.__txDailyAggByCode : null;
            if (txMap && candidates.length) {
                for (let i = 0; i < candidates.length; i++) {
                    const k = candidates[i];
                    const arr = txMap[k] || txMap[String(Number(k))];
                    if (arr && arr.length && !seenArr.has(arr)) {
                        seenArr.add(arr);
                        txArrays.push(arr);
                    }
                }
            }
            if (txArrays.length) {
                let sum = 0;
                const lo = startISO || '';
                const hi = endISO || '';
                for (let a = 0; a < txArrays.length; a++) {
                    const txArr = txArrays[a];
                    for (let i = 0; i < txArr.length; i++) {
                        const e = txArr[i];
                        const iso = e && e.iso ? e.iso : '';
                        if (!iso) continue;
                        if (lo && iso < lo) continue;
                        if (hi && iso > hi) continue;
                        sum += Number(e.u || 0) || 0;
                    }
                }
                return sum;
            }

            // Fallback: compute.js usage maps (may not align with tx aggregation in some datasets)
            const md = (typeof cachedMockData !== 'undefined' && cachedMockData) ? cachedMockData : (costChartState ? costChartState.cachedMockData : null);
            if (!md || !md.dailyDispense || !md.dailyDispense.byItem) return 0;

            // Try all candidate keys against dailyDispense as well.
            let series = null;
            for (let i = 0; i < candidates.length && !series; i++) {
                const k = candidates[i];
                series = md.dailyDispense.byItem[k] || md.dailyDispense.byItem[String(Number(k))] || null;
            }
            if (!series) return 0;

            const lo = startISO || '';
            const hi = endISO || '';
            let total = 0;
            for (let i = 0; i < series.length; i++) {
                const p = series[i];
                if (!p) continue;
                const iso = p.iso || p.date || p.day || '';
                if (!iso) continue;
                const d = String(iso).slice(0,10);
                if (lo && d < lo) continue;
                if (hi && d > hi) continue;
                total += Number(p.qty || p.value || p.u || 0) || 0;
            }
            return total;
        }

        
        function createCostBarIcon() {
            return `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none;">
                    <!-- Axes -->
                    <line x1="3" y1="20" x2="3" y2="4" stroke-linecap="round"/>
                    <line x1="3" y1="20" x2="21" y2="20" stroke-linecap="round"/>
                    <!-- Horizontal bars -->
                    <line x1="5" y1="7" x2="13" y2="7" stroke-width="2.5" stroke-linecap="round"/>
                    <line x1="5" y1="12" x2="18" y2="12" stroke-width="2.5" stroke-linecap="round"/>
                    <line x1="5" y1="17" x2="10" y2="17" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
            `;
        }
        
        function createLineChartIcon() {
            return `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none;">
                    <!-- Axes -->
                    <line x1="3" y1="20" x2="3" y2="4" stroke-linecap="round"/>
                    <line x1="3" y1="20" x2="21" y2="20" stroke-linecap="round"/>
                    <!-- Line chart -->
                    <polyline points="5,16 9,10 13,13 17,7 20,9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
        }
        
        function createTimeChartIcon() {
            return `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none;">
                    <!-- Axes -->
                    <line x1="3" y1="20" x2="3" y2="4" stroke-linecap="round"/>
                    <line x1="3" y1="20" x2="21" y2="20" stroke-linecap="round"/>
                    <!-- Line chart -->
                    <polyline points="5,15 9,9 13,11 17,6 20,8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <!-- Clock indicator -->
                    <circle cx="17" cy="14" r="3" stroke-width="1.5"/>
                    <line x1="17" y1="12.5" x2="17" y2="14" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="17" y1="14" x2="18.2" y2="14.7" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            `;
        }
        
        function createBarChartIcon() {
            return `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none;">
                    <!-- Axes -->
                    <line x1="3" y1="20" x2="3" y2="4" stroke-linecap="round"/>
                    <line x1="3" y1="20" x2="21" y2="20" stroke-linecap="round"/>
                    <!-- Vertical bars -->
                    <line x1="7" y1="20" x2="7" y2="12" stroke-width="2.5" stroke-linecap="round"/>
                    <line x1="11" y1="20" x2="11" y2="8" stroke-width="2.5" stroke-linecap="round"/>
                    <line x1="15" y1="20" x2="15" y2="14" stroke-width="2.5" stroke-linecap="round"/>
                    <line x1="19" y1="20" x2="19" y2="10" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
            `;
        }
        
        function createPieChartIcon() {
            return `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none;">
                    <!-- Pie chart circle -->
                    <circle cx="12" cy="12" r="8"/>
                    <!-- Pie slices -->
                    <path d="M12,4 L12,12 L19,9" fill="currentColor" opacity="0.3" stroke="none"/>
                    <line x1="12" y1="4" x2="12" y2="12" stroke-width="2"/>
                    <line x1="12" y1="12" x2="19" y2="9" stroke-width="2"/>
                </svg>
            `;
        }
        
        function createFlowChartIcon() {
            return `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none;">
                    <!-- Flow nodes -->
                    <rect x="4" y="4" width="5" height="3" rx="0.5" stroke-width="1.5"/>
                    <rect x="15" y="4" width="5" height="3" rx="0.5" stroke-width="1.5"/>
                    <rect x="9" y="10" width="6" height="3" rx="0.5" stroke-width="1.5"/>
                    <rect x="4" y="17" width="5" height="3" rx="0.5" stroke-width="1.5"/>
                    <rect x="15" y="17" width="5" height="3" rx="0.5" stroke-width="1.5"/>
                    <!-- Arrows -->
                    <line x1="6.5" y1="7" x2="12" y2="10" stroke-width="1.5"/>
                    <line x1="17.5" y1="7" x2="12" y2="10" stroke-width="1.5"/>
                    <line x1="12" y1="13" x2="6.5" y2="17" stroke-width="1.5"/>
                    <line x1="12" y1="13" x2="17.5" y2="17" stroke-width="1.5"/>
                </svg>
            `;
        }
        
        function createListIcon() {
            return `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;">
                    <circle cx="5" cy="6" r="2"/>
                    <rect x="9" y="5" width="13" height="2" rx="1"/>
                    <circle cx="5" cy="12" r="2"/>
                    <rect x="9" y="11" width="13" height="2" rx="1"/>
                    <circle cx="5" cy="18" r="2"/>
                    <rect x="9" y="17" width="13" height="2" rx="1"/>
                </svg>
            `;
        }
        
        // ------------------------------------------------------------------------------
        // Flow-mode buttons (Location | Group | Shift)
        // ------------------------------------------------------------------------------
        function initializeFlowModeButtons() {
            const icons = document.getElementById('chartTypeIcons');
            if (!icons) return;

            // Avoid double-init
            if (document.getElementById('flowModeControls')) return;

            const wrap = document.createElement('div');
            wrap.id = 'flowModeControls';
            wrap.className = 'inventory-stack-controls';
            wrap.style.gap = '6px';
            wrap.style.marginLeft = '10px';

            const divider = document.createElement('div');
            divider.className = 'controls-divider';
            divider.style.margin = '0 10px';
            divider.style.height = '24px';
            divider.style.alignSelf = 'center';

            const mkBtn = (label, mode) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'inventory-stack-btn';
                b.textContent = label;
                b.dataset.flowMode = mode;
                b.addEventListener('click', () => {
	                    try { costChartState.__toggleScroll = costChartState.__toggleScroll || {}; costChartState.__toggleScroll[kind] = scroller.scrollLeft; } catch(e) {}
	                    costChartState.flowMode = mode;
                    try { localStorage.setItem('flowMode', mode); } catch (e) {}
                    updateFlowModeButtonsActiveState();
                    // "refresh" behavior: recompute and redraw immediately
                    costChartState.stockFlowData = null;
                    ensureFlowDataReady();
                    switchChartType('flow-chart');
                });
                return b;
            };

            wrap.appendChild(mkBtn('Location', 'location'));
            wrap.appendChild(mkBtn('Group', 'group'));
            wrap.appendChild(mkBtn('Shift', 'shift'));

            // Insert right after the icon strip
            const parent = icons.parentElement;
            parent.appendChild(divider);
            parent.appendChild(wrap);

            updateFlowModeButtonsActiveState();
            updateFlowModeButtonsVisibility();
        }

        function updateFlowModeButtonsActiveState() {
            const wrap = document.getElementById('flowModeControls');
            if (!wrap) return;
            const mode = costChartState.flowMode || 'location';
            wrap.querySelectorAll('button[data-flow-mode]').forEach((b) => {
                b.classList.toggle('active', b.dataset.flowMode === mode);
            });
        }

        function updateFlowModeButtonsVisibility() {
            const wrap = document.getElementById('flowModeControls');
            if (!wrap) return;
            const show = costChartState.chartType === 'flow-chart';
            wrap.style.display = show ? 'inline-flex' : 'none';
            // divider is the previous sibling we inserted
            const divider = wrap.previousElementSibling;
            if (divider && divider.classList.contains('controls-divider')) {
                divider.style.display = show ? 'block' : 'none';
            }
        }

        function createSubMenu(chartType) {
            const subMenu = document.createElement('div');
            subMenu.className = 'sub-icons-menu';
            
            if (chartType === 'cost-bar') {
                // Cost vs Usage toggle
                subMenu.innerHTML = `
                    <button class="sub-icon-btn ${costChartState.costBarMetric === 'cost' ? 'active' : ''}" 
                            data-tooltip="Cost" onclick="setCostBarMetric('cost', event)">
                        <svg viewBox="0 0 24 24"><text x="12" y="16" text-anchor="middle" font-size="14" fill="currentColor" font-weight="bold">$</text></svg>
                    </button>
                    <button class="sub-icon-btn ${costChartState.costBarMetric === 'usage' ? 'active' : ''}" 
                            data-tooltip="Usage Rate" onclick="setCostBarMetric('usage', event)">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                        </svg>
                    </button>
                    <button class="sub-icon-btn ${costChartState.costBarMetric === 'qty' ? 'active' : ''}" 
                            data-tooltip="Quantity On Hand" onclick="setCostBarMetric('qty', event)">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M4 7h16v2H4V7zm0 4h10v2H4v-2zm0 4h16v2H4v-2z"/>
                        </svg>
                    </button>
                `;
            } else if (chartType === 'bar-chart') {
                // All / Usage / Restock / Waste toggle
                subMenu.innerHTML = `
                    <button class="sub-icon-btn ${costChartState.verticalBarView === 'all' ? 'active' : ''}" 
                            data-tooltip="All" onclick="setVerticalBarView('all', event)">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <rect x="3" y="10" width="4" height="11"/><rect x="10" y="6" width="4" height="15"/><rect x="17" y="12" width="4" height="9"/>
                        </svg>
                    </button>
                    <button class="sub-icon-btn ${costChartState.verticalBarView === 'usage' ? 'active' : ''}" 
                            data-tooltip="Usage" onclick="setVerticalBarView('usage', event)">
                        <svg viewBox="0 0 24 24"><text x="12" y="16" text-anchor="middle" font-size="14" fill="currentColor" font-weight="bold">U</text></svg>
                    </button>
                    <button class="sub-icon-btn ${costChartState.verticalBarView === 'restock' ? 'active' : ''}" 
                            data-tooltip="Restock" onclick="setVerticalBarView('restock', event)">
                        <svg viewBox="0 0 24 24"><text x="12" y="16" text-anchor="middle" font-size="14" fill="currentColor" font-weight="bold">R</text></svg>
                    </button>
                    <button class="sub-icon-btn ${costChartState.verticalBarView === 'waste' ? 'active' : ''}" 
                            data-tooltip="Waste" onclick="setVerticalBarView('waste', event)">
                        <svg viewBox="0 0 24 24"><text x="12" y="16" text-anchor="middle" font-size="14" fill="currentColor" font-weight="bold">W</text></svg>
                    </button>
                `;
            } else if (chartType === 'line-chart') {
                // Trend Lines: Usage Variance and Restock vs Usage
                subMenu.innerHTML = `
                    <button class="sub-icon-btn ${costChartState.timeSeriesMetric === 'variance' ? 'active' : ''}" 
                            data-tooltip="Usage Variance" onclick="setTimeSeriesMetric('variance', event)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,18 6,12 9,15 12,9 15,11 18,6 21,8"/>
                        </svg>
                    </button>
                    <button class="sub-icon-btn ${costChartState.timeSeriesMetric === 'restock-usage' ? 'active' : ''}" 
                            data-tooltip="Restock vs Usage" onclick="setTimeSeriesMetric('restock-usage', event)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,18 7,14 11,16 15,12 19,14 22,10"/>
                            <polyline points="3,20 7,17 11,19 15,15 19,17 22,13" opacity="0.5"/>
                        </svg>
                    </button>
                `;
            } else if (chartType === 'time-chart') {
                // Time Series: Inventory Projection and Historical Shortages
                subMenu.innerHTML = `
                    <button class="sub-icon-btn ${costChartState.timeSeriesMetric === 'projection' ? 'active' : ''}" 
                            data-tooltip="Inventory Projection" onclick="setTimeSeriesMetric('projection', event)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="3" y1="20" x2="3" y2="4" stroke-linecap="round"/>
                            <line x1="3" y1="20" x2="21" y2="20" stroke-linecap="round"/>
                            <polyline points="5,15 9,9 13,11 17,6 20,8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="sub-icon-btn ${costChartState.timeSeriesMetric === 'historical' ? 'active' : ''}" 
                            data-tooltip="Historical Shortages" onclick="setTimeSeriesMetric('historical', event)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,12 7,8 11,14 15,6 19,10 22,7"/>
                            <circle cx="7" cy="8" r="1.5" fill="currentColor"/>
                            <circle cx="11" cy="14" r="1.5" fill="currentColor"/>
                            <circle cx="15" cy="6" r="1.5" fill="currentColor"/>
                        </svg>
                    </button>
                `;
            }
            
            return subMenu;
        }
        
        // Sub-menu toggle functions
        function setCostBarMetric(metric, event) {
            if (event) event.stopPropagation();
            costChartState.costBarMetric = metric;

            // Toggle the stacked quantity controls
            updateInventoryStackControlsVisibility();
            updateInventoryStackControlsActiveState();
            
            // Update active state in sub-menu
            const parentMenu = event.target.closest('.sub-icons-menu');
            parentMenu.querySelectorAll('.sub-icon-btn').forEach(btn => btn.classList.remove('active'));
            event.target.closest('.sub-icon-btn').classList.add('active');
            
	            // Redraw chart
	            if (costChartState && costChartState.chartType === 'flow-chart') invalidateFlowCache();
	            scheduleChartsRedraw('dateRange');
        }
        
        function setVerticalBarView(view, event) {
            if (event) event.stopPropagation();
            costChartState.verticalBarView = view;
            
            // Update active state in sub-menu
            const parentMenu = event.target.closest('.sub-icons-menu');
            parentMenu.querySelectorAll('.sub-icon-btn').forEach(btn => btn.classList.remove('active'));
            event.target.closest('.sub-icon-btn').classList.add('active');
            
            // Redraw chart
            switchChartType('bar-chart');
        }
        
        function setTimeSeriesMetric(metric, event) {
            if (event) event.stopPropagation();
            costChartState.timeSeriesMetric = metric;
            
            // Update active state in sub-menu
            const parentMenu = event.target.closest('.sub-icons-menu');
            if (parentMenu) {
                parentMenu.querySelectorAll('.sub-icon-btn').forEach(btn => btn.classList.remove('active'));
                event.target.closest('.sub-icon-btn').classList.add('active');
            }
            
            // Find which chart type this submenu belongs to
            const wrapper = parentMenu ? parentMenu.closest('[data-chart-type]') : null;
            const chartType = wrapper ? wrapper.dataset.chartType : costChartState.chartType;
            
            // Redraw the chart using switchChartType
            switchChartType(chartType);
        }
        
        function switchChartType(chartType) {
            console.log('Switching to chart type:', chartType);

            // Ensure bar-chart has mock data + transactions (iframe may be kept alive on tab switch).
            if (chartType === 'bar-chart') {
                const hasItems = !!(cachedMockData && cachedMockData.items && cachedMockData.items.length);
                const hasTx = hasUsableTransactions(cachedMockData);
                if (!hasItems || !hasTx) {
                    if (!costChartState.__barChartDataLoading) {
                        costChartState.__barChartDataLoading = true;
                        console.log('🔄 Charts: bar-chart missing data; requesting from parent...');
                        requestMockDataFromParent()
                            .then(() => {
                                costChartState.__barChartDataLoading = false;
                                costChartState.__txDailyAggBuilt = false;
                                scheduleChartsRedraw('bar-chart-data');
                            })
                            .catch(() => { costChartState.__barChartDataLoading = false; });
                    }
                    return;
                }
            }

            
            // Track last chart type (excluding list-view)
            if (chartType !== 'list-view' && costChartState.chartType !== 'list-view') {
                costChartState.lastChartType = costChartState.chartType;
            }
            
            costChartState.chartType = chartType;

            // Persist selection so theme toggles / reflows don't reset the active chart
            try {
                localStorage.setItem('charts_last_state_v23k', JSON.stringify({
                    chartType: costChartState.chartType,
                    timeSeriesMetric: costChartState.timeSeriesMetric,
                    costBarMetric: costChartState.costBarMetric,
                    verticalBarView: costChartState.verticalBarView
                }));
            } catch (e) {}

            // Quantity stacking controls only apply to the cost-bar + qty view
            updateInventoryStackControlsVisibility();
            updateInventoryStackControlsActiveState();

            // Date range controls only apply to bar views
            updateDateRangeControlsVisibility();
            
            // Clear usage vs restock flag when switching away from time-chart
            if (chartType !== 'time-chart') {
                costChartState.showUsageVsRestock = false;
            }
            
            // Reset hover state when switching charts
            costChartState.hoveredIndex = -1;
            
            // Clean up inventory projection handlers
            const canvas = costChartState.canvas;
            if (canvas) {
                canvas.style.cursor = 'default';
                
                // Remove inventory projection event listeners
                if (canvas.inventoryProjectionMouseMove) {
                    canvas.removeEventListener('mousemove', canvas.inventoryProjectionMouseMove);
                    canvas.inventoryProjectionMouseMove = null;
                }
                if (canvas.inventoryProjectionMouseLeave) {
                    canvas.removeEventListener('mouseleave', canvas.inventoryProjectionMouseLeave);
                    canvas.inventoryProjectionMouseLeave = null;
                }
                if (canvas.inventoryProjectionClick) {
                    canvas.removeEventListener('click', canvas.inventoryProjectionClick);
                    canvas.inventoryProjectionClick = null;
                }
            }
            
            // Update icon button styles using CSS classes
            const iconContainer = document.getElementById('chartTypeIcons');
            if (iconContainer) {
                const buttons = iconContainer.querySelectorAll('.chart-icon-btn');
                buttons.forEach(btn => {
                    if (btn.dataset.chartType === chartType) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            }
            
            // Scale container is the single animated header strip used for:
            // - Horizontal bars: sticky numeric scale + back arrow (+ date range controls)
            // - Vertical bars: date range controls + drill slider
            // - Other charts: collapsed
            setScaleContainerModeForChartType(chartType);
            
            // Redraw the appropriate chart
            const sankeyDiv = document.getElementById('sankeyChart');
            
            if (chartType === 'list-view') {
                // List-view is a shortcut to the shortage bulletin. When restoring state (back navigation),
                // do NOT auto-navigate; only navigate when the user explicitly clicks the icon.
                const suppress = !!costChartState._suppressListViewNav;
                if (!suppress) {
                    // Open shortage bulletin with current filtered items
                    openShortagebulletin();
                } else {
                    console.log('⏭️ Suppressing list-view shortage navigation (restore/back).');
                }
                // Reset to previous chart type
                const previousType = costChartState.lastChartType || 'cost-bar';
                setTimeout(() => {
                    switchChartType(previousType);
                }, 100);
            } else if (chartType === 'flow-chart') {
                // Flow mode UI: keep breadcrumb + chips persistent (same as other charts),
                // but constrain the canvas area for the Sankey.
                document.body && document.body.classList && document.body.classList.add('flow-mode');

                // Show Sankey, hide canvas
                if (canvas) canvas.style.display = 'none';
                if (sankeyDiv) sankeyDiv.style.display = 'block';
                updateFlowModeButtonsVisibility();

                // Ensure breadcrumb/chips reflect current state (filter/search) even in flow mode
                try { if (typeof updateBreadcrumbAndFilterChips === 'function') updateBreadcrumbAndFilterChips(); } catch (e) {}

                // Always rebuild via ensureFlowDataReady() so the Sankey reflects:
                // - From/To selection
                // - breadcrumb drillDownStack (class->name->description)
                // - filter/search chips
                const flowData = (typeof ensureFlowDataReady === 'function') ? ensureFlowDataReady() : null;
                if (typeof drawSankeyChart === 'function') {
                    // Clear first so an empty result doesn't leave stale Sankey visible
                    try { if (sankeyDiv) sankeyDiv.innerHTML = ''; } catch (e) {}
                    if (flowData && flowData.flows && flowData.flows.length) {
                        drawSankeyChart(flowData);
                    } else {
                        if (sankeyDiv) {
                            sankeyDiv.innerHTML = '<div style="padding:12px; color: var(--text-secondary); font: 13px system-ui;">No flow data for the selected range/filter.</div>';
                        }
                    }
                }
            } else {
                // Leaving flow mode
                document.body && document.body.classList && document.body.classList.remove('flow-mode');
                const bc = document.getElementById('costBreadcrumb');
                if (bc) bc.style.display = '';
                // filter chip visibility is managed elsewhere (don't force show here)

                // Show canvas, hide Sankey
                if (canvas) canvas.style.display = 'block';
                if (sankeyDiv) sankeyDiv.style.display = 'none';
                updateFlowModeButtonsVisibility();
                
                if (chartType === 'cost-bar') {
                    // Cost bar chart - handle description level specially
                    if (costChartState.viewMode === 'description' && costChartState.drillDownStack.length > 0) {
                        // We're at item level - for horizontal bars, show the drug level (all items of that drug)
                        // But keep the drill-down stack intact except for description level
                        
                        // Find and remove description level if it exists
                        const descLevel = costChartState.drillDownStack.find(level => level.mode === 'description');
                        if (descLevel) {
                            costChartState.drillDownStack = costChartState.drillDownStack.filter(level => level.mode !== 'description');
                            costChartState.highlightKey = descLevel.key; // Keep item highlighted
                        }
                        
                        // Set viewMode to show descriptions (the item level view)
                        costChartState.viewMode = 'description';
                        
                        console.log('📊 Switched to horizontal bars from item selection');
                        console.log('📋 Drill-down stack:', costChartState.drillDownStack);
                        console.log('👁️ View mode:', costChartState.viewMode);
                        console.log('✨ Highlight:', costChartState.highlightKey);
                    }
                    
                    // Just redraw with current state
                    scheduleChartsRedraw('dateRange');
                } else if (chartType === 'line-chart') {
                    // Trend Lines - use timeSeriesMetric for variance or restock-usage
                    if (costChartState.timeSeriesMetric === 'variance') {
                        drawTimeSeriesChart();
                    } else if (costChartState.timeSeriesMetric === 'restock-usage') {
                        drawUsageVsRestockChart();
                    } else {
                        // Default to variance
                        costChartState.timeSeriesMetric = 'variance';
                        drawTimeSeriesChart();
                    }
                } else if (chartType === 'time-chart') {
                    // Time Series - use timeSeriesMetric for projection or historical
                    if (costChartState.timeSeriesMetric === 'projection') {
                        drawInventoryProjection();
                    } else if (costChartState.timeSeriesMetric === 'historical') {
                        drawChartPlaceholder('historical-shortages');
                    } else {
                        // Default to projection
                        costChartState.timeSeriesMetric = 'projection';
                        drawInventoryProjection();
                    }
                } else if (chartType === 'bar-chart') {
                    // Vertical bar chart (time series with usage/restock/waste)
                    // Defer a frame so layout (and the scale strip swap) settles before sizing the canvas
                    const _drawVB = () => {
                        try { drawVerticalBarChart(); } catch (e) { console.warn('⚠️ drawVerticalBarChart failed', e); }
                    };
                    // When the iframe is hidden/being revealed, rAF may not fire reliably on some browsers.
                    // Use a safe fallback timeout to ensure the chart actually draws.
                    if (document.hidden) {
                        setTimeout(_drawVB, 60);
                    } else {
                        requestAnimationFrame(() => requestAnimationFrame(_drawVB));
                        setTimeout(_drawVB, 180); // fallback
                    }
                } else if (chartType === 'pie-chart') {
                    // Pie chart
                    drawPieChart();
                } else {
                    // Other chart types - show placeholder
                    drawChartPlaceholder(chartType);
                }
            }
        }
        
        function drawChartPlaceholder(chartType) {
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            if (!canvas || !ctx) return;
            
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth;
            const displayHeight = 400;
            
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            
            // Fill with background (support dark mode)
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            // Draw placeholder message
            const getCSSVar = (varName) => {
                return getComputedStyle(document.body).getPropertyValue(varName).trim();
            };
            
            ctx.fillStyle = getCSSVar('--text-secondary');
            ctx.font = '16px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const chartNames = {
                'line-chart': 'Trend Line Chart',
                'time-chart': 'Time Series Chart',
                'bar-chart': 'Bar Chart',
                'pie-chart': 'Distribution Pie Chart',
                'flow-chart': 'Flow Diagram'
            };
            
            const chartName = chartNames[chartType] || 'Chart';
            ctx.fillText(`${chartName} - Coming Soon`, displayWidth / 2, displayHeight / 2);
            
            ctx.font = '13px system-ui';
            ctx.fillStyle = getCSSVar('--text-tertiary');
            ctx.fillText('This visualization is under development', displayWidth / 2, displayHeight / 2 + 25);
        }
        
        function createStickyScale(gridMax, numGridLines, niceInterval, leftPadding, rightPadding, displayWidth) {
            const scaleContainerDiv = document.getElementById('costChartScaleContainer');
            if (!scaleContainerDiv) return;
            
            parkChartControls();
            try { ensureDateRangeInHeader(); } catch(e) {}
            scaleContainerDiv.innerHTML = '';
            
            const graphWidth = displayWidth - leftPadding - rightPadding;
            
            const scaleWrapper = document.createElement('div');
            scaleWrapper.style.cssText = `
                position: relative;
                width: ${displayWidth}px;
                height: 100%;
                display: flex;
                align-items: center;
                border-bottom: 5px solid var(--teal-primary);
            `;
            
            const textColor = getComputedStyle(document.body)
                .getPropertyValue('--cost-scale-label').trim();
            
            const backArrow = document.createElement('div');
            backArrow.id = 'costChartBackArrow';
            backArrow.className = 'cost-chart-back-arrow';
            if (costChartState.drillDownStack.length > 0) {
                backArrow.classList.add('visible');
            }
            backArrow.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z" fill="currentColor"/>
                </svg>
            `;
            backArrow.addEventListener('click', handleBackButtonClick);
            scaleWrapper.appendChild(backArrow);
            
            for (let i = 0; i <= numGridLines; i++) {
                const value = i * niceInterval;
                const leftPixels = (value / gridMax) * graphWidth;
                
                let label;
                if (value >= 1000) {
                    const kValue = value / 1000;
                    label = (kValue % 1 === 0) ? kValue + 'k' : kValue.toFixed(1) + 'k';
                } else {
                    label = value.toString();
                }
                
                const labelElem = document.createElement('div');
                labelElem.textContent = label;
                labelElem.style.cssText = `
                    position: absolute;
                    left: ${leftPadding + leftPixels}px;
                    transform: translateX(-50%);
                    font-size: 11px;
                    color: ${textColor};
                    font-weight: 600;
                    white-space: nowrap;
                    pointer-events: none;
                `;
                
                scaleWrapper.appendChild(labelElem);
            }
            
            // Cost-bar view should show ONLY the numeric scale (no date picker overlay).
            // Controls are parked and will reappear when returning to the vertical bar chart.

            scaleContainerDiv.appendChild(scaleWrapper);
            try { updateDateRangeControlsVisibility(); } catch (e) {}

        }

        function drawCostChart(filterKey = null) {
            // If we're rendering Usage in the horizontal bars, ensure the per-item
            // rate arrays are rebuilt for the currently selected From/To range.
            // (Some datasets rely on item.usageRate when dailyDispense isn't present.)
            try {
                if (costChartState && costChartState.costBarMetric === 'usage') {
                    ensureTransactionRatesForSelectedRange();
                }
            } catch (e) {}

            const viewMode = costChartState.viewMode || 'itemClass';
            const groupedCosts = {};
            
            let itemsToGroup = costChartState.items;
            
            // Always apply drill-down filters from the stack
            if (costChartState.drillDownStack && costChartState.drillDownStack.length > 0) {
                // Apply each level of the drill-down stack in sequence
                costChartState.drillDownStack.forEach(level => {
                    if (level.mode === 'itemClass') {
                        itemsToGroup = itemsToGroup.filter(item => 
                            (item.itemClass || 'Unknown') === level.key
                        );
                    } else if (level.mode === 'drugName') {
                        itemsToGroup = itemsToGroup.filter(item => 
                            (item.drugName || 'Unknown') === level.key
                        );
                    } else if (level.mode === 'formulary') {
                        itemsToGroup = itemsToGroup.filter(item => {
                            const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                            const itemCategory = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                            return itemCategory === level.key;
                        });
                    }
                    // Note: we don't filter by description level here since that's the display level
                });
            }
            
            console.log('📊 drawCostChart - viewMode:', viewMode, 'items after filter:', itemsToGroup.length);
            
            itemsToGroup.forEach(item => {
                let key;
                if (viewMode === 'itemClass') {
                    key = item.itemClass || 'Unknown';
                } else if (viewMode === 'drugName') {
                    key = item.drugName || 'Unknown';
                } else if (viewMode === 'formulary') {
                    const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                    key = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                } else {
                    key = item.description || 'Unknown';
                }
                
                if (!groupedCosts[key]) {
                    groupedCosts[key] = { cost: 0, usage: 0, qtyTotal: 0, qtyPyxis: 0, qtyPharmacy: 0, items: [] };
                }
                
                // Cost metric:
                // - Default: inventory value (qty * unitPrice) or wasteValue when provided
                // - Projected Waste dataset: stacked cost (used vs leftover) where total bar length == total inventory cost
                const unitPrice = parseFloat(item.unitPrice || item.unitCost || item.costPerUnit || 0) || 0;

                // Current quantities (effective inventory to match other views)
                const effectiveInv = getEffectiveInventory(item);
                const curQtyTotal = (Number(effectiveInv.effectiveQuantity) || 0);
                const curQtyPyxis = (Number(effectiveInv.effectivePyxis) || 0);
                const curQtyPharmacy = (Number(effectiveInv.effectivePharmacy) || 0);

                if (costChartState.specialDataset === 'projectedWaste' && costChartState.projectedWasteMap) {
                    const codeKey = String(item.itemCode);
                    const rec = costChartState.projectedWasteMap[codeKey] ||
                                costChartState.projectedWasteDescMap?.[String(item.description || '')] ||
                                null;

                    // Total inventory cost (bar total length)
                    const costTotal = curQtyTotal * unitPrice;

                    // Leftover qty + expected used qty (aliases supported)
                    const leftoverQty = Number(
                        rec?.leftoverQty ?? rec?.leftoverQuantity ?? rec?.qtyLeftover ?? rec?.quantityLeftOver ?? 0
                    ) || 0;
                    const expectedUsedQty = Number(
                        rec?.expectedUsedBeforeExpire ?? rec?.expectedUsedQty ?? rec?.qtyWillUse ?? rec?.quantityWillUse ?? 0
                    ) || 0;

                    // Leftover cost (waste) and used cost (so segments sum to total)
                    const costLeftover = Math.max(0, leftoverQty) * unitPrice;
                    const costUsed = Math.max(0, costTotal - costLeftover);

                    // Store both total and leftover for sorting + tooltip
                    groupedCosts[key].costTotal = (groupedCosts[key].costTotal || 0) + costTotal;
                    groupedCosts[key].costLeftover = (groupedCosts[key].costLeftover || 0) + costLeftover;
                    groupedCosts[key].costUsed = (groupedCosts[key].costUsed || 0) + costUsed;
                    groupedCosts[key].sortCost = (groupedCosts[key].sortCost || 0) + costLeftover;

                    // For backward compatibility, keep .cost as the total (bar length)
                    groupedCosts[key].cost += costTotal;

                    // Attach detail fields (for tooltip + future table views)
                    groupedCosts[key].currentQty = (groupedCosts[key].currentQty || 0) + curQtyTotal;
                    groupedCosts[key].leftoverQty = (groupedCosts[key].leftoverQty || 0) + leftoverQty;
                    groupedCosts[key].expectedUsedQty = (groupedCosts[key].expectedUsedQty || 0) + expectedUsedQty;
                    groupedCosts[key].earliestExpiration = rec?.earliestExpiration || rec?.expires || rec?.expiration || groupedCosts[key].earliestExpiration || '';
                    groupedCosts[key].forecastType = rec?.seriesType || rec?.forecastType || groupedCosts[key].forecastType || '';
                    groupedCosts[key].forecastMethod = rec?.method || rec?.forecastMethod || groupedCosts[key].forecastMethod || '';

                } else {
                    // Default behavior: Use wasteValue if available (from filters), otherwise inventory value
                    const itemCost = (item.wasteValue !== undefined && item.wasteValue !== null)
                        ? Number(item.wasteValue)
                        : curQtyTotal * unitPrice;
                    groupedCosts[key].cost += (Number(itemCost) || 0);
                }
                
                // Calculate usage for this item (transaction-driven; respects active date picker range when available)
                const __mdForUsage = (costChartState && costChartState.cachedMockData)
                    ? costChartState.cachedMockData
                    : ((typeof cachedMockData !== 'undefined' && cachedMockData) ? cachedMockData : null);
                const hasDailyDispense = (__mdForUsage && __mdForUsage.dailyDispense && __mdForUsage.dailyDispense.byItem);
                if (hasDailyDispense || (costChartState && costChartState.__txDailyAggByCode)) {
                    // Pass the full item so we can match transactions keyed by itemCode/alt_itemCode/NDC consistently.
                    groupedCosts[key].usage += sumDailyDispenseForItemInRange(item);
                } else if (item.usageRate && Array.isArray(item.usageRate)) {
                    // Fallback for legacy datasets
                    const totalUsage = item.usageRate.reduce((sum, val) => sum + (val || 0), 0);
                    groupedCosts[key].usage += totalUsage;
                }

                // Quantity on hand (Pyxis/Pharmacy grouping MUST match Shortage Bulletin details modal)
                // Use getEffectiveInventory() which derives quantities from cachedMockData.inventory + SUBLOCATION_MAP
                // and respects excludeStandardInventory setting.
                // NOTE: Don't reuse the `effectiveInv` identifier here; it's already declared above
                // (via getEffectiveInventoryForItem). We still call getEffectiveInventory() here to
                // ensure Pyxis/Pharmacy grouping matches the Shortage Bulletin details modal.
                const effectiveInv2 = getEffectiveInventory(item);
                groupedCosts[key].qtyPyxis += (Number(effectiveInv2.effectivePyxis) || 0);
                groupedCosts[key].qtyPharmacy += (Number(effectiveInv2.effectivePharmacy) || 0);
                groupedCosts[key].qtyTotal += (Number(effectiveInv2.effectiveQuantity) || 0);

                groupedCosts[key].items.push(item);
            });
            
            // Determine which metric to use for sorting and display
            const metric = costChartState.costBarMetric;
            const useUsageMetric = metric === 'usage';
            const useQtyMetric = metric === 'qty';

            // Usage metric: show TOTAL usage in the active range so it matches the vertical bar chart.
            // (We still compute an average for tooltip/reference, but the bar value is TOTAL.)
            const activeRangeDays = useUsageMetric ? getActiveRangeDayCount() : null;
            
            let allSorted = Object.entries(groupedCosts)
                .map(([key, data]) => {
                    // Use the selected metric for display value
                    let displayValue;
                    if (useUsageMetric) {
                        const denom = (activeRangeDays && activeRangeDays > 0) ? activeRangeDays : null;
                        data.usageAvg = denom ? (data.usage / denom) : data.usage;
                        data.usageDays = denom;
                        displayValue = data.usage; // TOTAL usage (matches vbar)
                    } else if (useQtyMetric) {
                        // For qty, allow filtering by inventory source
                        if (costChartState.inventoryStackMode === 'pyxis') displayValue = data.qtyPyxis;
                        else if (costChartState.inventoryStackMode === 'pharmacy') displayValue = data.qtyPharmacy;
                        else displayValue = data.qtyTotal;
                    } else {
                        displayValue = data.cost;
                    }
                    return [key, displayValue, key, data]; // Include full data object
                })
                .sort((a, b) => {
                    // Sort by the active metric (highest to lowest)
                    const metricMode = costChartState.costBarMetric || 'cost';

                    // Special: Projected Waste cost view should sort by leftover (waste) cost,
                    // while bar length represents total inventory cost.
                    if (costChartState.specialDataset === 'projectedWaste' && metricMode === 'cost') {
                        const aLeft = a[3] ? (a[3].sortCost ?? a[3].costLeftover ?? 0) : 0;
                        const bLeft = b[3] ? (b[3].sortCost ?? b[3].costLeftover ?? 0) : 0;
                        return (bLeft || 0) - (aLeft || 0);
                    }

                    return (b[1] || 0) - (a[1] || 0);
                });
            
            costChartState.allSortedData = allSorted;
            
            const totalItems = allSorted.length;
            const itemsPerPage = 50;
            let currentPage = costChartState.currentPage || 0;
            
            // If we have a highlight key, find which page it's on
            if (costChartState.highlightKey) {
                console.log(`🔍 Looking for highlight key: "${costChartState.highlightKey}"`);
                
                const highlightIndex = allSorted.findIndex(([key, _]) => key === costChartState.highlightKey);
                if (highlightIndex >= 0) {
                    const targetPage = Math.floor(highlightIndex / itemsPerPage);
                    currentPage = targetPage;
                    costChartState.currentPage = targetPage;
                    console.log(`✓ Found at index ${highlightIndex}, page ${targetPage}`);
                } else {
                    console.log(`⚠️ Highlight key not found in data`);
                }
            }
            
            const startIndex = currentPage * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
            
            let pageItems = allSorted.slice(startIndex, endIndex);
            
            let displayData = [];
            
            if (currentPage > 0) {
                const previousCount = startIndex;
                const previousCost = allSorted.slice(0, startIndex).reduce((sum, [_, cost]) => sum + cost, 0);
                displayData.push([`Previous Items (${previousCount})`, previousCost, '__PREVIOUS__']);
            }
            
            displayData = displayData.concat(pageItems);
            
            const remainingItems = totalItems - endIndex;
            if (remainingItems > 0) {
                const nextCount = Math.min(itemsPerPage, remainingItems);
                const nextCost = allSorted.slice(endIndex, endIndex + nextCount).reduce((sum, [_, cost]) => sum + cost, 0);
                const nextLabel = nextCount < itemsPerPage ? 
                    `Next ${nextCount} Item${nextCount !== 1 ? 's' : ''}` : 
                    `Next ${nextCount} Items`;
                displayData.push([nextLabel, nextCost, '__NEXT__']);
            }
            
            // Calculate total by summing the active metric
            const categoryTotal = allSorted.reduce((sum, [_, value]) => sum + (value || 0), 0);
            
            updateBreadcrumb(categoryTotal);
            
            const scrollContainer = document.querySelector('.cost-chart-side');
            if (scrollContainer && !costChartState.highlightKey) {
                // Only handle scroll here if we're NOT highlighting an item
                if (costChartState.savedScrollPosition !== undefined && costChartState.savedScrollPosition !== 0) {
                    scrollContainer.scrollTop = costChartState.savedScrollPosition;
                    costChartState.savedScrollPosition = 0;  // Reset after using
                } else {
                    scrollContainer.scrollTop = 0;  // Reset to top for new navigation
                }
            }
            
            costChartState.currentData = displayData;
            
            // Draw the appropriate chart type
            if (costChartState.chartType === 'time-chart') {
                drawTimeSeriesChart();
            } else if (costChartState.chartType === 'time-chart') {
                // Check if we're showing usage vs restock specifically
                if (costChartState.showUsageVsRestock) {
                    drawUsageVsRestockChart();
                } else {
                    drawTimeSeriesChart();
                }
            } else if (costChartState.chartType === 'pie-chart') {
                // Don't draw bar chart if pie chart is active
                // The pie chart will be redrawn by the calling function
                console.log('ℹ️ Pie chart active - skipping bar chart draw');
            } else if (costChartState.chartType === 'bar-chart') {
                // Vertical bar chart - redraw with filtered data
                scheduleChartsRedraw('dateRange');
                console.log('✓ Vertical bar chart redrawn with filtered data');
            } else if (costChartState.chartType === 'cost-bar') {
                drawHorizontalBarChart(displayData);
                
                // If we have a highlight key, scroll to it
                if (costChartState.highlightKey) {
                    setTimeout(() => {
                        const highlightLocalIndex = displayData.findIndex(([_, __, key]) => key === costChartState.highlightKey);
                        if (highlightLocalIndex >= 0) {
                            const barHeight = 40;
                            const barSpacing = 10;
                            const topPadding = 15;
                            const targetY = topPadding + highlightLocalIndex * (barHeight + barSpacing);
                            
                            const scrollContainer = document.querySelector('.cost-chart-side');
                            if (scrollContainer) {
                                // Scroll to center the highlighted bar
                                const containerHeight = scrollContainer.clientHeight;
                                const scrollTo = targetY - (containerHeight / 2);
                                scrollContainer.scrollTop = Math.max(0, scrollTo);
                                console.log(`📜 Scrolled to highlighted item at local index ${highlightLocalIndex}`);
                            }
                        }
                    }, 100); // Small delay to ensure canvas is rendered
                }
            } else {
                drawHorizontalBarChart(displayData);
            }
        }
        
        function updateBreadcrumb(totalCost) {
            // Persist last total for breadcrumb-only refreshes
            costChartState.lastTotalCost = totalCost;

            const breadcrumbContainer = document.getElementById('costBreadcrumb');
            const filterChip = document.getElementById('filterChip');
            const filterChipLabel = document.getElementById('filterChipLabel');
            const searchChip = document.getElementById('searchChip');
            const searchChipLabel = document.getElementById('searchChipLabel');
            const costDisplay = document.getElementById('totalInventoryCost');
            
            if (!breadcrumbContainer || !costDisplay || !filterChip || !searchChip) return;
            
            // Update display formatting based on active metric
            if (costChartState.costBarMetric === 'usage') {
                costDisplay.textContent = Math.round(totalCost).toLocaleString('en-US');
            } else if (costChartState.costBarMetric === 'qty') {
                costDisplay.textContent = Math.round(totalCost).toLocaleString('en-US');
            } else {
                costDisplay.textContent = '$' + totalCost.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }
            
            // Check if we have an external filter applied
            // Show filter chip ONLY if we have filterData with a filterType
            const hasActiveFilter = (costChartState.filterData && costChartState.filterData.filterType);
            
            const hasSearchTerm = costChartState.searchTerm && costChartState.searchTerm.trim() !== '';
            
            if (hasActiveFilter || hasSearchTerm) {
                // Hide breadcrumb when filter or search is active
                breadcrumbContainer.style.display = 'none';
                
                // Show filter chip if we have a filter
                if (hasActiveFilter) {
                    filterChip.style.display = 'inline-flex';
                    filterChipLabel.textContent = costChartState.filterData.filterType;
                } else {
                    filterChip.style.display = 'none';
                }
                
                // Show search chip if we have a search term
                if (hasSearchTerm) {
                    searchChip.style.display = 'inline-flex';
                    searchChipLabel.textContent = `"${costChartState.searchTerm}"`;
                } else {
                    searchChip.style.display = 'none';
                }
            } else {
                // Show breadcrumb, hide both filter chips
                breadcrumbContainer.style.display = 'flex';
                filterChip.style.display = 'none';
                searchChip.style.display = 'none';

                // NOTE: The breadcrumb should behave consistently across chart types:
                // itemClass → drugName → description (drillDownStack). In bar-chart mode we still
                // use the same drillDownStack and the breadcrumb must remain clickable.
                
                // Build breadcrumb
                const breadcrumbs = [];
                
                // Add "All Items" as root
                breadcrumbs.push(`<span class="breadcrumb-item" data-level="-1">All Items</span>`);
                
                // Add each level from drill-down stack
                costChartState.drillDownStack.forEach((level, index) => {
                    breadcrumbs.push('<span class="breadcrumb-separator">›</span>');
                    const truncated = level.key.length > 25 ? level.key.substring(0, 25) + '...' : level.key;
                    breadcrumbs.push(`<span class="breadcrumb-item" data-level="${index}">${truncated}</span>`);
                });

                // If a Stock-out segment flow filter is active, append the location as a final breadcrumb.
                // The location crumb must remain clickable so users can navigate back up.
                let __hasFlowLoc = false;
                try {
                    const seg = costChartState && costChartState.flowSegmentFilter ? costChartState.flowSegmentFilter : null;
                    const loc = seg && seg.sublocation ? String(seg.sublocation).trim() : '';
                    if (loc) {
                        __hasFlowLoc = true;
                        breadcrumbs.push('<span class="breadcrumb-separator">›</span>');
                        breadcrumbs.push(`<span class="breadcrumb-item breadcrumb-flowloc" data-level="-2">${loc}</span>`);
                    }
                } catch (e) {}

                // Mark the *last drill level* as current (not clickable).
                // If a flow-location crumb exists, do NOT mark it as current.
                if (breadcrumbs.length > 0) {
                    const currentIndex = __hasFlowLoc ? Math.max(0, breadcrumbs.length - 3) : (breadcrumbs.length - 1);
                    breadcrumbs[currentIndex] = breadcrumbs[currentIndex].replace('breadcrumb-item', 'breadcrumb-current');
                }
                
                breadcrumbContainer.innerHTML = breadcrumbs.join('');
                
                // Add click handlers to breadcrumb items (not current)
                breadcrumbContainer.querySelectorAll('.breadcrumb-item').forEach(item => {
                    item.addEventListener('click', function() {
                        const level = parseInt(this.getAttribute('data-level'));
                        navigateToBreadcrumbLevel(level);
                    });
                });
            }
        }

        // Some render paths (notably flow-chart redraws) need to refresh
        // breadcrumb + filter/search chips without recomputing totals.
        // scheduleChartsRedraw() calls this when available.
        function updateBreadcrumbAndFilterChips() {
            try {
                const last = (costChartState && typeof costChartState.lastTotalCost === 'number') ? costChartState.lastTotalCost : 0;
                updateBreadcrumb(last);
            } catch (e) {}
        }
        
        function navigateToBreadcrumbLevel(level) {
            // Flow-location breadcrumb clears only the segment/location filter.
            if (level === -2) {
                try {
                    if (costChartState && costChartState.flowSegmentFilter) {
                        costChartState.flowSegmentFilter = null;
                        costChartState.flowSegmentActivated = false;
                        // Restore full items list (segment click narrows costChartState.items).
                        try {
                            const base = (costChartState.absoluteOriginalItems && costChartState.absoluteOriginalItems.length)
                                ? costChartState.absoluteOriginalItems
                                : (costChartState.originalItems || window.originalItems || null);
                            if (base && Array.isArray(base) && base.length) {
                                costChartState.items = base.slice();
                            }
                        } catch (e) {}
                        try { if (typeof invalidateFlowCache === 'function') invalidateFlowCache(); } catch(e) {}
                    }
                } catch (e) {}
                // Redraw current chart with the drill path preserved.
                scheduleChartsRedraw('dateRange');
                return;
            }

            // Navigating anywhere else should clear segment mode so breadcrumbs don't get stuck.
            try {
                if (costChartState && costChartState.flowSegmentFilter) {
                    costChartState.flowSegmentFilter = null;
                    costChartState.flowSegmentActivated = false;
                    try {
                        const base = (costChartState.absoluteOriginalItems && costChartState.absoluteOriginalItems.length)
                            ? costChartState.absoluteOriginalItems
                            : (costChartState.originalItems || window.originalItems || null);
                        if (base && Array.isArray(base) && base.length) {
                            costChartState.items = base.slice();
                        }
                    } catch (e) {}
                    try { if (typeof invalidateFlowCache === 'function') invalidateFlowCache(); } catch(e) {}
                }
            } catch (e) {}
            // Reset showAllItems flag
            costChartState.showAllItems = false;
            
            // Clear highlightKey when navigating via breadcrumb
            costChartState.highlightKey = null;
            console.log('🔙 Breadcrumb navigation - cleared highlightKey');
            
            if (level === -1) {
                // Go back to root (All Items) - always go to first page
                costChartState.drillDownStack = [];
                costChartState.viewMode = 'itemClass';
                costChartState.currentPage = 0;
                costChartState.rootLevelPage = 0;
                
                // Update dropdown to reflect root level
                const selector = document.getElementById('costChartViewSelector');
                if (selector) {
                    selector.value = 'itemClass';
                    console.log('✓ Dropdown updated to: itemClass (breadcrumb root)');
                }
                
                scheduleChartsRedraw('dateRange');
                
                // If pie chart is active, also redraw it
                if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                }
            } else {
                // Navigate to specific level
                // Defensive guards: it is possible for UI events to request a level that no longer
                // exists (e.g., rapid clicks / stale breadcrumb DOM while drillDownStack changes).
                if (!Array.isArray(costChartState.drillDownStack) || costChartState.drillDownStack.length === 0) {
                    // Already at root (or stack was cleared by a prior navigation). Nothing to drill up.
                    try { updateBreadcrumb(costChartState.lastTotalCost ?? 0); } catch(e) {}
                    return;
                }

                if (typeof level !== 'number' || level < 0 || level >= costChartState.drillDownStack.length) {
                    console.warn('⚠️ Breadcrumb navigation - invalid level:', level, 'stackLen:', costChartState.drillDownStack.length);
                    // Clamp to the nearest valid level
                    level = Math.max(0, Math.min(costChartState.drillDownStack.length - 1, level || 0));
                }

                costChartState.drillDownStack = costChartState.drillDownStack.slice(0, level + 1);
                const targetLevel = costChartState.drillDownStack[level] || costChartState.drillDownStack[costChartState.drillDownStack.length - 1];

                if (!targetLevel) {
                    console.warn('⚠️ Breadcrumb navigation - targetLevel missing after slice; falling back to root');
                    costChartState.drillDownStack = [];
                    costChartState.viewMode = 'itemClass';
                    costChartState.currentPage = costChartState.rootLevelPage || 0;
                    costChartState.savedScrollPosition = 0;
                    const selector = document.getElementById('costChartViewSelector');
                    if (selector) selector.value = 'itemClass';
                    scheduleChartsRedraw('breadcrumb-fallback');
                    if (costChartState.chartType === 'pie-chart') drawPieChart();
                    return;
                }
                
                // Restore scroll position and page from target level
                costChartState.savedScrollPosition = (targetLevel.scrollPosition ?? 0);
                costChartState.currentPage = (targetLevel.page ?? 0);
                
                // Set view mode based on target level
                if (targetLevel.mode === 'itemClass') {
                    costChartState.viewMode = 'drugName';
                } else if (targetLevel.mode === 'drugName') {
                    costChartState.viewMode = 'description';
                } else if (targetLevel.mode === 'formulary') {
                    costChartState.viewMode = 'description';
                }
                
                // Update dropdown to reflect current level
                const selector = document.getElementById('costChartViewSelector');
                if (selector) {
                    selector.value = costChartState.viewMode;
                    console.log('✓ Dropdown updated to:', costChartState.viewMode, '(breadcrumb level', level + ')');
                }


                // Refresh breadcrumb UI immediately (avoid stale label when drilling up in non cost-bar views)
                try {
                    let baseItems = Array.isArray(costChartState.items) ? costChartState.items : [];
                    if (costChartState.drillDownStack && costChartState.drillDownStack.length > 0) {
                        costChartState.drillDownStack.forEach(lv => {
                            if (lv.mode === 'itemClass') baseItems = baseItems.filter(it => (it.itemClass || 'Unknown') === lv.key);
                            else if (lv.mode === 'drugName') baseItems = baseItems.filter(it => (it.drugName || 'Unknown') === lv.key);
                            else if (lv.mode === 'description') baseItems = baseItems.filter(it => (it.description || 'Unknown') === lv.key);
                            else if (lv.mode === 'formulary') {
                                baseItems = baseItems.filter(it => {
                                    const isNon = (it.status || '').toLowerCase() === 'non-formulary';
                                    const key = isNon ? 'Non-Formulary' : 'Formulary';
                                    return key === lv.key;
                                });
                            }
                        });
                    }
                    const totalCost = baseItems.reduce((sum, item) => {
                        const itemCost = item.wasteValue !== undefined ? item.wasteValue : ((item.quantity || 0) * parseFloat(item.unitPrice || 0));
                        return sum + (isFinite(itemCost) ? itemCost : 0);
                    }, 0);
                    updateBreadcrumb(totalCost);
                } catch (e) {
                    console.warn('⚠️ Breadcrumb refresh failed', e);
                }

                // Redraw based on active chart type.
                // Previously we always called drawCostChart(), which breaks breadcrumb navigation
                // while in the vertical bar chart (bar-chart) because it never redraws that view.
                if (costChartState.chartType === 'cost-bar') {
                    drawCostChart(targetLevel.key);
                } else {
                    scheduleChartsRedraw('breadcrumb');
                }

                // If pie chart is active, also redraw it
                if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                }
            }
        }

        // ------------------------------------------------------------------------------
        // Vertical bar chart breadcrumb drill-up (Month → Week → Day)
        // ------------------------------------------------------------------------------
        function navigateVerticalDrillBreadcrumb(target) {
            try {
                if (costChartState.chartType !== 'bar-chart') return;
                const t = String(target || 'root');

                if (t === 'root') {
                    costChartState.verticalDrillLevel = 0;
                    costChartState.verticalDrillContext = null;
                } else if (t === 'month') {
                    // Month view (keep monthKey if already selected)
                    costChartState.verticalDrillLevel = 1;
                    const ctx = costChartState.verticalDrillContext || {};
                    costChartState.verticalDrillContext = ctx.monthKey ? { monthKey: ctx.monthKey } : null;
                } else if (t === 'week') {
                    // Week view (keep monthKey + weekEndISO if available)
                    costChartState.verticalDrillLevel = 2;
                    const ctx = costChartState.verticalDrillContext || {};
                    const next = {};
                    if (ctx.monthKey) next.monthKey = ctx.monthKey;
                    if (ctx.weekEndISO) next.weekEndISO = ctx.weekEndISO;
                    costChartState.verticalDrillContext = Object.keys(next).length ? next : null;
                } else {
                    // Day breadcrumb is non-clickable
                    return;
                }

                // Sync slider UI if present
                const slider = document.getElementById('chartDrillSlider');
                if (slider) slider.value = String(costChartState.verticalDrillLevel);
                try {
                    localStorage.setItem('verticalDrillLevel', String(costChartState.verticalDrillLevel));
                    localStorage.setItem('verticalDrillContext', JSON.stringify(costChartState.verticalDrillContext || null));
                } catch (e) {}

                scheduleChartsRedraw('breadcrumb-vbar');
                try { updateBreadcrumb(costChartState.lastTotalCost ?? 0); } catch(e) {}
            } catch (e) {
                console.warn('⚠️ Vertical breadcrumb navigation failed', e);
            }
        }
        
        function clearFilter() {
            console.log('🔄 Clearing filter and resetting view');
            
            // Check if there's an active search before clearing filter
            const hasActiveSearch = costChartState.searchTerm && costChartState.searchTerm.trim() !== '';
            const searchTermToReapply = hasActiveSearch ? costChartState.searchTerm : null;
            
            // Restore to absolute original items (the true full dataset)
            if (costChartState.absoluteOriginalItems) {
                costChartState.items = [...costChartState.absoluteOriginalItems];
                costChartState.originalItems = null; // Clear the temporary backup
                console.log('✓ Restored absolute original items:', costChartState.items.length);
            } else if (costChartState.originalItems) {
                // Fallback to originalItems if absoluteOriginalItems not available
                costChartState.items = [...costChartState.originalItems];
                costChartState.originalItems = null;
                console.log('✓ Restored original items:', costChartState.items.length);
            }
            
            // IMPORTANT: Also update window.originalItems so search applies to all items
            // If search is active, update window.originalItems to the full set
            if (window.originalItems) {
                window.originalItems = costChartState.items;
                console.log('✓ Updated search base to full item set');
            }
            
            // Clear filter data
            costChartState.filterData = null;
            
            // Reset drill-down stack
            costChartState.drillDownStack = [];
            
            // Reset to root level
            costChartState.viewMode = 'itemClass';
            costChartState.highlightKey = null;
            costChartState.currentPage = 0;
            costChartState.rootLevelPage = 0;
            costChartState.showAllItems = false;
            
            // Update dropdown to item class
            const selector = document.getElementById('costChartViewSelector');
            if (selector) {
                selector.value = 'itemClass';
            }
            
            // If there was a search active, reapply it to the full dataset
            if (searchTermToReapply) {
                console.log(`🔄 Reapplying search term: "${searchTermToReapply}"`);
                
                // Clear window.originalItems so search can set it fresh
                window.originalItems = null;
                
                // Reapply the search
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    searchInput.value = searchTermToReapply;
                }
                
                // Trigger the search function
                performSearch(searchTermToReapply);
                console.log('✓ Search reapplied to full item set');
            } else {
                // No search to reapply, just redraw
                scheduleChartsRedraw('dateRange');
                
                // If pie chart is active, also redraw it
                if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                } else if (costChartState.chartType === 'bar-chart') {
                    scheduleChartsRedraw('dateRange');
                }
            }
            
            console.log('✓ Filter cleared, view reset to All Items');
        }
        
        function clearSearch() {
            console.log('🔄 Clearing search term');
            
            // Check if there's an active filter before clearing search
            const hasActiveFilter = costChartState.filterData && costChartState.filterData.filterType;
            const filterDataToReapply = hasActiveFilter ? { ...costChartState.filterData } : null;
            
            // Clear search term in state
            costChartState.searchTerm = '';
            
            // Also clear global searchTerm variable
            searchTerm = '';
            
            // Clear search input visual
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = '';
            }
            
            // Restore items from before search
            if (window.originalItems) {
                costChartState.items = window.originalItems;
                window.originalItems = null;
                console.log('✓ Restored items from before search:', costChartState.items.length);
            }
            
            // If there was a filter active, reapply it
            if (filterDataToReapply) {
                console.log(`🔄 Reapplying filter: "${filterDataToReapply.filterType}"`);
                
                // Ensure we have originalItems backed up
                if (!costChartState.originalItems) {
                    costChartState.originalItems = [...costChartState.items];
                }
                
                // Reapply the filter based on filteredItems
                if (filterDataToReapply.filteredItems && filterDataToReapply.filteredItems.length > 0) {
                    const filteredDescriptions = filterDataToReapply.filteredItems.map(item => item.description);
                    costChartState.items = costChartState.originalItems.filter(item => 
                        filteredDescriptions.includes(item.description)
                    );
                    console.log(`✓ Filter reapplied: ${costChartState.items.length} items`);
                }
            }
            
            // Reset to appropriate view mode
            costChartState.drillDownStack = [];
            costChartState.viewMode = 'itemClass';
            costChartState.currentPage = 0;
            costChartState.highlightKey = null;
            
            // Update dropdown
            const selector = document.getElementById('costChartViewSelector');
            if (selector) {
                selector.value = 'itemClass';
            }
            
            // Redraw chart
            scheduleChartsRedraw('dateRange');
            
            // If pie chart is active, also redraw it
            if (costChartState.chartType === 'pie-chart') {
                drawPieChart();
            } else if (costChartState.chartType === 'bar-chart') {
                scheduleChartsRedraw('dateRange');
            }
            
            console.log('✓ Search cleared');
        }
        
        function handleBackButtonClick() {
            if (costChartState.drillDownStack.length === 0) return;
            
            // Get the key that was selected before drilling down
            const previousLevel = costChartState.drillDownStack[costChartState.drillDownStack.length - 1];
            const selectedKey = previousLevel ? previousLevel.selectedKey : null;
            
            // Clear highlight when going back (but preserve filterData to keep filter chip visible)
            costChartState.highlightKey = null;
            // DON'T clear filterData - keep it to show filter chip
            // costChartState.filterData = null;
            
            // Check if we're going back to root
            if (costChartState.drillDownStack.length === 1) {
                // Going back to root - restore the page we were on
                costChartState.drillDownStack = [];
                costChartState.viewMode = 'itemClass';
                costChartState.currentPage = costChartState.rootLevelPage || 0;
                
                // Update dropdown to reflect root level
                const selector = document.getElementById('costChartViewSelector');
                if (selector) {
                    selector.value = 'itemClass';
                    console.log('✓ Dropdown updated to: itemClass (root level)');
                }
                
                scheduleChartsRedraw('dateRange');
                
                // If pie chart is active, redraw it
                if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                }
                
                // Find and highlight the bar with the selected key (only for bar chart)
                if (selectedKey && costChartState.chartType === 'cost-bar') {
                    const barIndex = costChartState.currentData.findIndex(d => d[2] === selectedKey);
                    if (barIndex >= 0) {
                        costChartState.selectedIndex = barIndex;
                        drawHorizontalBarChart(costChartState.currentData);
                        scrollToBar(barIndex);
                    }
                }
            } else {
                // Going back to an intermediate level
                const targetLevel = costChartState.drillDownStack.length - 2;
                navigateToBreadcrumbLevel(targetLevel);
                
                // If pie chart is active, redraw it
                if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                }
                
                // Find and highlight the bar with the selected key (only for bar chart)
                if (selectedKey && costChartState.chartType === 'cost-bar') {
                    setTimeout(() => {
                        const barIndex = costChartState.currentData.findIndex(d => d[2] === selectedKey);
                        if (barIndex >= 0) {
                            costChartState.selectedIndex = barIndex;
                            drawHorizontalBarChart(costChartState.currentData);
                            scrollToBar(barIndex);
                        }
                    }, 100);
                }
            }
        }
        
        function scrollToBar(barIndex) {
            const scrollContainer = document.querySelector('.cost-chart-side');
            if (!scrollContainer) return;
            
            // Chart dimensions (must match drawHorizontalBarChart)
            const barHeight = 40;
            const barSpacing = 10;
            const topPadding = 15;
            
            // Calculate bar position (center of the bar)
            const barPosition = topPadding + (barIndex * (barHeight + barSpacing)) + (barHeight / 2);
            
            // Get container height
            const containerHeight = scrollContainer.clientHeight;
            
            // Calculate scroll position to center the bar
            const scrollPosition = barPosition - (containerHeight / 2);
            
            // Smooth scroll to position
            scrollContainer.scrollTo({
                top: scrollPosition,
                behavior: 'smooth'
            });
            
            console.log(`📍 Scrolled to bar ${barIndex} at position ${scrollPosition}px`);
        }
        
        function handleDrillDown(groupKey) {
            const currentMode = costChartState.viewMode;
            
            const scrollContainer = document.querySelector('.cost-chart-side');
            const currentScrollPosition = scrollContainer ? scrollContainer.scrollTop : 0;
            
            let nextMode;
            if (currentMode === 'itemClass') {
                nextMode = 'drugName';
            } else if (currentMode === 'drugName') {
                nextMode = 'description';
            } else if (currentMode === 'formulary') {
                nextMode = 'description';
            } else {
                return;
            }
            
            const currentPage = costChartState.currentPage;
            
            if (costChartState.drillDownStack.length === 0) {
                costChartState.rootLevelPage = currentPage;
            }
            
            costChartState.showAllItems = false;
            costChartState.currentPage = 0;
            costChartState.selectedIndex = -1; // Clear selection when drilling down
            costChartState.highlightKey = null; // Clear highlight when drilling down
            // DON'T clear filterData - we want to keep the filter chip visible
            // costChartState.filterData = null; 
            
            costChartState.drillDownStack.push({
                mode: currentMode,
                key: groupKey,
                scrollPosition: currentScrollPosition,
                page: currentPage,
                selectedKey: groupKey  // Store the key for highlighting on return
            });
            
            costChartState.viewMode = nextMode;
            
            // Update dropdown to reflect current drill-down level
            const selector = document.getElementById('costChartViewSelector');
            if (selector) {
                selector.value = nextMode;
                console.log('✓ Dropdown updated to:', nextMode);
            }
            
            drawCostChart(groupKey);
            
            // If pie chart is active, also redraw it
            if (costChartState.chartType === 'pie-chart') {
                drawPieChart();
            }
        }
        
        function drawHorizontalBarChart(data) {
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            if (!canvas || !ctx) return;
            
            // Get CSS variable helper
            const getCSSVar = (varName) => {
                return getComputedStyle(document.body).getPropertyValue(varName).trim();
            };
            
            // Get container dimensions
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth;
            
            // Fixed bar height and spacing (matching original)
            const barHeight = 40;
            const barSpacing = 10;
            const leftPadding = 230;  // Space for category labels (increased by 50px)
            const rightPadding = 60;   // Space for grid labels
            const topPadding = 15;
            const bottomPadding = 20;
            
            // Calculate total height based on number of bars
            const displayHeight = topPadding + bottomPadding + (data.length * (barHeight + barSpacing));
            
            // High DPI rendering - CRITICAL for sharp text and lines
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            
            // CRITICAL: Reset transformation matrix before scaling
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            const width = displayWidth;
            const height = displayHeight;
            
            // Fill with background (support dark mode) - matches time series chart
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, width, height);
            
            if (!data || data.length === 0) {
                ctx.fillStyle = getCSSVar('--text-secondary');
                ctx.font = '14px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText('No data available', width / 2, height / 2);
                return;
            }
            
            // Calculate max value excluding navigation items
            const dataValues = data
                .filter(d => d[2] !== '__PREVIOUS__' && d[2] !== '__NEXT__')
                .map(d => d[1]);
            const maxValue = dataValues.length > 0 ? Math.max(...dataValues) : 1;
            const graphWidth = width - leftPadding - rightPadding;
            
            // Calculate nice interval for grid lines using logarithmic scaling
            const rawInterval = maxValue / 5;
            const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
            const normalized = rawInterval / magnitude;
            let niceInterval;
            if (normalized <= 1) niceInterval = magnitude;
            else if (normalized <= 2) niceInterval = 2 * magnitude;
            else if (normalized <= 5) niceInterval = 5 * magnitude;
            else niceInterval = 10 * magnitude;
            
            const gridMax = Math.ceil(maxValue / niceInterval) * niceInterval;
            const numGridLines = Math.ceil(gridMax / niceInterval);
            
            // Create sticky scale at top
            createStickyScale(gridMax, numGridLines, niceInterval, leftPadding, rightPadding, displayWidth);
            
            // Draw vertical grid lines
            const gridLineColor = getCSSVar('--cost-grid-line');
            ctx.strokeStyle = gridLineColor;
            ctx.lineWidth = 1;
            
            for (let i = 0; i <= numGridLines; i++) {
                const value = i * niceInterval;
                const x = leftPadding + (value / gridMax) * graphWidth;
                
                ctx.beginPath();
                ctx.moveTo(x, topPadding);
                ctx.lineTo(x, height - bottomPadding);
                ctx.stroke();
            }
            
            // Draw bars
            data.forEach((item, index) => {
                const [label, value, key, meta] = item;
                const barWidth = (value / gridMax) * graphWidth;
                const x = leftPadding;
                const y = topPadding + index * (barHeight + barSpacing);
                
                const isNavBar = key === '__PREVIOUS__' || key === '__NEXT__';
                const isHovered = costChartState.hoveredIndex === index;
                const isSelected = costChartState.selectedIndex === index;
                
                // Check if this bar should be highlighted
                const isHighlighted = costChartState.highlightKey && key === costChartState.highlightKey;
                
                // Draw bar
                if (key === '__PREVIOUS__') {
                    // Special visualization for Previous Items
                    const fullWidth = graphWidth;
                    const bgGradient = ctx.createLinearGradient(x, y, x + fullWidth, y);
                    const navBgStart = getCSSVar('--cost-nav-bg-start');
                    const navBgEnd = getCSSVar('--cost-nav-bg-end');
                    bgGradient.addColorStop(0, navBgStart);
                    bgGradient.addColorStop(1, navBgEnd);
                    ctx.fillStyle = bgGradient;
                    ctx.fillRect(x, y, fullWidth, barHeight);
                    
                    // Calculate foreground bar
                    const allItemsTotal = costChartState.allSortedData.reduce((sum, [_, c]) => sum + c, 0);
                    const remainingItemsCost = allItemsTotal - value;
                    const proportion = remainingItemsCost / allItemsTotal;
                    const foregroundWidth = proportion * graphWidth;
                    
                    const fgGradient = ctx.createLinearGradient(x, y, x + foregroundWidth, y);
                    const barStart = getCSSVar('--cost-bar-gradient-start');
                    const barEnd = getCSSVar('--cost-bar-gradient-end');
                    fgGradient.addColorStop(0, barStart);
                    fgGradient.addColorStop(1, barEnd);
                    ctx.fillStyle = fgGradient;
                    
                    ctx.shadowColor = getCSSVar('--cost-bar-shadow');
                    ctx.shadowBlur = 6;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                    
                    ctx.fillRect(x, y, Math.max(4, foregroundWidth), barHeight);
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                } else if (key !== '__NEXT__') {
                    // Normal bars
                    const isQtyMetric = (costChartState.costBarMetric === 'qty');
                    const stackMode = costChartState.inventoryStackMode || 'both';

                    // Stacked segments for Quantity On Hand
                    if (isQtyMetric && stackMode === 'both' && meta && typeof meta === 'object') {
                        const py = Number(meta.qtyPyxis || 0);
                        const ph = Number(meta.qtyPharmacy || 0);
                        const total = Number(meta.qtyTotal || 0) || (py + ph) || value;

                        const pyWidth = total > 0 ? (py / total) * barWidth : 0;
                        const phWidth = total > 0 ? (ph / total) * barWidth : 0;

                        const pyGrad = ctx.createLinearGradient(x, y, x + Math.max(4, pyWidth), y);
                        pyGrad.addColorStop(0, getCSSVar('--qty-bar-pyxis-start'));
                        pyGrad.addColorStop(1, getCSSVar('--qty-bar-pyxis-end'));

                        const phGrad = ctx.createLinearGradient(x + pyWidth, y, x + Math.max(4, pyWidth + phWidth), y);
                        phGrad.addColorStop(0, getCSSVar('--qty-bar-pharmacy-start'));
                        phGrad.addColorStop(1, getCSSVar('--qty-bar-pharmacy-end'));

                        // Shadows to match other bars
                        const shadowHover = getCSSVar('--cost-bar-shadow-hover');
                        const shadowSelected = getCSSVar('--cost-bar-shadow-selected');
                        const shadowNormal = getCSSVar('--cost-bar-shadow');
                        ctx.shadowColor = isHovered ? shadowHover : isSelected ? shadowSelected : shadowNormal;
                        ctx.shadowBlur = (isSelected || isHovered) ? 12 : 6;
                        ctx.shadowOffsetX = 2;
                        ctx.shadowOffsetY = 2;

                        // Draw segments (pyxis then pharmacy)
                        if (pyWidth > 0) {
                            ctx.fillStyle = pyGrad;
                            ctx.fillRect(x, y, Math.max(4, pyWidth), barHeight);
                        }
                        if (phWidth > 0) {
                            ctx.fillStyle = phGrad;
                            ctx.fillRect(x + pyWidth, y, Math.max(4, phWidth), barHeight);
                        }

                        ctx.shadowColor = 'transparent';
                        ctx.shadowBlur = 0;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                    } else {
                    let gradient;
                    if (isHighlighted) {
                        // Highlighted bar - special gold/yellow gradient
                        gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
                        gradient.addColorStop(0, '#FFD700'); // Gold
                        gradient.addColorStop(1, '#FFA500'); // Orange
                    } else if (isHovered) {
                        gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
                        const hoverStart = isQtyMetric ? getCSSVar('--qty-bar-hover-start') : getCSSVar('--cost-bar-hover-start');
                        const hoverEnd = isQtyMetric ? getCSSVar('--qty-bar-hover-end') : getCSSVar('--cost-bar-hover-end');
                        gradient.addColorStop(0, hoverStart);
                        gradient.addColorStop(1, hoverEnd);
                    } else if (isSelected) {
                        gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
                        const selectedStart = isQtyMetric ? getCSSVar('--qty-bar-selected-start') : getCSSVar('--cost-bar-selected-start');
                        const selectedEnd = isQtyMetric ? getCSSVar('--qty-bar-selected-end') : getCSSVar('--cost-bar-selected-end');
                        gradient.addColorStop(0, selectedStart);
                        gradient.addColorStop(1, selectedEnd);
                    } else {
                        gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
                        const barStart = isQtyMetric ? getCSSVar('--qty-bar-gradient-start') : getCSSVar('--cost-bar-gradient-start');
                        const barEnd = isQtyMetric ? getCSSVar('--qty-bar-gradient-end') : getCSSVar('--cost-bar-gradient-end');
                        gradient.addColorStop(0, barStart);
                        gradient.addColorStop(1, barEnd);
                    }
                    ctx.fillStyle = gradient;
                    
                    const shadowHover = getCSSVar('--cost-bar-shadow-hover');
                    const shadowSelected = getCSSVar('--cost-bar-shadow-selected');
                    const shadowNormal = getCSSVar('--cost-bar-shadow');
                    ctx.shadowColor = isHighlighted ? 'rgba(255, 215, 0, 0.6)' :
                                     isHovered ? shadowHover : 
                                     isSelected ? shadowSelected : 
                                     shadowNormal;
                    ctx.shadowBlur = (isHighlighted || isSelected || isHovered) ? 12 : 6;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                    
                    // Projected Waste cost view: draw stacked segments (used vs leftover) where total length == total inventory cost
                    const metricMode = costChartState.costBarMetric || 'cost';
                    if (costChartState.specialDataset === 'projectedWaste' && metricMode === 'cost' && meta && typeof meta === 'object' && (meta.costLeftover !== undefined || meta.costUsed !== undefined)) {
                        const total = Number(meta.costTotal ?? value) || 0;
                        const usedV = Number(meta.costUsed || 0);
                        const leftV = Number(meta.costLeftover || 0);
                        const totalWidth = Math.max(4, (total / gridMax) * graphWidth);
                        const usedW = total > 0 ? (usedV / total) * totalWidth : 0;
                        const leftW = total > 0 ? (leftV / total) * totalWidth : 0;

                        // Draw used segment (lighter)
                        ctx.save();
                        ctx.globalAlpha = 0.35;
                        ctx.fillStyle = gradient;
                        ctx.fillRect(x, y, Math.max(0, usedW), barHeight);
                        ctx.restore();

                        // Draw leftover (waste) segment (solid)
                        ctx.fillStyle = gradient;
                        ctx.fillRect(x + Math.max(0, usedW), y, Math.max(0, leftW), barHeight);
                    } else {
                        ctx.fillRect(x, y, Math.max(4, barWidth), barHeight);
                    }
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    }
                }
                
                // Draw category label (left side) - RIGHT ALIGNED with word wrap
                // Always use bold font for measurements to prevent alignment shift
                ctx.font = 'bold 12px system-ui';
                
                const maxLabelWidth = leftPadding - 15;
                
                // Word wrap logic - measure with bold font
                const words = label.split(' ');
                const lines = [];
                let currentLine = '';
                
                words.forEach(word => {
                    const testLine = currentLine ? currentLine + ' ' + word : word;
                    const metrics = ctx.measureText(testLine);
                    
                    if (metrics.width > maxLabelWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        currentLine = testLine;
                    }
                });
                if (currentLine) lines.push(currentLine);
                
                // Limit to 3 lines for 40px bars
                const maxLines = 3;
                const displayLines = lines.slice(0, maxLines);
                if (lines.length > maxLines) {
                    displayLines[maxLines - 1] = displayLines[maxLines - 1] + '...';
                }
                
                // Now set the actual rendering style
                if (isNavBar) {
                    // Navigation items (Previous/Next) in coral color
                    const navLabelColor = getCSSVar('--cost-nav-label-color');
                    ctx.fillStyle = navLabelColor;
                    ctx.font = 'italic 12px system-ui';
                } else if (isHovered) {
                    // Hovered labels are bold green
                    const labelHover = getCSSVar('--cost-label-hover');
                    ctx.fillStyle = labelHover;
                    ctx.font = 'bold 12px system-ui';
                } else if (isSelected) {
                    const labelSelected = getCSSVar('--cost-label-selected');
                    ctx.fillStyle = labelSelected;
                    ctx.font = 'bold 12px system-ui';
                } else {
                    // Normal and highlighted bars use same text style
                    const labelNormal = getCSSVar('--cost-label-normal');
                    ctx.fillStyle = labelNormal;
                    ctx.font = '12px system-ui, -apple-system, sans-serif';
                }
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                
                // Draw each line, centered vertically within the bar
                const lineHeight = 13;
                const totalTextHeight = displayLines.length * lineHeight;
                const startY = y + (barHeight - totalTextHeight) / 2 + (lineHeight / 2);
                
                displayLines.forEach((line, i) => {
                    ctx.fillText(line, leftPadding - 5, startY + (i * lineHeight));
                });
                
                // Draw value at end of bar (only visible when hovered for non-navigation items)
                if (!isNavBar && isHovered) {
                    const metricMode = costChartState.costBarMetric;
                    const isQty = (metricMode === 'qty');
                    const stackMode = costChartState.inventoryStackMode || 'both';

                    let formattedValue;
                    if (metricMode === 'usage') {
                        formattedValue = Math.round(value).toLocaleString('en-US');
                    } else if (isQty) {
                        formattedValue = Math.round(value).toLocaleString('en-US');
                    } else {
                        // Cost display: for Projected Waste, show leftover (waste) cost as the primary number
                        const displayCost = (costChartState.specialDataset === 'projectedWaste' && meta && typeof meta === 'object' && meta.costLeftover !== undefined)
                            ? Number(meta.costLeftover || 0)
                            : Number(value || 0);
                        formattedValue = '$' + displayCost.toLocaleString('en-US', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0
                        });
                    }
const valueColor = getCSSVar('--cost-label-hover');
                    ctx.fillStyle = valueColor;  // Match hovered label color
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';

                    // Position at end of bar + 20px
                    const valueX = x + Math.max(4, barWidth) + 20;
                    const valueY = y + (barHeight / 2);

                    // Primary (total) label
                    ctx.font = 'bold 12px system-ui';
                    ctx.fillText(formattedValue, valueX, valueY - (isQty ? 7 : 0));

                    // Quantity split tooltip (Pyxis / Pharmacy)
                    if (isQty && meta && typeof meta === 'object') {
                        const py = Math.round(Number(meta.qtyPyxis || 0));
                        const ph = Math.round(Number(meta.qtyPharmacy || 0));

                        let splitText;
                        if (stackMode === 'pyxis') splitText = `Pyxis: ${py.toLocaleString('en-US')}`;
                        else if (stackMode === 'pharmacy') splitText = `Pharmacy: ${ph.toLocaleString('en-US')}`;
                        else splitText = `Pyxis: ${py.toLocaleString('en-US')} | Pharmacy: ${ph.toLocaleString('en-US')}`;

                        ctx.font = '11px system-ui';
                        ctx.fillText(splitText, valueX, valueY + 8);
                    }

                    // Projected Waste split tooltip (Total vs Leftover cost)
                    const isCost = (metricMode === 'cost');
                    if (isCost && costChartState.specialDataset === 'projectedWaste' && meta && typeof meta === 'object' && (meta.costLeftover !== undefined || meta.costUsed !== undefined)) {
                        const totalC = Number(meta.costTotal ?? value) || 0;
                        const leftC = Number(meta.costLeftover || 0) || 0;
                        const usedC = Number(meta.costUsed || Math.max(0, totalC - leftC)) || 0;

                        ctx.font = '11px system-ui';
                        const line1 = `Total: $${Math.round(totalC).toLocaleString('en-US')}`;
                        const line2 = `Used: $${Math.round(usedC).toLocaleString('en-US')} | Leftover: $${Math.round(leftC).toLocaleString('en-US')}`;
                        ctx.fillText(line1, valueX, valueY + 8);
                        ctx.fillText(line2, valueX, valueY + 22);
                    }

                }
            });
        }
        
        // ==================================================================================
        // TIME SERIES CHART
        // ==================================================================================
        
        /**
         * Draw Usage Vs Restock ratio chart (line chart with gradient)
         */
        function drawUsageVsRestockChart() {
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            if (!canvas || !ctx) return;
            
            console.log('📈 Drawing Usage Vs Restock ratio chart');
            
            // Get filtered items
            let items = costChartState.items;
            
            // Apply drill-down filters
            if (costChartState.drillDownStack && costChartState.drillDownStack.length > 0) {
                costChartState.drillDownStack.forEach(level => {
                    if (level.mode === 'itemClass') {
                        items = items.filter(item => (item.itemClass || 'Unknown') === level.key);
                    } else if (level.mode === 'drugName') {
                        items = items.filter(item => (item.drugName || 'Unknown') === level.key);
                    } else if (level.mode === 'description') {
                        // Filter by specific item description
                        items = items.filter(item => (item.description || 'Unknown') === level.key);
                    }
                });
            }
            
            console.log(`📊 Calculating usage vs restock for ${items.length} items`);
            
            // Calculate weekly usage vs restock ratios
            // Keep this consistent with the Analytics page card (13 weeks).
            const maxWeeks = 13;
            const weeklyRatios = [];
            
            for (let week = 0; week < maxWeeks; week++) {
                let totalUsage = 0;
                let totalRestock = 0;
                
                items.forEach(item => {
                    const uArr = Array.isArray(item.usageRate) ? item.usageRate : [];
                    const rArr = Array.isArray(item.restockRate) ? item.restockRate : [];

                    // Align by most-recent weeks (arrays may be shorter than maxWeeks)
                    const uIdx = uArr.length - maxWeeks + week;
                    const rIdx = rArr.length - maxWeeks + week;

                    const u = (uIdx >= 0 && uIdx < uArr.length) ? (uArr[uIdx] || 0) : 0;
                    const r = (rIdx >= 0 && rIdx < rArr.length) ? (rArr[rIdx] || 0) : 0;

                    totalUsage += u;
                    totalRestock += r;
                });
                
                // Calculate ratio
                // Match Analytics card/line logic: if no restock, ratio is 0.
                const ratio = totalRestock > 0 ? Math.min(totalUsage / totalRestock, 1.5) : 0;
                weeklyRatios.push(ratio);
            }
            
            console.log('📊 Weekly ratios:', weeklyRatios);
            
            // Setup canvas
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth;
            const displayHeight = container.clientHeight || 600;
            
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            
            // Clear background
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            // Chart margins
            const margin = { top: 40, right: 20, bottom: 60, left: 70 };
            const chartWidth = displayWidth - margin.left - margin.right;
            const chartHeight = displayHeight - margin.top - margin.bottom;
            
            // Y-axis: 0 to 1.5
            const yMin = 0;
            const yMax = 1.5;
            const yRange = yMax - yMin;
            
            // Draw grid lines
            const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            
            const numYGridLines = 6; // 0, 0.3, 0.6, 0.9, 1.2, 1.5
            for (let i = 0; i <= numYGridLines; i++) {
                const yValue = (i / numYGridLines) * yRange;
                const y = margin.top + chartHeight - (yValue / yRange) * chartHeight;
                
                ctx.beginPath();
                ctx.moveTo(margin.left, y);
                ctx.lineTo(margin.left + chartWidth, y);
                ctx.stroke();
                
                // Y-axis labels
                ctx.fillStyle = isDarkMode ? '#e0e0e0' : '#666666';
                ctx.font = '11px system-ui, -apple-system, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(yValue.toFixed(1), margin.left - 10, y);
            }
            
            // Draw threshold line at configurable position (default 0.5)
            const thresholdValue = costChartState.usageVsRestockThreshold || 0.5;
            const thresholdY = margin.top + chartHeight - (thresholdValue / yRange) * chartHeight;
            ctx.strokeStyle = isDarkMode ? 'rgba(255, 200, 150, 0.5)' : 'rgba(255, 127, 80, 0.5)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(margin.left, thresholdY);
            ctx.lineTo(margin.left + chartWidth, thresholdY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Generate week labels
            const weekLabels = [];
            const anchorISO = (costChartState._txDateBounds && costChartState._txDateBounds.maxISO)
                ? costChartState._txDateBounds.maxISO
                : (new Date()).toISOString().split('T')[0];
            const today = new Date(anchorISO + 'T00:00:00');
            for (let i = maxWeeks - 1; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - (i * 7));
                const month = date.getMonth() + 1;
                const day = date.getDate();
                weekLabels.push(`${month}/${day}`);
            }
            
            // X-axis labels
            ctx.fillStyle = isDarkMode ? '#e0e0e0' : '#666666';
            ctx.font = '10px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            
            for (let i = 0; i < maxWeeks; i++) {
                const x = maxWeeks > 1 
                    ? margin.left + (i / (maxWeeks - 1)) * chartWidth
                    : margin.left + chartWidth / 2;
                ctx.fillText(String(weekLabels[i] || '').replace(/\/$/, ''), x, margin.top + chartHeight + 10);
            }
            
            // Axis titles
            ctx.fillStyle = isDarkMode ? '#ffffff' : '#333333';
            ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
            
            // Y-axis title
            ctx.save();
            ctx.translate(15, margin.top + chartHeight / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.fillText('Usage / Restock Ratio', 0, 0);
            ctx.restore();
            
            const axisTitle = 'Week Ending';
            // X-axis title
            ctx.textAlign = 'center';
            ctx.fillText(axisTitle, margin.left + chartWidth / 2, margin.top + chartHeight + 40);
            
            // Title section removed per user request
            
            // Draw gradient fill under the line
            // Create path for area
            ctx.beginPath();
            ctx.moveTo(margin.left, margin.top + chartHeight); // Bottom left
            
            for (let i = 0; i < weeklyRatios.length; i++) {
                const x = margin.left + (i / (weeklyRatios.length - 1)) * chartWidth;
                const ratio = Math.min(weeklyRatios[i], yMax);
                const y = margin.top + chartHeight - (ratio / yRange) * chartHeight;
                ctx.lineTo(x, y);
            }
            
            ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight); // Bottom right
            ctx.closePath();
            
            // Create gradient (teal at top blending to coral, more gradual transition)
            const gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartHeight);
            gradient.addColorStop(0, 'rgba(17, 153, 142, 0.4)'); // Teal at top (1.5)
            gradient.addColorStop(0.5, 'rgba(17, 153, 142, 0.35)'); // Teal fading
            gradient.addColorStop(0.67, 'rgba(100, 140, 120, 0.35)'); // Blend color at 0.5 threshold
            gradient.addColorStop(0.75, 'rgba(180, 130, 100, 0.35)'); // Transition
            gradient.addColorStop(0.85, 'rgba(220, 130, 90, 0.4)'); // More coral
            gradient.addColorStop(1, 'rgba(255, 127, 80, 0.4)'); // Full coral at bottom (0)
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            // Draw the line itself
            ctx.beginPath();
            for (let i = 0; i < weeklyRatios.length; i++) {
                const x = margin.left + (i / (weeklyRatios.length - 1)) * chartWidth;
                const ratio = Math.min(weeklyRatios[i], yMax);
                const y = margin.top + chartHeight - (ratio / yRange) * chartHeight;
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            
            ctx.strokeStyle = '#11998e'; // Teal line
            ctx.lineWidth = 3;
            ctx.stroke();
            
            // Draw data points
            for (let i = 0; i < weeklyRatios.length; i++) {
                const x = margin.left + (i / (weeklyRatios.length - 1)) * chartWidth;
                const ratio = Math.min(weeklyRatios[i], yMax);
                const y = margin.top + chartHeight - (ratio / yRange) * chartHeight;
                
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#11998e';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            
            console.log('✅ Usage Vs Restock chart drawn');
        }
        
        function drawTimeSeriesChart() {
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            if (!canvas || !ctx) return;
            
            // Get CSS variable helper
            const getCSSVar = (varName) => {
                return getComputedStyle(document.body).getPropertyValue(varName).trim();
            };
            
            // Get variance data (top 10 expensive + total inventory backdrop)
            const varianceData = calculateVarianceData();
            
            if (!varianceData || varianceData.series.length === 0) {
                drawChartPlaceholder('time-chart');
                return;
            }
            
            // Get container dimensions - fill entire container
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth;
            const displayHeight = container.clientHeight || 600;  // Use container height or fallback
            
            // High DPI rendering
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            
            // Clear with background (support dark mode)
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            // Chart margins (reduced to fill canvas better)
            const margin = { top: 40, right: 20, bottom: 60, left: 70 };
            const chartWidth = displayWidth - margin.left - margin.right;
            const chartHeight = displayHeight - margin.top - margin.bottom;
            
            const maxWeeks = varianceData.weeks;
            
            // Find min/max variance for Y-axis scaling (percentage)
            const allVariances = varianceData.series.flatMap(s => s.data);
            const minVariance = Math.min(...allVariances, 0);
            const maxVariance = Math.max(...allVariances, 0);
            
            // Add padding to prevent cutoff
            const yMin = Math.floor(minVariance - 10);
            const yMax = Math.ceil(maxVariance + 10);
            const yRange = yMax - yMin;
            
            // Draw grid lines (matching cost chart style)
            ctx.strokeStyle = getCSSVar('--cost-grid-line');
            ctx.lineWidth = 1;
            const numYGridLines = 5;
            
            for (let i = 0; i <= numYGridLines; i++) {
                const yPercent = yMin + (i / numYGridLines) * yRange;
                const y = margin.top + chartHeight - ((yPercent - yMin) / yRange) * chartHeight;
                
                ctx.beginPath();
                ctx.moveTo(margin.left, y);
                ctx.lineTo(margin.left + chartWidth, y);
                ctx.stroke();
                
                // Y-axis labels (percentage)
                ctx.fillStyle = getCSSVar('--cost-scale-label');
                ctx.font = '11px system-ui, -apple-system, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                const label = yPercent >= 0 ? `+${yPercent.toFixed(0)}%` : `${yPercent.toFixed(0)}%`;
                ctx.fillText(label, margin.left - 10, y);
            }
            
            // Draw zero line more prominently
            const zeroY = margin.top + chartHeight - ((0 - yMin) / yRange) * chartHeight;
            ctx.strokeStyle = getCSSVar('--text-secondary');
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(margin.left, zeroY);
            ctx.lineTo(margin.left + chartWidth, zeroY);
            ctx.stroke();
            
            // X-axis labels (weeks) - matching cost chart font
            ctx.fillStyle = getCSSVar('--cost-scale-label');
            ctx.font = '10px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            
            // Generate week labels
            const weekLabels = [];
            // Anchor to latest transaction date when available (more stable than system "today")
            const anchorISO = (costChartState._txDateBounds && costChartState._txDateBounds.maxISO)
                ? costChartState._txDateBounds.maxISO
                : (new Date()).toISOString().split('T')[0];
            const today = new Date(anchorISO + 'T00:00:00');
            for (let i = maxWeeks - 1; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - (i * 7));
                weekLabels.push(formatDate(date));
            }
            
            for (let i = 0; i < maxWeeks; i++) {
                const x = maxWeeks > 1 
                    ? margin.left + (i / (maxWeeks - 1)) * chartWidth
                    : margin.left + chartWidth / 2;
                if (i < weekLabels.length) {
                    ctx.fillText(String(weekLabels[i] || '').replace(/\/$/, ''), x, margin.top + chartHeight + 10);
                }
            }
            
            // Axis titles
            ctx.fillStyle = getCSSVar('--text-primary');
            ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
            
            // Y-axis title
            ctx.save();
            ctx.translate(15, margin.top + chartHeight / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.fillText('Variance from Average (%)', 0, 0);
            ctx.restore();
            const axisTitle = 'Week Ending';
            
            // X-axis title
            ctx.textAlign = 'center';
            ctx.fillText(axisTitle, margin.left + chartWidth / 2, margin.top + chartHeight + 40);
            
            // Draw total inventory variance as backdrop (if available)
            if (varianceData.totalInventory) {
                ctx.save();
                ctx.globalAlpha = 0.15;
                
                // Draw filled area for total inventory
                ctx.fillStyle = '#888888';
                ctx.beginPath();
                ctx.moveTo(margin.left, zeroY);
                
                varianceData.totalInventory.forEach((variance, index) => {
                    const x = maxWeeks > 1
                        ? margin.left + (index / (maxWeeks - 1)) * chartWidth
                        : margin.left + chartWidth / 2;
                    const y = margin.top + chartHeight - ((variance - yMin) / yRange) * chartHeight;
                    ctx.lineTo(x, y);
                });
                
                ctx.lineTo(margin.left + chartWidth, zeroY);
                ctx.closePath();
                ctx.fill();
                
                // Draw line for total inventory
                ctx.globalAlpha = 0.3;
                ctx.strokeStyle = '#555555';
                ctx.lineWidth = 2;
                ctx.beginPath();
                
                varianceData.totalInventory.forEach((variance, index) => {
                    const x = maxWeeks > 1
                        ? margin.left + (index / (maxWeeks - 1)) * chartWidth
                        : margin.left + chartWidth / 2;
                    const y = margin.top + chartHeight - ((variance - yMin) / yRange) * chartHeight;
                    
                    if (index === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                
                ctx.stroke();
                ctx.restore();
            }
            
            // Define colors for different series
            const colors = [
                '#11998e', '#ff6b6b', '#667eea', '#38ef7d', '#ffa500',
                '#9b59b6', '#e74c3c', '#3498db', '#1abc9c', '#f39c12'
            ];
            
            // Draw each series with area fill (NO POINTS, NO LEGEND)
            varianceData.series.forEach((series, seriesIndex) => {
                const color = colors[seriesIndex % colors.length];
                
                // Draw filled area between line and zero
                ctx.save();
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(margin.left, zeroY);
                
                series.data.forEach((variance, pointIndex) => {
                    const x = maxWeeks > 1
                        ? margin.left + (pointIndex / (maxWeeks - 1)) * chartWidth
                        : margin.left + chartWidth / 2;
                    const y = margin.top + chartHeight - ((variance - yMin) / yRange) * chartHeight;
                    ctx.lineTo(x, y);
                });
                
                ctx.lineTo(margin.left + chartWidth, zeroY);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                
                // Draw solid line (NO POINTS)
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                
                series.data.forEach((variance, pointIndex) => {
                    const x = maxWeeks > 1
                        ? margin.left + (pointIndex / (maxWeeks - 1)) * chartWidth
                        : margin.left + chartWidth / 2;
                    const y = margin.top + chartHeight - ((variance - yMin) / yRange) * chartHeight;
                    
                    if (pointIndex === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                
                ctx.stroke();
            });
            
            // NO LEGEND - removed as requested
        }
        
        function calculateVarianceData() {
            // Start with the processed dataset by default (must include usageRate/restockRate arrays)
            // Only use window.originalItems if it already has computed rate arrays; otherwise it may be raw/unprocessed.
            let items = Array.isArray(costChartState.items) ? costChartState.items : [];
            if (Array.isArray(window.originalItems) && window.originalItems.length > 0) {
                const looksProcessed = window.originalItems.some(it => Array.isArray(it.usageRate) || Array.isArray(it.restockRate));
                if (looksProcessed) items = window.originalItems;
            }
            
            console.log('📊 Time Series: Calculating variance data...');
            console.log('📦 Total items:', items.length);
            console.log('🔍 Drill down stack:', costChartState.drillDownStack);
            console.log('✨ Highlight key:', costChartState.highlightKey);
            
            // Apply drill-down filters if any
            for (const level of costChartState.drillDownStack) {
                if (level.mode === 'itemClass') {
                    items = items.filter(item => (item.itemClass || 'Unknown') === level.key);
                } else if (level.mode === 'drugName') {
                    items = items.filter(item => (item.drugName || 'Unknown') === level.key);
                } else if (level.mode === 'description') {
                    items = items.filter(item => (item.description || 'Unknown') === level.key);
                } else if (level.mode === 'formulary') {
                    items = items.filter(item => {
                        const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                        const key = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                        return key === level.key;
                    });
                }
            }
            
            // Apply highlightKey filter if set (from cost chart selection)
            if (costChartState.highlightKey) {
                console.log('🎯 Applying highlightKey filter:', costChartState.highlightKey);
                const viewMode = costChartState.viewMode;
                const beforeFilterCount = items.length;
                items = items.filter(item => {
                    if (viewMode === 'itemClass') {
                        return (item.itemClass || 'Unknown') === costChartState.highlightKey;
                    } else if (viewMode === 'drugName') {
                        return (item.drugName || 'Unknown') === costChartState.highlightKey;
                    } else if (viewMode === 'description') {
                        return (item.description || 'Unknown') === costChartState.highlightKey;
                    } else if (viewMode === 'formulary') {
                        const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                        const key = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                        return key === costChartState.highlightKey;
                    }
                    return true;
                });
                console.log(`✓ After highlightKey filter: ${items.length} items (was ${beforeFilterCount})`);
            }
            
            if (items.length === 0) {
                console.log('❌ Time Series: No items after drill-down filters');
                return null;
            }
            
            console.log('✓ Items after drill-down:', items.length);
            
            // Filter items with usageRate data
            items = items.filter(item => Array.isArray(item.usageRate) && item.usageRate.length > 0);
            
            console.log('✓ Items with usageRate data:', items.length);
            
            if (items.length === 0) {
                console.log('❌ Time Series: No items with usageRate data');
                return null;
            }
            
            // Sort by totalCost and get top 10 most expensive
            items.sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0));
            const topItems = items.slice(0, 10);
            
            // Find maximum weeks across all items
            const maxWeeks = Math.max(...topItems.map(item => item.usageRate.length));
            
            // Calculate total inventory usage for backdrop
            const totalInventoryUsage = new Array(maxWeeks).fill(0);
            const totalInventoryCounts = new Array(maxWeeks).fill(0);
            
            items.forEach(item => {
                const offset = maxWeeks - item.usageRate.length;
                item.usageRate.forEach((value, index) => {
                    totalInventoryUsage[offset + index] += value;
                    totalInventoryCounts[offset + index]++;
                });
            });
            
            // Calculate average and variance for total inventory (with percentile cutoff)
            const percentileCutoff = 0.95; // Use 95th percentile (similar to settings modal logic)
            
            function calculateAverageWithCutoff(usageArray) {
                if (usageArray.length === 0) return 0;
                
                // Sort and apply percentile cutoff
                const sorted = [...usageArray].sort((a, b) => a - b);
                const cutoffIndex = Math.floor(sorted.length * percentileCutoff);
                const trimmed = sorted.slice(0, cutoffIndex);
                
                if (trimmed.length === 0) return 0;
                return trimmed.reduce((sum, val) => sum + val, 0) / trimmed.length;
            }
            
            const totalInventoryAverage = calculateAverageWithCutoff(totalInventoryUsage);
            const totalInventoryVariance = totalInventoryUsage.map(usage => {
                if (totalInventoryAverage === 0) return 0;
                return ((usage - totalInventoryAverage) / totalInventoryAverage) * 100;
            });
            
            // Calculate variance for each top item
            const series = topItems.map(item => {
                const usageArray = item.usageRate;
                const offset = maxWeeks - usageArray.length;
                
                // Calculate average with percentile cutoff
                const average = calculateAverageWithCutoff(usageArray);
                
                // Calculate variance as percentage
                const variance = new Array(maxWeeks).fill(0);
                usageArray.forEach((value, index) => {
                    if (average === 0) {
                        variance[offset + index] = 0;
                    } else {
                        variance[offset + index] = ((value - average) / average) * 100;
                    }
                });
                
                return {
                    label: item.description || item.drugName || 'Unknown',
                    data: variance
                };
            });
            
            console.log('✅ Time Series: Variance data calculated');
            console.log('📈 Series count:', series.length);
            console.log('📅 Weeks:', maxWeeks);
            
            return {
                series: series,
                totalInventory: totalInventoryVariance,
                weeks: maxWeeks
            };
        }
        
        function formatDate(date) {
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            return `${month}/${day}`;
        }

        // Returns YYYY-MM-DD in local time (used for projected waste / expiration bucketing)
        function toISODate(date) {
            const d = (date instanceof Date) ? date : new Date(date);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        
        // ==================================================================================
        // PIE CHART
        // ==================================================================================
        
        function drawPieChart() {
            console.log('🥧 Drawing pie chart with drill-down');
            
            try {
                const canvas = costChartState.canvas;
                const ctx = costChartState.ctx;
                
                if (!canvas || !ctx) {
                    console.error('❌ Canvas not initialized');
                    return;
                }
                
                console.log('✓ Canvas and context available');
            
            // Get canvas dimensions from container (responsive to window)
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth;
            // Use actual container height (responsive to window), with minimum
            const displayHeight = Math.max(container.clientHeight, 500);
            
            // Set canvas size with device pixel ratio
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            
            // Fill with background
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            // Get theme colors
            const tealPrimary = getComputedStyle(document.body).getPropertyValue('--teal-primary').trim();
            
            // Calculate TOTAL inventory cost (always use original full set if available)
            const itemsForTotal = window.originalItems || costChartState.items;
            const totalInventoryCost = itemsForTotal.reduce((sum, item) => {
                // Use wasteValue if available, otherwise calculate inventory cost
                const itemCost = item.wasteValue !== undefined 
                    ? item.wasteValue 
                    : ((item.quantity || 0) * parseFloat(item.unitPrice || 0));
                return sum + itemCost;
            }, 0);
            
            console.log('📊 Total Inventory Cost:', totalInventoryCost);
            
            // Layout: 2/3 left for chart, 1/3 right for future info
            const chartWidth = displayWidth * (2/3);
            const padding = 40;
            
            // Calculate radius constraints
            const maxRadiusFromWidth = chartWidth - padding;
            const maxRadiusFromHeight = displayHeight / 2 - padding;
            const minRadius = Math.min(maxRadiusFromWidth, maxRadiusFromHeight);
            const maxRadius = minRadius * 2;
            
            // Arc constraints
            const minArcHeight = 5;
            const minAngle = (1 * Math.PI) / 180;
            
            // Determine what to display based on state
            let itemsToGroup = itemsForTotal;
            
            console.log('🥧 Pie Chart State:');
            console.log('  - Current Level:', costChartState.drillDownStack?.length || 0);
            console.log('  - View Mode:', costChartState.viewMode);
            console.log('  - Drill Stack:', costChartState.drillDownStack?.map(d => d.key) || []);
            console.log('  - Highlight Key:', costChartState.highlightKey);
            console.log('  - Filter Data:', costChartState.filterData ? 'present' : 'none');
            
            // Priority 1: Apply drill-down filters
            if (costChartState.drillDownStack && costChartState.drillDownStack.length > 0) {
                costChartState.drillDownStack.forEach(level => {
                    if (level.mode === 'itemClass') {
                        itemsToGroup = itemsToGroup.filter(item => (item.itemClass || 'Unknown') === level.key);
                    } else if (level.mode === 'drugName') {
                        itemsToGroup = itemsToGroup.filter(item => (item.drugName || 'Unknown') === level.key);
                    } else if (level.mode === 'description') {
                        itemsToGroup = itemsToGroup.filter(item => (item.description || 'Unknown') === level.key);
                    }
                });
                
                // After drill-down filters, apply highlightKey for visual highlighting
                // BUT: At description level, DON'T filter - keep all items visible
                if (costChartState.highlightKey && costChartState.viewMode !== 'description') {
                    console.log('🎯 Pie: Applying highlightKey filter on top of drill-down:', costChartState.highlightKey);
                    const viewMode = costChartState.viewMode;
                    itemsToGroup = itemsToGroup.filter(item => {
                        if (viewMode === 'itemClass') {
                            return (item.itemClass || 'Unknown') === costChartState.highlightKey;
                        } else if (viewMode === 'drugName') {
                            return (item.drugName || 'Unknown') === costChartState.highlightKey;
                        }
                        return true;
                    });
                }
            }
            // Priority 2: Apply highlight/filter from shortage bulletin (no drill-down)
            else if (costChartState.highlightKey && costChartState.filterData) {
                const filterData = costChartState.filterData;
                
                if (costChartState.viewMode === 'itemClass') {
                    const itemClass = filterData.itemClass || 'Unknown';
                    itemsToGroup = itemsToGroup.filter(item => (item.itemClass || 'Unknown') === itemClass);
                } else if (costChartState.viewMode === 'drugName') {
                    const drugName = filterData.drugName || 'Unknown';
                    itemsToGroup = itemsToGroup.filter(item => (item.drugName || 'Unknown') === drugName);
                } else if (costChartState.viewMode === 'description') {
                    const description = filterData.description || 'Unknown';
                    itemsToGroup = itemsToGroup.filter(item => (item.description || 'Unknown') === description);
                }
            }
            // Priority 3: Use search filter if active
            else if (window.originalItems && costChartState.items.length < itemsForTotal.length) {
                itemsToGroup = costChartState.items;
            }
            
            console.log('✓ Items to group:', itemsToGroup.length);
            
            // Group by current view mode
            const grouped = {};
            itemsToGroup.forEach(item => {
                let key;
                if (costChartState.viewMode === 'itemClass') {
                    // Level 1: Show classes
                    key = item.itemClass || 'Unknown';
                } else if (costChartState.viewMode === 'drugName') {
                    // Level 2: Show names within the class
                    key = item.drugName || 'Unknown';
                } else if (costChartState.viewMode === 'description') {
                    // Level 3: Show individual items (descriptions) within the name
                    key = item.description || 'Unknown';
                } else if (costChartState.viewMode === 'formulary') {
                    const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                    key = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                } else {
                    key = item.itemClass || 'Unknown';
                }
                
                if (!grouped[key]) grouped[key] = 0;
                // Use wasteValue if available, otherwise calculate inventory cost
                const itemCost = item.wasteValue !== undefined 
                    ? item.wasteValue 
                    : (item.quantity || 0) * parseFloat(item.unitPrice || 0);
                grouped[key] += itemCost;
            });
            
            // Convert to array and sort by cost (descending)
            const slivers = Object.entries(grouped)
                .map(([key, cost]) => ({ key, cost }))
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 10); // Top 10
            
            console.log('📊 Slivers:', slivers.length, 'items');
            
            // Log what level we're showing
            if (costChartState.viewMode === 'itemClass') {
                console.log('  📍 Displaying: LEVEL 1 - Classes (click to drill to Names)');
            } else if (costChartState.viewMode === 'drugName') {
                console.log('  📍 Displaying: LEVEL 2 - Names (click to drill to Items)');
            } else if (costChartState.viewMode === 'description') {
                console.log('  📍 Displaying: LEVEL 3 - Items (click to select/filter)');
            }
            
            // If no slivers, just show the base pie
            if (slivers.length === 0) {
                console.log('⚠️ No slivers to display - showing base pie only');
                
                const baseRadius = minRadius * 0.93;
                const centerX = chartWidth - minRadius;
                const centerY = displayHeight / 2;
                
                // Store slice data for hover tooltip
                costChartState.pieSlices = [];
                
                // Draw base pie only
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = tealPrimary;
                ctx.beginPath();
                ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
                ctx.closePath();
                ctx.fill();
                
                // Outline
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = isDarkMode ? '#666666' : '#333333';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
                
                // Store whole pie for tooltip
                costChartState.pieSlices.push({
                    startAngle: 0,
                    endAngle: 2 * Math.PI,
                    centerX: centerX,
                    centerY: centerY,
                    radius: baseRadius,
                    baseRadius: minRadius, // Store unscaled base
                    label: 'Total Inventory',
                    value: totalInventoryCost,
                    percentage: 100,
                    isWholePie: true
                });
                
                console.log('✓ Base pie drawn (no slivers)');
                
                // Update breadcrumb with total inventory cost (all items)
                updateBreadcrumb(totalInventoryCost);
                
                return;
            }
            
            // Calculate angles for each sliver (NO GAPS)
            const totalSliversCost = slivers.reduce((sum, s) => sum + s.cost, 0);
            console.log('💰 Total of visible slices:', totalSliversCost);
            console.log('💰 Total of all items:', totalInventoryCost);
            
            const sliverAngles = slivers.map(s => {
                let angle = (s.cost / totalInventoryCost) * 2 * Math.PI;
                if (angle < minAngle) angle = minAngle;
                return { ...s, angle };
            });
            
            // Calculate total angle (no gaps)
            const totalAngle = sliverAngles.reduce((sum, s) => sum + s.angle, 0);
            
            // Calculate desired radius based on arc height requirement
            const maxSliverAngle = sliverAngles.length > 0 ? Math.max(...sliverAngles.map(s => s.angle)) : 0;
            let desiredRadius = minRadius;
            
            if (maxSliverAngle > 0) {
                const arcHeight = minRadius * (1 - Math.cos(maxSliverAngle / 2));
                if (arcHeight < minArcHeight) {
                    desiredRadius = minArcHeight / (1 - Math.cos(maxSliverAngle / 2));
                }
            }
            
            // Calculate radius based on drill-down level (not stored value)
            const currentLevel = costChartState.drillDownStack.length;
            const baseRadiusCalc = Math.max(minRadius, Math.min(desiredRadius, maxRadius));
            const sliverRadius = getPieRadiusForLevel(currentLevel, baseRadiusCalc);
            const baseRadius = sliverRadius * 0.93;
            
            // Position
            const sliverEndpoint = chartWidth;
            const centerX = sliverEndpoint - sliverRadius;
            const centerY = displayHeight / 2;
            
            console.log('📐 Level', currentLevel, 'Radius:', sliverRadius, 'Base:', baseRadiusCalc);
            
            // Store slice data for hover tooltip
            costChartState.pieSlices = [];
            
            // ============ DRAW BASE PIE (WHOLE INVENTORY) ============
            // Only show semi-transparent base when there are multiple slivers
            // If single sliver covers whole pie, make base invisible
            const isSingleFullSliver = (slivers.length === 1 && totalAngle >= (2 * Math.PI - 0.01));
            
            ctx.save();
            ctx.globalAlpha = isSingleFullSliver ? 0.0 : 0.5; // Invisible if single full sliver
            ctx.fillStyle = tealPrimary;
            ctx.beginPath();
            ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.fill();
            
            // Outline (always visible)
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = isDarkMode ? '#666666' : '#333333';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            
            // Store whole pie for tooltip
            costChartState.pieSlices.push({
                startAngle: 0,
                endAngle: 2 * Math.PI,
                centerX: centerX,
                centerY: centerY,
                radius: baseRadius,
                label: 'Total Inventory',
                value: totalInventoryCost,
                percentage: 100,
                isWholePie: true
            });
            
            // ============ DRAW SLIVERS (TOP 10 WITH COLOR GRADIENT) ============
            if (slivers.length > 0) {
                // Calculate starting angle to center the slivers at 3 o'clock
                const startAngle = -totalAngle / 2;
                
                let currentAngle = startAngle;
                
                slivers.forEach((sliver, index) => {
                    const sliverAngle = sliverAngles[index].angle;
                    const endAngle = currentAngle + sliverAngle;
                    const percentage = (sliver.cost / totalInventoryCost) * 100;
                    
                    ctx.save();
                    
                    // Color gradient based on percentage
                    // Higher percentage = darker teal, lower = lighter teal
                    const maxPercentage = (slivers[0].cost / totalInventoryCost) * 100;
                    const minPercentage = (slivers[slivers.length - 1].cost / totalInventoryCost) * 100;
                    
                    // Handle single sliver case (avoid division by zero)
                    let normalizedValue;
                    if (maxPercentage === minPercentage) {
                        // Single sliver - use middle brightness
                        normalizedValue = 0.5;
                    } else {
                        normalizedValue = (percentage - minPercentage) / (maxPercentage - minPercentage);
                    }
                    
                    // Parse teal color and adjust brightness (keeping fully opaque)
                    // tealPrimary is typically #20b2aa or similar
                    const tealRGB = hexToRgb(tealPrimary);
                    const brightness = 0.5 + (normalizedValue * 0.5); // 0.5 to 1.0
                    const color = `rgba(${Math.round(tealRGB.r * brightness)}, ${Math.round(tealRGB.g * brightness)}, ${Math.round(tealRGB.b * brightness)}, 1.0)`;
                    
                    // Check if this slice is highlighted
                    const isHighlighted = costChartState.highlightKey === sliver.key;
                    
                    // Use gold/orange color for highlighted slices
                    const fillColor = isHighlighted ? '#FFA500' : color; // Orange for highlighted
                    
                    // Stronger glow for highlighted
                    ctx.shadowColor = isHighlighted ? 'rgba(255, 165, 0, 0.6)' : color;
                    ctx.shadowBlur = isHighlighted ? 15 : 5;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    
                    // Draw sliver with appropriate fill
                    ctx.fillStyle = fillColor;
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.arc(centerX, centerY, sliverRadius, currentAngle, endAngle);
                    ctx.closePath();
                    ctx.fill();
                    
                    // Add thin border (same for all - no special highlight border)
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = isDarkMode ? '#555555' : '#666666';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    
                    ctx.restore();
                    
                    // Store sliver data
                    costChartState.pieSlices.unshift({
                        startAngle: currentAngle,
                        endAngle: endAngle,
                        centerX: centerX,
                        centerY: centerY,
                        radius: sliverRadius,
                        baseRadius: baseRadiusCalc, // Store unscaled base for animation
                        color: color, // Store the gradient color
                        label: sliver.key,
                        value: sliver.cost,
                        percentage: percentage,
                        isWholePie: false,
                        canDrillDown: costChartState.viewMode !== 'description' // Can drill from itemClass and drugName
                    });
                    
                    // Move to next sliver position (NO GAP)
                    currentAngle = endAngle;
                });
            }
            
            console.log('✓ Pie chart drawn with', slivers.length, 'slivers');
            console.log('✓ Total pieSlices stored:', costChartState.pieSlices.length, 'slices');
            console.log('  - Slice details:', costChartState.pieSlices.map(s => ({
                label: s.label,
                isWholePie: s.isWholePie,
                canDrillDown: s.canDrillDown
            })));
            
            // Update breadcrumb display with the total of visible slices
            updateBreadcrumb(totalSliversCost);
            
            } catch (error) {
                console.error('❌ Error in drawPieChart:', error);
                console.error('Error stack:', error.stack);
            }
        }
        
        // Helper function to convert hex to RGB
        function hexToRgb(hex) {
            // Remove # if present
            hex = hex.replace(/^#/, '');
            
            // Parse hex values
            const bigint = parseInt(hex, 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            
            return { r, g, b };
        }


        // ==================================================================================
        // SANKEY CHART (from Analytics_Page)
        // ==================================================================================
        
        /**
         * Draw Sankey chart using Google Charts
         */
        /**
         * Open shortage bulletin with current filtered items
         */
        function openShortagebulletin() {
            console.log('📋 Opening shortage bulletin with current filter');

            // Persist the current chart state so when the user returns via back arrow,
            // we can restore the exact view they left.
            try { persistAnalyticsStateForReturn(); } catch (e) {}
            
            // Get current view mode and determine filter type
            let filterType = null;
            let filterValue = null;
            
            // Check if we're at a drilled-down level
            if (costChartState.drillDownStack && costChartState.drillDownStack.length > 0) {
                const currentLevel = costChartState.drillDownStack[costChartState.drillDownStack.length - 1];
                filterType = currentLevel.mode;
                filterValue = currentLevel.key;
            } else if (costChartState.viewMode === 'description' && costChartState.highlightKey) {
                // At description level with highlighted item
                filterType = 'description';
                filterValue = costChartState.highlightKey;
            } else if (costChartState.viewMode === 'drugName' && costChartState.highlightKey) {
                // At drug name level with highlighted drug
                filterType = 'drugName';
                filterValue = costChartState.highlightKey;
            } else if (costChartState.viewMode === 'itemClass' && costChartState.highlightKey) {
                // At item class level with highlighted class
                filterType = 'itemClass';
                filterValue = costChartState.highlightKey;
            } else {
                // Default to current view mode
                filterType = costChartState.viewMode;
                // Try to get the most recent highlighted or drilled item
                if (costChartState.highlightKey) {
                    filterValue = costChartState.highlightKey;
                }
            }
            
            console.log('📊 Filter determined:', { filterType, filterValue });
            
            // Send message to parent to navigate to shortage bulletin
            if (window.parent && window.parent !== window) {
                const message = {
                    type: 'navigateToTab',
                    tab: 'inventory'
                };
                
                // Only include filter if we have a specific value
                if (filterValue) {
                    message.filter = filterType;
                    message.value = filterValue;
                    console.log('✓ Navigating with filter:', { filterType, filterValue });
                } else {
                    console.log('✓ Navigating without filter - will show all items');
                }
                
                window.parent.postMessage(message, '*');
            }
        }
        
        // ------------------------------------------------------------------------------
        // FLOW / SANKEY AGGREGATION (Jan 2026 only)
        // ------------------------------------------------------------------------------
        function canonicalizeLocationCode(raw) {
            const v = (raw == null) ? '' : String(raw).trim();
            if (!v) return '';

            const map = (typeof window !== 'undefined' && window.SUBLOCATION_MAP) ? window.SUBLOCATION_MAP : null;
            if (map && map[v]) return v;

            // Common Pyxis location encoding: RV<CODE>ES, e.g. RV2WAES -> 2WA
            let s = v;
            if (/^RV.+ES$/i.test(s)) s = s.replace(/^RV/i, '').replace(/ES$/i, '');
            else if (/ES$/i.test(s)) s = s.replace(/ES$/i, '');

            if (map && map[s]) return s;
            return v;
        }

        function getLocationInfo(code) {
            const map = (typeof window !== 'undefined' && window.SUBLOCATION_MAP) ? window.SUBLOCATION_MAP : null;
            return map && code && map[code] ? map[code] : null;
        }

        function getShiftLabel(info) {
            if (!info) return 'Unassigned';
            const am = (info.amshift || '').trim();
            const pm = (info.pmshift || '').trim();
            const ev = (info.eveningshift || '').trim();
            return am || pm || ev || 'Unassigned';
        }

        function flattenTransactionsToRows(transactionsRoot) {
            // Expected merged shape: { [itemCode]: { history: [...] } }
            if (!transactionsRoot || typeof transactionsRoot !== 'object') return [];
            const rows = [];
            Object.keys(transactionsRoot).forEach((itemCode) => {
                const h = transactionsRoot[itemCode] && Array.isArray(transactionsRoot[itemCode].history)
                    ? transactionsRoot[itemCode].history
                    : [];
                for (let i = 0; i < h.length; i++) {
                    const t = h[i];
                    if (t && typeof t === 'object') {
                        rows.push({ itemCode, ...t });
                    }
                }
            });
            return rows;
        }

        function buildFlowDataFromTransactions(mode) {
	            const md = cachedMockData || costChartState.cachedMockData;
	            const txRoot = md && md.transactions ? md.transactions : null;

		            // IMPORTANT: Flow chart must respect the same user-visible filtering as other charts.
		            // - Breadcrumb drillDownStack (class -> name -> description)
		            // - Type-to-search (costChartState.searchTerm) which replaces costChartState.items
		            // - filterData chips
		            // The prior implementation only constrained flows when drillDownStack was non-empty,
		            // so a plain search (stack empty) would not affect the Sankey.

	            // Apply the same breadcrumb (drillDownStack) filtering used by the other charts.
	            // Breadcrumb path: itemClass → drugName → description.
	            // In flow-chart mode the breadcrumb UI may be hidden, but the state is still active
	            // and should constrain the flow aggregation.
		            const stack = Array.isArray(costChartState.drillDownStack) ? costChartState.drillDownStack : [];
		            const hasSearch = !!(costChartState && costChartState.searchTerm && String(costChartState.searchTerm).trim());
		            const hasFilterChip = !!(costChartState && costChartState.filterData);
		            let allowedCodes = null;
		            try {
		                // Choose the item universe to constrain flows:
		                // - If search is active, costChartState.items is already the searched subset
		                // - Otherwise, prefer originalItems if present (full set)
		                const baseItems = (hasSearch ? (costChartState.items || []) : (window.originalItems || costChartState.items || []));
		                let filteredItems = baseItems;

		                // Apply breadcrumb path filtering first.
		                if (stack.length > 0) {
	                    stack.forEach(level => {
	                        if (!level) return;
	                        if (level.mode === 'itemClass') {
	                            filteredItems = filteredItems.filter(it => (it.itemClass || 'Unknown') === level.key);
	                        } else if (level.mode === 'drugName') {
	                            filteredItems = filteredItems.filter(it => (it.drugName || 'Unknown') === level.key);
	                        } else if (level.mode === 'description') {
	                            filteredItems = filteredItems.filter(it => (it.description || 'Unknown') === level.key);
	                        }
	                    });
		                }

		                // If we have ANY active user-visible narrowing (breadcrumb, search, or chip),
		                // constrain the Sankey to the current filteredItems.
		                if (stack.length > 0 || hasSearch || hasFilterChip) {
		                    const set = new Set();
		                    const add = (k) => {
		                        if (k == null) return;
		                        const s = String(k).trim();
		                        if (!s) return;
		                        set.add(s);
		                        const norm = s.replace(/^0+/, '') || s;
		                        if (norm !== s) set.add(norm);
		                    };
		                    for (let i = 0; i < filteredItems.length; i++) {
		                        const it = filteredItems[i] || {};
		                        add(it.itemCode || it.ItemCode);
		                        add(it.alt_itemCode || it.altItemCode);
		                        add(it.ndc || it.NDC);
		                        add(it.drugCode || it.DrugCode);
		                    }
		                    allowedCodes = set;
		                }
	            } catch (e) {
	                allowedCodes = null;
	            }
	            // Cache flattened rows for performance (Sankey rebuild can be triggered by UI interactions)
	            if (!costChartState._txRowsCache || costChartState._txRowsCacheSource !== txRoot) {
	                costChartState._txRowsCache = flattenTransactionsToRows(txRoot);
	                costChartState._txRowsCacheSource = txRoot;
	            }
	            const txRowsAll = costChartState._txRowsCache || [];
	            let txRows = txRowsAll;
	            // Optional: constrain flow to a specific item+sublocation (used by Stock-out segment click)
	            // IMPORTANT: For refills/sends, the destination is often sendToLocation, not sublocation.
	            try {
	                const seg = costChartState && costChartState.flowSegmentFilter ? costChartState.flowSegmentFilter : null;
	                const segActive = !!(seg && (seg.itemCode || seg.sublocation));
	                if (seg) {
	                    const wantCode = String(seg.itemCode || '').trim();
	                    const wantLoc = String(seg.sublocation || '').trim();
	                    const wantLocCanon = wantLoc ? canonicalizeLocationCode(wantLoc) : '';
                    if (wantCode) {
	                        const wantNorm = wantCode.replace(/^0+/, '') || wantCode;
	                        txRows = txRowsAll.filter(r => {
	                            const code = String(r.itemCode || r.ItemCode || r.code || '').trim();
	                            const norm = code.replace(/^0+/, '') || code;
	                            if (!(code === wantCode || norm === wantNorm)) return false;
	                            if (wantLocCanon) {
                                const fromLoc = canonicalizeLocationCode(
                                    r.sublocation || r.subLocation || r.fromLocation || r.from || r.location ||
                                    r.locationCode || r.pyxisLocation || r.station || r.binLocation || r.loc
                                );
                                const toLoc = canonicalizeLocationCode(
                                    r.sendToLocation || r.toLocation || r.sendTo || r.destLocation || r.destinationLocation ||
                                    r.destination || r.to || r.mainLocation || r.targetLocation || r.receiveLocation || r.locTo
                                );
                                return (fromLoc === wantLocCanon) || (toLoc === wantLocCanon);
	                            }
	                            return true;
	                        });
	                    }
	                }
	            } catch (e) {}



            // Date range filter: prefer the visible From/To inputs used by the Charts date picker.
            // If the vertical bar chart day-selection override is active, it MUST take precedence.
            const fromEl = document.getElementById('chartFromDate');
            const toEl = document.getElementById('chartToDate');
            let rangeFrom = (fromEl && fromEl.value) ? String(fromEl.value).slice(0,10) : '';
            let rangeTo = (toEl && toEl.value) ? String(toEl.value).slice(0,10) : '';
	            if (!rangeFrom && !rangeTo) {
	                // Fallback to helper if inputs are empty
	                const sel = (typeof getSelectedDateRangeISO === 'function') ? getSelectedDateRangeISO() : null;
	                rangeFrom = sel && sel.from ? String(sel.from).slice(0,10) : '';
	                rangeTo = sel && sel.to ? String(sel.to).slice(0,10) : '';
	            }

            // Apply override range (from selected day bars) if present.
            try {
                const ovr = costChartState && costChartState.flowRangeOverride;
                if (ovr && ovr.active && ovr.from && ovr.to) {
                    rangeFrom = String(ovr.from).slice(0,10);
                    rangeTo = String(ovr.to).slice(0,10);
                }
            } catch (e) {}

            // 1) Only tally these transactionTypes (case-insensitive, trimmed)
            // Default flow is restock/refill focused; when a segment filter is active we allow more types
            // and create a pseudo destination node for dispenses when needed.
            const ALLOWED_TYPES = new Set(['pyxis refill','pyxis send','restock','refill','send']);
            const normType = (s) => String(s || '').toLowerCase().replace(/\s+/g,' ').trim();

            // Aggregate counts by:
            //  - From: sublocation
            //  - To: mainLocation (derived from sendToLocation via SUBLOCATION_MAP)
            // Also keep breakdown of raw sendToLocation under each mainLocation for tooltips.
            const counts = new Map(); // key: from→toMain, value: count
            const breakdown = new Map(); // key: toMain, value: Map(sendTo,count)
            const groupByMain = new Map(); // key: toMain, value: group string

            // Helper: lookup info for a location code
            const locInfo = (code) => getLocationInfo(canonicalizeLocationCode(code));

	            const segNow = costChartState && costChartState.flowSegmentFilter ? costChartState.flowSegmentFilter : null;
	            const segMode = !!(segNow && (segNow.itemCode || segNow.sublocation));
	            const segActivated = !!(costChartState && costChartState.flowSegmentActivated && segMode);
	            const segWantLocCanon = segMode && segNow && segNow.sublocation ? canonicalizeLocationCode(segNow.sublocation) : '';
	            const segWantCode = segMode && segNow && segNow.itemCode ? String(segNow.itemCode).trim() : '';
	            const segWantCodeNorm = segWantCode ? (segWantCode.replace(/^0+/, '') || segWantCode) : '';
	            let segTotalTx = 0;
	            const segDailyMap = segActivated ? Object.create(null) : null;
	            for (let i = 0; i < txRows.length; i++) {
                const t = txRows[i] || {};

	                // Breadcrumb filter: constrain to codes in the current drill-down selection.
	                if (allowedCodes && allowedCodes.size) {
	                    const codeRaw = t.itemCode || t.ItemCode || t.item_code || t.code || t.Code || t.ndc || t.NDC || '';
	                    const code = String(codeRaw || '').trim();
	                    if (!code || !allowedCodes.has(code)) {
	                        const norm = code ? (code.replace(/^0+/, '') || code) : '';
	                        if (!norm || !allowedCodes.has(norm)) continue;
	                    }
	                }

	                const dRaw = String(t.transDate || t.date || t.transdate || '');
	                if (!dRaw || dRaw.length < 10) continue;
	                const d = dRaw.slice(0,10);
	                if (rangeFrom && d < rangeFrom) continue;
	                if (rangeTo && d > rangeTo) continue;

	                const tt = normType(t.transactionType);
                if (!segMode) {
                    if (!ALLOWED_TYPES.has(tt)) continue;
                }

	                // Segment mode: enforce item+location constraint even if upstream txRows isn't fully narrowed.
	                if (segMode && segWantCode) {
	                    const codeRaw = t.itemCode || t.ItemCode || t.item_code || t.code || t.Code || t.ndc || t.NDC || '';
	                    const code = String(codeRaw || '').trim();
	                    const norm = code.replace(/^0+/, '') || code;
	                    if (!(code === segWantCode || norm === segWantCodeNorm)) continue;
	                }

                // Location extraction: different feeds use different field names.
                // In segment mode, if no destination is present, treat it as a "Dispense" sink.
                let fromLoc = canonicalizeLocationCode(
                    t.sublocation || t.subLocation || t.fromLocation || t.from || t.location ||
                    t.locationCode || t.pyxisLocation || t.station || t.binLocation || t.loc
                );
                let toLocRaw = canonicalizeLocationCode(
                    t.sendToLocation || t.toLocation || t.sendTo || t.destLocation || t.destinationLocation ||
                    t.destination || t.to || t.mainLocation || t.targetLocation || t.receiveLocation || t.locTo
                );
                if (!fromLoc && toLocRaw) fromLoc = toLocRaw;
                if (segMode && fromLoc && !toLocRaw) {
                    toLocRaw = 'DISPENSE';
                }
                if (!fromLoc || !toLocRaw) continue;
                if (fromLoc === toLocRaw) continue;

	                if (segMode && segWantLocCanon) {
	                    if (fromLoc !== segWantLocCanon && toLocRaw !== segWantLocCanon) continue;
	                }

	                // Segment tx summary (total + daily counts) is based on the same effective
	                // txRows as the Sankey (i.e., after date range + segment constraints).
	                if (segActivated) {
	                    segTotalTx++;
	                    const k = d;
	                    segDailyMap[k] = (segDailyMap[k] || 0) + 1;
	                }

                const toInfo = locInfo(toLocRaw) || {};
                const toMain = String(toInfo.mainLocation || toLocRaw).trim() || toLocRaw;
                const toGroup = String(toInfo.group || '').trim() || 'Unassigned';

                // Persist group by mainLocation (first non-empty wins)
                if (!groupByMain.has(toMain)) groupByMain.set(toMain, toGroup);

                // Track breakdown of sendToLocation under mainLocation
                if (!breakdown.has(toMain)) breakdown.set(toMain, new Map());
                const b = breakdown.get(toMain);
                b.set(toLocRaw, (b.get(toLocRaw) || 0) + 1);

                // Mode transforms:
                // location: From = sublocation, To = mainLocation
                // group:    From = Group <group>, To = mainLocation
                // shift:    From = shift label (AM/PM/EV), To = mainLocation
                let fromNode = fromLoc;
                if (mode === 'group') {
                    const g = String(toGroup || '').trim() || 'Unassigned';
                    fromNode = (g === 'Unassigned') ? 'Group Unassigned' : `Group ${g}`;
                } else if (mode === 'shift') {
                    const info = locInfo(fromLoc);
                    fromNode = getShiftLabel(info);
                }

                // Encode group into the target node id to help deterministic ordering + coloring,
                // but we will strip it back out for display after render.
                const toNode = `${toMain}`; // display without group prefix

                const key = `${fromNode}→${toNode}`;
                counts.set(key, (counts.get(key) || 0) + 1);
            }

	            // Persist segment-mode tx summary (for the 14-day strip above Sankey).
	            try {
	                if (segActivated) {
	                    const end = (rangeTo || '').slice(0,10);
	                    const start = (rangeFrom || '').slice(0,10);
	                    const toDateObj = (iso)=>{
	                        const p = String(iso||'').split('-');
	                        if (p.length!==3) return null;
	                        return new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
	                    };
	                    const fmt = (dt)=>{
	                        const y = dt.getFullYear();
	                        const m = String(dt.getMonth()+1).padStart(2,'0');
	                        const da = String(dt.getDate()).padStart(2,'0');
	                        return `${y}-${m}-${da}`;
	                    };
	                    const endDt = toDateObj(end) || new Date();
	                    const daily14 = [];
	                    for (let j = 13; j >= 0; j--) {
	                        const ddt = new Date(endDt.getTime());
	                        ddt.setDate(ddt.getDate() - j);
	                        const k = fmt(ddt);
	                        // Clip to selected range if from/to are available
	                        if (start && k < start) continue;
	                        if (end && k > end) continue;
	                        daily14.push({ date: k, count: Number(segDailyMap[k] || 0) });
	                    }
	                    costChartState.flowSegmentTxSummary = {
	                        itemCode: segWantCode,
	                        sublocation: String(segNow.sublocation || '').trim(),
	                        rangeFrom: rangeFrom,
	                        rangeTo: rangeTo,
	                        totalTx: segTotalTx,
	                        daily14
	                    };
	                } else {
	                    costChartState.flowSegmentTxSummary = null;
	                }
	            } catch (e) {}

            // Build flow rows (sorted for stable node ordering)
            const flows = Array.from(counts.entries()).map(([k, v]) => {
                const parts = k.split('→');
                return { from: parts[0], to: parts[1], value: v };
            }).sort((a, b) => {
                // sort by target group then target main then value desc
                const ag = String(a.to).split('|')[0] || '';
                const bg = String(b.to).split('|')[0] || '';
                if (ag !== bg) return ag.localeCompare(bg);
                const am = String(a.to).split('|')[1] || '';
                const bm = String(b.to).split('|')[1] || '';
                if (am !== bm) return am.localeCompare(bm);
                return b.value - a.value;
            });

            // Flatten breakdown into plain object for tooltips
            const breakdownObj = {};
            breakdown.forEach((m, main) => {
                const entries = Array.from(m.entries()).sort((a,b)=>b[1]-a[1]);
                breakdownObj[main] = entries; // [ [sendTo, count], ... ]
            });

            const groupByMainObj = {};
            groupByMain.forEach((g, main) => { groupByMainObj[main] = g; });

            return { flows, breakdownByMain: breakdownObj, groupByMain: groupByMainObj };
        }

	        function ensureFlowDataReady(forceRebuild = false) {
            const mode = costChartState.flowMode || 'location';

            // When explicitly requested, nuke all memoized flow state so the next build is authoritative.
            if (forceRebuild) {
                try {
                    costChartState._flowCacheKey = null;
                    costChartState.stockFlowData = null;
                } catch (e) {}
            }
            // Make flow aggregation strictly date-range aware.
            // We cache by (mode + from + to) so switching the calendar range always rebuilds.
            let from = '', to = '';
            // If the vertical bar chart day-view has an active selection, it overrides the flow date range.
            try {
                const ovr = costChartState && costChartState.flowRangeOverride;
                if (ovr && ovr.active && ovr.from && ovr.to) {
                    from = String(ovr.from).slice(0,10);
                    to = String(ovr.to).slice(0,10);
                }
            } catch (e) {}
            try {
                const fromEl = document.getElementById('chartFromDate');
                const toEl = document.getElementById('chartToDate');
                // Only read from the date picker if there is no override.
                if (!from && !to) {
                    from = (fromEl && fromEl.value) ? String(fromEl.value).slice(0,10) : '';
                    to   = (toEl && toEl.value) ? String(toEl.value).slice(0,10) : '';
                }
                if (!from && !to) {
                    const sel = (typeof getSelectedDateRangeISO === 'function') ? getSelectedDateRangeISO() : null;
                    from = sel && sel.from ? String(sel.from).slice(0,10) : '';
                    to   = sel && sel.to   ? String(sel.to).slice(0,10) : '';
                }
            } catch (e) {}
	            // Include breadcrumb/drill-down filters AND search/filter chips in the cache key so
	            // Sankey rebuilds when the user types-to-search or toggles chips while staying on flow view.
            let stackSig = '';
            try {
                const stack = Array.isArray(costChartState.drillDownStack) ? costChartState.drillDownStack : [];
                stackSig = stack.map(s => `${s.mode || ''}:${s.key || s.value || ''}`).join('>');
            } catch (e) { stackSig = ''; }

            // Segment-mode (stockout click) must be part of the flow cache key so the
            // Sankey rebuilds when the user clicks different segments.
            let segSig = '';
            try {
                const seg = costChartState && costChartState.flowSegmentFilter ? costChartState.flowSegmentFilter : null;
                if (seg && (seg.itemCode || seg.sublocation)) {
                    segSig = `SEG:${String(seg.itemCode || '').trim()}@${String(seg.sublocation || '').trim()}`;
                }
            } catch (e) { segSig = ''; }
	            let searchSig = '';
	            try { searchSig = (costChartState && costChartState.searchTerm) ? String(costChartState.searchTerm).trim().toLowerCase() : ''; } catch (e) { searchSig = ''; }
	            let filterSig = '';
	            try {
	                const fd = costChartState && costChartState.filterData ? costChartState.filterData : null;
	                if (fd) filterSig = `${fd.filterType || ''}:${fd.filterValue || fd.label || fd.key || ''}`;
	            } catch (e) { filterSig = ''; }
	            const key = `${mode}|${from}|${to}|${stackSig}|${searchSig}|${filterSig}|${segSig}`;
            if (!costChartState.stockFlowData || costChartState._flowCacheKey !== key) {
                costChartState._flowCacheKey = key;
                costChartState.stockFlowData = buildFlowDataFromTransactions(mode);
            }
            return costChartState.stockFlowData;
        }

        function drawSankeyChart(flowData, renderToken = null) {
            console.log('🔵 drawSankeyChart START');

            // Tokenize draws so delayed google callbacks can't overwrite a newer state.
            try {
                if (renderToken == null) {
                    costChartState._flowRenderNonce = (Number(costChartState._flowRenderNonce) || 0) + 1;
                    renderToken = costChartState._flowRenderNonce;
                }
                costChartState._flowLastRequestedToken = renderToken;
            } catch (e) {}

            // Always clear the container first so changing the date range can't leave a stale rendering.
            const container = document.getElementById('sankeyChart');
            if (container) {
                container.innerHTML = '';
                // If Flow was activated from a stockout segment click, show a small tx summary strip
                // above the Sankey, based on the same date range currently selected in the picker.
                try {
                    const segOn = !!(costChartState && costChartState.flowSegmentActivated && costChartState.flowSegmentFilter);
                    const sum = segOn ? (costChartState.flowSegmentTxSummary || null) : null;
                    if (segOn && sum && Array.isArray(sum.daily14) && sum.daily14.length) {
                        const max = Math.max(1, ...sum.daily14.map(d => Number(d.count || 0)));
                        const bars = sum.daily14.map(d => {
                            const h = Math.round((Number(d.count || 0) / max) * 24);
                            return `<div class="flow14-bar" title="${d.date}: ${d.count}" style="height:${h}px"></div>`;
                        }).join('');
                        const rangeLabel = (sum.rangeFrom && sum.rangeTo) ? `${sum.rangeFrom} → ${sum.rangeTo}` : '';
                        container.innerHTML = `
                            <div class="flow-seg-summary">
                                <div class="flow-seg-summary-top">
                                    <div class="flow-seg-summary-title">Transactions</div>
                                    <div class="flow-seg-summary-total">${Number(sum.totalTx || 0).toLocaleString('en-US')}</div>
                                </div>
                                <div class="flow-seg-summary-sub">${rangeLabel}</div>
                                <div class="flow14-strip">${bars}</div>
                            </div>
                            <div id="sankeyInner" class="sankey-inner"></div>
                        `;
                    } else {
                        container.innerHTML = `<div id="sankeyInner" class="sankey-inner"></div>`;
                    }
                } catch (e) {
                    container.innerHTML = `<div id="sankeyInner" class="sankey-inner"></div>`;
                }
            }
            
            // Validate data
            if (!flowData) {
                console.error('❌ flowData is null/undefined');
                return;
            }
            
            if (!flowData.flows) {
                console.error('❌ flowData.flows is null/undefined');
                console.log('flowData:', flowData);
                return;
            }
            
            if (!Array.isArray(flowData.flows)) {
                console.error('❌ flowData.flows is not an array');
                console.log('flowData.flows:', flowData.flows);
                return;
            }
            
            if (flowData.flows.length === 0) {
                console.warn('⚠️ flowData.flows is empty for selected range');
                if (container) {
                    container.innerHTML = '<div style="padding:16px; font:14px system-ui; color: var(--text-secondary, #666);">No flow data in the selected date range.</div>';
                }
                return;
            }
            
            console.log('✅ Data valid:', flowData.flows.length, 'flows');
            
            // Check if google is defined
            if (typeof google === 'undefined') {
                console.error('❌ Google Charts not loaded - google is undefined');
                return;
            }
            
            console.log('✅ google object exists');
            
            // Load and draw. If the Sankey package is already available, draw immediately.
            try {
                if (google && google.visualization && typeof google.visualization.Sankey === 'function') {
                    drawChart();
                } else {
                    console.log('🔄 Calling google.charts.load...');
                    google.charts.load('current', {'packages':['sankey']});
                    google.charts.setOnLoadCallback(drawChart);
                    console.log('✅ Callback registered');
                }
            } catch (e) {
                console.warn('⚠️ Sankey load/draw failed, retrying via google.charts.load', e);
                google.charts.load('current', {'packages':['sankey']});
                google.charts.setOnLoadCallback(drawChart);
            }
            
            function drawChart() {
                console.log('🎨 drawChart callback fired!');

                // Bail if a newer request has superseded this draw.
                try {
                    const current = Number(costChartState._flowLastRequestedToken) || 0;
                    if (renderToken != null && current && Number(renderToken) !== current) {
                        console.log('⏭️ Skipping stale Sankey draw (token mismatch)', renderToken, '!=', current);
                        return;
                    }
                    if (costChartState.chartType !== 'flow-chart') {
                        console.log('⏭️ Skipping Sankey draw (not in flow view)');
                        return;
                    }
                } catch (e) {}
                
                try {
                    // Get container (already cleared above)
                    // If a segment summary strip is present, the Sankey should draw inside #sankeyInner.
                    const container2 = document.getElementById('sankeyInner') || document.getElementById('sankeyChart');
                    if (!container2) {
                        console.error('❌ #sankeyChart container not found in DOM');
                        return;
                    }
                    console.log('✅ Container found:', container2);
                    
                    // Build data array
                    console.log('🔄 Building data array...');
                    const dataTable = new google.visualization.DataTable();
                    dataTable.addColumn('string', 'From');
                    dataTable.addColumn('string', 'To');
                    dataTable.addColumn('number', 'Weight');
                    dataTable.addColumn({type: 'string', role: 'tooltip', p: { html: true }});  // Custom tooltip (HTML)
                    
                    // Find min and max values for scaling
                    const flowValues = flowData.flows.map(f => f.value);
                    const minValue = Math.min(...flowValues);
                    const maxValue = Math.max(...flowValues);
                    
                    // Calculate scaling factor to ensure minimum 2px line width
                    // Assuming chart width of ~800px and typical Sankey rendering,
                    // we want minValue to render as at least 2px
                    // A value that's 0.25% of max typically renders as ~2px
                    const minVisibleRatio = 0.00625; // ~0.625% (thicker minimum)
                    const currentMinRatio = minValue / maxValue;
                    
                    // Only scale if needed
                    const scalingFactor = currentMinRatio < minVisibleRatio 
                        ? minVisibleRatio / currentMinRatio 
                        : 1;
                    
                    
// Build tooltip strings with breakdown of raw sendToLocation under each mainLocation
// Basic HTML escape for tooltips
const escapeHtml = (s) => {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const buildSankeyTooltip = (flow, originalValue) => {
    try {
        const main = String(flow.to || '');
        const group = (flowData && flowData.groupByMain && flowData.groupByMain[main]) ? flowData.groupByMain[main] : '';
        const breakdown = (flowData && flowData.breakdownByMain && flowData.breakdownByMain[main]) ? flowData.breakdownByMain[main] : [];

        const lines = breakdown.slice(0, 12).map(([loc, c]) => {
            return `<li><span class="sankey-tt-loc">${escapeHtml(String(loc))}</span><span class="sankey-tt-count">${Number(c).toLocaleString()}</span></li>`;
        }).join('');

        const more = (breakdown.length > 12)
            ? `<div class="sankey-tt-more">+${breakdown.length - 12} more…</div>`
            : '';

        const gLine = group ? `<div class="sankey-tt-meta"><b>Group:</b> ${escapeHtml(String(group))}</div>` : '';
        return `
            <div class="sankey-tt">
                ${gLine}
                <div class="sankey-tt-meta"><b>Main:</b> ${escapeHtml(main)}</div>
                <div class="sankey-tt-meta"><b>${Number(originalValue).toLocaleString()}</b> txns</div>
                ${lines ? `<div class="sankey-tt-title">SendTo breakdown</div><ul class="sankey-tt-list">${lines}</ul>${more}` : ''}
            </div>
        `;
    } catch (e) {
        return `<div class="sankey-tt"><b>${Number(originalValue).toLocaleString()}</b> txns</div>`;
    }
};
                    const rows = [];
                    flowData.flows.forEach(flow => {
                        const originalValue = flow.value;
                        const scaledValue = originalValue * scalingFactor;
                        const tooltip = buildSankeyTooltip(flow, originalValue);  // Custom tooltip with breakdown
                        rows.push([
                            String(flow.from),
                            String(flow.to),
                            Number(scaledValue),  // Use scaled value for rendering
                            tooltip
                        ]);
                    });
                    
                    dataTable.addRows(rows);
                    console.log('✅ DataTable created with', rows.length, 'rows (scaling factor:', scalingFactor.toFixed(2) + ')');
                    
                    // Check theme
                    const isDark = document.body.classList.contains('dark-mode');
                    console.log('🎨 Theme:', isDark ? 'dark' : 'light');
                    
                    // Get CSS variable values from BODY (where dark-mode class is)
                    const getSankeyColor = (varName) => {
                        return getComputedStyle(document.body).getPropertyValue(varName).trim();
                    };
                    
                    const nodeColor = getSankeyColor('--sankey-node-color');
                    const linkColors = getSankeyColor('--sankey-link-colors').split(',').map(c => c.trim());
                    const labelColor = getSankeyColor('--sankey-label-color');
                    
                    console.log('🎨 Sankey colors:', { nodeColor, linkColors, labelColor });
                    
                    // Get container width and calculate chart dimensions with padding
                    const containerWidth = container.parentElement.offsetWidth || 800;
                    const containerHeight = container.parentElement.offsetHeight || 620;
                    const padding = 10; // 10px padding on all sides
                    const chartWidth = containerWidth - (padding * 2);  // 10px left + 10px right
                    const chartHeight = containerHeight - (padding * 2); // 10px top + 10px bottom
                    
                    // Options
                    
// Build deterministic node color list based on first-seen node order in our rows.
// Targets are encoded as "<group>|<mainLocation>" so we can color by group.
const GROUP_PALETTE = [
    getSankeyColor('--teal-primary') || '#11998e',
    getSankeyColor('--teal-secondary') || '#38ef7d',
    getSankeyColor('--accent-color') || '#ff6b6b',
    '#5b8def','#f4b400','#ab47bc','#00acc1','#ef6c00'
];
const groupColor = {};
const getGroupColor = (g) => {
    const key = String(g || 'Unassigned').trim() || 'Unassigned';
    if (groupColor[key]) return groupColor[key];
    const idx = Object.keys(groupColor).length % GROUP_PALETTE.length;
    groupColor[key] = GROUP_PALETTE[idx];
    return groupColor[key];
};

// Simulate Google Sankey node creation order (first-seen while iterating rows).
const nodeOrder = [];
const seen = new Set();
for (let r = 0; r < rows.length; r++) {
    const a = rows[r][0], b = rows[r][1];
    if (!seen.has(a)) { seen.add(a); nodeOrder.push(a); }
    if (!seen.has(b)) { seen.add(b); nodeOrder.push(b); }
}
const nodeColors = nodeOrder.map(n => {
    const name = String(n || '');
    // Targets (main locations) are colored by their group; sources use the default node color.
    const g = (flowData && flowData.groupByMain && flowData.groupByMain[name]) ? flowData.groupByMain[name] : null;
    if (g) return getGroupColor(g);
    return nodeColor || '#11998e';
});

                    const options = {
                        width: chartWidth,
                        height: Math.max(chartHeight, 650), // Min height closer to horizontal bar chart
                        sankey: {
                            node: {
                                colors: nodeColors,
                                label: {
                                    fontName: 'Arial',
                                    fontSize: 14,
                                    color: labelColor
                                },
                                nodePadding: 5,
                                width: 8  // Increased from 6 to 8 for thicker nodes
                            },
                            link: {
                                colorMode: 'target'
                            },
                            iterations: 32  // More iterations for better layout
                        },
                        tooltip: {
                            isHtml: true,
                            textStyle: {
                                fontSize: 14,
                                fontName: 'Arial',
                                color: labelColor
                            }
                        }
                    };
                    
                    console.log('✅ Options configured:', chartWidth, 'x', chartHeight, '(container:', containerWidth, 'x', containerHeight, '- padding:', padding * 2, 'px)');
                    console.log('Options object:', options);
                    
                    // Create and draw chart
                    console.log('🔄 Creating Sankey chart object...');
                    const chart = new google.visualization.Sankey(container2);
                    console.log('✅ Chart object created');
                    
                    console.log('🔄 Drawing chart...');
                    chart.draw(dataTable, options);

// Strip the encoded "group|" prefix from displayed labels, while preserving internal node IDs.
try {
    const texts = container.querySelectorAll('text');
    texts.forEach(t => {
        const s = t.textContent || '';
        const parts = s.split('|');
        if (parts.length >= 2) t.textContent = parts.slice(1).join('|');
    });
} catch (e) {}
                    console.log('🎉 CHART DRAWN SUCCESSFULLY!');
                    
                    // Debug: Check what was actually created
                    setTimeout(() => {
                        console.log('🔍 Container contents after draw:');
                        console.log('innerHTML length:', container.innerHTML.length);
                        console.log('Children:', container.children.length);
                        if (container.children.length > 0) {
                            console.log('First child:', container.children[0].tagName);
                            console.log('First child innerHTML length:', container.children[0].innerHTML.length);
                        }
                        const svg = container.querySelector('svg');
                        if (svg) {
                            console.log('✅ SVG found!', svg.getAttribute('width'), 'x', svg.getAttribute('height'));
                        } else {
                            console.log('❌ No SVG element found in container');
                        }
                    }, 500);
                    
                } catch (error) {
                    console.error('❌ ERROR in drawChart:', error);
                    console.error('Stack:', error.stack);
                }
            }
        }
        
        // ==================================================================================
        // VERTICAL BAR CHART (TIME SERIES WITH USAGE/RESTOCK/WASTE)
        // ==================================================================================
        
        // Helper function to draw rounded rectangles
        function roundRect(ctx, x, y, width, height, radius) {
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            ctx.lineTo(x + radius, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
        }
        
        function drawVerticalBarChart() {
            // On back-navigation or early chart switching, the vertical bar chart can be
            // requested before mock data (especially raw transactions) has arrived.
            // If we draw immediately, the chart will appear empty.
            try {
                const hasComputed = !!(costChartState && costChartState.cachedMockData && costChartState.cachedMockData.items && costChartState.cachedMockData.items.length);
                const _t = (costChartState && costChartState.cachedMockData) ? costChartState.cachedMockData.transactions : null;
                let hasTx = !!(_t && (Array.isArray(_t) ? _t.length > 0 : (typeof _t === 'object' ? Object.keys(_t).length > 0 : false)));

                // Fallback: if raw transactions weren't cached/attached (common on state-preserved navigation),
                // rebuild the merged monthly transactions locally from globals so vertical bars can still render.
                // This avoids relying solely on postMessage timing.
                if (!hasTx) {
                    try {
                        const canMerge = (typeof mergeMonthlyTransactions === 'function');
                        if (canMerge) {
                            const merged = mergeMonthlyTransactions();
                            if (merged && typeof merged === 'object' && Object.keys(merged).length) {
                                if (costChartState && costChartState.cachedMockData) {
                                    costChartState.cachedMockData.transactions = merged;
                                }
                                if (typeof cachedMockData === 'object' && cachedMockData) {
                                    cachedMockData.transactions = merged;
                                }
                                // Invalidate Option B aggregates and re-check.
                                if (costChartState) costChartState.__txDailyAggBuilt = false;
                                const _t2 = (costChartState && costChartState.cachedMockData) ? costChartState.cachedMockData.transactions : null;
                                hasTx = !!(_t2 && (Array.isArray(_t2) ? _t2.length > 0 : (typeof _t2 === 'object' ? Object.keys(_t2).length > 0 : false)));
                                try {
                                    console.log('✅ Charts: Rebuilt transactions locally for vertical bar chart.', {
                                        items: (costChartState && costChartState.cachedMockData && costChartState.cachedMockData.items) ? costChartState.cachedMockData.items.length : 0,
                                        txKeys: (merged && typeof merged === 'object') ? Object.keys(merged).length : 0
                                    });
                                } catch (e) {}
                            }
                        }
                    } catch (e) {}
                }

                if (!hasComputed || !hasTx) {
                    try { console.log('🔄 Charts: Vertical bar chart missing data; requesting from parent...', {hasComputed, hasTx}); } catch(e) {}

                    const canvas = costChartState && costChartState.canvas;
                    const ctx = costChartState && costChartState.ctx;
                    if (canvas && ctx) {
                        const container = canvas.parentElement;
                        const w = container ? container.clientWidth : 600;
                        const h = Math.max(container ? container.clientHeight : 420, 420);
                        const dpr = window.devicePixelRatio || 1;
                        canvas.width = Math.max(1, w) * dpr;
                        canvas.height = Math.max(1, h) * dpr;
                        canvas.style.width = w + 'px';
                        canvas.style.height = h + 'px';
                        ctx.setTransform(1,0,0,1,0,0);
                        ctx.scale(dpr, dpr);
                        const isDarkMode = document.body.classList.contains('dark-mode');
                        ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
                        ctx.fillRect(0,0,w,h);
                        ctx.fillStyle = (getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#666');
                        ctx.font = '16px system-ui';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('Loading chart data…', w/2, h/2);
                    }

                    // Kick a data request once; when it resolves, re-render.
                    if (!costChartState.__vbWaitingForData) {
                        costChartState.__vbWaitingForData = true;
                        try {
                            requestMockDataFromParent()
                                .then(() => {
                                    costChartState.__vbWaitingForData = false;
                                    // Invalidate aggregates so they rebuild with the new payload
                                    costChartState.__txDailyAggBuilt = false;
                                    scheduleChartsRedraw('mockData');
                                })
                                .catch(() => { costChartState.__vbWaitingForData = false; });
                        } catch (e) { costChartState.__vbWaitingForData = false; }
                    }
                    return;
                }
            } catch (e) {}

            
            // Ensure the parent has loaded monthly transaction scripts for the selected date range.
            // IMPORTANT: Do NOT clear/replace the chart while ensuring; otherwise hovers/toggle changes
            // can make the chart appear to "disappear" momentarily.
            // Instead, fire ensureTxRange in the background and redraw once it completes.
            try {
                const r = getSelectedDateRangeISO && getSelectedDateRangeISO();
                const rangeKey = (r && r.from && r.to) ? (r.from + '|' + r.to) : '';

                // If a direct navigation is in-flight, it will ensure the range itself.
                // Avoid duplicating ensureTxRange calls here.
                const alreadyEnsured = !!(rangeKey && costChartState.__vbEnsuredRangeKey === rangeKey);
                if (r && r.from && r.to && rangeKey && !alreadyEnsured && !costChartState.__vbEnsuringRange && !costChartState.__directNavInProgress) {
                    costChartState.__vbEnsuringRange = true;
                    costChartState.__vbEnsuringRangeKey = rangeKey;

                    ensureTxRangeFromParent(r.from, r.to)
                        .then(() => requestMockDataFromParent())
                        .then(() => {
                            costChartState.__vbEnsuringRange = false;
                            costChartState.__vbEnsuredRangeKey = rangeKey;
                            costChartState.__txDailyAggBuilt = false;
                            scheduleChartsRedraw('txRange');
                        })
                        .catch(() => {
                            costChartState.__vbEnsuringRange = false;
                            costChartState.__vbEnsuringRangeKey = '';
                        });
                }
            } catch (e) {}

            // Keep transaction-derived weekly series aligned to the selected date range
            try { ensureTransactionRatesForSelectedRange(); } catch (e) { console.warn('⚠️ Failed to recompute range rates', e); }

            // ------------------------------------------------------------------------------
            // Diagnostics (always-on): vertical bar chart data wiring
            // ------------------------------------------------------------------------------
            try {
                const txRoot = (costChartState && costChartState.cachedMockData) ? costChartState.cachedMockData.transactions : null;
                const txType = Array.isArray(txRoot) ? 'array' : (txRoot && typeof txRoot === 'object' ? 'object' : String(typeof txRoot));
                const txCount = Array.isArray(txRoot) ? txRoot.length : (txRoot && typeof txRoot === 'object' ? Object.keys(txRoot).length : 0);
                const itemsCount = (costChartState && Array.isArray(costChartState.items)) ? costChartState.items.length : 0;
                console.log('🧩 VBar diagnostics (pre-binning):', { itemsCount, txType, txCount, range: getSelectedDateRangeISO() || { from: '', to: '' }, view: costChartState.verticalBarView || 'all', drill: costChartState.verticalDrillLevel ?? 0 });
            } catch (e) {}

            // Day/Week density handling:
            // - We stay in the same chart type/workflow.
            // - When a bar chart would exceed 45 bars, we render it as a shaded line with spike markers.
            //   (This keeps interactivity + avoids unreadable/thin bars.)

            chartsDebugLog('📊 Drawing enhanced vertical bar chart, view:', costChartState.verticalBarView);
            chartsDebugLog('📋 Drill-down stack:', costChartState.drillDownStack);

            // Keep the header breadcrumb in-sync with the vertical drill state.
            // (This enables Month→Week→Day drill-up directly from the breadcrumb while staying in bar-chart view.)
            try { updateBreadcrumb(costChartState.lastTotalCost ?? 0); } catch (e) {}

            // Sync the visible drill label (Month/Week/Day) so breadcrumb/drill-up always reflects the current level
            try {
                const drillTextEl = document.querySelector('#verticalDrillContainer .chart-drill-text');
                if (drillTextEl) {
                    drillTextEl.textContent = (costChartState.verticalDrillLevel === 0) ? 'Month'
                        : (costChartState.verticalDrillLevel === 1) ? 'Week'
                        : 'Day';
                }
            } catch (e) {}

            // Normalized view selector used throughout this renderer
            const view = costChartState.verticalBarView || 'all';

            // Canvas/context and sizing (used both for rendering and for empty-state messaging)
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            if (!canvas || !ctx) return;

            // Reset hit-test positions each draw
            costChartState.verticalBarPositions = [];


            // Get CSS helper
            const getCSSVar = (varName) => {
                return getComputedStyle(document.body).getPropertyValue(varName).trim();
            };

            // Get container dimensions
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth;
            const displayHeight = Math.max(container.clientHeight, 500);
	            // Ensure canvas is correctly sized for this chart (prevents blank renders)
	            const dpr = window.devicePixelRatio || 1;
	            canvas.width = Math.max(1, displayWidth) * dpr;
	            canvas.height = Math.max(1, displayHeight) * dpr;
	            canvas.style.width = displayWidth + 'px';
	            canvas.style.height = displayHeight + 'px';
	            ctx.setTransform(1, 0, 0, 1, 0, 0);
	            ctx.scale(dpr, dpr);
	            // Fill background to match theme
	            const isDarkMode = document.body.classList.contains('dark-mode');
	            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
	            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            // Get current filtered items
            let currentItems = costChartState.items;
            chartsDebugLog('📦 Total items before filtering:', currentItems.length);
            
            // Apply drill-down filters
            costChartState.drillDownStack.forEach(level => {
                chartsDebugLog('🔍 Applying filter - mode:', level.mode, 'key:', level.key);
                if (level.mode === 'itemClass') {
                    currentItems = currentItems.filter(item => 
                        (item.itemClass || 'Unknown') === level.key
                    );
                } else if (level.mode === 'drugName') {
                    currentItems = currentItems.filter(item => 
                        (item.drugName || 'Unknown') === level.key
                    );
                } else if (level.mode === 'description') {
                    currentItems = currentItems.filter(item => 
                        (item.description || 'Unknown') === level.key
                    );
                }
                chartsDebugLog('✓ Items after filter:', currentItems.length);
            });
            
            chartsDebugLog('📊 Final filtered items:', currentItems.length);
            if (currentItems.length > 0) {
                chartsDebugLog('📝 Sample item:', currentItems[0].description);
                chartsDebugLog('📝 Sample item has usageRate?', !!currentItems[0].usageRate);
                chartsDebugLog('📝 Sample item has restockRate?', !!currentItems[0].restockRate);
            }
            
	            // IMPORTANT:
	            // Vertical bar chart is now range-aware and driven by raw transaction aggregates (Option B).
	            // Do NOT gate rendering on legacy per-item usageRate arrays, as those may be absent
	            // or stale depending on how the computed payload was built.
            
                        // Aggregate data across all filtered items using RAW transaction history (date-range aware).
            // NOTE: item.usageRate/restockRate/wasteRate arrays are legacy snapshots and do NOT respond to date range.
            // Date-range selection is stored/returned as {from,to}. Older code attempted to
            // destructure {fromISO,toISO}, which silently breaks filtering and can cause
            // misleading “everything piles into one date/week” behavior.
            const __range = getSelectedDateRangeISO(); // null or {from,to}
            const fromISO = __range && __range.from ? __range.from : null;
            const toISO = __range && __range.to ? __range.to : null;
            const fromDate = fromISO ? new Date(fromISO + 'T00:00:00') : null;
            const toDate = toISO ? new Date(toISO + 'T00:00:00') : null;

            const parseISODate = (iso) => {
                if (!iso) return null;
                const d = new Date(String(iso).slice(0,10) + 'T00:00:00');
                return isNaN(d.getTime()) ? null : d;
            };

            const inRange = (d) => {
                if (!d) return false;
                if (fromDate && d < fromDate) return false;
                if (toDate && d > toDate) return false;
                return true;
            };

            const endOfWeek = (d) => {
                // Week ending Saturday (consistent grouping)
                const out = new Date(d.getTime());
                const dow = out.getDay(); // 0=Sun ... 6=Sat
                const add = (6 - dow + 7) % 7;
                out.setDate(out.getDate() + add);
                out.setHours(0,0,0,0);
                return out;
            };

            const fmtMMDD = (d) => {
                const mm = String(d.getMonth()+1).padStart(2,'0');
                const dd = String(d.getDate()).padStart(2,'0');
                return `${mm}/${dd}`;
            };

            const classifyTxn = (tTypeRaw, qtyRaw) => {
                const t = String(tTypeRaw || '').toLowerCase();
                const q = Number(qtyRaw || 0);
                if (t.includes('waste') || t.includes('expire') || t.includes('expired') || t.includes('discard')) return 'waste';
                if (t.includes('restock') || t.includes('receive') || t.includes('receipt') || t.includes('return')) return 'restock';
                if (t.includes('dispense') || t.includes('issue') || t.includes('use') || t.includes('usage')) return 'usage';
                // Fallback by sign
                return q >= 0 ? 'restock' : 'usage';
            };

            const txnRoot = (costChartState.cachedMockData && costChartState.cachedMockData.transactions) ? costChartState.cachedMockData.transactions : null;
            if (!txnRoot || typeof txnRoot !== 'object') {
                console.warn('⚠️ No raw transactions available on charts page. Vertical bars will be empty.');
            }

            const weekly = new Map(); // weekEndISO -> {d:Date, usage, restock, waste}

            // IMPORTANT: transaction maps are keyed by whatever identifier the monthly mockdata files use.
            // Across datasets we've seen keys be itemCode, itemId, ndc, etc. Build a robust list of
            // candidate keys per item so we don't accidentally drop months (e.g., Jan) due to key mismatch.
            const itemCodesSet = new Set();
            for (let i = 0; i < currentItems.length; i++) {
                const it = currentItems[i] || {};
                const candidates = [
                    it.itemCode,
                    it.alt_itemCode,
                    it.altItemCode,
                    it.itemId,
                    it.itemNum,
                    it.id,
                    it.ndc,
                    it.NDC,
                    it.code,
                    it.inventoryItemCode,
                    it.inventoryId
                ];
                for (let j = 0; j < candidates.length; j++) {
                    const v = candidates[j];
                    if (v === null || v === undefined) continue;
                    const s = String(v).trim();
                    if (!s) continue;

                    // Add robust key variants so item metadata can join against transaction buckets.
                    // We see keys arrive as numeric codes, left-padded codes, and NDC-like strings with dashes.
                    itemCodesSet.add(s);

                    const noLead = s.replace(/^0+/, '') || s;
                    if (noLead !== s) itemCodesSet.add(noLead);

                    const noDash = s.replace(/[\s-]/g, '');
                    if (noDash && noDash !== s) itemCodesSet.add(noDash);

                    const noDashNoLead = noDash ? (noDash.replace(/^0+/, '') || noDash) : '';
                    if (noDashNoLead && noDashNoLead !== noDash) itemCodesSet.add(noDashNoLead);

                    if (/^\d+$/.test(noDash || s)) {
                        const n = String(parseInt(noDash || s, 10));
                        if (n) itemCodesSet.add(n);
                    }
                }
            }
            const itemCodes = Array.from(itemCodesSet);

            // Always-on diagnostics: ensure we have item identifiers to join against tx aggregates.
            try {
                console.log('🧩 VBar diagnostics (item codes):', {
                    filteredItems: currentItems ? currentItems.length : 0,
                    itemCodes: itemCodes.length,
                    sampleItemCodes: itemCodes.slice(0, 5)
                });
            } catch (e) {}


            // Optional per-view location/sublocation filters (only applied in vertical bar chart)
            const __vbLocFilter = String((costChartState && costChartState.itemLocFilter) ? costChartState.itemLocFilter : 'ALL');
            const __vbLocOn = (__vbLocFilter && __vbLocFilter !== 'ALL');
            // Location filters are already expressed as mainLocation values (e.g., ED, OR, 2E).
            // IMPORTANT: Do NOT pass through canonicalizeLocationCode() here.
            // That function is meant for sublocation normalization and can unexpectedly transform
            // already-canonical mainLocation values, causing the filter to appear to "do nothing".
            // Use strict uppercase+trim for mainLocation comparisons.
            const __vbLocCanon = __vbLocOn ? String(__vbLocFilter).trim().toUpperCase() : '';

            const __vbSublocFilter = String((costChartState && costChartState.itemSublocFilter) ? costChartState.itemSublocFilter : 'ALL');
            const __vbSublocOn = (__vbSublocFilter && __vbSublocFilter !== 'ALL');
            const __vbSublocCanon = __vbSublocOn ? _canonSublocExact(__vbSublocFilter) : '';

            // UX + correctness rule: when Location is ALL, Sublocation must behave as ALL.
            // This prevents confusing states where a stale sublocation selection silently applies
            // (or appears to do nothing) while the parent location is not scoped.
            const __vbSublocFilterEff = (__vbLocOn ? __vbSublocFilter : 'ALL');
            const __vbSublocOnEff = (__vbLocOn ? __vbSublocOn : false);
            const __vbSublocCanonEff = (__vbLocOn ? __vbSublocCanon : '');

            // Diagnostics: confirm toggle values are being read by the renderer
            try {
                console.log('🧩 VBar diagnostics (filters):', {
                    loc: __vbLocFilter,
                    locOn: __vbLocOn,
                    locCanon: __vbLocCanon,
                    subloc: __vbSublocFilterEff,
                    sublocOn: __vbSublocOnEff,
                    sublocCanon: __vbSublocCanonEff,
                    branch: (!__vbSublocOnEff && !__vbLocOn) ? 'FAST_DAILY_AGG' : 'RAW_HISTORY_FILTERED'
                });
            } catch (e) {}

            // Robust bucket lookup: transaction maps may be keyed by different variants of the same code
            // (e.g., padded vs unpadded, dashed vs no-dash). If we fail to find a bucket, later fallback
            // logic can repopulate weekly totals without respecting filters. Make this lookup strong so
            // the filtered path finds the right histories and doesn't trigger the unfiltered fallback.
            const _getTxnBucketForCode = (root, codeStr) => {
                if (!root || !codeStr) return null;
                const s = String(codeStr).trim();
                if (!s) return null;
                const noLead = s.replace(/^0+/, '') || s;
                const noDash = s.replace(/[\s-]/g, '');
                const noDashNoLead = (noDash || '').replace(/^0+/, '') || noDash;
                return root[s]
                    || root[noLead]
                    || (noDash ? root[noDash] : null)
                    || (noDashNoLead ? root[noDashNoLead] : null)
                    || null;
            };

            
            // --- Option B: Use pre-aggregated per-day values (fast) ---
            try { ensureTxDailyAggCache(); } catch (e) {}

            const inRangeISO = (iso) => {
                if (!iso || iso.length < 10) return false;
                if (fromISO && iso < fromISO) return false;
                if (toISO && iso > toISO) return false;
                return true;
            };

            const byCode = (costChartState.__txDailyAggByCode || Object.create(null));
            const weekEndMemo = (costChartState.__weekEndByISO || Object.create(null));

            try {
                const byKeys = (byCode && typeof byCode === 'object') ? Object.keys(byCode).length : 0;
                console.log('🧩 VBar diagnostics (tx aggregates):', { byCodeKeys: byKeys });
            } catch (e) {}
            if (!__vbSublocOnEff && !__vbLocOn) {
            for (let ii = 0; ii < itemCodes.length; ii++) {
                const code = String(itemCodes[ii] || '').trim();
                if (!code) continue;
            
                const entries = byCode[code];
                if (!entries || !entries.length) continue;
            
                for (let j = 0; j < entries.length; j++) {
                    const e = entries[j];
                    const iso = e.iso;
                    if (!inRangeISO(iso)) continue;
            
                    const wKey = weekEndMemo[iso] || (weekEndMemo[iso] = toISODate(endOfWeek(new Date(iso + 'T00:00:00'))));
                    if (!weekly.has(wKey)) weekly.set(wKey, { d: new Date(wKey + 'T00:00:00'), usage: 0, restock: 0, waste: 0 });
                    const agg = weekly.get(wKey);
            
                    if (e.u) agg.usage += e.u;
                    if (e.r) agg.restock += e.r;
                    if (e.w) agg.waste += e.w;
                }
            }
            } else {
                                // When a location/sublocation filter is active, do a scoped raw-history scan.
                // This is deterministic (no dependency on optional sublocation aggregates) and keeps
                // Week/Month/Day drill views consistent with the toggle selections.
                for (let ii = 0; ii < itemCodes.length; ii++) {
                    const code = String(itemCodes[ii] || "").trim();
                    if (!code) continue;

                    const bucket = _getTxnBucketForCode(txnRoot, code);
                    const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
                    if (!Array.isArray(hist) || !hist.length) continue;

                    for (let j = 0; j < hist.length; j++) {
                        const row = hist[j] || {};
                        const d = parseISODate(row.transDate || row.date || row.transactionDate);
                        if (!inRange(d)) continue;

                        // Apply loc/subloc filters (DESTINATION ONLY for vertical bar chart)
                        // - itemLocFilter = mainLocation (e.g., 1W)
                        // - itemSublocFilter = destination unit token (e.g., 1WA)
                        // Transaction `sublocation` is SOURCE (cabinet/device) and should not be used here.
                        const destRaw0 = (row.sendToLocation || row.toLocation || row.destinationLocation || row.destLocation || '');
                        const destRaw = String(destRaw0 || '').trim();
                        // If a destination-based filter is active but this row has no destination token,
                        // it cannot contribute to the destination chart slice.
                        if ((__vbLocOn || __vbSublocOnEff) && !destRaw) continue;

                        const destCanonExact = _canonSublocExact(destRaw);
                        if (!destCanonExact) continue;

                        if (__vbLocOn) {
                            // Prefer authoritative SUBLOCATION_MAP mainLocation; fallback to heuristic loc key.
                            // Resolve mainLocation strictly from SUBLOCATION_MAP when possible.
                            // IMPORTANT: avoid canonicalizeLocationCode() here; it can over-collapse tokens
                            // and make location filters appear to have no effect.
                            const ml = (_mainLocFromSublocToken(destRaw) || _mainLocFromSublocToken(destCanonExact) || "");
                            const lk0 = ml ? String(ml).trim().toUpperCase() : _locKeyFromCanon(destCanonExact);
                            const tokenU = String(destCanonExact || "").trim().toUpperCase();
                            // Match rules:
                            // 1) resolved mainLocation (lk0) equals selected location
                            // 2) destination token itself equals selected location (some feeds send mainLocation directly)
                            // 3) destination token starts with selected location (e.g., OR1, OR-2, ED-A)
                            let _match = false;
                            if (lk0 && lk0 === __vbLocCanon) _match = true;
                            else if (tokenU && tokenU === __vbLocCanon) _match = true;
                            else if (tokenU && __vbLocCanon && tokenU.startsWith(__vbLocCanon)) _match = true;
                            if (!_match) continue;
                        }
                        if (__vbSublocOnEff) {
                            if (destCanonExact !== __vbSublocCanonEff) continue;
                        }

                        const qty = Number(row.transQty ?? row.TransQty ?? row.qty ?? row.quantity ?? 0);
                        const kind = classifyTxn(row.transactionType || row.type || row.transType, qty);
                        const mag = Math.abs(qty || 0);
                        if (!mag) continue;

                        const wKey = toISODate(endOfWeek(d));
                        if (!weekly.has(wKey)) weekly.set(wKey, { d: new Date(wKey + "T00:00:00"), usage: 0, restock: 0, waste: 0 });
                        const agg = weekly.get(wKey);
                        if (kind === "usage") agg.usage += mag;
                        else if (kind === "restock") agg.restock += mag;
                        else agg.waste += mag;
                    }
                }
            }

            // Fallback path:
            // If we built week keys but all totals are zero (most commonly due to an identifier mismatch
            // between item metadata and the transaction aggregation keys), rescan the raw per-code
            // histories just for the currently filtered items.
            // This is slower, but it guarantees that the vertical bar chart is never "stuck" at maxValue=1.
            try {
                let _sum = 0;
                for (const v of weekly.values()) _sum += (Number(v.usage)||0) + (Number(v.restock)||0) + (Number(v.waste)||0);
                if (_sum === 0 && txnRoot && typeof txnRoot === 'object' && itemCodes && itemCodes.length) {
                    for (let ii = 0; ii < itemCodes.length; ii++) {
                        const code = itemCodes[ii];
                        const bucket = _getTxnBucketForCode(txnRoot, code);
                        const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
                        if (!Array.isArray(hist) || !hist.length) continue;

                        for (let j = 0; j < hist.length; j++) {
                            const row = hist[j] || {};
                            const d = parseISODate(row.transDate || row.date || row.transactionDate);
                            if (!inRange(d)) continue;

                            // Respect active location/sublocation filters in the fallback path too.
                            // Otherwise the chart appears to ignore toggle selections.
                            if (__vbLocOn || __vbSublocOnEff) {
                                // Destination-only filtering for vertical bar chart
                                const destRaw0 = (row.sendToLocation || row.toLocation || row.destinationLocation || row.destLocation || '');
                                const destRaw = String(destRaw0 || '').trim();
                                if (!destRaw) continue;
                                const destCanonExact = _canonSublocExact(destRaw);
                                if (!destCanonExact) continue;

                                if (__vbLocOn) {
                                    const ml = (_mainLocFromSublocToken(destRaw) || _mainLocFromSublocToken(destCanonExact) || '');
                                    const lk0 = ml ? String(ml).trim().toUpperCase() : _locKeyFromCanon(destCanonExact);
                                    const tokenU = String(destCanonExact || '').trim().toUpperCase();
                                    let _match = false;
                                    if (lk0 && lk0 === __vbLocCanon) _match = true;
                                    else if (tokenU && tokenU === __vbLocCanon) _match = true;
                                    else if (tokenU && __vbLocCanon && tokenU.startsWith(__vbLocCanon)) _match = true;
                                    if (!_match) continue;
                                }
                                if (__vbSublocOnEff) {
                                    if (destCanonExact !== __vbSublocCanonEff) continue;
                                }
                            }
                            const qty = Number(row.transQty ?? row.TransQty ?? row.qty ?? row.quantity ?? 0);
                            const kind = classifyTxn(row.transactionType || row.type || row.transType, qty);
                            const mag = Math.abs(qty || 0);
                            if (!mag) continue;

                            const wKey = toISODate(endOfWeek(d));
                            if (!weekly.has(wKey)) weekly.set(wKey, { d: new Date(wKey + 'T00:00:00'), usage: 0, restock: 0, waste: 0 });
                            const agg = weekly.get(wKey);
                            if (kind === 'usage') agg.usage += mag;
                            else if (kind === 'restock') agg.restock += mag;
                            else agg.waste += mag;
                        }
                    }
                }
            } catch (e) {}

const weekKeys = Array.from(weekly.keys()).sort();
            let weekCount = weekKeys.length;
            if (!weekCount) {
                // Diagnostics: help catch key mismatches (item codes vs transaction buckets) and empty tx payloads.
                try {
                    const txRoot = (costChartState && costChartState.cachedMockData) ? costChartState.cachedMockData.transactions : null;
                    const txType = Array.isArray(txRoot) ? 'array' : (txRoot && typeof txRoot === 'object' ? 'object' : String(typeof txRoot));
                    const txCount = Array.isArray(txRoot) ? txRoot.length : (txRoot && typeof txRoot === 'object' ? Object.keys(txRoot).length : 0);
                    const byKeys = (byCode && typeof byCode === 'object') ? Object.keys(byCode).length : 0;
                    console.warn('⚠️ Vertical bar chart: no weekly bins built', {
                        view,
                        drillLevel,
                        fromISO,
                        toISO,
                        currentItems: currentItems ? currentItems.length : 0,
                        itemCodes: itemCodes ? itemCodes.length : 0,
                        txType,
                        txCount,
                        byCodeKeys: byKeys,
                        sampleItemCodes: (itemCodes || []).slice(0, 5)
                    });
                } catch (e) {}
                // No transactions in range for the current filter set.
                // Render a clear empty-state message and bail early (prevents confusing blank canvas).
                ctx.clearRect(0, 0, displayWidth, displayHeight);
                ctx.fillStyle = getCSSVar('--text-secondary') || '#666';
                ctx.font = '16px system-ui';
                ctx.textAlign = 'center';
                const rangeMsg = (fromISO || toISO) ? `No transactions found in selected range` : 'No transactions available';
                ctx.fillText(rangeMsg, displayWidth / 2, displayHeight / 2);
                return;
            }

            const aggregatedData = {
                usage: new Array(weekCount).fill(0),
                restock: new Array(weekCount).fill(0),
                waste: new Array(weekCount).fill(0),
                // Used for projected expiry-spike tooltips + drill-through (historical bins remain 0)
                projectedWasteCost: new Array(weekCount).fill(0)
            };

            for (let i = 0; i < weekKeys.length; i++) {
                const k = weekKeys[i];
                const obj = weekly.get(k);
                aggregatedData.usage[i] = obj.usage;
                aggregatedData.restock[i] = obj.restock;
                aggregatedData.waste[i] = obj.waste;
            }

            // Use the actual week-ending dates derived from raw transactions.
            // The prior implementation rebuilt week labels by counting backwards from an anchor date,
            // which broke month drill-down (JAN/DEC) and made date-range selection inconsistent.
            let weekEndDates = weekKeys.map(k => (weekly.get(k) && weekly.get(k).d) ? weekly.get(k).d : new Date(k + 'T00:00:00'));
            let weekLabels = weekEndDates.map(d => formatDate(d));

            
// Projection overlay boundary + future bins (outlook)
// We define the boundary as the first bin AFTER the last REAL transaction week.
// If an outlook range is selected, we generate projected bins past the last real date.
const outlookDays = Number.isFinite(costChartState.outlookDays) ? costChartState.outlookDays : parseInt(localStorage.getItem('chartsOutlookDays') || '0', 10) || 0;

// Last real week end (based on weeks that actually have transactions)
let lastRealWeekEnd = null;
for (let i = 0; i < weekEndDates.length; i++) {
    const d = weekEndDates[i];
    if (!lastRealWeekEnd || d > lastRealWeekEnd) lastRealWeekEnd = d;
}
const lastRealWeekEndISO = lastRealWeekEnd ? toISODate(lastRealWeekEnd) : null;
costChartState._lastRealWeekEndISO = lastRealWeekEndISO;

// Generate future bins when Outlook is enabled. In 'all' view, projection applies to Usage/Waste bars.
const shouldGenerateOutlook = (outlookDays > 0) && (view === 'usage' || view === 'waste' || view === 'all');

const originalWeekCount = weekEndDates.length;
costChartState.verticalBarOriginalWeekCount = originalWeekCount;

// --- Projection maps (hoisted) ---
// These are assigned when outlook generation runs, but declared here so downstream code can access safely.
let projectedWasteByWeek = null;
let projectedWasteByDate = null; // ISO date -> qty
let projectedWasteCostByWeek = null;
let projectedWasteCostByDate = null;
let projectedWasteContribByDate = null;
if (shouldGenerateOutlook && lastRealWeekEnd) {
    // Projection model:
    // - Usage: trailing-weeks mean (smooth baseline)
    // - Waste: expiry-based spikes (only on/near expiry when inventory remains)
    const tailWeeks = 4;

    const computeProjectedWeekly = (histArr) => {
        const hist = (Array.isArray(histArr) ? histArr : []).slice(0, originalWeekCount);
        const tail = hist.slice(Math.max(0, hist.length - tailWeeks));
        const tailSum = tail.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
        const avgDaily = (tail.length > 0) ? (tailSum / (tail.length * 7)) : 0;
        return Math.max(0, avgDaily * 7);
    };

    let projectedWeeklyUsage = computeProjectedWeekly(aggregatedData.usage);

    // Optional: apply cached trend spike multiplier to Outlook usage projection.
    // Granularity: itemCode + location when item context is active; otherwise fallback to 1.0.
    // This is intentionally conservative: if factors are missing, projection remains unchanged.
    
try {
    const sf = window.SpikeFactors || null;
    const itemCodeForSpike = String((costChartState && costChartState.itemSublocItemCode) ? costChartState.itemSublocItemCode : '').trim();
    const locFilterForSpike = String((costChartState && costChartState.itemLocFilter) ? costChartState.itemLocFilter : 'ALL').trim().toUpperCase();
    const sublocFilterForSpike = String((costChartState && costChartState.itemSublocFilter) ? costChartState.itemSublocFilter : 'ALL').trim().toUpperCase();

    let mult = 1.0;
    if (sf && itemCodeForSpike && typeof sf.getSpikeMultiplierForScope === 'function') {
        mult = Number(sf.getSpikeMultiplierForScope(itemCodeForSpike, locFilterForSpike, sublocFilterForSpike)) || 1.0;
    } else if (sf && itemCodeForSpike) {
        // Back-compat fallbacks
        if (locFilterForSpike && locFilterForSpike !== 'ALL' && typeof sf.getSpikeMultiplierForItemLocation === 'function') {
            mult = Number(sf.getSpikeMultiplierForItemLocation(itemCodeForSpike, locFilterForSpike)) || 1.0;
        } else if (typeof sf.getSpikeMultiplierForItem === 'function') {
            mult = Number(sf.getSpikeMultiplierForItem(itemCodeForSpike)) || 1.0;
        }
    }

    if (!(mult > 0)) mult = 1.0;

    projectedWeeklyUsage = projectedWeeklyUsage * mult;

    costChartState._projUsageSpikeMultiplier = mult;
    costChartState._projUsageSpikeKey = (locFilterForSpike && locFilterForSpike !== 'ALL')
        ? (sublocFilterForSpike && sublocFilterForSpike !== 'ALL')
            ? (`itemLocSubloc|${itemCodeForSpike}|${locFilterForSpike}|${sublocFilterForSpike}`)
            : (`itemLoc|${itemCodeForSpike}|${locFilterForSpike}`)
        : (`item|${itemCodeForSpike}`);
} catch (e) {
    // ignore
}

    // Persist for downstream drill levels (e.g., Day view within a projected week)
    costChartState._projectedWeeklyUsage = projectedWeeklyUsage;

    // --- Expiry-based projected waste ---
    // Builds a map weekEndISO -> projectedWasteQty, where waste occurs only at the expiry date
    // (and only if projected usage does NOT consume all on-hand inventory before expiry).
    const invRoot = (costChartState.cachedMockData && costChartState.cachedMockData.inventory) ? costChartState.cachedMockData.inventory : null;

    const startDate = new Date(lastRealWeekEnd.getTime());
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0,0,0,0);

    const endDate = new Date(lastRealWeekEnd.getTime());
    // Outlook selector is labeled in months; for longer horizons (especially 9 months),
    // using fixed 30-day blocks can undercount expirations near month-ends.
    // Treat 90/180/270 as 3/6/9 calendar months; otherwise fall back to days.
    const _od = Math.max(0, outlookDays || 0);
    const _months = (_od === 90) ? 3 : (_od === 180) ? 6 : (_od === 270) ? 9 : 0;
    if (_months) endDate.setMonth(endDate.getMonth() + _months);
    else endDate.setDate(endDate.getDate() + _od);
    endDate.setHours(0,0,0,0);

    const dayDiff = (a, b) => {
        const ms = (b.getTime() - a.getTime());
        return Math.floor(ms / (24 * 60 * 60 * 1000));
    };

    const clampISO = (iso) => (iso && typeof iso === 'string' && iso.length >= 10) ? iso.slice(0,10) : '';

    // Cache per-item avgDaily usage so we don't re-scan histories on every redraw
    if (!costChartState._projUsageRateCache) costChartState._projUsageRateCache = {};
    const cacheKeyPrefix = (lastRealWeekEndISO || '');

    const getAvgDailyUsageForItem = (itemCode) => {
        const key = `${cacheKeyPrefix}|${String(itemCode)}`;
        if (costChartState._projUsageRateCache[key] != null) return costChartState._projUsageRateCache[key];

        let sum = 0;
        try {
            const bucket = txnRoot && txnRoot[String(itemCode)];
            const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
            if (Array.isArray(hist) && hist.length) {
                const windowDays = 28;
                const windowStart = new Date(lastRealWeekEnd.getTime());
                windowStart.setDate(windowStart.getDate() - windowDays + 1);
                windowStart.setHours(0,0,0,0);

                for (let i = 0; i < hist.length; i++) {
                    const row = hist[i] || {};
                    const d = parseISODate(row.transDate || row.date || row.transactionDate);
                    if (!d || d < windowStart || d > lastRealWeekEnd) continue;
                    const qty = Number(row.transQty ?? row.TransQty ?? row.qty ?? row.quantity ?? 0);
                    const kind = classifyTxn(row.transactionType || row.type || row.transType, qty);
                    if (kind !== 'usage') continue;
                    sum += Math.abs(qty || 0);
                }
                const avg = Math.max(0, sum / windowDays);
                costChartState._projUsageRateCache[key] = avg;
                return avg;
            }
        } catch (e) {}
        costChartState._projUsageRateCache[key] = 0;
        return 0;
    };

    projectedWasteByWeek = new Map();
    projectedWasteByDate = new Map(); // expiry-day spikes (ISO date -> qty)
    projectedWasteCostByWeek = new Map(); // weekEndISO -> cost
    projectedWasteCostByDate = new Map(); // ISO date -> cost
    projectedWasteContribByDate = new Map(); // ISO date -> [contributors]
    const projectedWasteEvents = []; // for audit (bounded)

    // Unit cost resolver used for projection cost + drill-through
    const getUnitCostForItemCode = (code) => {
        try {
            const key = String(code);
            const map = costChartState._unitCostByItemCode;
            if (map && map.hasOwnProperty(key)) return Number(map[key]) || 0;
        } catch (e) {}
        // Build map lazily from currentItems
        try {
            if (!costChartState._unitCostByItemCode) {
                const m = {};
                for (let i = 0; i < currentItems.length; i++) {
                    const it = currentItems[i] || {};
                    const k = (it.itemCode != null) ? String(it.itemCode) : null;
                    if (!k) continue;
                    const unit = parseFloat(it.unitPrice || it.unitCost || it.costPerUnit || it.gpoPrice || it.wacPrice || 0) || 0;
                    m[k] = unit;
                }
                costChartState._unitCostByItemCode = m;
            }
            const unit = costChartState._unitCostByItemCode && costChartState._unitCostByItemCode[String(code)];
            return Number(unit) || 0;
        } catch (e) {}
        return 0;
    };

    if (invRoot && (view === 'waste' || view === 'all')) {
        // Build candidate item codes (robust, mirrors txn key logic)
        const candidatesSet = new Set();
        for (let i = 0; i < currentItems.length; i++) {
            const it = currentItems[i] || {};
            const cands = [
                it.itemCode, it.itemId, it.itemNum, it.id, it.ndc, it.NDC, it.code, it.inventoryItemCode, it.inventoryId
            ];
            for (let j = 0; j < cands.length; j++) {
                const v = cands[j];
                if (v === null || v === undefined) continue;
                const s = String(v).trim();
                if (s) candidatesSet.add(s);
            }
        }

        // PERF: Memoize expiry-based waste projection across redraws.
        // This loop is expensive on large inventories; it can run multiple times per UI interaction.
        // Cache key is tied to: horizon, last-real week, and the *active candidate item set*.
        const candidatesArr = Array.from(candidatesSet);
        candidatesArr.sort();
        const midIdx = candidatesArr.length ? Math.floor(candidatesArr.length / 2) : 0;
        const projWasteCacheKey = [
            'v1',
            String(lastRealWeekEndISO || ''),
            String(outlookDays || 0),
            String(view),
            String(candidatesArr.length),
            String(candidatesArr[0] || ''),
            String(candidatesArr[midIdx] || ''),
            String(candidatesArr[candidatesArr.length - 1] || '')
        ].join('|');

        if (!costChartState._projWasteCache) costChartState._projWasteCache = {};
        const cached = costChartState._projWasteCache[projWasteCacheKey];
        if (cached && cached.projectedWasteByWeek && cached.projectedWasteByDate) {
            projectedWasteByWeek = cached.projectedWasteByWeek;
            projectedWasteByDate = cached.projectedWasteByDate;
            projectedWasteCostByWeek = cached.projectedWasteCostByWeek;
            projectedWasteCostByDate = cached.projectedWasteCostByDate;
            projectedWasteContribByDate = cached.projectedWasteContribByDate;
        } else {
            candidatesArr.forEach(code => {
            const invByLoc = invRoot[code];
            if (!invByLoc || typeof invByLoc !== 'object') return;

            // Convert locations into "lots" with qty + expiry
            const lots = [];
            for (const loc of Object.keys(invByLoc)) {
                const rec = invByLoc[loc] || {};
                const qty = Number(rec.qty ?? rec.quantity ?? 0) || 0;
                const expISO = clampISO(rec.expires || rec.expiration || rec.expiry || '');
                if (!qty || !expISO) continue;
                const expD = parseISODate(expISO);
                if (!expD) continue;
                // Only project into the outlook window beyond the last real date
                if (expD < startDate || expD > endDate) continue;
                lots.push({ loc, qty, expD, expISO });
            }
            if (!lots.length) return;

            lots.sort((a,b) => a.expD - b.expD);

            const avgDaily = getAvgDailyUsageForItem(code);

            // FIFO-by-expiry consumption approximation (cumulative demand up to each expiry)
            let cumSupply = 0;
            for (let li = 0; li < lots.length; li++) {
                const lot = lots[li];
                cumSupply += lot.qty;

                const daysToExpiry = Math.max(0, dayDiff(startDate, lot.expD) + 1); // inclusive
                const demandUntilExpiry = avgDaily * daysToExpiry;

                const supplyBeforeCurrent = cumSupply - lot.qty;
                const demandAfterEarlier = Math.max(0, demandUntilExpiry - supplyBeforeCurrent);
                const consumedFromCurrent = Math.min(lot.qty, demandAfterEarlier);
                const leftover = Math.max(0, lot.qty - consumedFromCurrent);

                if (leftover > 0.00001) {
                    const wEnd = endOfWeek(lot.expD);
                    const wKey = toISODate(wEnd);
                    projectedWasteByWeek.set(wKey, (projectedWasteByWeek.get(wKey) || 0) + leftover);

                    // Also store expiry-day spike + contributor list (used by Day view + drill-through)
                    const dKey = lot.expISO;
                    projectedWasteByDate.set(dKey, (projectedWasteByDate.get(dKey) || 0) + leftover);
                    const unitCost = getUnitCostForItemCode(code);
                    const wasteCost = (Number(unitCost) || 0) * leftover;
                    projectedWasteCostByWeek.set(wKey, (projectedWasteCostByWeek.get(wKey) || 0) + wasteCost);
                    projectedWasteCostByDate.set(dKey, (projectedWasteCostByDate.get(dKey) || 0) + wasteCost);
                    if (!projectedWasteContribByDate.has(dKey)) projectedWasteContribByDate.set(dKey, []);
                    if (projectedWasteContribByDate.get(dKey).length < 250) {
                        projectedWasteContribByDate.get(dKey).push({
                            itemCode: code,
                            location: lot.loc,
                            expires: lot.expISO,
                            leftoverQty: leftover,
                            unitCost: Number(unitCost) || 0,
                            wasteCost: wasteCost
                        });
                    }

                    // Collect small audit sample (avoid huge memory)
                    if (projectedWasteEvents.length < 250) {
                        projectedWasteEvents.push({
                            itemCode: code,
                            location: lot.loc,
                            expires: lot.expISO,
                            leftoverQty: leftover,
                            avgDailyUsage: avgDaily
                        });
                    }
                }
            }
            });

            // Store memoized result (keep it small and re-usable for drill levels downstream).
            costChartState._projWasteCache[projWasteCacheKey] = {
                projectedWasteByWeek,
                projectedWasteByDate,
                projectedWasteCostByWeek,
                projectedWasteCostByDate,
                projectedWasteContribByDate
            };
        }
    }

    // Compute a fallback baseline waste if we have no expiry-based data at all
    const projectedWeeklyWasteFallback = computeProjectedWeekly(aggregatedData.waste);
    costChartState._projectedWeeklyWaste = projectedWeeklyWasteFallback;

    const futureWeeks = Math.max(1, Math.ceil(outlookDays / 7));
    try {
        // Keep this as a single line so it doesn't spam when verbose debug is off
        chartsDebugLog('🟦 Outlook enabled:', outlookDays, 'days =>', futureWeeks, 'future weeks');
    } catch (e) {}

    for (let w = 1; w <= futureWeeks; w++) {
        const d = new Date(lastRealWeekEnd);
        d.setDate(d.getDate() + (7 * w));
        d.setHours(0,0,0,0);
        weekEndDates.push(d);
        weekLabels.push(formatDate(d));

        // Usage projection for usage/all views
        
// Usage projection for usage/all views (multi-year seasonality + annual trend + uncertainty)
if (view === 'usage' || view === 'all') {
    let proj = projectedWeeklyUsage;

    try {
        const sf = window.SpikeFactors || null;
        const itemCode = String((costChartState && costChartState.itemSublocItemCode) ? costChartState.itemSublocItemCode : '').trim();
        const locF = String((costChartState && costChartState.itemLocFilter) ? costChartState.itemLocFilter : 'ALL').trim().toUpperCase();
        const subF = String((costChartState && costChartState.itemSublocFilter) ? costChartState.itemSublocFilter : 'ALL').trim().toUpperCase();

        // ISO week-of-year (1-53)
        const isoWeekOfYear = (dateObj) => {
            const dt = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
            const dayNum = (dt.getUTCDay() + 6) % 7;
            dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
            const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
            const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
            firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
            const week = 1 + Math.round((dt - firstThu) / (7 * 24 * 3600 * 1000));
            return Math.min(53, Math.max(1, week));
        };

        const woy = isoWeekOfYear(d);

        // Seasonality
        if (sf && itemCode && typeof sf.getSeasonalityFactorForScope === 'function') {
            const seasonF = Number(sf.getSeasonalityFactorForScope(itemCode, locF, subF, woy)) || 1.0;
            proj = proj * seasonF;
            costChartState._projUsageSeasonFactor = seasonF;
            costChartState._projUsageSeasonWeek = woy;
            costChartState._projUsageSeasonKey = (locF && locF !== 'ALL')
                ? (subF && subF !== 'ALL')
                    ? (`itemLocSublocSeason|${itemCode}|${locF}|${subF}`)
                    : (`itemLocSeason|${itemCode}|${locF}`)
                : (`itemSeason|${itemCode}`);
        }

        // Trend (relative per week) applied by horizon weeks
        const horizonWeeks = w;
        if (sf && itemCode && typeof sf.getTrendRelForScope === 'function') {
            const trendRel = Number(sf.getTrendRelForScope(itemCode, locF, subF)) || 0.0;
            const trendF = Math.max(0.5, Math.min(2.0, 1 + trendRel * horizonWeeks));
            proj = proj * trendF;
            costChartState._projUsageTrendRel = trendRel;
            costChartState._projUsageTrendFactor = trendF;
        }

        // Apply final trend facts factor loaded from Sheet/calculated state
        proj = proj * getTrendFactorForItemCode(itemCode);

        // Prediction interval (preferred) or confidence interval fallback
        if (sf && itemCode) {
            let low = null, high = null;

            // PI: residual-quantile bounds (asymmetric, more realistic)
            if (typeof sf.getPiRelBoundsForScope === 'function') {
                const b = sf.getPiRelBoundsForScope(itemCode, locF, subF);
                if (b && Number.isFinite(b.lo) && Number.isFinite(b.hi)) {
                    low = Math.max(0, proj * (1 + b.lo));
                    high = Math.max(low, proj * (1 + b.hi));
                    costChartState._projUsagePiMethod = b.method || 'pi';
                    costChartState._projUsagePiN = b.n || 0;
                }
            }

            // CI fallback: sigma-based symmetric band
            if ((low == null || high == null) && typeof sf.getSigmaRelForScope === 'function') {
                const sigmaRel = Math.max(0, Number(sf.getSigmaRelForScope(itemCode, locF, subF)) || 0);
                const z = 1.28; // ~80% interval
                low = Math.max(0, proj * (1 - z * sigmaRel));
                high = Math.max(low, proj * (1 + z * sigmaRel));
                costChartState._projUsageSigmaRel = sigmaRel;
            }

            if (low != null && high != null) {
                if (!costChartState._projUsageCI) costChartState._projUsageCI = { low: [], high: [] };
                costChartState._projUsageCI.low.push(low);
                costChartState._projUsageCI.high.push(high);

                // Mirror to Dashboard for debugging under file:// iframe separation.
                try {
                    const now = Date.now();
                    if (!costChartState.__lastMirrorAt || (now - costChartState.__lastMirrorAt) > 500) {
                        costChartState.__lastMirrorAt = now;
                        const tgt = window.top || window.parent;
                        tgt && tgt.postMessage({
                            type: 'COST_CHART_STATE',
                            payload: {
                                projUsageCI: costChartState._projUsageCI,
                                projUsageSigmaRel: costChartState._projUsageSigmaRel,
                                projUsagePiMethod: costChartState._projUsagePiMethod,
                                projUsagePiN: costChartState._projUsagePiN,
                                view: view,
                                drillLevel: drillLevel
                            }
                        }, '*');
                    }
                } catch (_) {}
            }
        }
    } catch (e) {
        // ignore
    }

    aggregatedData.usage.push(proj);
} else {
    aggregatedData.usage.push(0);
}

        // Waste projection:
        // - Prefer expiry-based spikes
        // - Fall back to trailing mean if no expiry info exists (so the frame still has content)
        if (view === 'waste' || view === 'all') {
            const wKey = toISODate(d);
            const spike = projectedWasteByWeek.get(wKey);
            if (spike != null) aggregatedData.waste.push(spike);
            else aggregatedData.waste.push(projectedWasteEvents.length ? 0 : projectedWeeklyWasteFallback);
        } else {
            aggregatedData.waste.push(0);
        }

        // Cost of projected waste (for tooltip + drill-through). Only nonzero on expiry spikes.
        if (view === 'waste' || view === 'all') {
            const wKeyCost = toISODate(d);
            const cst = projectedWasteCostByWeek.get(wKeyCost);
            aggregatedData.projectedWasteCost.push((cst != null) ? cst : 0);
        } else {
            aggregatedData.projectedWasteCost.push(0);
        }

        aggregatedData.restock.push(0);
    }

    // Lightweight audit (opt-in) — shows what the projection is doing and why.
    // Run: window.__PROJECTION_AUDIT__ = true
    try {
        if (globalThis.__PROJECTION_AUDIT__) {
            const sig = `${view}|${lastRealWeekEndISO}|${outlookDays}|${currentItems.length}`;
            if (costChartState._lastProjectionAuditSig !== sig) {
                costChartState._lastProjectionAuditSig = sig;

                const weekTotals = [];
                for (let w = 1; w <= futureWeeks; w++) {
                    const d = new Date(lastRealWeekEnd);
                    d.setDate(d.getDate() + (7 * w));
                    d.setHours(0,0,0,0);
                    const k = toISODate(d);
                    weekTotals.push({ weekEnd: k, projectedWaste: projectedWasteByWeek.get(k) || 0 });
                }

                console.groupCollapsed('🧾 Projection audit (expiry-based waste)');
                console.log({ view, lastRealWeekEndISO, outlookDays, items: currentItems.length });
                console.log('Waste mode:', (projectedWasteEvents.length ? 'expiry-spikes' : 'fallback-trailing-mean'));
                console.table(weekTotals.filter(r => r.projectedWaste > 0.00001));
                if (projectedWasteEvents.length) {
                    // Sort biggest leftovers first
                    const top = projectedWasteEvents.slice().sort((a,b)=>b.leftoverQty-a.leftoverQty).slice(0, 30);
                    console.table(top);
                }
                console.groupEnd();
            }
        }
    } catch (e) {}
}


    // Expose expiry-spike maps for Day view + drill-through.
    // Store on chart state (preferred) and also publish on window as a safety net.
    // Some legacy paths (or cached code) may still reference `projectedWasteByDate` directly.
    costChartState._projectedWasteByDate = projectedWasteByDate || new Map();
    try {
        window.projectedWasteByDate = projectedWasteByDate || new Map();
    } catch (e) {
        // ignore
    }
    costChartState._projectedWasteCostByDate = projectedWasteCostByDate || new Map();
    costChartState._projectedWasteContribByDate = projectedWasteContribByDate || new Map();
    costChartState._projectedWasteCostByWeek = projectedWasteCostByWeek || new Map();

// Projection boundary index (first projected bin)
let _displayProjectionStartIndex = shouldGenerateOutlook ? originalWeekCount : -1;

            // Apply drill-down transform (Month ↔ Week ↔ Day)
            const _rawDrill = Number.isFinite(costChartState.verticalDrillLevel)
                ? costChartState.verticalDrillLevel
                : 1;
            const drillLevel = Math.max(0, Math.min(2, _rawDrill));
            // Debug overlay for drill level (helps verify Month/Week/Day is active)
            try {
                // (DRILL debug badge removed)

            } catch (e) {}

            let ctxObj = costChartState.verticalDrillContext || null;

            const makeMonthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            const monthLabel = (d) => d.toLocaleString('en-US', { month: 'short' }).toUpperCase();

            // Build bins in a unified structure
            let bins = [];

            if (drillLevel === 0) {
                // Month bins across the selected date range (calendar months), using ACTUAL transaction dates.
                // IMPORTANT: We must not derive month from week-ending dates; weeks that span Dec/Jan would
                // otherwise be attributed entirely to Jan, hiding DEC and producing misleading equal-looking bins.
                const byMonth = new Map(); // key -> {label, usage, restock, waste, projectedWasteCost, endDate}

                // Determine month span from selected range; fallback to available weekEndDates
                let fromISO = null, toISOv = null;
                try {
                    const r = getSelectedDateRangeISO();
                    fromISO = r && r.from ? r.from : null;
                    toISOv  = r && r.to ? r.to : null;
                } catch (e) {}

                let spanStart = null, spanEnd = null;
                if (fromISO) spanStart = new Date(fromISO + 'T00:00:00');
                if (toISOv)  spanEnd   = new Date(toISOv  + 'T00:00:00');

                // Extend the month span when an outlook range is selected so future bins can be generated
                // past the last real transaction date.
                const __addDaysDate = (d, n) => {
                    const x = new Date(d);
                    x.setDate(x.getDate() + (Number.isFinite(n) ? n : 0));
                    x.setHours(0,0,0,0);
                    return x;
                };
                const __projectionBoundaryISO = (shouldGenerateOutlook && lastRealWeekEndISO) ? lastRealWeekEndISO : toISODate(new Date());
                if (shouldGenerateOutlook && outlookDays > 0) {
                    if (spanEnd) spanEnd = __addDaysDate(spanEnd, outlookDays);
                    else if (lastRealWeekEnd) spanEnd = __addDaysDate(lastRealWeekEnd, outlookDays);
                }

                if (!spanStart || isNaN(spanStart.getTime())) spanStart = weekEndDates.length ? new Date(weekEndDates[0].getTime()) : new Date();
                if (!spanEnd   || isNaN(spanEnd.getTime()))   spanEnd   = weekEndDates.length ? new Date(weekEndDates[weekEndDates.length-1].getTime()) : new Date();

                // Normalize to first day of month
                spanStart = new Date(spanStart.getFullYear(), spanStart.getMonth(), 1);
                spanEnd   = new Date(spanEnd.getFullYear(),   spanEnd.getMonth(),   1);

                // Pre-seed all months so labels always show (e.g., DEC/JAN)
                const monthKeysInOrder = [];
                {
                    const cur = new Date(spanStart.getTime());
                    const maxIter = 60; // safety
                    let iter = 0;
                    while (cur.getTime() <= spanEnd.getTime() && iter < maxIter) {
                        const key = makeMonthKey(cur);
                        monthKeysInOrder.push(key);
                        if (!byMonth.has(key)) byMonth.set(key, {
                            key,
                            label: monthLabel(cur),
                            usage: 0,
                            restock: 0,
                            waste: 0,
                            projectedWasteCost: 0,
                            startDate: new Date(cur.getFullYear(), cur.getMonth(), 1),
                            endDate: new Date(cur.getFullYear(), cur.getMonth() + 1, 0) // last day of month
                        });
                        cur.setMonth(cur.getMonth() + 1);
                        iter++;
                    }
                }

                // Aggregate from RAW transactions into month buckets using the transaction date's month
                for (let ii = 0; ii < itemCodes.length; ii++) {
                    const code = itemCodes[ii];
                    const bucket = txnRoot && txnRoot[code];
                    const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
                    if (!Array.isArray(hist)) continue;

                    for (let j = 0; j < hist.length; j++) {
                        const row = hist[j] || {};
                        const d = parseISODate(row.transDate || row.date || row.transactionDate);
                        if (!inRange(d)) continue;

                            // Respect location/sublocation filters in the fallback path as well.
                            // Otherwise, toggles appear to "do nothing" because fallback repopulates
                            // weekly totals from unfiltered histories.
                            if (__vbLocOn || __vbSublocOnEff) {
                                // Destination-only filters for vertical bar chart (monthly fallback path)
                                const destRaw0 = (row.sendToLocation || row.toLocation || row.destinationLocation || row.destLocation || '');
                                const destRaw = String(destRaw0 || '').trim();
                                if (!destRaw) continue;
                                const destCanonExact = _canonSublocExact(destRaw);
                                if (!destCanonExact) continue;

                                if (__vbLocOn) {
                                    const ml = (_mainLocFromSublocToken(destRaw) || _mainLocFromSublocToken(destCanonExact) || '');
                                    const lk0 = ml ? String(ml).trim().toUpperCase() : _locKeyFromCanon(destCanonExact);
                                    const tokenU = String(destCanonExact || '').trim().toUpperCase();
                                    let _match = false;
                                    if (lk0 && lk0 === __vbLocCanon) _match = true;
                                    else if (tokenU && tokenU === __vbLocCanon) _match = true;
                                    else if (tokenU && __vbLocCanon && tokenU.startsWith(__vbLocCanon)) _match = true;
                                    if (!_match) continue;
                                }
                                if (__vbSublocOnEff) {
                                    if (destCanonExact !== __vbSublocCanonEff) continue;
                                }
                            }

                        const qty = Number(row.transQty ?? row.TransQty ?? row.qty ?? row.quantity ?? 0);
                        const kind = classifyTxn(row.transactionType || row.type || row.transType, qty);
                        const mag = Math.abs(qty || 0);
                        if (!mag) continue;

                        const mKey = makeMonthKey(d);
                        if (!byMonth.has(mKey)) {
                            const md = new Date(d.getFullYear(), d.getMonth(), 1);
                            byMonth.set(mKey, {
                                key: mKey,
                                label: monthLabel(md),
                                usage: 0,
                                restock: 0,
                                waste: 0,
                                projectedWasteCost: 0,
                                startDate: new Date(md.getFullYear(), md.getMonth(), 1),
                                endDate: new Date(md.getFullYear(), md.getMonth() + 1, 0)
                            });
                            // Insert into order if it falls in range but wasn't preseeded (should be rare)
                            if (!monthKeysInOrder.includes(mKey)) monthKeysInOrder.push(mKey);
                        }
                        const agg = byMonth.get(mKey);
                        if (kind === 'usage') agg.usage += mag;
                        else if (kind === 'restock') agg.restock += mag;
                        else if (kind === 'waste') agg.waste += mag;
                    }
                }

                

                // Roll up projected (outlook) weeks into month buckets so Month view can show projections.
                if (shouldGenerateOutlook && typeof originalWeekCount === 'number' && originalWeekCount > 0) {
                    for (let wi = originalWeekCount; wi < weekEndDates.length; wi++) {
                        const d = weekEndDates[wi];
                        if (!d) continue;
                        const mKey = makeMonthKey(d);
                        if (!byMonth.has(mKey)) {
                            const md = new Date(d.getFullYear(), d.getMonth(), 1);
                            byMonth.set(mKey, {
                                key: mKey,
                                label: monthLabel(md),
                                usage: 0,
                                restock: 0,
                                waste: 0,
                                projectedWasteCost: 0,
                                startDate: new Date(md.getFullYear(), md.getMonth(), 1),
                                endDate: new Date(md.getFullYear(), md.getMonth() + 1, 0)
                            });
                            if (!monthKeysInOrder.includes(mKey)) monthKeysInOrder.push(mKey);
                        }
                        const agg = byMonth.get(mKey);
                        agg.usage += Number(aggregatedData.usage[wi] || 0);
                        agg.restock += Number(aggregatedData.restock[wi] || 0);
                        agg.waste += Number(aggregatedData.waste[wi] || 0);
                        agg.projectedWasteCost += Number((aggregatedData.projectedWasteCost && aggregatedData.projectedWasteCost[wi]) || 0);
                    }
                }
// Emit bins in month order (ensures DEC/JAN show in sequence)
                for (const key of monthKeysInOrder) {
                    const obj = byMonth.get(key);
                    if (!obj) continue;
                    bins.push({
                        level: 'month',
                        key: obj.key,
                        label: obj.label,
                        usage: obj.usage,
                        restock: obj.restock,
                        waste: obj.waste,
                        projectedWasteCost: obj.projectedWasteCost || 0,
                        isProjected: (shouldGenerateOutlook && obj.startDate ? (toISODate(obj.startDate) > __projectionBoundaryISO) : false),
                        endDate: obj.endDate,
                        indices: null
                    });
                }

                // Projection boundary for month bins
                _displayProjectionStartIndex = bins.findIndex(b => b.isProjected);

            }else if (drillLevel === 1) {
                // Week bins, optionally scoped to a selected month
                let allowed = null;
                if (ctxObj && ctxObj.monthKey) allowed = ctxObj.monthKey;

                // Cache weekly bins by range/view/month selection.
                // This prevents re-slicing the same arrays on repeated drill toggles.
                if (!costChartState._verticalDrillBinCache) {
                    costChartState._verticalDrillBinCache = {
                        dailyAggByRange: new Map(),
                        binsByKey: new Map()
                    };
                }
                const __filterSigW = (typeof getFilterSignatureForBins === 'function') ? getFilterSignatureForBins() : '';// include active filters so Week bins update like Day
                const __wkRangeKey = (costChartState.__lastRatesRangeKey || '') + `|${String(view)}|${String(outlookDays||0)}|${String(allowed||'')}|${String(__filterSigW)}`;
                const __wkCacheKey = `w|${__wkRangeKey}`;
                const __wkCached = costChartState._verticalDrillBinCache.binsByKey.get(__wkCacheKey);
                if (__wkCached && Array.isArray(__wkCached.bins)) {
                    bins = __wkCached.bins;
                    _displayProjectionStartIndex = __wkCached.projectionStartIndex;
                } else {
                for (let i = 0; i < weekEndDates.length; i++) {
                    const d = weekEndDates[i];
                    const mk = makeMonthKey(d);
                    if (allowed && mk !== allowed) continue;
                    bins.push({
                        level:'week',
                        key: toISODate(d),
                        label: weekLabels[i],
                        usage: aggregatedData.usage[i]||0,
                        restock: aggregatedData.restock[i]||0,
                        waste: aggregatedData.waste[i]||0,
                        projectedWasteCost: (aggregatedData.projectedWasteCost ? (aggregatedData.projectedWasteCost[i]||0) : 0),
                        isProjected: (_displayProjectionStartIndex>=0 && i>=_displayProjectionStartIndex),
                        endDate: d,
                        sourceIndex: i
                    });
                }
                    _displayProjectionStartIndex = bins.findIndex(b=>b.isProjected);
                    costChartState._verticalDrillBinCache.binsByKey.set(__wkCacheKey, {
                        bins: bins.slice(),
                        projectionStartIndex: _displayProjectionStartIndex
                    });
                }
            } else {
                // Day bins across the active calendar range.
                // NOTE: We no longer cap day bins to 45; when there are >45 bins we render
                // in dense-line mode (same chart) and de-clutter labels.
                const r = (typeof getSelectedDateRangeISO === 'function') ? getSelectedDateRangeISO() : null;
                const __bounds = costChartState._txDateBounds || null;
                const anchorISO = (__bounds && __bounds.maxISO) ? __bounds.maxISO : (new Date()).toISOString().split('T')[0];
                const rangeToISO0 = (r && r.to) ? String(r.to).slice(0,10) : anchorISO;
                let rangeToISO = rangeToISO0;
                let rangeFromISO = (r && r.from) ? String(r.from).slice(0,10) : '';

                // If From is blank, default to the earliest available transaction date (full history).
                const __addDaysISO = (iso, n) => {
                    const d = new Date(String(iso).slice(0,10) + 'T00:00:00');
                    d.setDate(d.getDate() + (Number.isFinite(n) ? n : 0));
                    return toISODate(d);
                };
                if (!rangeFromISO) rangeFromISO = (__bounds && __bounds.minISO) ? __bounds.minISO : __addDaysISO(rangeToISO, -44);
                if (__bounds && __bounds.minISO && rangeFromISO < __bounds.minISO) rangeFromISO = __bounds.minISO;
                if (rangeFromISO > rangeToISO) rangeFromISO = rangeToISO;

                // If Outlook is enabled, extend the DAY view into the future even though the To-date
                // is capped at today's date. Projection still follows the Projection preset (3/6/9 months).
                if (shouldGenerateOutlook && outlookDays > 0) {
                    const baseISO = (lastRealWeekEndISO && lastRealWeekEndISO > rangeToISO) ? lastRealWeekEndISO : rangeToISO;
                    const bd = new Date(baseISO + 'T00:00:00');
                    const _od = Math.max(0, outlookDays || 0);
                    const _months = (_od === 90) ? 3 : (_od === 180) ? 6 : (_od === 270) ? 9 : 0;
                    if (_months) bd.setMonth(bd.getMonth() + _months);
                    else bd.setDate(bd.getDate() + _od);
                    rangeToISO = toISODate(bd);
                }

                const __filterSig2 = (typeof getFilterSignatureForBins === 'function') ? getFilterSignatureForBins() : '';
                const rangeKey = `${rangeFromISO}|${rangeToISO}|${String(view)}|${String(outlookDays||0)}|${__filterSig2}`;

                // Prepare caches for drill binning (week/day) to avoid re-flattening and re-aggregating.
                if (!costChartState._verticalDrillBinCache) {
                    costChartState._verticalDrillBinCache = {
                        dailyAggByRange: new Map(),
                        binsByKey: new Map()
                    };
                }

                // Compute ordered day keys (inclusive).
                const orderedDayKeys = [];
                {
                    const start = new Date(rangeFromISO + 'T00:00:00');
                    const end = new Date(rangeToISO + 'T00:00:00');
                    const ms = Math.max(0, end.getTime() - start.getTime());
                    const days = Math.floor(ms / 86400000) + 1;
                    for (let i = 0; i < days; i++) {
                        orderedDayKeys.push(__addDaysISO(rangeFromISO, i));
                    }
                }

                // Try bin-cache first (full bins array)
                const __binCacheKey = `d|${rangeKey}`;
                const cachedBins = costChartState._verticalDrillBinCache.binsByKey.get(__binCacheKey);
                if (cachedBins && Array.isArray(cachedBins.bins)) {
                    bins = cachedBins.bins;
                    _displayProjectionStartIndex = cachedBins.projectionStartIndex;
                } else {
                    // Build daily aggregates for this range once.
                    let dailyAgg = costChartState._verticalDrillBinCache.dailyAggByRange.get(rangeKey);
                    if (!dailyAgg) {
                        dailyAgg = new Map();
                        for (let i = 0; i < orderedDayKeys.length; i++) {
                            const k = orderedDayKeys[i];
                            dailyAgg.set(k, { usage: 0, restock: 0, waste: 0, projectedWasteCost: 0 });
                        }

                        // Use pre-aggregated per-code daily values (fast) and then sum only the currently filtered items.
                        try { ensureTxDailyAggCache(); } catch (e) {}
                        const __byCode = (costChartState.__txDailyAggByCode || Object.create(null));

                        
if (!__vbLocOn && !__vbSublocOnEff) {
    for (let ii = 0; ii < itemCodes.length; ii++) {
        const code = String(itemCodes[ii] || '').trim();
        if (!code) continue;
        const entries = __byCode[code];
        if (!entries || !entries.length) continue;

        for (let j = 0; j < entries.length; j++) {
            const e = entries[j];
            const iso = e && e.iso ? e.iso : '';
            if (!iso || iso < rangeFromISO || iso > rangeToISO) continue;

            const agg = dailyAgg.get(iso);
            if (!agg) continue;

            if (e.u) agg.usage += e.u;
            if (e.r) agg.restock += e.r;
            if (e.w) agg.waste += e.w;
        }
    }
} else {
    // Filtered Day view: scan raw histories so loc/subloc toggles affect the series.
    const txRoot2 = (costChartState.cachedMockData && costChartState.cachedMockData.transactions)
        ? costChartState.cachedMockData.transactions
        : txnRoot;

    for (let ii = 0; ii < itemCodes.length; ii++) {
        const code = String(itemCodes[ii] || '').trim();
        if (!code) continue;

        const bucket = _getTxnBucketForCode(txRoot2, code);
        const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
        if (!Array.isArray(hist) || !hist.length) continue;

        for (let j = 0; j < hist.length; j++) {
            const row = hist[j] || {};
            const iso = String((row.transDate || row.date || row.transactionDate || '')).slice(0, 10);
            if (!iso || iso < rangeFromISO || iso > rangeToISO) continue;

            // Destination-only filtering for Day view as well (Vertical Bar drill)
            const destRaw0 = (row.sendToLocation || row.toLocation || row.destinationLocation || row.destLocation || '');
            const destRaw = String(destRaw0 || '').trim();
            if ((__vbLocOn || __vbSublocOnEff) && !destRaw) continue;
            const destCanonExact = _canonSublocExact(destRaw);
            if (!destCanonExact) continue;

            if (__vbLocOn) {
                const ml = (_mainLocFromSublocToken(destRaw) || _mainLocFromSublocToken(destCanonExact) || '');
                const lk0 = ml ? String(ml).trim().toUpperCase() : _locKeyFromCanon(destCanonExact);
                const tokenU = String(destCanonExact || '').trim().toUpperCase();
                let _match = false;
                if (lk0 && lk0 === __vbLocCanon) _match = true;
                else if (tokenU && tokenU === __vbLocCanon) _match = true;
                else if (tokenU && __vbLocCanon && tokenU.startsWith(__vbLocCanon)) _match = true;
                if (!_match) continue;
            }
            if (__vbSublocOnEff) {
                if (destCanonExact !== __vbSublocCanonEff) continue;
            }

            const agg = dailyAgg.get(iso);
            if (!agg) continue;

            const qty = Number(row.transQty ?? row.TransQty ?? row.qty ?? row.quantity ?? 0);
            const kind = classifyTxn(row.transactionType || row.type || row.transType, qty);
            const mag = Math.abs(qty || 0);
            if (!mag) continue;

            if (kind === 'usage') agg.usage += mag;
            else if (kind === 'restock') agg.restock += mag;
            else agg.waste += mag;
        }
    }
}

// Add expiry-spike projected waste cost/qty when the selected range extends into outlook.
                        try {
                            const spikeMap = costChartState._projectedWasteByDate;
                            const costSpikeMap = costChartState._projectedWasteCostByDate;
                            if (spikeMap && spikeMap.get) {
                                for (let i = 0; i < orderedDayKeys.length; i++) {
                                    const k = orderedDayKeys[i];
                                    const agg = dailyAgg.get(k);
                                    if (!agg) continue;
                                    const spike = spikeMap.get(k);
                                    if (spike != null) agg.waste = Math.max(agg.waste, Number(spike) || 0);
                                    const cst = (costSpikeMap && costSpikeMap.get) ? costSpikeMap.get(k) : null;
                                    if (cst != null) agg.projectedWasteCost = Math.max(agg.projectedWasteCost, Number(cst) || 0);
                                }
                            }
                        } catch (e) {}

                        costChartState._verticalDrillBinCache.dailyAggByRange.set(rangeKey, dailyAgg);
                    }

                    // Build bins in-order
                    const projectionBoundaryISO = (shouldGenerateOutlook && lastRealWeekEndISO) ? lastRealWeekEndISO : '';
                    for (let i = 0; i < orderedDayKeys.length; i++) {
                        const k = orderedDayKeys[i];
                        const a = dailyAgg.get(k) || { usage: 0, restock: 0, waste: 0, projectedWasteCost: 0 };
                        const dObj = new Date(k + 'T00:00:00');
                        const isProj = projectionBoundaryISO ? (k > projectionBoundaryISO) : false;
                        bins.push({
                            level: 'day',
                            key: k,
                            label: formatDate(dObj),
                            usage: a.usage || 0,
                            restock: a.restock || 0,
                            waste: a.waste || 0,
                            projectedWasteCost: a.projectedWasteCost || 0,
                            isProjected: isProj,
                            date: dObj,
                            rangeFromISO,
                            rangeToISO
                        });
                    }

                    _displayProjectionStartIndex = bins.findIndex(b => b && b.isProjected);
                    costChartState._verticalDrillBinCache.binsByKey.set(__binCacheKey, {
                        bins: bins.slice(),
                        projectionStartIndex: _displayProjectionStartIndex
                    });
                }

            }

            // Replace series with drilled bins
            weekCount = bins.length;
            aggregatedData.usage = bins.map(b=>b.usage);
            aggregatedData.restock = bins.map(b=>b.restock);
            aggregatedData.waste = bins.map(b=>b.waste);
            aggregatedData.projectedWasteCost = bins.map(b=>b.projectedWasteCost||0);
            weekLabels = bins.map(b=>b.label);

            // Baseline series for Usage view (gray background bars)
            // Behavior:
            // 1) Loc=ALL => no baseline, scale to usage
            // 2) Loc selected + SubLoc=ALL => baseline is LOCATION usage (within selected location)
            // 3) Loc selected + SubLoc selected => baseline is LOCATION usage (ignore subloc)
            costChartState._vbarBaselineUsage = null;
            costChartState._vbarBaselineMode = 'none';
            try {
                const __isUsageView = (view === 'usage');
                const __locSelected = (__vbLocOn === true);
                const __sublocSelected = (__vbSublocOnEff === true);
                if (__isUsageView && __locSelected) {
                    // Option B: baseline should be the total for the selected location (destination mainLocation)
                    // regardless of whether a specific destination unit is selected.
                    const mode = 'location';
                    const byKey = Object.create(null);
                    for (let i = 0; i < bins.length; i++) byKey[bins[i].key] = 0;

                    const keyForISO = (iso) => {
                        if (!iso) return '';
                        const dLvl = drillLevel;
                        if (dLvl === 2) return iso.slice(0,10);
                        if (dLvl === 0) return iso.slice(0,7);
                        // week
                        const k = weekEndMemo[iso] || (weekEndMemo[iso] = toISODate(endOfWeek(new Date(iso + 'T00:00:00'))));
                        return k;
                    };

                    if (mode === 'global') {
                        // Total usage baseline: use pre-aggregated per-code daily cache (fast)
                        try { ensureTxDailyAggCache(); } catch (e) {}
                        const __byCode = (costChartState.__txDailyAggByCode || Object.create(null));
                        for (let ii = 0; ii < itemCodes.length; ii++) {
                            const code = String(itemCodes[ii] || '').trim();
                            if (!code) continue;
                            const entries = __byCode[code];
                            if (!entries || !entries.length) continue;
                            for (let j = 0; j < entries.length; j++) {
                                const e = entries[j];
                                const iso = e && e.iso ? String(e.iso).slice(0,10) : '';
                                if (!iso || !inRangeISO(iso)) continue;
                                const k = keyForISO(iso);
                                if (!k || byKey[k] == null) continue;
                                const u = Number(e.u || 0);
                                if (u) byKey[k] += u;
                            }
                        }
                    } else {
                        // Location usage baseline: scan raw tx but apply ONLY the location filter
                        const txRoot2 = (costChartState.cachedMockData && costChartState.cachedMockData.transactions)
                            ? costChartState.cachedMockData.transactions
                            : txnRoot;
                        for (let ii = 0; ii < itemCodes.length; ii++) {
                            const code = String(itemCodes[ii] || '').trim();
                            if (!code) continue;
                            const bucket = _getTxnBucketForCode(txRoot2, code);
                            const hist = bucket && (bucket.history || bucket.transactions || bucket.tx || []);
                            if (!Array.isArray(hist) || !hist.length) continue;
                            for (let j = 0; j < hist.length; j++) {
                                const row = hist[j] || {};
                                const iso = String((row.transDate || row.date || row.transactionDate || '')).slice(0,10);
                                if (!iso || !inRangeISO(iso)) continue;

                                // Baseline "location" mode should represent totals at the selected DESTINATION mainLocation.
                                // Transaction `sublocation` is SOURCE (cabinet/device) and must not influence this baseline.
                                const destRaw0 = (row.sendToLocation || row.toLocation || row.destinationLocation || row.destLocation || '');
                                const destRaw = String(destRaw0 || '').trim();
                                if (!destRaw) continue;

                                const locCanonExact = _canonSublocExact(destRaw);
                                if (!locCanonExact) continue;
                                const ml = (_mainLocFromSublocToken(destRaw) || _mainLocFromSublocToken(locCanonExact) || '');
                                const lk = ml ? String(ml).trim().toUpperCase() : _locKeyFromCanon(locCanonExact);
                                if (!lk || lk !== __vbLocCanon) continue;

                                const qty = Number(row.transQty ?? row.TransQty ?? row.qty ?? row.quantity ?? 0);
                                const kind = classifyTxn(row.transactionType || row.type || row.transType, qty);
                                if (kind !== 'usage') continue;
                                const mag = Math.abs(qty || 0);
                                if (!mag) continue;
                                const k = keyForISO(iso);
                                if (!k || byKey[k] == null) continue;
                                byKey[k] += mag;
                            }
                        }
                    }

                    costChartState._vbarBaselineUsage = bins.map(b => Number(byKey[b.key] || 0));
                    costChartState._vbarBaselineMode = mode;
                }
            } catch (e) {
                costChartState._vbarBaselineUsage = null;
                costChartState._vbarBaselineMode = 'none';
            }

            // Store for click-to-drill
            costChartState.verticalBarBins = bins;
            costChartState.verticalBarProjectionStartIndex = _displayProjectionStartIndex;

            // ------------------------------------------------------------------------------
            // PROJECTION DIAGNOSTICS (instrumentation patch)
            // Logs key state for projection bin generation + overlay boundary.
            // Throttled to avoid console spam: logs only when inputs change.
            // ------------------------------------------------------------------------------
            try {
                const r = (typeof getSelectedDateRangeISO === 'function') ? getSelectedDateRangeISO() : null;
                const _from = r && r.from ? r.from : 'n/a';
                const _to = r && r.to ? r.to : 'n/a';
                const _projCount = (bins || []).reduce((s,b)=>s + (b && b.isProjected ? 1 : 0), 0);
                const _first = bins && bins.length ? bins[0] : null;
                const _last  = bins && bins.length ? bins[bins.length-1] : null;

                const _diagKey = [
                    'v1',
                    'dl='+drillLevel,
                    'view='+view,
                    'from='+_from,
                    'to='+_to,
                    'outlookDays='+outlookDays,
                    'shouldOutlook='+(shouldGenerateOutlook?1:0),
                    'origWeeks='+originalWeekCount,
                    'weeksNow='+weekEndDates.length,
                    'bins='+ (bins ? bins.length : 0),
                    'projStart='+_displayProjectionStartIndex,
                    'projCount='+_projCount,
                    'lastRealWeekEndISO='+(costChartState._lastRealWeekEndISO||'n/a')
                ].join('|');

                if (costChartState._projDiagKey !== _diagKey) {
                    costChartState._projDiagKey = _diagKey;
                    console.log('🧪 Projection diagnostics:', {
                        drillLevel,
                        view,
                        dateRange: { from: _from, to: _to },
                        outlookDays,
                        shouldGenerateOutlook,
                        originalWeekCount,
                        weekEndDatesNow: weekEndDates.length,
                        projectionStartIndex: _displayProjectionStartIndex,
                        projectedBinCount: _projCount,
                        firstBin: _first ? { level: _first.level, key: _first.key, label: _first.label, isProjected: !!_first.isProjected } : null,
                        lastBin: _last ? { level: _last.level, key: _last.key, label: _last.label, isProjected: !!_last.isProjected } : null,
                        lastRealWeekEndISO: costChartState._lastRealWeekEndISO || null
                    });

                    // In Day drill-down, we may be looking at a historical week even though outlook is enabled.
                    // Only warn loudly when we're in Month/Week views (where future bins should be present).
                    if (shouldGenerateOutlook && drillLevel !== 2 && _projCount === 0) {
                        console.warn('⚠️ Outlook is enabled but NO projected bins were generated. Likely cause: future bins not appended or boundary index invalid.');
                    }
                    if (shouldGenerateOutlook && drillLevel !== 2 && (_displayProjectionStartIndex == null || _displayProjectionStartIndex < 0)) {
                        console.warn('⚠️ Outlook is enabled but projectionStartIndex is invalid:', _displayProjectionStartIndex);
                    }
                }
            } catch (e) {
                // no-op
            }


            // ------------------------------------------------------------------------------
            // Layout constants used by overlay + bar rendering.
            // Some earlier refactors removed the original padding/chartWidth/chartHeight
            // declarations, which caused runtime crashes (padding not defined, etc.).
            // ------------------------------------------------------------------------------
            const padding = {
                top: 50,
                right: 15,
                bottom: 90,
                left: 58
            };
            const chartWidth = Math.max(10, displayWidth - padding.left - padding.right);
            const chartHeight = Math.max(10, displayHeight - padding.top - padding.bottom);
            const barGroupWidth = weekCount > 0 ? (chartWidth / weekCount) : chartWidth;
            const __baseBarWidth = Math.max(4, Math.min(22, barGroupWidth / (view === 'all' ? 3.6 : 1.6)));
// In ALL view we draw 2 bar series (usage + waste) and restock is a backdrop line.
// In single views we draw 1 bar series. Expand to fill space up to 50px per bar.
const __barsPerGroup = (view === 'all' ? 2 : 1);
const __maxByGroup = (barGroupWidth * 0.90) / Math.max(1, __barsPerGroup);
const barWidth = Math.max(__baseBarWidth, Math.min(50, __maxByGroup));

            // Determine y-scale maximum for the current view (prevents ReferenceError and keeps scale consistent)
            const seriesMax = (arr) => (arr || []).reduce((m, v) => Math.max(m, Number(v) || 0), 0);
            let maxValue = 1;
            if (view === 'all') {
                maxValue = Math.max(
                    seriesMax(aggregatedData.usage),
                    seriesMax(aggregatedData.restock),
                    seriesMax(aggregatedData.waste)
                );
            } else if (view === 'usage') {
                const __base = (costChartState && Array.isArray(costChartState._vbarBaselineUsage)) ? costChartState._vbarBaselineUsage : null;
                if (__base && __base.length) maxValue = seriesMax(__base);
                else maxValue = seriesMax(aggregatedData.usage);
            } else if (view === 'restock') {
                maxValue = seriesMax(aggregatedData.restock);
            } else if (view === 'waste') {
                maxValue = seriesMax(aggregatedData.waste);
            }
            maxValue = Math.max(1, maxValue);

            // Horizontal grid lines for vertical bar chart (scale-relative, with scale values)
            (function drawBarChartHorizontalGrid(){
                const gridSteps = 5;
                const baseY = displayHeight - padding.bottom;
                ctx.save();
                ctx.strokeStyle = 'rgba(200, 205, 210, 0.65)';
                ctx.lineWidth = 0.8;
                ctx.fillStyle = 'rgba(120, 130, 140, 0.9)';
                ctx.font = '10px system-ui';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';

                const rawMaxValue = maxValue;
                const scaleRoundStep = (rawMaxValue <= 50) ? 5 : (rawMaxValue <= 500) ? 10 : (rawMaxValue <= 5000) ? 100 : 1000;
                const alignedMaxValue = Math.max(scaleRoundStep, Math.ceil(rawMaxValue / scaleRoundStep) * scaleRoundStep);
                const scaleLabelX = padding.left - 8; // keep y-scale labels left of first bar

                // Align bar scaling with grid/scale labels
                maxValue = alignedMaxValue;

                for (let g = 0; g <= gridSteps; g++) {
                    const ratio = g / gridSteps;
                    const y = baseY - (ratio * chartHeight);
                    const scaleVal = Math.round((alignedMaxValue * ratio) / scaleRoundStep) * scaleRoundStep;
                    ctx.beginPath();
                    ctx.moveTo(padding.left, y);
                    ctx.lineTo(padding.left + chartWidth, y);
                    ctx.stroke();
                    ctx.fillText(String(scaleVal), scaleLabelX, y - 5);
                }
                ctx.restore();
            })();

            try {
                console.log('🧩 VBar diagnostics (scale):', {
                    weekCount,
                    maxValue,
                    sampleUsage: (aggregatedData && aggregatedData.usage) ? aggregatedData.usage.slice(0, 5) : [],
                    sampleRestock: (aggregatedData && aggregatedData.restock) ? aggregatedData.restock.slice(0, 5) : [],
                    sampleWaste: (aggregatedData && aggregatedData.waste) ? aggregatedData.waste.slice(0, 5) : []
                });
            } catch (e) {}


            // ------------------------------------------------------------------------------
// Projection overlay (future region), divider, and label
// - Draw a translucent frame over the future bins (>= projectionStartIndex)
// - Draw dashed divider line at the boundary
// - Animate boundary movement on drill/filter changes
// ------------------------------------------------------------------------------
const projectionStartIndex = costChartState.verticalBarProjectionStartIndex;
// (patched) originalWeekCount already declared above

// Initialize animation state
if (!costChartState._projectionOverlayAnim) {
    costChartState._projectionOverlayAnim = { active: false, fromX: 0, toX: 0, startTs: 0, durMs: 220, lastX: null };
}
const _anim = costChartState._projectionOverlayAnim;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const updateProjectionAnimTarget = (targetX) => {
    // Round to whole pixels to avoid layout jitter restarting the animation every frame.
    targetX = Math.round(Number(targetX) || 0);
    if (_anim.lastX == null) {
        _anim.lastX = targetX;
        _anim.fromX = targetX;
        _anim.toX = targetX;
        _anim.active = false;
        return;
    }
    // If we're already targeting essentially the same position, do nothing.
    if (Math.abs(targetX - _anim.toX) <= 1) {
        return;
    }
    if (Math.abs(targetX - _anim.lastX) > 0.5) {
        _anim.active = true;
        _anim.fromX = _anim.lastX;
        _anim.toX = targetX;
        _anim.startTs = performance.now();
    }
};

const getAnimatedX = () => {
    if (!_anim.active) return _anim.toX;
    const now = performance.now();
    const t = Math.min(1, (now - _anim.startTs) / _anim.durMs);
    const e = easeOutCubic(t);
    const x = _anim.fromX + (_anim.toX - _anim.fromX) * e;
    if (t >= 1) {
        _anim.active = false;
        _anim.lastX = _anim.toX;
    }
    return x;
};

const drawProjectionOverlay = () => {
    // Instrumentation: log why overlay is skipped (throttled)
    if (projectionStartIndex == null || projectionStartIndex < 0 || projectionStartIndex >= weekCount) {
        try {
            const _k = 'overlaySkip|' + String(projectionStartIndex) + '|' + String(weekCount) + '|' + String(view) + '|' + String(drillLevel);
            if (costChartState._projOverlaySkipKey !== _k) {
                costChartState._projOverlaySkipKey = _k;
                chartsDebugLog('🧪 Projection overlay skipped:', { projectionStartIndex, weekCount, view, drillLevel });
            }
        } catch (e) {}
        return;
    }
    const targetBoundaryX = padding.left + projectionStartIndex * barGroupWidth;
    updateProjectionAnimTarget(targetBoundaryX);
    const boundaryX = getAnimatedX();

    // Fill future region (behind bars)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 180, 160, 0.08)'; // light teal tint
    ctx.fillRect(boundaryX, padding.top, (padding.left + chartWidth) - boundaryX, chartHeight);
    ctx.restore();
};

const drawProjectionDividerAndLabel = () => {
    // Instrumentation: log why divider/label is skipped (throttled)
    if (projectionStartIndex == null || projectionStartIndex < 0 || projectionStartIndex >= weekCount) {
        try {
            const _k = 'dividerSkip|' + String(projectionStartIndex) + '|' + String(weekCount) + '|' + String(view) + '|' + String(drillLevel);
            if (costChartState._projDividerSkipKey !== _k) {
                costChartState._projDividerSkipKey = _k;
                chartsDebugLog('🧪 Projection divider skipped:', { projectionStartIndex, weekCount, view, drillLevel });
            }
        } catch (e) {}
        return;
    }
    const boundaryX = getAnimatedX();

    // Frame outline
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 160, 140, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boundaryX, padding.top, (padding.left + chartWidth) - boundaryX, chartHeight);
    ctx.restore();

    // Divider line
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 160, 140, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(boundaryX, padding.top);
    ctx.lineTo(boundaryX, padding.top + chartHeight);
    ctx.stroke();
    ctx.restore();

    // "Projection" label pill
    const text = 'Projection';
    ctx.save();
    ctx.font = '600 13px system-ui';
    const tw = ctx.measureText(text).width;
    const px = boundaryX + 12;
    const py = padding.top + 8;
    const padX = 8;

    // Rounded rect helper
    const roundRect = (x, y, w, h, r) => {
        const rr = Math.min(r, w/2, h/2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    };

    ctx.fillStyle = 'rgba(0, 180, 160, 0.10)';
    ctx.strokeStyle = 'rgba(0, 160, 140, 0.35)';
    ctx.lineWidth = 1;
    roundRect(px, py, tw + padX*2, 18, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 140, 120, 0.95)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + padX, py + 9);
    ctx.restore();
};

// Helper function to draw styled bars
            const drawStyledBar = (x, y, w, h, type, isHovered, isSelected) => {
                // Guard against invalid heights
                if (!isFinite(h) || h <= 0) return;
                if (!isFinite(y) || !isFinite(x) || !isFinite(w)) return;
                
                const gradient = ctx.createLinearGradient(x, y, x, y + h);
                
                if (isSelected) {
                    // Selected bars use gold/yellow gradient like horizontal bars
                    gradient.addColorStop(0, '#FFD700'); // Gold
                    gradient.addColorStop(1, '#FFA500'); // Orange
                } else if (isHovered) {
                    gradient.addColorStop(0, getCSSVar('--cost-bar-hover-start'));
                    gradient.addColorStop(1, getCSSVar('--cost-bar-hover-end'));
                } else {
                    if (type === 'usage') {
                        gradient.addColorStop(0, getCSSVar('--cost-bar-gradient-start'));
                        gradient.addColorStop(1, getCSSVar('--cost-bar-gradient-end'));
                    } else if (type === 'restock') {
                        gradient.addColorStop(0, '#38ef7d');
                        gradient.addColorStop(1, '#2dd362');
                    } else {
                        gradient.addColorStop(0, '#ff6b6b');
                        gradient.addColorStop(1, '#ff5252');
                    }
                }
                
                ctx.fillStyle = gradient;
                ctx.shadowColor = isSelected ? 'rgba(255, 215, 0, 0.4)' :
                                  isHovered ? getCSSVar('--cost-bar-shadow-hover') :
                                  getCSSVar('--cost-bar-shadow');
                ctx.shadowBlur = isSelected || isHovered ? 12 : 6;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
                
                ctx.fillRect(x, y, w, h);
                
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            };

            // ------------------------------------------------------------------------------
            // Dense-bar fallback: render as a shaded line (with spikes) when too many bars
            // ------------------------------------------------------------------------------
            const computeEMA = (values, alpha) => {
                const a = (Number.isFinite(alpha) && alpha > 0 && alpha <= 1) ? alpha : 0.25;
                const out = new Array(values.length);
                let prev = 0;
                for (let i = 0; i < values.length; i++) {
                    const v = Number(values[i] || 0);
                    prev = (i === 0) ? v : (a * v + (1 - a) * prev);
                    out[i] = prev;
                }
                return out;
            };

            const mean = (arr) => {
                if (!arr || !arr.length) return 0;
                let s = 0, n = 0;
                for (let i = 0; i < arr.length; i++) {
                    const v = Number(arr[i]);
                    if (!Number.isFinite(v)) continue;
                    s += v; n++;
                }
                return n ? (s / n) : 0;
            };

            const drawShadedLineWithSpikes = (series, colorStroke, colorFill, spikeColor, labelType) => {
                const baseY = displayHeight - padding.bottom;
                const n = series.length;
                if (!n) return;

                // Smooth the line (acts as a stable baseline similar to forecasting output)
                const smoothed = computeEMA(series, 0.25);
                const avg = Math.max(1e-9, mean(smoothed));

                const xAt = (i) => padding.left + i * barGroupWidth + (barGroupWidth / 2);
                const yAt = (v) => baseY - (Number(v || 0) / maxValue) * chartHeight;

                // Shaded area under the smoothed line
                ctx.save();
                ctx.lineWidth = 2;
                ctx.strokeStyle = colorStroke;
                ctx.fillStyle = colorFill;
                ctx.beginPath();
                for (let i = 0; i < n; i++) {
                    const x = xAt(i);
                    const y = yAt(smoothed[i]);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.lineTo(xAt(n - 1), baseY);
                ctx.lineTo(xAt(0), baseY);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // Spike markers: draw a thin "bar" whenever actual deviates >20% from baseline
                const spikeThreshold = 0.20;
                const spikeW = Math.max(2, Math.min(8, barGroupWidth * 0.18));
                ctx.save();
                ctx.fillStyle = spikeColor;
                for (let i = 0; i < n; i++) {
                    const actual = Number(series[i] || 0);
                    const base = Number(smoothed[i] || 0);
                    if (!Number.isFinite(actual) || !Number.isFinite(base)) continue;
                    const dev = Math.abs(actual - base) / avg;
                    if (dev < spikeThreshold) continue;

                    const x = xAt(i);
                    const y0 = yAt(base);
                    const y1 = yAt(actual);
                    const top = Math.min(y0, y1);
                    const h = Math.max(2, Math.abs(y1 - y0));
                    ctx.globalAlpha = 0.95;
                    ctx.fillRect(x - spikeW / 2, top, spikeW, h);
                }
                ctx.restore();

                // Hit-test positions: keep hover/click behavior by adding point rectangles
                for (let i = 0; i < n; i++) {
                    const x = xAt(i);
                    const y = yAt(Number(series[i] || 0));
                    costChartState.verticalBarPositions.push({
                        x: x - Math.max(10, barGroupWidth * 0.25) / 2,
                        y: padding.top,
                        width: Math.max(10, barGroupWidth * 0.25),
                        height: chartHeight,
                        value: Number(series[i] || 0),
                        weekIndex: i,
                        binIndex: i,
                        type: labelType
                    });
                }
            };
            
                        // Draw projection overlay behind bars (future region)
            drawProjectionOverlay();

            // In ALL view, render Restock as a shaded line backdrop (instead of bars)
            if (view === 'all') {
                const baseY = displayHeight - padding.bottom;
                ctx.save();
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(17, 153, 142, 0.55)';
                ctx.fillStyle = 'rgba(17, 153, 142, 0.10)';
                ctx.beginPath();
                for (let i = 0; i < weekCount; i++) {
                    const xCenter = padding.left + i * barGroupWidth + barGroupWidth / 2;
                    const y = baseY - (aggregatedData.restock[i] / maxValue) * chartHeight;
                    if (i === 0) ctx.moveTo(xCenter, y);
                    else ctx.lineTo(xCenter, y);
                }
                ctx.stroke();

                // Fill down to baseline for subtle shaded backdrop
                ctx.lineTo(padding.left + (weekCount - 1) * barGroupWidth + barGroupWidth / 2, baseY);
                ctx.lineTo(padding.left, baseY);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // If too many bins would be rendered as bars, draw a shaded line instead.
            const __denseLineMode = (weekCount > 45);

            if (__denseLineMode) {
                // Clear any stale bar hitboxes then rebuild from line points
                costChartState.verticalBarPositions = [];

                if (view === 'all') {
                    // Usage + Waste as lines; Restock already drawn as backdrop line above.
                    drawShadedLineWithSpikes(
                        aggregatedData.usage,
                        'rgba(74, 144, 226, 0.80)',
                        'rgba(74, 144, 226, 0.18)',
                        'rgba(255, 215, 0, 0.85)',
                        'usage'
                    );
                    drawShadedLineWithSpikes(
                        aggregatedData.waste,
                        'rgba(255, 107, 107, 0.70)',
                        'rgba(255, 107, 107, 0.10)',
                        'rgba(255, 215, 0, 0.85)',
                        'waste'
                    );
                } else if (view === 'usage') {
                    drawShadedLineWithSpikes(
                        aggregatedData.usage,
                        'rgba(74, 144, 226, 0.85)',
                        'rgba(74, 144, 226, 0.18)',
                        'rgba(255, 215, 0, 0.90)',
                        'usage'
                    );
                } else if (view === 'restock') {
                    drawShadedLineWithSpikes(
                        aggregatedData.restock,
                        'rgba(56, 239, 125, 0.75)',
                        'rgba(56, 239, 125, 0.10)',
                        'rgba(255, 215, 0, 0.90)',
                        'restock'
                    );
                } else {
                    drawShadedLineWithSpikes(
                        aggregatedData.waste,
                        'rgba(255, 107, 107, 0.75)',
                        'rgba(255, 107, 107, 0.10)',
                        'rgba(255, 215, 0, 0.90)',
                        'waste'
                    );
                }

                // Hover tooltip in dense-line mode (single point)
                try {
                    const i = costChartState.hoveredVerticalBarIndex;
                    if (Number.isFinite(i) && i >= 0 && i < weekCount) {
                        const baseY = displayHeight - padding.bottom;
                        const v = (view === 'usage') ? aggregatedData.usage[i]
                                  : (view === 'restock') ? aggregatedData.restock[i]
                                  : (view === 'waste') ? aggregatedData.waste[i]
                                  : aggregatedData.usage[i];
                        const x = padding.left + i * barGroupWidth + barGroupWidth / 2;
                        const y = baseY - (Number(v || 0) / maxValue) * chartHeight;
                        ctx.save();
                        ctx.fillStyle = 'rgba(182, 203, 223, 0.92)';
                        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
                        const tw = ctx.measureText(String(Math.round(Number(v||0)).toLocaleString())).width;
                        const w = Math.max(70, tw + 28);
                        const h = 28;
                        roundRect(ctx, x - w/2, y - 38, w, h, 10);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = 'rgb(66, 66, 66)';
                        ctx.font = 'bold 13px system-ui';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(`${Math.round(Number(v||0)).toLocaleString()}`, x, y - 24);
                        ctx.restore();
                    }
                } catch (e) {}

            } else {

// Draw bars with gradients and interaction
            for (let i = 0; i < weekCount; i++) {
                const x = padding.left + i * barGroupWidth + barGroupWidth / 2;
                const baseY = displayHeight - padding.bottom;
                
                const isHovered = costChartState.hoveredVerticalBarIndex === i;
                const isSelected = costChartState.verticalBarSelectedBars && 
                                  costChartState.verticalBarSelectedBars.includes(i);
                
                

const isProjected = (costChartState.verticalBarProjectionStartIndex != null) && (costChartState.verticalBarProjectionStartIndex >= 0) && (i >= costChartState.verticalBarProjectionStartIndex);

// Fade projected bars slightly for visual distinction
ctx.save();
if (isProjected) ctx.globalAlpha = 0.78;
if (view === 'all') {
                    // Usage bar (primary)
                    const usageHeight = (aggregatedData.usage[i] / maxValue) * chartHeight;
                    const usageX = x - barWidth / 2;
                    drawStyledBar(usageX, baseY - usageHeight, barWidth, usageHeight, 'usage', isHovered, isSelected);
                    costChartState.verticalBarPositions.push({
                        x: usageX, y: baseY - usageHeight,
                        width: barWidth, height: usageHeight,
                        value: aggregatedData.usage[i], weekIndex: i, binIndex: i, type: 'usage'
                    });

                    // Waste bar stacked on top of usage
                    const wasteHeight = (aggregatedData.waste[i] / maxValue) * chartHeight;
                    const wasteY = baseY - usageHeight - wasteHeight;
                    drawStyledBar(usageX, wasteY, barWidth, wasteHeight, 'waste', isHovered, isSelected);
                    costChartState.verticalBarPositions.push({
                        x: usageX, y: wasteY,
                        width: barWidth, height: wasteHeight,
                        value: aggregatedData.waste[i], weekIndex: i, binIndex: i, type: 'waste'
                    });

                } else if (view === 'usage') {
                    // Baseline bar (gray) behind usage when a location is selected
                    const __baseSeries = (costChartState && Array.isArray(costChartState._vbarBaselineUsage)) ? costChartState._vbarBaselineUsage : null;
                    if (__baseSeries && __baseSeries.length === weekCount) {
                        const bv = Number(__baseSeries[i] || 0);
                        if (bv > 0 && maxValue > 0) {
                            const bh = (bv / maxValue) * chartHeight;
                            const bx = x - barWidth / 2;
                            const by = baseY - bh;
                            const dark = document.body.classList.contains('dark-mode');
                            ctx.save();
                            ctx.fillStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
                            ctx.fillRect(bx, by, barWidth, bh);
                            // cap line
                            ctx.strokeStyle = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)';
                            ctx.lineWidth = 2;
                            ctx.beginPath();
                            ctx.moveTo(bx, by);
                            ctx.lineTo(bx + barWidth, by);
                            ctx.stroke();
                            ctx.restore();
                        }
                    }

                    const usageHeight = (aggregatedData.usage[i] / maxValue) * chartHeight;
                    const usageX = x - barWidth / 2;
                    drawStyledBar(usageX, baseY - usageHeight, barWidth, usageHeight, 'usage', isHovered, isSelected);
                    costChartState.verticalBarPositions.push({
                        x: usageX, y: baseY - usageHeight,
                        width: barWidth, height: usageHeight,
                        value: aggregatedData.usage[i], weekIndex: i, binIndex: i, type: 'usage'
                    });
                    
                } else if (view === 'restock') {
                    const restockHeight = (aggregatedData.restock[i] / maxValue) * chartHeight;
                    const restockX = x - barWidth / 2;
                    drawStyledBar(restockX, baseY - restockHeight, barWidth, restockHeight, 'restock', isHovered, isSelected);
                    costChartState.verticalBarPositions.push({
                        x: restockX, y: baseY - restockHeight,
                        width: barWidth, height: restockHeight,
                        value: aggregatedData.restock[i], weekIndex: i, binIndex: i, type: 'restock'
                    });
                    
                } else if (view === 'waste') {
                    const wasteHeight = (aggregatedData.waste[i] / maxValue) * chartHeight;
                    const wasteX = x - barWidth / 2;
                    drawStyledBar(wasteX, baseY - wasteHeight, barWidth, wasteHeight, 'waste', isHovered, isSelected);
                    costChartState.verticalBarPositions.push({
                        x: wasteX, y: baseY - wasteHeight,
                        width: barWidth, height: wasteHeight,
                        value: aggregatedData.waste[i], weekIndex: i, binIndex: i, type: 'waste'
                    });
                }
                
                // Draw hover tooltip
                if (isHovered && (!costChartState.verticalBarDragSelection || !costChartState.verticalBarDragSelection.isActive)) {
                    // Determine which bar is being hovered and show its specific value
                    let barValue, tooltipX, tooltipY, barLabel;
                    
                    if (view === 'all' && costChartState.hoveredVerticalBarType) {
                        // Show tooltip for the specific bar being hovered
                        if (costChartState.hoveredVerticalBarType === 'restock') {
                            barValue = aggregatedData.restock[i];
                            tooltipX = x - barGroupWidth / 3;
                            const barHeight = (aggregatedData.restock[i] / maxValue * chartHeight);
                            tooltipY = baseY - barHeight - 10;
                            barLabel = 'Restock';
                        } else if (costChartState.hoveredVerticalBarType === 'usage') {
                            barValue = aggregatedData.usage[i];
                            tooltipX = x;
                            const barHeight = (aggregatedData.usage[i] / maxValue * chartHeight);
                            tooltipY = baseY - barHeight - 10;
                            barLabel = 'Usage';
                        } else if (costChartState.hoveredVerticalBarType === 'waste') {
                            barValue = aggregatedData.waste[i];
                            tooltipX = x;
                            const usageHeight = (aggregatedData.usage[i] / maxValue * chartHeight);
                            const wasteHeight = (aggregatedData.waste[i] / maxValue * chartHeight);
                            tooltipY = baseY - usageHeight - wasteHeight - 10;
                            barLabel = 'Waste';
                        }
                    } else {
                        // Single bar view - show its value
                        barValue = view === 'usage' ? aggregatedData.usage[i] :
                                  view === 'restock' ? aggregatedData.restock[i] :
                                  aggregatedData.waste[i];
                        tooltipX = x;
                        const barHeight = (barValue / maxValue * chartHeight);
                        tooltipY = baseY - barHeight - 10;
                        barLabel = view === 'usage' ? 'Usage' : 
                                  view === 'restock' ? 'Restock' : 'Waste';
                    }
                    
                    if (barValue !== undefined) {
                        const formattedValue = Math.round(barValue).toLocaleString('en-US');
                        const projTag = isProjected ? ' (Projected)' : '';
                        
                        // Save context state
                        ctx.save();
                        
                        ctx.fillStyle = getCSSVar('--cost-label-hover');
                        ctx.font = 'bold 12px system-ui';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        
                        // Show label and value
                        if (view === 'all') {
                            ctx.fillText(`${barLabel}: ${formattedValue}${projTag}`, tooltipX, tooltipY);
                        } else if (view === 'waste' && (costChartState.verticalBarProjectionStartIndex != null) && (costChartState.verticalBarProjectionStartIndex >= 0) && (i >= costChartState.verticalBarProjectionStartIndex)) {
                            // Projected waste tooltip: show qty + cost
                            const costVal = aggregatedData.projectedWasteCost ? (aggregatedData.projectedWasteCost[i] || 0) : 0;
                            ctx.fillStyle = getCSSVar('--teal-primary') || 'rgba(0,140,120,0.95)';
                            ctx.fillText(`Projection`, tooltipX, tooltipY);
                            ctx.fillStyle = getCSSVar('--cost-label-hover');
                            ctx.fillText(`${formattedValue} units`, tooltipX, tooltipY + 14);
                            ctx.fillText(`$${Math.round(costVal).toLocaleString('en-US')}`, tooltipX, tooltipY + 28);
                        } else {
                            ctx.fillText(`${formattedValue}${projTag}`, tooltipX, tooltipY);
                        }
                        
                        // Restore context state
                        ctx.restore();
                    }
                }

                // Restore projected-bar alpha (ctx.save() at top of loop)
                ctx.restore();
            }
            }
            
            // Draw all week labels in one pass after bars to prevent shifting
            ctx.save();
            ctx.fillStyle = getCSSVar('--cost-scale-label');
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            
            // Label de-clutter rules (Week + Day):
            // - Default: first tick of each month shows MM/DD (with bold month), subsequent ticks show DD.
            // - Dense axis (>45 ticks): show MM/DD on first tick of month, and DD on the 15th; otherwise skip label.
            const __binsForLabels = Array.isArray(costChartState.verticalBarBins) ? costChartState.verticalBarBins : [];
            const __isDenseAxis = weekCount > 45;
            let __lastLabeledMonth = null;

            const __parseISODate = (iso) => {
                try {
                    if (!iso || typeof iso !== 'string' || iso.length < 10) return null;
                    const y = Number(iso.slice(0,4));
                    const m = Number(iso.slice(5,7));
                    const d = Number(iso.slice(8,10));
                    if (!y || !m || !d) return null;
                    return { y, m, d };
                } catch (e) { return null; }
            };

            const __pad2 = (n) => String(n).padStart(2, '0');

            const __drawMonthDayLabel = (x, y, mm, dd) => {
                // Draw "MM" bold + "/DD" regular, centered as a unit.
                const monthTxt = __pad2(mm);
                const tailTxt = '/' + __pad2(dd);

                ctx.save();
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';

                ctx.font = 'bold 10px system-ui';
                const wMonth = ctx.measureText(monthTxt).width;

                ctx.font = '10px system-ui';
                const wTail = ctx.measureText(tailTxt).width;

                const startX = x - (wMonth + wTail) / 2;

                ctx.font = 'bold 10px system-ui';
                ctx.fillText(monthTxt, startX, y);

                ctx.font = '10px system-ui';
                ctx.fillText(tailTxt, startX + wMonth, y);
                ctx.restore();
            };

            for (let i = 0; i < weekCount; i++) {
                const x = padding.left + i * barGroupWidth + barGroupWidth / 2;
                const y = displayHeight - padding.bottom + 5;

                const bin = (i < __binsForLabels.length) ? (__binsForLabels[i] || null) : null;
                const isoKey = bin && (bin.key || bin.iso || bin.dateISO || bin.weekEndISO) ? (bin.key || bin.iso || bin.dateISO || bin.weekEndISO) : null;

                // Fallback to precomputed label if key is missing
                const rawLabel = (i < weekLabels.length) ? String(weekLabels[i] || '') : '';
                const isoFromLabel = (() => {
                    // If label looks like "MM/DD", convert to a fake date in current year for month transitions.
                    // Prefer bin.key when possible.
                    if (isoKey) return isoKey;
                    const m = /^\s*(\d{1,2})\/(\d{1,2})\s*$/.exec(rawLabel);
                    if (!m) return null;
                    const mm = Number(m[1]), dd = Number(m[2]);
                    if (!mm || !dd) return null;
                    // Use current displayed year (best-effort)
                    const yGuess = (calLeftMonth && calLeftMonth.getFullYear) ? calLeftMonth.getFullYear() : (new Date()).getFullYear();
                    return `${yGuess}-${__pad2(mm)}-${__pad2(dd)}`;
                })();

                const d = __parseISODate(isoFromLabel);
                if (!d) {
                    // Month view label cleanup: remove trailing "/" only
                    const cleaned = rawLabel.replace(/\/$/, '');
                    if (cleaned) ctx.fillText(cleaned, x, y);
                    continue;
                }

                const monthKey = `${d.y}-${__pad2(d.m)}`;
                const isNewMonth = (monthKey !== __lastLabeledMonth);

                if (__isDenseAxis) {
                    if (isNewMonth) {
                        __drawMonthDayLabel(x, y, d.m, d.d);
                        __lastLabeledMonth = monthKey;
                    } else if (d.d === 15) {
                        ctx.fillText(__pad2(d.d), x, y);
                    } else {
                        // skip label to reduce clutter
                    }
                } else {
                    if (isNewMonth) {
                        __drawMonthDayLabel(x, y, d.m, d.d);
                        __lastLabeledMonth = monthKey;
                    } else {
                        ctx.fillText(__pad2(d.d), x, y);
                    }
                }
            }
            ctx.restore();
            
            // Draw selection rectangle if dragging
            if (costChartState.verticalBarDragSelection && costChartState.verticalBarDragSelection.isActive) {
                const sel = costChartState.verticalBarDragSelection;
                const rectX = Math.min(sel.startX, sel.currentX);
                const rectY = Math.min(sel.startY, sel.currentY);
                const rectW = Math.abs(sel.currentX - sel.startX);
                const rectH = Math.abs(sel.currentY - sel.startY);
                
                ctx.strokeStyle = getCSSVar('--teal-primary');
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 3]);
                ctx.strokeRect(rectX, rectY, rectW, rectH);
                ctx.setLineDash([]);
                
                ctx.fillStyle = getCSSVar('--teal-primary') + '20';
                ctx.fillRect(rectX, rectY, rectW, rectH);
            }
            
            // Draw selection summary tooltip (only if 2 or more bars selected)
            if (costChartState.verticalBarSelectedBars && costChartState.verticalBarSelectedBars.length > 1) {
                const selectedBars = costChartState.verticalBarSelectedBars;
                
                // Calculate separate totals for each metric
                let totalUsage = 0;
                let totalRestock = 0;
                let totalWaste = 0;
                
                selectedBars.forEach(idx => {
                    totalUsage += aggregatedData.usage[idx];
                    totalRestock += aggregatedData.restock[idx];
                    totalWaste += aggregatedData.waste[idx];
                });
                
                const avgUsage = totalUsage / selectedBars.length;
                const avgRestock = totalRestock / selectedBars.length;
                const avgWaste = totalWaste / selectedBars.length;
                
                // Position in the middle of the selected bars
                const firstBarIndex = selectedBars[0];
                const lastBarIndex = selectedBars[selectedBars.length - 1];
                const firstBarX = padding.left + firstBarIndex * barGroupWidth + barGroupWidth / 2;
                const lastBarX = padding.left + lastBarIndex * barGroupWidth + barGroupWidth / 2;
                const tooltipX = (firstBarX + lastBarX) / 2;
                
                // Position vertically in middle of chart
                const tooltipY = padding.top + chartHeight / 2;
                
                ctx.save();
                
                // Different tooltip based on view mode
                if (view === 'all') {
                    // Show all three metrics separately
                    const tooltipWidth = 300;
                    const tooltipHeight = 130;
                    
                    // Transparent blurred background
                    ctx.filter = 'blur(12px)';
                    ctx.fillStyle = 'rgba(182, 203, 223, 0.75)';
                    roundRect(ctx, tooltipX - tooltipWidth/2, tooltipY - tooltipHeight/2, tooltipWidth, tooltipHeight, 12);
                    ctx.fill();
                    ctx.filter = 'none';
                    
                    // Semi-transparent sharp overlay
                    ctx.fillStyle = 'rgba(182, 203, 223, 0.85)';
                    roundRect(ctx, tooltipX - tooltipWidth/2, tooltipY - tooltipHeight/2, tooltipWidth, tooltipHeight, 12);
                    ctx.fill();
                    
                    // Draw text
                    ctx.fillStyle = 'rgb(66, 66, 66)';
                    ctx.font = 'bold 16px system-ui';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // Title
                    ctx.fillText(`Total (${selectedBars.length} weeks)`, tooltipX, tooltipY - 48);
                    
                    // Three lines for usage, restock, waste
                    ctx.font = '14px system-ui';
                    ctx.textAlign = 'left';
                    const leftX = tooltipX - 130;
                    const rightX = tooltipX + 20;
                    
                    // Usage row
                    ctx.fillStyle = getCSSVar('--bar-usage-color');
                    ctx.fillText('Usage:', leftX, tooltipY - 20);
                    ctx.fillStyle = 'rgb(66, 66, 66)';
                    ctx.fillText(`${Math.round(totalUsage).toLocaleString()}`, leftX + 70, tooltipY - 20);
                    ctx.fillText(`${Math.round(avgUsage).toLocaleString()}/wk`, rightX, tooltipY - 20);
                    
                    // Restock row
                    ctx.fillStyle = getCSSVar('--bar-restock-color');
                    ctx.fillText('Restock:', leftX, tooltipY + 5);
                    ctx.fillStyle = 'rgb(66, 66, 66)';
                    ctx.fillText(`${Math.round(totalRestock).toLocaleString()}`, leftX + 70, tooltipY + 5);
                    ctx.fillText(`${Math.round(avgRestock).toLocaleString()}/wk`, rightX, tooltipY + 5);
                    
                    // Waste row
                    ctx.fillStyle = getCSSVar('--bar-waste-color');
                    ctx.fillText('Waste:', leftX, tooltipY + 30);
                    ctx.fillStyle = 'rgb(66, 66, 66)';
                    ctx.fillText(`${Math.round(totalWaste).toLocaleString()}`, leftX + 70, tooltipY + 30);
                    ctx.fillText(`${Math.round(avgWaste).toLocaleString()}/wk`, rightX, tooltipY + 30);
                    
                } else {
                    // Single metric view - show only the selected metric
                    const tooltipWidth = 280;
                    const tooltipHeight = 90;
                    
                    let total, average, label;
                    if (view === 'usage') {
                        total = totalUsage;
                        average = avgUsage;
                        label = 'Usage';
                    } else if (view === 'restock') {
                        total = totalRestock;
                        average = avgRestock;
                        label = 'Restock';
                    } else {
                        total = totalWaste;
                        average = avgWaste;
                        label = 'Waste';
                    }
                    
                    // Transparent blurred background
                    ctx.filter = 'blur(12px)';
                    ctx.fillStyle = 'rgba(182, 203, 223, 0.75)';
                    roundRect(ctx, tooltipX - tooltipWidth/2, tooltipY - tooltipHeight/2, tooltipWidth, tooltipHeight, 12);
                    ctx.fill();
                    ctx.filter = 'none';
                    
                    // Semi-transparent sharp overlay
                    ctx.fillStyle = 'rgba(182, 203, 223, 0.85)';
                    roundRect(ctx, tooltipX - tooltipWidth/2, tooltipY - tooltipHeight/2, tooltipWidth, tooltipHeight, 12);
                    ctx.fill();
                    
                    // Draw text
                    ctx.fillStyle = 'rgb(66, 66, 66)';
                    ctx.font = 'bold 18px system-ui';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    ctx.fillText(`${label.toUpperCase()} TOTAL: ${Math.round(total).toLocaleString()}`, tooltipX, tooltipY - 22);
                    ctx.fillText(`AVERAGE: ${Math.round(average).toLocaleString()}/wk`, tooltipX, tooltipY + 2);
                    
                    ctx.font = '14px system-ui';
                    ctx.fillText(`(${selectedBars.length} weeks selected)`, tooltipX, tooltipY + 28);
                }
                
                ctx.restore();
            }
            
            // Draw X-axis title
            const axisTitle = (drillLevel === 0) ? 'Month' : (drillLevel === 2 ? 'Date' : 'Week Ending');
            ctx.save();
            ctx.fillStyle = getCSSVar('--text-primary');
            ctx.font = 'bold 12px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(axisTitle, padding.left + chartWidth / 2, displayHeight - padding.bottom + 30);
            ctx.restore();
            
            // Draw legend
            ctx.save();
            const legendX = displayWidth - padding.right + 20;
            let legendY = padding.top + 20;
            
            ctx.font = '13px system-ui';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            
            if (view === 'all' || view === 'usage') {
                ctx.fillStyle = getCSSVar('--bar-usage-color');
                ctx.fillRect(legendX, legendY, 15, 15);
                ctx.fillStyle = getCSSVar('--text-primary');
                ctx.fillText('Usage', legendX + 20, legendY + 12);
                legendY += 25;
            }
            
            if (view === 'all' || view === 'restock') {
                ctx.fillStyle = getCSSVar('--bar-restock-color');
                ctx.fillRect(legendX, legendY, 15, 15);
                ctx.fillStyle = getCSSVar('--text-primary');
                ctx.fillText('Restock', legendX + 20, legendY + 12);
                legendY += 25;
            }
            
            if (view === 'all' || view === 'waste') {
                ctx.fillStyle = getCSSVar('--bar-waste-color');
                ctx.fillRect(legendX, legendY, 15, 15);
                ctx.fillStyle = getCSSVar('--text-primary');
                ctx.fillText('Waste', legendX + 20, legendY + 12);
            }
            ctx.restore();
        

            // Draw projection divider and label on top of bars
            drawProjectionDividerAndLabel();

            // If projection overlay is animating, schedule a redraw
            if (costChartState._projectionOverlayAnim && costChartState._projectionOverlayAnim.active) {
                requestAnimationFrame(() => drawVerticalBarChart());
            }
}
        
        // ==================================================================================
        // INVENTORY PROJECTION CHART
        // ==================================================================================
        
        function drawInventoryProjection() {
            console.log('📊 Drawing inventory projection chart');
            
            // Helper to get CSS variables
            const getCSSVar = (varName) => getComputedStyle(document.body).getPropertyValue(varName).trim();
            
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            if (!canvas || !ctx) return;
            
            // Get canvas dimensions
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth;
            const displayHeight = Math.max(container.clientHeight, 500);
            
            // Set canvas size with device pixel ratio
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            
            // Fill background
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#1a1d1e' : '#ffffff';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            // Get items - with smart filtering
            let items = costChartState.items;
            let allItems = window.originalItems || items;
            
            // Apply drill-down filters from breadcrumb navigation
            if (costChartState.drillDownStack && costChartState.drillDownStack.length > 0) {
                console.log('📊 Applying drill-down filters from breadcrumb:', costChartState.drillDownStack.length, 'levels');
                items = [...items]; // Create a copy to avoid mutating original
                
                // Apply each level of the drill-down stack in sequence
                costChartState.drillDownStack.forEach(level => {
                    if (level.mode === 'itemClass') {
                        items = items.filter(item => 
                            (item.itemClass || 'Unknown') === level.key
                        );
                        console.log(`  ✓ Filtered by itemClass "${level.key}": ${items.length} items`);
                    } else if (level.mode === 'drugName') {
                        items = items.filter(item => 
                            (item.drugName || 'Unknown') === level.key
                        );
                        console.log(`  ✓ Filtered by drugName "${level.key}": ${items.length} items`);
                    } else if (level.mode === 'formulary') {
                        items = items.filter(item => {
                            const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                            const itemCategory = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                            return itemCategory === level.key;
                        });
                        console.log(`  ✓ Filtered by formulary "${level.key}": ${items.length} items`);
                    }
                });
            }
            
            // Check if there's an active filter (external filters like Projected Waste, search, etc.)
            const hasActiveFilter = (costChartState.searchTerm && costChartState.searchTerm.trim() !== '') ||
                                   (costChartState.drillDownStack && costChartState.drillDownStack.length > 0) ||
                                   (costChartState.filterData && Object.keys(costChartState.filterData).length > 0);
            
            // Decide which items to show
            if (hasActiveFilter) {
                // Active filter - use filtered items, limit to 10 if more than 10
                if (items.length > 10) {
                    console.log('📊 Filtered view with', items.length, 'items - showing top 10 by earliest out-of-stock');
                    
                    // Calculate days until out of stock for filtered items
                    const itemsWithProjection = items.map(item => {
                        // Use effective inventory based on excludeStandard setting
                        const effectiveInv = getEffectiveInventory(item);
                        const qty = effectiveInv.effectiveQuantity;
                        const usageRate = item.usageRate || 0;

                        // Calculate baseline + weighted daily usage
                        let baselineWeeklyUsage = 0;
                        let baselineDailyUsage = 0;
                        if (Array.isArray(usageRate) && usageRate.length > 0) {
                            baselineWeeklyUsage = usageRate.reduce((sum, val) => sum + val, 0) / usageRate.length;
                            baselineDailyUsage = baselineWeeklyUsage / 7;
                        } else if (typeof usageRate === 'number') {
                            baselineDailyUsage = usageRate;
                            baselineWeeklyUsage = usageRate * 7;
                        }

                        const weightedUsage = getWeightedWeeklyUsage(item.itemCode, baselineWeeklyUsage, {
                            getTrendFactForItem,
                            getSpikeFactorForItem
                        });
                        const dailyUsage = Math.max(0, (Number(weightedUsage.weightedWeeklyUsage) || 0) / 7);

                        // Calculate days until out of stock
                        const daysUntilEmpty = dailyUsage > 0 ? qty / dailyUsage : Infinity;
                        
                        return {
                            ...item,
                            daysUntilEmpty: daysUntilEmpty
                        };
                    });
                    
                    // Sort by earliest out-of-stock and take top 10
                    items = itemsWithProjection
                        .filter(item => item.daysUntilEmpty > 0 && item.daysUntilEmpty < Infinity)
                        .sort((a, b) => a.daysUntilEmpty - b.daysUntilEmpty)
                        .slice(0, 10);
                    
                    chartsDebugLog('📊 Showing top 10 from', itemsWithProjection.length, 'filtered items');
                    if (items.length > 0) {
                        chartsDebugLog('📊 Sample items:', items.slice(0, 3).map(i => i.description));
                    }
                } else {
                    chartsDebugLog('📊 Filtered view - showing', items.length, 'filtered items');
                    if (items.length > 0) {
                        chartsDebugLog('📊 Sample items:', items.slice(0, 3).map(i => i.description));
                    }
                }
            } else {
                // No filter - show top 10 by earliest out-of-stock from all items
                chartsDebugLog('📊 No filter - calculating top 10 by earliest out-of-stock from all items');
                
                // Calculate days until out of stock for each item
                const itemsWithProjection = allItems.map(item => {
                    // Use effective inventory based on excludeStandard setting
                    const effectiveInv = getEffectiveInventory(item);
                    const qty = effectiveInv.effectiveQuantity;
                    const usageRate = item.usageRate || 0;

                        // Calculate baseline + weighted daily usage
                        let baselineWeeklyUsage = 0;
                        let baselineDailyUsage = 0;
                        if (Array.isArray(usageRate) && usageRate.length > 0) {
                            baselineWeeklyUsage = usageRate.reduce((sum, val) => sum + val, 0) / usageRate.length;
                            baselineDailyUsage = baselineWeeklyUsage / 7;
                        } else if (typeof usageRate === 'number') {
                            baselineDailyUsage = usageRate;
                            baselineWeeklyUsage = usageRate * 7;
                        }

                        const weightedUsage = getWeightedWeeklyUsage(item.itemCode, baselineWeeklyUsage, {
                            getTrendFactForItem,
                            getSpikeFactorForItem
                        });
                        const dailyUsage = Math.max(0, (Number(weightedUsage.weightedWeeklyUsage) || 0) / 7);

                        // Calculate days until out of stock
                        const daysUntilEmpty = dailyUsage > 0 ? qty / dailyUsage : Infinity;
                    
                    return {
                        ...item,
                        daysUntilEmpty: daysUntilEmpty
                    };
                });
                
                // Sort by earliest out-of-stock and take top 10
                items = itemsWithProjection
                    .filter(item => item.daysUntilEmpty > 0 && item.daysUntilEmpty < Infinity)
                    .sort((a, b) => a.daysUntilEmpty - b.daysUntilEmpty)
                    .slice(0, 10);
                
                console.log('📊 Showing top 10 items by earliest depletion from all items');
            }
            
            if (!items || items.length === 0) {
                ctx.fillStyle = getCSSVar('--text-secondary') || '#666';
                ctx.font = '16px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText('No items available for projection', displayWidth / 2, displayHeight / 2);
                return;
            }
            
            const padding = 60;
            const chartWidth = displayWidth - padding * 2;
            const chartHeight = displayHeight - padding * 2;
            const maxRangeDays = 45;
            
            // Color palette (variance chart style)
            const colors = [
                '#11998e', '#ff6b6b', '#667eea', '#38ef7d', '#ffa500',
                '#9b59b6', '#e74c3c', '#3498db', '#1abc9c', '#f39c12'
            ];
            
            // Calculate projections for each item
            const itemProjections = items.map((item, itemIndex) => {
                // Use effective inventory based on excludeStandard setting
                const effectiveInv = getEffectiveInventory(item);
                const qty = effectiveInv.effectiveQuantity;
                const usageRate = item.usageRate || 0;
                const eta = item.ETA || '';
                const daysUntilETA = eta ? Math.ceil((new Date(eta) - new Date()) / (1000 * 60 * 60 * 24)) : null;

                // Baseline + weighted usage (weekly->daily)
                let baselineWeeklyUsage = 0;
                let baselineDailyUsage = 0;
                if (Array.isArray(usageRate) && usageRate.length > 0) {
                    baselineWeeklyUsage = usageRate.reduce((sum, val) => sum + val, 0) / usageRate.length;
                    baselineDailyUsage = baselineWeeklyUsage / 7;
                } else if (typeof usageRate === 'number') {
                    baselineDailyUsage = usageRate;
                    baselineWeeklyUsage = usageRate * 7;
                }

                const weightedUsage = getWeightedWeeklyUsage(item.itemCode, baselineWeeklyUsage, {
                    getTrendFactForItem,
                    getSpikeFactorForItem
                });
                const dailyUsage = Math.max(0, (Number(weightedUsage.weightedWeeklyUsage) || 0) / 7);

                // Generate projection points
                const dataPoints = [];
                let remainingQty = qty;
                for (let day = 0; day <= maxRangeDays; day++) {
                    dataPoints.push({ day, qty: remainingQty });
                    remainingQty = Math.max(0, remainingQty - dailyUsage);
                }
                
                return {
                    description: item.description || item.drugName,
                    dataPoints,
                    daysUntilETA,
                    color: colors[itemIndex % colors.length],
                    currentInventory: qty,
                    itemCode: item.itemCode,
                    usageDetails: {
                        baselineWeeklyUsage: weightedUsage.baselineWeeklyUsage,
                        baselineDailyUsage,
                        weightedWeeklyUsage: weightedUsage.weightedWeeklyUsage,
                        weightedDailyUsage: dailyUsage,
                        trendMult: weightedUsage.trendMult,
                        spikeMult: weightedUsage.spikeMult
                    }
                };
            });
            
            const maxQty = Math.max(...itemProjections.map(p => p.currentInventory), 1);
            
            // Draw grid
            ctx.strokeStyle = getCSSVar('--grid-line') || '#e0e0e0';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 5; i++) {
                const y = padding + (chartHeight / 5) * i;
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(displayWidth - padding, y);
                ctx.stroke();
            }
            
            // Draw axes
            ctx.strokeStyle = getCSSVar('--text-primary') || '#333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(padding, padding);
            ctx.lineTo(padding, displayHeight - padding);
            ctx.lineTo(displayWidth - padding, displayHeight - padding);
            ctx.stroke();
            
            // Draw projections (shading + lines)
            itemProjections.forEach((projection) => {
                // Check if this line is selected
                const isSelected = costChartState.highlightKey === projection.description;
                
                // Shaded area
                ctx.save();
                ctx.globalAlpha = isSelected ? 0.4 : 0.2; // More opaque when selected
                ctx.fillStyle = projection.color;
                ctx.beginPath();
                ctx.moveTo(padding, displayHeight - padding);
                projection.dataPoints.forEach((point) => {
                    const x = padding + (point.day / maxRangeDays) * chartWidth;
                    const y = displayHeight - padding - (point.qty / maxQty) * chartHeight;
                    ctx.lineTo(x, y);
                });
                ctx.lineTo(displayWidth - padding, displayHeight - padding);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                
                // Line
                ctx.strokeStyle = projection.color;
                ctx.lineWidth = isSelected ? 4 : 2.5; // Thicker when selected
                ctx.beginPath();
                projection.dataPoints.forEach((point, index) => {
                    const x = padding + (point.day / maxRangeDays) * chartWidth;
                    const y = displayHeight - padding - (point.qty / maxQty) * chartHeight;
                    if (index === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
                
                // Add selection indicator (glow effect)
                if (isSelected) {
                    ctx.save();
                    ctx.shadowColor = projection.color;
                    ctx.shadowBlur = 10;
                    ctx.lineWidth = 4;
                    ctx.strokeStyle = projection.color;
                    ctx.beginPath();
                    projection.dataPoints.forEach((point, index) => {
                        const x = padding + (point.day / maxRangeDays) * chartWidth;
                        const y = displayHeight - padding - (point.qty / maxQty) * chartHeight;
                        if (index === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    });
                    ctx.stroke();
                    ctx.restore();
                }
                
                // ETA marker
                if (projection.daysUntilETA && projection.daysUntilETA > 0 && projection.daysUntilETA <= maxRangeDays) {
                    const etaX = padding + (projection.daysUntilETA / maxRangeDays) * chartWidth;
                    const etaPoint = projection.dataPoints[Math.round(projection.daysUntilETA)] || projection.dataPoints[0];
                    const etaY = displayHeight - padding - (etaPoint.qty / maxQty) * chartHeight;
                    
                    // Dashed line
                    ctx.strokeStyle = getCSSVar('--eta-line') || '#ff6b6b';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.beginPath();
                    ctx.moveTo(etaX, padding);
                    ctx.lineTo(etaX, displayHeight - padding);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    
                    // Dot and label
                    ctx.fillStyle = getCSSVar('--eta-line') || '#ff6b6b';
                    ctx.beginPath();
                    ctx.arc(etaX, etaY, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.font = 'bold 12px system-ui';
                    ctx.textAlign = 'center';
                    ctx.fillText('ETA', etaX, etaY - 15);
                }
            });
            
            // Y-axis labels
            ctx.fillStyle = getCSSVar('--text-primary') || '#333';
            ctx.font = '11px system-ui';
            ctx.textAlign = 'right';
            for (let i = 0; i <= 5; i++) {
                const qty = (maxQty / 5) * (5 - i);
                const y = padding + (chartHeight / 5) * i;
                ctx.fillText(Math.round(qty), padding - 10, y + 4);
            }
            
            // X-axis labels (0, 5, 10, ... 45)
            ctx.textAlign = 'center';
            for (let i = 0; i <= 9; i++) {
                const day = (maxRangeDays / 9) * i;
                const x = padding + (chartWidth / 9) * i;
                ctx.fillText(Math.round(day), x, displayHeight - padding + 20);
            }
            
            // Axis titles
            ctx.font = 'bold 12px system-ui';
            ctx.fillText('Days from Today', displayWidth / 2, displayHeight - 10);
            ctx.save();
            ctx.translate(15, displayHeight / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Inventory (units)', 0, 0);
            ctx.restore();
            
            // Setup hover tooltips for inventory projection
            // Remove any existing handlers first
            if (canvas.inventoryProjectionMouseMove) {
                canvas.removeEventListener('mousemove', canvas.inventoryProjectionMouseMove);
            }
            if (canvas.inventoryProjectionMouseLeave) {
                canvas.removeEventListener('mouseleave', canvas.inventoryProjectionMouseLeave);
            }
            if (canvas.inventoryProjectionClick) {
                canvas.removeEventListener('click', canvas.inventoryProjectionClick);
            }
            
            // Store the last tooltip state to avoid unnecessary redraws
            let lastTooltipItem = null;
            
            // Create new handlers
            canvas.inventoryProjectionMouseMove = function(e) {
                // Only run if we're on the projection chart
                if (costChartState.chartType !== 'time-chart' || costChartState.timeSeriesMetric !== 'projection') return;
                
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                let nearestItem = null;
                let minDistance = 15;
                
                itemProjections.forEach((projection) => {
                    projection.dataPoints.forEach((point) => {
                        const x = padding + (point.day / maxRangeDays) * chartWidth;
                        const y = displayHeight - padding - (point.qty / maxQty) * chartHeight;
                        const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestItem = projection;
                        }
                    });
                });
                
                // Only update if tooltip changed
                if (nearestItem !== lastTooltipItem) {
                    lastTooltipItem = nearestItem;
                    
                    // Redraw chart to clear old tooltip
                    if (costChartState.chartType === 'time-chart') {
                        drawInventoryProjection();
                    }
                }
                
                if (nearestItem) {
                    canvas.style.cursor = 'pointer';
                    
                    // Draw tooltip directly without redrawing whole chart
                    // Save current state
                    ctx.save();
                    
                    // Draw tooltip
                    const usageDetails = nearestItem.usageDetails || {};
                    const tooltipLines = [
                        nearestItem.description,
                        `Baseline: ${(Number(usageDetails.baselineWeeklyUsage) || 0).toFixed(1)} /wk`,
                        `Weighted: ${(Number(usageDetails.weightedWeeklyUsage) || 0).toFixed(1)} /wk`,
                        `Multipliers: trend ${(Number(usageDetails.trendMult) || 1).toFixed(2)} × spike ${(Number(usageDetails.spikeMult) || 1).toFixed(2)}`
                    ];
                    ctx.font = '12px system-ui';
                    const textWidth = Math.max(...tooltipLines.map(line => ctx.measureText(line).width));
                    const tooltipWidth = textWidth + 24;
                    const tooltipHeight = 24 + (tooltipLines.length * 16);
                    let tooltipX = mouseX + 15;
                    let tooltipY = mouseY - 15;
                    
                    if (tooltipX + tooltipWidth > displayWidth - 10) tooltipX = mouseX - tooltipWidth - 15;
                    if (tooltipY - tooltipHeight < 10) tooltipY = mouseY + 25;
                    
                    ctx.fillStyle = 'rgba(70, 70, 70, 0.95)';
                    ctx.fillRect(tooltipX, tooltipY - tooltipHeight, tooltipWidth, tooltipHeight);
                    ctx.strokeStyle = nearestItem.color;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(tooltipX, tooltipY - tooltipHeight, tooltipWidth, tooltipHeight);
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    tooltipLines.forEach((line, idx) => {
                        ctx.fillText(line, tooltipX + 12, tooltipY - tooltipHeight + 12 + (idx * 16));
                    });
                    
                    ctx.restore();
                } else {
                    canvas.style.cursor = 'default';
                }
            };
            
            canvas.inventoryProjectionMouseLeave = function() {
                canvas.style.cursor = 'default';
                lastTooltipItem = null;
                // Redraw to clear tooltip
                if (costChartState.chartType === 'time-chart') {
                    drawInventoryProjection();
                }
            };
            
            // Add click handler for line selection
            canvas.inventoryProjectionClick = function(e) {
                // Only run if we're on the projection chart
                if (costChartState.chartType !== 'time-chart' || costChartState.timeSeriesMetric !== 'projection') return;
                
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                let nearestItem = null;
                let minDistance = 15;
                
                // Find the nearest line to the click
                itemProjections.forEach((projection) => {
                    projection.dataPoints.forEach((point) => {
                        const x = padding + (point.day / maxRangeDays) * chartWidth;
                        const y = displayHeight - padding - (point.qty / maxQty) * chartHeight;
                        const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestItem = projection;
                        }
                    });
                });
                
                if (nearestItem) {
                    const itemKey = nearestItem.description;
                    console.log('📌 Inventory projection line clicked:', itemKey);
                    
                    // Find the full item object to get itemClass and drugName
                    const fullItem = items.find(item => item.description === itemKey);
                    
                    if (!fullItem) {
                        console.warn('⚠️ Could not find full item data for:', itemKey);
                        return;
                    }
                    
                    console.log('📦 Full item data:', {
                        description: fullItem.description,
                        drugName: fullItem.drugName,
                        itemClass: fullItem.itemClass
                    });
                    
                    // Toggle highlight - if clicking same item, clear it
                    if (costChartState.highlightKey === itemKey) {
                        console.log('🔄 Clearing selection and navigating back to drug name level');
                        
                        costChartState.highlightKey = null;
                        
                        // Navigate back to drugName level (remove description level)
                        costChartState.drillDownStack = costChartState.drillDownStack.filter(level => level.mode !== 'description');
                        
                        // Update view mode to drugName
                        costChartState.viewMode = 'drugName';
                        
                        console.log('✓ Selection cleared, at drugName level');
                        console.log('✓ Drill-down stack:', costChartState.drillDownStack);
                    } else {
                        console.log('🔽 Selecting item and auto-drilling to description level');
                        
                        costChartState.highlightKey = itemKey;
                        
                        // Build complete drill-down stack to reach this item
                        // Start fresh
                        costChartState.drillDownStack = [];
                        
                        // Add itemClass level if available
                        if (fullItem.itemClass) {
                            costChartState.drillDownStack.push({
                                key: fullItem.itemClass,
                                mode: 'itemClass'
                            });
                            console.log('  ✓ Added itemClass:', fullItem.itemClass);
                        }
                        
                        // Add drugName level if available
                        if (fullItem.drugName) {
                            costChartState.drillDownStack.push({
                                key: fullItem.drugName,
                                mode: 'drugName'
                            });
                            console.log('  ✓ Added drugName:', fullItem.drugName);
                        }
                        
                        // Add description level (the selected item)
                        costChartState.drillDownStack.push({
                            key: itemKey,
                            mode: 'description'
                        });
                        console.log('  ✓ Added description:', itemKey);
                        
                        // Update view mode to description
                        costChartState.viewMode = 'description';
                        
                        console.log('✓ Item filter set to:', itemKey);
                        console.log('✓ Full drill-down stack:', costChartState.drillDownStack);
                    }
                    
                    // Redraw projection chart with highlight
                    drawInventoryProjection();
                    
                    // Redraw other charts with the new drill-down state
                    // This will make them navigate to the selected item
                    if (costChartState.chartType === 'cost-bar') {
                        scheduleChartsRedraw('dateRange');
                        updateBreadcrumb(0); // Update breadcrumb to show new path
                    } else if (costChartState.chartType === 'bar-chart') {
                        scheduleChartsRedraw('dateRange');
                    } else if (costChartState.chartType === 'pie-chart') {
                        drawPieChart();
                    }
                }
            };
            
            canvas.addEventListener('mousemove', canvas.inventoryProjectionMouseMove);
            canvas.addEventListener('mouseleave', canvas.inventoryProjectionMouseLeave);
            canvas.addEventListener('click', canvas.inventoryProjectionClick);

            window.debugProjection = function(itemCode) {
                const code = String(itemCode || '').trim();
                const found = itemProjections.find((p) => String(p.itemCode || '').trim() === code) || itemProjections[0];
                if (!found) return null;
                const details = found.usageDetails || {};
                const sample = (found.dataPoints || []).slice(0, 3);
                const payload = {
                    itemCode: found.itemCode,
                    description: found.description,
                    baselineWeeklyUsage: Number(details.baselineWeeklyUsage) || 0,
                    weightedWeeklyUsage: Number(details.weightedWeeklyUsage) || 0,
                    trendMult: Number(details.trendMult) || 1,
                    spikeMult: Number(details.spikeMult) || 1,
                    first3ProjectedPoints: sample
                };
                console.log('🧪 debugProjection', payload);
                return payload;
            };

            if (window[PROJECTION_DEBUG_FLAG] && itemProjections[0]) {
                const p = itemProjections[0];
                const d = p.usageDetails || {};
                console.log('🧪 Projection diagnostics (charts)', {
                    itemCode: p.itemCode,
                    baselineWeeklyUsage: d.baselineWeeklyUsage,
                    trendMult: d.trendMult,
                    spikeMult: d.spikeMult,
                    weightedWeeklyUsage: d.weightedWeeklyUsage,
                    first3ProjectedPoints: (p.dataPoints || []).slice(0, 3)
                });
            }
        }
        
        // Setup mouse interactions for vertical bar chart
        function setupVerticalBarChartInteractions() {
            const canvas = costChartState.canvas;
            if (!canvas) return;
            
            // Prevent duplicate handlers
            if (canvas.verticalBarInteractionsSetup) return;
            canvas.verticalBarInteractionsSetup = true;
            
            let isDragging = false;
            
            const handleMouseDown = (e) => {
                if (costChartState.chartType !== 'bar-chart') return;
                
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                isDragging = true;
                costChartState.verticalBarDragSelection = {
                    isActive: true,
                    startX: x,
                    startY: y,
                    currentX: x,
                    currentY: y
                };
                
                scheduleChartsRedraw('dateRange');
            };
            
            const handleMouseMove = (e) => {
                if (costChartState.chartType !== 'bar-chart') return;
                
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                if (isDragging) {
                    costChartState.verticalBarDragSelection.currentX = x;
                    costChartState.verticalBarDragSelection.currentY = y;
                    scheduleChartsRedraw('dateRange');
                } else {
                    let hoveredBarIndex = -1;
                    let hoveredBarType = null;
                    
                    if (costChartState.verticalBarPositions) {
                        for (let bar of costChartState.verticalBarPositions) {
                            if (x >= bar.x && x <= bar.x + bar.width &&
                                y >= bar.y && y <= bar.y + bar.height) {
                                hoveredBarIndex = bar.weekIndex;
                                hoveredBarType = bar.type; // Track which bar type (usage, restock, waste)
                                break;
                            }
                        }
                    }
                    
                    // Check if either week or type changed
                    if (hoveredBarIndex !== costChartState.hoveredVerticalBarIndex ||
                        hoveredBarType !== costChartState.hoveredVerticalBarType) {
                        costChartState.hoveredVerticalBarIndex = hoveredBarIndex;
                        costChartState.hoveredVerticalBarType = hoveredBarType;
                        scheduleChartsRedraw('dateRange');
                    }
                }
            };
            
            const handleMouseUp = (e) => {
                if (costChartState.chartType !== 'bar-chart' || !isDragging) return;

                // Capture final pointer position so the selection rect includes the last bar
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                isDragging = false;

                const sel = costChartState.verticalBarDragSelection;
                if (sel) {
                    sel.currentX = x;
                    sel.currentY = y;
                }

                const rectX = Math.min(sel.startX, sel.currentX);
                const rectY = Math.min(sel.startY, sel.currentY);
                const rectW = Math.abs(sel.currentX - sel.startX);
                const rectH = Math.abs(sel.currentY - sel.startY);
                
                console.log('📦 Selection rectangle:', { rectX, rectY, rectW, rectH });
                console.log('📊 Bar positions:', costChartState.verticalBarPositions);
                
                const selectedWeeks = new Set();
                
                if (costChartState.verticalBarPositions) {
                    costChartState.verticalBarPositions.forEach(bar => {
                        const barRight = bar.x + bar.width;
                        const barBottom = bar.y + bar.height;
                        const rectRight = rectX + rectW + 1;
                        const rectBottom = rectY + rectH + 1;
                        
                        // Check if rectangles intersect
                        const intersects = !(barRight < rectX || bar.x > rectRight ||
                                           barBottom < rectY || bar.y > rectBottom);
                        
                        if (intersects) {
                            console.log('✓ Bar intersects:', bar.weekIndex, bar.type);
                            selectedWeeks.add(bar.weekIndex);
                        }
                    });
                }
                
                const selectedArray = Array.from(selectedWeeks).sort((a, b) => a - b);
                console.log('📌 Selected weeks:', selectedArray);
                
                costChartState.verticalBarSelectedBars = selectedArray;
                costChartState.verticalBarDragSelection.isActive = false;
                // Suppress the subsequent click event (otherwise a single-click drag-select immediately toggles off)
                costChartState._vbarSuppressNextClick = true;
                setTimeout(() => { try { costChartState._vbarSuppressNextClick = false; } catch (e) {} }, 0);
                try { updateVBarIconSelectionHighlight(); } catch (e) {}

                // If we're at the last drill-down level (day view), use the selected bars as
                // an override date range for the flow chart.
                try { applyFlowOverrideFromVerticalBarSelection(); } catch (e) {}
                
                scheduleChartsRedraw('dateRange');
            };
            
            const handleClick = (e) => {
                if (costChartState.chartType !== 'bar-chart') return;
                // If we just completed a drag-selection, ignore the click that follows mouseup.
                if (costChartState._vbarSuppressNextClick) { costChartState._vbarSuppressNextClick = false; return; }

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                let hit = null;
                if (costChartState.verticalBarPositions) {
                    for (let bar of costChartState.verticalBarPositions) {
                        if (x >= bar.x && x <= bar.x + bar.width &&
                            y >= bar.y && y <= bar.y + bar.height) {
                            hit = bar;
                            break;
                        }
                    }
                }

                // Click outside bars: clear selection + drill context
                if (!hit) {
                    if (costChartState.verticalBarSelectedBars && costChartState.verticalBarSelectedBars.length > 0) {
                        costChartState.verticalBarSelectedBars = [];
                    }
                    try { applyFlowOverrideFromVerticalBarSelection(); } catch (e) {}
                    try { updateVBarIconSelectionHighlight(); } catch (e) {}
                    scheduleChartsRedraw('dateRange');
                    return;
                }

                // At the last drill level (day view), clicks toggle bar selection rather than drill.
                if (Number(costChartState.verticalDrillLevel) === 2) {
                    const bins2 = Array.isArray(costChartState.verticalBarBins) ? costChartState.verticalBarBins : [];
                    const idx = (hit.binIndex != null) ? hit.binIndex : hit.weekIndex;
                    if (idx != null && bins2[idx]) {
                        const cur = Array.isArray(costChartState.verticalBarSelectedBars) ? costChartState.verticalBarSelectedBars.slice() : [];
                        const pos = cur.indexOf(idx);
                        if (pos >= 0) cur.splice(pos, 1);
                        else cur.push(idx);
                        cur.sort((a,b)=>a-b);
                        costChartState.verticalBarSelectedBars = cur;
                        try { applyFlowOverrideFromVerticalBarSelection(); } catch (e) {}
                        try { updateVBarIconSelectionHighlight(); } catch (e) {}
                        scheduleChartsRedraw('dateRange');
                        return;
                    }
                }

                // Drill-down click behavior
                const bins = costChartState.verticalBarBins || [];
                const bin = (hit.binIndex != null) ? bins[hit.binIndex] : null;

                if (bin) {
                    if (bin.level === 'month') {
                        costChartState.verticalDrillContext = { monthKey: bin.key };
                        costChartState.verticalDrillLevel = 1;
                    } else if (bin.level === 'week') {
                        // Keep month context if present
                        const monthKey = costChartState.verticalDrillContext && costChartState.verticalDrillContext.monthKey ? costChartState.verticalDrillContext.monthKey : null;
                        costChartState.verticalDrillContext = { ...(monthKey ? { monthKey } : {}), weekEndISO: bin.key };
                        costChartState.verticalDrillLevel = 2;
                    } else {
                        // Day-level: if this is a projected expiry spike, drill-through to Shortage Bulletin
                        if (bin.isProjected && (Number(bin.waste) || 0) > 0.00001) {
                            try {
                                const dateISO = String(bin.key || '');
                                const contribMap = costChartState._projectedWasteContribByDate;
                                const contrib = (contribMap && contribMap.get) ? (contribMap.get(dateISO) || []) : [];
                                const itemCodes = Array.from(new Set(contrib.map(c => String(c.itemCode)))).filter(Boolean);
                                if (itemCodes.length) {
                                    try { persistAnalyticsStateForReturn(); } catch (e) {}
                                    window.parent.postMessage({
                                        type: 'navigateToTab',
                                        tab: 'shortage',
                                        filter: 'projectedWasteSpike',
                                        itemCodes,
                                        context: {
                                            dateISO,
                                            projectedWasteQty: Number(bin.waste) || 0,
                                            projectedWasteCost: Number(bin.projectedWasteCost) || 0,
                                            contributors: contrib
                                        }
                                    }, '*');
                                }
                            } catch (e) {}
                        }
                    }

                    // Sync slider UI if present
                    const slider = document.getElementById('chartDrillSlider');
                    if (slider) slider.value = String(costChartState.verticalDrillLevel);

                    try {
                        localStorage.setItem('verticalDrillLevel', String(costChartState.verticalDrillLevel));
                        localStorage.setItem('verticalDrillContext', JSON.stringify(costChartState.verticalDrillContext || null));
                    } catch (e) {}

                    // Drilling changes the meaning of bar selection; clear flow override unless we're in day view.
                    try { applyFlowOverrideFromVerticalBarSelection(); } catch (e) {}

                    scheduleChartsRedraw('dateRange');
                    return;
                }
            };

            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('click', handleClick);
        }
        
        // Canvas interaction handlers
        document.addEventListener('DOMContentLoaded', () => {
            const canvas = document.getElementById('costChart');
            if (!canvas) return;
            
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                // Handle pie chart hover
                if (costChartState.chartType === 'pie-chart') {
                    // Skip hover detection during animation
                    if (pieAnimation.isAnimating) {
                        return;
                    }
                    
                    let hoveredSlice = null;
                    
                    // Debug: Log pie slices array
                    if (!costChartState.pieSlices || costChartState.pieSlices.length === 0) {
                        console.warn('⚠️ No pie slices available for hover detection');
                        costChartState.hoveredPieSlice = null;
                        return;
                    }
                    
                    // Check if mouse is over any pie slice (check sliver first since it's first in array)
                    for (const slice of costChartState.pieSlices) {
                        const dx = x - slice.centerX;
                        const dy = y - slice.centerY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        
                        if (distance <= slice.radius) {
                            // If it's the whole pie, always match
                            if (slice.isWholePie) {
                                hoveredSlice = slice;
                                break;
                            }
                            
                            // For sliver, check if angle is within slice range
                            let angle = Math.atan2(dy, dx);
                            // atan2 returns angles from -π to π
                            // Slice angles can wrap around -π/π boundary
                            
                            // Normalize angle to be in same range as slice angles
                            const normalizeAngle = (a) => {
                                while (a > Math.PI) a -= 2 * Math.PI;
                                while (a < -Math.PI) a += 2 * Math.PI;
                                return a;
                            };
                            
                            angle = normalizeAngle(angle);
                            const start = normalizeAngle(slice.startAngle);
                            const end = normalizeAngle(slice.endAngle);
                            
                            // Check if angle is within slice range (handle wrapping)
                            let isInRange = false;
                            if (start <= end) {
                                // Normal case: no wrapping
                                isInRange = (angle >= start && angle <= end);
                            } else {
                                // Wrapping case: slice crosses -π/π boundary
                                isInRange = (angle >= start || angle <= end);
                            }
                            
                            if (isInRange) {
                                hoveredSlice = slice;
                                break;
                            }
                        }
                    }
                    
                    // Show/hide tooltip
                    let tooltip = document.getElementById('pieTooltip');
                    if (!tooltip) {
                        tooltip = document.createElement('div');
                        tooltip.id = 'pieTooltip';
                        tooltip.className = 'pie-tooltip';
                        document.body.appendChild(tooltip);
                    }
                    
                    if (hoveredSlice) {
                        // Special tooltip for base pie when drilled down
                        if (hoveredSlice.isWholePie && costChartState.drillDownStack.length > 0) {
                            tooltip.innerHTML = `
                                <div class="pie-tooltip-label">${hoveredSlice.label}</div>
                                <div class="pie-tooltip-value">$${hoveredSlice.value.toLocaleString()} (${hoveredSlice.percentage.toFixed(1)}%)</div>
                                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(128,128,128,0.3); font-size: 11px; opacity: 0.8;">
                                    Click to go back ↩
                                </div>
                            `;
                        } else {
                            tooltip.innerHTML = `
                                <div class="pie-tooltip-label">${hoveredSlice.label}</div>
                                <div class="pie-tooltip-value">$${hoveredSlice.value.toLocaleString()} (${hoveredSlice.percentage.toFixed(1)}%)</div>
                            `;
                        }
                        tooltip.style.left = (e.clientX + 15) + 'px';
                        tooltip.style.top = (e.clientY + 15) + 'px';
                        tooltip.classList.add('visible');
                        
                        // Show pointer cursor for:
                        // - All slivers (drillable and selectable items)
                        // - Whole pie when drilled down (can go back)
                        if (!hoveredSlice.isWholePie) {
                            canvas.style.cursor = 'pointer';
                        } else if (costChartState.drillDownStack.length > 0) {
                            // Base pie is clickable when drilled down (go back)
                            canvas.style.cursor = 'pointer';
                        } else {
                            canvas.style.cursor = 'default';
                        }
                        
                        costChartState.hoveredPieSlice = hoveredSlice;
                    } else {
                        tooltip.classList.remove('visible');
                        canvas.style.cursor = 'default';
                        costChartState.hoveredPieSlice = null;
                    }
                    return;
                }
                
                // Handle cost bar chart hover
                if (costChartState.chartType !== 'cost-bar') return;
                
                const barHeight = 40;
                const barSpacing = 10;
                const topPadding = 15;
                
                const hoveredIndex = Math.floor((y - topPadding) / (barHeight + barSpacing));
                
                if (hoveredIndex >= 0 && hoveredIndex < costChartState.currentData.length) {
                    if (costChartState.hoveredIndex !== hoveredIndex) {
                        costChartState.hoveredIndex = hoveredIndex;
                        drawHorizontalBarChart(costChartState.currentData);
                        
                        // Show pointer cursor for all bars (drill down or filter)
                        canvas.style.cursor = 'pointer';
                    }
                } else {
                    if (costChartState.hoveredIndex !== -1) {
                        costChartState.hoveredIndex = -1;
                        drawHorizontalBarChart(costChartState.currentData);
                        canvas.style.cursor = 'default';
                    }
                }
            });
            
            canvas.addEventListener('mouseleave', () => {
                // Hide pie tooltip
                const tooltip = document.getElementById('pieTooltip');
                if (tooltip) {
                    tooltip.classList.remove('visible');
                }
                costChartState.hoveredPieSlice = null;
                
                // Only handle hover for cost bar chart
                if (costChartState.chartType !== 'cost-bar') return;
                
                if (costChartState.hoveredIndex !== -1) {
                    costChartState.hoveredIndex = -1;
                    drawHorizontalBarChart(costChartState.currentData);
                    canvas.style.cursor = 'default';
                }
            });
            
            canvas.addEventListener('click', (e) => {
                // Handle pie chart clicks
                if (costChartState.chartType === 'pie-chart') {
                    console.log('🖱️ PIE CHART CLICKED');
                    console.log('  - Animation in progress?', pieAnimation.isAnimating);
                    console.log('  - Hovered slice:', costChartState.hoveredPieSlice);
                    console.log('  - Total slices:', costChartState.pieSlices?.length || 0);
                    console.log('  - Current viewMode:', costChartState.viewMode);
                    
                    // Ignore clicks during any animation (forward or reverse)
                    if (pieAnimation.isAnimating) {
                        console.log('⏸️ Animation in progress - ignoring click');
                        return;
                    }
                    
                    if (costChartState.hoveredPieSlice) {
                        const slice = costChartState.hoveredPieSlice;
                        console.log('  - Slice details:', {
                            label: slice.label,
                            isWholePie: slice.isWholePie,
                            canDrillDown: slice.canDrillDown,
                            value: slice.value
                        });
                        
                        // Clicking on whole pie - go back one level with reverse animation
                        if (slice.isWholePie) {
                            if (costChartState.drillDownStack.length > 0) {
                                console.log('🔙 Clicked base pie - animating back one level');
                                animatePieGoBack();
                            } else {
                                console.log('ℹ️ Already at root level - no action');
                            }
                            return;
                        }
                        
                        // Check if this sliver can drill down
                        if (slice.canDrillDown) {
                            console.log('🔽 Starting animated drill-down from', costChartState.viewMode, 'to next level:', slice.label);
                            
                            // Determine next view mode
                            let nextViewMode;
                            if (costChartState.viewMode === 'itemClass') {
                                nextViewMode = 'drugName'; // Class → Name
                            } else if (costChartState.viewMode === 'drugName') {
                                nextViewMode = 'description'; // Name → Items
                            }
                            
                            console.log('  → Next mode will be:', nextViewMode);
                            
                            // Trigger animation (pass all current slices)
                            animatePieDrillDown(slice, nextViewMode, slice.label, costChartState.pieSlices);
                        } else {
                            // At item level (description) - clicking highlights for filtering
                            console.log('📌 Item-level slice clicked - setting filter:', slice.label);
                            
                            // Toggle highlight - if clicking same item, clear it
                            if (costChartState.highlightKey === slice.label) {
                                costChartState.highlightKey = null;
                                console.log('✓ Item filter cleared');
                            } else {
                                costChartState.highlightKey = slice.label;
                                console.log('✓ Item filter set to:', slice.label);
                            }
                            
                            // Redraw pie chart with highlight (just visual feedback)
                            drawPieChart();
                            
                            // If time series chart is active, redraw with filter
                            if (costChartState.chartType === 'time-chart') {
                                drawTimeSeriesChart();
                            } else if (costChartState.chartType === 'cost-bar') {
                                // Update bar chart with highlight (stay on current drilled-down view)
                                if (costChartState.currentData && costChartState.currentData.length > 0) {
                                    drawHorizontalBarChart(costChartState.currentData);
                                }
                            }
                        }
                    } else {
                        console.log('⚠️ No slice is hovered - click ignored');
                    }
                    return;
                }
                
                // Handle cost bar chart clicks
                if (costChartState.chartType !== 'cost-bar') return;
                
                const rect = canvas.getBoundingClientRect();
                const y = e.clientY - rect.top;
                
                const barHeight = 40;
                const barSpacing = 10;
                const topPadding = 15;
                
                const clickedIndex = Math.floor((y - topPadding) / (barHeight + barSpacing));
                
                if (clickedIndex >= 0 && clickedIndex < costChartState.currentData.length) {
                    const [label, cost, key] = costChartState.currentData[clickedIndex];
                    
                    if (key === '__PREVIOUS__') {
                        costChartState.currentPage = Math.max(0, costChartState.currentPage - 1);
                        scheduleChartsRedraw('dateRange');
                    } else if (key === '__NEXT__') {
                        costChartState.currentPage++;
                        scheduleChartsRedraw('dateRange');
                    } else {
                        // Check if we can drill down (not at item level)
                        if (costChartState.viewMode !== 'description') {
                            handleDrillDown(key);
                        } else {
                            // At item level - add description to drill-down stack for filtering
                            console.log('📌 Item clicked at description level - setting single item filter:', key);
                            
                            // Toggle highlight - if clicking same item, clear it
                            if (costChartState.highlightKey === key) {
                                costChartState.highlightKey = null;
                                // Remove description level from drill-down stack
                                costChartState.drillDownStack = costChartState.drillDownStack.filter(level => level.mode !== 'description');
                                console.log('✓ Single item filter cleared');
                            } else {
                                costChartState.highlightKey = key;
                                
                                // Remove any existing description level first
                                costChartState.drillDownStack = costChartState.drillDownStack.filter(level => level.mode !== 'description');
                                
                                // Add description level to drill-down stack
                                costChartState.drillDownStack.push({
                                    key: key,
                                    mode: 'description'
                                });
                                console.log('✓ Single item filter set to:', key);
                                console.log('✓ Drill-down stack:', costChartState.drillDownStack);
                            }
                            
                            // Update the bar chart in place with highlight
                            if (costChartState.currentData && costChartState.currentData.length > 0) {
                                drawHorizontalBarChart(costChartState.currentData);
                            }

                            // Keep header icon state in sync and ensure Flow rebuilds when this selection changes.
                            try { updateCostBarIconSelectionHighlight(); } catch (e) {}
                            // Guaranteed Flow refresh so entering Flow after a selection cannot reuse stale Sankey.
                            try { forceRebuildFlowNow('cost-bar item select'); } catch (e) {}
                            
                            // If time series, vertical bar, or pie chart is active, redraw with filter
                            if (costChartState.chartType === 'time-chart') {
                                drawTimeSeriesChart();
                            } else if (costChartState.chartType === 'bar-chart') {
                                scheduleChartsRedraw('dateRange');
                            } else if (costChartState.chartType === 'pie-chart') {
                                drawPieChart();
                            }
                        }
                    }
                }
            });
        });

        // ==================================================================================
        // WINDOW RESIZE HANDLER
        // ==================================================================================
        
        let resizeTimeout;
        window.addEventListener('resize', () => {
            // Clear existing timeout
            clearTimeout(resizeTimeout);
            
            // Set new timeout to redraw after user stops resizing
            resizeTimeout = setTimeout(() => {
                console.log('🔄 Window resized - refreshing chart...');
                
                // Redraw the current chart type
                if (costChartState.chartType === 'cost-bar' && costChartState.currentData) {
                    drawHorizontalBarChart(costChartState.currentData);
                } else if (costChartState.chartType === 'time-chart') {
                    drawTimeSeriesChart();
                } else if (costChartState.chartType === 'flow-chart') {
                    const flow = (typeof ensureFlowDataReady === 'function') ? ensureFlowDataReady() : null;
                    if (flow && flow.flows && flow.flows.length) drawSankeyChart(flow);
                    else { const d=document.getElementById('sankeyChart'); if(d) d.innerHTML='<div style="padding:12px; color: var(--text-secondary); font: 13px system-ui;">No flow data for the selected range/filter.</div>'; }
                } else if (costChartState.chartType === 'pie-chart') {
                    drawPieChart();
                } else {
                    drawChartPlaceholder(costChartState.chartType);
                }
                
                console.log('✓ Chart refreshed after resize');
            }, 300); // Wait 300ms after user stops resizing
        });

        // ==================================================================================
        // KEYBOARD SEARCH FUNCTIONALITY
        // ==================================================================================
        
        let searchTerm = '';
        let searchTimeout = null;
        
        function performSearch(term) {
            if (!term || term.trim() === '') {
                // Empty search - check if we have an active filter
                const hasActiveFilter = costChartState.filterData && costChartState.filterData.filterType;
                
                if (hasActiveFilter) {
                    // Filter is active - restore to filtered items, not all items
                    console.log('🔍 Empty search with active filter - restoring filtered data');
                    if (window.originalItems) {
                        costChartState.items = window.originalItems;
                        window.originalItems = null;
                    }
                    
                    // Clear search term but KEEP filterData
                    costChartState.searchTerm = '';
                    
                    // Reset drill-down but keep at filtered view
                    costChartState.drillDownStack = [];
                    costChartState.viewMode = 'itemClass';
                    costChartState.currentPage = 0;
                    costChartState.highlightKey = null;
                    // DON'T clear filterData - keep the filter active!
                    
                    // Update dropdown
                    const selector = document.getElementById('costChartViewSelector');
                    if (selector) {
                        selector.value = 'itemClass';
                    }
                    
                    scheduleChartsRedraw('dateRange');
                    
                    // If pie chart is active, also redraw it
                    if (costChartState.chartType === 'pie-chart') {
                        drawPieChart();
                    }
                } else {
                    // No filter active - clear everything
                    if (window.originalItems) {
                        console.log('🔍 Empty search - restoring original data');
                        costChartState.items = window.originalItems;
                        window.originalItems = null;
                    }
                    
                    // Clear search term
                    costChartState.searchTerm = '';
                    
                    // Reset to root view
                    costChartState.drillDownStack = [];
                    costChartState.viewMode = 'itemClass';
                    costChartState.currentPage = 0;
                    costChartState.highlightKey = null;
                    costChartState.filterData = null;
                    
                    // Reset dropdown
                    const selector = document.getElementById('costChartViewSelector');
                    if (selector) {
                        selector.value = 'itemClass';
                    }
                    
                    scheduleChartsRedraw('dateRange');
                    
                    // If pie chart is active, also redraw it
                    if (costChartState.chartType === 'pie-chart') {
                        drawPieChart();
                    }
                }
                return;
            }
            
            console.log(`🔍 Searching for: "${term}"`);
            
            // Store search term in state
            costChartState.searchTerm = term;
            
            // Store original items on first search
            if (!window.originalItems) {
                window.originalItems = costChartState.items;
            }
            
            // Filter items based on search term
            const searchLower = term.toLowerCase();
            const filteredItems = window.originalItems.filter(item => {
                const drugName = (item.drugName || '').toLowerCase();
                const itemCode = (item.itemCode || '').toString().toLowerCase();
                const altItemCode = (item.alt_itemCode || item.altItemCode || '').toString().toLowerCase();
                const description = (item.description || '').toLowerCase();
                const itemClass = (item.itemClass || '').toLowerCase();
                
                return drugName.includes(searchLower) || 
                       itemCode.includes(searchLower) ||
                       altItemCode.includes(searchLower) ||
                       description.includes(searchLower) ||
                       itemClass.includes(searchLower);
            });
            
            console.log(`✓ Found ${filteredItems.length} matching items`);
            
            // Determine the best view mode based on results
            let bestViewMode = 'description';  // Default to item view
            
            if (filteredItems.length > 0) {
                // Check if all items belong to the same class
                const uniqueClasses = [...new Set(filteredItems.map(item => item.itemClass || 'Unknown'))];
                const uniqueDrugNames = [...new Set(filteredItems.map(item => item.drugName || 'Unknown'))];
                
                if (uniqueClasses.length === 1) {
                    // All results from same class - show class view
                    bestViewMode = 'itemClass';
                    console.log(`✓ All results from class: ${uniqueClasses[0]}`);
                } else if (uniqueDrugNames.length === 1) {
                    // All results from same drug name - show drug name view
                    bestViewMode = 'drugName';
                    console.log(`✓ All results from drug: ${uniqueDrugNames[0]}`);
                } else if (uniqueClasses.length <= 5) {
                    // Multiple classes but not too many - show by class
                    bestViewMode = 'itemClass';
                    console.log(`✓ Results span ${uniqueClasses.length} classes - showing class view`);
                } else if (uniqueDrugNames.length <= 10) {
                    // Many classes but manageable drug names - show by drug name
                    bestViewMode = 'drugName';
                    console.log(`✓ Results span ${uniqueDrugNames.length} drugs - showing drug view`);
                } else {
                    // Too many groups - show individual items
                    bestViewMode = 'description';
                    console.log(`✓ Results too diverse - showing item view`);
                }
            }
            
            // Replace items with filtered results
            costChartState.items = filteredItems;
            costChartState.drillDownStack = [];
            costChartState.viewMode = bestViewMode;
            costChartState.currentPage = 0;
            costChartState.highlightKey = null;
            // DON'T clear filterData - preserve it so filter chip shows original filter name
            // costChartState.filterData = null;
            
            // Update dropdown to match view mode
            const selector = document.getElementById('costChartViewSelector');
            if (selector) {
                selector.value = bestViewMode;
            }
            
            // Redraw chart with filtered data
	            // If we're currently viewing the flow chart, force the Sankey cache to rebuild.
	            if (costChartState && costChartState.chartType === 'flow-chart') {
	                invalidateFlowCache();
	            }
	            scheduleChartsRedraw('dateRange');
            
            // If pie chart is active, also redraw it
            if (costChartState.chartType === 'pie-chart') {
                drawPieChart();
            }
        }
        
        function showSearchBar() {
            const searchBar = document.getElementById('keyboardSearchBar');
            if (searchBar) searchBar.classList.add('visible');
        }
        
        function hideSearchBar() {
            const searchBar = document.getElementById('keyboardSearchBar');
            if (searchBar) searchBar.classList.remove('visible');
        }
        
        function initKeyboardSearch() {
            console.log('🔍 Initializing keyboard search');
            
            const searchBar = document.getElementById('keyboardSearchBar');
            const searchInput = document.getElementById('searchInput');
            
            if (!searchBar || !searchInput) {
                console.error('❌ Search elements not found');
                return;
            }
            
            document.addEventListener('keydown', function(e) {
                // Don't intercept if user is typing in an input field
                if (e.target.tagName === 'INPUT' || 
                    e.ctrlKey || e.altKey || e.metaKey) {
                    return;
                }
                
                // Ignore arrow keys
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || 
                    e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    return;
                }
                
                // Ignore special keys except Backspace
                if (e.key.length > 1 && e.key !== 'Backspace') {
                    return;
                }
                
                // Show search bar if not visible
                if (!searchBar.classList.contains('visible')) {
                    showSearchBar();
                    searchTerm = '';
                }
                
                // Handle backspace
                if (e.key === 'Backspace') {
                    e.preventDefault();
                    searchTerm = searchTerm.slice(0, -1);
                } else if (e.key.length === 1) {
                    searchTerm += e.key;
                }
                
                // Update input display
                searchInput.value = searchTerm;
                
                // Perform search
                if (searchTimeout) clearTimeout(searchTimeout);
                performSearch(searchTerm);
                
                // Auto-hide after 3 seconds
                searchTimeout = setTimeout(hideSearchBar, 3000);
            });
            
            // Hide search bar on mouse movement
            let mouseMoveTimeout;
            document.addEventListener('mousemove', function() {
                if (searchBar.classList.contains('visible')) {
                    if (mouseMoveTimeout) clearTimeout(mouseMoveTimeout);
                    mouseMoveTimeout = setTimeout(hideSearchBar, 500);
                }
            });
            
            console.log('✅ Keyboard search ready');
        }

        // ==================================================================================
        // INITIALIZE
        // ==================================================================================
        
        async function populateCharts() {
            try {
                console.log('🔄 Charts: Requesting data from parent...');
                const data = await requestMockDataFromParent();
                
                if (data && data.items && data.items.length > 0) {
                    console.log('✓ Charts: Received', data.items.length, 'items');
                    initInventoryCostChart(data.items);
                    
                    // Initialize keyboard search after data is loaded
                    initKeyboardSearch();
                } else {
                    console.warn('⚠️ Charts: No items in data');
                }
            } catch (error) {
                console.error('❌ Charts: Error loading data:', error);
            }
        }

        // ==================================================================================
        // CUSTOM DROPDOWN FUNCTIONALITY
        // ==================================================================================
        
        function initCustomDropdown() {
            const dropdown = document.getElementById('customDropdown');
            const dropdownHeader = document.getElementById('dropdownHeader');
            const dropdownSelected = document.getElementById('dropdownSelected');
            const dropdownOptions = document.getElementById('dropdownOptions');
            const hiddenSelect = document.getElementById('costChartViewSelector');
            const options = dropdownOptions.querySelectorAll('.dropdown-option');
            
            if (!dropdown || !dropdownHeader || !dropdownOptions) {
                console.warn('⚠️ Custom dropdown elements not found');
                return;
            }
            
            // Toggle dropdown
            dropdownHeader.addEventListener('click', function(e) {
                e.stopPropagation();
                dropdown.classList.toggle('open');
            });
            
            // Handle option selection
            options.forEach(option => {
                option.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const value = this.getAttribute('data-value');
                    const text = this.textContent;
                    
                    // Update selected text
                    dropdownSelected.textContent = text;
                    
                    // Update hidden select
                    hiddenSelect.value = value;
                    
                    // Remove selected class from all options
                    options.forEach(opt => opt.classList.remove('selected'));
                    
                    // Add selected class to current option
                    this.classList.add('selected');
                    
                    // Close dropdown
                    dropdown.classList.remove('open');
                    
                    // Trigger change event on hidden select
                    const event = new Event('change');
                    hiddenSelect.dispatchEvent(event);
                    
                    // Update view mode
                    costChartState.viewMode = value;
                    costChartState.drillDownStack = [];
                    costChartState.currentPage = 0;
                    costChartState.highlightKey = null;
                    
                    scheduleChartsRedraw('dateRange');
                    
                    console.log('✓ View mode changed to:', value);
                });
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', function(e) {
                if (!dropdown.contains(e.target)) {
                    dropdown.classList.remove('open');
                }
            });
            
            // Set initial selected state
            const initialValue = hiddenSelect.value || 'itemClass';
            const initialOption = Array.from(options).find(opt => opt.getAttribute('data-value') === initialValue);
            if (initialOption) {
                initialOption.classList.add('selected');
                dropdownSelected.textContent = initialOption.textContent;
            }
            
            console.log('✓ Custom dropdown initialized');
        }
        
        // Initialize
        console.log('🚀 Charts: Script executing...');
        
        // Setup clear filter button
        const clearFilterBtn = document.getElementById('clearFilterBtn');
        if (clearFilterBtn) {
            clearFilterBtn.addEventListener('click', clearFilter);
            console.log('✓ Clear filter button initialized');
        }
        
        // Setup clear search button
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', clearSearch);
            console.log('✓ Clear search button initialized');
        }
        
        // Initialize custom dropdown
        initCustomDropdown();

        // Initialize date range controls (bar views)
        setupDateRangeControls();
        setupVerticalDrillControls();
        updateDateRangeControlsVisibility();
        
        try {
            populateCharts();
        } catch (error) {
            console.error('❌ Fatal error during initialization:', error);
            console.error('Error stack:', error.stack);
        }

// v15: ensure breadcrumb clickable in all chart modes
try {
 const bc = document.getElementById('costBreadcrumb'); if (bc) { bc.style.pointerEvents = 'auto'; bc.style.zIndex = 100; }
} catch(e){}
