/**
 * Data Migration Helper Functions
 * Bridges the gap between old (stockFlow/stockOut) and new (inventory/transactions) data structures
 */

/**
 * Merge multiple monthly transaction files into a single consolidated object
 * Looks for TRANSACTION_YYYY_MM variables that have been loaded via script tags
 * 
 * @returns {Object} Merged transactions object with all history combined
 */
function mergeMonthlyTransactions() {
    const merged = {};
    
    // Use globalThis which is more reliable than window in all contexts
    const targetWindow = globalThis;

    // Helper to read a "global" variable regardless of whether it was declared
    // with `var` / `window.NAME = ...` (property on globalThis) or `const NAME = ...`
    // (a global lexical binding, not an object property).
    function getGlobalByName(name) {
        if (!name || typeof name !== 'string') return undefined;

        // Fast path: property-based globals.
        if (Object.prototype.hasOwnProperty.call(targetWindow, name)) {
            return targetWindow[name];
        }

        // Safe guard: only allow simple identifier-like names.
        if (!/^[A-Z0-9_]+$/.test(name)) return undefined;

        // Fallback: access global lexical bindings (e.g., `const TRANSACTION_2026_01 = ...`).
        // Using Function() here avoids relying on eval() while still allowing access to
        // non-property globals across separate script tags.
        try {
            // eslint-disable-next-line no-new-func
            return Function('try { return ' + name + '; } catch (e) { return undefined; }')();
        } catch (e) {
            return undefined;
        }
    }
    
    console.log('📅 Merging monthly transaction files...');
    console.log('🔍 Checking for transaction variables...');
    console.log('   Using globalThis for variable lookup');
    console.log('   Target window type:', typeof targetWindow);
    console.log('   Total keys in target window:', Object.keys(targetWindow).length);
    
    // Test direct access
    console.log('   TEST: Direct access to TRANSACTION_2026_01:', typeof TRANSACTION_2026_01);
    console.log('   TEST: Direct access to ITEMS_DATA:', typeof ITEMS_DATA);
    
    // Debug: Check what's actually in target window
    const foundVars = [];
    const allKeys = Object.keys(targetWindow);
    console.log('   Scanning', allKeys.length, 'properties...');
    
    for (const key of allKeys) {
        if (key.includes('TRANSACTION')) {
            foundVars.push(key);
            console.log(`   🎯 Found: ${key} = ${typeof targetWindow[key]}`);
        }
    }
    console.log(`   Found ${foundVars.length} TRANSACTION variables:`, foundVars);
    
    // Also check for specific variables directly
    console.log('   Direct checks:');
    console.log('     TRANSACTION_2026_01:', typeof targetWindow.TRANSACTION_2026_01, targetWindow.TRANSACTION_2026_01 ? '✅' : '❌');
    console.log('     TRANSACTION_2025_12:', typeof targetWindow.TRANSACTION_2025_12, targetWindow.TRANSACTION_2025_12 ? '✅' : '❌');
    console.log('     ITEMS_DATA:', typeof targetWindow.ITEMS_DATA, targetWindow.ITEMS_DATA ? '✅' : '❌');
    // Discover transaction globals dynamically.
    // Supported:
    // - TRANSACTION_YYYY_MM (monthly)
    // - TRANSACTION_YYYY_MM_DD (daily)
    // - ITEM_TRANSACTION (legacy)
    const discoveredFromWindow = Object.keys(targetWindow)
        .filter(k => /^TRANSACTION_\d{4}_\d{2}(?:_\d{2})?$/.test(k) || k === 'ITEM_TRANSACTION');

    // Also discover expected variable names from the manifest file list, so we can
    // load const-declared globals that don't appear as properties on globalThis.
    const discoveredFromManifest = [];
    const scripts = Array.isArray(targetWindow.TRANSACTION_SCRIPTS) ? targetWindow.TRANSACTION_SCRIPTS : [];
    for (let i = 0; i < scripts.length; i++) {
        const file = String(scripts[i] || '');
        // Matches: transaction_2026_01_mockdata.js or transaction_2026_01_19_mockdata.js
        const m = file.match(/transaction_(\d{4})_(\d{2})(?:_(\d{2}))?_mockdata\.js$/i);
        if (m) {
            const yyyy = m[1], mm = m[2], dd = m[3];
            discoveredFromManifest.push(dd ? `TRANSACTION_${yyyy}_${mm}_${dd}` : `TRANSACTION_${yyyy}_${mm}`);
        }
    }

    // Combine + de-dupe, newest first.
    const monthlyVars = Array.from(new Set([...discoveredFromWindow, ...discoveredFromManifest, 'ITEM_TRANSACTION']))
        .filter(Boolean)
        .filter(k => /^TRANSACTION_\d{4}_\d{2}(?:_\d{2})?$/.test(k) || k === 'ITEM_TRANSACTION')
        .sort()
        .reverse();

    
    let filesFound = 0;
    let totalRecords = 0;
    
    monthlyVars.forEach(varName => {
        const monthData = getGlobalByName(varName);
        
        if (typeof monthData !== 'undefined') {
            filesFound++;
            
            // Merge each item's history
            for (const [itemCode, data] of Object.entries(monthData)) {
                if (!merged[itemCode]) {
                    merged[itemCode] = { history: [] };
                }
                
                if (data.history && Array.isArray(data.history)) {
                    merged[itemCode].history.push(...data.history);
                    totalRecords += data.history.length;
                }
            }
            
            console.log(`   ✓ Loaded ${varName}: ${Object.keys(monthData).length} items`);
        }
    });
    
    // Sort each item's history by date (oldest to newest)
    for (const itemCode of Object.keys(merged)) {
        merged[itemCode].history.sort((a, b) => {
            return new Date(a.transDate) - new Date(b.transDate);
        });
    }
    
    console.log(`📅 Transaction merge complete:`);
    console.log(`   - Monthly files found: ${filesFound}`);
    console.log(`   - Items with transactions: ${Object.keys(merged).length}`);
    console.log(`   - Total transaction records: ${totalRecords}`);
    
    if (filesFound === 0) {
        console.warn('⚠️ No transaction files found. Looking for variables like TRANSACTION_2025_01');
        console.warn('   Make sure each file exports as: const TRANSACTION_2025_01 = {...}');
    }
    
    return merged;
}

/**
 * Generate stockOutsByArea from ITEMS_INVENTORY
 * Analyzes current inventory levels vs min/max to identify stock-outs
 * 
 * Returns structure compatible with old STOCKOUT_DATA:
 * [
 *   {
 *     location: "3TWA",
 *     itemCode: "180",
 *     stockOut: [0, 0, 0, 5, 3, 2, 0]  // Weekly stock-out counts
 *   },
 *   ...
 * ]
 */
function generateStockOutsByArea(inventory, transactions) {
    const stockOutsByArea = [];
    const weeklyData = {}; // location -> itemCode -> week counts
    
    // Process each item in inventory
    for (const [itemCode, locations] of Object.entries(inventory)) {
        for (const [location, details] of Object.entries(locations)) {
            // Check if item is stocked out (qty below min or qty = 0)
            const isStockOut = details.qty === 0 || details.qty < details.min;
            
            if (isStockOut) {
                const key = `${location}:${itemCode}`;
                
                if (!weeklyData[location]) {
                    weeklyData[location] = {};
                }
                
                if (!weeklyData[location][itemCode]) {
                    // Initialize with 7 weeks of data (simulated based on current state)
                    // In production, this would come from historical snapshots
                    weeklyData[location][itemCode] = [0, 0, 0, 0, 0, 0, 1];
                }
            }
        }
    }
    
    // Convert to array format matching old structure
    for (const [location, items] of Object.entries(weeklyData)) {
        for (const [itemCode, weekData] of Object.entries(items)) {
            stockOutsByArea.push({
                location: location,
                itemCode: itemCode,
                stockOut: weekData
            });
        }
    }
    
    return stockOutsByArea;
}

/**
 * Generate stockFlow from ITEM_TRANSACTION
 * Converts transaction history into flow data structure
 * 
 * Returns structure compatible with old STOCKFLOW_DATA:
 * {
 *   flows: [
 *     {
 *       itemCode: "180",
 *       week: "2025-W50",
 *       dispenses: 45,
 *       restocks: 20,
 *       waste: 2
 *     },
 *     ...
 *   ]
 * }
 */
function generateStockFlowData(transactions) {
    const flowMap = {}; // itemCode:week -> aggregated data
    
    // Process each item's transaction history
    for (const [itemCode, data] of Object.entries(transactions)) {
        if (!data.history || !Array.isArray(data.history)) continue;
        
        data.history.forEach(trans => {
            const date = new Date(trans.transDate);
            const week = getWeekNumber(date);
            const weekKey = `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
            const key = `${itemCode}:${weekKey}`;
            
            if (!flowMap[key]) {
                flowMap[key] = {
                    itemCode: itemCode,
                    week: weekKey,
                    dispenses: 0,
                    restocks: 0,
                    waste: 0,
                    transfers: 0
                };
            }
            
            const rawQty = (trans.transQty ?? trans.TransQty ?? trans.qty ?? trans.Qty ?? trans.TRANSQTY ?? 0);
            const absQty = Math.abs(parseFloat(rawQty) || 0);
            
            const _t = String(trans.transactionType || '').toLowerCase();
            switch (true) {
                case _t.includes('dispense'):
                    flowMap[key].dispenses += absQty;
                    break;
                case _t.includes('restock'):
                    flowMap[key].restocks += absQty;
                    break;
                case _t.includes('waste'):
                    flowMap[key].waste += absQty;
                    break;
                case _t.includes('transfer') || _t.includes('send') || _t.includes('move'):
                    flowMap[key].transfers += absQty;
                    break;
            }
        });
    }
    
    // Convert to array
    const flows = Object.values(flowMap);
    
    return {
        flows: flows,
        lastUpdated: new Date().toISOString().split('T')[0]
    };
}

/**
 * Helper: Get ISO week number from date
 */
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Get inventory snapshot for a specific item and location
 */
function getInventorySnapshot(inventory, itemCode, location) {
    if (!inventory[itemCode]) return null;
    if (!inventory[itemCode][location]) return null;
    return inventory[itemCode][location];
}

/**
 * Get transaction history for a specific item
 */
function getTransactionHistory(transactions, itemCode) {
    if (!transactions[itemCode]) return [];
    return transactions[itemCode].history || [];
}

/**
 * Calculate total quantity on hand for an item across all locations
 */
function getTotalQuantity(inventory, itemCode) {
    if (!inventory[itemCode]) return 0;
    
    let total = 0;
    for (const location of Object.values(inventory[itemCode])) {
        total += location.qty || 0;
    }
    return total;
}

/**
 * Get all locations where an item is stocked
 */
function getItemLocations(inventory, itemCode) {
    if (!inventory[itemCode]) return [];
    return Object.keys(inventory[itemCode]);
}

/**
 * Check if item is below minimum threshold at any location
 */
function isBelowMinAtAnyLocation(inventory, itemCode) {
    if (!inventory[itemCode]) return false;
    
    for (const location of Object.values(inventory[itemCode])) {
        if (location.qty < location.min) {
            return true;
        }
    }
    return false;
}

/**
 * Get aggregated dispense rate from transactions
 */
function getDispenseRate(transactions, itemCode, days = 30) {
    const history = getTransactionHistory(transactions, itemCode);
    if (history.length === 0) return 0;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    let totalDispensed = 0;
    history.forEach(trans => {
        const transDate = new Date(trans.transDate);
        if (transDate >= cutoffDate && trans.transactionType === 'Dispense') {
            totalDispensed += Math.abs(trans.transQty);
        }
    });
    
    return totalDispensed / days; // Average per day
}

/**
 * Calculate weekly usage and waste rates from transaction history
 * Returns arrays for last 12 weeks in format compatible with existing dashboard
 * 
 * @param {Object} transactions - ITEM_TRANSACTION data
 * @param {string} itemCode - The item code to calculate for
 * @param {number} weeks - Number of weeks to calculate (default 12)
 * @returns {Object} - { usageRate: [...], wasteRate: [...], restockRate: [...] }
 */
function calculateRatesFromTransactions(transactions, itemCode, weeks = 12) {
    const usageRate = new Array(weeks).fill(0);
    const wasteRate = new Array(weeks).fill(0);
    const restockRate = new Array(weeks).fill(0);
    
    if (!transactions[itemCode] || !transactions[itemCode].history) {
        return { usageRate, wasteRate, restockRate };
    }
    
    const history = transactions[itemCode].history;
    
    // Get today and calculate week boundaries
    const today = new Date(history[history.length - 1].transDate || Date.now());
    // NOTE: anchor aggregation to latest transaction date for deterministic results across load dates
    const weekBoundaries = [];
    
    // Calculate boundaries for last N weeks (going backwards from today)
    for (let i = weeks - 1; i >= 0; i--) {
        const weekEnd = new Date(today);
        weekEnd.setDate(today.getDate() - (i * 7));
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekEnd.getDate() - 7);
        
        weekBoundaries.push({
            start: weekStart,
            end: weekEnd,
            index: weeks - 1 - i  // Reverse index so most recent is last
        });
    }
    
    // Debug logging for first item only
    if (itemCode === "180") {
        console.log(`📊 Calculating rates for item ${itemCode}:`);
        console.log(`   Transactions: ${history.length}`);
        console.log(`   Week range: ${weekBoundaries[0].start.toISOString().split('T')[0]} to ${weekBoundaries[weekBoundaries.length-1].end.toISOString().split('T')[0]}`);
        console.log(`   First transaction date: ${history[0].transDate}`);
        console.log(`   Last transaction date: ${history[history.length-1].transDate}`);
    }
    
    // Process each transaction
    history.forEach(trans => {
        const transDate = new Date(trans.transDate);
        
        // Find which week this transaction belongs to
        for (const week of weekBoundaries) {
            if (transDate >= week.start && transDate < week.end) {
                const rawQty = (trans.transQty ?? trans.TransQty ?? trans.qty ?? trans.Qty ?? trans.TRANSQTY ?? 0);
            const absQty = Math.abs(parseFloat(rawQty) || 0);
                
                const _t = String(trans.transactionType || '').toLowerCase();
            switch (true) {
                    case _t.includes('dispense'):
                        usageRate[week.index] += absQty;
                        break;
                    case _t.includes('waste'):
                        wasteRate[week.index] += absQty;
                        break;
                    case _t.includes('restock'):
                        restockRate[week.index] += absQty;
                        break;
                }
                break;
            }
        }
    });
    
    // Debug logging for first item only
    if (itemCode === "180") {
        console.log(`   Result - usageRate: [${usageRate.join(',')}]`);
        console.log(`   Result - wasteRate: [${wasteRate.join(',')}]`);
        console.log(`   Result - restockRate: [${restockRate.join(',')}]`);
    }
    
    return { usageRate, wasteRate, restockRate };
}

/**
 * Enrich items array with calculated rates from transactions
 * Modifies items in place to add usageRate, wasteRate, restockRate arrays
 */
function enrichItemsWithTransactionRates(items, transactions) {
    items.forEach(item => {
        const rates = calculateRatesFromTransactions(transactions, item.itemCode);
        item.usageRate = rates.usageRate;
        item.wasteRate = rates.wasteRate;
        item.restockRate = rates.restockRate;
        item.restockRateCsv = rates.restockRate.join(',');
    });
    
    return items;
}

/**
 * Enrich items array with inventory data
 * Adds pyxis, pharmacy, quantity fields from ITEMS_INVENTORY
 */
function enrichItemsWithInventory(items, inventory) {
    items.forEach(item => {
        const invData = inventory[item.itemCode];
        
        if (!invData) {
            // No inventory data - set defaults
            item.pyxis = 0;
            item.pharmacy = 0;
            item.quantity = 0;
            item.pyxisStandard = 0;
            return;
        }
        
        // Sum quantities across all locations
        let totalQty = 0;
        let pharmacyQty = 0;
        let pyxisQty = 0;
        let standardQty = 0;
        
        for (const [location, details] of Object.entries(invData)) {
            const qty = details.qty || 0;
            totalQty += qty;
            
            if (location === 'pharmacy') {
                pharmacyQty = qty;
            } else {
                pyxisQty += qty;
                if (details.standard) {
                    standardQty += details.standardQty || 0;
                }
            }
        }
        
        item.pharmacy = pharmacyQty;
        item.pyxis = pyxisQty;
        item.quantity = totalQty;
        item.pyxisStandard = standardQty;
    });
    
    return items;
}

/**
 * Initialize compatibility layer - adds stockFlow and stockOutsByArea to MOCK_DATA
 */
function initializeDataCompatibility(mockData) {
    if (!mockData.inventory || !mockData.transactions) {
        console.error('Missing inventory or transactions data');
        return mockData;
    }
    
    console.log('🔄 Initializing data compatibility layer...');
    
    // Enrich items with calculated rates from transactions
    enrichItemsWithTransactionRates(mockData.items, mockData.transactions);
    console.log('   ✓ Added transaction-based rates (usageRate, wasteRate, restockRate)');
    
    // Enrich items with inventory data
    enrichItemsWithInventory(mockData.items, mockData.inventory);
    console.log('   ✓ Added inventory quantities (pharmacy, pyxis, quantity, pyxisStandard)');
    
    // Generate compatible structures for legacy code
    mockData.stockFlow = generateStockFlowData(mockData.transactions);
    mockData.stockOutsByArea = generateStockOutsByArea(mockData.inventory, mockData.transactions);
    
    console.log('✅ Data compatibility layer initialized');
    console.log('   - Generated stock flows:', mockData.stockFlow.flows.length);
    console.log('   - Generated stock-outs by area:', mockData.stockOutsByArea.length);
    console.log('   - Enriched items:', mockData.items.length);
    
    return mockData;
}
