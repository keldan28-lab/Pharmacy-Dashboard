(function(){
  if (window.__analyticsLogsPatched) return;
  window.__analyticsLogsPatched = true;
  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _err = console.error.bind(console);
  function enabled(){ try { return localStorage.getItem('log_analytics') !== '0'; } catch (_) { return true; } }
  console.log = function(...args){ if (enabled()) _log(...args); };
  console.warn = function(...args){ if (enabled()) _warn(...args); };
  console.error = function(...args){ if (enabled()) _err(...args); };
})();
        // ============= LOCATION REFERENCE DATA =============
        // NOTE: Do NOT declare a top-level `const SUBLOCATION_MAP` here.
        // Some pages load `location_ref_mockdata.js` which previously declared
        // `const SUBLOCATION_MAP` and that would cause a redeclaration SyntaxError.
        // Instead, we keep a local fallback and resolve the map at runtime.
        const LOCAL_SUBLOCATION_MAP = {
            "3TWA": { mainLocation: "3TW", department: "Pyxis", oldLocation: "3TWA" },
            "3TWB": { mainLocation: "3TW", department: "Pyxis", oldLocation: "3TWB" },
            "3TWC": { mainLocation: "3TW", department: "Pyxis", oldLocation: "3TWC" },
            "VC1": { mainLocation: "Pharmacy", department: "Pharmacy", oldLocation: "VC1" },
            "VC2": { mainLocation: "Pharmacy", department: "Pharmacy", oldLocation: "VC2" },
            "Safe": { mainLocation: "Pharmacy", department: "Pharmacy", oldLocation: "Safe" },
            "MSA": { mainLocation: "MS", department: "Pharmacy", oldLocation: "MSA" },
            "MSB": { mainLocation: "MS", department: "Pharmacy", oldLocation: "MSB" },
            "2EA": { mainLocation: "2E", department: "Pyxis", oldLocation: "2EA" },
            "2EBC": { mainLocation: "2E", department: "Pyxis", oldLocation: "2EBC" }
        };

        function getSublocationMap() {
            // Prefer window/globalThis attachment
            if (typeof window !== 'undefined' && window.SUBLOCATION_MAP) return window.SUBLOCATION_MAP;
            // If an existing global lexical binding exists, access via typeof (safe even if undefined)
            if (typeof SUBLOCATION_MAP !== 'undefined' && SUBLOCATION_MAP) return SUBLOCATION_MAP;
            return LOCAL_SUBLOCATION_MAP;
        }

        try { window.__pyxisAdjViewMode = localStorage.getItem('pyxisAdjViewMode') === 'decrease' ? 'decrease' : 'increase'; } catch (_) { window.__pyxisAdjViewMode = 'increase'; }
        try { window.__pyxisAdjSortMode = localStorage.getItem('pyxisAdjSortMode') === 'alpha' ? 'alpha' : 'impact'; } catch (_) { window.__pyxisAdjSortMode = 'impact'; }
        window.__pyxisAdjSelectedMain = window.__pyxisAdjSelectedMain || null;
        // ============= PYXIS METRICS CALCULATION =============

        // Lightweight helpers (kept local to this page)
        function escapeHtml(str) {
            return String(str ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function formatCurrency(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return '$0.00';
            return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
        }


        function iterateInventorySublocations(invEntry) {
            if (!invEntry || typeof invEntry !== 'object') return [];
            const out = [];
            const list = Array.isArray(invEntry.sublocations) ? invEntry.sublocations : null;
            if (list) {
                for (const row of list) {
                    if (!row || typeof row !== 'object') continue;
                    const sublocation = String(row.sublocation || row.location || '').trim();
                    if (!sublocation) continue;
                    out.push({
                        sublocation,
                        minQty: Number(row.minQty ?? row.min ?? 0) || 0,
                        curQty: Number(row.curQty ?? row.qty ?? 0) || 0,
                        maxQty: Number(row.maxQty ?? row.max ?? 0) || 0
                    });
                }
                return out;
            }
            for (const [key, row] of Object.entries(invEntry)) {
                if (!row || typeof row !== 'object') continue;
                if (key === 'sublocations') continue;
                const sublocation = String(row.sublocation || row.location || key || '').trim();
                if (!sublocation) continue;
                out.push({
                    sublocation,
                    minQty: Number(row.minQty ?? row.min ?? 0) || 0,
                    curQty: Number(row.curQty ?? row.qty ?? 0) || 0,
                    maxQty: Number(row.maxQty ?? row.max ?? 0) || 0
                });
            }
            return out;
        }

        function buildPyxisAdjustmentData(mockData, viewMode) {
            const map = getSublocationMap() || {};
            const items = Array.isArray(mockData?.items) ? mockData.items : [];
            const inventory = (mockData?.inventory && typeof mockData.inventory === 'object') ? mockData.inventory : {};
            const byMain = new Map();
            const impactedSublocs = new Set();
            const dailyUsageByCode = Object.create(null);
            const leadDays = 14;
            const safetyDays = 7;
            const tolerance = 0.5;
            const targetDays = leadDays + safetyDays;

            for (const item of items) {
                const code = String(item?.itemCode ?? '').trim();
                if (!code) continue;
                const cachedDaily = Number(item?._cachedDailyUsage);
                const cachedWeekly = Number(item?._cachedWeeklyUsage);
                const daily = Number.isFinite(cachedDaily) ? cachedDaily : (Number.isFinite(cachedWeekly) ? (cachedWeekly / 7) : 0);
                dailyUsageByCode[code] = Math.max(0, Number(daily) || 0);
            }

            for (const item of items) {
                const itemCode = String(item?.itemCode ?? '').trim();
                if (!itemCode) continue;
                const invEntry = inventory[itemCode];
                const dailyUsage = Math.max(0, Number(dailyUsageByCode[itemCode]) || 0);
                const requiredMin = dailyUsage * targetDays;

                for (const slot of iterateInventorySublocations(invEntry)) {
                    const info = map[slot.sublocation] || {};
                    if (String(info.department || '').toLowerCase() !== 'pyxis') continue;
                    const main = String(info.mainLocation || slot.sublocation).trim();
                    if (!main) continue;
                    const minQty = Math.max(0, Number(slot.minQty) || 0);
                    const delta = requiredMin - minQty;
                    const needsIncrease = delta > 0;
                    const needsDecrease = delta < 0 && minQty > (requiredMin * (1 + tolerance));
                    const impacted = viewMode === 'increase' ? needsIncrease : needsDecrease;
                    if (!impacted) continue;

                    impactedSublocs.add(slot.sublocation);
                    if (!byMain.has(main)) byMain.set(main, { impactedPairsCount: 0, impactedSublocsSet: new Set(), bySubloc: new Map(), pairSet: new Set() });
                    const mainRec = byMain.get(main);
                    const pairKey = itemCode + '|' + slot.sublocation;
                    if (!mainRec.pairSet.has(pairKey)) {
                        mainRec.pairSet.add(pairKey);
                        mainRec.impactedPairsCount += 1;
                    }
                    mainRec.impactedSublocsSet.add(slot.sublocation);
                    if (!mainRec.bySubloc.has(slot.sublocation)) {
                        mainRec.bySubloc.set(slot.sublocation, { sublocation: slot.sublocation, impactedItemCodes: new Set(), dailyDispense: 0 });
                    }
                    const subRec = mainRec.bySubloc.get(slot.sublocation);
                    if (!subRec.impactedItemCodes.has(itemCode)) {
                        subRec.impactedItemCodes.add(itemCode);
                        subRec.dailyDispense += dailyUsage;
                    }
                }
            }

            const mainRows = Array.from(byMain.entries()).map(([main, rec]) => ({
                mainLocation: main,
                impactedPairsCount: rec.impactedPairsCount,
                impactedSublocsCount: rec.impactedSublocsSet.size,
                bySubloc: rec.bySubloc
            }));
            const maxBarCount = mainRows.reduce((m, r) => Math.max(m, Number(r.impactedPairsCount) || 0), 0);
            return { mainRows, impactedLocationCount: impactedSublocs.size, maxBarCount };
        }

        function renderPyxisAdjustmentOverviewCard(mockData) {
            const card = document.getElementById('pyxisMetricsCard');
            if (!card) return;
            const barsEl = document.getElementById('pyxisAdjBars');
            const totalEl = document.getElementById('pyxisAdjTotalLocations');
            const tableEl = document.getElementById('pyxisAdjTable');
            const titleEl = document.getElementById('pyxisAdjTableTitle');
            const incBtn = document.getElementById('pyxisAdjIncreaseBtn');
            const decBtn = document.getElementById('pyxisAdjDecreaseBtn');
            const sortBtn = document.getElementById('pyxisAdjSortToggle');
            if (!barsEl || !totalEl || !tableEl || !titleEl || !incBtn || !decBtn || !sortBtn) return;

            const validView = (window.__pyxisAdjViewMode === 'decrease') ? 'decrease' : 'increase';
            const validSort = (window.__pyxisAdjSortMode === 'alpha') ? 'alpha' : 'impact';
            window.__pyxisAdjViewMode = validView;
            window.__pyxisAdjSortMode = validSort;

            const useEl = sortBtn.querySelector('use');
            if (useEl) useEl.setAttribute('href', validSort === 'impact' ? '#icon-sort-impact' : '#icon-sort-a');
            sortBtn.title = validSort === 'impact' ? 'Sort by impact' : 'Sort A→Z';
            incBtn.classList.toggle('active', validView === 'increase');
            decBtn.classList.toggle('active', validView === 'decrease');

            const data = buildPyxisAdjustmentData(mockData || {}, validView);
            totalEl.textContent = String(data.impactedLocationCount || 0);

            const sortedMains = data.mainRows.slice().sort((a, b) => {
                if (validSort === 'alpha') return String(a.mainLocation).localeCompare(String(b.mainLocation));
                return (b.impactedPairsCount - a.impactedPairsCount) || String(a.mainLocation).localeCompare(String(b.mainLocation));
            });

            const mainSet = new Set(sortedMains.map(r => r.mainLocation));
            if (!window.__pyxisAdjSelectedMain || !mainSet.has(window.__pyxisAdjSelectedMain)) {
                window.__pyxisAdjSelectedMain = sortedMains.length ? sortedMains[0].mainLocation : null;
            }

            barsEl.innerHTML = '';
            if (!sortedMains.length) {
                barsEl.innerHTML = '<div class="pyxis-adj-empty">No impacted locations for this view.</div>';
            } else {
                for (const row of sortedMains) {
                    const barBtn = document.createElement('button');
                    barBtn.type = 'button';
                    barBtn.className = 'pyxis-adj-bar';
                    if (row.mainLocation === window.__pyxisAdjSelectedMain) barBtn.classList.add('selected');
                    const heightPct = data.maxBarCount > 0 ? Math.max(8, Math.round((row.impactedPairsCount / data.maxBarCount) * 100)) : 8;
                    barBtn.innerHTML = '<span class="pyxis-adj-bar-col" style="height:' + heightPct + '%"></span>' +
                        '<span class="pyxis-adj-bar-label">' + escapeHtml(row.mainLocation) + '</span>' +
                        '<span class="pyxis-adj-bar-value">' + (Number(row.impactedPairsCount) || 0).toLocaleString() + '</span>';
                    barBtn.addEventListener('click', () => {
                        window.__pyxisAdjSelectedMain = row.mainLocation;
                        renderPyxisAdjustmentOverviewCard(mockData);
                    });
                    barsEl.appendChild(barBtn);
                }
            }

            const active = sortedMains.find(r => r.mainLocation === window.__pyxisAdjSelectedMain) || null;
            titleEl.textContent = active ? ('Sublocations • ' + active.mainLocation) : 'Select a location';

            const tbody = tableEl.querySelector('tbody');
            if (!tbody) return;
            if (!active) {
                tbody.innerHTML = '<tr><td colspan="3">No impacted sublocations.</td></tr>';
                return;
            }

            const rows = Array.from(active.bySubloc.values()).map(r => ({
                sublocation: r.sublocation,
                impactedCount: r.impactedItemCodes.size,
                dailyDispense: Number(r.dailyDispense) || 0
            }));
            rows.sort((a, b) => {
                if (validSort === 'alpha') return String(a.sublocation).localeCompare(String(b.sublocation));
                return (b.impactedCount - a.impactedCount) || String(a.sublocation).localeCompare(String(b.sublocation));
            });

            const arrow = validView === 'increase' ? '↑' : '↓';
            tbody.innerHTML = rows.length ? rows.map(r => ('<tr>' +
                '<td>' + escapeHtml(r.sublocation) + '</td>' +
                '<td>' + (Number.isFinite(r.dailyDispense) ? r.dailyDispense.toFixed(2) : '0.00') + '</td>' +
                '<td class="pyxis-adj-min-arrow">' + arrow + '</td>' +
                '</tr>')).join('') : '<tr><td colspan="3">No impacted sublocations.</td></tr>';

            if (!sortBtn.dataset.bound) {
                sortBtn.dataset.bound = '1';
                sortBtn.addEventListener('click', () => {
                    window.__pyxisAdjSortMode = window.__pyxisAdjSortMode === 'impact' ? 'alpha' : 'impact';
                    try { localStorage.setItem('pyxisAdjSortMode', window.__pyxisAdjSortMode); } catch (_) {}
                    renderPyxisAdjustmentOverviewCard(window.__latestComputedMockData || mockData || {});
                });
            }
            if (!incBtn.dataset.bound) {
                incBtn.dataset.bound = '1';
                incBtn.addEventListener('click', () => {
                    window.__pyxisAdjViewMode = 'increase';
                    try { localStorage.setItem('pyxisAdjViewMode', 'increase'); } catch (_) {}
                    renderPyxisAdjustmentOverviewCard(window.__latestComputedMockData || mockData || {});
                });
            }
            if (!decBtn.dataset.bound) {
                decBtn.dataset.bound = '1';
                decBtn.addEventListener('click', () => {
                    window.__pyxisAdjViewMode = 'decrease';
                    try { localStorage.setItem('pyxisAdjViewMode', 'decrease'); } catch (_) {}
                    renderPyxisAdjustmentOverviewCard(window.__latestComputedMockData || mockData || {});
                });
            }
        }
        
        function calculatePyxisMetrics(mockData) {
            console.log('🔢 Calculating Pyxis Metrics...');

            // Local helper (this file is loaded standalone on some pages)
            function safeNumber(v, fallback) {
                const n = (typeof v === 'number') ? v : parseFloat(v);
                return Number.isFinite(n) ? n : fallback;
            }

            if (!mockData || !Array.isArray(mockData.items)) {
                console.warn('⚠️ No mock data available for Pyxis metrics');
                return {
                    totals: { stockOuts: 0, waste: 0, unused: 0, overLoad: 0 },
                    raw: { stockOuts: [], waste: [], unused: [], overLoad: [] },
                    byLocation: {}
                };
            }

            const metrics = {
                stockOuts: [],
                waste: [],
                unused: [],
                overLoad: []
            };

            const inventoryByCode = (mockData.inventory && typeof mockData.inventory === 'object') ? mockData.inventory : {};
            const inactivityMap = (mockData.computed && mockData.computed.inactivityRisk && mockData.computed.inactivityRisk.byItemSubloc)
                ? mockData.computed.inactivityRisk.byItemSubloc
                : null;

            // Daily usage projection cache (units/day) — aligns with the usage projection used elsewhere
            // (e.g., expiry-based waste projection). Falls back to weekly/7.
            const dailyUsageByCode = Object.create(null);
            try {
                for (const it of (mockData.items || [])) {
                    const code = (it && it.itemCode != null) ? String(it.itemCode).trim() : '';
                    if (!code) continue;
                    const daily = (it._cachedDailyUsage != null) ? Number(it._cachedDailyUsage) || 0
                        : ((it._cachedWeeklyUsage != null) ? (Number(it._cachedWeeklyUsage) || 0) / 7 : 0);
                    dailyUsageByCode[code] = Math.max(0, daily);
                }
            } catch (e) {
                console.warn('⚠️ Pyxis metrics: failed building daily usage cache', e);
            }

            mockData.items.forEach(item => {
                const itemCode = String(item.itemCode ?? '');
                if (!itemCode) return;

                const drugName = String(item.drugName ?? item.description ?? '');
                const unitPrice = safeNumber(item.unitPrice ?? item.unitCost ?? item.costPerUnit, 0);

                const invEntry = inventoryByCode[itemCode] || {};
                const sublocations = Array.isArray(invEntry.sublocations) ? invEntry.sublocations : [];

                // Derived flags across sublocations
                let anyOverLoad = false;
                const dailyUsage = dailyUsageByCode[itemCode] || 0; // units/day

                sublocations.forEach(subloc => {
                    const sub = subloc || {};
                    const sublocCode = String(sub.sublocation ?? sub.location ?? '');
                    const locationInfo = (getSublocationMap()[sublocCode] || { mainLocation: sublocCode, department: 'Unknown' });

                    const curQty = safeNumber(sub.curQty ?? sub.qty ?? 0, 0);
                    const minQty = safeNumber(sub.minQty ?? 0, 0);
                    const maxQty = safeNumber(sub.maxQty ?? 0, 0);

                    // Stock-out risk (projection-based): locations where min level is below projected daily usage.
                    // Interpretation: at min, the location would not cover even one day of demand.
                    if (dailyUsage > 0 && minQty > 0 && minQty < dailyUsage) {
                        metrics.stockOuts.push({
                            itemCode,
                            drugName,
                            sublocation: sublocCode,
                            mainLocation: locationInfo.mainLocation,
                            department: locationInfo.department,
                            minQty,
                            curQty,
                            dailyUsage,
                            daysOfCoverAtMin: (dailyUsage > 0 ? (minQty / dailyUsage) : 0)
                        });
                    }

                    // Overload: > 130% of max
                    if (maxQty > 0 && curQty > (maxQty * 1.3)) {
                        anyOverLoad = true;
                    }

                    // Unused/inactivity risk (per sublocation)
                    if (inactivityMap && inactivityMap[itemCode] && sublocCode && inactivityMap[itemCode][sublocCode]) {
                        const riskObj = inactivityMap[itemCode][sublocCode];
                        const riskCategory = riskObj && riskObj.riskCategory ? riskObj.riskCategory : 'Normal inactivity';
                        if (riskCategory === 'High risk' || riskCategory === 'Very high risk') {
                            metrics.unused.push({
                                itemCode,
                                drugName,
                                sublocation: sublocCode,
                                mainLocation: locationInfo.mainLocation,
                                department: locationInfo.department,
                                qty: curQty,
                                unitPrice,
                                cost: curQty * safeNumber(unitPrice, 0),
                                standard: !!sub.standard,
                                currentStreak: safeNumber(riskObj.currentStreak, 0),
                                zScore: safeNumber(riskObj.zScore, 0),
                                riskCategory,
                                explanation: riskObj.explanation || ''
                            });
                        }
                    }

                    // Overload details row (keep per sublocation)
                    if (maxQty > 0 && curQty > (maxQty * 1.3)) {
                        metrics.overLoad.push({
                            itemCode,
                            drugName,
                            sublocation: sublocCode,
                            mainLocation: locationInfo.mainLocation,
                            department: locationInfo.department,
                            curQty,
                            minQty,
                            maxQty,
                            overagePercent: ((curQty / maxQty) * 100).toFixed(1),
                            overageQty: curQty - maxQty,
                            unitPrice,
                            overageCost: (curQty - maxQty) * safeNumber(unitPrice, 0)
                        });
                    }
                });

                // Waste (item-level): prefer precomputed projected waste fields if present
                const projectedWasteValue = safeNumber(item.projectedWasteValue ?? item.wasteValue ?? 0, 0);
                if (projectedWasteValue > 0) {
                    metrics.waste.push({
                        itemCode,
                        drugName,
                        totalWaste: projectedWasteValue,
                        costPerUnit: unitPrice,
                        wasteCost: projectedWasteValue.toFixed(2),
                        sublocations: sublocations.map(subloc => ({
                            sublocation: subloc.sublocation,
                            mainLocation: ((getSublocationMap()[subloc.sublocation] || {}).mainLocation) || subloc.sublocation,
                            curQty: subloc.curQty || 0,
                            minQty: subloc.minQty || 0,
                            maxQty: subloc.maxQty || 0
                        }))
                    });
                }
            });

            const byLocation = {
                stockOuts: groupByLocation(metrics.stockOuts),
                waste: groupByLocation(metrics.waste),
                unused: groupBySublocation(metrics.unused),
                overLoad: groupByLocation(metrics.overLoad)
            };

            const totals = {
                stockOuts: metrics.stockOuts.length,
                waste: metrics.waste.length,
                unused: metrics.unused.length,
                overLoad: metrics.overLoad.length
            };

            console.log('✅ Pyxis Metrics calculated:', totals);
            return { totals, raw: metrics, byLocation };
        }

        function groupByLocation(items) {
            const grouped = {};
            items.forEach(item => {
                const location = item.mainLocation || item.sublocations?.[0]?.mainLocation || 'Unknown';
                if (!grouped[location]) grouped[location] = [];
                grouped[location].push(item);
            });
            return grouped;
        }

        function groupBySublocation(items) {
            const grouped = new Map();
            for (const it of (items || [])) {
                const key = it.sublocation || 'UNKNOWN';
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(it);
            }
            // Sort groups by key
            const out = Array.from(grouped.entries())
                .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
                .map(([key, arr]) => ({ group: key, items: arr }));
            return out;
        }

        // ============= SCROLL ARROW SYSTEM =============
        
        function updateScrollArrows() {
            const contentContainer = document.querySelector('.analytics-content');
            const upArrow = document.getElementById('scrollArrowUp');
            const downArrow = document.getElementById('scrollArrowDown');
            
            if (contentContainer && upArrow && downArrow) {
                const scrollTop = contentContainer.scrollTop;
                const scrollHeight = contentContainer.scrollHeight;
                const clientHeight = contentContainer.clientHeight;
                const scrollBottom = scrollHeight - scrollTop - clientHeight;
                
                // Only show arrows if content is actually scrollable
                const isScrollable = scrollHeight > clientHeight + 5;
                
                if (isScrollable) {
                    // Show up arrow if there's content above (with 5px threshold)
                    if (scrollTop > 5) {
                        upArrow.classList.add('visible');
                        upArrow.classList.remove('hidden');
                    } else {
                        upArrow.classList.remove('visible');
                        upArrow.classList.add('hidden');
                    }
                    
                    // Show down arrow if there's content below (with 5px threshold)
                    if (scrollBottom > 5) {
                        downArrow.classList.add('visible');
                        downArrow.classList.remove('hidden');
                    } else {
                        downArrow.classList.remove('visible');
                        downArrow.classList.add('hidden');
                    }
                } else {
                    // Hide both arrows if not scrollable
                    upArrow.classList.remove('visible');
                    upArrow.classList.add('hidden');
                    downArrow.classList.remove('visible');
                    downArrow.classList.add('hidden');
                }
            }
        }
        
        function initScrollArrows() {
            console.log('🎯 Initializing Analytics scroll arrows...');
            
            const contentContainer = document.querySelector('.analytics-content');
            const upArrow = document.getElementById('scrollArrowUp');
            const downArrow = document.getElementById('scrollArrowDown');
            
            // Function to get card row positions
            function getCardRowPositions() {
                const cards = Array.from(document.querySelectorAll('.analytics-card, .chart-card'));
                if (cards.length === 0) return [];
                
                const rowPositions = [];
                let currentRowY = null;
                
                cards.forEach(card => {
                    const rect = card.getBoundingClientRect();
                    const cardTop = rect.top + contentContainer.scrollTop - contentContainer.getBoundingClientRect().top;
                    
                    // Check if this card starts a new row (different Y position)
                    if (currentRowY === null || Math.abs(cardTop - currentRowY) > 10) {
                        currentRowY = cardTop;
                        rowPositions.push(cardTop);
                    }
                });
                
                return rowPositions;
            }
            
            // Function to find the next/previous row position
            function getTargetScrollPosition(direction) {
                const rowPositions = getCardRowPositions();
                if (rowPositions.length === 0) return null;
                
                const currentScroll = contentContainer.scrollTop;
                const containerTop = contentContainer.getBoundingClientRect().top;
                
                if (direction === 'up') {
                    // Find the previous row (first row above current position)
                    for (let i = rowPositions.length - 1; i >= 0; i--) {
                        if (rowPositions[i] < currentScroll - 10) {
                            return rowPositions[i];
                        }
                    }
                    // If no previous row, go to top
                    return 0;
                } else {
                    // Find the next row (first row below current position + some threshold)
                    for (let i = 0; i < rowPositions.length; i++) {
                        if (rowPositions[i] > currentScroll + 50) {
                            return rowPositions[i];
                        }
                    }
                    // If no next row, go to bottom
                    return contentContainer.scrollHeight;
                }
            }
            
            if (contentContainer && upArrow && downArrow) {
                // Click handlers with smooth scroll to card rows
                upArrow.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const targetScroll = getTargetScrollPosition('up');
                    if (targetScroll !== null) {
                        contentContainer.scrollTo({ 
                            top: targetScroll, 
                            behavior: 'smooth' 
                        });
                    }
                    
                    // Update arrows after scroll completes
                    setTimeout(updateScrollArrows, 400);
                });
                
                downArrow.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const targetScroll = getTargetScrollPosition('down');
                    if (targetScroll !== null) {
                        contentContainer.scrollTo({ 
                            top: targetScroll, 
                            behavior: 'smooth' 
                        });
                    }
                    
                    // Update arrows after scroll completes
                    setTimeout(updateScrollArrows, 400);
                });
                
                // Use passive scroll listener for better performance
                contentContainer.addEventListener('scroll', updateScrollArrows, { passive: true });
                
                // Update on window resize
                window.addEventListener('resize', updateScrollArrows, { passive: true });
                
                console.log('✓ Analytics scroll arrows initialized');
                
                // Initial update with multiple attempts
                setTimeout(() => {
                    updateScrollArrows();
                    console.log('✓ Initial scroll arrows update (100ms)');
                }, 100);
                
                setTimeout(() => {
                    updateScrollArrows();
                    console.log('✓ Secondary scroll arrows update (500ms)');
                }, 500);
                
                setTimeout(() => {
                    updateScrollArrows();
                    console.log('✓ Tertiary scroll arrows update (1000ms)');
                }, 1000);
            }
        }
        
        // ============= END SCROLL ARROW SYSTEM =============
        
        // ==================================================================================
        // DATA REQUEST FROM PARENT DASHBOARD
        // ==================================================================================
        // This page requests pharmaceutical data from the parent Dashboard via postMessage
        
        let cachedMockData = null;
        let dataRequestCallbacks = [];
        let itemStatusOverlayPromise = null;

        function getItemStatusSheetConfig() {
            const webAppUrl = String((window.ITEM_STATUS_WEBAPP_URL || localStorage.getItem('itemStatusWebAppUrl') || localStorage.getItem('spike_webAppUrl') || '')).trim();
            const sheetId = String((window.ITEM_STATUS_SHEET_ID || localStorage.getItem('itemStatusSheetId') || localStorage.getItem('spike_sheetId') || localStorage.getItem('gs_sheetId') || '')).trim();
            return { webAppUrl, sheetId, tabName: 'itemStatus' };
        }

        function parseItemStatusRows(raw) {
            if (Array.isArray(raw)) return raw;
            if (!raw || typeof raw !== 'object') return [];
            return raw.rows || raw.items || raw.data || raw.values || (raw.result && (raw.result.rows || raw.result.items || raw.result.values)) || [];
        }

        function getItemStatusField(row, keys) {
            if (!row || typeof row !== 'object') return '';
            const keyMap = {};
            Object.keys(row).forEach((k) => { keyMap[String(k).trim().toLowerCase()] = row[k]; });
            for (let i = 0; i < keys.length; i++) {
                const v = keyMap[String(keys[i]).trim().toLowerCase()];
                if (v !== undefined && v !== null) return v;
            }
            return '';
        }

        function mergeItemStatusIntoData(data, rawRows) {
            if (!data || !Array.isArray(data.items)) return data;

            function normalizeCode(v) {
                const raw = String(v || '').trim();
                if (!raw) return '';
                if (/^\d+$/.test(raw)) return String(Number(raw));
                return raw;
            }

            function newerByDate(current, candidate) {
                if (!current) return candidate;
                const curDate = Date.parse(String(current.date || current.updatedAt || ''));
                const canDate = Date.parse(String(candidate.date || candidate.updatedAt || ''));
                if (Number.isFinite(canDate) && !Number.isFinite(curDate)) return candidate;
                if (Number.isFinite(canDate) && Number.isFinite(curDate) && canDate >= curDate) return candidate;
                return current;
            }

            const sheetByCode = new Map();
            if (Array.isArray(rawRows)) {
                rawRows.forEach((row) => {
                    if (!row || typeof row !== 'object') return;
                    const code = normalizeCode(getItemStatusField(row, ['itemCode', 'item_code', 'code']));
                    if (!code) return;
                    const filePath = String(getItemStatusField(row, ['filePath', 'file_path']) || '');
                    const candidate = {
                        source: 'sheet',
                        date: String(getItemStatusField(row, ['date', 'updatedAt', 'updated_at', 'timestamp']) || ''),
                        updatedAt: String(getItemStatusField(row, ['updatedAt', 'updated_at', 'timestamp']) || ''),
                        status: String(getItemStatusField(row, ['status']) || ''),
                        ETA: String(getItemStatusField(row, ['etaDate', 'eta_date', 'eta']) || ''),
                        filePath,
                        notes: String(getItemStatusField(row, ['notes']) || ''),
                        assessment: String(getItemStatusField(row, ['SBARnotes', 'sbarNotes', 'assessment']) || ''),
                        SBAR: !!filePath.trim()
                    };
                    sheetByCode.set(code, newerByDate(sheetByCode.get(code), candidate));
                });
            }

            data.items.forEach((item) => {
                if (!item) return;
                const codeKeys = [normalizeCode(item.itemCode), normalizeCode(item.alt_itemCode || item.altItemCode)].filter(Boolean);
                if (!codeKeys.length) return;

                let agg = null;
                for (let i = 0; i < codeKeys.length; i++) {
                    const k = codeKeys[i];
                    if (sheetByCode.has(k)) {
                        agg = sheetByCode.get(k);
                        break;
                    }
                }
                item.status = String((agg && agg.status) || '');
                item.ETA = String((agg && agg.ETA) || '');
                item.filePath = String((agg && agg.filePath) || '');
                item.notes = String((agg && agg.notes) || '');
                item.assessment = String((agg && agg.assessment) || '');
                item.SBAR = !!(agg && agg.SBAR) || !!String(item.filePath || '').trim();
            });

            return data;
        }

        function fetchItemStatusRowsJsonp(cfg) {
            return new Promise((resolve) => {
                const callbackName = '__analyticsItemStatusCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                const cleanUrl = String(cfg.webAppUrl || '').replace(/\/+$/, '');
                const url = `${cleanUrl}?action=itemStatusRead&sheetId=${encodeURIComponent(cfg.sheetId)}&tabName=${encodeURIComponent(cfg.tabName)}&callback=${encodeURIComponent(callbackName)}`;
                const script = document.createElement('script');
                let done = false;
                const finish = (rows) => {
                    if (done) return;
                    done = true;
                    try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
                    if (script.parentNode) script.parentNode.removeChild(script);
                    resolve(Array.isArray(rows) ? rows : []);
                };
                window[callbackName] = function(payload) { finish(parseItemStatusRows(payload)); };
                script.async = true;
                script.src = url;
                script.onerror = () => finish([]);
                document.head.appendChild(script);
                setTimeout(() => finish([]), 5000);
            });
        }

        async function ensureItemStatusOverlayLoaded() {
            if (!cachedMockData || !Array.isArray(cachedMockData.items)) return cachedMockData;
            const cfg = getItemStatusSheetConfig();
            if (!cfg.webAppUrl || !cfg.sheetId) return cachedMockData;
            if (!itemStatusOverlayPromise) {
                itemStatusOverlayPromise = (async () => {
                    try {
                        const cleanUrl = String(cfg.webAppUrl || '').replace(/\/+$/, '');
                        const url = `${cleanUrl}?action=itemStatusRead&sheetId=${encodeURIComponent(cfg.sheetId)}&tabName=${encodeURIComponent(cfg.tabName)}`;
                        const resp = await fetch(url, { method: 'GET' });
                        if (!resp.ok) throw new Error('HTTP ' + resp.status);
                        const payload = await resp.json();
                        cachedMockData = mergeItemStatusIntoData(cachedMockData, parseItemStatusRows(payload));
                        return cachedMockData;
                    } catch (err) {
                        const rows = await fetchItemStatusRowsJsonp(cfg);
                        cachedMockData = mergeItemStatusIntoData(cachedMockData, rows);
                        return cachedMockData;
                    }
                })();
            }
            return itemStatusOverlayPromise;
        }
        
        /**
         * Request mock data from parent Dashboard container
         * @returns {Promise} Promise that resolves with the mock data
         */
        function requestMockDataFromParent() {
            return new Promise((resolve, reject) => {
                if (cachedMockData) {
                    ensureItemStatusOverlayLoaded().then(() => resolve(cachedMockData));
                    return;
                }

                // Prefer shared helper (supports {raw, computed} payload)
                if (window.InventoryApp && window.InventoryApp.postMessage && window.InventoryApp.postMessage.requestMockData) {
                    window.InventoryApp.postMessage.requestMockData(({ computed }) => {
                        const fallback = { lastUpdated: new Date().toISOString().split('T')[0], items: [] };
                        cachedMockData = computed || fallback;
                        itemStatusOverlayPromise = null;
                        window.mockData = cachedMockData;
                        ensureItemStatusOverlayLoaded().then(() => resolve(cachedMockData));
                    });
                    return;
                }

                // Legacy fallback
                dataRequestCallbacks.push({ resolve, reject });
                if (dataRequestCallbacks.length === 1) {
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: 'requestMockData' }, '*');
                        setTimeout(() => {
                            if (!cachedMockData && dataRequestCallbacks.length > 0) {
                                const fallbackData = { lastUpdated: new Date().toISOString().split('T')[0], items: [] };
                                cachedMockData = fallbackData;
                                dataRequestCallbacks.forEach(cb => cb.resolve(fallbackData));
                                dataRequestCallbacks = [];
                            }
                        }, 3000);
                    } else {
                        const error = new Error('Not in iframe context');
                        dataRequestCallbacks.forEach(cb => cb.reject(error));
                        dataRequestCallbacks = [];
                    }
                }
            });
        }
        
        /**
         * Get mock data synchronously (returns cached data or null if not loaded yet)
         * @returns {Object|null} The cached mock data or null
         */
        function getMockData() {
            if (cachedMockData) {
                return cachedMockData;
            }
            console.warn('⚠️ Analytics: Mock data not loaded yet. Use requestMockDataFromParent() instead.');
            return null;
        
        // ==================================================================================
        }

        // WASTE MONTHLY PROJECTION (Expiry-based, matches Charts vertical bar Outlook logic)
        // ==================================================================================
        // PERF/MEMOIZATION (v69): layered memoization for waste projection
        //  A) Whole-projection cache
        //  B) Per-item FIFO depletion cache
        //  C) Layered caching (B feeds A)
        //
        //  Guardrails:
        //   - deterministic + explainable
        //   - do NOT mutate cached arrays/maps
        //   - invalidate caches when mockData changes
        function __ensureProjectionStore(){
            try{
                if (!window.InventoryApp) window.InventoryApp = {};
                if (!window.InventoryApp.ProjectionStore) window.InventoryApp.ProjectionStore = {};
                const s = window.InventoryApp.ProjectionStore;
                if (!s._waste) s._waste = {
                    token: null,
                    projByKey: new Map(),
                    itemByKey: new Map(),
                    stats: { projHits:0, projMiss:0, itemHits:0, itemMiss:0 }
                };
                return s._waste;
            } catch(e){
                if (!window.__WASTE_PROJ_STORE__) window.__WASTE_PROJ_STORE__ = { token:null, projByKey:new Map(), itemByKey:new Map(), stats:{projHits:0,projMiss:0,itemHits:0,itemMiss:0} };
                return window.__WASTE_PROJ_STORE__;
            }
        }
        function __stableTokenFromMockData(md){
            try{
                const t = md && (md.lastUpdated || md.last_update || md.updatedAt || md.generatedAt);
                if (t) return String(t);
            } catch(e){}
            try{
                const items = Array.isArray(md && md.items) ? md.items : [];
                const inv = (md && md.inventory && typeof md.inventory === 'object') ? md.inventory : null;
                const invCodes = inv ? Object.keys(inv) : [];
                const sample = [];
                for (let i=0;i<items.length && sample.length<3;i++){
                    const it = items[i]||{};
                    const c = (it.itemCode!=null)?String(it.itemCode).trim():'';
                    if (c) sample.push(c);
                }
                return ['items', items.length, 'inv', invCodes.length, 's', sample.join(',')].join('|');
            } catch(e){}
            return 'unknown';
        }
        function __round6(n){ const x = Number(n)||0; return Math.round(x*1e6)/1e6; }
        function __lotsSig(lots){
            try{
                if (!Array.isArray(lots) || !lots.length) return '0';
                const n = lots.length;
                const a = lots[0];
                const m = lots[Math.floor(n/2)];
                const z = lots[n-1];
                const f = (o)=>`${o.expISO||''}:${Math.round((Number(o.qty)||0)*1000)/1000}:${String(o.loc||'').slice(0,24)}`;
                return `${n}|${f(a)}|${f(m)}|${f(z)}`;
            } catch(e){
                return String((lots&&lots.length)||0);
            }
        }
        function __cloneProjection(p){
            try { return structuredClone(p); }
            catch(e) { return JSON.parse(JSON.stringify(p)); }
        }

        function _pad2(n){ return (n<10?'0':'')+n; }
        function _isoDay(d){ return d.getFullYear()+'-'+_pad2(d.getMonth()+1)+'-'+_pad2(d.getDate()); }
        function _parseISODate(iso){
            if (!iso || typeof iso !== 'string') return null;
            const s = iso.slice(0,10);
            const m = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
            if (!m) return null;
            // Use local date to avoid TZ shift
            const parts = s.split('-').map(Number);
            const d = new Date(parts[0], parts[1]-1, parts[2], 0,0,0,0);
            return isNaN(d.getTime()) ? null : d;
        }
        function _monthKey(d){ return d.getFullYear()+'-'+_pad2(d.getMonth()+1); }
        function _monthLabel(d){
            return d.toLocaleString('en-US',{month:'short'}).toUpperCase();
        }
        function _daysBetween(a,b){
            const ms = 24*60*60*1000;
            const da = new Date(a.getFullYear(),a.getMonth(),a.getDate(),0,0,0,0);
            const db = new Date(b.getFullYear(),b.getMonth(),b.getDate(),0,0,0,0);
            return Math.round((db-da)/ms);
        }
        function _parseLocAndSubloc(loc){
            const raw = String(loc||'').trim();
            if (!raw) return { location:'(unknown)', sublocation:'(unknown)' };
            // Common patterns: "AREA | BIN", "AREA - BIN", "AREA: BIN"
            let parts = raw.split('|').map(s=>s.trim()).filter(Boolean);
            if (parts.length >= 2) return { location: parts[0], sublocation: parts.slice(1).join(' | ') };
            parts = raw.split(' - ').map(s=>s.trim()).filter(Boolean);
            if (parts.length >= 2) return { location: parts[0], sublocation: parts.slice(1).join(' - ') };
            parts = raw.split(':').map(s=>s.trim()).filter(Boolean);
            if (parts.length >= 2) return { location: parts[0], sublocation: parts.slice(1).join(':') };
            return { location: raw, sublocation: raw };
        }

        /**
         * Build 12-month expiry-based waste projection (cost + qty), grouped by month.
         * Uses:
         *  - mockData.inventory[code][loc] => { qty, expires/expiration/expiry }
         *  - mockData.items => unit cost + cached daily usage (from Compute/Option B)
         *
         * Output also includes sublocation rollups (prep for Pyxis metric card).
         */
        
        function buildWasteMonthlyProjection(mockData, months=12){
            try{
                if (!mockData) return null;
                const inventoryRoot = (mockData.inventory && typeof mockData.inventory === 'object') ? mockData.inventory : null;
                const items = Array.isArray(mockData.items) ? mockData.items : [];
                if (!inventoryRoot || !items.length) return null;

                const today = new Date();
                today.setHours(0,0,0,0);

                const start = new Date(today.getFullYear(), today.getMonth(), 1, 0,0,0,0);
                const endMonth = new Date(start.getFullYear(), start.getMonth()+months, 1, 0,0,0,0); // exclusive

                // Memoization: whole projection
                const __store = __ensureProjectionStore();
                const __token = __stableTokenFromMockData(mockData);
                if (__store.token !== __token){
                    __store.token = __token;
                    __store.projByKey.clear();
                }
                const __projKey = ['A', __token, _monthKey(start), String(months)].join('|');
                const __cachedProj = __store.projByKey.get(__projKey);
                if (__cachedProj){
                    __store.stats.projHits++;
                    return __cloneProjection(__cachedProj);
                }
                __store.stats.projMiss++;

                // Build per-item maps (unit cost + cached daily usage)
                const unitCostByCode = Object.create(null);
                const dailyUsageByCode = Object.create(null);

                for (let i=0;i<items.length;i++){
                    const it = items[i] || {};
                    const code = (it.itemCode!=null) ? String(it.itemCode).trim() : '';
                    if (!code) continue;
                    const unit = parseFloat(it.unitPrice || it.unitCost || it.costPerUnit || it.gpoPrice || it.wacPrice || 0) || 0;
                    unitCostByCode[code] = unit;

                    const daily = (it._cachedDailyUsage!=null) ? (Number(it._cachedDailyUsage)||0)
                        : ((it._cachedWeeklyUsage!=null) ? (Number(it._cachedWeeklyUsage)||0)/7 : 0);
                    dailyUsageByCode[code] = Math.max(0, daily);
                }

                // Pocket-level daily usage: code -> subloc -> daily usage (units/day)
                const dailyUsageByPocket = Object.create(null);

                (function buildPocketUsage(){
                    try{
                        const N_DAYS = 14;
                        const endD = new Date(today);
                        const startD = new Date(endD);
                        startD.setDate(startD.getDate() - (N_DAYS-1));
                        startD.setHours(0,0,0,0);

                        const txRoot =
                            (mockData && (mockData.transactions || mockData.tx || mockData.transactionHistory || mockData.transactionMap)) ||
                            (typeof window !== 'undefined' && (window.TRANSACTION_2026_01 || window.TRANSACTIONS_2026_01 || window.TRANSACTION_DATA || window.TRANSACTIONS)) ||
                            null;

                        if (!txRoot) return;

                        const ensureCode = (code)=>{
                            if (!dailyUsageByPocket[code]) dailyUsageByPocket[code] = Object.create(null);
                            return dailyUsageByPocket[code];
                        };

                        const addTx = (code, subloc, qtyAbs)=>{
                            const bucket = ensureCode(code);
                            bucket[subloc] = (bucket[subloc] || 0) + qtyAbs;
                        };

                        const isDispense = (t)=>{
                            const typ = String(t.transactionType||t.type||'').toLowerCase();
                            return (typ.includes('dispense') || typ.includes('unload'));
                        };

                        const readQtyAbs = (t)=>{
                            const rawQty = (t.transQty ?? t.TransQty ?? t.qty ?? t.Qty ?? 0);
                            return Math.abs(parseFloat(rawQty) || 0);
                        };

                        const readDate = (t)=>{
                            return _parseISODate(String(t.transDate||t.date||t.trans_date||'').slice(0,10));
                        };

                        const readSubloc = (t)=>{
                            return String(t.sublocation || t.subLocation || t.sub_loc || '').trim();
                        };

                        if (Array.isArray(txRoot)){
                            for (let i=0;i<txRoot.length;i++){
                                const t = txRoot[i] || {};
                                const code = (t.itemCode!=null)?String(t.itemCode).trim():'';
                                if (!code) continue;
                                const d = readDate(t);
                                if (!d || d < startD || d > endD) continue;
                                const subloc = readSubloc(t);
                                if (!subloc) continue;
                                if (!isDispense(t)) continue;
                                const q = readQtyAbs(t);
                                if (!q) continue;
                                addTx(code, subloc, q);
                            }
                        } else {
                            const codes = Object.keys(txRoot);
                            for (let ci=0; ci<codes.length; ci++){
                                const code = String(codes[ci]).trim();
                                if (!code) continue;
                                const node = txRoot[code];
                                if (!node) continue;
                                const hist = Array.isArray(node) ? node : (Array.isArray(node.history) ? node.history : []);
                                if (!hist.length) continue;

                                for (let hi=0; hi<hist.length; hi++){
                                    const t = hist[hi] || {};
                                    const d = readDate(t);
                                    if (!d || d < startD || d > endD) continue;
                                    const subloc = readSubloc(t);
                                    if (!subloc) continue;
                                    if (!isDispense(t)) continue;
                                    const q = readQtyAbs(t);
                                    if (!q) continue;
                                    addTx(code, subloc, q);
                                }
                            }
                        }

                        // Convert totals to daily usage
                        const codes2 = Object.keys(dailyUsageByPocket);
                        for (let i=0;i<codes2.length;i++){
                            const code = codes2[i];
                            const m = dailyUsageByPocket[code];
                            const ks = Object.keys(m);
                            for (let j=0;j<ks.length;j++){
                                const sub = ks[j];
                                m[sub] = Math.max(0, (Number(m[sub])||0) / N_DAYS);
                            }
                        }
                    } catch(e){}
                })();

                const monthAgg = Object.create(null); // monthKey -> {cost, qty, codes:Set, bySublocation:{}}
                function ensureMonth(mk, dForLabel){
                    if (!monthAgg[mk]){
                        monthAgg[mk] = { monthKey: mk, label: _monthLabel(dForLabel), cost:0, qty:0, codes:new Set(), bySublocation:Object.create(null) };
                    }
                    return monthAgg[mk];
                }

                // Iterate inventory by item code and by sublocation (pocket)
                const codes = Object.keys(inventoryRoot);
                for (let ci=0;ci<codes.length;ci++){
                    const code = String(codes[ci]).trim();
                    if (!code) continue;
                    const invByLoc = inventoryRoot[code];
                    if (!invByLoc || typeof invByLoc !== 'object') continue;

                    const unitCost = unitCostByCode[code] || 0;

                    const locKeys = Object.keys(invByLoc);
                    for (let li=0; li<locKeys.length; li++){
                        const loc = String(locKeys[li]).trim();
                        if (!loc) continue;

                        const rec = invByLoc[loc];
                        if (!rec) continue;

                        // Support either a single record or an array of lots
                        const lotRecs = Array.isArray(rec) ? rec : (Array.isArray(rec.lots) ? rec.lots : [rec]);

                        const lots = [];
                        for (let ri=0; ri<lotRecs.length; ri++){
                            const r = lotRecs[ri] || {};
                            const qty = Number(r.qty ?? r.quantity ?? 0) || 0;
                            const expISO = String(r.expires || r.expiration || r.expiry || '').slice(0,10);
                            if (!qty || !expISO) continue;
                            const expD = _parseISODate(expISO);
                            if (!expD) continue;
                            if (expD < start || expD >= endMonth) continue;
                            lots.push({ qty, expD, expISO });
                        }
                        if (!lots.length) continue;

                        lots.sort((a,b)=>a.expD-b.expD);

                        const pocketDaily = (dailyUsageByPocket[code] && dailyUsageByPocket[code][loc]!=null) ? (dailyUsageByPocket[code][loc]||0) : null;
                        const avgDaily = (pocketDaily!=null) ? pocketDaily : (dailyUsageByCode[code] || 0);

                        // FIFO-by-expiry depletion within this pocket
                        let cumSupply = 0;
                        for (let i=0;i<lots.length;i++){
                            const lot = lots[i];
                            cumSupply += lot.qty;

                            const daysToExpiry = Math.max(0, _daysBetween(today, lot.expD) + 1);
                            const demandUntilExpiry = avgDaily * daysToExpiry;

                            const supplyBeforeCurrent = cumSupply - lot.qty;
                            const demandAfterEarlier = Math.max(0, demandUntilExpiry - supplyBeforeCurrent);
                            const consumedFromCurrent = Math.min(lot.qty, demandAfterEarlier);
                            const leftover = Math.max(0, lot.qty - consumedFromCurrent);

                            if (leftover > 0.00001){
                                const mk = _monthKey(lot.expD);
                                const bucket = ensureMonth(mk, lot.expD);
                                bucket.qty += leftover;
                                bucket.cost += leftover * unitCost;
                                bucket.codes.add(code);

                                if (!bucket.bySublocation[loc]){
                                    bucket.bySublocation[loc] = { qty:0, cost:0, codes:new Set() };
                                }
                                bucket.bySublocation[loc].qty += leftover;
                                bucket.bySublocation[loc].cost += leftover * unitCost;
                                bucket.bySublocation[loc].codes.add(code);
                            }
                        }
                    }
                }

                // Finalize into sorted list
                const out = [];
                const keys = Object.keys(monthAgg).sort();
                for (let i=0;i<keys.length;i++){
                    const mk = keys[i];
                    const b = monthAgg[mk];
                    out.push({
                        monthKey: b.monthKey,
                        label: b.label,
                        qty: b.qty,
                        cost: b.cost,
                        itemCount: b.codes.size,
                        // Used for click-through filtering on the analytics card
                        itemCodes: Array.from(b.codes),
                        bySublocation: (function(){
                            const o = Object.create(null);
                            for (const loc of Object.keys(b.bySublocation)){
                                const v = b.bySublocation[loc];
                                o[loc] = { qty: v.qty, cost: v.cost, itemCount: v.codes.size };
                            }
                            return o;
                        })()
                    });
                }

                const __totCost = out.reduce((s,m)=>s+(_num(m.cost,0)),0);
                const __totQty = out.reduce((s,m)=>s+(_num(m.qty,0)),0);
                const result = { startISO: _isoDay(start), months, series: out, totalCost: __totCost, totalQty: __totQty };
                __store.projByKey.set(__projKey, __cloneProjection(result));
                return result;
            } catch(e){
                console.warn('⚠️ buildWasteMonthlyProjection failed', e);
                return null;
            }
        }


        function renderWasteMonthlyBars(projection){
            const chartContainer = document.getElementById('wasteMiniChart');
            if (!chartContainer) return;

            chartContainer.innerHTML = '';
            chartContainer.style.gap = '3px';

            // buildWasteMonthlyProjection returns { months: <number>, series: <array> }
            // Older code expected { months: <array> }. Use series as the month list.
            const months = (projection && Array.isArray(projection.series)) ? projection.series :
                          ((projection && Array.isArray(projection.months)) ? projection.months : []);

            if (!months.length){
                const el = document.getElementById('currentWasteCost');
                if (el) el.textContent = '$0.00';
                return;
            }

            // Simple HTML escaper for tooltip content
            const esc = (s)=>String(s??'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

            const maxVal = Math.max(1, ...months.map(m=>m.cost||0));
            const containerWidth = chartContainer.clientWidth || 600;
            const totalBars = months.length;
            const targetBarRatio = 0.82;
            const colWidth = Math.max(14, Math.floor((containerWidth * targetBarRatio) / totalBars));
            const gap = totalBars>1 ? Math.max(2, Math.floor((containerWidth * (1-targetBarRatio)) / (totalBars-1))) : 0;
            chartContainer.style.gap = gap + 'px';

            for (let i=0;i<months.length;i++){
                const m = months[i];

                const col = document.createElement('div');
                col.className = 'waste-bar-col';
                col.style.width = colWidth + 'px';

                const barWrap = document.createElement('div');
                barWrap.className = 'waste-bar-wrap';

                const bar = document.createElement('div');
                bar.className = 'waste-bar';
                if (i===0) bar.classList.add('current'); // current month
                const h = ((m.cost||0) / maxVal) * 100;
                bar.style.height = Math.max(h, 3) + '%';
                bar.style.width = '100%';

                // Tooltip (includes top sublocations by cost)
                const tooltip = document.createElement('div');
                tooltip.className = 'waste-bar-tooltip';

                const costTxt = '$' + (m.cost||0).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
                const qtyTxt = (m.qty||0).toLocaleString('en-US',{maximumFractionDigits:0});
                const itemTxt = (m.itemCount||0).toLocaleString('en-US');

                // Top sublocations (prep for Pyxis card)
                const bySL = (m.bySublocation && typeof m.bySublocation === 'object') ? m.bySublocation : {};
                // bySublocation is a map keyed by sublocation name
                const slRows = Object.keys(bySL)
                    .map(k=>({ sublocation: k, cost: Number(bySL[k].cost)||0, qty: Number(bySL[k].qty)||0, itemCount: Number(bySL[k].itemCount)||0 }))
                    .filter(r=>r.cost>0)
                    .sort((a,b)=>b.cost-a.cost);

                const topN = 3;
                const top = slRows.slice(0, topN);
                const remaining = Math.max(0, slRows.length - top.length);

                let slHtml = '';
                if (top.length){
                    slHtml += '<div class="waste-tt-subhead">Top sublocations</div>';
                    for (const r of top){
                        const c = '$' + (r.cost||0).toLocaleString('en-US',{minimumFractionDigits:0, maximumFractionDigits:0});
                        slHtml += `<div class="waste-tt-row"><span>${esc(r.sublocation||'(unknown)')}</span><span>${c}</span></div>`;
                    }
                    if (remaining>0){
                        slHtml += `<div class="waste-tt-more">+${remaining} more</div>`;
                    }
                }

                tooltip.innerHTML = `
                    <div class="waste-tt-title">${esc(m.label||'')}</div>
                    <div class="waste-tt-meta">${esc(costTxt)} • ${esc(qtyTxt)} units • ${esc(itemTxt)} items</div>
                    ${slHtml}
                `.trim();

                bar.appendChild(tooltip);
                barWrap.appendChild(bar);

                // Click → send expiring-month items to Charts page (filter chip)
                barWrap.style.cursor = 'pointer';
                barWrap.addEventListener('click', (e) => {
                    try { e.stopPropagation(); } catch(_) {}
                    const itemCodes = Array.isArray(m.itemCodes) ? m.itemCodes : [];
                    if (!itemCodes.length) { console.warn('⚠️ No itemCodes for month bar click'); return; }

                    // Visual selection (muted coral)
                    try {
                        chartContainer.querySelectorAll('.waste-bar-wrap.is-selected').forEach(el => el.classList.remove('is-selected'));
                        barWrap.classList.add('is-selected');
                    } catch (e) {}

                    const monthLabel = (m.label || '').toUpperCase();
                    const totalCost = _num(m.cost, 0);

                    // Filter the scatter plot to the items contributing to this month
                    try {
                        applyWasteMonthSelectionToScatter(itemCodes, monthLabel, totalCost);
                    } catch (err) {
                        console.warn('⚠️ Failed to apply waste-month selection to scatter', err);
                    }
                });

                const label = document.createElement('div');
                label.className = 'waste-bar-label';
                label.textContent = (m.label || '').toUpperCase();

                col.appendChild(barWrap);
                col.appendChild(label);
                chartContainer.appendChild(col);
            }

            // Expose for Pyxis metric card work (includes sublocation breakdown)
            try { window.wasteProjectionByMonth = projection; } catch(e){}

            const total = (projection && typeof projection.totalCost === "number") ? projection.totalCost : months.reduce((s,m)=>s+(_num(m.cost,0)),0);
            const el = document.getElementById('currentWasteCost');
            if (el){
                el.textContent = '$' + total.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
            }
        }
        
        /**
         * Listen for messages from parent Dashboard
         */
        window.addEventListener('message', function(event) {
            // Log ALL incoming messages for debugging
            console.log('📨 Analytics received message:', event.data.type, event.data);

	        // Forward chart-state mirror requests to any nested chart iframes.
	        // (Dashboard -> Analytics -> Charts). This is required under file:// where
	        // the Dashboard can only directly message its immediate iframes.
	        if (event.data && event.data.type === 'PB_REQUEST_CHART_STATE') {
	            try {
	                const iframes = Array.from(document.querySelectorAll('iframe'));
	                iframes.forEach(fr => {
	                    try { fr.contentWindow && fr.contentWindow.postMessage(event.data, '*'); } catch(e) {}
	                });
	            } catch (e) {}
	            return;
	        }

	        // Forward transaction requests (Dashboard -> Analytics -> Charts)
	        if (event.data && event.data.type === 'PB_REQUEST_TX') {
	            try {
	                const iframes = Array.from(document.querySelectorAll('iframe'));
	                iframes.forEach(fr => {
	                    try { fr.contentWindow && fr.contentWindow.postMessage(event.data, '*'); } catch(e) {}
	                });
	            } catch (e) {}
	            return;
	        }

	        // Bubble transaction responses up to the parent dashboard.
	        if (event.data && event.data.type === 'PB_TX_DATA') {
	            try { window.parent && window.parent.postMessage(event.data, '*'); } catch(e) {}
	            return;
	        }

	        // Bubble chart-state payloads up to the parent dashboard so it can expose
	        // window.costChartState for console debugging + tooltip verification.
	        if (event.data && event.data.type === 'COST_CHART_STATE') {
	            try { window.parent && window.parent.postMessage(event.data, '*'); } catch(e) {}
	            return;
	        }
            
            // Handle mock data response
            if (event.data.type === 'mockDataResponse') {
                console.log('📦 Analytics: Received mock data from parent Dashboard');
                const payload = (window.InventoryApp && window.InventoryApp.postMessage && window.InventoryApp.postMessage.pickPayload)
                    ? window.InventoryApp.postMessage.pickPayload(event.data)
                    : { computed: event.data.data, raw: null };
                // Prefer computed (enriched) payload for charts, but retain raw inventory (expires/min/max)
                // for waste + Pyxis calculations that require per-location fields.
                const _rawMD = payload.raw || null;
                const _computedMD = payload.computed || null;
                cachedMockData = _computedMD || _rawMD;
                itemStatusOverlayPromise = null;

                // Always keep a reference to raw
                window.rawMockData = _rawMD;

                // Ensure inventory (with expires/min/max) is present even when using computedMD
                try {
                    if (cachedMockData && _rawMD && _rawMD.inventory) {
                        const hasInv = cachedMockData.inventory && typeof cachedMockData.inventory === 'object' && Object.keys(cachedMockData.inventory).length > 0;
                        if (!hasInv) cachedMockData.inventory = _rawMD.inventory;
                    }
                } catch (e) {}

                window.mockData = cachedMockData; // Make available globally

                // Build canonical facts once for downstream analytics/overview consumers.
                try {
                    if (window.FactsEngine && typeof window.FactsEngine.build === 'function') {
                        window.__facts = window.FactsEngine.build(cachedMockData, { sublocationMap: getSublocationMap() });
                        if (!window.__factsDebugLogged && typeof window.FactsEngine.debugSummary === 'function') {
                            window.FactsEngine.debugSummary(window.__facts);
                            window.__factsDebugLogged = true;
                        }

                        if (window.TrendFacts && typeof window.TrendFacts.build === 'function') {
                            window.__factsTrends = window.TrendFacts.build(window.__facts, { windowDays: 180, seasonalityPeriod: 7 });
                        }

                        if (window.DerivedFacts && window.TrendAnalysisEngine && window.SubstituteResolver) {
                            window.__derived = window.DerivedFacts.build(window.__facts, { windowDays: 180, defaultPeriod: 7 });
                            window.DerivedFacts.audit(window.__derived);
                        } else {
                            console.warn('[DerivedFacts] missing dependencies', {
                                DerivedFacts: !!window.DerivedFacts,
                                TrendAnalysisEngine: !!window.TrendAnalysisEngine,
                                SubstituteResolver: !!window.SubstituteResolver
                            });
                        }
                    }
                } catch (factsError) {
                    console.warn('⚠️ FactsEngine build failed:', factsError);
                }
                
                // Store projected waste data from Dashboard (single source of truth)
                if (cachedMockData.projectedWaste) {
                    window.projectedWasteData = cachedMockData.projectedWaste;
                    window.projectedWasteItems = cachedMockData.projectedWaste.items;
                    window.projectedWasteAmount = cachedMockData.projectedWaste.totalCost;
                    console.log('✓ Projected waste data received from Dashboard:', {
                        totalCost: cachedMockData.projectedWaste.totalCost,
                        itemCount: cachedMockData.projectedWaste.itemCount,
                        itemsArrayLength: cachedMockData.projectedWaste.items?.length || 0,
                        shelfLife: cachedMockData.projectedWaste.shelfLife
                    });
                    console.log('✓ window.projectedWasteItems set to array with', window.projectedWasteItems?.length || 0, 'items');
                } else {
                    console.warn('⚠️ No projectedWaste data in mockData from Dashboard');
                }
                
                // Store Pyxis projected waste data from Dashboard
                if (cachedMockData.pyxisProjectedWaste) {
                    window.pyxisProjectedWasteData = cachedMockData.pyxisProjectedWaste;
                    window.pyxisProjectedWasteItems = cachedMockData.pyxisProjectedWaste.items;
                    window.pyxisProjectedWasteAmount = cachedMockData.pyxisProjectedWaste.totalCost;
                    console.log('✓ Pyxis projected waste data received from Dashboard:', {
                        totalCost: cachedMockData.pyxisProjectedWaste.totalCost,
                        itemCount: cachedMockData.pyxisProjectedWaste.itemCount
                    });
                }
                
                // Store Usage vs Restock data from Dashboard
                if (cachedMockData.usageVsRestock) {
                    window.usageVsRestockData = cachedMockData.usageVsRestock;
                    window.itemsBelowThreshold = cachedMockData.usageVsRestock.items;
                    console.log('✓ Usage vs Restock data received from Dashboard:', {
                        itemCount: cachedMockData.usageVsRestock.itemCount,
                        threshold: cachedMockData.usageVsRestock.threshold
                    });
                }
                
                // Calculate Pyxis Metrics from mock data
                if (cachedMockData && cachedMockData.items) {
	                // Keep a reference for other derived views (expiring, standard badges, etc.)
	                window.__latestComputedMockData = cachedMockData;
                    console.log('🔢 Calculating Pyxis Metrics from inventory data...');
                    window.pyxisMetricsData = calculatePyxisMetrics(cachedMockData);
                    
                    if (window.pyxisMetricsData && window.pyxisMetricsData.totals) {
                        console.log('✓ Pyxis Metrics calculated:', window.pyxisMetricsData.totals);

                        // Waste card is now "Expiring (Pyxis)". Keep data in sync for modal use.
                        const expRecs = buildExpiringPyxisRecordsFromMockData();
                        const expItemCount = new Set(expRecs.map(r => String(r.itemCode))).size;
                        window.pyxisMetricsData.totals.waste = expItemCount;
                        window.pyxisMetricsData.raw = window.pyxisMetricsData.raw || {};
                        window.pyxisMetricsData.raw.waste = expRecs;

                        renderPyxisAdjustmentOverviewCard(cachedMockData);
                    }
                }
                
                // Store Waste Costs by Week from Dashboard
                if (cachedMockData.wasteCostsByWeek) {
                    window.wasteCostsByWeek = cachedMockData.wasteCostsByWeek;
                    console.log('✓ Waste costs by week received from Dashboard:', window.wasteCostsByWeek.length, 'weeks');
                }
                
                // Store Restock Costs by Week from Dashboard
                if (cachedMockData.restockCostsByWeek) {
                    window.restockCostsByWeek = cachedMockData.restockCostsByWeek;
                    console.log('✓ Restock costs by week received from Dashboard:', window.restockCostsByWeek.length, 'weeks');
                }
                
                // Store Trending Items from Dashboard
                if (cachedMockData.trendingItems) {
                    // Guard against schema mismatches so we don't overwrite a good trending list
                    // with an incomplete payload (which would trigger fallback raw-usage rendering).
                    const ti = cachedMockData.trendingItems;
                    const isValidTrending = ti && Array.isArray(ti.trendingUp);
                    if (ti && !Array.isArray(ti.trendingDown)) ti.trendingDown = [];
                    if (!isValidTrending) {
                        console.warn('⚠️ Ignoring invalid trendingItems payload from mockDataResponse:', ti);
                    } else {
                        window.trendingItems = ti;
                        window.__lastGoodTrendingItems = ti;
                        window.__hasEverReceivedTrendingItems = true;
                        console.log('✓ Trending items received from Dashboard:', {
                            trendingUp: ti.trendingUp.length,
                            trendingDown: ti.trendingDown.length,
                            threshold: ti.threshold
                        });
                        // Update top used items card
                        updateTopUsedItemsCard();
                    }
                }
                
                // Resolve all pending callbacks
                ensureItemStatusOverlayLoaded().then(() => {
                    dataRequestCallbacks.forEach(cb => cb.resolve(cachedMockData));
                    dataRequestCallbacks = [];
                });
                
                console.log('✓ Analytics: Mock data cached:', cachedMockData.items.length, 'items');
                
                // Draw line graph if canvas is ready
                setTimeout(() => {
                    drawUsageRestockLineGraph();
                }, 100);

                // Ensure summary cards & health bar refresh after data arrives.
                // (Some UI paths call populateAnalytics before async data is available.)
                if (!window.__analyticsRefreshedAfterData) {
                    window.__analyticsRefreshedAfterData = true;
                    setTimeout(() => {
                        try { if (typeof populateAnalytics === 'function') populateAnalytics(); } catch (e) {}
                    }, 0);
                }
            }
            
            // Handle FDA data ready notification from parent Dashboard
            if (event.data.type === 'FDA_DATA_READY') {
                console.log('📦 Analytics: FDA data ready notification received');
                
                // Clear any pending retry timeout since we got a signal
                if (window.fdaRetryTimeout) {
                    clearTimeout(window.fdaRetryTimeout);
                    window.fdaRetryTimeout = null;
                }
                
                // Request FDA shortage count from parent
                requestFDACountWithRetry();
            }
            
            // Handle FDA count response from parent Dashboard
            if (event.data.type === 'fdaCountResponse') {
                console.log('📦 Analytics: Received FDA shortage count message');
                console.log('   Full event.data:', event.data);
                console.log('   event.data.count:', event.data.count);
                console.log('   Type of count:', typeof event.data.count);
                
                // Clear any pending retry timeout
                if (window.fdaRetryTimeout) {
                    clearTimeout(window.fdaRetryTimeout);
                    window.fdaRetryTimeout = null;
                }
                
                const count = event.data.count || 0;
                console.log('   Using count:', count);
                updateFDAShortageCard(count);
            }
            
            // Handle FDA filtered items response for Shortage Bulletin navigation
            if (event.data.type === 'fdaFilteredItemsResponse') {
                console.log('📦 Analytics: Received FDA filtered items:', event.data.itemCodes);
                
                // Navigate to Shortage Bulletin with these itemCodes
                window.parent.postMessage({
                    type: 'navigateToTab',
                    tab: 'shortage',
                    filter: 'fdaShortages',
                    itemCodes: event.data.itemCodes
                }, '*');
                
                console.log('✓ Sent navigation request to Shortage Bulletin with', event.data.itemCodes.length, 'itemCodes');
            }
            
            // Handle settings update
            
            // Handle dark mode toggle
            if (event.data.type === 'darkModeToggle') {
                document.body.classList.toggle('dark-mode', event.data.enabled);
                console.log('📦 Analytics: Dark mode', event.data.enabled ? 'enabled' : 'disabled', 'from parent');
                // Redraw will be handled by MutationObserver
            }
        });
        
        // Expose data functions globally for use in analytics code
        window.requestMockDataFromParent = requestMockDataFromParent;
        window.getMockData = getMockData;
        
        /**
         * Update FDA Shortages card with count from parent Dashboard
         * @param {number} count - Number of FDA reported shortages
         */
        function updateFDAShortageCard(count) {
            console.log('📊 Updating FDA Shortages card with count:', count);
            
            const resolvedItemsEl = document.getElementById('resolvedItems');
            const resolvedItemsChangeEl = document.getElementById('resolvedItemsChange');
            
            if (resolvedItemsEl) {
                resolvedItemsEl.textContent = count;
                resolvedItemsEl.dataset.fdaInitialized = 'true';
            }
            
            if (resolvedItemsChangeEl) {
                resolvedItemsChangeEl.textContent = count === 0 ? 'No active shortages' : 
                    count === 1 ? '1 active shortage' : `${count} active shortages`;
                resolvedItemsChangeEl.className = count === 0 ? 'card-change positive' : 'card-change';
            }
            
            console.log('✓ FDA Shortages card updated');
        }
        
        /**
         * Request FDA count from parent with retry logic
         */
        function requestFDACountWithRetry(retryCount = 0, maxRetries = 5) {
            console.log(`📨 Requesting FDA count (attempt ${retryCount + 1}/${maxRetries})...`);
            
            window.parent.postMessage({ type: 'requestFDACount' }, '*');
            
            // Set up a timeout to retry if no response received
            const retryTimeout = setTimeout(() => {
                const resolvedItemsEl = document.getElementById('resolvedItems');
                
                // Check if data was received (element would be initialized)
                if (resolvedItemsEl && !resolvedItemsEl.dataset.fdaInitialized && retryCount < maxRetries - 1) {
                    console.log('⚠️ No FDA response received, retrying...');
                    requestFDACountWithRetry(retryCount + 1, maxRetries);
                } else if (retryCount >= maxRetries - 1) {
                    console.warn('❌ Max retries reached for FDA count request');
                    // Set to 0 as fallback
                    updateFDAShortageCard(0);
                }
            }, 2000); // Wait 2 seconds before retry
            
            // Store timeout ID so it can be cleared if response arrives
            window.fdaRetryTimeout = retryTimeout;
        }
        
        // Expose FDA function globally
        window.updateFDAShortageCard = updateFDAShortageCard;
        window.requestFDACountWithRetry = requestFDACountWithRetry;
        
        console.log('✓ Analytics: Data request system initialized');
        
        // ==================================================================================
        // DARK MODE OBSERVER - Watch for dark mode changes
        // ==================================================================================
        
        // Create observer to watch for dark-mode class changes on body
        const darkModeObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const isDarkMode = document.body.classList.contains('dark-mode');
                    console.log('🌓 Dark mode change detected:', isDarkMode ? 'DARK' : 'LIGHT');
                    console.log('   Body classes:', document.body.className);
                    
                    // Debug: Check ALL CSS variables immediately from BODY (not documentElement)
                    console.log('🔍 CSS Variable Check (from body):');
                    const vars = [
                        '--cost-label-normal',
                        '--cost-bar-gradient-start',
                        '--sankey-node-color',
                        '--text-primary'
                    ];
                    vars.forEach(v => {
                        const valFromRoot = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
                        const valFromBody = getComputedStyle(document.body).getPropertyValue(v).trim();
                        console.log(`   ${v}:`);
                        console.log(`      from :root: ${valFromRoot}`);
                        console.log(`      from body:  ${valFromBody}`);
                    });
                    
                    let retryCount = 0;
                    const maxRetries = 50; // Max 1 second (50 * 20ms)
                    
                    // Wait for CSS to actually update by checking the variable value
                    const waitForCSSUpdate = () => {
                        // Force style recalculation by reading offsetHeight
                        void document.body.offsetHeight;
                        
                        // Query from BODY not documentElement!
                        const testColor = getComputedStyle(document.body).getPropertyValue('--cost-label-normal').trim();
                        const expectedLightColor = '#333333';
                        const expectedDarkColor = '#c8d3d3';
                        
                        const isCorrect = isDarkMode ? 
                            (testColor === expectedDarkColor) : 
                            (testColor === expectedLightColor);
                        
                        retryCount++;
                        
                        if (isCorrect) {
                            console.log('✓ CSS variables updated after', retryCount, 'attempts:', testColor);
                            redrawCharts();
                        } else if (retryCount >= maxRetries) {
                            console.error('❌ CSS variables did not update after', maxRetries, 'attempts.');
                            console.error('   Current:', testColor, 'Expected:', isDarkMode ? expectedDarkColor : expectedLightColor);
                            console.error('   Redrawing charts anyway with whatever values we have...');
                            redrawCharts();
                        } else {
                            // Only log every 10th retry to avoid spam
                            if (retryCount % 10 === 0) {
                                console.log('⏳ Still waiting... attempt', retryCount, '/', maxRetries);
                            }
                            setTimeout(waitForCSSUpdate, 20);
                        }
                    };
                    
                    function redrawCharts() {
                        console.log('♻️ Redrawing charts...');
                        
                        // Redraw Sankey chart
                        if (typeof drawSankeyChart === 'function') {
                            const data = getMockData();
                            if (data && data.stockFlow) {
                                console.log('  → Redrawing Sankey chart');
                                drawSankeyChart(data.stockFlow);
                            }
                        }
                        
                        // Redraw cost chart
                        if (typeof costChartState !== 'undefined' && 
                            costChartState.currentData && 
                            typeof drawHorizontalBarChart === 'function') {
                            console.log('  → Redrawing cost chart');
                            
                            // Force scale recreation
                            costChartState.lastGridMax = null;
                            costChartState.lastNumGridLines = null;
                            
                            // Redraw
                            drawHorizontalBarChart(costChartState.currentData, costChartState.selectedIndex);
                        }
                        
                        console.log('✓ Charts redrawn');
                    }
                    
                    // Start waiting for CSS with a small initial delay
                    setTimeout(waitForCSSUpdate, 50);
                }
            });
        });
        
        // Start observing body for class changes
        darkModeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
        
        console.log('✓ Analytics: Dark mode observer initialized');
        
        // ==================================================================================
        // END DARK MODE OBSERVER
        // ==================================================================================
        
        // ==================================================================================
        // END DATA REQUEST FROM PARENT DASHBOARD
        // ==================================================================================
        
        // ==================================================================================
        // GLOBAL VARIABLES
        // ==================================================================================
        
        // Track which ETA filter to use based on the card state
        let currentEtaFilterType = 'expiredEta';
        
        // ==================================================================================
        // ANALYTICS DATA PROCESSING AND UI UPDATES
        // ==================================================================================
        
        /**
         * Calculate analytics from mock data and update UI
         */
        async function populateAnalytics() {
            const perfStart = performance.now();
            try {
                console.log('📊 Analytics: Requesting data from parent...');
                const t1 = performance.now();
                const data = await requestMockDataFromParent();
                console.log(`⏱️ Data request took: ${(performance.now() - t1).toFixed(2)}ms`);
                
                if (!data || !data.items || data.items.length === 0) {
                    console.warn('⚠️ Analytics: No data items found');
                    return;
                }
                
                const items = data.items;
                console.log('✓ Analytics: Processing', items.length, 'items');
                
                // Check if data already has cached values from Dashboard
                const hasCachedData = items[0] && items[0]._cachedWeeklyUsage !== undefined;
                console.log('📊 Data has cached values:', hasCachedData);
                
                let itemsWithUsage;
                if (hasCachedData) {
                    // USE CACHED DATA - no calculation needed!
                    console.log('✅ Using pre-cached data from Dashboard');
                    itemsWithUsage = items;
                } else {
                    // Fallback: calculate if no cache (shouldn't happen with optimized Dashboard)
                    console.log('⚠️ No cached data - calculating (this is slow!)');
                    const t2 = performance.now();
                    itemsWithUsage = items.map(item => {
                        let usageCalc;
                        
                        // Handle numeric usageRate
                        if (typeof item.usageRate === 'number') {
                            usageCalc = { weeklyBaseline: item.usageRate, dailyBaseline: item.usageRate / 7 };
                        }
                        // Handle array usageRate
                        else if (item.usageRate && Array.isArray(item.usageRate) && item.usageRate.length > 0) {
                            usageCalc = calculateTrueUsageRate(item.usageRate, item.status);
                        }
                        // Default to zero
                        else {
                            usageCalc = { weeklyBaseline: 0, dailyBaseline: 0 };
                        }
                        
                        return {
                            ...item,
                            _cachedWeeklyUsage: usageCalc.weeklyBaseline,
                            _cachedDailyUsage: usageCalc.dailyBaseline
                        };
                    });
                    console.log(`⏱️ Fallback calculation took: ${(performance.now() - t2).toFixed(2)}ms`);
                }
                
                // Calculate statistics using cached values
                console.log('📊 Calculating statistics...');
                const t3 = performance.now();
                const stats = calculateStatistics(itemsWithUsage);
                console.log(`⏱️ Statistics calculation took: ${(performance.now() - t3).toFixed(2)}ms`);
                console.log('📊 Stats:', {
                    total: stats.total,
                    critical: stats.critical,
                    resolved: stats.resolved,
                    expiredEta: stats.expiredEta,
                    earliestEta: stats.earliestEta
                });
                
                // Update UI with calculated stats
                console.log('╔════════════════════════════════════════════════════════════╗');
                console.log('║  ABOUT TO CALL updateSummaryCards                         ║');
                console.log('╚════════════════════════════════════════════════════════════╝');
                console.log('📊 Updating UI components...');
                const t4 = performance.now();
                updateSummaryCards(stats);
                console.log(`⏱️ Summary cards took: ${(performance.now() - t4).toFixed(2)}ms`);
                
                const t5 = performance.now();
                updateStatusDistribution(stats);
                console.log(`⏱️ Status distribution took: ${(performance.now() - t5).toFixed(2)}ms`);
                
                const t6 = performance.now();
                updateTopCategories(itemsWithUsage);
                console.log(`⏱️ Top categories took: ${(performance.now() - t6).toFixed(2)}ms`);
                
                const t7 = performance.now();
                updateKeyMetrics(itemsWithUsage);
                console.log(`⏱️ Key metrics took: ${(performance.now() - t7).toFixed(2)}ms`);
                
                // Initialize Inventory Cost Chart
                const t7b = performance.now();
                initInventoryCostChart(itemsWithUsage);
                console.log(`⏱️ Inventory cost chart took: ${(performance.now() - t7b).toFixed(2)}ms`);
                
                // Draw Usage vs Restock Line Graph
                const t7c = performance.now();
                drawUsageRestockLineGraph();
                console.log(`⏱️ Usage vs Restock line graph took: ${(performance.now() - t7c).toFixed(2)}ms`);
                
                // Note: Pyxis metrics now received from Dashboard via mockDataResponse
                
                // Draw Sankey chart if flow data exists
                console.log('🔍 Checking for stockFlow data...');
                console.log('data.stockFlow exists?', !!data.stockFlow);
                if (data.stockFlow) {
                    console.log('data.stockFlow.flows exists?', !!data.stockFlow.flows);
                    if (data.stockFlow.flows) {
                        console.log('data.stockFlow.flows.length:', data.stockFlow.flows.length);
                        console.log('First flow:', data.stockFlow.flows[0]);
                    }
                }
                
                if (data.stockFlow) {
                    console.log('📊 Drawing Sankey chart...');
                    const t8 = performance.now();
                    drawSankeyChart(data.stockFlow);
                    console.log(`⏱️ Sankey chart took: ${(performance.now() - t8).toFixed(2)}ms`);
                } else {
                    console.error('❌ No stockFlow data found in data object');
                    console.log('Available keys in data:', Object.keys(data));
                }
                
                console.log(`✓ Analytics: All data updated successfully in ${(performance.now() - perfStart).toFixed(2)}ms`);
                
            } catch (error) {
                console.error('❌ Analytics: Error populating data:', error);
                console.error('Error stack:', error.stack);
            }
        }
        
        // ==================================================================================
        // ENHANCED USAGE RATE ANALYSIS (from Shortage Bulletin)
        // ==================================================================================
        
        function calculateTrueUsageRate(usageRateArray, itemStatus) {
            // ========== CONFIGURABLE CONSTANTS ==========
            const CONSTRAINT_PERCENTAGE = 0.05;      // Data points below 5% of average are considered constrained
            const MIN_BASELINE_PERIODS = 2;          // Minimum weeks needed for calculation (lowered to allow aggressive filtering)
            const POINTS_FOR_NO_STATUS = 8;          // Number of recent points to average for items with no status
            const MOVING_AVERAGE_WINDOW = 4;         // Window size for moving average when all points are valid
            const DAYS_PER_WEEK = 7;                 // Convert weekly to daily
            // ============================================
            
            // Handle non-array inputs (assume it's already daily if single value)
            if (!Array.isArray(usageRateArray)) {
                const singleValue = usageRateArray || 0;
                return {
                    weeklyBaseline: singleValue * DAYS_PER_WEEK,
                    weeklySlope: 0,
                    dailyBaseline: singleValue,
                    dailySlope: 0,
                    projectedDailyUsage: singleValue,
                    normalPeriods: 1,
                    constrainedPeriods: 0,
                    confidence: singleValue > 0 ? 50 : 0,
                    useOriginalData: true
                };
            }
            
            if (usageRateArray.length === 0) {
                return {
                    weeklyBaseline: 0,
                    weeklySlope: 0,
                    dailyBaseline: 0,
                    dailySlope: 0,
                    projectedDailyUsage: 0,
                    normalPeriods: 0,
                    constrainedPeriods: 0,
                    confidence: 0,
                    useOriginalData: true
                };
            }
            
            // Step 1: Calculate average of all data points to determine constraint threshold
            const totalSum = usageRateArray.reduce((sum, val) => sum + val, 0);
            const average = totalSum / usageRateArray.length;
            // Use a minimum threshold to avoid issues with very low or zero averages
            const CONSTRAINT_THRESHOLD = Math.max(average * CONSTRAINT_PERCENTAGE, 0.01);
            
            // Step 2: Identify constraint point (in weekly data)
            let constraintIndex = usageRateArray.length;
            for (let i = 0; i < usageRateArray.length; i++) {
                if (usageRateArray[i] < CONSTRAINT_THRESHOLD) {
                    constraintIndex = i;
                    break;
                }
            }
            
            // Step 3: Extract pre-constraint "normal" usage weeks
            const normalUsage = usageRateArray.slice(0, constraintIndex);
            
            // If no constraint detected (all values are above threshold), use average of ALL points
            if (normalUsage.length === usageRateArray.length) {
                // Calculate average of ALL points
                const allPointsAverage = usageRateArray.reduce((sum, val) => sum + val, 0) / usageRateArray.length;
                
                return {
                    weeklyBaseline: allPointsAverage,
                    weeklySlope: 0,
                    dailyBaseline: allPointsAverage / DAYS_PER_WEEK,
                    dailySlope: 0,
                    projectedDailyUsage: allPointsAverage / DAYS_PER_WEEK,
                    normalPeriods: usageRateArray.length,
                    constrainedPeriods: 0,
                    confidence: 100,
                    useOriginalData: true,
                    useAllPointsAverage: true
                };
            }
            
            // Determine if item has status (not blank/empty)
            const hasStatus = itemStatus && itemStatus.trim() !== '';
            
            // Calculate baseline based on status
            let weeklyBaseline;
            
            if (hasStatus) {
                // For items WITH status: use average of all points within constraints
                if (normalUsage.length < MIN_BASELINE_PERIODS) {
                    // Not enough data - use simple average of all non-constrained weeks
                    const nonZero = usageRateArray.filter(v => v >= CONSTRAINT_THRESHOLD);
                    weeklyBaseline = nonZero.length > 0 ? nonZero.reduce((a,b) => a+b) / nonZero.length : 0;
                    
                    return {
                        weeklyBaseline: weeklyBaseline,
                        weeklySlope: 0,
                        dailyBaseline: weeklyBaseline / DAYS_PER_WEEK,
                        dailySlope: 0,
                        projectedDailyUsage: weeklyBaseline / DAYS_PER_WEEK,
                        normalPeriods: nonZero.length,
                        constrainedPeriods: usageRateArray.length - nonZero.length,
                        confidence: Math.min(nonZero.length / MIN_BASELINE_PERIODS * 50, 50),
                        useOriginalData: false
                    };
                }
                
                // Calculate average of all points within constraints
                weeklyBaseline = normalUsage.reduce((sum, val) => sum + val, 0) / normalUsage.length;
                
            } else {
                // For items WITHOUT status: use average of last N points
                const pointsToUse = Math.min(POINTS_FOR_NO_STATUS, normalUsage.length);
                const recentPoints = normalUsage.slice(-pointsToUse);
                weeklyBaseline = recentPoints.reduce((sum, val) => sum + val, 0) / recentPoints.length;
            }
            
            // Step 4: Calculate trend slope (linear regression on normal weeks)
            const weeklySlope = calculateTrendSlopeForUsageRate(normalUsage);
            
            // Step 5: Convert weekly values to daily
            const dailyBaseline = weeklyBaseline / DAYS_PER_WEEK;
            const dailySlope = weeklySlope / DAYS_PER_WEEK / DAYS_PER_WEEK; // Per day per day
            
            // Step 6: Calculate confidence
            const confidence = calculateConfidence(normalUsage, weeklySlope);
            
            return {
                weeklyBaseline: Math.round(weeklyBaseline * 10) / 10,
                weeklySlope: Math.round(weeklySlope * 100) / 100,
                dailyBaseline: Math.round(dailyBaseline * 100) / 100,
                dailySlope: Math.round(dailySlope * 1000) / 1000,
                projectedDailyUsage: Math.round(dailyBaseline * 100) / 100,
                normalPeriods: normalUsage.length,
                constrainedPeriods: usageRateArray.length - constraintIndex,
                confidence: confidence,
                useOriginalData: false
            };
        }

        function calculateTrendSlopeForUsageRate(data) {
            const n = data.length;
            if (n < 2) return 0;
            
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            
            for (let i = 0; i < n; i++) {
                sumX += i;
                sumY += data[i];
                sumXY += i * data[i];
                sumXX += i * i;
            }
            
            const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            return slope;
        }

        function calculateConfidence(data, slope) {
            // Higher confidence if:
            // - More data points
            // - Less volatility
            // - Trend is stable
            
            const n = data.length;
            
            // Guard against empty array
            if (n === 0) {
                return 0;
            }
            
            const avg = data.reduce((a,b) => a+b, 0) / n;
            
            // Guard against division by zero
            if (avg === 0) {
                return Math.min(n / 10 * 50, 50); // Only use data quantity for confidence
            }
            
            const variance = data.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / n;
            const coefficientOfVariation = Math.sqrt(variance) / avg;
            
            // Confidence score (0-100)
            const dataConfidence = Math.min(n / 10 * 50, 50); // Up to 50 points for data quantity
            const stabilityConfidence = Math.max(0, 50 - (coefficientOfVariation * 100)); // Up to 50 for stability
            
            return Math.round(dataConfidence + stabilityConfidence);
        }
        
        // ==================================================================================
        // END ENHANCED USAGE RATE ANALYSIS
        // ==================================================================================
        
        /**
         * Calculate all statistics from items
         */
        function calculateStatistics(items) {
            console.log(`📊 calculateStatistics: Processing ${items.length} items`);
            if (items.length > 0) {
                const sampleItem = items[0];
                console.log('📊 Sample item fields:', {
                    name: sampleItem.genericName || sampleItem.name,
                    hasStatus: !!sampleItem.status,
                    status: sampleItem.status,
                    hasETA: !!sampleItem.ETA,
                    ETA: sampleItem.ETA,
                    hasUsageRate: !!sampleItem._cachedWeeklyUsage,
                    usageRate: sampleItem._cachedWeeklyUsage
                });
            }
            
            const stats = {
                total: items.length,
                totalCost: 0,        // Total inventory cost
                projectedWaste: 0,   // Cost of items with >365 days supply
                projectedWasteItems: [],  // Items with >365 days supply
                totalUsage: 0,       // Sum of all usage rates
                totalRestock: 0,     // Sum of all restock rates
                usageVsRestockRatio: 0,  // totalUsage / totalRestock
                critical: 0,
                severe: 0,
                moderate: 0,
                resolved: 0,
                expiredEta: 0,      // Items with ETA older than today
                earliestEta: null,  // Track earliest ETA date
                etaWithin7Days: 0,  // Items with ETA within 7 days
                etaWithin14Days: 0, // Items with ETA within 14 days
                // Inventory health by days supply
                outOfStock: 0,      // 0 days
                lowStock: 0,        // < 7 days
                normalStock: 0,     // 7-60 days
                overStock: 0        // > 60 days
                ,
                // Expiration health (separate from days-supply)
                // expiringSoonBar is used in the Inventory Health stacked bar (mutually exclusive bucket)
                // expiringSoonItemCodes is used for click-to-filter navigation (all expiring items in window)
                expiringSoonBar: 0,
                expiringSoonItemCodes: []
            };
            
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Start of today
            const sevenDaysOut = new Date(today);
            sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
            const fourteenDaysOut = new Date(today);
            fourteenDaysOut.setDate(fourteenDaysOut.getDate() + 14);

            // Compute expiring items from inventory payload (preferred) because expires live at sublocation-level.
            // This enables consistent behavior across Analytics + Shortage Bulletin.
            // IMPORTANT: This set is used to build a mutually-exclusive bar bucket later (low-stock takes precedence).
            let expiringSet = new Set();
            try {
                const fullData = getMockData();
                const inventory = (fullData && fullData.inventory)
                    ? fullData.inventory
                    : (window.cachedMockData && window.cachedMockData.inventory)
                        ? window.cachedMockData.inventory
                        : (window.mockData && window.mockData.inventory)
                            ? window.mockData.inventory
                            : null;

                const monthsWindow = parseInt(localStorage.getItem('expiringMonths') || '3', 10);
                const cutoff = new Date(today);
                cutoff.setMonth(cutoff.getMonth() + monthsWindow);
                cutoff.setHours(23, 59, 59, 999);

                if (inventory && typeof inventory === 'object') {
                    for (const [itemCodeKey, invEntry] of Object.entries(inventory)) {
                        if (!invEntry) continue;

                        // Shape A: { sublocations: [{qty/curQty, expires, ...}, ...] }
                        if (Array.isArray(invEntry.sublocations)) {
                            for (const row of invEntry.sublocations) {
                                const qty = Number(row?.qty ?? row?.curQty ?? 0);
                                const exp = row?.expires;
                                if (!(qty > 0) || !exp) continue;
                                const expDate = new Date(exp);
                                if (!isNaN(expDate.getTime()) && expDate <= cutoff) {
                                    expiringSet.add(String(itemCodeKey));
                                    break;
                                }
                            }
                            continue;
                        }

                        // Shape B: { "3TWA": {qty, expires, ...}, ... }
                        if (typeof invEntry === 'object') {
                            for (const loc of Object.values(invEntry)) {
                                const qty = Number(loc?.qty ?? loc?.curQty ?? 0);
                                const exp = loc?.expires;
                                if (!(qty > 0) || !exp) continue;
                                const expDate = new Date(exp);
                                if (!isNaN(expDate.getTime()) && expDate <= cutoff) {
                                    expiringSet.add(String(itemCodeKey));
                                    break;
                                }
                            }
                        }
                    }
                }

                stats.expiringSoonItemCodes = Array.from(expiringSet);
                // Expose for click-navigation (used by navigateToInventory)
                window.expiringSoonItemCodes = stats.expiringSoonItemCodes;
            } catch (e) {
                console.warn('⚠️ Analytics: Failed to compute expiringSoon items', e);
                expiringSet = new Set();
                stats.expiringSoonItemCodes = [];
                window.expiringSoonItemCodes = [];
            }
            
            console.log('📅 Today is:', today.toISOString().split('T')[0]);
            let itemsWithETA = 0;
            let itemsWithStatus = 0;
            let statusCounts = { critical: 0, severe: 0, moderate: 0, resolved: 0, 'non-formulary': 0, empty: 0 };
            
            items.forEach(item => {
                // Calculate total inventory cost
                if (item.quantity && item.unitPrice) {
                    stats.totalCost += item.quantity * parseFloat(item.unitPrice);
                }
                
                // Calculate usage vs restock totals
                if (item.usageRate && Array.isArray(item.usageRate)) {
                    stats.totalUsage += item.usageRate.reduce((sum, val) => sum + (val || 0), 0);
                }
                if (item.restockRate && Array.isArray(item.restockRate)) {
                    stats.totalRestock += item.restockRate.reduce((sum, val) => sum + (val || 0), 0);
                }
                
                // Count by status
                const status = (item.status || '').toLowerCase();
                if (status) {
                    itemsWithStatus++;
                    if (statusCounts.hasOwnProperty(status)) {
                        statusCounts[status]++;
                    }
                } else {
                    statusCounts.empty++;
                }
                
                if (status === 'critical') stats.critical++;
                else if (status === 'severe') stats.severe++;
                else if (status === 'moderate') stats.moderate++;
                else if (status === 'resolved') stats.resolved++;  // Only count if explicitly resolved
                
                // Count expired ETAs and track earliest ETA
                if (item.ETA) {
                    itemsWithETA++;
                    const etaDate = new Date(item.ETA);
                    etaDate.setHours(0, 0, 0, 0);
                    
                    // Track earliest ETA
                    if (!stats.earliestEta || etaDate < stats.earliestEta) {
                        stats.earliestEta = etaDate;
                    }
                    
                    if (etaDate < today) {
                        stats.expiredEta++;
                        if (stats.expiredEta <= 3) {
                            console.log(`📅 Expired ETA found: ${item.genericName || item.name}, ETA: ${item.ETA}`);
                        }
                    } else if (etaDate <= sevenDaysOut) {
                        stats.etaWithin7Days++;
                    } else if (etaDate <= fourteenDaysOut) {
                        stats.etaWithin14Days++;
                    }
                }
                
                // Calculate inventory health using CACHED usage rate
                // Bucket order (mutually exclusive): Out of Stock -> Low -> Expiring -> Normal -> Overstock
                const itemCodeKey = String(item.itemCode ?? item.code ?? item.id ?? item.erx ?? '');
                const isExpiring = itemCodeKey && expiringSet && expiringSet.has(itemCodeKey);

                if (item._cachedWeeklyUsage && item._cachedWeeklyUsage > 0) {
                    const totalQty = (item.pyxis || 0) + (item.pharmacy || 0);
                    const daysSupply = (totalQty / item._cachedWeeklyUsage) * 7;

                    if (daysSupply === 0 || totalQty === 0) {
                        stats.outOfStock++;  // Out of stock (0 days)
                    } else if (daysSupply < 7) {
                        stats.lowStock++;    // Low stock (< 7 days)
                    } else if (isExpiring) {
                        stats.expiringSoonBar++; // Expiring bucket (see expiringSoonItemCodes for full list)
                    } else if (daysSupply <= 60) {
                        stats.normalStock++; // Normal (7-60 days)
                    } else {
                        stats.overStock++;   // Overstock (> 60 days)
                    }
                } else {
                    // No usage data - treat as Normal unless expiring
                    if (isExpiring) stats.expiringSoonBar++;
                    else stats.normalStock++;
                }
            });
            
            console.log(`📊 Data summary: ${itemsWithStatus} items with status, ${itemsWithETA} items with ETA`);
            console.log(`📊 Status counts:`, statusCounts);
            if (itemsWithStatus > 0) {
                console.log(`📊 Status breakdown: critical=${stats.critical}, severe=${stats.severe}, moderate=${stats.moderate}, resolved=${stats.resolved}`);
            }
            if (itemsWithETA > 0) {
                console.log(`📊 ETA breakdown: expired=${stats.expiredEta}, within 7d=${stats.etaWithin7Days}, within 14d=${stats.etaWithin14Days}`);
            }
            
            // Projected Waste is now calculated in Dashboard (single source of truth)
            // and passed to Analytics via postMessage. No duplicate calculation here.
            
            // Calculate usage vs restock ratio
            if (stats.totalRestock > 0) {
                stats.usageVsRestockRatio = Math.min(stats.totalUsage / stats.totalRestock, 1.00);
            } else {
                stats.usageVsRestockRatio = 0;
            }
            
            // Calculate items below threshold (configurable via settings)
            // Items Below Threshold - received from Dashboard, don't calculate here
            // Dashboard is the single source of truth for this calculation
            
            return stats;
        }
        
        /**
         * Draw Usage vs Restock Line Graph (minimal style)
         */
        function drawUsageRestockLineGraph() {
            console.log('📈 drawUsageRestockLineGraph called');
            
            const canvas = document.getElementById('usageRestockLineCanvas');
            if (!canvas) {
                console.warn('⚠️ Canvas element not found: usageRestockLineCanvas');
                return;
            }
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.warn('⚠️ Could not get 2d context from canvas');
                return;
            }
            
            // Get mockData
            if (!window.mockData || !window.mockData.items) {
                console.warn('⚠️ No mock data available for line graph');
                console.log('window.mockData:', window.mockData);
                return;
            }
            
            const items = window.mockData.items;
            console.log(`📊 Drawing line graph with ${items.length} items`);
            
            // Calculate weekly usage vs restock ratios (last ~2 months)
            const maxWeeks = 8;
            const weeklyRatios = [];
            const maxSeriesLen = items.reduce((m, item) => {
                const uLen = Array.isArray(item && item.usageRate) ? item.usageRate.length : 0;
                const rLen = Array.isArray(item && item.restockRate) ? item.restockRate.length : 0;
                return Math.max(m, uLen, rLen);
            }, 0);
            const startWeek = Math.max(0, maxSeriesLen - maxWeeks);
            
            for (let week = startWeek; week < maxSeriesLen; week++) {
                let totalUsage = 0;
                let totalRestock = 0;
                
                items.forEach(item => {
                    if (item.usageRate && item.usageRate[week]) {
                        totalUsage += item.usageRate[week];
                    }
                    if (item.restockRate && item.restockRate[week]) {
                        totalRestock += item.restockRate[week];
                    }
                });
                
                // Calculate ratio
                const ratio = totalRestock > 0 ? Math.min(totalUsage / totalRestock, 1.5) : 0;
                weeklyRatios.push(ratio);
            }
            
            console.log('📊 Analytics Line Graph - Weekly ratios:', weeklyRatios);
            
            // Setup canvas
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth || 600;
            const displayHeight = 200;
            
            console.log(`📐 Canvas dimensions: ${displayWidth}x${displayHeight}`);
            
            const dpr = window.devicePixelRatio || 1;
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            
            // Clear background - make transparent to show card background
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.clearRect(0, 0, displayWidth, displayHeight); // Clear to transparent
            
            // Chart margins - minimal
            const margin = { top: 10, right: 10, bottom: 10, left: 10 };
            const chartWidth = displayWidth - margin.left - margin.right;
            const chartHeight = displayHeight - margin.top - margin.bottom;
            
            // Y-axis: 0 to 1.5
            const yMin = 0;
            const yMax = 1.5;
            const yRange = yMax - yMin;
            
            // Draw gradient fill under the line
            ctx.beginPath();
            ctx.moveTo(margin.left, margin.top + chartHeight); // Bottom left
            
            for (let i = 0; i < weeklyRatios.length; i++) {
                const x = weeklyRatios.length > 1
                    ? margin.left + (i / (weeklyRatios.length - 1)) * chartWidth
                    : margin.left + chartWidth / 2;
                const ratio = Math.min(weeklyRatios[i], yMax);
                const y = margin.top + chartHeight - (ratio / yRange) * chartHeight;
                ctx.lineTo(x, y);
            }
            
            ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight); // Bottom right
            ctx.closePath();
            
            // Create gradient from primary color to white
            const gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartHeight);
            
            if (isDarkMode) {
                gradient.addColorStop(0, 'rgba(32, 200, 181, 0.4)'); // Teal at top
                gradient.addColorStop(1, 'rgba(32, 200, 181, 0.05)'); // Almost transparent at bottom
            } else {
                gradient.addColorStop(0, 'rgba(17, 153, 142, 0.4)'); // Teal at top
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0.1)'); // White at bottom
            }
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            // Draw line without plot points
            ctx.beginPath();
            for (let i = 0; i < weeklyRatios.length; i++) {
                const x = weeklyRatios.length > 1
                    ? margin.left + (i / (weeklyRatios.length - 1)) * chartWidth
                    : margin.left + chartWidth / 2;
                const ratio = Math.min(weeklyRatios[i], yMax);
                const y = margin.top + chartHeight - (ratio / yRange) * chartHeight;
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            
            ctx.strokeStyle = isDarkMode ? 'rgba(32, 200, 181, 0.8)' : 'rgba(17, 153, 142, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Get threshold value and item count
            const thresholdValue = window.analyticsSettings?.usageRestockThreshold || 0.5;
            const itemsBelowThresholdCount = window.usageVsRestockData?.itemCount || 0;
            
            // Calculate threshold line Y position
            const thresholdY = margin.top + chartHeight - (thresholdValue / yRange) * chartHeight;
            
            // Measure text width to know where to end the line
            ctx.font = 'bold 16px system-ui, -apple-system, sans-serif'; // Reduced from 20px
            const countText = `${itemsBelowThresholdCount}`;
            const countWidth = ctx.measureText(countText).width;
            
            ctx.font = '11px system-ui, -apple-system, sans-serif'; // Reduced from 12px
            const captionText = `Items below ${thresholdValue.toFixed(2)}`;
            const captionWidth = ctx.measureText(captionText).width;
            
            const maxTextWidth = Math.max(countWidth, captionWidth);
            const textPadding = 10; // Space between line and text
            const rightEdgePadding = 5; // Padding from right edge of canvas
            const lineEndX = margin.left + chartWidth - maxTextWidth - textPadding - rightEdgePadding;
            
            // Draw threshold dotted line (ends before text) - lighter gray in dark mode
            ctx.strokeStyle = isDarkMode ? 'rgba(180, 180, 180, 0.5)' : 'rgba(100, 100, 100, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(margin.left, thresholdY);
            ctx.lineTo(lineEndX, thresholdY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw item count (larger, bold) with right padding - white text in dark mode
            ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.95)' : 'rgba(80, 80, 80, 0.9)';
            ctx.font = 'bold 16px system-ui, -apple-system, sans-serif'; // Reduced from 20px
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(countText, margin.left + chartWidth - rightEdgePadding, thresholdY - 2);
            
            // Draw caption below count with right padding - white text in dark mode
            ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(100, 100, 100, 0.7)';
            ctx.font = '11px system-ui, -apple-system, sans-serif'; // Reduced from 12px
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(captionText, margin.left + chartWidth - rightEdgePadding, thresholdY + 2);
            
            console.log('✅ Line graph drawn successfully with threshold line');
        }
        
        /**
         * Update summary cards with calculated statistics
         */
        function updateSummaryCards(stats) {
            console.log('╔════════════════════════════════════════════════════════════╗');
            console.log('║  UPDATE SUMMARY CARDS CALLED                               ║');
            console.log('╚════════════════════════════════════════════════════════════╝');
            console.log('Stats object:', stats);
            console.log('Stats.critical:', stats.critical);
            console.log('Stats.resolved:', stats.resolved);
            
            // Total Items
            document.getElementById('totalItems').textContent = stats.total;
            document.getElementById('totalItemsChange').textContent = `${stats.total} items in system`;
            document.getElementById('totalItemsChange').className = 'card-change';
            
            // Inventory Waste Card - 12-month expiry-based waste projection (matches Charts Outlook logic)
            try {
                const md = cachedMockData || window.mockData || getMockData();
                const proj = buildWasteMonthlyProjection(md, 12);
                const monthList = (proj && Array.isArray(proj.series)) ? proj.series :
                                  ((proj && Array.isArray(proj.months)) ? proj.months : []);
                if (proj && monthList.length) {
                    renderWasteMonthlyBars(proj);
                    // Keep the existing count element as "items expiring" by reading current month itemCount.
                    const cur = monthList[0];
                    const wasteItemCountEl = document.getElementById('wasteCount');
                    if (wasteItemCountEl && cur) wasteItemCountEl.textContent = (cur.itemCount || 0).toLocaleString('en-US');
                } else {
                    document.getElementById('currentWasteCost').textContent = '$0.00';
                    const wic = document.getElementById('wasteCount');
                    if (wic) wic.textContent = '0';
                }
            } catch (e) {
                console.warn('⚠️ Waste monthly projection render failed', e);
                document.getElementById('currentWasteCost').textContent = '$0.00';
                const wic = document.getElementById('wasteCount');
                if (wic) wic.textContent = '0';
            }


            // Stock-out Risk Timeline (Gantt) + Waste vs Usage Correlation
            try {
                const md2 = cachedMockData || window.mockData || getMockData();
                window.__lastAnalyticsMockData = md2;
                renderStockOutRiskTimeline(md2);
                renderWasteUsageCorrelation(md2);
            } catch (e) {
                console.warn('⚠️ Forecast/correlation render failed', e);
            }

            // Restock Cost Chart - prefer timeline-aware restock projection, fallback to Dashboard aggregate
            const projectedBars = buildProjectedRestockBars(cachedMockData || window.mockData || getMockData(), 14);
            const projectedValues = Array.isArray(projectedBars.dailyRestockCost) ? projectedBars.dailyRestockCost.slice() : [];
            const hasProjected = projectedValues.some(v => _num(v, 0) > 0);
            let restockBarValues = projectedValues;

            if (!hasProjected && window.restockCostsByWeek && window.restockCostsByWeek.length > 0) {
                const restockCostsByWeek = window.restockCostsByWeek;
                const barCount = Math.ceil(restockCostsByWeek.length / 4);
                restockBarValues = [];
                for (let i = 0; i < barCount; i++) {
                    const startIdx = i * 4;
                    const endIdx = Math.min(startIdx + 4, restockCostsByWeek.length);
                    let barSum = 0;
                    for (let j = startIdx; j < endIdx; j++) barSum += restockCostsByWeek[j];
                    restockBarValues.push(barSum);
                }
            }

            if (restockBarValues.length > 0) {
                const maxRestockBarValue = Math.max(...restockBarValues, 1);
                const restockChartContainer = document.getElementById('restockMiniChart');
                if (restockChartContainer) {
                    restockChartContainer.innerHTML = '';
                    restockBarValues.forEach((value, index) => {
                        const bar = document.createElement('div');
                        bar.className = 'cost-bar';
                        if (index === restockBarValues.length - 1) bar.classList.add('current');
                        const heightPercent = (value / maxRestockBarValue) * 100;
                        bar.style.height = Math.max(heightPercent, 3) + '%';
                        const locLabel = projectedBars.topLocationByDay && projectedBars.topLocationByDay[index] ? projectedBars.topLocationByDay[index] : '';
                        const projectionLabel = String(projectedBars.projectionLabel || '').trim();
                        bar.title = locLabel
                            ? `${locLabel} • ${projectionLabel ? projectionLabel + ' • ' : ''}${formatCurrency(value)}`
                            : (projectionLabel ? `${projectionLabel} • ${formatCurrency(value)}` : formatCurrency(value));
                        if (locLabel) {
                            const badge = document.createElement('span');
                            badge.className = 'sublocation-badge';
                            badge.textContent = locLabel;
                            badge.style.position = 'absolute';
                            badge.style.bottom = '100%';
                            badge.style.left = '50%';
                            badge.style.transform = 'translate(-50%, -4px)';
                            bar.style.position = 'relative';
                            bar.appendChild(badge);
                        }
                        restockChartContainer.appendChild(bar);
                    });

                    const currentRestock = restockBarValues[restockBarValues.length - 1] || 0;
                    const currentRestockEl = document.getElementById('currentRestockCost');
                    if (currentRestockEl) currentRestockEl.textContent = formatCurrency(currentRestock);
                }
            } else {
                const currentRestockEl = document.getElementById('currentRestockCost');
                if (currentRestockEl) currentRestockEl.textContent = '$0.00';
            }
            
            // Total Inventory Cost Metrics
            const totalInventoryCostEl = document.getElementById('totalInventoryCost');
            if (totalInventoryCostEl) {
                totalInventoryCostEl.textContent = '$' + stats.totalCost.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }
            
            // Usage Vs Restock Ratio - use data from Dashboard (single source of truth)
            const usageVsRestockOverallEl = document.getElementById('usageVsRestockOverall');
            if (usageVsRestockOverallEl) {
                usageVsRestockOverallEl.textContent = stats.usageVsRestockRatio.toFixed(2);
            }
            
            // Use items below threshold count from Dashboard
            const itemsBelowThresholdCount = window.usageVsRestockData?.itemCount || 0;
            const usageVsRestockAboveEl = document.getElementById('usageVsRestockAbove');
            if (usageVsRestockAboveEl) {
                usageVsRestockAboveEl.textContent = itemsBelowThresholdCount.toLocaleString('en-US');
            }
            
            // NOTE: inventoryItemCount element removed in redesign
            
            // NOTE: window.itemsBelowThreshold is received from Dashboard via mockDataResponse
            // Do NOT overwrite it here - Dashboard is the single source of truth
            
            // NOTE: window.projectedWasteItems is received from Dashboard via mockDataResponse
            // Do NOT overwrite it here - Dashboard is the single source of truth
            
            // Critical Items
            console.log('=== CRITICAL CARD DEBUG START ===');
            const criticalItemsEl = document.getElementById('criticalItems');
            console.log('Element found:', !!criticalItemsEl);
            console.log('Stats.critical value:', stats.critical);
            
            if (criticalItemsEl) {
                console.log('Before update, shows:', criticalItemsEl.textContent);
                criticalItemsEl.textContent = stats.critical;
                console.log('After update, shows:', criticalItemsEl.textContent);
            }
            console.log('=== CRITICAL CARD DEBUG END ===');
            
            if (stats.critical > 0) {
                document.getElementById('criticalItemsChange').textContent = `${stats.critical} items need attention`;
                document.getElementById('criticalItemsChange').className = 'card-change negative';
            } else {
                document.getElementById('criticalItemsChange').textContent = 'No critical items';
                document.getElementById('criticalItemsChange').className = 'card-change positive';
            }
            
            // FDA Shortages Card (formerly Resolved Items)
            // This is now populated from FDA API data via parent Dashboard
            const resolvedItemsEl = document.getElementById('resolvedItems');
            console.log('🏥 FDA Card initialization check:', {
                element: resolvedItemsEl,
                fdaInitialized: resolvedItemsEl?.dataset.fdaInitialized
            });
            
            if (resolvedItemsEl && !resolvedItemsEl.dataset.fdaInitialized) {
                // Initialize with placeholder, will be updated when FDA data arrives
                resolvedItemsEl.textContent = '--';
                document.getElementById('resolvedItemsChange').textContent = 'Loading FDA data...';
                document.getElementById('resolvedItemsChange').className = 'card-change';
                
                console.log('📨 Requesting FDA count from parent Dashboard with retry logic...');
                // Request FDA count from parent with retry mechanism
                requestFDACountWithRetry();
            }
            
            // Dynamic ETA Card
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const sevenDaysOut = new Date(today);
            sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
            const fourteenDaysOut = new Date(today);
            fourteenDaysOut.setDate(fourteenDaysOut.getDate() + 14);
            
            const etaCardTitle = document.getElementById('etaCardTitle');
            const etaCardSubtitle = document.getElementById('etaCardSubtitle');
            const etaCardIcon = document.getElementById('etaCardIcon');
            const etaCardValue = document.getElementById('expiredEtaItems');
            const etaCardChange = document.getElementById('expiredEtaChange');
            
            // Get CSS variable values from BODY (where dark-mode class is)
            const getETAColor = (varName) => {
                return getComputedStyle(document.body).getPropertyValue(varName).trim();
            };
            
            if (!stats.earliestEta) {
                // No ETAs at all
                etaCardTitle.textContent = 'Upcoming ETA';
                etaCardSubtitle.textContent = 'No ETA dates recorded';
                const noneColor = getETAColor('--eta-none-color');
                etaCardIcon.style.background = noneColor;
                etaCardValue.textContent = '0';
                etaCardValue.style.color = noneColor;
                etaCardChange.textContent = 'no ETAs for the next 2 weeks';
                etaCardChange.className = 'card-change';
                currentEtaFilterType = 'noEta';  // No ETAs to filter
            } else if (stats.earliestEta < today) {
                // Case A: Past ETA
                console.log('📊 ETA Card: Setting to Past ETA mode, count:', stats.expiredEta);
                etaCardTitle.textContent = 'Past ETA';
                etaCardSubtitle.textContent = 'Items with past ETA dates';
                const pastColor = getETAColor('--eta-past-color');
                etaCardIcon.style.background = pastColor;
                etaCardValue.textContent = stats.expiredEta;
                etaCardValue.style.color = pastColor;
                etaCardChange.textContent = `${stats.expiredEta} item${stats.expiredEta !== 1 ? 's' : ''} with past ETAs`;
                etaCardChange.className = 'card-change negative';
                currentEtaFilterType = 'expiredEta';  // Past ETAs
            } else if (stats.earliestEta <= sevenDaysOut) {
                // Case B: Within 7 days
                etaCardTitle.textContent = 'Upcoming ETA';
                etaCardSubtitle.textContent = 'Items arriving this week';
                const weekColor = getETAColor('--eta-week-color');
                etaCardIcon.style.background = weekColor;
                etaCardValue.textContent = stats.etaWithin7Days;
                etaCardValue.style.color = weekColor;
                etaCardChange.textContent = `${stats.etaWithin7Days} item${stats.etaWithin7Days !== 1 ? 's' : ''} with upcoming ETAs this week`;
                etaCardChange.className = 'card-change';
                currentEtaFilterType = 'etaWithin7Days';  // Within 7 days
            } else if (stats.earliestEta <= fourteenDaysOut) {
                // Case C: 7-14 days
                etaCardTitle.textContent = 'Upcoming ETA';
                etaCardSubtitle.textContent = 'Items arriving next week';
                const fortnightColor = getETAColor('--eta-fortnight-color');
                etaCardIcon.style.background = fortnightColor;
                etaCardValue.textContent = stats.etaWithin14Days;
                etaCardValue.style.color = fortnightColor;
                etaCardChange.textContent = `${stats.etaWithin14Days} item${stats.etaWithin14Days !== 1 ? 's' : ''} with ETAs next week`;
                etaCardChange.className = 'card-change';
                currentEtaFilterType = 'etaWithin14Days';  // Within 14 days
            } else {
                // Case D: More than 14 days
                etaCardTitle.textContent = 'Upcoming ETA';
                etaCardSubtitle.textContent = 'No arrivals soon';
                const noneColor = getETAColor('--eta-none-color');
                etaCardIcon.style.background = noneColor;
                etaCardValue.textContent = '0';
                etaCardValue.style.color = noneColor;
                etaCardChange.textContent = 'no ETAs for the next 2 weeks';
                etaCardChange.className = 'card-change';
                currentEtaFilterType = 'noUpcomingEta';  // No ETAs within 14 days
            }
            
            console.log('✓ Analytics: Summary cards updated');
            
            // Draw Usage vs Restock Line Graph (after all DOM updates)
            drawUsageRestockLineGraph();
        }
        
        /**
         * Update status distribution bar and legend
         */
        function updateStatusDistribution(stats) {
            const total = stats.total;
            
            // Calculate percentages for inventory health
            const outOfStockPct = total > 0 ? (stats.outOfStock / total) * 100 : 0;
            const lowStockPct = total > 0 ? (stats.lowStock / total) * 100 : 0;
            const expiringPct = total > 0 ? (stats.expiringSoonBar / total) * 100 : 0;
            const normalStockPct = total > 0 ? (stats.normalStock / total) * 100 : 0;
            const overStockPct = total > 0 ? (stats.overStock / total) * 100 : 0;
            
            // Update bar segments (no text content)
            const outOfStockSegment = document.getElementById('outOfStockSegment');
            if (outOfStockSegment) {
                outOfStockSegment.style.width = outOfStockPct + '%';
                outOfStockSegment.title = `Out of Stock: ${stats.outOfStock} items (0 days supply)`;
            }
            
            const lowStockSegment = document.getElementById('lowStockSegment');
            if (lowStockSegment) {
                lowStockSegment.style.width = lowStockPct + '%';
                lowStockSegment.title = `Low Stock: ${stats.lowStock} items (<7 days supply)`;
            }

            const expiringSegment = document.getElementById('expiringSoonSegment');
            if (expiringSegment) {
                expiringSegment.style.width = expiringPct + '%';
                const monthsWindow = parseInt(localStorage.getItem('expiringMonths') || '3', 10);
                expiringSegment.title = `Expiring: ${stats.expiringSoonBar} items (≤${monthsWindow} months)`;
            }
            
            const normalStockSegment = document.getElementById('normalStockSegment');
            if (normalStockSegment) {
                normalStockSegment.style.width = normalStockPct + '%';
                normalStockSegment.title = `Normal Stock: ${stats.normalStock} items (7-60 days supply)`;
            }
            
            const overStockSegment = document.getElementById('overStockSegment');
            if (overStockSegment) {
                overStockSegment.style.width = overStockPct + '%';
                overStockSegment.title = `Overstock: ${stats.overStock} items (>60 days supply)`;
            }
            
            // Update legend (count - label format)
            const outOfStockLegend = document.getElementById('outOfStockLegend');
            if (outOfStockLegend) {
                outOfStockLegend.textContent = `${stats.outOfStock} - Out of Stock`;
            }
            
            const lowStockLegend = document.getElementById('lowStockLegend');
            if (lowStockLegend) {
                lowStockLegend.textContent = `${stats.lowStock} - Low Stock`;
            }
            
            const normalStockLegend = document.getElementById('normalStockLegend');
            if (normalStockLegend) {
                normalStockLegend.textContent = `${stats.normalStock} - Normal Stock`;
            }
            
            const overStockLegend = document.getElementById('overStockLegend');
            if (overStockLegend) {
                overStockLegend.textContent = `${stats.overStock} - Overstock`;
            }

            const expiringSoonLegend = document.getElementById('expiringSoonLegend');
            if (expiringSoonLegend) {
                const monthsWindow = parseInt(localStorage.getItem('expiringMonths') || '3', 10);
                expiringSoonLegend.textContent = `${stats.expiringSoonBar} - Expiring ≤${monthsWindow} months`;
            }
            
            console.log('✓ Analytics: Inventory health updated -', 
                `Out:${stats.outOfStock}, Low:${stats.lowStock}, Exp:${stats.expiringSoonBar}, Normal:${stats.normalStock}, Over:${stats.overStock}`);
        }
        
        function getTrendFactsState() {
            if (!window.TrendFactsState || typeof window.TrendFactsState !== 'object') {
                window.TrendFactsState = { source: 'unknown', calculatedAt: '', up: [], down: [], loadedAt: '' };
            }

            // Prefer cached TrendFacts payload written by Dashboard from Google Sheets
            // to avoid expensive fallback calculations on initial page load.
            if (!window.__trendFactsHydratedFromCache) {
                window.__trendFactsHydratedFromCache = true;
                try {
                    const raw = localStorage.getItem('__trendFactsState');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        const hasUp = Array.isArray(parsed && parsed.up) && parsed.up.length > 0;
                        if (hasUp) {
                            window.TrendFactsState = {
                                source: parsed.source || 'cache',
                                calculatedAt: parsed.calculatedAt || '',
                                up: Array.isArray(parsed.up) ? parsed.up : [],
                                down: Array.isArray(parsed.down) ? parsed.down : [],
                                loadedAt: parsed.loadedAt || new Date().toISOString()
                            };
                        }
                    }
                } catch (_) {}
            }

            return window.TrendFactsState;
        }

        function getTrendingItemsFromState() {
            const state = getTrendFactsState();
            return {
                trendingUp: Array.isArray(state.up) ? state.up : [],
                trendingDown: Array.isArray(state.down) ? state.down : [],
                calculatedAt: state.calculatedAt || '',
                source: state.source || 'unknown',
                threshold: parseInt(localStorage.getItem('consecutiveWeekThreshold') || '2', 10)
            };
        }


        function getItemDescriptionByCode(itemCode) {
            const code = String(itemCode || '').trim();
            if (!code) return '';
            if (!window.__itemDescriptionByCodeMap) {
                const map = Object.create(null);
                try {
                    const src = (typeof ITEMS_DATA !== 'undefined' && ITEMS_DATA && Array.isArray(ITEMS_DATA.items)) ? ITEMS_DATA.items : [];
                    for (let i = 0; i < src.length; i++) {
                        const row = src[i] || {};
                        const k = String(row.itemCode || '').trim();
                        const desc = String(row.description || row.drugName || '').trim();
                        if (k && desc && !map[k]) map[k] = desc;
                    }
                } catch (_) {}
                window.__itemDescriptionByCodeMap = map;
            }
            return String(window.__itemDescriptionByCodeMap[code] || '');
        }

        /**
         * Update top categories with top 4 used items by week
         * Now prioritizes trending items from Dashboard
         */
        function updateTopCategories(items) {
            console.trace('updateTopCategories call');
            console.log('📊 updateTopCategories called with', items.length, 'items');
            console.log('📊 Checking for trending items... window.trendingItems exists:', !!window.trendingItems);
            
            // PRIORITY: Prefer cached trending items (and never revert to raw usage once received)
            const stateTi = getTrendingItemsFromState();
            const ti = (stateTi && Array.isArray(stateTi.trendingUp))
                ? stateTi
                : window.__lastGoodTrendingItems;

            if (window.__hasEverReceivedTrendingItems || (ti && Array.isArray(ti.trendingUp) && ti.trendingUp.length > 0)) {
                if (ti && Array.isArray(ti.trendingUp)) {
                    console.log('✅ Trending items available - using trending data instead of raw usage');
                    console.log('   Trending items count:', ti.trendingUp.length);
                    // Ensure current pointer points at best payload
                    window.trendingItems = ti;
                } else {
                    console.log('✅ Trending mode locked - showing last known non-empty state');
                }
                updateTopUsedItemsCard();
                return; // Exit early - trending items take priority
            }

            if (window.__hasEverReceivedTrendingItems || window.__lastGoodTrendingItems) {
                console.warn('🛑 Top Used Items: fallback raw usage render blocked (trending mode hard-locked).');
                console.trace('Top Used Items fallback blocked');
                // Ensure trending card is rendered from last-known-good if possible
                if (window.__lastGoodTrendingItems && Array.isArray(window.__lastGoodTrendingItems.trendingUp)) {
                    window.trendingItems = window.__lastGoodTrendingItems;
                    updateTopUsedItemsCard();
                }
                return;
            }

            console.log('⚠️ No trending items available yet - waiting for TrendFacts payload (sheet/cache)');
            const listElement = document.getElementById('topCategoriesList');
            if (listElement) {
                listElement.innerHTML = '<li class="trend-item"><span class="trend-name">Loading trend list…</span><span class="trend-value">--</span></li>';
            }
        }
        
        /**
         * Update top used items card with trending items
         */
        function updateTopUsedItemsCard() {
            console.trace('updateTopUsedItemsCard call');
            console.log('📈 updateTopUsedItemsCard called');
            console.log('📈 window.trendingItems exists:', !!window.trendingItems);
            
            // Prefer last known-good payload if current is missing fields
            const stateTi = getTrendingItemsFromState();
            const ti = (stateTi && Array.isArray(stateTi.trendingUp))
                ? stateTi
                : (window.__lastGoodTrendingItems || stateTi);

            if (!ti || !Array.isArray(ti.trendingUp)) {
                console.warn('⚠️ No trending items data available');
                console.warn('   window.trendingItems:', window.trendingItems);
                return;
            }
            
            const trendingUp = ti.trendingUp;
            // Mark that we have valid trending items so we never fall back to raw usage rendering
            if (Array.isArray(trendingUp) && trendingUp.length > 0) {
                window.__hasEverReceivedTrendingItems = true;
                window.__lastGoodTrendingItems = ti;
            }

            const threshold = ti.threshold || 2;
            
            console.log('📈 Trending items data:', {
                trendingUpCount: trendingUp.length,
                threshold: threshold,
                calculatedAt: ti.calculatedAt
            });
            
            // Get top 15 trending items
            const topItems = trendingUp.slice(0, 15);
            
            console.log('📈 Top 15 trending items:', topItems.map(item => ({
                code: item.itemCode,
                name: item.drugName,
                avgUsage: item.avgWeeklyUsage,
                percentChange: item.percentChange,
                consecutiveWeeks: item.consecutiveWeeks
            })));
            
            // Update list
            const listElement = document.getElementById('topCategoriesList');
            if (!listElement) {
                console.error('❌ topCategoriesList element not found');
                return;
            }
            
            listElement.innerHTML = '';
            
            if (topItems.length === 0) {
                listElement.innerHTML = `<li class="trend-item"><span class="trend-name">No trending items (${threshold} week threshold)</span><span class="trend-value">--</span></li>`;
                console.log('⚠️ No trending items to display');
            } else {
                topItems.forEach(item => {
                    const isNew = !!item.isNew;
                    const pct = (!isNew && typeof item.percentChange === 'number' && isFinite(item.percentChange))
                        ? item.percentChange
                        : null;
                    const pctText = isNew
                        ? 'NEW'
                        : (pct === null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`);

                    const suggestion = String(item.suggestion ?? item.recommendation ?? '').trim();
                    const itemDetailsDescription = getItemDescriptionByCode(item.itemCode);
                    const displayName = itemDetailsDescription || item.description || item.drugName || item.name || item.itemCode || 'Unknown';
                    const avgWeeklyUsage = _num(item.avgWeeklyUsage ?? item.weeklyUsage ?? item.avgUsage, 0);

                    const li = document.createElement('li');
                    li.className = 'trend-item';
                    li.innerHTML = `
                        <span class="trend-name-block">
                            <span class="trend-name">${displayName}</span>
                            ${suggestion ? `<span class="trend-suggestion">${suggestion}</span>` : ''}
                        </span>
                        <span class="trend-value">
                            ${avgWeeklyUsage.toFixed(1)}/wk
                            ${pctText ? `<span class="trend-pct ${isNew ? 'trend-new' : ''}">${pctText}</span>` : ''}
                        </span>
                    `;
                    li.title = `${item.consecutiveWeeks} consecutive weeks of increase`;
                    listElement.appendChild(li);
                });
                
                window.__hasEverReceivedTrendingItems = true;
                window.__lastGoodTrendingItems = ti;
                console.log(`✅ Top used items card updated with ${topItems.length} trending items (${threshold} week threshold)`);
            }
        }
        
        /**
         * Update key metrics with calculated statistics
         */
        function updateKeyMetrics(items) {
            // Note: Pyxis metrics now come from Dashboard via pyxisMetrics
            // Don't overwrite if we already have the data
            
            // Only update if we don't have pyxisMetrics data yet
            if (!window.pyxisMetricsData) {
                // Show placeholder values while waiting for data
                const __pAdj=document.getElementById('pyxisAdjTotalLocations'); if(__pAdj) __pAdj.textContent = '--';
                console.log('⏳ Pyxis metrics: Waiting for data from Dashboard...');
            } else {
                // Data already received, don't overwrite
                console.log('✓ Pyxis metrics: Using existing data from Dashboard');
            }
        }
        
        /**
         * Navigate to inventory tab
         */
        function navigateToInventory(filter = null) {
            // Send message to parent dashboard to switch to inventory tab with filter
            if (window.parent && window.parent !== window) {
                const payload = {
                    type: 'navigateToTab',
                    tab: 'inventory',
                    filter: filter
                };

                // For expiration filtering, pass the precomputed itemCodes so the inventory
                // page can filter deterministically (even if its data load timing differs).
                if (filter === 'expiringSoon') {
                    payload.itemCodes = Array.isArray(window.expiringSoonItemCodes) ? window.expiringSoonItemCodes : [];
                }

                window.parent.postMessage(payload, '*');
                console.log('📤 Analytics: Navigate to inventory tab, filter:', filter);
            }
        }
        
        /**
         * Navigate to Shortage Bulletin with FDA filtered items
         * Requests FDA data from parent, then sends filtered itemCodes
         */
        function navigateToShortageBulletinWithFDA() {
            console.log('📋 Requesting FDA filtered items for Shortage Bulletin...');
            
            // Request FDA filtered items from parent Dashboard
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'requestFDAFilteredItems'
                }, '*');
            }
        }
        
        /**
         * Navigate to Shortage Bulletin with trending items filter
         */
        function navigateToShortageBulletinTrending() {
            console.log('📈 Navigating to Shortage Bulletin with trending items filter...');
            
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'navigateToTab',
                    tab: 'inventory',
                    filter: 'topUsed'  // This filter now shows trending items
                }, '*');
            }
        }
        
        /**
         * Navigate to Analytics tab (the Charts page) with trending items filter
         */
        function navigateToChartsPage() {
            console.log('📊 Navigating to Analytics tab with trending items filter...');
            
            if (window.parent && window.parent !== window) {
                // Check if we have trending items
                if (window.trendingItems && window.trendingItems.trendingUp) {
                    const threshold = window.trendingItems.threshold || 2;
                    const itemCodes = window.trendingItems.trendingUp.map(item => item.itemCode);
                    
                    console.log('✓ Trending items available:', {
                        count: itemCodes.length,
                        threshold: threshold
                    });
                    
                    // Send message to Dashboard to navigate AND forward the filter
                    window.parent.postMessage({
                        type: 'navigateToChartsWithFilter',
                        itemCodes: itemCodes,
                        filterType: `Trending Items (${threshold}+ weeks)`,
                        threshold: threshold
                    }, '*');
                } else {
                    console.warn('⚠️ No trending items available - navigating without filter');
                    // Just navigate without filter
                    window.parent.postMessage({
                        type: 'navigateToTab',
                        tab: 'analytics'
                    }, '*');
                }
            }
        }
        
        /**
         * Draw interactive Sankey chart for stock flow with curved lines and opacity-based shading
         */
        /**
         * Draw Sankey chart using Google Charts
         * Simple, direct implementation
         */
        function drawSankeyChart(flowData) {
            console.log('🔵 drawSankeyChart START');
            
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
                console.error('❌ flowData.flows is empty array');
                return;
            }
            
            console.log('✅ Data valid:', flowData.flows.length, 'flows');
            
            // Check if google is defined
            if (typeof google === 'undefined') {
                console.error('❌ Google Charts not loaded - google is undefined');
                return;
            }
            
            console.log('✅ google object exists');
            
            // Load and draw
            console.log('🔄 Calling google.charts.load...');
            google.charts.load('current', {'packages':['sankey']});
            google.charts.setOnLoadCallback(drawChart);
            console.log('✅ Callback registered');
            
            function drawChart() {
                console.log('🎨 drawChart callback fired!');
                
                try {
                    // Get container
                    const container = document.getElementById('sankeyChart');
                    if (!container) {
                        console.error('❌ #sankeyChart container not found in DOM');
                        return;
                    }
                    console.log('✅ Container found:', container);
                    
                    // Build data array
                    console.log('🔄 Building data array...');
                    const dataTable = new google.visualization.DataTable();
                    dataTable.addColumn('string', 'From');
                    dataTable.addColumn('string', 'To');
                    dataTable.addColumn('number', 'Weight');
                    dataTable.addColumn({type: 'string', role: 'tooltip'});  // Custom tooltip
                    
                    const rows = [];
                    flowData.flows.forEach(flow => {
                        const tooltip = `${flow.value.toLocaleString()} units`;  // Just the number
                        rows.push([
                            String(flow.from),
                            String(flow.to),
                            Number(flow.value),
                            tooltip
                        ]);
                    });
                    
                    dataTable.addRows(rows);
                    console.log('✅ DataTable created with', rows.length, 'rows');
                    
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
                    
                    // Get container width and calculate chart width with padding
                    const containerWidth = container.parentElement.offsetWidth || 800;
                    const chartWidth = containerWidth - 20;  // 10px padding left + 10px right
                    
                    // Options
                    const options = {
                        width: chartWidth,
                        height: 600,
                        sankey: {
                            node: {
                                colors: [nodeColor],
                                label: {
                                    fontName: 'Arial',
                                    fontSize: 14,
                                    color: labelColor
                                },
                                nodePadding: 15,
                                width: 6
                            },
                            link: {
                                colorMode: 'gradient',
                                colors: linkColors
                            }
                        },
                        tooltip: {
                            isHtml: false,
                            textStyle: {
                                fontSize: 14,
                                fontName: 'Arial',
                                color: labelColor
                            }
                        }
                    };
                    
                    console.log('✅ Options configured:', chartWidth, 'x 600 (container:', containerWidth, '- 20px padding)');
                    console.log('Options object:', options);
                    
                    // Create and draw chart
                    console.log('🔄 Creating Sankey chart object...');
                    const chart = new google.visualization.Sankey(container);
                    console.log('✅ Chart object created');
                    
                    console.log('🔄 Drawing chart...');
                    chart.draw(dataTable, options);
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
        // END ANALYTICS DATA PROCESSING
        // ==================================================================================
        
        // ==================================================================================
        // STOCKOUT DETAILS MODAL TRIGGER
        // ==================================================================================
        
        /**
         * Open stockout details modal by sending message to parent
         */
        function openStockoutDetails() {
            console.log('🎯 openStockoutDetails called - sending message to parent Dashboard');
            window.parent.postMessage({
                type: 'openStockoutModal'
            }, '*');
        }
        
        function openWasteDetails() {
            console.log('🎯 openWasteDetails called - sending message to parent Dashboard');
            window.parent.postMessage({
                type: 'openWasteModal'
            }, '*');
        }
        
        function openUnusedDetails() {
            console.log('🎯 openUnusedDetails called - sending message to parent Dashboard');
            window.parent.postMessage({
                type: 'openUnusedModal'
            }, '*');
        }
        
        function openOverloadDetails() {
            console.log('🎯 openOverloadDetails called - sending message to parent Dashboard');
            window.parent.postMessage({
                type: 'openOverloadModal'
            }, '*');
        }
        
        // ==================================================================================
        // LOCAL MODAL FUNCTIONS (for standalone Analytics page)
        // ==================================================================================
        
        // Store current metric type for the modal
        window.currentPyxisMetric = null;
        
        function closePyxisModal() {
            const modal = document.getElementById('pyxisModal');
            if (!modal) return;
            modal.classList.add('closing');
            modal.classList.remove('active');
            document.body.style.overflow = '';
            // IMPORTANT: do NOT force display:none, otherwise the modal will never reopen.
            // Let CSS handle visibility based on the `active` class.
            setTimeout(() => {
                modal.classList.remove('closing');
            }, 300);
        }
        
        
        // ==================================================================================
        // SETTINGS - Received from Dashboard
        // ==================================================================================
        
        // Click outside to close modal
        document.getElementById('pyxisModal')?.addEventListener('click', function(e) {
            if (e.target === this) {
                closePyxisModal();
            }
        });
        
        // Store settings globally - will be updated by Dashboard via message
        // Initialize settings from localStorage (sync with Dashboard)
        window.analyticsSettings = {
            percentileCutoff: parseFloat(localStorage.getItem('usagePercentileCutoff')) || 0.95,
            usageRestockThreshold: parseFloat(localStorage.getItem('usageRestockThreshold')) || 0.50,
            budPeriod: parseInt(localStorage.getItem('budPeriod')) || 52
        };
        
        console.log('📊 Analytics settings initialized:', window.analyticsSettings);
        
        // Update threshold display immediately on load
        function updateThresholdDisplay() {
            const thresholdSpan = document.getElementById('thresholdValue');
            if (thresholdSpan && window.analyticsSettings.usageRestockThreshold) {
                thresholdSpan.textContent = window.analyticsSettings.usageRestockThreshold.toFixed(2);
                console.log('✓ Threshold display updated to:', window.analyticsSettings.usageRestockThreshold);
            }
        }
        
        // Call immediately and also on DOMContentLoaded
        setTimeout(updateThresholdDisplay, 100);
        
        // Listen for settings updates from Dashboard
        window.addEventListener('message', async function(event) {
            if (event.data.type === 'updateSettings') {
                console.log('⚙️ Analytics: Received settings update from Dashboard', event.data);
                
                // Update local settings
                if (event.data.settings.usageRestockThreshold !== undefined) {
                    window.analyticsSettings.usageRestockThreshold = event.data.settings.usageRestockThreshold;
                }
                if (event.data.settings.budPeriod !== undefined) {
                    window.analyticsSettings.budPeriod = event.data.settings.budPeriod;
                }
                if (event.data.settings.percentileCutoff !== undefined) {
                    window.analyticsSettings.percentileCutoff = event.data.settings.percentileCutoff;
                }
                
                // Receive projected waste data from Dashboard (single source of truth)
                if (event.data.projectedWaste) {
                    window.projectedWasteData = event.data.projectedWaste;
                    window.projectedWasteItems = event.data.projectedWaste.items;
                    window.projectedWasteAmount = event.data.projectedWaste.totalCost;
                    console.log('✓ Received projected waste from Dashboard:', {
                        totalCost: event.data.projectedWaste.totalCost,
                        itemCount: event.data.projectedWaste.itemCount,
                        shelfLife: event.data.projectedWaste.shelfLife
                    });
                    
                    // Immediately update Inventory Waste card
                    const wasteItemCountEl = document.getElementById('wasteCount');
                    if (wasteItemCountEl) {
                        wasteItemCountEl.textContent = event.data.projectedWaste.itemCount.toLocaleString('en-US');
                    }
                }
                
                // Receive Pyxis projected waste data from Dashboard
                if (event.data.pyxisProjectedWaste) {
                    window.pyxisProjectedWasteData = event.data.pyxisProjectedWaste;
                    window.pyxisProjectedWasteItems = event.data.pyxisProjectedWaste.items;
                    window.pyxisProjectedWasteAmount = event.data.pyxisProjectedWaste.totalCost;
                    console.log('✓ Received Pyxis projected waste from Dashboard:', {
                        totalCost: event.data.pyxisProjectedWaste.totalCost,
                        itemCount: event.data.pyxisProjectedWaste.itemCount
                    });
                }
                
                // Receive Usage vs Restock data from Dashboard
                if (event.data.usageVsRestock) {
                    window.usageVsRestockData = event.data.usageVsRestock;
                    window.itemsBelowThreshold = event.data.usageVsRestock.items;
                    console.log('✓ Received Usage vs Restock from Dashboard:', {
                        itemCount: event.data.usageVsRestock.itemCount,
                        threshold: event.data.usageVsRestock.threshold
                    });
                    
                    // Immediately update Usage vs Restock display
                    const usageRestockCount = document.getElementById('usageRestockCount');
                    if (usageRestockCount) {
                        usageRestockCount.textContent = event.data.usageVsRestock.itemCount.toLocaleString('en-US');
                    }
                }
                
                // Receive Pyxis Metrics data from Dashboard
                if (event.data.pyxisMetrics) {
                    window.pyxisMetricsData = event.data.pyxisMetrics;
                    console.log('✓ Received Pyxis Metrics from Dashboard:', event.data.pyxisMetrics.totals);

                    // Keep in sync with the "Expiring (Pyxis)" waste data used in modal.
                    const expRecs = buildExpiringPyxisRecordsFromMockData();
                    const expItemCount = new Set(expRecs.map(r => String(r.itemCode))).size;
                    window.pyxisMetricsData.totals.waste = expItemCount;
                    window.pyxisMetricsData.raw = window.pyxisMetricsData.raw || {};
                    window.pyxisMetricsData.raw.waste = expRecs;

                    renderPyxisAdjustmentOverviewCard(window.__latestComputedMockData || window.mockData || {});
                }
                
                // Update threshold display in card
                updateThresholdDisplay();
                
                // Recalculate analytics with new settings (async)
                console.log('📊 Recalculating analytics with new settings...');
                await populateAnalytics();
                console.log('✓ Analytics recalculated with new threshold:', window.analyticsSettings.usageRestockThreshold);
            }
            
            // Handle response with items for Pyxis modal (OUTSIDE updateSettings block)
            if (event.data.type === 'itemsByCodeResponse' && event.data.items) {
                console.log('✓ Received items for Pyxis modal:', event.data.items.length);
                renderPyxisModalContent(event.data.items);
            }
            
            // Handle trending items update (OUTSIDE updateSettings block)
            if (event.data.type === 'trendingItemsUpdate' && event.data.trendingItems) {
                const ti = event.data.trendingItems;
                const isValidTrending = ti && Array.isArray(ti.trendingUp);
                    if (ti && !Array.isArray(ti.trendingDown)) ti.trendingDown = [];
                if (!isValidTrending) {
                    console.warn('⚠️ Ignoring invalid trendingItemsUpdate payload (keeping last good):', ti);
                } else {
                    console.log('✓ Received trending items update:', {
                        trendingUp: ti.trendingUp.length,
                        trendingDown: ti.trendingDown.length,
                        threshold: ti.threshold
                    });
                    window.TrendFactsState = {
                        source: ti.source || 'unknown',
                        calculatedAt: ti.calculatedAt || '',
                        up: Array.isArray(ti.trendingUp) ? ti.trendingUp : [],
                        down: Array.isArray(ti.trendingDown) ? ti.trendingDown : [],
                        loadedAt: new Date().toISOString()
                    };
                    window.trendingItems = getTrendingItemsFromState();
                    window.__lastGoodTrendingItems = window.trendingItems;
                    window.__hasEverReceivedTrendingItems = true;
                    updateTopUsedItemsCard();
                }
            }
        });
        
        // Update threshold display on page load
        document.addEventListener('DOMContentLoaded', function() {
            updateThresholdDisplay();
        });
        
        
        
        // ==================================================================================
        // CONSOLIDATED PYXIS MODAL SYSTEM
        // ==================================================================================

        // Helper: sublocation reference map (loaded from location_ref_mockdata.js)
        function getSublocationMapSafe() {
            return (window && (window.SUBLOCATION_MAP || window.__SUBLOCATION_MAP)) || {};
        }

        function monthsFromNow(months) {
            const d = new Date();
            const m = Number(months) || 0;
            d.setMonth(d.getMonth() + m);
            // Normalize to end-of-day to avoid TZ edge cases
            d.setHours(23, 59, 59, 999);
            return d;
        }

        // Waste card sparkline (4 bars): cumulative counts of Pyxis items expiring in 1..4 months
        function updateWasteExpiringSparkline() {
            const container = document.getElementById('wasteSpark');
            if (!container) return;

            const counts = [1, 2, 3, 4].map((m) => {
                const recs = buildExpiringPyxisRecordsFromMockData(m);
                return new Set(recs.map(r => String(r.itemCode))).size;
            });

            const max = Math.max(1, ...counts);
            container.innerHTML = '';

            counts.forEach((count, idx) => {
                const bar = document.createElement('div');
                bar.className = 'spark-bar';
                // 14px min, 56px max
                const h = 14 + Math.round((count / max) * 42);
                bar.style.height = `${h}px`;
                bar.title = `≤${idx + 1} month${idx === 0 ? '' : 's'}: ${count} item${count === 1 ? '' : 's'}`;
                container.appendChild(bar);
            });
        }

        function buildExpiringPyxisRecordsFromMockData(monthsOverride) {
            const computed = window.__latestComputedMockData || window.mockData || null;
            if (!computed || !computed.inventory) return [];

            const monthsWindow = Number.isFinite(Number(monthsOverride))
                ? Math.max(0, parseInt(monthsOverride, 10))
                : parseInt(localStorage.getItem('expiringMonths') || '3', 10);
            const cutoff = monthsFromNow(monthsWindow);

            const subMap = getSublocationMapSafe();
            const items = Array.isArray(computed.items) ? computed.items : [];
            const itemByCode = new Map(items.map(it => [String(it.itemCode ?? it.code ?? ''), it]));

            const records = [];

            const pushRec = (itemCode, drugName, location, sublocation, qty, unitCost, isStandard) => {
                const q = Number(qty) || 0;
                if (q <= 0) return;
                records.push({
                    metricType: 'waste', // keep wiring compatible; this card now represents expiring items
                    itemCode: String(itemCode),
                    drugName: drugName || String(itemCode),
                    location: location || 'Unknown',
                    sublocation: sublocation || '',
                    frequency: q,
                    cost: (Number(unitCost) || 0) * q,
                    standard: !!isStandard,
                    details: { expiringQty: q, unitCost: Number(unitCost) || 0 }
                });
            };

            for (const [code, invEntry] of Object.entries(computed.inventory)) {
                const item = itemByCode.get(String(code)) || {};
                const drugName = item.description || item.drugName || item.genericName || item.name || String(code);
                const unitCost = Number(item.unitPrice || item.costPerUnit || item.wacPrice || 0);

                // Shape A: { sublocations: [{sublocation, curQty, expires, standard, ...}, ...] }
                if (invEntry && Array.isArray(invEntry.sublocations)) {
                    invEntry.sublocations.forEach((row) => {
                        const sub = row.sublocation;
                        const meta = subMap[sub] || {};
                        const dept = meta.department || meta.dept || '';
                        if (String(dept).toLowerCase() !== 'pyxis') return;
                        const exp = row.expires;
                        if (!exp) return;
                        const d = new Date(exp);
                        if (Number.isNaN(d.getTime()) || d > cutoff) return;
                        pushRec(code, drugName, meta.mainLocation || meta.location || sub, sub, row.curQty ?? row.qty ?? 0, unitCost, row.standard);
                    });
                    continue;
                }

                // Shape B: { "3TWA": {qty, expires, standard, ...}, ... }
                if (invEntry && typeof invEntry === 'object') {
                    for (const [sub, loc] of Object.entries(invEntry)) {
                        const meta = subMap[sub] || {};
                        const dept = meta.department || meta.dept || '';
                        if (String(dept).toLowerCase() !== 'pyxis') continue;
                        const exp = loc && loc.expires;
                        if (!exp) continue;
                        const d = new Date(exp);
                        if (Number.isNaN(d.getTime()) || d > cutoff) continue;
                        pushRec(code, drugName, meta.mainLocation || meta.location || sub, sub, loc.qty ?? loc.curQty ?? 0, unitCost, loc.standard);
                    }
                }
            }

            return records;
        }
        
        /**
         * Configuration for each metric type
         */
        const PYXIS_METRIC_CONFIG = {
            stockOut: {
                title: 'Stock Out Details by Area',
                icon: '<path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M16.59,7.58L10,14.17L7.41,11.59L6,13L10,17L18,9L16.59,7.58Z"/>',
                dataKey: 'stockOut',
                itemsKey: 'stockOutItems'
            },
            waste: {
                title: 'Waste Details by Area',
                icon: '<path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/>',
                dataKey: 'waste',
                itemsKey: 'wasteItems'
            },
};
        
        /**
         * Open consolidated Pyxis modal for any metric type
         */
        function openPyxisModal(metricType) {
            console.log('📊 Opening Pyxis modal for:', metricType);

            if (!window.pyxisMetricsData || !window.pyxisMetricsData.raw) {
                console.warn('⚠️ No Pyxis metrics data available');
                return;
            }

            const modal = document.getElementById('pyxisModal');
            const titleEl = document.getElementById('pyxisModalTitle');
            const iconEl = document.getElementById('pyxisModalIcon');

            if (!modal || !titleEl || !iconEl) {
                console.error('❌ Pyxis modal elements not found');
                return;
            }

            // Ensure any previous inline style doesn't block reopening
            modal.style.display = '';

            const config = {
                stockOut: { title: 'Stock Outs', icon: '<path d="M19,3H5C3.89,3 3,3.89 3,5V19C3,20.11 3.89,21 5,21H19C20.11,21 21,20.11 21,19V5C21,3.89 20.11,3 19,3M19,5V19H5V5H19M17,17H7V15H17V17M17,13H7V11H17V13M17,9H7V7H17V9Z"/>', color: '#ff6b6b' },
                waste:    { title: 'Waste',     icon: '<path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/>', color: '#ff9800' },
};

            const selected = config[metricType];
            if (!selected) {
                console.error('❌ Unknown Pyxis metric type:', metricType);
                return;
            }

            titleEl.textContent = `Pyxis Metrics - ${selected.title}`;
            iconEl.innerHTML = selected.icon;
            iconEl.style.fill = selected.color;

            // Build state (records + aggregates)
            window.pyxisModalState = buildPyxisModalState(metricType);

            // Reset UI
            document.getElementById('pyxisSortSelect').value = window.pyxisModalState.sortBy;
            setPyxisSummaryValues(window.pyxisModalState);
            selectPyxisSummary('items');

            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function buildPyxisModalState(metricType) {
            const raw = window.pyxisMetricsData?.raw || {};

            const records = [];
            const metricList = (() => {
                if (metricType === 'stockOut') return raw.stockOuts || [];
                // Waste card is repurposed to show EXPIRING items in Pyxis (configurable months window).
                // We derive this from the inventory payload because per-location expires live there.
                if (metricType === 'waste') return buildExpiringPyxisRecordsFromMockData();
                if (metricType === 'unused') return raw.unused || [];
                if (metricType === 'overLoad') return raw.overLoad || [];
                return [];
            })();

            metricList.forEach((entry) => {
                // For expiring records we already have normalized record objects.
                if (metricType === 'waste' && entry && entry.itemCode) {
                    records.push(entry);
                    return;
                }
                if (metricType === 'stockOut') {
                    records.push({
                        metricType,
                        itemCode: entry.itemCode,
                        drugName: entry.drugName,
                        location: entry.mainLocation || 'Unknown',
                        sublocation: entry.sublocation || '',
                        frequency: 1,
                        cost: 0,
                        details: { curQty: entry.curQty ?? 0, minQty: entry.minQty ?? 0, maxQty: entry.maxQty ?? 0 }
                    });
                } else if (metricType === 'overLoad') {
                    const unit = Number(entry.costPerUnit || 0);
                    const overageQty = Number(entry.overageQty || 0);
                    records.push({
                        metricType,
                        itemCode: entry.itemCode,
                        drugName: entry.drugName,
                        location: entry.mainLocation || 'Unknown',
                        sublocation: entry.sublocation || '',
                        frequency: 1,
                        cost: unit * overageQty,
                        details: { curQty: entry.curQty ?? 0, maxQty: entry.maxQty ?? 0, overageQty, overagePercent: entry.overagePercent }
                    });
                } else if (metricType === 'waste') {
                    // Expiring record (already normalized by buildExpiringPyxisRecordsFromMockData)
                    records.push({
                        metricType,
                        itemCode: entry.itemCode,
                        drugName: entry.drugName,
                        location: entry.location || 'Unknown',
                        sublocation: entry.sublocation || '',
                        frequency: Number(entry.frequency || 0),
                        cost: Number(entry.cost || 0),
                        standard: !!entry.standard,
                        details: entry.details || {}
                    });
                } else if (metricType === 'unused') {
                    const unit = Number(entry.costPerUnit || 0);
                    const totalQty = Number(entry.totalQty || 0);
                    const location = (entry.sublocations && entry.sublocations[0] && entry.sublocations[0].mainLocation) || 'Unknown';
                    records.push({
                        metricType,
                        itemCode: entry.itemCode,
                        drugName: entry.drugName,
                        location,
                        sublocation: '',
                        frequency: totalQty,
                        cost: unit * totalQty,
                        details: { totalQty, unitCost: unit }
                    });
                }
            });

            const uniqueItems = new Set(records.map(r => r.itemCode)).size;
            const uniqueLocations = new Set(records.map(r => r.location)).size;
            const totalCost = records.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

            return {
                metricType,
                sortBy: 'cost',
                selectedSummary: 'items',
                records,
                totals: {
                    items: uniqueItems,
                    locations: uniqueLocations,
                    cost: totalCost
                }
            };
        }

        function setPyxisSummaryValues(state) {
            const itemsEl = document.getElementById('pyxisSummaryItemsValue');
            const locEl = document.getElementById('pyxisSummaryLocationsValue');
            const costEl = document.getElementById('pyxisSummaryCostValue');
            if (itemsEl) itemsEl.textContent = state.totals.items.toLocaleString();
            if (locEl) locEl.textContent = state.totals.locations.toLocaleString();
            if (costEl) costEl.textContent = formatCurrency(state.totals.cost);
        }

        function onPyxisSortChange() {
            if (!window.pyxisModalState) return;
            const sel = document.getElementById('pyxisSortSelect');
            window.pyxisModalState.sortBy = sel ? sel.value : 'cost';
            renderPyxisExpandableList();
        }

        function selectPyxisSummary(kind) {
            if (!window.pyxisModalState) return;
            window.pyxisModalState.selectedSummary = kind;

            // Active card UI
            ['items', 'locations', 'cost'].forEach(k => {
                const el = document.getElementById(k === 'items' ? 'pyxisSummaryItems' : k === 'locations' ? 'pyxisSummaryLocations' : 'pyxisSummaryCost');
                if (el) el.classList.toggle('active', k === kind);
            });

            const section = document.getElementById('pyxisListSection');
            if (section) section.style.display = 'block';
            renderPyxisExpandableList();
        }

        // ----------------------------------------------------------------------------------
        // PYXIS EXPANDABLE LIST (companion-modal-like)
        // ----------------------------------------------------------------------------------

        function renderPyxisExpandableList() {
            const state = window.pyxisModalState;
            if (!state) return;

            const titleEl = document.getElementById('pyxisListTitle');
            const subtitleEl = document.getElementById('pyxisListSubtitle');
            const body = document.getElementById('pyxisListBody');
            if (!body) return;

            const sortBy = state.sortBy || 'cost';
            // UX request: when Sort By = Location, always group by location regardless of the selected summary card.
            const mode = (sortBy === 'location') ? 'locations' : (state.selectedSummary || 'items');

            const fmtCount = (n) => (Number(n) || 0).toLocaleString();
            const fmtMoney = (n) => formatCurrency(Number(n) || 0);

            const records = Array.isArray(state.records) ? state.records : [];

            // Build groups
            const groups = [];

            if (mode === 'locations') {
                // Location -> Sublocation -> Items
                // This enables a sublocation drilldown without changing the summary cards UI.
                const normSub = (s) => {
                    const t = (s == null) ? '' : String(s).trim();
                    return t || '—';
                };

                const byLoc = new Map();
                for (const r of records) {
                    const loc = r.location || 'Unknown';
                    if (!byLoc.has(loc)) {
                        byLoc.set(loc, {
                            key: loc,
                            label: loc,
                            totalFreq: 0,
                            totalCost: 0,
                            standard: false,
                            subMap: new Map() // sublocation -> { label, totalFreq, totalCost, standard, items: Map }
                        });
                    }

                    const g = byLoc.get(loc);
                    const freq = Number(r.frequency || 0);
                    const cost = Number(r.cost || 0);
                    g.totalFreq += freq;
                    g.totalCost += cost;
                    g.standard = g.standard || !!r.standard;

                    const sub = normSub(r.sublocation);
                    if (!g.subMap.has(sub)) {
                        g.subMap.set(sub, {
                            key: sub,
                            label: sub,
                            totalFreq: 0,
                            totalCost: 0,
                            standard: false,
                            items: new Map() // itemCode -> { label, itemCode, count, cost, standard }
                        });
                    }

                    const sg = g.subMap.get(sub);
                    sg.totalFreq += freq;
                    sg.totalCost += cost;
                    sg.standard = sg.standard || !!r.standard;

                    const itemKey = r.itemCode || (r.drugName || '');
                    if (!sg.items.has(itemKey)) {
                        sg.items.set(itemKey, {
                            label: r.drugName || '',
                            itemCode: r.itemCode || '',
                            count: 0,
                            cost: 0,
                            standard: false
                        });
                    }
                    const ir = sg.items.get(itemKey);
                    ir.count += freq;
                    ir.cost += cost;
                    ir.standard = ir.standard || !!r.standard;
                }

                for (const g of byLoc.values()) {
                    const subRows = Array.from(g.subMap.values()).map(sg => {
                        const items = Array.from(sg.items.values());
                        items.sort((a, b) => (b.count - a.count) || (b.cost - a.cost) || (a.label || '').localeCompare(b.label || ''));
                        return { ...sg, items };
                    });
                    // default: most at-risk / highest activity sublocations first
                    subRows.sort((a, b) => (b.totalFreq - a.totalFreq) || (b.totalCost - a.totalCost) || (a.label || '').localeCompare(b.label || ''));
                    groups.push({ ...g, rows: subRows });
                }

                if (titleEl) titleEl.textContent = 'LOCATIONS';
                if (subtitleEl) subtitleEl.textContent = `Sorted by ${sortBy}`;
            } else {
                // items or cost view: group by item
                const byItem = new Map();
                for (const r of records) {
                    const code = r.itemCode || 'Unknown';
                    const label = r.drugName || code;
                    if (!byItem.has(code)) byItem.set(code, { key: code, label, itemCode: code, totalFreq: 0, totalCost: 0, standard: false, rows: new Map() });
                    const g = byItem.get(code);
                    g.totalFreq += Number(r.frequency || 0);
                    g.totalCost += Number(r.cost || 0);
                    g.standard = g.standard || !!r.standard;
                    const loc = r.location || 'Unknown';
                    if (!g.rows.has(loc)) g.rows.set(loc, { label: loc, count: 0, cost: 0 });
                    const row = g.rows.get(loc);
                    row.count += Number(r.frequency || 0);
                    row.cost += Number(r.cost || 0);
                }
                for (const g of byItem.values()) {
                    const rows = Array.from(g.rows.values());
                    if (mode === 'cost') {
                        // Cost mode: show location with cost badge
                        rows.sort((a, b) => (b.cost - a.cost) || (b.count - a.count) || (a.label || '').localeCompare(b.label || ''));
                    } else {
                        // Count mode: show location with count badge
                        rows.sort((a, b) => (b.count - a.count) || (b.cost - a.cost) || (a.label || '').localeCompare(b.label || ''));
                    }
                    groups.push({ ...g, rows });
                }

                if (titleEl) titleEl.textContent = mode === 'cost' ? 'COST' : 'COUNT';
                if (subtitleEl) subtitleEl.textContent = `Sorted by ${sortBy}`;
            }

            // Sort groups
            groups.sort((a, b) => {
                if (sortBy === 'frequency') return (b.totalFreq - a.totalFreq) || (b.totalCost - a.totalCost) || (a.label || '').localeCompare(b.label || '');
                if (sortBy === 'location') return (a.label || '').localeCompare(b.label || '') || (b.totalCost - a.totalCost) || (b.totalFreq - a.totalFreq);
                // cost
                return (b.totalCost - a.totalCost) || (b.totalFreq - a.totalFreq) || (a.label || '').localeCompare(b.label || '');
            });

            // Render
            body.innerHTML = '';

            if (!groups.length) {
                body.innerHTML = `<div class="pyxis-empty">No data available</div>`;
                return;
            }

            const makeBadge = (text, variant) => {
                const span = document.createElement('span');
                span.className = `pyxis-badge ${variant || ''}`.trim();
                span.textContent = text;
                return span;
            };

            const makeRow = (label, badgeText, badgeVariant, opts) => {
                const row = document.createElement('div');
                row.className = 'pyxis-acc-row';
                const left = document.createElement('div');
                left.className = 'pyxis-acc-row-label';
                left.textContent = label;
                const rightWrap = document.createElement('div');
                rightWrap.style.display = 'flex';
                rightWrap.style.alignItems = 'center';
                rightWrap.style.gap = '8px';
                if (opts && opts.standard) {
                    rightWrap.appendChild(makeBadge('Standard', 'standard'));
                } else if (opts && opts.standard === false) {
                    rightWrap.appendChild(makeBadge('Non-standard', 'nonstandard'));
                }
                rightWrap.appendChild(makeBadge(badgeText, badgeVariant));
                row.appendChild(left);
                row.appendChild(rightWrap);
                return row;
            };

            groups.forEach((g, idx) => {
                const item = document.createElement('div');
                item.className = 'pyxis-acc-item';

                const header = document.createElement('button');
                header.type = 'button';
                header.className = 'pyxis-acc-header';
                header.setAttribute('aria-expanded', 'false');

                const title = document.createElement('div');
                title.className = 'pyxis-acc-title';
                title.textContent = g.label || '';

                const badges = document.createElement('div');
                badges.className = 'pyxis-acc-badges';

                // Standard badge (derived from items_inventory_mockdata standard=true in Pyxis locations)
                if (g.standard) {
                    badges.appendChild(makeBadge('Standard', 'standard'));
                } else {
                    badges.appendChild(makeBadge('Non-standard', 'nonstandard'));
                }

                // A subtle summary badge on the right (keeps UI informative but matches request)
                if (mode === 'cost') {
                    badges.appendChild(makeBadge(fmtMoney(g.totalCost), 'money'));
                } else if (mode === 'locations') {
                    // For location mode, rows represent sublocations.
                    badges.appendChild(makeBadge(fmtCount(g.rows.length), 'count'));
                } else {
                    badges.appendChild(makeBadge(fmtCount(g.totalFreq), 'count'));
                }

                const chevron = document.createElement('div');
                chevron.className = 'pyxis-acc-chevron';
                chevron.innerHTML = '&#9662;';

                header.appendChild(title);
                header.appendChild(badges);
                header.appendChild(chevron);

                const content = document.createElement('div');
                content.className = 'pyxis-acc-content';

                // Rows
                if (mode === 'locations') {
                    // location -> sublocation -> items
                    // Render as a nested accordion for fast drilldown.
                    g.rows.forEach((subRow, subIdx) => {
                        const subWrap = document.createElement('div');
                        subWrap.className = 'pyxis-sub-acc';
                        subWrap.style.borderTop = subIdx === 0 ? 'none' : '1px solid var(--border, rgba(255,255,255,0.08))';

                        const subHeader = document.createElement('button');
                        subHeader.type = 'button';
                        subHeader.className = 'pyxis-acc-row';
                        subHeader.style.width = '100%';
                        subHeader.style.background = 'transparent';
                        subHeader.style.border = 'none';
                        subHeader.style.padding = '10px 10px';
                        subHeader.style.cursor = 'pointer';
                        subHeader.style.textAlign = 'left';

                        const left = document.createElement('div');
                        left.className = 'pyxis-acc-row-label';
                        left.textContent = subRow.label || '—';

                        const rightWrap = document.createElement('div');
                        rightWrap.style.display = 'flex';
                        rightWrap.style.alignItems = 'center';
                        rightWrap.style.gap = '8px';
                        if (subRow.standard) rightWrap.appendChild(makeBadge('Standard', 'standard'));
                        rightWrap.appendChild(makeBadge(fmtCount(subRow.totalFreq), 'count'));
                        rightWrap.appendChild(makeBadge(fmtMoney(subRow.totalCost), 'money'));

                        subHeader.appendChild(left);
                        subHeader.appendChild(rightWrap);

                        const subContent = document.createElement('div');
                        subContent.style.display = 'none';
                        subContent.style.padding = '0 0 10px 10px';

                        // Items within sublocation
                        (subRow.items || []).forEach(it => {
                            const label = it.itemCode ? `${it.label} (${it.itemCode})` : (it.label || '');
                            subContent.appendChild(makeRow(label, fmtCount(it.count), 'count', { standard: !!it.standard }));
                        });

                        subHeader.addEventListener('click', () => {
                            const isOpen = subContent.style.display !== 'none';
                            subContent.style.display = isOpen ? 'none' : 'block';
                        });

                        subWrap.appendChild(subHeader);
                        subWrap.appendChild(subContent);
                        content.appendChild(subWrap);

                        // Auto-open the first sublocation for discoverability
                        if (subIdx === 0) {
                            subHeader.click();
                        }
                    });
                } else if (mode === 'cost') {
                    // item description -> location (with cost badge)
                    g.rows.forEach(r => {
                        content.appendChild(makeRow(r.label || '', fmtMoney(r.cost), 'money'));
                    });
                } else {
                    // count: item description -> location (with count badge)
                    g.rows.forEach(r => {
                        content.appendChild(makeRow(r.label || '', fmtCount(r.count), 'count'));
                    });
                }

                header.addEventListener('click', () => {
                    const expanded = header.getAttribute('aria-expanded') === 'true';
                    header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                    item.classList.toggle('expanded', !expanded);
                });

                item.appendChild(header);
                item.appendChild(content);
                body.appendChild(item);

                // Auto-expand first item for discoverability
                if (idx === 0) {
                    header.click();
                }
            });
        }

        function buildPyxisPrintTableHtml(state) {
            if (!state) return '';
            const records = Array.isArray(state.records) ? state.records : [];
            const sortBy = state.sortBy || 'cost';
            const mode = state.selectedSummary || 'items';
            const fmtCount = (n) => (Number(n) || 0).toLocaleString();
            const fmtMoney = (n) => formatCurrency(Number(n) || 0);

            // Build the same grouped structures as the on-screen list, but flatten into a print-friendly table.
            const rows = [];

            if (mode === 'locations') {
                const byLoc = new Map();
                for (const r of records) {
                    const loc = r.location || 'Unknown';
                    if (!byLoc.has(loc)) byLoc.set(loc, { loc, totalFreq: 0, totalCost: 0, items: new Map() });
                    const g = byLoc.get(loc);
                    g.totalFreq += Number(r.frequency || 0);
                    g.totalCost += Number(r.cost || 0);
                    const key = r.itemCode || (r.drugName || '');
                    if (!g.items.has(key)) g.items.set(key, { label: r.drugName || key, itemCode: r.itemCode || '', count: 0, cost: 0 });
                    const it = g.items.get(key);
                    it.count += Number(r.frequency || 0);
                    it.cost += Number(r.cost || 0);
                }
                const groups = Array.from(byLoc.values()).map(g => ({
                    label: g.loc,
                    totalFreq: g.totalFreq,
                    totalCost: g.totalCost,
                    items: Array.from(g.items.values())
                }));
                groups.sort((a, b) => {
                    if (sortBy === 'frequency') return (b.totalFreq - a.totalFreq) || (b.totalCost - a.totalCost) || a.label.localeCompare(b.label);
                    if (sortBy === 'location') return a.label.localeCompare(b.label);
                    return (b.totalCost - a.totalCost) || (b.totalFreq - a.totalFreq) || a.label.localeCompare(b.label);
                });
                groups.forEach(g => {
                    rows.push({ group: true, col1: g.label, col2: `Items: ${g.items.length}`, col3: `Events: ${fmtCount(g.totalFreq)}`, col4: fmtMoney(g.totalCost) });
                    const items = g.items.slice();
                    items.sort((a, b) => (b.count - a.count) || (b.cost - a.cost) || (a.label || '').localeCompare(b.label || ''));
                    items.forEach(it => {
                        const name = it.itemCode ? `${it.label} (${it.itemCode})` : it.label;
                        rows.push({ group: false, col1: name, col2: '', col3: fmtCount(it.count), col4: fmtMoney(it.cost) });
                    });
                });

                return `
                    <table>
                        <thead>
                            <tr>
                                <th>Location / Item</th>
                                <th>Items</th>
                                <th class="num">Frequency</th>
                                <th class="num">Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => r.group ? `
                                <tr>
                                    <td><strong>${escapeHtml(r.col1)}</strong></td>
                                    <td><strong>${escapeHtml(r.col2)}</strong></td>
                                    <td class="num"><strong>${escapeHtml(r.col3)}</strong></td>
                                    <td class="num"><strong>${escapeHtml(r.col4)}</strong></td>
                                </tr>
                            ` : `
                                <tr>
                                    <td style="padding-left:18px;">${escapeHtml(r.col1)}</td>
                                    <td>${escapeHtml(r.col2)}</td>
                                    <td class="num">${escapeHtml(r.col3)}</td>
                                    <td class="num">${escapeHtml(r.col4)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }

            // items or cost: group by item then list locations
            const byItem = new Map();
            for (const r of records) {
                const code = r.itemCode || 'Unknown';
                const label = r.drugName || code;
                if (!byItem.has(code)) byItem.set(code, { code, label, totalFreq: 0, totalCost: 0, locs: new Map() });
                const g = byItem.get(code);
                g.totalFreq += Number(r.frequency || 0);
                g.totalCost += Number(r.cost || 0);
                const loc = r.location || 'Unknown';
                if (!g.locs.has(loc)) g.locs.set(loc, { label: loc, count: 0, cost: 0 });
                const locRow = g.locs.get(loc);
                locRow.count += Number(r.frequency || 0);
                locRow.cost += Number(r.cost || 0);
            }
            const groups = Array.from(byItem.values()).map(g => ({
                label: g.label,
                itemCode: g.code,
                totalFreq: g.totalFreq,
                totalCost: g.totalCost,
                locs: Array.from(g.locs.values())
            }));
            groups.sort((a, b) => {
                if (sortBy === 'frequency') return (b.totalFreq - a.totalFreq) || (b.totalCost - a.totalCost) || (a.label || '').localeCompare(b.label || '');
                if (sortBy === 'location') return (a.label || '').localeCompare(b.label || '') || (b.totalCost - a.totalCost);
                return (b.totalCost - a.totalCost) || (b.totalFreq - a.totalFreq) || (a.label || '').localeCompare(b.label || '');
            });

            const showCostBadge = (mode === 'cost');
            const headers = showCostBadge ? ['Item / Location', 'Item Code', 'Location', 'Cost'] : ['Item / Location', 'Item Code', 'Location', 'Count'];
            const bodyRows = [];
            groups.forEach(g => {
                bodyRows.push({ group: true, item: g.label, code: g.itemCode, loc: '', val: showCostBadge ? fmtMoney(g.totalCost) : fmtCount(g.totalFreq) });
                const locs = g.locs.slice();
                locs.sort(showCostBadge
                    ? (a, b) => (b.cost - a.cost) || (b.count - a.count) || (a.label || '').localeCompare(b.label || '')
                    : (a, b) => (b.count - a.count) || (b.cost - a.cost) || (a.label || '').localeCompare(b.label || '')
                );
                locs.forEach(lr => {
                    bodyRows.push({ group: false, item: '', code: '', loc: lr.label, val: showCostBadge ? fmtMoney(lr.cost) : fmtCount(lr.count) });
                });
            });

            return `
                <table>
                    <thead>
                        <tr>
                            <th>${headers[0]}</th>
                            <th>${headers[1]}</th>
                            <th>${headers[2]}</th>
                            <th class="num">${headers[3]}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${bodyRows.map(r => r.group ? `
                            <tr>
                                <td><strong>${escapeHtml(r.item)}</strong></td>
                                <td><strong>${escapeHtml(r.code || '')}</strong></td>
                                <td></td>
                                <td class="num"><strong>${escapeHtml(r.val)}</strong></td>
                            </tr>
                        ` : `
                            <tr>
                                <td></td>
                                <td></td>
                                <td style="padding-left:18px;">${escapeHtml(r.loc)}</td>
                                <td class="num">${escapeHtml(r.val)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        function renderPyxisSummaryTable() {
            const state = window.pyxisModalState;
            if (!state) return;

            const title = document.getElementById('pyxisTableTitle');
            const subtitle = document.getElementById('pyxisTableSubtitle');
            const table = document.getElementById('pyxisSummaryTable');

            if (!table) return;

            const sortBy = state.sortBy;
            const mode = state.selectedSummary;

            const fmt = (n) => (Number(n) || 0).toLocaleString();
            const fmtCost = (n) => formatCurrency(Number(n) || 0);

            const records = [...state.records];
            const compare = {
                cost: (a, b) => (b.cost - a.cost) || (b.frequency - a.frequency) || a.location.localeCompare(b.location) || a.drugName.localeCompare(b.drugName),
                frequency: (a, b) => (b.frequency - a.frequency) || (b.cost - a.cost) || a.location.localeCompare(b.location) || a.drugName.localeCompare(b.drugName),
                location: (a, b) => a.location.localeCompare(b.location) || (b.cost - a.cost) || (b.frequency - a.frequency) || a.drugName.localeCompare(b.drugName)
            };

            if (mode === 'items') {
                // Aggregate by item
                const byItem = new Map();
                records.forEach(r => {
                    const key = r.itemCode;
                    if (!byItem.has(key)) byItem.set(key, { itemCode: r.itemCode, drugName: r.drugName, locations: new Set(), frequency: 0, cost: 0 });
                    const acc = byItem.get(key);
                    acc.locations.add(r.location);
                    acc.frequency += Number(r.frequency || 0);
                    acc.cost += Number(r.cost || 0);
                });
                const rows = Array.from(byItem.values()).map(r => ({ ...r, locationsCount: r.locations.size }));
                rows.sort((a, b) => {
                    if (sortBy === 'location') return (b.locationsCount - a.locationsCount) || (b.cost - a.cost) || (b.frequency - a.frequency) || a.drugName.localeCompare(b.drugName);
                    if (sortBy === 'frequency') return (b.frequency - a.frequency) || (b.cost - a.cost) || (b.locationsCount - a.locationsCount) || a.drugName.localeCompare(b.drugName);
                    return (b.cost - a.cost) || (b.frequency - a.frequency) || (b.locationsCount - a.locationsCount) || a.drugName.localeCompare(b.drugName);
                });

                if (title) title.textContent = 'Items';
                if (subtitle) subtitle.textContent = `Grouped by item • Sorted by ${sortBy}`;

                table.innerHTML = `
                    <thead>
                        <tr>
                            <th>Drug</th>
                            <th class="pyxis-td-muted">Item Code</th>
                            <th class="pyxis-td-num">Locations</th>
                            <th class="pyxis-td-num">Frequency</th>
                            <th class="pyxis-td-num">Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td>${escapeHtml(r.drugName || '')}</td>
                                <td class="pyxis-td-muted">${escapeHtml(r.itemCode || '')}</td>
                                <td class="pyxis-td-num">${fmt(r.locationsCount)}</td>
                                <td class="pyxis-td-num">${fmt(r.frequency)}</td>
                                <td class="pyxis-td-num">${fmtCost(r.cost)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;
                return;
            }

            if (mode === 'locations') {
                // Aggregate by location
                const byLoc = new Map();
                records.forEach(r => {
                    const key = r.location;
                    if (!byLoc.has(key)) byLoc.set(key, { location: key, items: new Set(), events: 0, cost: 0 });
                    const acc = byLoc.get(key);
                    acc.items.add(r.itemCode);
                    acc.events += 1;
                    acc.cost += Number(r.cost || 0);
                });
                const rows = Array.from(byLoc.values()).map(r => ({ ...r, itemCount: r.items.size }));
                rows.sort((a, b) => {
                    if (sortBy === 'frequency') return (b.events - a.events) || (b.cost - a.cost) || (b.itemCount - a.itemCount) || a.location.localeCompare(b.location);
                    if (sortBy === 'cost') return (b.cost - a.cost) || (b.events - a.events) || (b.itemCount - a.itemCount) || a.location.localeCompare(b.location);
                    return a.location.localeCompare(b.location);
                });

                if (title) title.textContent = 'Locations';
                if (subtitle) subtitle.textContent = `Grouped by location • Sorted by ${sortBy}`;

                table.innerHTML = `
                    <thead>
                        <tr>
                            <th>Location</th>
                            <th class="pyxis-td-num">Items</th>
                            <th class="pyxis-td-num">Events</th>
                            <th class="pyxis-td-num">Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td>${escapeHtml(r.location || '')}</td>
                                <td class="pyxis-td-num">${fmt(r.itemCount)}</td>
                                <td class="pyxis-td-num">${fmt(r.events)}</td>
                                <td class="pyxis-td-num">${fmtCost(r.cost)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;
                return;
            }

            // mode === 'cost' => detailed rows
            records.sort(compare[sortBy] || compare.cost);
            if (title) title.textContent = 'Details';
            if (subtitle) subtitle.textContent = `Detailed view • Sorted by ${sortBy}`;

            const extraCols = (() => {
                if (state.metricType === 'stockOut') return '<th class="pyxis-td-num">Min</th><th class="pyxis-td-num">Max</th>';
                if (state.metricType === 'overLoad') return '<th class="pyxis-td-num">Current</th><th class="pyxis-td-num">Max</th><th class="pyxis-td-num">Overage</th>';
                if (state.metricType === 'waste') return '<th class="pyxis-td-num">Waste</th>';
                if (state.metricType === 'unused') return '<th class="pyxis-td-num">Qty</th>';
                return '';
            })();

            const extraCells = (r) => {
                if (state.metricType === 'stockOut') return `<td class="pyxis-td-num">${fmt(r.details?.minQty ?? 0)}</td><td class="pyxis-td-num">${fmt(r.details?.maxQty ?? 0)}</td>`;
                if (state.metricType === 'overLoad') return `<td class="pyxis-td-num">${fmt(r.details?.curQty ?? 0)}</td><td class="pyxis-td-num">${fmt(r.details?.maxQty ?? 0)}</td><td class="pyxis-td-num">${fmt(r.details?.overageQty ?? 0)} (${escapeHtml(String(r.details?.overagePercent ?? ''))}%)</td>`;
                if (state.metricType === 'waste') return `<td class="pyxis-td-num">${fmt(r.details?.totalWaste ?? 0)}</td>`;
                if (state.metricType === 'unused') return `<td class="pyxis-td-num">${fmt(r.details?.totalQty ?? 0)}</td>`;
                return '';
            };

            table.innerHTML = `
                <thead>
                    <tr>
                        <th>Location</th>
                        <th>Drug</th>
                        <th class="pyxis-td-muted">Item Code</th>
                        ${extraCols}
                        <th class="pyxis-td-num">Cost</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                        <tr>
                            <td>${escapeHtml(r.location || '')}</td>
                            <td>${escapeHtml(r.drugName || '')}</td>
                            <td class="pyxis-td-muted">${escapeHtml(r.itemCode || '')}</td>
                            ${extraCells(r)}
                            <td class="pyxis-td-num">${fmtCost(r.cost)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            `;
        }

        function printPyxisModal(evt) {
            if (evt) evt.stopPropagation();
            if (!window.pyxisModalState) return;
            const state = window.pyxisModalState;
	            const printableTableHtml = buildPyxisPrintTableHtml(state);
	            if (!printableTableHtml) return;

            const printable = window.open('', '_blank');
            if (!printable) {
                alert('Popup blocked. Please allow popups to print.');
                return;
            }

            const title = `Pyxis Metrics - ${state.metricType}`;
            const summary = `Items: ${state.totals.items.toLocaleString()} • Locations: ${state.totals.locations.toLocaleString()} • Total Cost: ${formatCurrency(state.totals.cost)}`;

            printable.document.open();
            printable.document.write(`
                <!doctype html>
                <html>
                <head>
                    <meta charset="utf-8" />
                    <title>${escapeHtml(title)}</title>
                    <style>
                        body{font-family:Arial,Helvetica,sans-serif;margin:20px;color:#111}
                        h1{font-size:18px;margin:0 0 6px}
                        .sub{font-size:12px;color:#555;margin:0 0 14px}
                        table{width:100%;border-collapse:collapse}
                        th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left;vertical-align:top}
                        th{background:#f4f6f8;font-weight:700}
                        td.num{text-align:right;font-variant-numeric:tabular-nums}
                        @media print{.no-print{display:none}}
                    </style>
                </head>
                <body>
                    <div class="no-print" style="margin-bottom:12px;display:flex;gap:8px;">
                        <button onclick="window.print()">Print</button>
                        <button onclick="window.close()">Close</button>
                    </div>
                    <h1>${escapeHtml(title)}</h1>
                    <div class="sub">${escapeHtml(summary)}</div>
	                    ${printableTableHtml}
                    <script>
                        // Align numeric cells
                        Array.from(document.querySelectorAll('td.pyxis-td-num')).forEach(td=>td.classList.add('num'));
                    <\/script>
                </body>
                </html>
            `);
            printable.document.close();
        }
        
        function toggleNewPyxisLocation(location) {
            const sections = document.querySelectorAll('.pyxis-location-section');
            sections.forEach(section => {
                const header = section.querySelector('.pyxis-location-title .location-name');
                if (header && header.textContent === location) {
                    const content = section.querySelector('.pyxis-location-content');
                    const icon = section.querySelector('.collapse-icon');
                    if (content.classList.contains('expanded')) {
                        content.classList.remove('expanded');
                        content.classList.add('collapsed');
                        icon.style.transform = 'rotate(-90deg)';
                    } else {
                        content.classList.add('expanded');
                        content.classList.remove('collapsed');
                        icon.style.transform = 'rotate(0deg)';
                    }
                }
            });
        }
        
                function populatePyxisModal(metricType, config) {
            console.log(`📊 Populating Pyxis modal for: ${metricType}`);
            
            const areaList = document.getElementById('pyxisAreaList');
            
            // Get pyxis metrics data
            if (!window.pyxisMetricsData || !window.pyxisMetricsData.byLocation) {
                areaList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No data available</p>';
                return;
            }
            
            const locations = window.pyxisMetricsData.byLocation;
            const allItemCodes = window.pyxisMetricsData.allItems[config.dataKey] || [];
            
            console.log(`   Found ${allItemCodes.length} item codes for ${metricType}`);
            
            if (allItemCodes.length === 0) {
                areaList.innerHTML = `<p style="text-align: center; color: var(--text-secondary);">No ${config.title.toLowerCase()} found</p>`;
                return;
            }
            
            // Get full item data from parent's MOCK_DATA
            const allItems = [];
            const itemFrequency = {};
            
            allItemCodes.forEach(itemCode => {
                // Count frequency
                itemFrequency[itemCode] = (itemFrequency[itemCode] || 0) + 1;
            });
            
            // Get unique item codes and their data
            const uniqueItemCodes = [...new Set(allItemCodes)];
            
            // Request item data from parent
            window.parent.postMessage({
                type: 'requestItemsByCode',
                itemCodes: uniqueItemCodes
            }, '*');
            
            // Store temporary data while waiting for items
            window.pyxisModalData = {
                metricType: metricType,
                config: config,
                itemCodes: uniqueItemCodes,
                itemFrequency: itemFrequency,
                locations: locations,
                currentSort: 'cost' // Default sort
            };
            
            // Will render when items are received via postMessage
        }
        
        /**
         * Render Pyxis modal content (called after receiving item data)
         */
        /**
         * Render Pyxis modal content (called after receiving item data)
         */
        function calculateWeeklyTrends(metricType) {
            // Get stockOutsByArea data from Dashboard
            const areaData = window.pyxisMetricsData?.areaData || [];
            
            // Map metric type to data key
            const dataKeyMap = {
                'stockOut': 'stockOut',
                'waste': 'waste',
                'unused': 'unused',
                'overLoad': 'overLoad'
            };
            
            const dataKey = dataKeyMap[metricType];
            if (!dataKey) return [];
            
            // Collect all arrays for this metric
            const allArrays = [];
            areaData.forEach(area => {
                if (area.itemCode && Array.isArray(area[dataKey]) && area[dataKey].length > 0) {
                    allArrays.push(area[dataKey]);
                }
            });
            
            if (allArrays.length === 0) return [];
            
            // Find max length
            const maxLength = Math.max(...allArrays.map(arr => arr.length));
            
            // Sum values at each week position
            const weeklyTotals = [];
            for (let i = 0; i < maxLength; i++) {
                let total = 0;
                allArrays.forEach(arr => {
                    if (i < arr.length) {
                        total += (arr[i] || 0);
                    }
                });
                weeklyTotals.push(total);
            }
            
            return weeklyTotals;
        }
        
        /**
         * Generate HTML for trend bars
         */
        function generateTrendBars(trendData) {
            if (!trendData || trendData.length === 0) {
                return '<div style="color: var(--text-secondary); font-size: 0.9em;">No trend data</div>';
            }
            
            // Get last value and previous values
            const lastValue = trendData[trendData.length - 1];
            const previousValues = trendData.slice(0, -1);
            
            // Calculate max value for scaling
            const maxValue = Math.max(...trendData);
            
            // Generate bars
            let barsHtml = '<div class="trend-bars">';
            
            // Previous values (gray)
            previousValues.forEach(value => {
                const height = maxValue > 0 ? (value / maxValue * 100) : 0;
                barsHtml += `
                    <div class="trend-bar">
                        <div class="trend-bar-fill trend-bar-previous" style="height: ${height}%"></div>
                    </div>
                `;
            });
            
            // Last value (teal)
            const lastHeight = maxValue > 0 ? (lastValue / maxValue * 100) : 0;
            barsHtml += `
                <div class="trend-bar">
                    <div class="trend-bar-fill trend-bar-current" style="height: ${lastHeight}%"></div>
                </div>
            `;
            
            barsHtml += '</div>';
            
            return barsHtml;
        }
        
        function renderPyxisModalContent(items) {
            const areaList = document.getElementById('pyxisAreaList');
            const data = window.pyxisModalData;
            
            if (!data || !items || items.length === 0) {
                areaList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No items found</p>';
                return;
            }
            
            // Store items in modal data
            data.allItems = items;
            
            // Sort items based on current sort mode
            let sortedItems = [...items];
            switch (data.currentSort) {
                case 'description':
                    sortedItems.sort((a, b) => a.description.localeCompare(b.description));
                    break;
                case 'cost':
                    sortedItems.sort((a, b) => b.unitPrice - a.unitPrice);
                    break;
                case 'frequency':
                    sortedItems.sort((a, b) => {
                        const freqA = data.itemFrequency[a.itemCode] || 0;
                        const freqB = data.itemFrequency[b.itemCode] || 0;
                        return freqB - freqA;
                    });
                    break;
            }
            
            // Calculate summary stats
            const highestCostItem = sortedItems.reduce((max, item) => 
                item.unitPrice > max.unitPrice ? item : max, sortedItems[0]);
            
            const mostFrequentItem = sortedItems.reduce((max, item) => {
                const freq = data.itemFrequency[item.itemCode];
                const maxFreq = data.itemFrequency[max.itemCode];
                return freq > maxFreq ? item : max;
            }, sortedItems[0]);
            
            const mostFrequentCount = data.itemFrequency[mostFrequentItem.itemCode];
            
            // Get total count from pyxisMetrics (current week)
            const metricType = data.metricType;
            const totalCount = window.pyxisMetricsData?.totals?.[metricType] || sortedItems.length;
            
            // Get highest count locations
            const highestLocations = window.pyxisMetricsData?.highestCountLocations?.[metricType] || [];
            const locationDisplay = highestLocations.length > 0 
                ? highestLocations.map(loc => `${loc.location} (${loc.count})`).join(', ')
                : 'N/A';
            const locationCount = highestLocations.length > 0 ? highestLocations[0].count : 0;
            
            // Get trend data - calculate weekly totals from stockOutsByArea
            const trendData = calculateWeeklyTrends(metricType);
            const trendBars = generateTrendBars(trendData);
            
            // Build HTML with Shortage Bulletin style summary cards
            let html = `
                <!-- Summary Cards (Shortage Bulletin Style) -->
                <div class="modal-drug-info">
                    <div class="modal-info-item">
                        <div class="modal-info-label">Total Count</div>
                        <div class="modal-info-value">${totalCount}</div>
                    </div>
                    <div class="modal-info-item">
                        <div class="modal-info-label">Location</div>
                        <div class="modal-info-value">${locationCount}</div>
                        <div class="modal-info-sublabel">${locationDisplay}</div>
                    </div>
                    <div class="modal-info-item">
                        <div class="modal-info-label">Trend</div>
                        <div class="trend-bar-container">
                            ${trendBars}
                        </div>
                    </div>
                </div>
                
                <!-- Sort Controls -->
                <div class="modal-controls-section">
                    <div class="modal-sort-control">
                        <select class="modal-sort-select" id="pyxisSortSelect" onchange="changePyxisSort(this.value)">
                            <option value="cost" ${data.currentSort === 'cost' ? 'selected' : ''}>Sort by Cost</option>
                            <option value="description" ${data.currentSort === 'description' ? 'selected' : ''}>Sort by Item Description</option>
                            <option value="frequency" ${data.currentSort === 'frequency' ? 'selected' : ''}>Sort by Frequency</option>
                        </select>
                    </div>
                </div>
            `;
            
            // Group by location
            const locationGroups = {};
            const config = data.config;
            
            // Build location groups from pyxisMetricsData
            data.locations.forEach(locationData => {
                const location = locationData.location;
                
                locationData.sublocations.forEach(sublocationData => {
                    const sublocation = sublocationData.sublocation;
                    const itemCodes = sublocationData[config.itemsKey] || [];
                    
                    if (itemCodes.length > 0) {
                        if (!locationGroups[location]) {
                            locationGroups[location] = {};
                        }
                        if (!locationGroups[location][sublocation]) {
                            locationGroups[location][sublocation] = [];
                        }
                        
                        // Get full item data for these codes
                        itemCodes.forEach(code => {
                            const item = sortedItems.find(i => i.itemCode === code);
                            if (item) {
                                locationGroups[location][sublocation].push(item);
                            }
                        });
                    }
                });
            });
            
            // Build location cards (accordion style)
            Object.keys(locationGroups).forEach((location, locIdx) => {
                const sublocations = locationGroups[location];
                const totalCount = Object.values(sublocations).reduce((sum, items) => sum + items.length, 0);
                
                if (totalCount > 0) {
                    html += `
                        <div class="area-card" id="pyxis-location-${locIdx}">
                            <div class="area-card-header" onclick="togglePyxisLocation(${locIdx})">
                                <div class="area-card-header-left">
                                    <svg class="area-expand-icon" viewBox="0 0 24 24">
                                        <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/>
                                    </svg>
                                    <div class="area-name">${location}</div>
                                </div>
                                <div class="area-badge">${totalCount}</div>
                            </div>
                            <div class="sublocation-list">
                    `;
                    
                    Object.keys(sublocations).forEach((sublocation, subIdx) => {
                        const items = sublocations[sublocation];
                        if (items.length > 0) {
                            html += `
                                <div class="sublocation-item" id="pyxis-sublocation-${locIdx}-${subIdx}">
                                    <div class="sublocation-header" onclick="togglePyxisSublocation(${locIdx}, ${subIdx})">
                                        <div class="sublocation-header-left">
                                            <svg class="sublocation-expand-icon" viewBox="0 0 24 24">
                                                <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/>
                                            </svg>
                                            <div class="sublocation-name">${sublocation}</div>
                                        </div>
                                        <div class="sublocation-badge">${items.length}</div>
                                    </div>
                                    <div class="item-list">
                            `;
                            
                            items.forEach(item => {
                                const frequency = data.itemFrequency[item.itemCode] || 1;
                                html += `
                                    <div class="item-row">
                                        <div class="item-info">
                                            <div class="item-description">${item.description}</div>
                                            <div class="item-meta">
                                                <span class="item-code">Code: ${item.itemCode}</span>
                                                ${frequency > 1 ? `<span class="item-frequency">Frequency: ${frequency}×</span>` : ''}
                                            </div>
                                        </div>
                                        <div class="item-cost">$${parseFloat(item.unitPrice).toFixed(2)}</div>
                                    </div>
                                `;
                            });
                            
                            html += `
                                    </div>
                                </div>
                            `;
                        }
                    });
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
            });
            
            areaList.innerHTML = html;
            console.log(`✓ Pyxis modal rendered with ${sortedItems.length} items`);
        }
        
        /**
         * Toggle location accordion in Pyxis modal
         */
        function togglePyxisLocation(locIdx) {
            const card = document.getElementById(`pyxis-location-${locIdx}`);
            card.classList.toggle('expanded');
        }
        
        /**
         * Toggle sublocation accordion in Pyxis modal
         */
        function togglePyxisSublocation(locIdx, subIdx) {
            const item = document.getElementById(`pyxis-sublocation-${locIdx}-${subIdx}`);
            item.classList.toggle('expanded');
        }
        
        /**
         * Change sort order in Pyxis modal
         */
        function changePyxisSort(sortBy) {
            if (window.pyxisModalData) {
                window.pyxisModalData.currentSort = sortBy;
                renderPyxisModalContent(window.pyxisModalData.allItems);
            }
        }
        
        // ==================================================================================
        // COMPLETE MODAL POPULATION FUNCTIONS (LEGACY - kept for backwards compatibility)
        // ==================================================================================
        
        function populateStockoutModal() {
            console.log('🔍 populateStockoutModal called');
            const areaList = document.getElementById('stockoutAreaList');
            
            if (!window.currentAreaData) {
                console.error('❌ No area data available');
                areaList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No data available. Please ensure the dashboard has loaded area data.</p>';
                return;
            }
            
            console.log('✓ Area data found:', window.currentAreaData);
            console.log('📊 Sample area item:', window.currentAreaData[0]);
            
            // Collect all items with their details
            const allItems = [];
            const itemFrequency = {}; // Track how many times each item appears
            
            window.currentAreaData.forEach(area => {
                if (area.stockOut && Array.isArray(area.stockOut)) {
                    area.stockOut.forEach(itemCode => {
                        const item = MOCK_DATA.find(d => d.itemCode === itemCode);
                        if (item) {
                            const unitPrice = parseFloat(item.unitPrice) || 0;
                            allItems.push({
                                itemCode: item.itemCode,
                                description: item.description,
                                unitPrice: unitPrice,
                                location: area.location,
                                sublocation: area.sublocation
                            });
                            
                            // Track frequency
                            itemFrequency[item.itemCode] = (itemFrequency[item.itemCode] || 0) + 1;
                        }
                    });
                }
            });
            
            // Sort items by unitPrice (highest to lowest) initially
            allItems.sort((a, b) => b.unitPrice - a.unitPrice);
            
            // Calculate summary stats
            const highestCostItem = allItems.length > 0 ? allItems[0] : null;
            const mostFrequentItem = allItems.length > 0 ? 
                allItems.reduce((max, item) => {
                    const freq = itemFrequency[item.itemCode];
                    const maxFreq = itemFrequency[max.itemCode];
                    return freq > maxFreq ? item : max;
                }) : null;
            
            // Store items for sorting
            window.stockoutModalData = {
                allItems: allItems,
                itemFrequency: itemFrequency,
                currentSort: 'cost' // Default sort
            };
            
            // Render the modal
            renderStockoutModalContent();
        }
        
        function renderStockoutModalContent() {
            const areaList = document.getElementById('stockoutAreaList');
            const data = window.stockoutModalData;
            
            if (!data || !data.allItems || data.allItems.length === 0) {
                areaList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No stock outs found</p>';
                return;
            }
            
            // Sort items based on current sort mode
            let sortedItems = [...data.allItems];
            switch (data.currentSort) {
                case 'description':
                    sortedItems.sort((a, b) => a.description.localeCompare(b.description));
                    break;
                case 'cost':
                    sortedItems.sort((a, b) => b.unitPrice - a.unitPrice);
                    break;
                case 'frequency':
                    sortedItems.sort((a, b) => {
                        const freqA = data.itemFrequency[a.itemCode] || 0;
                        const freqB = data.itemFrequency[b.itemCode] || 0;
                        return freqB - freqA;
                    });
                    break;
            }
            
            // Calculate summary stats
            const highestCostItem = sortedItems.reduce((max, item) => 
                item.unitPrice > max.unitPrice ? item : max, sortedItems[0]);
            
            const mostFrequentItem = sortedItems.reduce((max, item) => {
                const freq = data.itemFrequency[item.itemCode];
                const maxFreq = data.itemFrequency[max.itemCode];
                return freq > maxFreq ? item : max;
            }, sortedItems[0]);
            
            const mostFrequentCount = data.itemFrequency[mostFrequentItem.itemCode];
            
            // Build HTML
            let html = `
                <!-- Summary Cards -->
                <div class="modal-summary-section">
                    <div class="modal-summary-card">
                        <div class="modal-summary-card-header">
                            <svg viewBox="0 0 24 24"><path d="M7,15H9C9,16.08 10.37,17 12,17C13.63,17 15,16.08 15,15C15,13.9 13.96,13.5 11.76,12.97C9.64,12.44 7,11.78 7,9C7,7.21 8.47,5.69 10.5,5.18V3H13.5V5.18C15.53,5.69 17,7.21 17,9H15C15,7.92 13.63,7 12,7C10.37,7 9,7.92 9,9C9,10.1 10.04,10.5 12.24,11.03C14.36,11.56 17,12.22 17,15C17,16.79 15.53,18.31 13.5,18.82V21H10.5V18.82C8.47,18.31 7,16.79 7,15Z"/></svg>
                            Highest Cost
                        </div>
                        <div class="modal-summary-card-value">$${highestCostItem.unitPrice.toFixed(2)}</div>
                        <div class="modal-summary-card-detail">${highestCostItem.description}</div>
                    </div>
                    <div class="modal-summary-card">
                        <div class="modal-summary-card-header">
                            <svg viewBox="0 0 24 24"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg>
                            Most Frequent
                        </div>
                        <div class="modal-summary-card-value">${mostFrequentCount}×</div>
                        <div class="modal-summary-card-detail">${mostFrequentItem.description}</div>
                    </div>
                </div>
                
                <!-- Sort Controls -->
                <div class="modal-controls-section">
                    <div class="modal-sort-control">
                        <svg viewBox="0 0 24 24"><path d="M18,21L14,17H17V7H14L18,3L22,7H19V17H22M2,19V17H12V19M2,13V11H9V13M2,7V5H6V7H2Z"/></svg>
                        <select class="modal-sort-select" id="stockoutSortSelect" onchange="changeStockoutSort(this.value)">
                            <option value="cost" ${data.currentSort === 'cost' ? 'selected' : ''}>Sort by Cost</option>
                            <option value="description" ${data.currentSort === 'description' ? 'selected' : ''}>Sort by Item Description</option>
                            <option value="frequency" ${data.currentSort === 'frequency' ? 'selected' : ''}>Sort by Frequency</option>
                        </select>
                    </div>
                </div>
            `;
            
            // Group by location
            const locationGroups = {};
            sortedItems.forEach(item => {
                if (!locationGroups[item.location]) {
                    locationGroups[item.location] = {};
                }
                if (!locationGroups[item.location][item.sublocation]) {
                    locationGroups[item.location][item.sublocation] = [];
                }
                locationGroups[item.location][item.sublocation].push(item);
            });
            
            // Build location cards (accordion style)
            Object.keys(locationGroups).forEach((location, locIdx) => {
                const sublocations = locationGroups[location];
                const totalCount = Object.values(sublocations).reduce((sum, items) => sum + items.length, 0);
                
                if (totalCount > 0) {
                    html += `
                        <div class="area-card" id="stockout-location-${locIdx}">
                            <div class="area-card-header" onclick="toggleStockoutLocation(${locIdx})">
                                <div class="area-card-header-left">
                                    <svg class="area-expand-icon" viewBox="0 0 24 24">
                                        <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/>
                                    </svg>
                                    <div class="area-name">${location}</div>
                                </div>
                                <div class="area-badge">${totalCount}</div>
                            </div>
                            <div class="sublocation-list">
                    `;
                    
                    Object.keys(sublocations).forEach((sublocation, subIdx) => {
                        const items = sublocations[sublocation];
                        if (items.length > 0) {
                            html += `
                                <div class="sublocation-item">
                                    <div class="sublocation-header">
                                        <div class="sublocation-header-left">
                                            <span class="sublocation-name">${sublocation}</span>
                                        </div>
                                        <span class="sublocation-badge">${items.length}</span>
                                    </div>
                                    <div class="item-list">
                            `;
                            
                            items.forEach(item => {
                                html += `
                                    <div class="item-row">
                                        <div class="item-description">
                                            <div class="item-bullet"></div>
                                            <span>${item.description}</span>
                                        </div>
                                        <div class="item-cost">$${item.unitPrice.toFixed(2)}</div>
                                    </div>
                                `;
                            });
                            
                            html += `
                                    </div>
                                </div>
                            `;
                        }
                    });
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
            });
            
            areaList.innerHTML = html;
            console.log('✓ Stock out modal rendered with sorting');
        }
        
        function changeStockoutSort(sortType) {
            if (window.stockoutModalData) {
                window.stockoutModalData.currentSort = sortType;
                renderStockoutModalContent();
            }
        }
        
        function toggleStockoutLocation(locIdx) {
            // Close all other locations first (accordion behavior)
            document.querySelectorAll('[id^="stockout-location-"]').forEach(card => {
                if (card.id !== `stockout-location-${locIdx}`) {
                    card.classList.remove('expanded');
                }
            });
            
            // Toggle the clicked location
            const card = document.getElementById(`stockout-location-${locIdx}`);
            if (card) {
                card.classList.toggle('expanded');
            }
        }
        
        function toggleLocation(locId) {
            const card = document.getElementById(typeof locId === 'number' ? `location-${locId}` : locId);
            if (card) {
                card.classList.toggle('expanded');
            }
        }
        
        function toggleSublocation(locId, subId) {
            const item = document.getElementById(
                subId !== undefined 
                    ? `subloc-${locId}-${subId}` 
                    : locId
            );
            if (item) {
                item.classList.toggle('expanded');
            }
        }
        
        function populateWasteModal() {
            console.log('🔍 populateWasteModal called');
            const areaList = document.getElementById('wasteAreaList');
            
            // Collect all waste items with their details
            const allItems = [];
            const itemFrequency = {};
            
            // Process location-based waste data
            if (window.pyxisMetricsData && window.pyxisMetricsData.byLocation) {
                const locations = window.pyxisMetricsData.byLocation;
                locations.forEach(location => {
                    location.sublocations.forEach(sub => {
                        if (sub.wasteItems && Array.isArray(sub.wasteItems)) {
                            sub.wasteItems.forEach(itemCode => {
                                const item = MOCK_DATA.find(d => d.itemCode === itemCode);
                                if (item) {
                                    const unitPrice = parseFloat(item.unitPrice) || 0;
                                    allItems.push({
                                        itemCode: item.itemCode,
                                        description: item.description,
                                        unitPrice: unitPrice,
                                        location: location.location,
                                        sublocation: sub.sublocation
                                    });
                                    
                                    itemFrequency[item.itemCode] = (itemFrequency[item.itemCode] || 0) + 1;
                                }
                            });
                        }
                    });
                });
            }
            
            // Sort items by unitPrice (highest to lowest) initially
            allItems.sort((a, b) => b.unitPrice - a.unitPrice);
            
            // Store data for sorting
            window.wasteModalData = {
                allItems: allItems,
                itemFrequency: itemFrequency,
                currentSort: 'cost'
            };
            
            // Render the modal
            renderWasteModalContent();
        }
        
        function renderWasteModalContent() {
            const areaList = document.getElementById('wasteAreaList');
            const data = window.wasteModalData;
            
            let html = '';
            
            // SECTION 1: Pyxis Projected Waste Summary
            if (window.pyxisProjectedWasteData) {
                const totalCost = window.pyxisProjectedWasteData.totalCost || 0;
                const itemCount = window.pyxisProjectedWasteData.itemCount || 0;
                
                html += `
                    <div class="waste-section">
                        <div class="waste-section-header">
                            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: var(--text-primary);">Projected Waste (Pyxis)</h3>
                        </div>
                        <div class="waste-summary-frame">
                            <div class="waste-summary-item">
                                <div class="waste-summary-label">Total Cost</div>
                                <div class="waste-summary-value">$${totalCost.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                })}</div>
                            </div>
                            <div class="waste-summary-item">
                                <div class="waste-summary-label">Item Count</div>
                                <div class="waste-summary-value">${itemCount.toLocaleString('en-US')}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
            
            // SECTION 2: Waste by Location with sorting
            if (data && data.allItems && data.allItems.length > 0) {
                // Sort items based on current sort mode
                let sortedItems = [...data.allItems];
                switch (data.currentSort) {
                    case 'description':
                        sortedItems.sort((a, b) => a.description.localeCompare(b.description));
                        break;
                    case 'cost':
                        sortedItems.sort((a, b) => b.unitPrice - a.unitPrice);
                        break;
                    case 'frequency':
                        sortedItems.sort((a, b) => {
                            const freqA = data.itemFrequency[a.itemCode] || 0;
                            const freqB = data.itemFrequency[b.itemCode] || 0;
                            return freqB - freqA;
                        });
                        break;
                }
                
                // Calculate summary stats
                const highestCostItem = sortedItems.reduce((max, item) => 
                    item.unitPrice > max.unitPrice ? item : max, sortedItems[0]);
                
                const mostFrequentItem = sortedItems.reduce((max, item) => {
                    const freq = data.itemFrequency[item.itemCode];
                    const maxFreq = data.itemFrequency[max.itemCode];
                    return freq > maxFreq ? item : max;
                }, sortedItems[0]);
                
                const mostFrequentCount = data.itemFrequency[mostFrequentItem.itemCode];
                
                html += `
                    <div class="waste-section" style="margin-top: 25px;">
                        <div class="waste-section-header">
                            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: var(--text-primary);">Waste by Location</h3>
                        </div>
                        
                        <!-- Summary Cards -->
                        <div class="modal-summary-section">
                            <div class="modal-summary-card">
                                <div class="modal-summary-card-header">
                                    <svg viewBox="0 0 24 24"><path d="M7,15H9C9,16.08 10.37,17 12,17C13.63,17 15,16.08 15,15C15,13.9 13.96,13.5 11.76,12.97C9.64,12.44 7,11.78 7,9C7,7.21 8.47,5.69 10.5,5.18V3H13.5V5.18C15.53,5.69 17,7.21 17,9H15C15,7.92 13.63,7 12,7C10.37,7 9,7.92 9,9C9,10.1 10.04,10.5 12.24,11.03C14.36,11.56 17,12.22 17,15C17,16.79 15.53,18.31 13.5,18.82V21H10.5V18.82C8.47,18.31 7,16.79 7,15Z"/></svg>
                                    Highest Cost
                                </div>
                                <div class="modal-summary-card-value">$${highestCostItem.unitPrice.toFixed(2)}</div>
                                <div class="modal-summary-card-detail">${highestCostItem.description}</div>
                            </div>
                            <div class="modal-summary-card">
                                <div class="modal-summary-card-header">
                                    <svg viewBox="0 0 24 24"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg>
                                    Most Frequent
                                </div>
                                <div class="modal-summary-card-value">${mostFrequentCount}×</div>
                                <div class="modal-summary-card-detail">${mostFrequentItem.description}</div>
                            </div>
                        </div>
                        
                        <!-- Sort Controls -->
                        <div class="modal-controls-section">
                            <div class="modal-sort-control">
                                <svg viewBox="0 0 24 24"><path d="M18,21L14,17H17V7H14L18,3L22,7H19V17H22M2,19V17H12V19M2,13V11H9V13M2,7V5H6V7H2Z"/></svg>
                                <select class="modal-sort-select" id="wasteSortSelect" onchange="changeWasteSort(this.value)">
                                    <option value="cost" ${data.currentSort === 'cost' ? 'selected' : ''}>Sort by Cost</option>
                                    <option value="description" ${data.currentSort === 'description' ? 'selected' : ''}>Sort by Item Description</option>
                                    <option value="frequency" ${data.currentSort === 'frequency' ? 'selected' : ''}>Sort by Frequency</option>
                                </select>
                            </div>
                        </div>
                `;
                
                // Group by location
                const locationGroups = {};
                sortedItems.forEach(item => {
                    if (!locationGroups[item.location]) {
                        locationGroups[item.location] = {};
                    }
                    if (!locationGroups[item.location][item.sublocation]) {
                        locationGroups[item.location][item.sublocation] = [];
                    }
                    locationGroups[item.location][item.sublocation].push(item);
                });
                
                // Build location cards (accordion style)
                Object.keys(locationGroups).forEach((location, locIdx) => {
                    const sublocations = locationGroups[location];
                    const totalCount = Object.values(sublocations).reduce((sum, items) => sum + items.length, 0);
                    
                    if (totalCount > 0) {
                        html += `
                            <div class="area-card" id="waste-location-${locIdx}">
                                <div class="area-card-header" onclick="toggleWasteLocation(${locIdx})">
                                    <div class="area-card-header-left">
                                        <svg class="area-expand-icon" viewBox="0 0 24 24">
                                            <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/>
                                        </svg>
                                        <div class="area-name">${location}</div>
                                    </div>
                                    <div class="area-badge">${totalCount}</div>
                                </div>
                                <div class="sublocation-list">
                        `;
                        
                        Object.keys(sublocations).forEach((sublocation, subIdx) => {
                            const items = sublocations[sublocation];
                            if (items.length > 0) {
                                html += `
                                    <div class="sublocation-item">
                                        <div class="sublocation-header">
                                            <div class="sublocation-header-left">
                                                <span class="sublocation-name">${sublocation}</span>
                                            </div>
                                            <span class="sublocation-badge">${items.length}</span>
                                        </div>
                                        <div class="item-list">
                                `;
                                
                                items.forEach(item => {
                                    html += `
                                        <div class="item-row">
                                            <div class="item-description">
                                                <div class="item-bullet"></div>
                                                <span>${item.description}</span>
                                            </div>
                                            <div class="item-cost">$${item.unitPrice.toFixed(2)}</div>
                                        </div>
                                    `;
                                });
                                
                                html += `
                                        </div>
                                    </div>
                                `;
                            }
                        });
                        
                        html += `
                                </div>
                            </div>
                        `;
                    }
                });
                
                html += '</div>';
            }
            
            if (!html) {
                html = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No waste data available</p>';
            }
            
            areaList.innerHTML = html;
            console.log('✓ Waste modal rendered with sorting');
        }
        
        function changeWasteSort(sortType) {
            if (window.wasteModalData) {
                window.wasteModalData.currentSort = sortType;
                renderWasteModalContent();
            }
        }
        
        function toggleWasteLocation(locIdx) {
            // Close all other locations first (accordion behavior)
            document.querySelectorAll('[id^="waste-location-"]').forEach(card => {
                if (card.id !== `waste-location-${locIdx}`) {
                    card.classList.remove('expanded');
                }
            });
            
            // Toggle the clicked location
            const card = document.getElementById(`waste-location-${locIdx}`);
            if (card) {
                card.classList.toggle('expanded');
            }
        }
        
        function populateUnusedModal() {
            console.log('🔍 populateUnusedModal called');
            const areaList = document.getElementById('unusedAreaList');
            
            if (!window.currentAreaData) {
                console.error('❌ No area data available');
                areaList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No data available. Please ensure the dashboard has loaded area data.</p>';
                return;
            }
            
            console.log('✓ Area data found:', window.currentAreaData);
            
            // Collect all unused items with their details
            const allItems = [];
            const itemFrequency = {};
            
            window.currentAreaData.forEach(area => {
                if (area.unusedItems && Array.isArray(area.unusedItems)) {
                    area.unusedItems.forEach(itemCode => {
                        const item = MOCK_DATA.find(d => d.itemCode === itemCode);
                        if (item) {
                            const unitPrice = parseFloat(item.unitPrice) || 0;
                            allItems.push({
                                itemCode: item.itemCode,
                                description: item.description,
                                unitPrice: unitPrice,
                                location: area.location,
                                sublocation: area.sublocation
                            });
                            
                            itemFrequency[item.itemCode] = (itemFrequency[item.itemCode] || 0) + 1;
                        }
                    });
                }
            });
            
            // Sort items by unitPrice (highest to lowest) initially
            allItems.sort((a, b) => b.unitPrice - a.unitPrice);
            
            // Store data for sorting
            window.unusedModalData = {
                allItems: allItems,
                itemFrequency: itemFrequency,
                currentSort: 'cost'
            };
            
            // Render the modal
            renderUnusedModalContent();
        }
        
        function renderUnusedModalContent() {
            const areaList = document.getElementById('unusedAreaList');
            const data = window.unusedModalData;
            
            if (!data || !data.allItems || data.allItems.length === 0) {
                areaList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No unused items found</p>';
                return;
            }
            
            // Sort items based on current sort mode
            let sortedItems = [...data.allItems];
            switch (data.currentSort) {
                case 'description':
                    sortedItems.sort((a, b) => a.description.localeCompare(b.description));
                    break;
                case 'cost':
                    sortedItems.sort((a, b) => b.unitPrice - a.unitPrice);
                    break;
                case 'frequency':
                    sortedItems.sort((a, b) => {
                        const freqA = data.itemFrequency[a.itemCode] || 0;
                        const freqB = data.itemFrequency[b.itemCode] || 0;
                        return freqB - freqA;
                    });
                    break;
            }
            
            // Calculate summary stats
            const highestCostItem = sortedItems.reduce((max, item) => 
                item.unitPrice > max.unitPrice ? item : max, sortedItems[0]);
            
            const mostFrequentItem = sortedItems.reduce((max, item) => {
                const freq = data.itemFrequency[item.itemCode];
                const maxFreq = data.itemFrequency[max.itemCode];
                return freq > maxFreq ? item : max;
            }, sortedItems[0]);
            
            const mostFrequentCount = data.itemFrequency[mostFrequentItem.itemCode];
            
            // Build HTML
            let html = `
                <!-- Summary Cards -->
                <div class="modal-summary-section">
                    <div class="modal-summary-card">
                        <div class="modal-summary-card-header">
                            <svg viewBox="0 0 24 24"><path d="M7,15H9C9,16.08 10.37,17 12,17C13.63,17 15,16.08 15,15C15,13.9 13.96,13.5 11.76,12.97C9.64,12.44 7,11.78 7,9C7,7.21 8.47,5.69 10.5,5.18V3H13.5V5.18C15.53,5.69 17,7.21 17,9H15C15,7.92 13.63,7 12,7C10.37,7 9,7.92 9,9C9,10.1 10.04,10.5 12.24,11.03C14.36,11.56 17,12.22 17,15C17,16.79 15.53,18.31 13.5,18.82V21H10.5V18.82C8.47,18.31 7,16.79 7,15Z"/></svg>
                            Highest Cost
                        </div>
                        <div class="modal-summary-card-value">$${highestCostItem.unitPrice.toFixed(2)}</div>
                        <div class="modal-summary-card-detail">${highestCostItem.description}</div>
                    </div>
                    <div class="modal-summary-card">
                        <div class="modal-summary-card-header">
                            <svg viewBox="0 0 24 24"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg>
                            Most Frequent
                        </div>
                        <div class="modal-summary-card-value">${mostFrequentCount}×</div>
                        <div class="modal-summary-card-detail">${mostFrequentItem.description}</div>
                    </div>
                </div>
                
                <!-- Sort Controls -->
                <div class="modal-controls-section">
                    <div class="modal-sort-control">
                        <svg viewBox="0 0 24 24"><path d="M18,21L14,17H17V7H14L18,3L22,7H19V17H22M2,19V17H12V19M2,13V11H9V13M2,7V5H6V7H2Z"/></svg>
                        <select class="modal-sort-select" id="unusedSortSelect" onchange="changeUnusedSort(this.value)">
                            <option value="cost" ${data.currentSort === 'cost' ? 'selected' : ''}>Sort by Cost</option>
                            <option value="description" ${data.currentSort === 'description' ? 'selected' : ''}>Sort by Item Description</option>
                            <option value="frequency" ${data.currentSort === 'frequency' ? 'selected' : ''}>Sort by Frequency</option>
                        </select>
                    </div>
                </div>
            `;
            
            // Group by location
            const locationGroups = {};
            sortedItems.forEach(item => {
                if (!locationGroups[item.location]) {
                    locationGroups[item.location] = {};
                }
                if (!locationGroups[item.location][item.sublocation]) {
                    locationGroups[item.location][item.sublocation] = [];
                }
                locationGroups[item.location][item.sublocation].push(item);
            });
            
            // Build location cards (accordion style)
            Object.keys(locationGroups).forEach((location, locIdx) => {
                const sublocations = locationGroups[location];
                const totalCount = Object.values(sublocations).reduce((sum, items) => sum + items.length, 0);
                
                if (totalCount > 0) {
                    html += `
                        <div class="area-card" id="unused-location-${locIdx}">
                            <div class="area-card-header" onclick="toggleUnusedLocation(${locIdx})">
                                <div class="area-card-header-left">
                                    <svg class="area-expand-icon" viewBox="0 0 24 24">
                                        <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/>
                                    </svg>
                                    <div class="area-name">${location}</div>
                                </div>
                                <div class="area-badge">${totalCount}</div>
                            </div>
                            <div class="sublocation-list">
                    `;
                    
                    Object.keys(sublocations).forEach((sublocation, subIdx) => {
                        const items = sublocations[sublocation];
                        if (items.length > 0) {
                            html += `
                                <div class="sublocation-item">
                                    <div class="sublocation-header">
                                        <div class="sublocation-header-left">
                                            <span class="sublocation-name">${sublocation}</span>
                                        </div>
                                        <span class="sublocation-badge">${items.length}</span>
                                    </div>
                                    <div class="item-list">
                            `;
                            
                            items.forEach(item => {
                                html += `
                                    <div class="item-row">
                                        <div class="item-description">
                                            <div class="item-bullet"></div>
                                            <span>${item.description}</span>
                                        </div>
                                        <div class="item-cost">$${item.unitPrice.toFixed(2)}</div>
                                    </div>
                                `;
                            });
                            
                            html += `
                                    </div>
                                </div>
                            `;
                        }
                    });
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
            });
            
            areaList.innerHTML = html;
            console.log('✓ Unused modal rendered with sorting');
        }
        
        function changeUnusedSort(sortType) {
            if (window.unusedModalData) {
                window.unusedModalData.currentSort = sortType;
                renderUnusedModalContent();
            }
        }
        
        function toggleUnusedLocation(locIdx) {
            // Close all other locations first (accordion behavior)
            document.querySelectorAll('[id^="unused-location-"]').forEach(card => {
                if (card.id !== `unused-location-${locIdx}`) {
                    card.classList.remove('expanded');
                }
            });
            
            // Toggle the clicked location
            const card = document.getElementById(`unused-location-${locIdx}`);
            if (card) {
                card.classList.toggle('expanded');
            }
        }
        
        // ==================================================================================
        // INVENTORY COST CHART
        // ==================================================================================
        
        let costChartState = {
            items: [],
            canvas: null,
            ctx: null,
            barPositions: [],
            selectedIndex: -1,
            viewMode: 'itemClass',
            rootViewMode: 'itemClass',  // Track the initial category selected (Class, Name, or Formulary)
            lastGridMax: null,
            lastNumGridLines: null,
            lastDrillLevel: 0,  // Track drill-down level for scale recreation
            lastPageNumber: 0,  // Track page number for scale recreation
            drillDownStack: [],  // Track navigation history for breadcrumb - includes scrollPosition
            hoveredIndex: -1,  // Track which bar is being hovered
            showAllItems: false,  // Flag to show all items instead of limiting to 50
            currentData: null,  // Store current chart data for hover redraws
            hoverAnimationFrame: null,  // Store animation frame ID
            currentPage: 0,  // Track which page of 50 items we're viewing
            allSortedData: null,  // Store all sorted data for pagination
            savedScrollPosition: 0,  // Save scroll position for navigation
            rootLevelPage: 0  // Track the page at root level (before any drill-down)
        };
        
        function initInventoryCostChart(items) {
            costChartState.items = items.filter(item => item.unitPrice && parseFloat(item.unitPrice) > 0);
            costChartState.canvas = document.getElementById('costChart');
            if (!costChartState.canvas) {
                console.warn('⚠️ Analytics: costChart canvas not found (id="costChart"). Skipping chart init.');
                return;
            }
            costChartState.ctx = costChartState.canvas.getContext('2d');
            if (!costChartState.ctx) {
                console.warn('⚠️ Analytics: Unable to get 2D context for costChart. Skipping chart init.');
                return;
            }
            
            // Add event listener to title dropdown
            const titleSelector = document.getElementById('costChartViewSelector');
            if (titleSelector) {
                titleSelector.addEventListener('change', handleViewModeChange);
            }
            
            // Initial draw will update breadcrumb and cost
            drawCostChart();
        }
        
        function createStickyScale(gridMax, numGridLines, niceInterval, leftPadding, rightPadding, displayWidth) {
            // Get the existing scale container
            const scaleContainerDiv = document.getElementById('costChartScaleContainer');
            if (!scaleContainerDiv) return;
            
            // Clear existing content
            scaleContainerDiv.innerHTML = '';
            
            // Calculate graph width
            const graphWidth = displayWidth - leftPadding - rightPadding;
            
            // Create inner scale wrapper
            const scaleWrapper = document.createElement('div');
            scaleWrapper.style.cssText = `
                position: relative;
                width: ${displayWidth}px;
                height: 100%;
                margin-left: 10px;
                display: flex;
                align-items: center;
                border-bottom: 5px solid var(--teal-primary);
            `;
            
            const textColor = getComputedStyle(document.body)
                .getPropertyValue('--cost-scale-label').trim();
            
            // Create back arrow
            const backArrow = document.createElement('div');
            backArrow.id = 'costChartBackArrow';
            backArrow.className = 'cost-chart-back-arrow';
            // Show back arrow if we're in drill-down OR if we're on a non-zero page at root level
            if (costChartState.drillDownStack.length > 0 || 
                (costChartState.drillDownStack.length === 0 && costChartState.currentPage > 0)) {
                backArrow.classList.add('visible');
            }
            backArrow.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z" fill="currentColor"/>
                </svg>
            `;
            backArrow.addEventListener('click', handleBackButtonClick);
            scaleWrapper.appendChild(backArrow);
            
            // Create scale labels starting from 0
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
            
            scaleContainerDiv.appendChild(scaleWrapper);
        }

        function drawCostChart(filterKey = null) {
            const viewMode = costChartState.viewMode || 'itemClass';
            const groupedCosts = {};
            
            // Filter items if drilling down
            let itemsToGroup = costChartState.items;
            if (filterKey) {
                const currentStack = costChartState.drillDownStack;
                const previousLevel = currentStack.length > 0 ? currentStack[currentStack.length - 1] : null;
                
                if (previousLevel) {
                    // Filter based on previous drill level
                    if (previousLevel.mode === 'itemClass') {
                        itemsToGroup = costChartState.items.filter(item => 
                            (item.itemClass || 'Unknown') === previousLevel.key
                        );
                    } else if (previousLevel.mode === 'drugName') {
                        itemsToGroup = costChartState.items.filter(item => 
                            (item.drugName || 'Unknown') === previousLevel.key
                        );
                    } else if (previousLevel.mode === 'formulary') {
                        itemsToGroup = costChartState.items.filter(item => {
                            const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                            const itemCategory = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                            return itemCategory === previousLevel.key;
                        });
                    }
                }
            }
            
            // Group by the appropriate field
            itemsToGroup.forEach(item => {
                let key;
                if (viewMode === 'itemClass') {
                    key = item.itemClass || 'Unknown';
                } else if (viewMode === 'drugName') {
                    key = item.drugName || 'Unknown';
                } else if (viewMode === 'formulary') {
                    // Group by formulary status
                    const isNonFormulary = (item.status || '').toLowerCase() === 'non-formulary';
                    key = isNonFormulary ? 'Non-Formulary' : 'Formulary';
                } else { // description
                    key = item.description || 'Unknown';
                }
                
                if (!groupedCosts[key]) {
                    groupedCosts[key] = 0;
                }
                groupedCosts[key] += item.quantity * parseFloat(item.unitPrice);
            });
            
            // Sort by cost (highest first) and prepare data with key reference
            let allSorted = Object.entries(groupedCosts)
                .sort((a, b) => b[1] - a[1])
                .map(([key, cost]) => [key, cost, key]);
            
            // Store all sorted data for pagination
            costChartState.allSortedData = allSorted;
            
            const totalItems = allSorted.length;
            const itemsPerPage = 50;
            const currentPage = costChartState.currentPage || 0;
            const startIndex = currentPage * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
            
            // Get current page items
            let pageItems = allSorted.slice(startIndex, endIndex);
            
            // Build display data with Previous/Next bars
            let displayData = [];
            
            // Add "Previous Items" bar if not on first page
            if (currentPage > 0) {
                const previousCount = startIndex;
                const previousCost = allSorted.slice(0, startIndex).reduce((sum, [_, cost]) => sum + cost, 0);
                displayData.push([`Previous Items (${previousCount})`, previousCost, '__PREVIOUS__']);
            }
            
            // Add current page items
            displayData = displayData.concat(pageItems);
            
            // Add "Next X Items" bar if there are more items
            const remainingItems = totalItems - endIndex;
            if (remainingItems > 0) {
                const nextCount = Math.min(itemsPerPage, remainingItems);
                const nextCost = allSorted.slice(endIndex, endIndex + nextCount).reduce((sum, [_, cost]) => sum + cost, 0);
                const nextLabel = nextCount < itemsPerPage ? 
                    `Next ${nextCount} Item${nextCount !== 1 ? 's' : ''}` : 
                    `Next ${nextCount} Items`;
                displayData.push([nextLabel, nextCost, '__NEXT__']);
            }
            
            // Calculate total for ALL items in category (not just visible)
            const categoryTotal = allSorted.reduce((sum, [_, cost]) => sum + cost, 0);
            
            // Update breadcrumb navigation
            updateBreadcrumb(categoryTotal);
            
            // Restore or reset scroll position
            const scrollContainer = document.querySelector('.cost-chart-side');
            if (scrollContainer) {
                if (costChartState.savedScrollPosition !== undefined) {
                    scrollContainer.scrollTop = costChartState.savedScrollPosition;
                    costChartState.savedScrollPosition = 0;  // Reset after using
                } else {
                    scrollContainer.scrollTop = 0;  // Reset to top for new navigation
                }
            }
            
            // Store data for hover redraws and draw horizontal bar chart
            costChartState.currentData = displayData;
            drawHorizontalBarChart(displayData);
        }
        
        function handleDrillDown(groupKey) {
            const currentMode = costChartState.viewMode;
            
            // Save current scroll position
            const scrollContainer = document.querySelector('.cost-chart-side');
            const currentScrollPosition = scrollContainer ? scrollContainer.scrollTop : 0;
            
            // Determine next view mode based on current
            let nextMode;
            if (currentMode === 'itemClass') {
                nextMode = 'drugName';
            } else if (currentMode === 'drugName') {
                nextMode = 'description';
            } else if (currentMode === 'formulary') {
                nextMode = 'description';  // Formulary drills down to item level
            } else {
                // Already at item level, no further drill-down
                return;
            }
            
            // Save current page and scroll position before drilling down
            const currentPage = costChartState.currentPage;
            
            // If drilling down from root level (stack is empty), save the root page
            if (costChartState.drillDownStack.length === 0) {
                costChartState.rootLevelPage = currentPage;
            }
            
            // Reset pagination and showAllItems flag when drilling down
            costChartState.showAllItems = false;
            costChartState.currentPage = 0;
            
            // Push current state onto stack with scroll position and page
            costChartState.drillDownStack.push({
                mode: currentMode,
                key: groupKey,
                scrollPosition: currentScrollPosition,
                page: currentPage  // Save the page we were on
            });
            
            // Update view mode and redraw
            costChartState.viewMode = nextMode;
            drawCostChart(groupKey);
        }
        
        function updateBreadcrumb(totalCost) {
            const breadcrumbContainer = document.getElementById('costBreadcrumb');
            const costDisplay = document.getElementById('totalInventoryCost');
            
            if (!breadcrumbContainer || !costDisplay) return;
            
            // Update cost display
            costDisplay.textContent = '$' + totalCost.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            
            // Build breadcrumb
            const breadcrumbs = [];
            
            // Add "All Items" as root
            breadcrumbs.push(`<span class="breadcrumb-item" data-level="-1">All Items</span>`);
            
            // Add each level from drill-down stack
            costChartState.drillDownStack.forEach((level, index) => {
                breadcrumbs.push('<span class="breadcrumb-separator">›</span>');
                breadcrumbs.push(`<span class="breadcrumb-item" data-level="${index}">${level.key}</span>`);
            });
            
            // Mark the last item as current (not clickable)
            if (breadcrumbs.length > 0) {
                const lastIndex = breadcrumbs.length - 1;
                breadcrumbs[lastIndex] = breadcrumbs[lastIndex].replace('breadcrumb-item', 'breadcrumb-current');
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
        
        function handleBackButtonClick() {
            // If at root level and on a paginated view, go back to first page
            if (costChartState.drillDownStack.length === 0 && costChartState.currentPage > 0) {
                costChartState.currentPage = 0;
                costChartState.rootLevelPage = 0;
                drawCostChart();
                return;
            }
            
            // Otherwise handle drill-down navigation
            if (costChartState.drillDownStack.length === 0) return;
            
            // Get the current top of the stack (the level we're leaving)
            const currentLevel = costChartState.drillDownStack[costChartState.drillDownStack.length - 1];
            const previousKey = currentLevel.key;
            
            // Check if we're going back to root
            if (costChartState.drillDownStack.length === 1) {
                // Going back to root - restore the original view mode we started with
                costChartState.drillDownStack = [];
                costChartState.viewMode = costChartState.rootViewMode;  // Restore original root mode
                costChartState.currentPage = costChartState.rootLevelPage;  // Restore saved page
                costChartState.savedScrollPosition = 0;
                drawCostChart();
                
                // After redraw completes, find and hover the bar we came from
                setTimeout(() => {
                    findAndHoverBar(previousKey);
                }, 100);
            } else {
                // Going back to an intermediate level
                const targetLevel = costChartState.drillDownStack.length - 2;
                navigateToBreadcrumbLevel(targetLevel);
                
                // After redraw completes, find and hover the bar we came from
                setTimeout(() => {
                    findAndHoverBar(previousKey);
                }, 100);
            }
        }
        
        function findAndHoverBar(groupKey) {
            // Find the bar with matching groupKey in barPositions
            const barIndex = costChartState.barPositions.findIndex(bar => bar.groupKey === groupKey);
            
            if (barIndex !== -1) {
                const bar = costChartState.barPositions[barIndex];
                const scrollContainer = document.querySelector('.cost-chart-side');
                
                if (scrollContainer) {
                    // Calculate the bar's position
                    const barY = bar.y;
                    const barHeight = bar.height;
                    const containerHeight = scrollContainer.clientHeight;
                    
                    // Calculate scroll position to center the bar in view
                    const targetScroll = barY - (containerHeight / 2) + (barHeight / 2);
                    
                    // Scroll to position
                    scrollContainer.scrollTo({
                        top: Math.max(0, targetScroll),
                        behavior: 'smooth'
                    });
                    
                    // Wait for scroll to complete, then activate hover
                    setTimeout(() => {
                        costChartState.hoveredIndex = barIndex;
                        
                        // Redraw to show hover
                        if (costChartState.currentData) {
                            drawHorizontalBarChart(costChartState.currentData, costChartState.selectedIndex);
                        }
                    }, 400);  // Wait for smooth scroll to complete
                } else {
                    // No scroll container, activate hover immediately
                    costChartState.hoveredIndex = barIndex;
                    
                    if (costChartState.currentData) {
                        drawHorizontalBarChart(costChartState.currentData, costChartState.selectedIndex);
                    }
                }
            }
        }
        
        function navigateToBreadcrumbLevel(level) {
            // Reset showAllItems flag
            costChartState.showAllItems = false;
            
            if (level === -1) {
                // Go back to root (All Items) - restore to original root view mode
                costChartState.drillDownStack = [];
                costChartState.viewMode = costChartState.rootViewMode;  // Restore original root mode
                costChartState.savedScrollPosition = 0;
                costChartState.currentPage = 0;  // Always reset to first page when clicking "All Items"
                costChartState.rootLevelPage = 0;  // Reset root level page tracker too
                drawCostChart();
            } else {
                // Navigate to specific level
                costChartState.drillDownStack = costChartState.drillDownStack.slice(0, level + 1);
                const targetLevel = costChartState.drillDownStack[level];
                
                // Restore scroll position and page from target level
                costChartState.savedScrollPosition = targetLevel.scrollPosition || 0;
                costChartState.currentPage = targetLevel.page || 0;
                
                // Set view mode based on target level
                if (targetLevel.mode === 'itemClass') {
                    costChartState.viewMode = 'drugName';
                } else if (targetLevel.mode === 'drugName') {
                    costChartState.viewMode = 'description';
                } else if (targetLevel.mode === 'formulary') {
                    costChartState.viewMode = 'description';
                }
                
                drawCostChart(targetLevel.key);
            }
        }
        
        function handleViewModeChange(event) {
            // Reset drill-down, pagination, and showAllItems flag when changing view mode
            costChartState.drillDownStack = [];
            costChartState.showAllItems = false;
            costChartState.currentPage = 0;
            costChartState.rootLevelPage = 0;  // Reset root level page
            costChartState.viewMode = event.target.value;
            costChartState.rootViewMode = event.target.value;  // Update root mode tracker
            drawCostChart();
        }
        
        
        function drawHorizontalBarChart(data, selectedIndex = -1) {
            // Helper function to get CSS variable values from BODY (where dark-mode class is)
            const getCSSVar = (varName) => {
                return getComputedStyle(document.body).getPropertyValue(varName).trim();
            };
            
            // Log theme colors for debugging
            const isDark = document.body.classList.contains('dark-mode');
            if (window.costChartDebugColors !== isDark) {
                window.costChartDebugColors = isDark;
                console.log('🎨 Cost chart colors (' + (isDark ? 'dark' : 'light') + '):', {
                    barStart: getCSSVar('--cost-bar-gradient-start'),
                    barEnd: getCSSVar('--cost-bar-gradient-end'),
                    labelNormal: getCSSVar('--cost-label-normal'),
                    labelHover: getCSSVar('--cost-label-hover')
                });
            }
            
            const canvas = costChartState.canvas;
            const ctx = costChartState.ctx;
            
            // Get container dimensions
            const container = canvas.parentElement;
            const displayWidth = container.clientWidth - 20;
            
            // Fixed bar height and spacing
            const barHeight = 40;
            const barSpacing = 10;
            const leftPadding = 180;  // Space for category labels
            const rightPadding = 60;   // Space for grid labels
            const topPadding = 15;     // Minimal padding since sticky header provides visual separation
            const bottomPadding = 20;
            
            // Calculate total height based on number of bars
            const displayHeight = topPadding + bottomPadding + (data.length * (barHeight + barSpacing));
            
            // High DPI rendering
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
            
            ctx.clearRect(0, 0, width, height);
            
            if (!data || data.length === 0) {
                const noDataColor = getCSSVar('--chart-axis');
                ctx.fillStyle = noDataColor;
                ctx.font = '14px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText('No data available', width / 2, height / 2);
                return;
            }
            
            // Calculate max value excluding navigation items (Previous/Next)
            const dataValues = data
                .filter(d => d[2] !== '__PREVIOUS__' && d[2] !== '__NEXT__' && d[2] !== '__VIEW_ALL__')
                .map(d => d[1]);
            const maxValue = dataValues.length > 0 ? Math.max(...dataValues) : 1;
            const graphWidth = width - leftPadding - rightPadding;
            
            // Calculate nice interval for grid lines
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
            
            // Get text color from CSS (query from body where dark-mode class is)
            const textColor = getComputedStyle(document.body)
                .getPropertyValue('--chart-label-color').trim();
            
            // Draw vertical grid lines (no labels on canvas)
            const gridLineColor = getCSSVar('--cost-grid-line');
            ctx.strokeStyle = gridLineColor;
            ctx.lineWidth = 1;
            
            for (let i = 0; i <= numGridLines; i++) {
                const value = i * niceInterval;
                const x = leftPadding + (value / gridMax) * graphWidth;
                
                // Draw grid line only
                ctx.beginPath();
                ctx.moveTo(x, topPadding);
                ctx.lineTo(x, height - bottomPadding);
                ctx.stroke();
            }
            
            const barPositions = [];
            
            data.forEach((item, index) => {
                const [label, value, groupKey] = item;
                const isViewAll = (groupKey === '__VIEW_ALL__');
                const isPrevious = (groupKey === '__PREVIOUS__');
                const isNext = (groupKey === '__NEXT__');
                const isNavigation = isPrevious || isNext || isViewAll;
                
                // Calculate bar width
                // Previous items: full width + leftPadding for click detection
                // Next/ViewAll: 0 (no bar)
                // Normal items: proportional to value
                let barWidth;
                if (isPrevious) {
                    barWidth = graphWidth;  // Full width for Previous items visualization
                } else if (isNext || isViewAll) {
                    barWidth = 0;  // No bar for Next/ViewAll
                } else {
                    barWidth = (value / gridMax) * graphWidth;  // Normal proportional width
                }
                
                const x = leftPadding;
                const y = topPadding + index * (barHeight + barSpacing);
                
                // Store position for click detection
                // Include label area in clickable region
                let clickableWidth;
                if (isPrevious) {
                    clickableWidth = graphWidth + leftPadding;  // Full width + label area
                } else if (isNext || isViewAll) {
                    clickableWidth = leftPadding;  // Only label area
                } else {
                    clickableWidth = barWidth + leftPadding;  // Bar + label area
                }
                
                barPositions.push({ 
                    x: 0,  // Start from left edge to include labels
                    y, 
                    width: clickableWidth,
                    height: barHeight,
                    label: label,
                    value: value,
                    groupKey: groupKey,
                    index: index,
                    isViewAll: isViewAll,
                    isPrevious: isPrevious,
                    isNext: isNext,
                    barX: x,  // Store actual bar position for tooltip
                    barWidth: barWidth
                });
                
                // Determine bar state
                const isSelected = (index === selectedIndex);
                const isHovered = (index === costChartState.hoveredIndex);
                
                // Draw bar
                if (isPrevious) {
                    // Special visualization for "Previous Items" bar
                    // 1. Draw full-width background bar with gradient (green to transparent)
                    const fullWidth = graphWidth;
                    const bgGradient = ctx.createLinearGradient(x, y, x + fullWidth, y);
                    const navBgStart = getCSSVar('--cost-nav-bg-start');
                    const navBgEnd = getCSSVar('--cost-nav-bg-end');
                    bgGradient.addColorStop(0, navBgStart);
                    bgGradient.addColorStop(1, navBgEnd);
                    ctx.fillStyle = bgGradient;
                    ctx.fillRect(x, y, fullWidth, barHeight);
                    
                    // 2. Calculate and draw foreground bar (proportion of remaining items)
                    const allItemsTotal = costChartState.allSortedData.reduce((sum, [_, cost]) => sum + cost, 0);
                    const previousItemsCost = value; // The cost of previous items
                    const remainingItemsCost = allItemsTotal - previousItemsCost;
                    const proportion = remainingItemsCost / allItemsTotal;
                    const foregroundWidth = proportion * graphWidth;
                    
                    // Draw foreground bar with normal bar color
                    const fgGradient = ctx.createLinearGradient(x, y, x + foregroundWidth, y);
                    const barStart = getCSSVar('--cost-bar-gradient-start');
                    const barEnd = getCSSVar('--cost-bar-gradient-end');
                    fgGradient.addColorStop(0, barStart);
                    fgGradient.addColorStop(1, barEnd);
                    ctx.fillStyle = fgGradient;
                    
                    const barShadow = getCSSVar('--cost-bar-shadow');
                    ctx.shadowColor = barShadow;
                    ctx.shadowBlur = 6;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                    
                    ctx.fillRect(x, y, Math.max(4, foregroundWidth), barHeight);
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                } else if (!isNavigation) {
                    // Normal bars (not Previous, not Next, not ViewAll)
                    if (isHovered) {
                        // Hovered bars get coral accent
                        const gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
                        const hoverStart = getCSSVar('--cost-bar-hover-start');
                        const hoverEnd = getCSSVar('--cost-bar-hover-end');
                        gradient.addColorStop(0, hoverStart);
                        gradient.addColorStop(1, hoverEnd);
                        ctx.fillStyle = gradient;
                    } else if (isSelected) {
                        const gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
                        const selectedStart = getCSSVar('--cost-bar-selected-start');
                        const selectedEnd = getCSSVar('--cost-bar-selected-end');
                        gradient.addColorStop(0, selectedStart);
                        gradient.addColorStop(1, selectedEnd);
                        ctx.fillStyle = gradient;
                    } else {
                        const gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
                        const barStart = getCSSVar('--cost-bar-gradient-start');
                        const barEnd = getCSSVar('--cost-bar-gradient-end');
                        gradient.addColorStop(0, barStart);
                        gradient.addColorStop(1, barEnd);
                        ctx.fillStyle = gradient;
                    }
                    
                    const shadowHover = getCSSVar('--cost-bar-shadow-hover');
                    const shadowSelected = getCSSVar('--cost-bar-shadow-selected');
                    const shadowNormal = getCSSVar('--cost-bar-shadow');
                    ctx.shadowColor = isHovered ? shadowHover : 
                                     isSelected ? shadowSelected : 
                                     shadowNormal;
                    ctx.shadowBlur = (isSelected || isHovered) ? 8 : 6;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                    
                    ctx.fillRect(x, y, Math.max(4, barWidth), barHeight);
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                }
                // Note: Next items and ViewAll don't draw bars (skip)
                
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
                if (isNavigation) {
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
                    ctx.fillText(line, leftPadding - 10, startY + (i * lineHeight));
                });
                
                // Draw cost value at end of bar (only visible when hovered for non-navigation items)
                if (!isNavigation && isHovered) {
                    const formattedValue = '$' + value.toLocaleString('en-US', { 
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0 
                    });
                    
                    const valueColor = getCSSVar('--cost-label-hover');
                    ctx.fillStyle = valueColor;  // Match hovered label color
                    ctx.font = 'bold 12px system-ui';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    
                    // Position at end of bar + 20px
                    const valueX = x + barWidth + 20;
                    const valueY = y + (barHeight / 2);
                    
                    ctx.fillText(formattedValue, valueX, valueY);
                }
            });
            
            // Store bar positions for hit detection
            costChartState.barPositions = barPositions;
            costChartState.selectedIndex = selectedIndex;
            
            // FIXED coordinate detection - works correctly with scrolling
            canvas.onmousemove = (e) => {
                const canvasRect = canvas.getBoundingClientRect();
                const scrollContainer = canvas.parentElement;
                
                // Mouse Y relative to canvas top (accounts for scroll)
                const mouseX = e.clientX - canvasRect.left;
                const mouseY = e.clientY - canvasRect.top;
                
                let hoveredBar = null;
                for (const bar of barPositions) {
                    if (mouseX >= bar.x && mouseX <= bar.x + bar.width && 
                        mouseY >= bar.y && mouseY <= bar.y + bar.height) {
                        hoveredBar = bar;
                        break;
                    }
                }
                
                if (hoveredBar) {
                    canvas.style.cursor = 'pointer';
                    
                    // Update hover state and schedule redraw if changed
                    if (costChartState.hoveredIndex !== hoveredBar.index) {
                        costChartState.hoveredIndex = hoveredBar.index;
                        
                        // Cancel any pending animation frame
                        if (costChartState.hoverAnimationFrame) {
                            cancelAnimationFrame(costChartState.hoverAnimationFrame);
                        }
                        
                        // Schedule redraw on next frame
                        costChartState.hoverAnimationFrame = requestAnimationFrame(() => {
                            if (costChartState.currentData) {
                                drawHorizontalBarChart(costChartState.currentData, selectedIndex);
                            }
                        });
                    }
                } else {
                    canvas.style.cursor = 'default';
                    
                    // Clear hover state and schedule redraw if needed
                    if (costChartState.hoveredIndex !== -1) {
                        costChartState.hoveredIndex = -1;
                        
                        // Cancel any pending animation frame
                        if (costChartState.hoverAnimationFrame) {
                            cancelAnimationFrame(costChartState.hoverAnimationFrame);
                        }
                        
                        // Schedule redraw on next frame
                        costChartState.hoverAnimationFrame = requestAnimationFrame(() => {
                            if (costChartState.currentData) {
                                drawHorizontalBarChart(costChartState.currentData, selectedIndex);
                            }
                        });
                    }
                }
            };
            
            canvas.onmouseleave = () => {
                // Clear hover state and schedule redraw if needed
                if (costChartState.hoveredIndex !== -1) {
                    costChartState.hoveredIndex = -1;
                    
                    // Cancel any pending animation frame
                    if (costChartState.hoverAnimationFrame) {
                        cancelAnimationFrame(costChartState.hoverAnimationFrame);
                    }
                    
                    // Schedule redraw on next frame
                    costChartState.hoverAnimationFrame = requestAnimationFrame(() => {
                        if (costChartState.currentData) {
                            drawHorizontalBarChart(costChartState.currentData, selectedIndex);
                        }
                    });
                }
            };
            
            // FIXED click detection - works correctly with scrolling
            canvas.onclick = (e) => {
                const canvasRect = canvas.getBoundingClientRect();
                
                // Click position relative to canvas
                const clickX = e.clientX - canvasRect.left;
                const clickY = e.clientY - canvasRect.top;
                
                for (const bar of barPositions) {
                    if (clickX >= bar.x && clickX <= bar.x + bar.width && 
                        clickY >= bar.y && clickY <= bar.y + bar.height) {
                        
                        // Check if this is a navigation bar
                        if (bar.groupKey === '__PREVIOUS__') {
                            // Go to previous page
                            costChartState.currentPage = Math.max(0, costChartState.currentPage - 1);
                            
                            // Update rootLevelPage if we're at root level
                            if (costChartState.drillDownStack.length === 0) {
                                costChartState.rootLevelPage = costChartState.currentPage;
                            }
                            
                            drawCostChart(costChartState.drillDownStack.length > 0 ? 
                                costChartState.drillDownStack[costChartState.drillDownStack.length - 1].key : null);
                        } else if (bar.groupKey === '__NEXT__') {
                            // Go to next page
                            costChartState.currentPage++;
                            
                            // Update rootLevelPage if we're at root level
                            if (costChartState.drillDownStack.length === 0) {
                                costChartState.rootLevelPage = costChartState.currentPage;
                            }
                            
                            drawCostChart(costChartState.drillDownStack.length > 0 ? 
                                costChartState.drillDownStack[costChartState.drillDownStack.length - 1].key : null);
                        } else {
                            // Normal drill down to next level
                            costChartState.showAllItems = false;
                            // Don't reset currentPage here - handleDrillDown will save it first, then reset
                            handleDrillDown(bar.groupKey);
                        }
                        break;
                    }
                }
            };
            
            // Recreate scale if max values changed OR if navigation state changed
            const scaleChanged = 
                !costChartState.lastGridMax || 
                costChartState.lastGridMax !== gridMax ||
                costChartState.lastNumGridLines !== numGridLines ||
                costChartState.lastDrillLevel !== costChartState.drillDownStack.length ||
                costChartState.lastPageNumber !== costChartState.currentPage;
            
            if (scaleChanged) {
                costChartState.lastGridMax = gridMax;
                costChartState.lastNumGridLines = numGridLines;
                costChartState.lastDrillLevel = costChartState.drillDownStack.length;
                costChartState.lastPageNumber = costChartState.currentPage;
                createStickyScale(gridMax, numGridLines, niceInterval, leftPadding, rightPadding, displayWidth);
            }
            
            // Always update title dropdown value
            const titleDropdown = document.getElementById('costChartViewSelector');
            if (titleDropdown) titleDropdown.value = costChartState.viewMode;
        }
        
        // ==================================================================================
        // CUSTOM TOOLTIP AND LEGEND INTERACTIONS
        // ==================================================================================
        
        /**
         * Show custom tooltip at mouse position
         */
        function showCustomTooltip(event, text) {
            const tooltip = document.getElementById('customTooltip');
            if (tooltip) {
                tooltip.textContent = text;
                tooltip.style.left = (event.pageX + 10) + 'px';
                tooltip.style.top = (event.pageY - 30) + 'px';
                tooltip.classList.add('visible');
            }
        }
        
        /**
         * Hide custom tooltip
         */
        function hideCustomTooltip() {
            const tooltip = document.getElementById('customTooltip');
            if (tooltip) {
                tooltip.classList.remove('visible');
            }
        }
        
        /**
         * Filter by stock status (used by legend items)
         */
        function filterByStockStatus(statusType) {
            navigateToInventory(statusType);
        }
        
        /**
         * Initialize tooltip handlers for status bar segments
         */
        function initStatusBarTooltips() {
            const segments = [
                { id: 'outOfStockSegment', label: 'Out of Stock' },
                { id: 'lowStockSegment', label: 'Low Stock' },
                { id: 'expiringSoonSegment', label: 'Expiring' },
                { id: 'normalStockSegment', label: 'Normal Stock' },
                { id: 'overStockSegment', label: 'Overstock' }
            ];
            
            segments.forEach(seg => {
                const element = document.getElementById(seg.id);
                if (element) {
                    element.addEventListener('mouseenter', (e) => {
                        const tooltip = element.getAttribute('title');
                        if (tooltip) {
                            showCustomTooltip(e, tooltip);
                            element.removeAttribute('title'); // Remove native tooltip
                        }
                    });
                    
                    element.addEventListener('mousemove', (e) => {
                        const tooltip = document.getElementById('customTooltip');
                        if (tooltip && tooltip.classList.contains('visible')) {
                            tooltip.style.left = (e.pageX + 10) + 'px';
                            tooltip.style.top = (e.pageY - 30) + 'px';
                        }
                    });
                    
                    element.addEventListener('mouseleave', () => {
                        hideCustomTooltip();
                        // Restore title for accessibility
                        const stats = calculateStatusBarData();
                        if (stats) {
                            element.setAttribute('title', stats[seg.id]);
                        }
                    });
                }
            });
            
            console.log('✓ Analytics: Custom tooltips initialized for status bar');
        }
        
        /**
         * Calculate current status bar tooltip data
         */
        function calculateStatusBarData() {
            const data = getMockData();
            if (!data || !data.items) return null;
            
            const stats = calculateStatistics(data.items);
            const total = stats.total;
            
            return {
                'outOfStockSegment': `Out of Stock: ${stats.outOfStock} items (0 days supply)`,
                'lowStockSegment': `Low Stock: ${stats.lowStock} items (<7 days supply)`,
                'expiringSoonSegment': (() => {
                    const monthsWindow = parseInt(localStorage.getItem('expiringMonths') || '3', 10);
                    return `Expiring: ${stats.expiringSoonBar} items (≤${monthsWindow} months)`;
                })(),
                'normalStockSegment': `Normal Stock: ${stats.normalStock} items (7-60 days supply)`,
                'overStockSegment': `Overstock: ${stats.overStock} items (>60 days supply)`
            };
        }
        
        // ==================================================================================
        // END CUSTOM TOOLTIP AND LEGEND INTERACTIONS
        // ==================================================================================
        
        // ==================================================================================
        // CHART RESIZE HANDLER
        // ==================================================================================
        
        /**
         * Handle window resize to redraw Sankey chart
         */
        let resizeTimeout;
        function handleChartResize() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const data = getMockData();
                if (data && data.stockFlow) {
                    const el = document.getElementById('sankeyChart');
                    if (!el) return; // tab not visible / DOM not mounted
                    console.log('♻️ Redrawing Sankey chart due to window resize...');
                    drawSankeyChart(data.stockFlow);
                }
            }, 250); // Debounce resize events
        }
        
        // ==================================================================================
        // END CHART RESIZE HANDLER
        // ==================================================================================

        // Initialize immediately (don't wait for load - iframe might already be loaded)
        console.log('🚀 Analytics: Script executing...');
        
        // Set up scroll arrows
        initScrollArrows();
        
        // Set up custom tooltips for status bar
        initStatusBarTooltips();
        
        // Set up chart resize handler
        window.addEventListener('resize', handleChartResize);
        
        // Add click handler to total items card (no filter - show search prompt)
        const totalItemsCard = document.getElementById('totalItemsCard');
        if (totalItemsCard) {
            totalItemsCard.addEventListener('click', () => navigateToInventory(null));
            console.log('✓ Analytics: Total items card click handler attached');
        }
        
        // Add click handler to critical items card (filter by critical/severe/moderate status)
        const criticalItemsCard = document.getElementById('criticalItemsCard');
        if (criticalItemsCard) {
            criticalItemsCard.addEventListener('click', () => navigateToInventory('critical'));
            console.log('✓ Analytics: Critical items card click handler attached');
        }
        
        // Add click handler to FDA Shortages card (navigate to Shortage Bulletin with filtered items)
        const resolvedItemsCard = document.getElementById('resolvedItemsCard');
        if (resolvedItemsCard) {
            resolvedItemsCard.addEventListener('click', () => navigateToShortageBulletinWithFDA());
            console.log('✓ Analytics: FDA Shortages card click handler attached');
        }
        
        // Add click handler to low supply card (filter by <1 week supply)
        const expiredEtaCard = document.getElementById('expiredEtaCard');
        if (expiredEtaCard) {
            expiredEtaCard.addEventListener('click', () => navigateToInventory(currentEtaFilterType));
            console.log('✓ Analytics: Expired ETA card click handler attached');
        }
        
        // Add click handlers to inventory health segments
        const outOfStockSegment = document.getElementById('outOfStockSegment');
        if (outOfStockSegment) {
            outOfStockSegment.addEventListener('click', () => navigateToInventory('outOfStock'));
            console.log('✓ Analytics: Out of stock segment click handler attached');
        }
        
        const lowStockSegment = document.getElementById('lowStockSegment');
        if (lowStockSegment) {
            lowStockSegment.addEventListener('click', () => navigateToInventory('lowStock'));
            console.log('✓ Analytics: Low stock segment click handler attached');
        }

        const expiringSoonSegment = document.getElementById('expiringSoonSegment');
        if (expiringSoonSegment) {
            expiringSoonSegment.addEventListener('click', () => navigateToInventory('expiringSoon'));
            console.log('✓ Analytics: Expiring segment click handler attached');
        }
        
        const normalStockSegment = document.getElementById('normalStockSegment');
        if (normalStockSegment) {
            normalStockSegment.addEventListener('click', () => navigateToInventory('normalStock'));
            console.log('✓ Analytics: Normal stock segment click handler attached');
        }
        
        // Add click handler for Projected Waste card - navigate to Charts with filter
        const totalCostCard = document.getElementById('totalCostCard');
        if (totalCostCard) {
            totalCostCard.addEventListener('click', () => {
                console.log('📊 Total Cost card clicked - navigating to Charts horizontal bar');
                
                // Navigate to Charts page with horizontal bar chart, no filters
                window.parent.postMessage({
                    type: 'navigateToPage',
                    page: 'charts',
                    chartType: 'cost-bar',
                    clearFilters: true
                }, '*');
            });
            console.log('✓ Analytics: Total Cost card click handler attached');
        }
        
        // Add click handler for Usage Vs Restock Overall card - navigate to Charts time series
        const usageVsRestockOverallCard = document.getElementById('usageVsRestockOverallCard');
        if (usageVsRestockOverallCard) {
            usageVsRestockOverallCard.addEventListener('click', () => {
                console.log('📊 Usage Vs Restock Overall card clicked');
                
                // Navigate to Charts page and select time-chart with usage vs restock sub-icon
                window.parent.postMessage({
                    type: 'navigateToPage',
                    page: 'charts',
                    chartType: 'time-chart',
                    subChart: 'usageVsRestock'
                }, '*');
            });
            console.log('✓ Analytics: Usage Vs Restock Overall card click handler attached');
        }
        
        // Add click handler for Usage vs Restock Line Graph Canvas - navigate to Charts with items below threshold filter
        const usageRestockCanvas = document.getElementById('usageRestockLineCanvas');
        if (usageRestockCanvas) {
            usageRestockCanvas.style.cursor = 'pointer';
            usageRestockCanvas.addEventListener('click', () => {
                console.log('📊 Usage vs Restock Line Graph clicked');
                
                // Navigate to Charts page with items below threshold filter
                window.parent.postMessage({
                    type: 'navigateToPage',
                    page: 'charts',
                    chartType: 'cost-bar', // Cost chart view
                    filterType: 'itemsBelowThreshold',
                    filterData: {
                        filterType: 'Items Below Threshold',
                        items: window.itemsBelowThreshold || []
                    }
                }, '*');
            });
            console.log('✓ Analytics: Usage vs Restock canvas click handler attached');
        }
        
        // Add click handler for Items Below Threshold card - navigate to Charts horizontal bar with filter
        const usageVsRestockAboveCard = document.getElementById('usageVsRestockAboveCard');
        if (usageVsRestockAboveCard) {
            usageVsRestockAboveCard.addEventListener('click', () => {
                console.log('📊 Items Below Threshold card clicked');
                
                // Navigate to Charts page with items below threshold filter
                window.parent.postMessage({
                    type: 'navigateToPage',
                    page: 'charts',
                    filterType: 'itemsBelowThreshold',
                    filterData: {
                        filterType: 'Items Below Threshold',
                        items: window.itemsBelowThreshold || []
                    }
                }, '*');
            });
            console.log('✓ Analytics: Items Below Threshold card click handler attached');
        }
        
        const overStockSegment = document.getElementById('overStockSegment');
        if (overStockSegment) {
            overStockSegment.addEventListener('click', () => navigateToInventory('overStock'));
            console.log('✓ Analytics: Overstock segment click handler attached');
        }
        
        // Request and populate analytics data immediately
        console.log('🔄 Analytics: Calling populateAnalytics...');
        populateAnalytics();
        
        // ==================================================================================
        // FILTER CHIP MANAGEMENT
        // ==================================================================================
        
        let currentAnalyticsFilter = null;
        
        /**
         * Show filter chip with label
         */
        function showFilterChip(label) {
            const filterChip = document.getElementById('filterChip');
            const filterChipLabel = document.getElementById('filterChipLabel');
            
            if (filterChip && filterChipLabel) {
                filterChipLabel.textContent = label;
                filterChip.style.display = 'inline-flex';
                currentAnalyticsFilter = label;
                console.log('✓ Filter chip shown:', label);
            }
        }
        
        /**
         * Hide filter chip
         */
        function hideFilterChip() {
            const filterChip = document.getElementById('filterChip');
            if (filterChip) {
                filterChip.style.display = 'none';
                currentAnalyticsFilter = null;
                console.log('✓ Filter chip hidden');
            }
        }
        
        /**
         * Clear filter and navigate back
         */
        function clearAnalyticsFilter() {
            hideFilterChip();
            // Optionally reload data or reset view
            console.log('✓ Analytics filter cleared');
        }
        
        // Listen for navigation with filter from other pages
        window.addEventListener('message', function(event) {
            if (event.data.type === 'analyticsFilterActive') {
                showFilterChip(event.data.filterLabel);
            }
        });

        function openProjectedWasteListModal(items, totalCost) {
            const list = Array.isArray(items) ? items : [];
            let modal = document.getElementById('projectedWasteListModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'projectedWasteListModal';
                modal.className = 'pyxis-metrics-modal-overlay';
                modal.innerHTML = `
                    <div class="pyxis-metrics-modal">
                        <div class="pyxis-metrics-header">
                            <div class="pyxis-metrics-title">Projected Expiration Waste</div>
                            <button class="pyxis-metrics-close" id="projectedWasteListClose">✕</button>
                        </div>
                        <div class="pyxis-metrics-subheader">
                            <div class="pyxis-metrics-subheader-left">
                                <div class="pyxis-metrics-subheader-label">Items</div>
                                <div class="pyxis-metrics-subheader-value" id="projectedWasteListCount">0</div>
                            </div>
                            <div class="pyxis-metrics-subheader-right">
                                <div class="pyxis-metrics-subheader-label">Total Projected Waste</div>
                                <div class="pyxis-metrics-subheader-value" id="projectedWasteListTotal">$0.00</div>
                            </div>
                        </div>
                        <div class="pyxis-metrics-list" id="projectedWasteListBody"></div>
                    </div>
                `;
                document.body.appendChild(modal);

                // Close handlers
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) modal.style.display = 'none';
                });
                modal.querySelector('#projectedWasteListClose').addEventListener('click', () => {
                    modal.style.display = 'none';
                });
            }

            const countEl = modal.querySelector('#projectedWasteListCount');
            const totalEl = modal.querySelector('#projectedWasteListTotal');
            const bodyEl = modal.querySelector('#projectedWasteListBody');

            countEl.textContent = String(list.length);
            totalEl.textContent = '$' + _safeNumber(totalCost, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            bodyEl.innerHTML = '';
            if (!list.length) {
                const empty = document.createElement('div');
                empty.className = 'pyxis-metrics-empty';
                empty.textContent = 'No projected expiration waste items found.';
                bodyEl.appendChild(empty);
            } else {
                for (let i = 0; i < list.length; i++) {
                    const it = list[i] || {};
                    const row = document.createElement('div');
                    row.className = 'pyxis-metrics-list-item';
                    const name = (it.description || it.drugName || it.itemCode || 'Unknown').toString();
                    const currentQty = _safeNumber(it.currentQty, _safeNumber(it.inventory, 0));
                    const willUse = _safeNumber(it.expectedUseUntilExpire, _safeNumber(it.projectedUsage, 0));
                    const leftover = _safeNumber(it.leftoverQty, _safeNumber(it.excessInventory, 0));
                    const cost = _safeNumber(it.projectedWasteCost, _safeNumber(it.wasteValue, 0));
                    const unitPrice = _safeNumber(it.unitPrice, _safeNumber(it.unitCost, 0));

                    row.innerHTML = `
                        <div class="pyxis-metrics-list-item-top">
                            <div class="pyxis-metrics-list-item-title">${name}</div>
                            <div class="pyxis-metrics-badge">$${cost.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                        </div>
                        <div class="pyxis-metrics-list-item-bottom">
                            <span class="pyxis-metrics-muted">Qty:</span> ${currentQty}
                            <span class="pyxis-metrics-muted" style="margin-left:10px;">Will use:</span> ${willUse.toFixed ? willUse.toFixed(0) : willUse}
                            <span class="pyxis-metrics-muted" style="margin-left:10px;">Leftover:</span> ${leftover.toFixed ? leftover.toFixed(0) : leftover}
                            <span class="pyxis-metrics-muted" style="margin-left:10px;">Unit:</span> $${unitPrice.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}
                        </div>
                    `;
                    bodyEl.appendChild(row);
                }
            }

            modal.style.display = 'flex';
        }

        // ============================================================
        // Stock-out Risk Timeline (Gantt) + Waste vs Usage Correlation
        // ============================================================

        const __forecastCache = {
            wasteByItemKey: null,
            wasteByItem: null,
            correlationKey: null,
            correlation: null,
            stockoutKey: null,
            stockout: null
        };

        function _num(v, fb=0){ const n = (typeof v==='number')?v:parseFloat(v); return Number.isFinite(n)?n:fb; }
        function _clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

        function _getForecastNS(){
            return (window.InventoryApp && window.InventoryApp.Forecast) ? window.InventoryApp.Forecast : null;
        }


        function _normScopeToken(v){
            const s = String(v == null ? '' : v).trim();
            return (!s || s.toUpperCase() === 'ALL' || s === '*') ? '' : s;
        }

        function _deriveMinSuggestionShownRows(md){
            const candidates = [
                md && md.minSuggestionShownRows,
                md && md.minSuggestionRows,
                md && md.optimizationShownRows,
                md && md.optimization && md.optimization.shownRows,
                window.__minSuggestionShownRows,
                window.__optimizationShownRows
            ];
            for (let i=0; i<candidates.length; i++){
                if (Array.isArray(candidates[i])) return candidates[i];
            }
            return [];
        }

        function _deriveRestockProjectionScope(md){
            const m = (md && md.meta && typeof md.meta === 'object') ? md.meta : {};
            return {
                itemCode: _normScopeToken(
                    m.minSuggestionItemCode ?? m.selectedItemCode ?? md?.selectedItemCode ?? window.__minSuggestionSelectedItemCode ?? window.__optimizationSelectedItemCode ?? ''
                ),
                locationId: _normScopeToken(
                    m.minSuggestionLocationId ?? m.selectedLocationId ?? m.selectedLocation ?? md?.selectedLocationId ?? window.__minSuggestionSelectedLocationId ?? window.__optimizationSelectedLocationId ?? ''
                )
            };
        }

        function computeSuggestedMinPlusSafetyAggregate({ rows, itemCode, locationId }){
            const list = Array.isArray(rows) ? rows : [];
            const itemNeedle = _normScopeToken(itemCode).toUpperCase();
            const locNeedle = _normScopeToken(locationId).toUpperCase();
            let total = 0;
            for (let i=0; i<list.length; i++){
                const r = list[i] || {};
                const rowItem = String(r.itemCode ?? r.code ?? r.ndc ?? '').trim().toUpperCase();
                const rowLoc = String(r.locationId ?? r.location ?? r.mainLocation ?? r.loc ?? '').trim().toUpperCase();
                if (itemNeedle && rowItem !== itemNeedle) continue;
                if (locNeedle && rowLoc !== locNeedle) continue;
                const suggested = _num(r.suggestedMinQty ?? r.sugMin ?? r.suggestedMin ?? r.minSuggestionQty ?? 0, 0);
                const safety = _num(r.safetyStockQty ?? r.safetyStock ?? r.ss ?? 0, 0);
                total += Math.max(0, suggested) + Math.max(0, safety);
            }
            return total;
        }

        function _computeSuggestedMinPlusSafetyAggregateStats({ rows, itemCode, locationId }){
            const list = Array.isArray(rows) ? rows : [];
            const itemNeedle = _normScopeToken(itemCode).toUpperCase();
            const locNeedle = _normScopeToken(locationId).toUpperCase();
            let totalSuggestedMin = 0, totalSafety = 0, matchedRows = 0;
            for (let i=0; i<list.length; i++){
                const r = list[i] || {};
                const rowItem = String(r.itemCode ?? r.code ?? r.ndc ?? '').trim().toUpperCase();
                const rowLoc = String(r.locationId ?? r.location ?? r.mainLocation ?? r.loc ?? '').trim().toUpperCase();
                if (itemNeedle && rowItem !== itemNeedle) continue;
                if (locNeedle && rowLoc !== locNeedle) continue;
                const suggested = Math.max(0, _num(r.suggestedMinQty ?? r.sugMin ?? r.suggestedMin ?? r.minSuggestionQty ?? 0, 0));
                const safety = Math.max(0, _num(r.safetyStockQty ?? r.safetyStock ?? r.ss ?? 0, 0));
                totalSuggestedMin += suggested;
                totalSafety += safety;
                matchedRows++;
            }
            const grandTotal = totalSuggestedMin + totalSafety;
            return { matchedRows, totalSuggestedMin, totalSafety, grandTotal };
        }

        function getTrendMultFor(md, dateISO, locationKey, itemCode){
            try {
                const tl = md && md.trendTimeline;
                const byLoc = tl && tl.byLocation && tl.byLocation[String(locationKey || '')];
                const byItem = byLoc && byLoc[String(itemCode || '')];
                const row = byItem && byItem[String(dateISO || '')];
                const n = _num((typeof row === 'number') ? row : (row && row.trendMult), NaN);
                if (Number.isFinite(n) && n > 0) return n;
            } catch (_) {}
            return 1;
        }


        function _getMostRecentTrendFactorForAggregate(md, rows, itemCode, locationId){
            const tl = md && md.trendTimeline;
            const byLoc = tl && tl.byLocation && typeof tl.byLocation === 'object' ? tl.byLocation : null;
            if (!byLoc) return 1;
            const itemNeedle = _normScopeToken(itemCode).toUpperCase();
            const locNeedle = _normScopeToken(locationId).toUpperCase();
            const rowList = Array.isArray(rows) ? rows : [];
            const samplePairs = [];
            if (rowList.length) {
                for (let i=0; i<rowList.length; i++){
                    const r = rowList[i] || {};
                    const rowItem = String(r.itemCode ?? r.code ?? r.ndc ?? '').trim();
                    const rowLoc = String(r.locationId ?? r.location ?? r.mainLocation ?? r.loc ?? '').trim();
                    if (!rowItem || !rowLoc) continue;
                    if (itemNeedle && rowItem.toUpperCase() != itemNeedle) continue;
                    if (locNeedle && rowLoc.toUpperCase() != locNeedle) continue;
                    samplePairs.push([rowLoc, rowItem]);
                    if (samplePairs.length >= 200) break;
                }
            }
            if (!samplePairs.length) {
                if (itemNeedle && locNeedle) samplePairs.push([locNeedle, itemNeedle]);
                else if (itemNeedle) {
                    for (const lk of Object.keys(byLoc)) { samplePairs.push([lk, itemNeedle]); if (samplePairs.length>=50) break; }
                }
            }
            let sum = 0, count = 0;
            for (let i=0; i<samplePairs.length; i++){
                const [locRaw, itemRaw] = samplePairs[i];
                const locVariants = [String(locRaw||'').trim(), String(locRaw||'').trim().toUpperCase(), String(locRaw||'').trim().toLowerCase()].filter(Boolean);
                let byItem = null;
                for (let j=0; j<locVariants.length && !byItem; j++) byItem = byLoc[locVariants[j]];
                if (!byItem || typeof byItem !== 'object') continue;
                const itemVariants = [String(itemRaw||'').trim(), String(itemRaw||'').trim().toUpperCase(), String(itemRaw||'').trim().toLowerCase()].filter(Boolean);
                let byDate = null;
                for (let j=0; j<itemVariants.length && !byDate; j++) byDate = byItem[itemVariants[j]];
                if (!byDate || typeof byDate !== 'object') continue;
                let latestISO = '';
                for (const k of Object.keys(byDate)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k > latestISO) latestISO = k;
                const raw = latestISO ? byDate[latestISO] : null;
                const n = _num((typeof raw === 'number') ? raw : (raw && raw.trendMult), NaN);
                if (Number.isFinite(n) && n > 0) { sum += _clamp(n, 0.5, 2.0); count++; }
            }
            return count ? (sum / count) : 1;
        }

        function buildDailySeriesForItem(md, itemCode, locationKey, lookbackDays=56){
            const days = Math.max(14, Math.floor(_num(lookbackDays, 56)));
            const txRoot = (md && md.transactions && typeof md.transactions === 'object') ? md.transactions : {};
            const sparse = Object.create(null);
            const today = new Date();
            today.setHours(0,0,0,0);
            const start = new Date(today);
            start.setDate(start.getDate() - (days - 1));
            const codeNeedle = String(itemCode || '').trim();
            const locNeedle = String(locationKey || '').trim().toUpperCase();
            let foundTx = false;

            for (const [codeRaw, rec] of Object.entries(txRoot)){
                const code = String(codeRaw || '').trim();
                if (!codeNeedle || code !== codeNeedle) continue;
                const hist = Array.isArray(rec && rec.history) ? rec.history : [];
                for (const tx of hist){
                    if (!tx || typeof tx !== 'object') continue;
                    const sublocation = String(tx.sublocation ?? '').trim();
                    const txLoc = String(sublocation || tx.location || tx.pyxisLocation || tx.sendToLocation || '').trim().toUpperCase();
                    if (locNeedle && txLoc !== locNeedle) continue;
                    const dt = new Date(String(tx.transDate ?? tx.date ?? tx.txDate ?? tx.dispenseDate ?? tx.timestamp ?? ''));
                    if (!Number.isFinite(dt.getTime())) continue;
                    dt.setHours(0,0,0,0);
                    if (dt < start || dt > today) continue;
                    const tType = String(tx.transactionType || '').toLowerCase();
                    if (tType && !(tType.includes('dispense'))) continue;
                    const key = dt.toISOString().slice(0,10);
                    const q = Math.max(0, Math.abs(_num(tx.TransQty ?? tx.qty ?? tx.quantity ?? tx.dispensedQty ?? tx.units ?? 0, 0)));
                    sparse[key] = (sparse[key] || 0) + q;
                    foundTx = true;
                }
            }

            const forecast = _getForecastNS();
            if (foundTx && forecast && typeof forecast.materializeDailySeries === 'function'){
                return {
                    dailySeries: forecast.materializeDailySeries(sparse, start.toISOString().slice(0,10), today.toISOString().slice(0,10)),
                    startISO: start.toISOString().slice(0,10),
                    endISO: today.toISOString().slice(0,10)
                };
            }

            const items = Array.isArray(md && md.items) ? md.items : [];
            const hit = items.find((it)=>String(it && it.itemCode || '').trim() === codeNeedle);
            const cachedDaily = _num(hit && (hit._cachedDailyUsage ?? ((hit._cachedWeeklyUsage!=null) ? (_num(hit._cachedWeeklyUsage,0)/7) : 0)), 0);
            return {
                dailySeries: Array.from({ length: days }, () => Math.max(0, cachedDaily)),
                startISO: start.toISOString().slice(0,10),
                endISO: today.toISOString().slice(0,10)
            };
        }

        function buildProjectedRestockBars(md, horizonDays=14){
            const forecast = _getForecastNS();
            const H = Math.max(7, Math.floor(_num(horizonDays, 14)));
            const out = {
                dailyRestockCost: Array.from({ length: H }, () => 0),
                dailyRestockQty: Array.from({ length: H }, () => 0),
                topLocationByDay: Array.from({ length: H }, () => ''),
                totalRestockQty: 0,
                projectionMode: '',
                projectionLabel: ''
            };

            const scope = _deriveRestockProjectionScope(md);
            const itemCode = _normScopeToken(scope.itemCode);
            const locationId = _normScopeToken(scope.locationId);
            const isAllLocations = !locationId;
            const isAllItems = !itemCode;
            const useAggregateMode = isAllLocations || isAllItems;

            const rows = _deriveMinSuggestionShownRows(md);
            if (useAggregateMode || (!isAllLocations && isAllItems)) {
                const stats = _computeSuggestedMinPlusSafetyAggregateStats({ rows, itemCode, locationId });
                const total = computeSuggestedMinPlusSafetyAggregate({ rows, itemCode, locationId });
                const trendFactor = _getMostRecentTrendFactorForAggregate(md, rows, itemCode, locationId);
                const adjustedTotal = Math.max(0, total * trendFactor);
                for (let d=0; d<H; d++) {
                    out.dailyRestockQty[d] = adjustedTotal;
                    out.dailyRestockCost[d] = adjustedTotal;
                    out.topLocationByDay[d] = 'Suggested Min + Safety (Aggregate)';
                    out.totalRestockQty += out.dailyRestockQty[d];
                }
                out.projectionMode = 'AGG_SUGGESTED_MIN_PLUS_SAFETY';
                out.projectionLabel = 'Suggested Min + Safety (Aggregate)';
                if (typeof DEBUG_RESTOCK_PROJ !== 'undefined' && DEBUG_RESTOCK_PROJ) {
                    console.log('[analytics restock projection]', {
                        MODE: 'AGG_SUGGESTED_MIN_PLUS_SAFETY',
                        isAllLocations,
                        isAllItems,
                        selectedFilters: { itemCode: itemCode || 'ALL', locationId: locationId || 'ALL' },
                        numberOfRowsAggregated: stats.matchedRows,
                        totalSuggestedMin: stats.totalSuggestedMin,
                        totalSafety: stats.totalSafety,
                        trendFactor,
                        grandTotal: stats.grandTotal,
                        adjustedTotal
                    });
                }
                return out;
            }

            if (!forecast || typeof forecast.projectDailyUsageFromShape !== 'function' || typeof forecast.projectRestockNeed !== 'function') return out;

            const inv = (md && md.inventory && typeof md.inventory === 'object') ? md.inventory : {};
            const items = Array.isArray(md && md.items) ? md.items : [];
            const itemByCode = new Map(items.map(it => [String(it && it.itemCode || '').trim(), it]));
            const byDayLoc = Array.from({ length: H }, ()=>Object.create(null));

            for (const [code, invEntry] of Object.entries(inv)){
                if (itemCode && String(code).trim().toUpperCase() !== itemCode.toUpperCase()) continue;
                const item = itemByCode.get(String(code).trim()) || null;
                const unitCost = Math.max(0, _num(item && (item.unitPrice ?? item.unitCost ?? item.costPerUnit ?? item.gpoPrice ?? item.wacPrice), 0));
                const slots = iterateInventorySublocations(invEntry);
                for (const slot of slots){
                    const subloc = String(slot && slot.sublocation || '').trim();
                    if (!subloc) continue;
                    const map = getSublocationMap ? getSublocationMap() : (window.SUBLOCATION_MAP || {});
                    const locMeta = map[subloc] || {};
                    if (String(locMeta.department || '').toUpperCase() === 'PHARMACY') continue;
                    const thisLoc = String(locMeta.mainLocation || subloc).trim().toUpperCase();
                    if (locationId && thisLoc !== String(locationId).trim().toUpperCase()) continue;

                    const seriesObj = buildDailySeriesForItem(md, code, subloc, 56);
                    const usageProj = forecast.projectDailyUsageFromShape(seriesObj.dailySeries, H, {
                        shapeOpts: { method: 'dow', lookbackDays: 56 },
                        trendOpts: { maxPctPerDay: 0.05, minMult: 0.5, maxMult: 2.0 }
                    });
                    const projectedDailyUsageBase = Array.isArray(usageProj.projectedDailyUsage) ? usageProj.projectedDailyUsage : [];
                    const anchorISO = String((md && md.meta && md.meta.datasetEndISO) || new Date().toISOString().slice(0,10));
                    const trendMultNow = getTrendMultFor(md, anchorISO, String(locMeta.mainLocation || subloc), code);
                    const projectedDailyUsage = projectedDailyUsageBase.map(v => Math.max(0, _num(v, 0) * trendMultNow));
                    const sim = forecast.projectRestockNeed({
                        onHandNow: _num(slot.curQty, 0),
                        minQty: _num(slot.minQty, 0),
                        maxQty: _num(slot.maxQty, 0),
                        horizonDays: H,
                        projectedDailyUsage,
                        policy: {
                            reviewCadenceDays: 1,
                            reorderPoint: _num(slot.minQty, 0),
                            restockTo: _num(slot.maxQty, 0) > 0 ? _num(slot.maxQty, 0) : _num(slot.minQty, 0),
                            allowPartial: true,
                            minRestockQty: 0,
                            round: 'none'
                        }
                    });

                    const dailyRestockQty = Array.isArray(sim.dailyRestockQty) ? sim.dailyRestockQty : [];
                    for (let d=0; d<H; d++){
                        const qty = Math.max(0, _num(dailyRestockQty[d], 0));
                        if (!qty) continue;
                        const cost = qty * unitCost;
                        out.dailyRestockQty[d] += qty;
                        out.dailyRestockCost[d] += cost;
                        const key = String(locMeta.mainLocation || subloc).trim() || 'Unknown';
                        byDayLoc[d][key] = (byDayLoc[d][key] || 0) + qty;
                    }

                    if (enabled()){
                        console.log('[analytics forecast]', {
                            itemCode: code,
                            sublocation: subloc,
                            seriesType: usageProj?.methodMeta?.seriesType,
                            method: usageProj?.methodMeta?.method,
                            baseDaily: _num(usageProj?.baseDaily, 0),
                            trendPctPerDay: _num(usageProj?.methodMeta?.trendPctPerDay, 0),
                            trendMultNow: _num(trendMultNow, 1),
                            totalProjectedRestockQty: dailyRestockQty.reduce((s,v)=>s+_num(v,0),0)
                        });
                    }
                }
            }

            for (let d=0; d<H; d++){
                const locs = Object.entries(byDayLoc[d]);
                locs.sort((a,b)=>b[1]-a[1]);
                out.topLocationByDay[d] = locs.length ? locs[0][0] : '';
                out.totalRestockQty += out.dailyRestockQty[d];
            }
            out.projectionMode = 'USAGE_SINGLE_ITEM_LOCATION';
            out.projectionLabel = 'Usage-based Restock Projection';
            if (typeof DEBUG_RESTOCK_PROJ !== 'undefined' && DEBUG_RESTOCK_PROJ) {
                console.log('[analytics restock projection]', {
                    MODE: 'USAGE_SINGLE_ITEM_LOCATION',
                    isAllLocations,
                    isAllItems,
                    selectedFilters: { itemCode: itemCode || 'ALL', locationId: locationId || 'ALL' }
                });
            }
            return out;
        }

        function _getDailyUsageByCode(md){
            const out = Object.create(null);
            try{
                const items = Array.isArray(md && md.items) ? md.items : [];
                for (const it of items){
                    const code = (it && it.itemCode!=null) ? String(it.itemCode).trim() : '';
                    if (!code) continue;
                    const daily = (it._cachedDailyUsage!=null) ? _num(it._cachedDailyUsage,0)
                        : ((it._cachedWeeklyUsage!=null) ? _num(it._cachedWeeklyUsage,0)/7 : 0);
                    out[code] = Math.max(0, daily);
                }
            }catch(e){}
            return out;
        }

        function _getItemDescriptionByCode(md){
            const out = Object.create(null);
            try{
                const items = Array.isArray(md && md.items) ? md.items : [];
                for (const it of items){
                    const code = (it && it.itemCode!=null) ? String(it.itemCode).trim() : '';
                    if (!code) continue;
                    // Prefer verbose description fields over display name
                    const desc = String(it.description ?? it.drugDescription ?? it.itemDescription ?? it.longDescription ?? it.drugName ?? it.itemName ?? '').trim();
                    out[code] = desc || code;
                }
            }catch(e){}
            return out;
        }

        function _getItemNameByCode(md){
            const out = Object.create(null);
            try{
                const items = Array.isArray(md && md.items) ? md.items : [];
                for (const it of items){
                    const code = (it && it.itemCode!=null) ? String(it.itemCode).trim() : '';
                    if (!code) continue;
                    out[code] = String(it.drugName ?? it.description ?? it.itemName ?? '').trim() || code;
                }
            }catch(e){}
            return out;
        }

        function _makeWasteByItemCacheKey(md, months=12){
            const inv = (md && md.inventory && typeof md.inventory==='object') ? md.inventory : null;
            const items = (md && Array.isArray(md.items)) ? md.items : null;
            const invKey = inv ? Object.keys(inv).length : 0;
            const itemsKey = items ? items.length : 0;
            const last = String(md && (md.lastUpdated || md.generatedAt || md.lastComputedAt || ''));
            return `wasteByItem|m=${months}|inv=${invKey}|items=${itemsKey}|last=${last}`;
        }

        /**
         * Expiry-based waste projection aggregated by itemCode.
         * Mirrors the FIFO-by-expiry approximation used in buildWasteMonthlyProjection.
         */
        function buildWasteByItem(md, months=12){
            const key = _makeWasteByItemCacheKey(md, months);
            if (__forecastCache.wasteByItemKey === key && __forecastCache.wasteByItem) return __forecastCache.wasteByItem;

            const inventoryRoot = (md && md.inventory && typeof md.inventory==='object') ? md.inventory : null;
            const items = Array.isArray(md && md.items) ? md.items : [];
            if (!inventoryRoot || !items.length){
                __forecastCache.wasteByItemKey = key;
                __forecastCache.wasteByItem = { byItem: Object.create(null), totalCost:0, totalQty:0 };
                return __forecastCache.wasteByItem;
            }

            const unitCostByCode = Object.create(null);
            const dailyUsageByCode = _getDailyUsageByCode(md);

            for (const it of items){
                const code = (it && it.itemCode!=null) ? String(it.itemCode).trim() : '';
                if (!code) continue;
                const unit = _num(it.unitPrice ?? it.unitCost ?? it.costPerUnit ?? it.gpoPrice ?? it.wacPrice, 0);
                unitCostByCode[code] = unit;
            }

            const today = new Date(); today.setHours(0,0,0,0);
            const start = new Date(today.getFullYear(), today.getMonth(), 1, 0,0,0,0);
            const endMonth = new Date(start.getFullYear(), start.getMonth()+months, 1, 0,0,0,0); // exclusive

            const byItem = Object.create(null);
            let totalCost=0, totalQty=0;

            const codes = Object.keys(inventoryRoot);
            for (const codeRaw of codes){
                const code = String(codeRaw);
                const invByLoc = inventoryRoot[codeRaw];
                if (!invByLoc || typeof invByLoc !== 'object') continue;

                const lots = [];
                for (const loc of Object.keys(invByLoc)){
                    const rec = invByLoc[loc] || {};
                    const qty = _num(rec.qty ?? rec.quantity, 0);
                    const expISO = String(rec.expires || rec.expiration || rec.expiry || '').slice(0,10);
                    if (!qty || !expISO) continue;
                    const expD = _parseISODate(expISO);
                    if (!expD) continue;
                    if (expD < start || expD >= endMonth) continue;
                    lots.push({ loc, qty, expD, expISO });
                }
                if (!lots.length) continue;

                lots.sort((a,b)=>a.expD-b.expD);

                const avgDaily = dailyUsageByCode[code] || 0;
                const unitCost = unitCostByCode[code] || 0;

                let cumSupply = 0;
                for (const lot of lots){
                    cumSupply += lot.qty;
                    const daysToExpiry = Math.max(0, _daysBetween(today, lot.expD) + 1);
                    const demandUntilExpiry = avgDaily * daysToExpiry;

                    const supplyBeforeCurrent = cumSupply - lot.qty;
                    const demandAfterEarlier = Math.max(0, demandUntilExpiry - supplyBeforeCurrent);
                    const consumedFromCurrent = Math.min(lot.qty, demandAfterEarlier);
                    const leftover = Math.max(0, lot.qty - consumedFromCurrent);

                    if (leftover > 0.00001){
                        const wasteCost = unitCost * leftover;
                        if (!byItem[code]){
                            byItem[code] = { itemCode: code, cost:0, qty:0, bySublocation: Object.create(null) };
                        }
                        byItem[code].cost += wasteCost;
                        byItem[code].qty += leftover;

                        const locInfo = _parseLocAndSubloc(lot.loc);
                        const sl = locInfo.sublocation;
                        if (!byItem[code].bySublocation[sl]){
                            byItem[code].bySublocation[sl] = { sublocation: sl, cost:0, qty:0 };
                        }
                        byItem[code].bySublocation[sl].cost += wasteCost;
                        byItem[code].bySublocation[sl].qty += leftover;

                        totalCost += wasteCost;
                        totalQty += leftover;
                    }
                }
            }

            __forecastCache.wasteByItemKey = key;
            __forecastCache.wasteByItem = { byItem, totalCost, totalQty };
            return __forecastCache.wasteByItem;
        }

	    /**
	     * Builds correlation points for Waste vs Usage scatter.
	     * X = daily usage (canonical cached daily usage)
	     * Y = projected expiry waste cost (from buildWasteByItem)
	     * Size = unit price (clamped in renderer)
	     */
	    function buildWasteUsageCorrelation(md, months=12){
	        const inv = (md && md.inventory && typeof md.inventory==='object') ? md.inventory : null;
	        const items = Array.isArray(md && md.items) ? md.items : [];
	        const invKey = inv ? Object.keys(inv).length : 0;
	        const itemsKey = items.length;
	        const last = String(md && (md.lastUpdated || md.generatedAt || md.lastComputedAt || ''));
	        const key = `corr|m=${months}|inv=${invKey}|items=${itemsKey}|last=${last}`;
	        if (__forecastCache.correlationKey === key && __forecastCache.correlation) return __forecastCache.correlation;

	        const dailyUsageByCode = _getDailyUsageByCode(md);
	        const descByCode = _getItemDescriptionByCode(md);
            const nameByCode = _getItemNameByCode(md);
	        const unitPriceByCode = Object.create(null);
	        for (const it of items){
	            const code = (it && it.itemCode!=null) ? String(it.itemCode).trim() : '';
	            if (!code) continue;
	            unitPriceByCode[code] = _num(it.unitPrice ?? it.unitCost ?? it.costPerUnit ?? it.gpoPrice ?? it.wacPrice, 0);
	        }

	        const wasteAgg = buildWasteByItem(md, months);
	        const byItem = (wasteAgg && wasteAgg.byItem) ? wasteAgg.byItem : {};

	        const plotPoints = [];
	        const codes = new Set([...Object.keys(byItem), ...Object.keys(dailyUsageByCode)]);
	        for (const code of codes){
	            const dailyUsage = Math.max(0, _num(dailyUsageByCode[code], 0));
	            const wasteCost = Math.max(0, _num(byItem[code] && byItem[code].cost, 0));
	            if (dailyUsage <= 0 && wasteCost <= 0) continue;
	            plotPoints.push({
	                itemCode: code,
	                itemDescription: descByCode[code] || nameByCode[code] || code,
                    drugName: nameByCode[code] || code,
	                dailyUsage,
	                projectedWasteCost: wasteCost,
	                unitPrice: unitPriceByCode[code] || 0
	            });
	        }

	        // Midlines: medians for quadrant split (stable under outliers)
	        const xs = plotPoints.map(p=>p.dailyUsage).sort((a,b)=>a-b);
	        const ys = plotPoints.map(p=>p.projectedWasteCost).sort((a,b)=>a-b);
	        const med = (arr)=>{
	            if (!arr.length) return 0;
	            const mid = Math.floor(arr.length/2);
	            return arr.length%2 ? arr[mid] : (arr[mid-1]+arr[mid])/2;
	        };

	        const out = { plotPoints, xMid: med(xs), yMid: med(ys) };
	        __forecastCache.correlationKey = key;
	        __forecastCache.correlation = out;
	        return out;
	    }

        function _stockoutKey(md, bufferDays, horizonDays){
            const inv = (md && md.inventory && typeof md.inventory==='object') ? md.inventory : null;
            const items = (md && Array.isArray(md.items)) ? md.items : null;
            const invKey = inv ? Object.keys(inv).length : 0;
            const itemsKey = items ? items.length : 0;
            const last = String(md && (md.lastUpdated || md.generatedAt || md.lastComputedAt || ''));
            return `stockout|b=${bufferDays}|h=${horizonDays}|inv=${invKey}|items=${itemsKey}|last=${last}`;
        }

        function getMinQtyTotalForItem(invEntry){
            if (!invEntry || typeof invEntry !== 'object') return null;

            const rows = [];

            if (Array.isArray(invEntry.sublocations)){
                for (const raw of invEntry.sublocations){
                    const sub = raw || {};
                    const sublocCode = String(sub.sublocation ?? sub.location ?? '').trim();
                    if (!sublocCode) continue;
                    rows.push({
                        sublocation: sublocCode,
                        minQty: _num(sub.minQty ?? sub.min ?? sub.par ?? sub.min_level ?? 0, 0)
                    });
                }
            } else {
                const skipKeys = new Set(['metadata', 'itemCode', 'sublocations']);
                for (const [key, value] of Object.entries(invEntry)){
                    const sublocCode = String(key || '').trim();
                    if (!sublocCode || skipKeys.has(sublocCode)) continue;
                    if (!value || typeof value !== 'object') continue;

                    rows.push({
                        sublocation: sublocCode,
                        minQty: _num(value.minQty ?? value.min ?? value.par ?? value.min_level ?? 0, 0)
                    });
                }
            }

            if (!rows.length) return null;

            const hasMap = (typeof getSublocationMap === 'function');
            const subMap = hasMap ? (getSublocationMap() || {}) : null;
            let targetRows = rows;
            if (subMap){
                const pharmacyRows = rows.filter((r) => {
                    const meta = subMap[r.sublocation] || {};
                    return String(meta.department || '').toUpperCase() === 'PHARMACY';
                });
                if (pharmacyRows.length) targetRows = pharmacyRows;
            }

            let total = 0;
            for (const r of targetRows) total += _num(r.minQty, 0);
            return total;
        }

        
                function buildStockOutTimeline(md, bufferDays=14, horizonDays=56, limit=5){
            const divergingEnabled = true;
            
    // Prefer item descriptions from analytics payload; keep app-level map as fallback.
    const descByCodeFromApp = (window.InventoryApp && window.InventoryApp.Computed && window.InventoryApp.Computed.descByCode)
        || (window.InventoryApp && window.InventoryApp.Lookups && window.InventoryApp.Lookups.descByCode)
        || {};
// bufferDays/horizonDays kept for compatibility with existing UI controls, but ranking is now score-based.
            const key = _stockoutKey(md, bufferDays, horizonDays) + '|score_v2|limit=' + String(limit) + '|div=' + (divergingEnabled ? '1' : '0');
            if (__forecastCache.stockoutKey === key && __forecastCache.stockout) return __forecastCache.stockout;

            const inventoryByCode = (md && md.inventory && typeof md.inventory==='object') ? md.inventory : {};
            const dailyUsageByCode = _getDailyUsageByCode(md);
            const nameByCode = _getItemNameByCode(md);
            const descByCodeFromMd = _getItemDescriptionByCode(md);
            const descByCode = Object.assign({}, descByCodeFromApp, descByCodeFromMd);
            const map = getSublocationMap ? getSublocationMap() : (window.SUBLOCATION_MAP || {});

            const items = [];

            for (const codeRaw of Object.keys(inventoryByCode)){
                const code = String(codeRaw);
                const invEntry = inventoryByCode[codeRaw] || {};
                const subs = Array.isArray(invEntry.sublocations) ? invEntry.sublocations : [];
                if (!subs.length) continue;

                const dailyUsage = dailyUsageByCode[code] || 0;
                if (dailyUsage <= 0) continue;

                // Proxy distribution: proportional to current qty (fallback: even split).
                let totalCur = 0;
                for (const s of subs){
                    totalCur += _num((s && (s.curQty ?? s.qty)), 0);
                }
                const even = subs.length ? (dailyUsage / subs.length) : dailyUsage;

                const subRows = [];
                for (const s of subs){
                    const sub = s || {};
                    const sublocCode = String(sub.sublocation ?? sub.location ?? '').trim();
                    if (!sublocCode) continue;

                    const curQty = _num(sub.curQty ?? sub.qty, 0);
                    const minQty = _num(sub.minQty ?? sub.min ?? sub.min_qty ?? 0, 0);
                    const standard = !!(sub.standard ?? sub.isStandard ?? false);

                    const w = (totalCur > 0) ? (curQty / totalCur) : (1 / Math.max(1, subs.length));
                    const subUsageRate = Math.max(0, (totalCur > 0) ? (dailyUsage * w) : even);

                    // Stock-out score = Daily Usage / Min Qty (higher means worse)
					const stockoutScore = (minQty > 0) ? (subUsageRate / minQty) : 0;
					// In classic mode, keep legacy >1 threshold; diverging mode plots all location values.
					if (!divergingEnabled && stockoutScore <= 1) continue;

                    const locInfo = (map && map[sublocCode]) ? map[sublocCode] : { mainLocation: sublocCode, department:'Unknown' };
                    // Filter out PHARMACY department (explicit request)
                    try { if (String(locInfo.department||'').toUpperCase() === 'PHARMACY') continue; } catch(e) {}
	                // Filter out PHARMACY department rows for this visualization
	                if (String(locInfo.department || '').toUpperCase() === 'PHARMACY') continue;

					subRows.push({
                        itemCode: code,
                        itemDescription: descByCode[code] || nameByCode[code] || code,
                    drugName: nameByCode[code] || code,
                        sublocation: sublocCode,
                        mainLocation: locInfo.mainLocation || sublocCode,
                        department: locInfo.department || 'Unknown',
                        curQty,
                        minQty,
                        maxQty: _num(sub.maxQty ?? sub.max ?? sub.max_qty ?? 0, 0),
                        standard,
                        usageRate: subUsageRate,
                        stockoutScore
                    });
                }
				if (!subRows.length) continue;

                if (!subRows.length) continue;

                // Sort sublocations by usage rate (most → least)
                subRows.sort((a,b)=> (b.usageRate-a.usageRate) || (a.sublocation.localeCompare(b.sublocation)));

                const itemScore = subRows.reduce((m,r)=>Math.max(m, r.stockoutScore||0), 0);

                items.push({
                    itemCode: code,
                    itemDescription: descByCode[code] || nameByCode[code] || code,
                    drugName: nameByCode[code] || code,
                    dailyUsage,
                    itemScore,
                    sublocationCount: subRows.length,
                    sublocations: subRows
                });
            }

            // Rank items by score (then velocity, then coverage)
            items.sort((a,b)=> (b.itemScore-a.itemScore) || (b.dailyUsage-a.dailyUsage) || (b.sublocationCount-a.sublocationCount));

            const top = (limit && limit > 0) ? items.slice(0, limit) : items;

            // Global score range (used for positioning segments on the score timeline)
            let maxScore = 0, minScore = Infinity;
            for (const it of top){
                for (const r of it.sublocations){
                    const sc = _num(r.stockoutScore,0);
                    if (sc > 0){
                        maxScore = Math.max(maxScore, sc);
                        minScore = Math.min(minScore, sc);
                    }
                }
            }
            if (!isFinite(minScore)) minScore = 0;
            const result = {
                items: top,
                bufferDays,
                horizonDays,
                scoreRange: { min: minScore, max: maxScore },
                generatedAt: new Date().toISOString()
            };

            __forecastCache.stockoutKey = key;
            __forecastCache.stockout = result;
            return result;
        }

        
function renderStockOutRiskTimeline(md){
    const wrap = document.getElementById('stockOutTimeline');
    if (!wrap) return;

    const data = buildStockOutTimeline(md, 14, 56, 5);
    const rawItems = (data && Array.isArray(data.items)) ? data.items : [];
    const sMinRaw = _num(data && data.scoreRange && data.scoreRange.min, 0);
    const sMaxRaw = _num(data && data.scoreRange && data.scoreRange.max, 0);
    const divergingEnabled = true;

    function getRiskComponents(r){
        const minQty = Math.max(1, _num(r && r.minQty, 0));
        const usageRate = Math.max(0, _num(r && r.usageRate, 0));
        // Risk derived from min-based pressure only (no curQty dependency).
        // ratio > 1 => stock-out pressure; ratio < 1 => overstock pressure.
        const ratio = usageRate / minQty;
        if (ratio >= 1){
            return { stockoutRisk: ratio, overstockRisk: 0 };
        }
        const overstockRisk = 1 / Math.max(ratio, 1e-6);
        return { stockoutRisk: 0, overstockRisk };
    }

    function getRowSignedScore(r){
        return _num(r && r.stockoutScore, 0);
    }

    // Global score axis: highest on the left, lowest on the right
    let sMin = Math.min(0, Math.floor(sMinRaw));
    let sMax = Math.max(1, Math.ceil(sMaxRaw));
    if (divergingEnabled){
        let leftMax = 0, rightMax = 0;
        for (const it of rawItems){
            const segs = Array.isArray(it && it.sublocations) ? it.sublocations : [];
            for (const rr of segs){
                const comps = getRiskComponents(rr);
                if (Number.isFinite(comps.stockoutRisk)) leftMax = Math.max(leftMax, comps.stockoutRisk);
                if (Number.isFinite(comps.overstockRisk)) rightMax = Math.max(rightMax, comps.overstockRisk);
            }
        }
        const axisMax = Math.max(1, leftMax, rightMax);
        sMin = -Math.ceil(axisMax);
        sMax = Math.ceil(axisMax);
    }

    // Filter: do not show items with max score <= 1 (explicit request)
    const items = rawItems.filter(it => {
        const segs = Array.isArray(it && it.sublocations) ? it.sublocations : [];
        if (divergingEnabled){
            return segs.some((r)=>{
                const comps = getRiskComponents(r);
                return _num(comps.stockoutRisk, 0) > 0 || _num(comps.overstockRisk, 0) > 0;
            });
        }
        const maxSc = segs.reduce((m, r) => Math.max(m, _num(r.stockoutScore, 0)), 0);
        return maxSc > 1;
    });

    
    // Header KPI: total qualifying items
    try{
        const kpi = document.getElementById('stockOutItemsCount');
        if (kpi) kpi.textContent = String(items.length);
    }catch(_){ }

    try {
        const toggleBtn = document.getElementById('ganttDivergingToggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        const legend = document.getElementById('stockoutTimelineLegend');
        if (legend){
            const note = legend.querySelector('.legend-note');
            if (note){
                note.textContent = divergingEnabled
                    ? 'Origin = split point • max risk near origin • lower risk farther out'
                    : 'Position = Stock-out score (Daily Usage / Min Qty)';
            }
        }
    } catch(_){ }

wrap.innerHTML = '';

    if (!items.length){
        const empty = document.createElement('div');
        empty.className = 'pyxis-metrics-empty';
        empty.textContent = divergingEnabled ? 'No items outside Min/Max range.' : 'No items with Stock-out Score above 1.';
        wrap.appendChild(empty);
        return;
    }

    // Per-row zoom state (rowId -> {zoomed:boolean, cluster:Array|null})
    const rowState = new Map();

    // Global zoom state: when a "2+ Locations" cluster is expanded,
    // we expand the row height for ALL items and animate the score scale.
    // Persist on the wrapper so it survives re-renders.
    if (!wrap._ganttZoom){
        wrap._ganttZoom = { active:false, min:sMin, max:sMax, focusItem:null, focusCluster:null, focusPct:50 };
    }
    const ganttZoom = wrap._ganttZoom;

    // Current (possibly animated) scale
    let curMinV = ganttZoom.active ? ganttZoom.min : sMin;
    let curMaxV = ganttZoom.active ? ganttZoom.max : sMax;

    function scoreToPct(sc, minV, maxV){
        const den = (maxV - minV) || 1;
        const t = divergingEnabled ? _clamp((sc - minV) / den, 0, 1) : _clamp((maxV - sc) / den, 0, 1); // diverging: low->left, high->right
        return t * 100;
    }

    function bindStockoutTooltip(el, text){
        if (!el) return;
        const tipText = String(text || '').trim();
        if (!tipText) return;
        const tip = document.getElementById('customTooltip');
        if (!tip) {
            el.title = tipText;
            return;
        }
        el.removeAttribute('title');
        const show = (ev)=>{
            tip.textContent = tipText;
            tip.style.left = ((ev.pageX || 0) + 10) + 'px';
            tip.style.top = ((ev.pageY || 0) - 30) + 'px';
            tip.classList.add('visible');
        };
        const move = (ev)=>{
            if (!tip.classList.contains('visible')) return;
            tip.style.left = ((ev.pageX || 0) + 10) + 'px';
            tip.style.top = ((ev.pageY || 0) - 30) + 'px';
        };
        const hide = ()=> tip.classList.remove('visible');
        el.addEventListener('mouseenter', show);
        el.addEventListener('mousemove', move);
        el.addEventListener('mouseleave', hide);
    }

    // JS can't use Python syntax; build clusters in plain JS style:
    function buildClusters(sorted, segWpx){
        const clusters = [];
        let cur = [];
        let curMaxX = -Infinity;
        for (const seg of sorted){
            const x = seg.xPx;
            if (!cur.length){
                cur = [seg];
                curMaxX = x;
                continue;
            }
            // Overlap if centers are closer than seg width
            if (Math.abs(x - curMaxX) < segWpx){
                cur.push(seg);
                curMaxX = x;
            } else {
                clusters.push(cur);
                cur = [seg];
                curMaxX = x;
            }
        }
        if (cur.length) clusters.push(cur);
        return clusters;
    }

    function applyGanttSegmentTone(seg, isStd){
        if (isStd) return;
        seg.style.background = 'rgba(160,160,160,0.25)';
        seg.style.border = '1px solid rgba(180,180,180,0.35)';
        seg.style.color = '#cfcfcf';
    }

    // Render a single row. If forceCluster is provided, we are in the expanded view.
    function renderRow(track, item, minV, maxV, forceCluster=null){
        track.innerHTML = '';

        const segWpx = 110; // fixed width
        const segs = Array.isArray(item && item.sublocations) ? item.sublocations : [];
        const filtered = divergingEnabled ? segs : segs.filter(r => _num(r.stockoutScore, 0) > 1);
        if (!filtered.length) return;

        if (divergingEnabled){
            track.style.position = 'relative';
            const originPct = 50;
            const sorted = [...segs].sort((a,b)=>_num(b.usageRate,0)-_num(a.usageRate,0));
            const trackW = Math.max(1, track.clientWidth || 1);
            const originX = trackW * (originPct / 100);
            const convergeX = originX + 50;
            const halfW = segWpx / 2;
            const edgeGap = 2;
            const leftBound = halfW;
            const leftNearOrigin = convergeX - halfW - edgeGap;
            const rightNearOrigin = convergeX + halfW + edgeGap + 12;
            const rightBound = trackW - halfW;
            const leftSpan = Math.max(20, leftNearOrigin - leftBound);
            const rightSpan = Math.max(20, rightBound - rightNearOrigin);

            const leftPts = [];
            const rightPts = [];
            for (const rr of sorted){
                const comps = getRiskComponents(rr);
                const stockRisk = _num(comps.stockoutRisk, 0);
                const overRisk = _num(comps.overstockRisk, 0);
                if (stockRisk > 0) leftPts.push({ rr, risk: stockRisk, side:'stockout', stockRisk, overRisk });
                if (overRisk > 0) rightPts.push({ rr, risk: overRisk, side:'overstock', stockRisk, overRisk });
            }

            const maxLeft = Math.max(1, ...leftPts.map(p=>_num(p.risk,0)));
            const maxRight = Math.max(1, ...rightPts.map(p=>_num(p.risk,0)));
            const gap = segWpx + 6;

            function placeSide(points, isLeft, maxRisk, sideSpan){
                if (!points.length) return [];
                const out = [];
                const arr = [...points].sort((a,b)=>_num(b.risk,0)-_num(a.risk,0));
                let prev = null;
                for (const p of arr){
                    const risk = Math.max(1, _num(p.risk, 1));
                    const norm = (risk - 1) / Math.max(1e-9, maxRisk - 1);
                    const desired = isLeft
                        ? (leftBound + norm * sideSpan)
                        : (rightBound - norm * sideSpan);
                    let x = desired;
                    if (prev != null){
                        x = isLeft ? Math.min(x, prev - gap) : Math.max(x, prev + gap);
                    }
                    prev = x;
                    out.push(Object.assign({}, p, { x }));
                }
                return out;
            }

            const placedLeft = placeSide(leftPts, true, maxLeft, leftSpan);
            const placedRight = placeSide(rightPts, false, maxRight, rightSpan);

            const panState = wrap._ganttPan || (wrap._ganttPan = { left:0, right:0 });
            const minXLeft = placedLeft.length ? Math.min(...placedLeft.map(p=>p.x)) : leftBound;
            const maxXLeft = placedLeft.length ? Math.max(...placedLeft.map(p=>p.x)) : leftNearOrigin;
            const minXRight = placedRight.length ? Math.min(...placedRight.map(p=>p.x)) : rightNearOrigin;
            const maxXRight = placedRight.length ? Math.max(...placedRight.map(p=>p.x)) : rightBound;
            const leftPanMin = Math.min(0, leftBound - minXLeft);
            const leftPanMax = Math.max(0, leftNearOrigin - maxXLeft);
            const rightPanMin = Math.min(0, rightNearOrigin - minXRight);
            const rightPanMax = Math.max(0, rightBound - maxXRight);
            panState.left = _clamp(_num(panState.left,0), leftPanMin, leftPanMax);
            panState.right = _clamp(_num(panState.right,0), rightPanMin, rightPanMax);
            panLimits.leftMin = Math.min(_num(panLimits.leftMin,0), leftPanMin);
            panLimits.leftMax = Math.max(_num(panLimits.leftMax,0), leftPanMax);
            panLimits.rightMin = Math.min(_num(panLimits.rightMin,0), rightPanMin);
            panLimits.rightMax = Math.max(_num(panLimits.rightMax,0), rightPanMax);

            const placed = [
                ...placedLeft.map(p=>Object.assign({}, p, { x: p.x + panState.left })),
                ...placedRight.map(p=>Object.assign({}, p, { x: p.x + panState.right }))
            ];

            for (const pt of placed){
                const rr = pt.rr;
                const isStd = !!(rr && rr.standard);
                const seg = document.createElement('div');
                seg.className = 'stockout-gantt-seg ' + (pt.side === 'stockout' ? 'seg-stockout' : 'seg-overstock') + ' ' + (isStd ? 'seg-standard' : 'seg-nonstandard');
                applyGanttSegmentTone(seg, isStd);
                seg.style.left = (pt.x - halfW) + 'px';
                seg.style.width = segWpx + 'px';
                const riskValue = pt.side === 'stockout' ? _num(pt.stockRisk,0) : _num(pt.overRisk,0);
                const riskLabel = pt.side === 'stockout' ? 'Stock-out risk' : 'Overstock risk';
                bindStockoutTooltip(seg, `${riskLabel}: ${riskValue.toFixed(2)}`);

                const lbl = document.createElement('div');
                lbl.className = 'stockout-gantt-seg-label';
                lbl.textContent = (rr.sublocation || '').toUpperCase();
                seg.appendChild(lbl);
                track.appendChild(seg);
            }

            return;
        }

        // Sort by usage (most -> least)
        const segSorted = [...filtered].sort((a,b)=>_num(b.usageRate,0)-_num(a.usageRate,0));

        const trackW = Math.max(1, track.clientWidth || 1);
        const withPos = segSorted.map(r=>{
            const sc = getRowSignedScore(r);
            const pct = scoreToPct(sc, minV, maxV);
            const xPx = (pct/100) * trackW;
            return { r, sc, pct, xPx };
        }).sort((a,b)=>a.xPx-b.xPx);

        if (forceCluster){
            // Zoomed: render each sublocation in the selected cluster, rescaled to full width.
            // Also render non-expanded segments in a muted state behind the expanded cluster.
            const cs = forceCluster.map(s=>s.r);
            const expandedSet = new Set(cs.map(r=>String(r && r.sublocation || '').trim()).filter(Boolean));

            const trackW = Math.max(1, track.clientWidth || 1);
            const gapPx = 8;

            const toPx = (pct)=> (trackW * (_clamp(_num(pct,0),0,100) / 100));

            // 1) Render muted segments (not part of expansion)
            const muted = segs.filter(rr => {
                const key = String(rr && rr.sublocation || '').trim();
                return key && !expandedSet.has(key);
            });

            const mutedPos = muted.map(rr => ({
                r: rr,
                x: toPx(scoreToPct(getRowSignedScore(rr), minV, maxV))
            })).sort((a,b)=>a.x-b.x);

            mutedPos.forEach(mp=>{
                const rr = mp.r;
                const seg = document.createElement('div');
                const isStd = !!(rr && rr.standard);
                seg.className = 'stockout-gantt-seg seg-muted ' + (isStd ? 'seg-standard' : 'seg-nonstandard');
                applyGanttSegmentTone(seg, isStd);
                seg.style.left = _clamp(mp.x - (segWpx/2), 0, trackW - segWpx) + 'px';
                seg.style.width = segWpx + 'px';
                const lbl = document.createElement('div');
                lbl.className = 'stockout-gantt-seg-label';
                lbl.textContent = (rr.sublocation || '').toUpperCase();
                seg.appendChild(lbl);
                track.appendChild(seg);
            });

            // 2) Render expanded cluster, laid out side-by-side (no overlap)
            const pos = cs.map(rr => ({
                r: rr,
                x: toPx(scoreToPct(getRowSignedScore(rr), minV, maxV))
            })).sort((a,b)=>a.x-b.x);

            // Greedy de-overlap: left-anchored sweep
            for (let i=1; i<pos.length; i++){
                const prev = pos[i-1];
                const cur  = pos[i];
                const minLeft = (prev.leftPx != null ? prev.leftPx : (prev.x - segWpx/2));
                const wantLeft = cur.x - segWpx/2;
                const nextLeft = Math.max(wantLeft, minLeft + segWpx + gapPx);
                cur.leftPx = nextLeft;
            }
            // Backward pass if overflow
            let overflow = (pos.length ? ((pos[pos.length-1].leftPx != null ? pos[pos.length-1].leftPx : (pos[pos.length-1].x - segWpx/2)) + segWpx) - trackW : 0);
            if (overflow > 0){
                for (let i=pos.length-1; i>=0; i--){
                    const cur = pos[i];
                    const curLeft = (cur.leftPx != null ? cur.leftPx : (cur.x - segWpx/2));
                    cur.leftPx = curLeft - overflow;
                }
                // Ensure still non-overlapping after shift (clamp left)
                for (let i=0; i<pos.length; i++){
                    const cur = pos[i];
                    cur.leftPx = Math.max(0, cur.leftPx);
                    if (i>0){
                        const prev = pos[i-1];
                        cur.leftPx = Math.max(cur.leftPx, prev.leftPx + segWpx + gapPx);
                    }
                }
            }
            // Clamp to track
            for (let i=0; i<pos.length; i++){
                pos[i].leftPx = _clamp(pos[i].leftPx, 0, trackW - segWpx);
            }

            pos.forEach(pp=>{
                const rr = pp.r;
                const seg = document.createElement('div');
                const isStd = !!(rr && rr.standard);
                seg.className = 'stockout-gantt-seg seg-expanded ' + (isStd ? 'seg-standard' : 'seg-nonstandard');
                applyGanttSegmentTone(seg, isStd);
                seg.style.left = pp.leftPx + 'px';
                seg.style.width = segWpx + 'px';

                seg.title = `${rr.sublocation || ''}${rr.mainLocation ? ' • ' + rr.mainLocation : ''}
Daily Usage: ${_num(rr.usageRate,0).toFixed(2)}/day
Min Qty: ${_num(rr.minQty,0).toFixed(0)}`;

                const lbl = document.createElement('div');
                lbl.className = 'stockout-gantt-seg-label';
                lbl.textContent = (rr.sublocation || '').toUpperCase();
                seg.appendChild(lbl);

                seg.addEventListener('click', (e)=>{
                    try{ e.stopPropagation(); }catch(_){ }
                    if (window.parent){
                        window.parent.postMessage({
                            type: 'navigateToFlowFromStockoutSegment',
                            itemCode: String(item.itemCode||''),
                            sublocation: String(rr.sublocation||''),
                            avgDailyTx: _num(rr.avgDailyTx, 0)
                        }, '*');
                    }
                });

                track.appendChild(seg);
            });

            // Exit zoom is handled by wrapper click (see requestZoom/resetZoom)
            return;
        }

        // Non-zoom: cluster overlaps and render grouped segments
        const clusters = buildClusters(withPos, segWpx);

        for (const cl of clusters){
            if (cl.length <= 1){
                const one = cl[0];
                const rr = one.r;
                const seg = document.createElement('div');
                const isStd = !!(rr && rr.standard);
                seg.className = 'stockout-gantt-seg ' + (isStd ? 'seg-standard' : 'seg-nonstandard');
                applyGanttSegmentTone(seg, isStd);
                seg.style.left = one.pct + '%';
                seg.style.width = segWpx + 'px';
                seg.title = `${rr.sublocation || ''}${rr.mainLocation ? ' • ' + rr.mainLocation : ''}
Daily Usage: ${_num(rr.usageRate,0).toFixed(2)}/day
Min Qty: ${_num(rr.minQty,0).toFixed(0)}`;

                const lbl = document.createElement('div');
                lbl.className = 'stockout-gantt-seg-label';
                lbl.textContent = (rr.sublocation || '').toUpperCase();
                seg.appendChild(lbl);

                seg.addEventListener('click', (e)=>{
                    try{ e.stopPropagation(); }catch(_){ }
                    if (window.parent){
                        window.parent.postMessage({
                            type: 'navigateToFlowFromStockoutSegment',
                            itemCode: String(item.itemCode||''),
                            sublocation: String(rr.sublocation||''),
                            avgDailyTx: _num(rr.avgDailyTx, 0)
                        }, '*');
                    }
                });

                track.appendChild(seg);
            } else {
                // Group into a single segment
                const avgPct = cl.reduce((s,x)=>s+x.pct,0) / cl.length;
                const anyStd = cl.some(x=>!!(x.r && x.r.standard));
                const seg = document.createElement('div');
                seg.className = 'stockout-gantt-seg ' + (anyStd ? 'seg-standard' : 'seg-nonstandard');
                applyGanttSegmentTone(seg, anyStd);
                seg.style.left = avgPct + '%';
                seg.style.width = segWpx + 'px';

                // Tooltip shows list (compressed)
                const top3 = cl.slice(0,3).map(x=>x.r && x.r.sublocation).filter(Boolean);
                const more = cl.length > 3 ? ` (+${cl.length-3} more)` : '';
                seg.title = `2+ Locations
${top3.join(', ')}${more}`;

                const lbl = document.createElement('div');
                lbl.className = 'stockout-gantt-seg-label';
                lbl.textContent = '2+ Locations';
                seg.appendChild(lbl);

                // Click to zoom into cluster (spread apart)
                seg.addEventListener('click', (e)=>{
                    try{ e.stopPropagation(); }catch(_){ }
                    // Store the cluster for this item so we can render its sublocations
                    // individually in the zoomed scale.
                    const st = rowState.get(item.itemCode) || { zoomed:false, cluster:null };
                    st.zoomed = true;
                    st.cluster = cl;
                    rowState.set(item.itemCode, st);

                    // Compute the zoomed score window around this cluster.
                    const scores = cl.map(x=>getRowSignedScore(x && x.r)).filter(v=>Number.isFinite(v));
                    const scMin = scores.length ? Math.min(...scores) : 0;
                    const scMax = scores.length ? Math.max(...scores) : 0;
                    // Start with a reasonable window, then tighten further if overlap remains.
                    let pad = 0.25;
                    let zMin = Math.max(0, scMin - pad);
                    let zMax = Math.max(zMin + 0.5, scMax + pad);

                    // Tighten the zoom window as long as we'd still overlap at fixed segment width.
                    // Use the current track width (pixels) to estimate overlap.
                    const trackW2 = Math.max(1, track.clientWidth || 1);
                    const scoresSorted = scores.sort((a,b)=>a-b);
                    const minDelta = scoresSorted.reduce((m,v,i)=>{
                        if (i===0) return m;
                        return Math.min(m, Math.abs(v - scoresSorted[i-1]));
                    }, Infinity);
                    const safeDelta = Number.isFinite(minDelta) && minDelta>0 ? minDelta : 0.05;
                    const needPct = (segWpx / trackW2) * 100;
                    for (let i=0; i<6; i++){
                        const zDen = (zMax - zMin) || 1;
                        const minPct = (safeDelta / zDen) * 100;
                        if (minPct >= needPct * 0.92) break;
                        const mid = (zMin + zMax) / 2;
                        const targetDen = Math.max((scMax - scMin) + 0.10, zDen * 0.72);
                        zMin = Math.max(0, mid - targetDen/2);
                        zMax = Math.max(zMin + 0.25, mid + targetDen/2);
                    }

                    // Global zoom: expand ALL rows and animate the scale expanding
                    // outward from this segment's position.
                    requestZoom(zMin, zMax, avgPct, item.itemCode, cl);
                });

                track.appendChild(seg);
            }
        }
    }

    // Keep track references so we can re-render ALL rows when the scale changes.
    const rowRefs = [];
    const panLimits = { leftMin: 0, leftMax: 0, rightMin: 0, rightMax: 0 };

    function syncOriginOverlay(){
        if (!divergingEnabled) return;
        const firstTrack = rowRefs.length ? rowRefs[0].track : null;
        const lastTrack = rowRefs.length ? rowRefs[rowRefs.length - 1].track : null;
        if (!firstTrack || !lastTrack) return;
        let line = wrap.querySelector('.stockout-origin-overlay');
        if (!line){
            line = document.createElement('div');
            line.className = 'stockout-origin-overlay';
            wrap.appendChild(line);
        }
        const wrapRect = wrap.getBoundingClientRect();
        const firstRect = firstTrack.getBoundingClientRect();
        const lastRect = lastTrack.getBoundingClientRect();
        const left = (firstRect.left - wrapRect.left) + (firstRect.width * 0.5);
        line.style.left = left + 'px';
        line.style.top = (firstRect.top - wrapRect.top) + 'px';
        line.style.height = Math.max(0, (lastRect.bottom - firstRect.top)) + 'px';
    }

    function ensurePanWheelOnly(){
        if (!wrap.__panWheelWired){
            wrap.__panWheelWired = true;
            wrap.addEventListener('wheel', (ev)=>{
                if (divergingEnabled !== true) return;
                const rect = wrap.getBoundingClientRect();
                const x = ev.clientX - rect.left;
                const mid = rect.width * 0.45;
                const delta = _num(ev.deltaX, 0) || _num(ev.deltaY, 0);
                const step = (Math.abs(delta) > 0) ? (delta > 0 ? 30 : -30) : 0;
                if (!step) return;
                const pan = wrap._ganttPan || (wrap._ganttPan = { left:0, right:0 });
                if (x < mid){
                    if (panLimits.leftMin >= 0 && panLimits.leftMax <= 0) return;
                    pan.left = _clamp(_num(pan.left,0) + step, _num(panLimits.leftMin,0), _num(panLimits.leftMax,0));
                } else {
                    if (panLimits.rightMin >= 0 && panLimits.rightMax <= 0) return;
                    pan.right = _clamp(_num(pan.right,0) + step, _num(panLimits.rightMin,0), _num(panLimits.rightMax,0));
                }
                ev.preventDefault();
                renderAll();
            }, { passive:false });
        }
    }

    function renderAll(){

        panLimits.leftMin = 0;
        panLimits.leftMax = 0;
        panLimits.rightMin = 0;
        panLimits.rightMax = 0;
        for (const ref of rowRefs){
            const it = ref.item;
            const track = ref.track;
            const st = rowState.get(it.itemCode);
            const shouldZoom = !!(ganttZoom.active && st && st.zoomed && st.cluster && ganttZoom.focusItem === it.itemCode);
            const nextMode = shouldZoom ? 'zoom' : 'base';
            const prevMode = track._mode || 'base';

            // Only animate swaps when entering/exiting zoom, not on every scale tick.
            if (prevMode !== nextMode){
                track._mode = nextMode;
                // Slide existing segments out
                const kids = Array.from(track.querySelectorAll('.stockout-gantt-seg'));
                kids.forEach(k=>k.classList.add('seg-exit'));
                // After exit animation, render the new set and slide them in.
                setTimeout(()=>{
                    try{ track.innerHTML = ''; }catch(_){ }
                    if (shouldZoom){ track.classList.add('zoomed'); }
                    else { track.classList.remove('zoomed'); }
                    renderRow(track, it, curMinV, curMaxV, shouldZoom ? st.cluster : null);
                    const newKids = Array.from(track.querySelectorAll('.stockout-gantt-seg'));
                    newKids.forEach(k=>k.classList.add('seg-enter'));
                    requestAnimationFrame(()=> newKids.forEach(k=>k.classList.remove('seg-enter')));
                }, 170);
            } else {
                if (shouldZoom) track.classList.add('zoomed');
                else track.classList.remove('zoomed');
                renderRow(track, it, curMinV, curMaxV, shouldZoom ? st.cluster : null);
            }
        }
        syncOriginOverlay();
        ensurePanWheelOnly();
    }

    function resetZoom(){
        ganttZoom.active = false;
        ganttZoom.min = sMin;
        ganttZoom.max = sMax;
        ganttZoom.focusItem = null;
        ganttZoom.focusCluster = null;
        wrap.classList.remove('gantt-zoomed');
        curMinV = sMin;
        curMaxV = sMax;
        // clear per-row zoom flags
        for (const k of rowState.keys()){
            const st = rowState.get(k);
            if (st){ st.zoomed = false; st.cluster = null; rowState.set(k, st); }
        }
        renderAll();
    }

    // Animate the score scale expansion to make it feel like the timeline is
    // expanding outward from the clicked segment.
    function requestZoom(toMin, toMax, focusPct, focusItemCode, cluster){
        ganttZoom.active = true;
        ganttZoom.min = toMin;
        ganttZoom.max = toMax;
        ganttZoom.focusPct = _clamp(_num(focusPct,50), 0, 100);
        ganttZoom.focusItem = focusItemCode;
        ganttZoom.focusCluster = cluster;
        wrap.classList.add('gantt-zoomed');

        const fromMin = curMinV;
        const fromMax = curMaxV;
        const start = performance.now();
        const dur = 260;

        // Apply a transform-origin hint for CSS (future-proof)
        try{ wrap.style.setProperty('--gantt-zoom-origin', ganttZoom.focusPct + '%'); }catch(_){ }

        function ease(t){ return 1 - Math.pow(1 - t, 3); }
        function step(now){
            const t = _clamp((now - start) / dur, 0, 1);
            const e = ease(t);
            curMinV = fromMin + (toMin - fromMin) * e;
            curMaxV = fromMax + (toMax - fromMax) * e;
            renderAll();
            if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);

        // Clicking empty space on the card exits zoom
        const onWrapClick = (ev)=>{
            // Avoid exit when clicking a segment
            if (ev && ev.target && (ev.target.closest && ev.target.closest('.stockout-gantt-seg'))) return;
            resetZoom();
            wrap.removeEventListener('click', onWrapClick);
        };
        wrap.addEventListener('click', onWrapClick);
    }

    // Apply zoom class if we are already in a zoomed view
    if (ganttZoom.active) wrap.classList.add('gantt-zoomed');
    else wrap.classList.remove('gantt-zoomed');

    // Render rows (structure once; segments are rendered via renderAll())
    rowRefs.length = 0;
    for (const it of items){
        const row = document.createElement('div');
        row.className = 'stockout-gantt-row';

        const left = document.createElement('div');
        left.className = 'stockout-gantt-left';

        const title = document.createElement('div');
        title.className = 'stockout-gantt-title';
        title.textContent = it.description || it.itemDescription || it.drugName || it.itemCode;
        left.appendChild(title);

        const track = document.createElement('div');
        track.className = 'stockout-gantt-track';

        row.appendChild(left);
        row.appendChild(track);
        wrap.appendChild(row);
        rowRefs.push({ item: it, track });
    }

    // Defer segment layout until widths are known
    requestAnimationFrame(renderAll);
}



// Apply a selected waste month (from mini chart) to the Waste vs Usage scatter
// Filters points to the provided itemCodes and updates header total + caption.
function applyWasteMonthSelectionToScatter(itemCodes, monthLabel, totalCost) {
    try {
        const host = document.getElementById('wasteUsageScatter');
        if (!host) return;
        const codes = Array.isArray(itemCodes) ? itemCodes.map(x => String(x)) : [];
        host._corrFilter = { itemCodes: codes, monthLabel: String(monthLabel || ''), totalCost: Number(totalCost) || 0 };

        // Update header right summary
        const hdr = document.getElementById('wasteUsageHeaderRight');
        const totalEl = document.getElementById('wasteUsageSelectedTotal');
        const capEl = document.getElementById('wasteUsageSelectedCaption');
        if (hdr && totalEl && capEl) {
            hdr.style.display = 'flex';
            const dollars = Number(totalCost) || 0;
            totalEl.textContent = dollars.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
            capEl.textContent = String(monthLabel || '').trim();
        }

        // Re-render scatter using the last known analytics mock data.
        // (updateSummaryCards passes md; we cache it so bar clicks can reuse it.)
        const md = (typeof window !== 'undefined' && window.__lastAnalyticsMockData) ? window.__lastAnalyticsMockData : undefined;
        if (typeof renderWasteUsageCorrelation === 'function') {
            renderWasteUsageCorrelation(md);
        }
    } catch (e) {
        console.warn('⚠️ applyWasteMonthSelectionToScatter failed', e);
    }
}
function renderWasteUsageCorrelation(md){
    const host = document.getElementById('wasteUsageScatter');
    if (!host) return;

    let data;
    try{
        data = buildWasteUsageCorrelation(md, 12);
    } catch (e){
        console.warn('⚠️ buildWasteUsageCorrelation failed', e);
        host.innerHTML = '<div class="pyxis-metrics-empty">No correlation data available.</div>';
        return;
    }

    // Filter: only show items with >= $100 projected waste (requested)
    let pts = (data && Array.isArray(data.plotPoints)) ? data.plotPoints : [];
    pts = pts.filter(p => _num(p.projectedWasteCost,0) >= 100);

    // If a waste-month bar is selected, constrain points to that month’s itemCodes
    try{
        const f = host._corrFilter;
        if (f && Array.isArray(f.itemCodes) && f.itemCodes.length){
            const set = new Set(f.itemCodes.map(x=>String(x)));
            pts = pts.filter(p => set.has(String(p.itemCode)));
        }
    }catch(e){}


    host.innerHTML = '';
    if (!pts.length){
        const empty = document.createElement('div');
        empty.className = 'pyxis-metrics-empty';
        empty.textContent = 'No correlation data available.';
        host.appendChild(empty);
        return;
    }

    const isDark = !!(document.body && document.body.classList && document.body.classList.contains('dark-mode'));
    const axisColor  = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.25)';
    const midColor   = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
    const labelColor = isDark ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.68)';
    const strokeColor= isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';

    const W = host.clientWidth || 520;
    const H = host.clientHeight || 360;

    // Keep the X-axis flush to the bottom edge (requested previously)
    const pad = { l:46, r:18, t:18, b:0 };
    const iw = Math.max(1, W - pad.l - pad.r);
    const ih = Math.max(1, H - pad.t - pad.b);

    // Base domains
    const baseMaxX = Math.max(1e-6, ...pts.map(p=>Math.max(0, _num(p.dailyUsage,0))));
    const yVals = pts.map(p=>Math.max(0, _num(p.projectedWasteCost,0))).sort((a,b)=>a-b);
    const pct = (p)=>{
        if (!yVals.length) return 0;
        const i = Math.max(0, Math.min(yVals.length-1, Math.round((yVals.length-1)*p)));
        return yVals[i];
    };
    const yP95 = pct(0.95);
    const yP50 = pct(0.50);
    const yMaxRaw = yVals.length ? yVals[yVals.length-1] : 1e-6;
    const baseMaxY = Math.max(1e-6, (yP95>0 ? yP95*1.25 : yMaxRaw), yP50*2);

    // Price → radius scaling (min/max clamp)
    const prices = pts.map(p=>Math.max(0, _num(p.unitPrice,0))).filter(v=>v>0).sort((a,b)=>a-b);
    const pMin = prices.length ? prices[0] : 0;
    const pMax = prices.length ? prices[prices.length-1] : 0;
    const minR = 3.0, maxR = 9.0;
    const sqrtMin = Math.sqrt(Math.max(0, pMin));
    const sqrtMax = Math.sqrt(Math.max(0, pMax));
    const radius = (price)=>{
        const v = Math.max(0, _num(price,0));
        if (pMax<=0 || sqrtMax<=sqrtMin) return 4.0;
        const t = _clamp((Math.sqrt(v)-sqrtMin) / (sqrtMax - sqrtMin), 0, 1);
        return minR + t*(maxR-minR);
    };

    // Fixed origin values (requested): the crosshair represents these values.
    // Moving the crosshair changes the mapping, but the origin values remain constant.
    const ORIGIN_X = 0.2;   // Usage (units/day)
    const ORIGIN_Y = 500;   // Projected waste ($)

    // Persist interaction state on the host element
    if (!host._corrState){
        host._corrState = {
            xMidPx: pad.l + iw*0.5,
            yMidPx: pad.t + ih*0.5,
            dragging: false,
            zoom: 1.0,
            _initialized: false
        };
    }

    const svgNS = 'http://www.w3.org/2000/svg';

    // Tooltip div
    let tip = host.querySelector('.waste-usage-tooltip');
    if (!tip){
        tip = document.createElement('div');
        tip.className = 'waste-usage-tooltip';
        tip.style.display = 'none';
        host.appendChild(tip);
    }

    const showTip = (px, py, html)=>{
        tip.innerHTML = html;
        // Measure + flip if we would overflow the card
        tip.style.display = 'block';
        tip.style.visibility = 'hidden';

        const padEdge = 8;
        let left = px + 10;
        let top  = py - 10;

        // Clamp initial
        left = Math.min(W - padEdge, Math.max(padEdge, left));
        top  = Math.min(H - padEdge, Math.max(padEdge, top));

        tip.style.left = left + 'px';
        tip.style.top  = top + 'px';

        const tw = tip.offsetWidth || 0;
        const th = tip.offsetHeight || 0;

        // Flip horizontally if right edge overflows
        if ((left + tw) > (W - padEdge)){
            left = px - 10 - tw;
        }
        // If still off-screen, clamp
        left = Math.min(W - padEdge, Math.max(padEdge, left));

        // Nudge vertically to stay inside
        if ((top + th) > (H - padEdge)){
            top = (H - padEdge) - th;
        }
        top = Math.min(H - padEdge, Math.max(padEdge, top));

        tip.style.left = left + 'px';
        tip.style.top  = top + 'px';
        tip.style.visibility = 'visible';
    };
    const hideTip = ()=>{ tip.style.display='none'; };

    function draw(){
        // clamp intersection within plot area
        const st = host._corrState;
        st.xMidPx = _clamp(st.xMidPx, pad.l+22, pad.l+iw-22);
        st.yMidPx = _clamp(st.yMidPx, pad.t+22, pad.t+ih-22);

        // Zoom is controlled by wheel / pinch. Crosshair can move freely, but
        // the left/right/top/bottom scales re-map around the fixed origin values.
        st.zoom = _clamp(_num(st.zoom, 1.0), 0.25, 8.0);
        // Ensure the domain always includes the fixed origin values.
        const z = st.zoom;
        // Zoom scales BOTH sides around the fixed origin values.
        const spanLX = Math.max(1e-6, ORIGIN_X) / z;
        const spanRX = Math.max(1e-6, (baseMaxX - ORIGIN_X)) / z;
        const spanBY = Math.max(1e-6, ORIGIN_Y) / z;
        const spanTY = Math.max(1e-6, (baseMaxY - ORIGIN_Y)) / z;
        const minX = Math.max(0, ORIGIN_X - spanLX);
        const maxX = Math.max(ORIGIN_X + 1e-6, ORIGIN_X + spanRX, ORIGIN_X * 1.05);
        const minY = Math.max(0, ORIGIN_Y - spanBY);
        const maxY = Math.max(ORIGIN_Y + 1e-6, ORIGIN_Y + spanTY, ORIGIN_Y * 1.05);

        // Initialize the crosshair position to where the fixed origin would land
        // on a full-domain log scale (only once per host).
        if (!st._initialized){
            try{
                const x0 = _clamp(Math.log1p(ORIGIN_X) / Math.log1p(maxX), 0, 1);
                const y0 = _clamp(Math.log1p(ORIGIN_Y) / Math.log1p(maxY), 0, 1);
                st.xMidPx = pad.l + x0 * iw;
                st.yMidPx = (pad.t + ih) - y0 * ih;
            }catch(_){ }
            st._initialized = true;
        }

        // Fixed split values
        const xMidVal = ORIGIN_X;
        const yMidVal = ORIGIN_Y;

        const _log1p = (v)=> Math.log1p(Math.max(0, v));
        const _safeDiv = (a,b)=> (Math.abs(b) < 1e-12 ? 0 : (a/b));

        
// Piecewise linear scales around (xMidVal, yMidVal)
// Anchors: left edge = 0 usage, bottom edge = $0 waste.
// The crosshair position (st.xMidPx, st.yMidPx) represents fixed (xMidVal, yMidVal).
const xToPx = (x)=>{
    const xx = Math.max(minX, Math.min(maxX, _num(x,0)));
    const leftW  = Math.max(1, st.xMidPx - pad.l);
    const rightW = Math.max(1, (pad.l + iw) - st.xMidPx);
    const denL = Math.max(1e-9, (xMidVal - minX));
    const denR = Math.max(1e-9, (maxX - xMidVal));

    if (xx <= xMidVal){
        const t = _clamp((xx - minX) / denL, 0, 1);
        return pad.l + t * leftW;
    }
    const t = _clamp((xx - xMidVal) / denR, 0, 1);
    return st.xMidPx + t * rightW;
};

const yToPx = (y)=>{
    const yy = Math.max(minY, Math.min(maxY, _num(y,0)));
    const topH    = Math.max(1, st.yMidPx - pad.t);
    const bottomH = Math.max(1, (pad.t + ih) - st.yMidPx);
    const denB = Math.max(1e-9, (yMidVal - minY));
    const denT = Math.max(1e-9, (maxY - yMidVal));

    if (yy <= yMidVal){
        const t = _clamp((yy - minY) / denB, 0, 1);
        return (pad.t + ih) - t * bottomH;
    }
    const t = _clamp((yy - yMidVal) / denT, 0, 1);
    return st.yMidPx - t * topH;
};

const pxToX = (px)=>{
    const leftW  = Math.max(1, st.xMidPx - pad.l);
    const rightW = Math.max(1, (pad.l + iw) - st.xMidPx);
    const xpx = _clamp(px, pad.l, pad.l+iw);
    const denL = Math.max(1e-9, (xMidVal - minX));
    const denR = Math.max(1e-9, (maxX - xMidVal));

    if (xpx <= st.xMidPx){
        const t = _clamp((xpx - pad.l) / leftW, 0, 1);
        return minX + t * denL;
    }
    const t = _clamp((xpx - st.xMidPx) / rightW, 0, 1);
    return xMidVal + t * denR;
};

const pxToY = (py)=>{
    const topH    = Math.max(1, st.yMidPx - pad.t);
    const bottomH = Math.max(1, (pad.t + ih) - st.yMidPx);
    const ypx = _clamp(py, pad.t, pad.t+ih);
    const denB = Math.max(1e-9, (yMidVal - minY));
    const denT = Math.max(1e-9, (maxY - yMidVal));

    if (ypx >= st.yMidPx){
        const t = _clamp(((pad.t + ih) - ypx) / bottomH, 0, 1);
        return minY + t * denB;
    }
    const t = _clamp((st.yMidPx - ypx) / topH, 0, 1);
    return yMidVal + t * denT;
};

        host.innerHTML = '';
        // keep tooltip node
        host.appendChild(tip);

        const svg = document.createElementNS(svgNS,'svg');
        svg.setAttribute('width', String(W));
        svg.setAttribute('height', String(H));
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        host.appendChild(svg);

        // Background quadrant shading (subtle)
        function rect(x,y,w,h,fill){
            const r = document.createElementNS(svgNS,'rect');
            r.setAttribute('x',x); r.setAttribute('y',y);
            r.setAttribute('width',w); r.setAttribute('height',h);
            r.setAttribute('fill',fill);
            return r;
        }
        const tlFill = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)';
        const trFill = isDark ? 'rgba(255,132,0,0.045)' : 'rgba(255,132,0,0.08)';
        const blFill = isDark ? 'rgba(102,126,234,0.035)' : 'rgba(102,126,234,0.06)';
        const brFill = isDark ? 'rgba(17,153,142,0.045)' : 'rgba(17,153,142,0.07)';

        const qTL = rect(pad.l, pad.t, st.xMidPx-pad.l, st.yMidPx-pad.t, tlFill);
        const qTR = rect(st.xMidPx, pad.t, (pad.l+iw)-st.xMidPx, st.yMidPx-pad.t, trFill);
        const qBL = rect(pad.l, st.yMidPx, st.xMidPx-pad.l, (pad.t+ih)-st.yMidPx, blFill);
        const qBR = rect(st.xMidPx, st.yMidPx, (pad.l+iw)-st.xMidPx, (pad.t+ih)-st.yMidPx, brFill);
        svg.appendChild(qTL);
        svg.appendChild(qTR);
        svg.appendChild(qBL);
        svg.appendChild(qBR);

        // Axes
        const axis = document.createElementNS(svgNS,'path');
        axis.setAttribute('d', `M ${pad.l} ${pad.t} V ${pad.t+ih} H ${pad.l+iw}`);
        axis.setAttribute('stroke', axisColor);
        axis.setAttribute('fill','none');
        axis.setAttribute('stroke-width','1');
        svg.appendChild(axis);

        // Mid lines
        const mid1 = document.createElementNS(svgNS,'line');
        mid1.setAttribute('x1', st.xMidPx); mid1.setAttribute('x2', st.xMidPx);
        mid1.setAttribute('y1', pad.t); mid1.setAttribute('y2', pad.t+ih);
        mid1.setAttribute('stroke', midColor);
        mid1.setAttribute('stroke-dasharray','4 4');
        svg.appendChild(mid1);

        const mid2 = document.createElementNS(svgNS,'line');
        mid2.setAttribute('x1', pad.l); mid2.setAttribute('x2', pad.l+iw);
        mid2.setAttribute('y1', st.yMidPx); mid2.setAttribute('y2', st.yMidPx);
        mid2.setAttribute('stroke', midColor);
        mid2.setAttribute('stroke-dasharray','4 4');
        svg.appendChild(mid2);

        // Draggable handle at intersection
        const handle = document.createElementNS(svgNS,'circle');
        handle.setAttribute('cx', String(st.xMidPx));
        handle.setAttribute('cy', String(st.yMidPx));
        handle.setAttribute('r', '7');
        handle.setAttribute('fill', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
        handle.setAttribute('stroke', isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)');
        handle.setAttribute('stroke-width','1.2');
        handle.style.cursor = 'move';
        // Mark crosshair handle so pointerdown logic can distinguish from data points
        handle.setAttribute('data-role','crosshair');
        svg.appendChild(handle);

        // Save lightweight element refs so we can move the crosshair during drag
        // without re-rendering all dots (dots rescale on release).
        st._els = { svg, handle, mid1, mid2, qTL, qTR, qBL, qBR };

        // Labels
        function label(txt,x,y,anchor='start'){
            const t = document.createElementNS(svgNS,'text');
            t.textContent = txt;
            t.setAttribute('x', String(x));
            t.setAttribute('y', String(y));
            t.setAttribute('fill', labelColor);
            t.setAttribute('font-size','11');
            t.setAttribute('font-family','system-ui, -apple-system, sans-serif');
            t.setAttribute('text-anchor', anchor);
            return t;
        }
        svg.appendChild(label('Usage (units/day)', pad.l+iw, H-6, 'end'));
        svg.appendChild(label('Projected waste ($)', pad.l, pad.t+12, 'start'));

        // Points
        for (const p of pts){
            const cx = xToPx(_num(p.dailyUsage,0));
            const yPlot = Math.min(maxY, Math.max(0, _num(p.projectedWasteCost,0)));
            const cy = yToPx(yPlot);

            const c = document.createElementNS(svgNS,'circle');
            c.setAttribute('cx', String(cx));
            c.setAttribute('cy', String(cy));
            c.setAttribute('r', String(radius(p.unitPrice)));

            // Color by quadrant based on current draggable intersection values
            const hiU = _num(p.dailyUsage,0) >= xMidVal;
            const hiW = _num(p.projectedWasteCost,0) >= yMidVal;
            const fill = hiU && hiW ? 'rgba(255,132,0,0.85)'
                : hiU && !hiW ? 'rgba(17,153,142,0.85)'
                : !hiU && hiW ? 'rgba(255,84,84,0.85)'
                : 'rgba(102,126,234,0.85)';

            c.setAttribute('fill', fill);
            c.setAttribute('stroke', strokeColor);
            c.setAttribute('stroke-width', (_num(p.projectedWasteCost,0)>maxY) ? '2' : '1');
            c.style.cursor = 'pointer';
            // Mark as data point for pointerdown filtering
            c.setAttribute('data-role','dot');

            c.addEventListener('mouseenter', ()=>{
                const html = `
                    <div style="font-weight:600;margin-bottom:2px;">${(p.itemDescription || p.drugName || p.itemCode)}</div>
                    <div><b>Projected Waste:</b> $${Math.round(_num(p.projectedWasteCost,0)).toLocaleString()}</div>
                    <div><b>Daily Usage:</b> ${_num(p.dailyUsage,0).toFixed(2)}</div>
                    <div><b>Unit Price:</b> $${_num(p.unitPrice,0).toFixed(2)}</div>
                `;
                showTip(cx, cy, html);
            });
            c.addEventListener('mouseleave', hideTip);
            c.addEventListener('click', (e)=>{
                try{ e.stopPropagation(); }catch(_){ }
                // Dot click should drill directly in the Charts vertical bar (no filter chips).
                if (window.parent){
                    window.parent.postMessage({
                        type: 'drillToItemInVerticalBar',
                        itemCode: String(p.itemCode || '')
                    }, '*');
                }
            });

            svg.appendChild(c);
        }

        // Drag behavior
        const onDown = (ev)=>{
            // Don't start drag when clicking a dot (allow dot click to fire)
            try{
                const t = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
                if (t === 'circle') {
                    const role = ev.target.getAttribute && ev.target.getAttribute('data-role');
                    if (role === 'dot') return;
                }
            }catch(_){ }
            st.dragging = true;
            try{ svg.setPointerCapture(ev.pointerId); }catch(_){}
            ev.preventDefault();
        };
        const onMove = (ev)=>{
            if (!st.dragging) return;
            const rect = svg.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const y = ev.clientY - rect.top;
            st.xMidPx = x;
            st.yMidPx = y;
            // Move the crosshair + quadrant shading live, but don't redraw dots.
            const els = st._els;
            if (els){
                const xx = _clamp(st.xMidPx, pad.l+22, pad.l+iw-22);
                const yy = _clamp(st.yMidPx, pad.t+22, pad.t+ih-22);
                st.xMidPx = xx;
                st.yMidPx = yy;
                try{
                    els.handle.setAttribute('cx', String(xx));
                    els.handle.setAttribute('cy', String(yy));
                    els.mid1.setAttribute('x1', String(xx));
                    els.mid1.setAttribute('x2', String(xx));
                    els.mid2.setAttribute('y1', String(yy));
                    els.mid2.setAttribute('y2', String(yy));
                    // Update quadrant shading
                    els.qTL.setAttribute('width', String(xx-pad.l));
                    els.qTL.setAttribute('height', String(yy-pad.t));
                    els.qTR.setAttribute('x', String(xx));
                    els.qTR.setAttribute('width', String((pad.l+iw)-xx));
                    els.qTR.setAttribute('height', String(yy-pad.t));
                    els.qBL.setAttribute('y', String(yy));
                    els.qBL.setAttribute('width', String(xx-pad.l));
                    els.qBL.setAttribute('height', String((pad.t+ih)-yy));
                    els.qBR.setAttribute('x', String(xx));
                    els.qBR.setAttribute('y', String(yy));
                    els.qBR.setAttribute('width', String((pad.l+iw)-xx));
                    els.qBR.setAttribute('height', String((pad.t+ih)-yy));
                }catch(_){ }
            }
            ev.preventDefault();
        };
        const onUp = (ev)=>{
            // Only finalize drag/rescale if we were actually dragging the crosshair handle.
            if (!st.dragging) return;
            st.dragging = false;
            try{ svg.releasePointerCapture(ev.pointerId); }catch(_){}
            // Re-render with updated scales (dots rescale on release)
            draw();
            try{ ev.preventDefault(); }catch(_){}
        };

        handle.addEventListener('pointerdown', onDown);
        svg.addEventListener('pointermove', onMove);
        svg.addEventListener('pointerup', onUp);
        svg.addEventListener('pointercancel', onUp);

        // Zoom via scroll wheel / trackpad pinch.
        // Crosshair sets the split point; zoom changes the overall domain range.
        const onWheel = (ev)=>{
            // Prefer not to scroll the page while interacting with the plot.
            try{ ev.preventDefault(); }catch(_){ }
            const dz = ev.deltaY;
            if (!isFinite(dz) || dz === 0) return;
            // Wheel up (negative deltaY) => zoom in
            const factor = dz < 0 ? 1.12 : 0.90;
            st.zoom = _clamp(_num(st.zoom,1.0) * factor, 0.25, 8.0);
            draw();
        };
        // NOTE: must be non-passive for preventDefault
        svg.addEventListener('wheel', onWheel, { passive: false });

        // Hide tooltip when leaving card
        host.addEventListener('mouseleave', hideTip, { once: true });
    }

    draw();
}
