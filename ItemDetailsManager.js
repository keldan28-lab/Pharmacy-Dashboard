/**
 * Item Details Manager Module
 * 
 * Handles RxNorm API integration and Item Details modal population
 * @version 1.0.0
 */

class ItemDetailsManager {
    constructor() {
        this.currentItemData = null;
        this.rxnormCache = new Map();
        this.ndcDataCache = new Map();
        // PRICING ENHANCEMENT: Add pricing-related properties
        this.pricingData = null;
        this.currentPriceComparison = null;
        this.defaultPrice = null;
        this.pricingDataLoadAttempted = false; // Track if we've tried to load
    }

    /**
     * Load pricing data from global PRICING_DATA object
     * PRICING ENHANCEMENT: New method
     */
    loadPricingData() {
        // If already attempted to load, don't try again
        if (this.pricingDataLoadAttempted) {
            return this.pricingData !== null;
        }
        
        this.pricingDataLoadAttempted = true;
        
        // Check multiple scopes for PRICING_DATA
        let pricingSource = null;
        
        // Try global scope first
        if (typeof PRICING_DATA !== 'undefined' && PRICING_DATA && PRICING_DATA.pricing) {
            pricingSource = PRICING_DATA;
            console.log('💰 Found PRICING_DATA in global scope');
        }
        // Try window scope
        else if (typeof window !== 'undefined' && window.PRICING_DATA && window.PRICING_DATA.pricing) {
            pricingSource = window.PRICING_DATA;
            console.log('💰 Found PRICING_DATA in window scope');
        }
        // Try globalThis scope
        else if (typeof globalThis !== 'undefined' && globalThis.PRICING_DATA && globalThis.PRICING_DATA.pricing) {
            pricingSource = globalThis.PRICING_DATA;
            console.log('💰 Found PRICING_DATA in globalThis scope');
        }
        
        if (pricingSource && pricingSource.pricing) {
            this.pricingData = pricingSource.pricing;
            console.log('💰 Pricing data loaded successfully:', this.pricingData.length, 'entries');
            console.log('💰 Last updated:', pricingSource.lastUpdated);
            return true;
        }
        
        console.warn('⚠️ PRICING_DATA not found - pricing comparison disabled');
        console.log('💡 Make sure pricing_mockdata.js is loaded BEFORE ItemDetailsManager.js');
        console.log('💡 Expected structure: window.PRICING_DATA = { pricing: [...] }');
        console.log('💡 Debug: Check if PRICING_DATA exists by typing "PRICING_DATA" in console');
        return false;
    }

    /**
     * Get pricing comparison for current item
     * PRICING ENHANCEMENT: New method
     * @param {Array} ndcList - List of NDC objects with packageNDC/ndc10/ndcItem and labelerName
     * @param {number} currentPrice - Current item price from dashboard
     * @returns {Object|null} - Pricing comparison data
     */
    getPricingComparison(ndcList, currentPrice) {
        if (!this.pricingData) {
            console.log('📊 No pricing data available for comparison');
            return null;
        }

        console.log('💲 Starting pricing analysis for', ndcList.length, 'NDCs');
        
        const matchedPrices = [];
        
        ndcList.forEach(ndcObj => {
            // Use ndcItem (11-digit no-dash format) for matching
            const ndc = ndcObj.ndcItem || ndcObj.packageNDC || ndcObj.ndc10;
            if (!ndc) return;
            
            console.log(`🔍 Looking for NDC: "${ndc}" (ndcItem format)`);
            
            const pricingEntry = this.pricingData.find(p => p.ndc === ndc);
            if (pricingEntry) {
                const gpoPrice = parseFloat(pricingEntry.gpoPrice) || Infinity;
                const wacPrice = parseFloat(pricingEntry.wacPrice) || Infinity;
                const bestPrice = Math.min(gpoPrice, wacPrice);
                
                matchedPrices.push({
                    ndc: ndc,
                    labelerName: ndcObj.labelerName,
                    gpoPrice: gpoPrice === Infinity ? null : gpoPrice,
                    wacPrice: wacPrice === Infinity ? null : wacPrice,
                    bestPrice: bestPrice === Infinity ? null : bestPrice,
                    phsPrice: parseFloat(pricingEntry.phsPrice) || null
                });
                
                console.log(`  ✅ MATCH FOUND for ${ndc}: GPO=$${gpoPrice.toFixed(2)}, WAC=$${wacPrice.toFixed(2)}, Best=$${bestPrice.toFixed(2)}`);
            } else {
                console.log(`  ❌ No match in pricing data for: "${ndc}"`);
            }
        });

        if (matchedPrices.length === 0) {
            console.log('📊 No pricing matches found');
            return null;
        }

        const lowestPriceEntry = matchedPrices.reduce((lowest, current) => {
            if (!lowest || (current.bestPrice && current.bestPrice < lowest.bestPrice)) {
                return current;
            }
            return lowest;
        }, null);

        const result = {
            currentPrice: parseFloat(currentPrice),
            lowestPrice: lowestPriceEntry?.bestPrice,
            lowestPriceNDC: lowestPriceEntry?.ndc,
            lowestPriceLabeler: lowestPriceEntry?.labelerName,
            allPrices: matchedPrices,
            isHigherThanBest: currentPrice && lowestPriceEntry?.bestPrice && 
                              parseFloat(currentPrice) > lowestPriceEntry.bestPrice
        };

        console.log('💰 Pricing Analysis Complete:', {
            matchedCount: matchedPrices.length,
            currentPrice: result.currentPrice,
            lowestPrice: result.lowestPrice,
            lowestPriceNDC: result.lowestPriceNDC,
            lowestPriceLabeler: result.lowestPriceLabeler,
            isHigher: result.isHigherThanBest
        });

        return result;
    }

    /**
     * Get price for specific labeler's products
     * PRICING ENHANCEMENT: New method
     * @param {Array} products - Products from a labeler
     * @returns {Object|null} - Price info for this labeler
     */
    getLabelerPrice(products) {
        if (!this.pricingData || !products || products.length === 0) {
            return null;
        }

        for (const product of products) {
            // Use ndcItem (11-digit no-dash format) for matching
            const ndc = product.ndcItem || product.packageNDC || product.ndc10;
            if (!ndc) continue;
            
            const pricingEntry = this.pricingData.find(p => p.ndc === ndc);
            if (pricingEntry) {
                const gpoPrice = parseFloat(pricingEntry.gpoPrice) || Infinity;
                const wacPrice = parseFloat(pricingEntry.wacPrice) || Infinity;
                const bestPrice = Math.min(gpoPrice, wacPrice);
                
                console.log(`💰 Found labeler price for NDC ${ndc}: Best=$${bestPrice.toFixed(2)}`);
                
                return {
                    ndc: ndc,
                    gpoPrice: gpoPrice === Infinity ? null : gpoPrice,
                    wacPrice: wacPrice === Infinity ? null : wacPrice,
                    bestPrice: bestPrice === Infinity ? null : bestPrice,
                    priceType: gpoPrice < wacPrice ? 'GPO' : 'WAC'
                };
            }
        }
        
        return null;
    }

    /**
     * Initialize the Item Details modal when user clicks on an item
     * @param {string} itemDescription - The description of the drug item
     * @param {Object} dashboardData - Data from the dashboard (price, inventory, etc.)
     */
    async initializeItemDetails(itemDescription, dashboardData = {}) {
        // PRICING ENHANCEMENT: Load pricing data if not already loaded
        if (!this.pricingData) {
            this.loadPricingData();
        }

        // PRICING ENHANCEMENT: Store default price
        this.defaultPrice = dashboardData.price;

        // Store for potential refresh
        this.currentItemDescription = itemDescription;
        this.dashboardData = dashboardData;
        
        // Extract brand name if present (text in square brackets)
        const brandMatch = itemDescription.match(/\[([^\]]+)\]/);
        this.brandName = brandMatch ? brandMatch[1] : null;
        
        // Remove brand name from description for API call
        const descriptionWithoutBrand = itemDescription.replace(/\s*\[([^\]]+)\]\s*/, '').trim();
        
        console.log('🔍 Initializing Item Details for:', itemDescription);
        console.log('   API will use:', descriptionWithoutBrand);
        if (this.brandName) {
            console.log('   Brand name extracted:', this.brandName);
        }
        console.log('💰 Dashboard data:', dashboardData);
        
        try {
            // Show loading state
            this.showLoadingState();
            
            // Step 1: Get RXCUI - Try itemCode first (PRIMARY), then description (FALLBACK)
            console.log('📡 Step 1: Getting RXCUI...');
            console.log('   Method 1 (PRIMARY): Try itemCode lookup via NDC');
            console.log('   Method 2 (FALLBACK): Try approximateTerm with description');
            
            let rxcui = null;
            let rxcuiMethod = null;
            
            // PRIMARY METHOD: Try itemCode → NDC → RXCUI
            if (dashboardData.itemCode && dashboardData.itemCode !== 'N/A') {
                console.log(`🔑 Attempting PRIMARY method with itemCode: ${dashboardData.itemCode}`);
                rxcui = await this.getRxcuiFromItemCode(dashboardData.itemCode);
                if (rxcui) {
                    rxcuiMethod = 'itemCode → NDC → RXCUI (PRIMARY)';
                    console.log(`✅ PRIMARY METHOD SUCCESS: RXCUI ${rxcui} found via itemCode`);
                } else {
                    console.log('⚠️ PRIMARY METHOD FAILED: No RXCUI from itemCode, falling back...');
                }
            } else {
                console.log('⚠️ No valid itemCode available, skipping PRIMARY method');
            }
            
            // FALLBACK METHOD: Try description → approximateTerm → RXCUI
            if (!rxcui) {
                console.log(`🔄 Attempting FALLBACK method with description: ${descriptionWithoutBrand}`);
                rxcui = await this.getRxcuiFromDescription(descriptionWithoutBrand);
                if (rxcui) {
                    rxcuiMethod = 'description → approximateTerm → RXCUI (FALLBACK)';
                    console.log(`✅ FALLBACK METHOD SUCCESS: RXCUI ${rxcui} found via description`);
                } else {
                    console.log('❌ FALLBACK METHOD FAILED: No RXCUI from description');
                }
            }
            
            // Check if we got RXCUI from either method
            if (!rxcui) {
                throw new Error('Could not find RXCUI using itemCode or description');
            }
            
            console.log(`✓ Step 1 Complete - RXCUI: ${rxcui} (via ${rxcuiMethod})`);
            
            // Step 2: Get related products (SCD and SBD)
            console.log('📡 Step 2: Getting related products for RXCUI:', rxcui);
            const relatedProducts = await this.getRelatedProducts(rxcui);
            console.log('✓ Step 2 Complete - Related products:', {
                SBD_count: relatedProducts.SBD.length,
                SCD_count: relatedProducts.SCD.length,
                SBD: relatedProducts.SBD,
                SCD: relatedProducts.SCD
            });
            
            // Step 3: Get NDC data for all related products
            console.log('📡 Step 3: Getting NDC data for all related RXCUIs...');
            console.log('   - Processing SBD RXCUIs:', relatedProducts.SBD);
            console.log('   - Processing SCD RXCUIs:', relatedProducts.SCD);
            const ndcData = await this.getNDCData(relatedProducts);
            console.log('✓ Step 3 Complete - NDC data retrieved:', {
                count: ndcData.length,
                ndcs: ndcData.map(n => ({ 
                    ndc10: n.ndc10, 
                    labeler: n.labelerName, 
                    packaging: n.packaging,
                    splSetIdItem: n.splSetIdItem 
                }))
            });
            
            // Step 4: Process and filter NDC data
            console.log('📡 Step 4: Processing and filtering NDC data...');
            const processedData = this.processNDCData(ndcData);
            console.log('✓ Step 4 Complete - Processed data:', processedData);
            
            // PRICING ENHANCEMENT: Step 5 - Perform pricing analysis
            console.log('📡 Step 5: Performing pricing analysis...');
            const allNDCs = ndcData.map(ndc => ({
                ndcItem: ndc.ndcItem,  // 11-digit no-dash format (PRIMARY)
                packageNDC: ndc.packageNDC || ndc.ndc10,
                ndc10: ndc.ndc10,
                labelerName: ndc.labelerName
            }));
            this.currentPriceComparison = this.getPricingComparison(allNDCs, dashboardData.price);
            console.log('✓ Step 5 Complete - Pricing analysis done');
            
            // Step 6: Populate modal with the data
            console.log('📡 Step 6: Populating modal...');
            this.populateModal(processedData, dashboardData);
            console.log('✅ All steps complete - Item Details loaded successfully');
            
        } catch (error) {
            console.error('❌ Error initializing Item Details:', error);
            console.error('   Error stack:', error.stack);
            this.showErrorState(error.message);
        }
    }

    /**
     * Refresh item details using a specific search term
     * Called when user selects from dropdown
     * @param {string} searchTerm - The term to search with
     */
    async refreshWithSearchTerm(searchTerm) {
        if (!searchTerm) {
            console.warn('⚠️ No search term provided for refresh');
            return;
        }
        
        console.log('🔄 Refreshing with search term:', searchTerm);
        this.showLoadingState();
        
        try {
            // Step 1: Get RXCUI using search term
            console.log('📡 Step 1: Getting RXCUI from search term:', searchTerm);
            const rxcui = await this.getRxcuiFromDescription(searchTerm);
            if (!rxcui) {
                throw new Error('Could not find drug using search term: ' + searchTerm);
            }
            console.log('✓ Step 1 Complete - RXCUI:', rxcui);
            
            // Step 2: Get related products
            console.log('📡 Step 2: Getting related products for RXCUI:', rxcui);
            const relatedProducts = await this.getRelatedProducts(rxcui);
            console.log('✓ Step 2 Complete - Related products:', {
                SBD_count: relatedProducts.SBD.length,
                SCD_count: relatedProducts.SCD.length
            });
            
            // Step 3: Get NDC data
            console.log('📡 Step 3: Getting NDC data...');
            const ndcData = await this.getNDCData(relatedProducts);
            console.log('✓ Step 3 Complete - NDC data retrieved');
            
            // Step 4: Process and filter
            console.log('📡 Step 4: Processing and filtering NDC data...');
            const processedData = this.processNDCData(ndcData);
            console.log('✓ Step 4 Complete - Processed data:', processedData);
            
            // Step 5: Populate modal
            console.log('📡 Step 5: Populating modal...');
            this.populateModal(processedData, this.dashboardData);
            console.log('✅ Refresh complete - Item Details reloaded with:', searchTerm);
            
        } catch (error) {
            console.error('❌ Error refreshing with search term:', error);
            this.showErrorState('Could not find drug information using: ' + searchTerm);
        }
    }

    /**
     * Show loading state in modal
     */
    showLoadingState() {
        const modalContent = document.getElementById('companionModalDrugInfo');
        if (modalContent) {
            modalContent.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <div class="loading-spinner"></div>
                    <p style="margin-top: 20px; color: #666;">Loading item details from RxNorm...</p>
                </div>
            `;
        }
    }

    /**
     * Show error state in modal
     */
    showErrorState(message) {
        const modalContent = document.getElementById('companionModalDrugInfo');
        if (modalContent) {
            modalContent.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #d32f2f;">
                    <h3>⚠️ Error Loading Details</h3>
                    <p>${message}</p>
                </div>
            `;
        }
    }

    /**
     * Get RXCUI from itemCode using NDC lookup (PRIMARY METHOD)
     * @param {string} itemCode - Item code from dashboard
     * @returns {Promise<string|null>} - RXCUI or null if not found
     */
    async getRxcuiFromItemCode(itemCode) {
        if (!itemCode || itemCode === 'N/A') {
            console.log('⚠️ No valid itemCode provided');
            return null;
        }

        const cacheKey = `rxcui_itemcode_${itemCode}`;
        if (this.rxnormCache.has(cacheKey)) {
            console.log('✓ RXCUI found in cache for itemCode:', itemCode);
            return this.rxnormCache.get(cacheKey);
        }

        console.log('🔍 Looking up NDC for itemCode:', itemCode);

        // Step 1: Find NDC from pricing data
        if (!this.pricingData) {
            console.warn('⚠️ Pricing data not loaded');
            return null;
        }

        const pricingEntry = this.pricingData.find(p => p.itemCode === itemCode);
        if (!pricingEntry || !pricingEntry.ndc) {
            console.log('❌ No NDC found in pricing data for itemCode:', itemCode);
            return null;
        }

        const rawNdc = String(pricingEntry.ndc || '').trim();
        if (!rawNdc) {
            console.log('❌ Pricing entry exists but NDC is empty for itemCode:', itemCode);
            return null;
        }

        // Normalize NDC for RxNav. Some environments/inputs provide hyphenated 10-digit NDCs.
        // RxNav endpoints can be finicky, so we try a small set of candidate formats.
        const ndcCandidates = this.buildNdcCandidates(rawNdc);
        console.log(`✓ Found NDC ${rawNdc} for itemCode ${itemCode}. Candidates:`, ndcCandidates);

        // Step 2: Get RXCUI from NDC using RxNav endpoints.
        // NOTE: Some corporate environments block cross-origin fetch from file:// (especially on network drives).
        // We treat fetch failures as a soft-fail and let the caller fall back to description-based lookup.
        const endpoints = [
            (ndc) => `https://rxnav.nlm.nih.gov/REST/ndcstatus.json?ndc=${encodeURIComponent(ndc)}`,
            (ndc) => `https://rxnav.nlm.nih.gov/REST/rxcui.json?idtype=NDC&id=${encodeURIComponent(ndc)}`
        ];

        for (const ndc of ndcCandidates) {
            for (const makeUrl of endpoints) {
                const url = makeUrl(ndc);
                try {
                    console.log('📡 Calling RxNav (PRIMARY):', url);
                    const response = await fetch(url);
                    if (!response.ok) {
                        console.warn(`⚠️ RxNav returned ${response.status} for NDC ${ndc}`);
                        continue;
                    }
                    const data = await response.json();

                    // ndcstatus.json => { ndcStatus: { rxcui: "..." } }
                    const rxcuiA = data?.ndcStatus?.rxcui;
                    if (rxcuiA) {
                        console.log(`✅ SUCCESS: Got RXCUI ${rxcuiA} from NDC ${ndc} (itemCode: ${itemCode})`);
                        this.rxnormCache.set(cacheKey, rxcuiA);
                        try { localStorage.setItem(cacheKey, rxcuiA); } catch (_) {}
                        return rxcuiA;
                    }

                    // rxcui.json => { idGroup: { rxnormId: ["..."] } }
                    const rxcuiB = data?.idGroup?.rxnormId?.[0] || data?.idGroup?.rxnormId;
                    if (rxcuiB) {
                        console.log(`✅ SUCCESS: Got RXCUI ${rxcuiB} from NDC ${ndc} (itemCode: ${itemCode})`);
                        this.rxnormCache.set(cacheKey, String(rxcuiB));
                        try { localStorage.setItem(cacheKey, String(rxcuiB)); } catch (_) {}
                        return String(rxcuiB);
                    }

                    console.log('ℹ️ RxNav responded but no RXCUI found for NDC:', ndc);
                } catch (error) {
                    // Most common on network-drive file:// launches: CORS / blocked fetch / TLS inspection.
                    console.warn('⚠️ RxNav fetch failed for NDC (PRIMARY). Will try next candidate/endpoint.', {
                        ndc,
                        url,
                        error: String(error)
                    });
                }
            }
        }

        console.log('❌ PRIMARY METHOD: No RXCUI found for itemCode via NDC lookup:', itemCode);
        return null;
    }

    /**
     * Build a small set of NDC candidate strings to try against RxNav.
     * Supports hyphenated 10-digit NDCs by converting to 11-digit form.
     */
    buildNdcCandidates(rawNdc) {
        const candidates = [];
        const pushUnique = (v) => {
            const s = String(v || '').trim();
            if (!s) return;
            if (!candidates.includes(s)) candidates.push(s);
        };

        pushUnique(rawNdc);
        pushUnique(rawNdc.replace(/\s+/g, ''));

        const digitsOnly = rawNdc.replace(/\D/g, '');
        pushUnique(digitsOnly);

        // Try to format to 11-digit NDC if input is 10-digit with hyphens.
        const normalized11 = this.normalizeNdcTo11(rawNdc);
        if (normalized11) pushUnique(normalized11);

        return candidates;
    }

    /**
     * Convert common hyphenated 10-digit NDC formats into 11-digit NDC.
     * FDA standard: pad one segment with a leading zero to reach 5-4-2.
     */
    normalizeNdcTo11(ndcStr) {
        if (!ndcStr) return null;
        const s = String(ndcStr).trim();

        // If already 11 digits, return digits.
        const digits = s.replace(/\D/g, '');
        if (digits.length === 11) return digits;

        const parts = s.split('-').map(p => p.trim()).filter(Boolean);
        if (parts.length !== 3) return null;

        let [a, b, c] = parts;
        // Expected final: a(5) + b(4) + c(2)
        // Identify which segment is short and left-pad.
        if (a.length === 4) a = '0' + a;
        else if (b.length === 3) b = '0' + b;
        else if (c.length === 1) c = '0' + c;

        const joined = `${a}${b}${c}`.replace(/\D/g, '');
        return joined.length === 11 ? joined : null;
    }

    /**
     * Get RXCUI from item description using RxNorm approximateTerm API (FALLBACK METHOD)
     * @param {string} description - Drug description
     * @returns {Promise<string|null>} - RXCUI or null if not found
     */
    async getRxcuiFromDescription(description) {
        const cacheKey = `rxcui_${description}`;
        if (this.rxnormCache.has(cacheKey)) {
            return this.rxnormCache.get(cacheKey);
        }

        try {
            const encodedTerm = encodeURIComponent(description);
            const url = `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodedTerm}&maxEntries=1`;
            console.log('📡 Calling approximateTerm API (FALLBACK):', url);
            
            const response = await fetch(url);
            if (!response.ok) throw new Error('RxNorm API request failed');
            
            const data = await response.json();
            
            if (data.approximateGroup && 
                data.approximateGroup.candidate && 
                data.approximateGroup.candidate.length > 0) {
                const rxcui = data.approximateGroup.candidate[0].rxcui;
                console.log(`✅ Got RXCUI ${rxcui} from approximateTerm (FALLBACK)`);
                this.rxnormCache.set(cacheKey, rxcui);
                return rxcui;
            }
            
            return null;
        } catch (error) {
            console.error('Error fetching RXCUI:', error);
            return null;
        }
    }

    /**
     * Get related products (SCD and SBD) from RXCUI
     * @param {string} rxcui - RXCUI identifier
     * @returns {Promise<Object>} - Object with SCD and SBD arrays
     */
    async getRelatedProducts(rxcui) {
        const cacheKey = `related_${rxcui}`;
        if (this.rxnormCache.has(cacheKey)) {
            return this.rxnormCache.get(cacheKey);
        }

        try {
            const url = `https://rxnav.nlm.nih.gov/REST/Prescribe/rxcui/${rxcui}/related.json?tty=SCD+SBD`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error('RxNorm related products API request failed');
            
            const data = await response.json();
            
            const result = {
                SCD: [],
                SBD: []
            };
            
            if (data.relatedGroup && data.relatedGroup.conceptGroup) {
                for (const group of data.relatedGroup.conceptGroup) {
                    if (group.tty === 'SBD' && group.conceptProperties) {
                        // Only take FIRST SBD
                        const firstSBD = group.conceptProperties[0];
                        if (firstSBD) {
                            result.SBD = [firstSBD.rxcui];
                            console.log(`✓ Selected first SBD: ${firstSBD.rxcui} (${firstSBD.name})`);
                        }
                    } else if (group.tty === 'SCD' && group.conceptProperties) {
                        // Only take FIRST SCD
                        const firstSCD = group.conceptProperties[0];
                        if (firstSCD) {
                            result.SCD = [firstSCD.rxcui];
                            console.log(`✓ Selected first SCD: ${firstSCD.rxcui} (${firstSCD.name})`);
                        }
                    }
                }
            }
            
            console.log(`📊 Related products for ${rxcui}:`, {
                SCD_count: result.SCD.length,
                SBD_count: result.SBD.length
            });
            
            this.rxnormCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Error fetching related products:', error);
            return { SCD: [], SBD: [] };
        }
    }

    /**
     * Get NDC data for all related products
     * @param {Object} relatedProducts - Object with SCD and SBD rxcui arrays
     * @returns {Promise<Array>} - Array of NDC data objects
     */
    async getNDCData(relatedProducts) {
        const allNDCs = [];
        
        // Process SBD products (branded = true)
        for (const rxcui of relatedProducts.SBD) {
            const ndcData = await this.getNDCPropertiesForRxcui(rxcui);
            ndcData.forEach(ndc => {
                ndc.branded = true;
                allNDCs.push(ndc);
            });
        }
        
        // Process SCD products (branded = false)
        for (const rxcui of relatedProducts.SCD) {
            const ndcData = await this.getNDCPropertiesForRxcui(rxcui);
            ndcData.forEach(ndc => {
                ndc.branded = false;
                allNDCs.push(ndc);
            });
        }
        
        return allNDCs;
    }

    /**
     * Get NDC properties for a specific RXCUI using RxNorm API
     * @param {string} rxcui - RXCUI identifier
     * @returns {Promise<Array>} - Array of NDC property objects
     */
    async getNDCPropertiesForRxcui(rxcui) {
        try {
            const url = `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/ndcs.json`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error('RxNorm NDC API request failed');
            
            const data = await response.json();
            
            if (!data.ndcGroup || !data.ndcGroup.ndcList || !data.ndcGroup.ndcList.ndc) {
                return [];
            }
            
            const ndcList = data.ndcGroup.ndcList.ndc;
            const ndcDetails = [];
            const seenNdcItems = new Map(); // Track ndcItem -> best node
            
            // Get first 9 digits of each NDC and fetch properties
            const uniqueNDC9 = [...new Set(ndcList.map(ndc => ndc.substring(0, 9)))];
            
            for (const ndc9 of uniqueNDC9) {
                const properties = await this.getNDCProperties(ndc9);
                if (properties) {
                    const ndcItem = properties.ndcItem;
                    
                    if (!ndcItem) {
                        // No ndcItem, just add it
                        ndcDetails.push(properties);
                        console.log(`✓ Added NDC ${ndc9} (no ndcItem)`);
                        continue;
                    }
                    
                    // Check if we've already seen this ndcItem
                    if (seenNdcItems.has(ndcItem)) {
                        const existingNode = seenNdcItems.get(ndcItem);
                        
                        // Priority 1: Nodes WITH "/" in packaging (package + unit)
                        const currentHasSlash = properties.packaging && properties.packaging.includes('/');
                        const existingHasSlash = existingNode.packaging && existingNode.packaging.includes('/');
                        
                        // Priority 2: Nodes WITH splSetIdItem
                        const currentHasSpl = properties.splSetIdItem && properties.splSetIdItem.length > 0;
                        const existingHasSpl = existingNode.splSetIdItem && existingNode.splSetIdItem.length > 0;
                        
                        let shouldReplace = false;
                        let reason = '';
                        
                        // Check priority: "/" first, then splSetIdItem
                        if (currentHasSlash && !existingHasSlash) {
                            shouldReplace = true;
                            reason = 'has "/" in packaging';
                        } else if (currentHasSlash === existingHasSlash && currentHasSpl && !existingHasSpl) {
                            shouldReplace = true;
                            reason = 'has splSetIdItem';
                        }
                        
                        if (shouldReplace) {
                            console.log(`🔄 Replacing ndcItem ${ndcItem}: Found better node (${reason})`);
                            const index = ndcDetails.indexOf(existingNode);
                            if (index > -1) {
                                ndcDetails[index] = properties;
                            }
                            seenNdcItems.set(ndcItem, properties);
                        } else {
                            console.log(`⏭️ Skipping duplicate ndcItem: ${ndcItem} for NDC ${ndc9}`);
                        }
                    } else {
                        // First time seeing this ndcItem
                        seenNdcItems.set(ndcItem, properties);
                        ndcDetails.push(properties);
                        console.log(`✓ Added ndcItem ${ndcItem} for NDC ${ndc9} (packaging: ${properties.packaging?.substring(0, 50)}...)`);
                    }
                }
            }
            
            console.log(`✓ Retrieved ${ndcDetails.length} unique NDC properties for RXCUI ${rxcui}`);
            return ndcDetails;
        } catch (error) {
            console.error(`Error fetching NDCs for RXCUI ${rxcui}:`, error);
            return [];
        }
    }

    /**
     * Get detailed properties for a 9-digit NDC
     * @param {string} ndc9 - 9-digit NDC
     * @returns {Promise<Object|null>} - NDC properties object
     */
    async getNDCProperties(ndc9) {
        const cacheKey = `ndc_${ndc9}`;
        if (this.ndcDataCache.has(cacheKey)) {
            console.log(`📦 Cache hit for NDC ${ndc9}`);
            return this.ndcDataCache.get(cacheKey);
        }

        try {
            const url = `https://rxnav.nlm.nih.gov/REST/ndcproperties.json?id=${ndc9}`;
            console.log(`🌐 Fetching NDC properties for ${ndc9}...`);
            
            const response = await fetch(url);
            if (!response.ok) throw new Error('NDC properties API request failed');
            
            const data = await response.json();
            console.log(`✓ NDC ${ndc9} data received:`, data);
            
            if (data.ndcPropertyList && data.ndcPropertyList.ndcProperty && data.ndcPropertyList.ndcProperty.length > 0) {
                const allProperties = data.ndcPropertyList.ndcProperty;
                console.log(`📊 Found ${allProperties.length} ndcProperty node(s) for NDC ${ndc9}`);
                
                // Priority: Select node with BOTH "/" in packaging AND splSetIdItem
                let selectedProperties = allProperties[0]; // Default to first
                let bestScore = 0;
                
                for (let i = 0; i < allProperties.length; i++) {
                    const props = allProperties[i];
                    
                    // Extract packaging to check for "/"
                    let packaging = 'N/A';
                    if (props.packagingList && props.packagingList.packaging && props.packagingList.packaging.length > 0) {
                        packaging = props.packagingList.packaging[0];
                    }
                    
                    // Calculate score for this node
                    let score = 0;
                    const hasSlash = packaging.includes('/');
                    const hasSplSetId = props.splSetIdItem && props.splSetIdItem.length > 0;
                    
                    if (hasSlash) score += 10;  // "/" is worth 10 points
                    if (hasSplSetId) score += 100;  // splSetIdItem is worth 100 points (more important!)
                    
                    console.log(`   Node ${i + 1}: packaging = "${packaging.substring(0, 60)}..." | splSetId = "${props.splSetIdItem || 'NONE'}" | score = ${score}`);
                    
                    // If this node has a better score, select it
                    if (score > bestScore) {
                        selectedProperties = props;
                        bestScore = score;
                        console.log(`   ✅ New best node: ${i + 1} (score: ${score})`);
                    }
                }
                
                console.log(`🏆 Selected node with score ${bestScore}`);
                const properties = selectedProperties;
                
                // Parse ALL propertyConceptList items for complete data
                const propertyMap = {};
                if (properties.propertyConceptList && properties.propertyConceptList.propertyConcept) {
                    properties.propertyConceptList.propertyConcept.forEach(concept => {
                        propertyMap[concept.propName] = concept.propValue;
                    });
                    console.log(`✓ Parsed ${Object.keys(propertyMap).length} property concepts`);
                }
                
                // Extract labeler
                const labelerName = propertyMap.LABELER || 'Unknown Labeler';
                console.log(`✓ Labeler: ${labelerName}`);
                
                // Extract packaging from packagingList
                let packaging = 'N/A';
                if (properties.packagingList && properties.packagingList.packaging && properties.packagingList.packaging.length > 0) {
                    packaging = properties.packagingList.packaging[0];
                    console.log(`✓ Packaging: ${packaging}`);
                }
                
                // Add all extracted fields
                properties.labelerName = labelerName;
                properties.packaging = packaging;
                properties.ndcCode = properties.ndc10 || properties.ndc9 || ndc9;
                properties.unitNDC = this.determineUnitNDC(properties);
                properties.propertyMap = propertyMap;  // NEW: All parsed properties
                
                console.log(`📋 Processed NDC ${ndc9}:`, {
                    labelerName: properties.labelerName,
                    packaging: properties.packaging,
                    ndcCode: properties.ndcCode,
                    unitNDC: properties.unitNDC,
                    hasColor: !!propertyMap.COLOR,
                    hasShape: !!propertyMap.SHAPE,
                    hasImprint: !!propertyMap.IMPRINT_CODE,
                    marketingStatus: propertyMap.MARKETING_STATUS
                });
                
                this.ndcDataCache.set(cacheKey, properties);
                return properties;
            }
            
            console.warn(`⚠️ No properties found for NDC ${ndc9}`);
            return null;
        } catch (error) {
            console.error(`❌ Error fetching properties for NDC ${ndc9}:`, error);
            return null;
        }
    }

    /**
     * Determine if NDC is a unit NDC based on packaging description
     * @param {Object} ndcProperties - NDC properties object
     * @returns {boolean} - True if unit NDC, false if package NDC
     */
    determineUnitNDC(ndcProperties) {
        if (!ndcProperties.packaging) return true;
        
        // Check if packaging has multiple components separated by "/"
        const packagingParts = ndcProperties.packaging.split('/');
        return packagingParts.length === 1;
    }

    /**
     * Process and filter NDC data
     * @param {Array} ndcData - Raw NDC data array
     * @returns {Object} - Processed data grouped by labeler
     */
    processNDCData(ndcData) {
        console.log('🔧 Processing NDC data...', ndcData);
        const today = new Date();
        
        // Filter NDCs based on marketing status and effective time
        const filteredNDCs = ndcData.filter(ndc => {
            // Check for marketing status in propertyConceptList
            let marketingStatus = 'Unknown';
            let marketingEndDate = null;
            
            if (ndc.propertyConceptList && ndc.propertyConceptList.propertyConcept) {
                const statusConcept = ndc.propertyConceptList.propertyConcept.find(
                    c => c.propName === 'MARKETING_STATUS'
                );
                if (statusConcept) {
                    marketingStatus = statusConcept.propValue;
                }
                
                const endDateConcept = ndc.propertyConceptList.propertyConcept.find(
                    c => c.propName === 'MARKETING_EFFECTIVE_TIME_HIGH'
                );
                if (endDateConcept) {
                    marketingEndDate = new Date(endDateConcept.propValue);
                }
            }
            
            // Skip if marketing ended and status is not active
            if (marketingEndDate && marketingEndDate < today && marketingStatus.toUpperCase() !== 'ACTIVE') {
                console.log(`⏭️ Skipping NDC ${ndc.ndcCode}: Marketing ended and not active`);
                return false;
            }
            
            console.log(`✓ Including NDC ${ndc.ndcCode}: ${marketingStatus}`);
            return true;
        });
        
        console.log(`✓ Filtered ${filteredNDCs.length} of ${ndcData.length} NDCs`);
        
        // Group by labeler
        const groupedByLabeler = {};
        
        filteredNDCs.forEach(ndc => {
            const labeler = ndc.labelerName || 'Unknown Labeler';
            const ndc9 = ndc.ndc9 || (ndc.ndcCode ? ndc.ndcCode.substring(0, 9) : null);
            
            if (!groupedByLabeler[labeler]) {
                groupedByLabeler[labeler] = {
                    labelerName: labeler,
                    ndc9: ndc9,
                    products: []
                };
                console.log(`📦 Created group for labeler: ${labeler}`);
            }
            
            groupedByLabeler[labeler].products.push(ndc);
        });
        
        const result = {
            labelers: Object.values(groupedByLabeler).sort((a, b) => 
                a.labelerName.localeCompare(b.labelerName)
            ),
            totalLabelers: Object.keys(groupedByLabeler).length,
            totalProducts: filteredNDCs.length,
            brandedCount: filteredNDCs.filter(n => n.branded).length,
            genericCount: filteredNDCs.filter(n => !n.branded).length
        };
        
        console.log('✅ Processing complete:', {
            totalLabelers: result.totalLabelers,
            totalProducts: result.totalProducts,
            brandedCount: result.brandedCount,
            genericCount: result.genericCount,
            labelers: result.labelers.map(l => `${l.labelerName} (${l.products.length})`)
        });
        
        return result;
    }

    /**
     * Populate the modal with processed data
     * @param {Object} processedData - Processed NDC data
     * @param {Object} dashboardData - Dashboard data (price, inventory, etc.)
     */
    populateModal(processedData, dashboardData) {
        const modalContent = document.getElementById('companionModalDrugInfo');
        if (!modalContent) return;
        
        // Update modal title
        const modalTitle = document.getElementById('companionModalDrugName');
        if (modalTitle) {
            modalTitle.textContent = 'Item Details';
        }
        
        // Build the modal content
        let html = `
            <div class="item-details-container">
                <!-- Summary Cards Row -->
                <div class="summary-cards-row" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px;">
                    <div class="companion-summary-card">
                        <div class="summary-card-label">ERX</div>
                        <div class="summary-card-value">${dashboardData.alt_itemCode || 'N/A'}</div>
                        <div class="summary-card-sublabel">
                            ADS: ${dashboardData.itemCode || 'N/A'}
                        </div>
                    </div>
                    <div class="companion-summary-card">
                        <div class="summary-card-label">Price (per unit)</div>
                        <div class="summary-card-value">$${dashboardData.price || 'N/A'}</div>
                    </div>
                    <div class="companion-summary-card">
                        <div class="summary-card-label">Total Inventory</div>
                        <div class="summary-card-value">${dashboardData.totalInventory || 'N/A'}</div>
                        <div class="summary-card-sublabel">
                            Pyxis: ${dashboardData.pyxis || 0} | Pharmacy: ${dashboardData.pharmacy || 0}
                        </div>
                    </div>
                </div>
                
                <!-- Labeler Selection -->
                <div class="companion-section">
                    <div class="section-header">
                        <div class="section-header-left">
                            <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M2 20v-8a2 2 0 0 1 2-2h3l2-4h6l2 4h3a2 2 0 0 1 2 2v8"></path>
                                <path d="M6 20v-8"></path>
                                <path d="M10 20v-8"></path>
                                <path d="M14 20v-8"></path>
                                <path d="M18 20v-8"></path>
                            </svg>
                            <span>Labelers</span>
                        </div>
                        ${this.brandName ? this.buildSearchDropdown() : ''}
                    </div>
                    <div class="section-content">
                        <div class="labeler-list" id="labelerList">
                            ${this.buildLabelerList(processedData.labelers)}
                        </div>
                    </div>
                </div>
                
                <!-- Package Details (populated when labeler is selected) -->
                <div class="companion-section" id="packageDetailsSection" style="display: none;">
                    <div class="section-header">
                        <div class="section-header-left">
                            <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                <line x1="12" y1="22.08" x2="12" y2="12"></line>
                            </svg>
                            <span>Package details</span>
                        </div>
                    </div>
                    <div class="section-content" id="packageDetailsContent"></div>
                </div>
                
                <!-- Drug Label Button Placeholder (will be populated by addDrugLabelButton) -->
                <div id="drugLabelButtonContainer"></div>
            </div>
        `;
        
        modalContent.innerHTML = html;
        
        // PRICING ENHANCEMENT: Enhance price card after modal is populated
        setTimeout(() => {
            this.enhancePriceCard();
        }, 100);
        
        // PRICING ENHANCEMENT: Add price badges to labeler list
        this.addPriceBadgesToLabelers(processedData.labelers);
        
        // Attach event listeners for labeler selection
        this.attachLabelerListeners(processedData.labelers);
        
        // Attach search dropdown listeners if brand name exists
        if (this.brandName) {
            this.attachSearchDropdownListeners();
        }
        
        // Auto-select if there's only one labeler
        if (processedData.totalLabelers === 1) {
            console.log('📌 Auto-selecting single labeler:', processedData.labelers[0].labelerName);
            this.showPackageDetails(processedData.labelers[0]);
        }
    }

    /**
     * Enhance the price summary card with comparison indicators
     * PRICING ENHANCEMENT: New method
     */
    enhancePriceCard() {
        const priceCard = document.querySelector('.summary-cards-row .companion-summary-card:nth-child(2)');
        if (!priceCard || !this.currentPriceComparison) return;

        const priceValue = priceCard.querySelector('.summary-card-value');
        if (!priceValue) return;

        const currentPrice = this.currentPriceComparison.currentPrice;
        const lowestPrice = this.currentPriceComparison.lowestPrice;
        
        // Check if current price equals lowest (within small tolerance for floating point)
        const isEqualToLowest = Math.abs(currentPrice - lowestPrice) < 0.01;

        if (this.currentPriceComparison.isHigherThanBest && !isEqualToLowest) {
            // Price is higher than best - show in orange with up arrow
            priceValue.style.color = '#ff8400';
            priceValue.innerHTML = `$${currentPrice.toFixed(2)} <span style="font-size: 0.7em;">↑</span>`;
            
            // Add sublabel showing default price
            let sublabel = priceCard.querySelector('.summary-card-sublabel');
            if (!sublabel) {
                sublabel = document.createElement('div');
                sublabel.className = 'summary-card-sublabel';
                priceCard.appendChild(sublabel);
            }
            sublabel.textContent = `Default Item $: ${currentPrice.toFixed(2)}`;
            
            console.log('💰 Price card enhanced - higher than best:', {
                current: currentPrice,
                lowest: lowestPrice
            });
        } else if (isEqualToLowest) {
            // Price equals best price - show in default teal
            priceValue.style.color = 'var(--teal-primary)';
            priceValue.textContent = `$${currentPrice.toFixed(2)}`;
            console.log('💰 Price card - at best price');
        } else {
            // Price is lower than best or no comparison - show in default teal
            priceValue.style.color = 'var(--teal-primary)';
            priceValue.textContent = `$${currentPrice.toFixed(2)}`;
            console.log('💰 Price card - default color');
        }
    }

    /**
     * Add price badges to labeler list items
     * PRICING ENHANCEMENT: New method
     * @param {Array} labelers - Array of labeler objects
     */
    addPriceBadgesToLabelers(labelers) {
        if (!this.currentPriceComparison) return;

        const lowestPriceNDC = this.currentPriceComparison.lowestPriceNDC;
        if (!lowestPriceNDC) return;

        labelers.forEach((labeler, index) => {
            const labelerPrice = this.getLabelerPrice(labeler.products);
            
            if (labelerPrice && labelerPrice.ndc === lowestPriceNDC) {
                // This labeler has the lowest price
                const labelerItem = document.querySelector(`.labeler-item[data-labeler-index="${index}"]`);
                if (labelerItem) {
                    // Add best price badge AFTER McK badge
                    const badge = document.createElement('span');
                    badge.className = 'labeler-badge best-price-badge';
                    badge.style.cssText = `
                        background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
                        color: white;
                        padding: 4px 10px;
                        border-radius: 12px;
                        font-size: clamp(0.7em, 1vw, 0.8em);
                        font-weight: 600;
                        margin-left: 8px;
                    `;
                    badge.innerHTML = '↓ $';
                    
                    // Insert after McK badge (if exists), or at the beginning of badges container
                    const badgesContainer = labelerItem.querySelector('.labeler-badges-container');
                    const mckBadge = labelerItem.querySelector('.mck-badge');
                    
                    if (badgesContainer) {
                        if (mckBadge) {
                            // Insert after McK badge
                            mckBadge.parentNode.insertBefore(badge, mckBadge.nextSibling);
                        } else {
                            // Insert at beginning of badges container
                            badgesContainer.insertBefore(badge, badgesContainer.firstChild);
                        }
                    }
                    
                    console.log('💰 Added best price badge to:', labeler.labelerName);
                }
            }
        });
    }

    /**
     * Build search dropdown with options
     * @returns {string} - HTML string for dropdown
     */
    buildSearchDropdown() {
        if (!this.brandName || !this.currentItemDescription) return '';
        
        // Extract base description without brand
        const baseDescription = this.currentItemDescription.replace(/\s*\[([^\]]+)\]\s*/, '').trim();
        
        return `
            <div class="search-dropdown-container">
                <button class="search-dropdown-btn" id="searchDropdownBtn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.35-4.35"></path>
                    </svg>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div class="search-dropdown-menu" id="searchDropdownMenu" style="display: none;">
                    <div class="search-dropdown-item" data-search-term="${baseDescription}">
                        ${baseDescription}
                    </div>
                    <div class="search-dropdown-item" data-search-term="${this.brandName}">
                        ${this.brandName}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Build HTML for labeler list
     * @param {Array} labelers - Array of labeler objects
     * @returns {string} - HTML string
     */
    buildLabelerList(labelers) {
        return labelers.map((labeler, index) => {
            // Determine badge type
            const hasBranded = labeler.products.some(p => p.branded);
            const hasGeneric = labeler.products.some(p => !p.branded);
            
            let brandingBadgeHTML = '';
            if (hasBranded && hasGeneric) {
                brandingBadgeHTML = '<span class="inline-badge mixed">MIXED</span>';
            } else if (hasBranded) {
                brandingBadgeHTML = '<span class="inline-badge branded">BRANDED</span>';
            } else {
                brandingBadgeHTML = '<span class="inline-badge generic">GENERIC</span>';
            }
            
            // Check for unit-dose
            const hasUnitDose = labeler.products.some(p => {
                const parsed = this.parsePackagingString(p.packaging);
                return parsed.unitDose;
            });
            
            // NEW: Check if labeler has pricing data (McK badge)
            const hasPricingData = this.getLabelerPrice(labeler.products) !== null;
            
            // Check if discontinued (any product has discontinued status)
            const isDiscontinued = labeler.products.some(p => {
                if (!p.propertyMap) return false;
                return window.PillImageGenerator?.isDiscontinued(p.propertyMap) || false;
            });
            
            const discontinuedClass = isDiscontinued ? ' discontinued' : '';
            
            // Build badges container with proper order: McK -> ↓$ -> UD -> Generic/Branded
            let badgesHTML = '<div class="labeler-badges-container">';
            
            // McK badge (blue) - will be first
            if (hasPricingData) {
                badgesHTML += '<span class="labeler-badge mck-badge" style="background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); color: white; padding: 4px 10px; border-radius: 12px; font-size: clamp(0.7em, 1vw, 0.8em); font-weight: 600; margin-left: 8px;">McK</span>';
            }
            
            // ↓$ badge will be added by addPriceBadgesToLabelers() - placeholder for order
            
            // UD badge
            if (hasUnitDose) {
                badgesHTML += '<span class="ud-badge">UD</span>';
            }
            
            // Generic/Branded badge (last)
            badgesHTML += brandingBadgeHTML;
            badgesHTML += '</div>';
            
            return `
                <div class="labeler-item${discontinuedClass}" data-labeler-index="${index}">
                    <div class="labeler-name-container">
                        <span class="labeler-name">${labeler.labelerName}</span>
                    </div>
                    ${badgesHTML}
                </div>
            `;
        }).join('');
    }

    /**
     * Attach listeners for search dropdown
     */
    attachSearchDropdownListeners() {
        const dropdownBtn = document.getElementById('searchDropdownBtn');
        const dropdownMenu = document.getElementById('searchDropdownMenu');
        
        if (!dropdownBtn || !dropdownMenu) return;
        
        // Toggle dropdown
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dropdownMenu.style.display === 'block';
            dropdownMenu.style.display = isVisible ? 'none' : 'block';
        });
        
        // Handle dropdown item clicks
        const dropdownItems = dropdownMenu.querySelectorAll('.search-dropdown-item');
        dropdownItems.forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const searchTerm = item.dataset.searchTerm;
                console.log('🔍 User selected search term:', searchTerm);
                
                // Hide dropdown
                dropdownMenu.style.display = 'none';
                
                // Refresh with selected term
                await this.refreshWithSearchTerm(searchTerm);
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdownMenu.style.display = 'none';
        });
    }

    /**
     * Attach click listeners to labeler items
     * @param {Array} labelers - Array of labeler objects
     */
    attachLabelerListeners(labelers) {
        const labelerItems = document.querySelectorAll('.labeler-item');
        
        labelerItems.forEach(item => {
            item.addEventListener('click', () => {
                // Remove active and selected class from all items
                labelerItems.forEach(i => {
                    i.classList.remove('active');
                    i.classList.remove('selected');
                });
                
                // Add active and selected class to clicked item
                item.classList.add('active');
                item.classList.add('selected');
                
                // Get labeler data
                const index = parseInt(item.dataset.labelerIndex);
                const labeler = labelers[index];
                
                // Show package details
                this.showPackageDetails(labeler);
            });
        });
    }

    /**
     * Show package details for selected labeler
     * @param {Object} labeler - Labeler object with products
     */
    showPackageDetails(labeler) {
        const packageDetailsSection = document.getElementById('packageDetailsSection');
        const packageDetailsContent = document.getElementById('packageDetailsContent');
        
        if (!packageDetailsSection || !packageDetailsContent) return;
        
        console.log('📦 Showing package details for:', labeler.labelerName);
        console.log('📊 Labeler has', labeler.products.length, 'products:', labeler.products);
        
        // Store SPL SET ID for drug label button
        this.currentSplSetId = labeler.products[0]?.splSetIdItem || null;
        console.log('💊 SPL SET ID:', this.currentSplSetId);
        
        let html = '<div class="package-details-grid">';
        
        // Build cards for each product (no headers)
        html += '<div class="package-ndc-section">';
        const cards = labeler.products.map(ndc => {
            console.log('🎯 Processing product for card:', ndc.ndc10);
            return this.buildPackageNDCCard(ndc);
        }).filter(card => card);
        console.log('📋 Total cards built:', cards.length);
        html += cards.join('');
        html += '</div>';
        
        // Add pill image if we have property data with valid shape or color
        const firstProduct = labeler.products[0];
        if (firstProduct && firstProduct.propertyMap && window.PillImageGenerator) {
            const hasShape = firstProduct.propertyMap.SHAPE && firstProduct.propertyMap.SHAPE !== 'Unknown';
            const hasColor = firstProduct.propertyMap.COLOR && firstProduct.propertyMap.COLOR !== 'Unknown';
            
            if (hasShape || hasColor) {
                console.log('💊 Generating pill image (has shape or color)');
                html += '<div class="pill-image-section">';
                html += window.PillImageGenerator.generatePillSVG(firstProduct.propertyMap);
                html += '</div>';
            } else {
                console.log('⚠️ No valid shape or color for pill visualization');
            }
        } else {
            console.log('⚠️ No pill data available for visualization');
        }
        
        html += '</div>';
        
        packageDetailsContent.innerHTML = html;
        packageDetailsSection.style.display = 'block';
        
        // PRICING ENHANCEMENT: Update price card with labeler's price
        const labelerPrice = this.getLabelerPrice(labeler.products);
        const priceCard = document.querySelector('.summary-cards-row .companion-summary-card:nth-child(2)');
        
        if (priceCard) {
            const priceValue = priceCard.querySelector('.summary-card-value');
            if (priceValue) {
                if (labelerPrice && labelerPrice.bestPrice) {
                    // Has pricing data
                    const isLowest = labelerPrice.ndc === this.currentPriceComparison?.lowestPriceNDC;
                    const defaultPriceNum = parseFloat(this.defaultPrice);
                    const labelerPriceNum = labelerPrice.bestPrice;
                    
                    // Check if price equals default (within small tolerance for floating point)
                    const isEqualToDefault = this.defaultPrice && Math.abs(labelerPriceNum - defaultPriceNum) < 0.01;
                    const isHigherThanDefault = this.defaultPrice && labelerPriceNum > defaultPriceNum && !isEqualToDefault;
                    
                    if (isLowest) {
                        priceValue.style.color = '#10b981'; // Green for best price
                        priceValue.textContent = `$${labelerPrice.bestPrice.toFixed(2)}`;
                    } else if (isHigherThanDefault) {
                        priceValue.style.color = '#ff8400'; // Orange when higher than default
                        priceValue.innerHTML = `$${labelerPrice.bestPrice.toFixed(2)} <span style="font-size: 0.7em;">↑</span>`;
                    } else {
                        priceValue.style.color = 'var(--teal-primary)'; // Default teal (same or lower than default)
                        priceValue.textContent = `$${labelerPrice.bestPrice.toFixed(2)}`;
                    }

                    // Update or add sublabel
                    let sublabel = priceCard.querySelector('.summary-card-sublabel');
                    if (!sublabel) {
                        sublabel = document.createElement('div');
                        sublabel.className = 'summary-card-sublabel';
                        priceCard.appendChild(sublabel);
                    }
                    sublabel.textContent = `Default Item $: ${this.defaultPrice || 'N/A'}`;
                    
                    console.log('💰 Updated price card with labeler price:', {
                        labeler: labeler.labelerName,
                        price: labelerPrice.bestPrice,
                        isLowest: isLowest,
                        isEqualToDefault: isEqualToDefault,
                        isHigherThanDefault: isHigherThanDefault
                    });
                } else {
                    // No pricing data - show "--"
                    priceValue.style.color = 'var(--teal-primary)';
                    priceValue.textContent = '--';
                    
                    // Update or add sublabel
                    let sublabel = priceCard.querySelector('.summary-card-sublabel');
                    if (!sublabel) {
                        sublabel = document.createElement('div');
                        sublabel.className = 'summary-card-sublabel';
                        priceCard.appendChild(sublabel);
                    }
                    sublabel.textContent = `Default Item $: ${this.defaultPrice || 'N/A'}`;
                    
                    console.log('💰 No pricing data for labeler:', labeler.labelerName);
                }
            }
        }
        
        // Attach click listeners for NDC cards
        this.attachNDCCardListeners();
    }

    /**
     * Parse packaging string to extract package and unit NDC information
     * Format: "10 CARTRIDGE in 1 CARTON (0409-1890-01) / 1 mL in 1 CARTRIDGE (0409-1890-03)"
     * Or: "1 mL in 1 SYRINGE" (no NDC codes)
     * @param {string} packagingString - Full packaging description
     * @returns {Object} - Parsed package and unit info
     */
    parsePackagingString(packagingString) {
        if (!packagingString) {
            return { packageNDC: null, packageDesc: null, unitNDC: null, unitDesc: null, unitDose: false };
        }
        
        console.log('🔍 Parsing packaging string:', packagingString);
        
        // Check for unit-dose indicators
        const packagingUpper = packagingString.toUpperCase();
        const unitDose = packagingUpper.includes('UNIT-DOSE') || packagingUpper.includes('BLISTER PACK');
        if (unitDose) {
            console.log('   ✓ UNIT-DOSE detected');
        }
        
        // Split by "/" to separate parts
        const parts = packagingString.split('/').map(p => p.trim());
        
        if (parts.length === 1) {
            // Single part - could be with or without NDC
            const match = parts[0].match(/^(.+?)\s*\(([^)]+)\)$/);
            if (match) {
                // Has NDC in parentheses - this is a unit NDC
                console.log('✓ Single NDC (Unit only):', { desc: match[1].trim(), ndc: match[2].trim() });
                return {
                    packageNDC: null,
                    packageDesc: null,
                    unitNDC: match[2].trim(),
                    unitDesc: match[1].trim(),
                    unitDose: unitDose
                };
            } else {
                // No NDC in parentheses - just description
                console.log('✓ Description only (no NDC in packaging string):', parts[0]);
                return {
                    packageNDC: null,
                    packageDesc: null,
                    unitNDC: null,  // Will be populated from ndc10
                    unitDesc: parts[0],
                    unitDose: unitDose
                };
            }
        } else if (parts.length >= 2) {
            // Multiple parts with "/" - FIRST part is package, LAST part is unit
            const packagePart = parts[0];
            const unitPart = parts[parts.length - 1];  // Take LAST segment as unit
            
            console.log(`   📦 Package part: "${packagePart}"`);
            console.log(`   💊 Unit part (last of ${parts.length}): "${unitPart}"`);
            
            // Extract package NDC and description
            const packageMatch = packagePart.match(/^(.+?)\s*\(([^)]+)\)$/);
            
            // Extract unit NDC and description
            let unitNDC = null;
            let unitDesc = unitPart;
            
            const unitMatch = unitPart.match(/^(.+?)\s*\(([^)]+)\)$/);
            if (unitMatch) {
                unitNDC = unitMatch[2].trim();
                unitDesc = unitMatch[1].trim();
            }
            
            const result = {
                packageNDC: packageMatch ? packageMatch[2].trim() : null,
                packageDesc: packageMatch ? packageMatch[1].trim() : packagePart,
                unitNDC: unitNDC,
                unitDesc: unitDesc,
                unitDose: unitDose
            };
            
            console.log('✓ Package and Unit NDCs parsed:', result);
            return result;
        }
        
        console.warn('⚠️ Could not parse packaging string');
        return { packageNDC: null, packageDesc: null, unitNDC: null, unitDesc: null, unitDose: false };
    }

    /**
     * Build HTML card for package NDC
     * @param {Object} ndc - NDC object
     * @returns {string} - HTML string
     */
    buildPackageNDCCard(ndc) {
        console.log('🏗️ Building card for NDC:', {
            ndc10: ndc.ndc10,
            packaging: ndc.packaging,
            splSetIdItem: ndc.splSetIdItem
        });
        
        const parsed = this.parsePackagingString(ndc.packaging);
        
        console.log('📋 Parsed result:', parsed);
        
        // If no NDCs were found in the packaging string, use the ndc10 from the object
        let packageNDC = parsed.packageNDC;
        let unitNDC = parsed.unitNDC;
        
        // Rule: If package has NDC but unit doesn't, duplicate the package NDC to unit
        if (packageNDC && !unitNDC) {
            unitNDC = packageNDC;
            console.log('🔄 Duplicating package NDC to unit NDC:', packageNDC);
        }
        
        if (!packageNDC && !unitNDC && ndc.ndc10) {
            // No NDCs in packaging string, but we have ndc10 - treat as unit NDC
            unitNDC = ndc.ndc10;
            console.log('📝 Using ndc10 as unit NDC:', unitNDC);
        }
        
        // If we still don't have any NDC, skip this card
        if (!packageNDC && !unitNDC) {
            console.warn('⚠️ No NDC found for this product, skipping');
            return '';
        }
        
        // NEW: If package is empty but unit exists, populate package from unit
        if (!packageNDC && unitNDC) {
            packageNDC = unitNDC;
            console.log('🔄 Copying unit NDC to package NDC (no package found):', unitNDC);
        }
        
        // Build 2-column layout (Package | Unit) with labels inside, no badges
        console.log('💳 Creating 2-column card layout:', { packageNDC, unitNDC });
        
        let html = '<div class="ndc-card-row">';
        
        // Package NDC card (left column) - should always exist now
        if (packageNDC) {
            html += `
                <div class="ndc-card package-ndc-card" data-ndc="${packageNDC}" data-spl-set-id="${ndc.splSetIdItem || ''}">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div class="ndc-code">${packageNDC}</div>
                            <div class="ndc-packaging">${parsed.packageDesc || parsed.unitDesc || 'N/A'}</div>
                        </div>
                        <div class="ndc-label">Package</div>
                    </div>
                </div>
            `;
        } else {
            html += '<div class="ndc-card ndc-card-empty"></div>';
        }
        
        // Unit NDC card (right column)
        if (unitNDC) {
            html += `
                <div class="ndc-card unit-ndc-card">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div class="ndc-code">${unitNDC}</div>
                            <div class="ndc-packaging">${parsed.unitDesc || ndc.packaging || 'N/A'}</div>
                        </div>
                        <div class="ndc-label">Unit</div>
                    </div>
                </div>
            `;
        } else {
            html += '<div class="ndc-card ndc-card-empty"></div>';
        }
        
        html += '</div>';
        
        return html;
    }

    /**
     * Build HTML card for unit NDC
     * @param {Object} ndc - NDC object
     * @returns {string} - HTML string
     */
    buildUnitNDCCard(ndc) {
        return `
            <div class="ndc-card unit-ndc-card">
                <div class="ndc-code">${ndc.ndcCode}</div>
                <div class="ndc-packaging">${ndc.packaging || 'N/A'}</div>
                ${ndc.branded ? '<span class="branded-badge">Branded</span>' : '<span class="generic-badge">Generic</span>'}
            </div>
        `;
    }

    /**
     * Attach click listeners to NDC cards
     */
    attachNDCCardListeners() {
        const packageCards = document.querySelectorAll('.package-ndc-card');
        
        // Check if the CURRENTLY SELECTED labeler has the McK badge
        const selectedLabeler = document.querySelector('.labeler-item.selected');
        const hasMcKBadge = selectedLabeler?.querySelector('.mck-badge') !== null;
        
        packageCards.forEach(card => {
            const packageNDC = card.dataset.ndc;
            if (!packageNDC) return;
            
            if (hasMcKBadge) {
                // Selected labeler HAS McK badge - ENABLE click on package cards
                card.style.cursor = 'pointer';
                card.style.opacity = '1';
                card.title = 'Search on McKesson Connect'; // Tooltip
                card.addEventListener('click', () => {
                    const url = `https://connect.mckesson.com/applications/product-content-search-3rd-party-page?searchText=${packageNDC}`;
                    window.open(url, '_blank');
                });
            } else {
                // Selected labeler does NOT have McK badge - DISABLE click
                card.style.cursor = 'not-allowed';
                card.style.opacity = '0.6';
                card.title = 'No pricing data available';
                card.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('❌ No pricing data available for this labeler');
                });
            }
        });
        
        // Add drug label button OUTSIDE of package details
        this.addDrugLabelButton();
    }

    /**
     * Check if FDA drug label exists for SPL SET ID
     * @param {string} splSetId - SPL SET ID to check
     * @returns {Promise<boolean>} - True if label exists
     */
    async checkFDALabelExists(splSetId) {
        if (!splSetId) {
            console.warn('⚠️ No SPL SET ID provided');
            return false;
        }
        
        try {
            const url = `https://api.fda.gov/drug/label.json?search=set_id:"${splSetId}"&limit=1`;
            console.log('🔍 Checking FDA label:', url);
            
            const response = await fetch(url);
            const data = await response.json();
            
            console.log('📦 FDA API Response:', data);
            
            if (data.error) {
                if (data.error.code === 'NOT_FOUND') {
                    console.warn('❌ FDA label not found for SPL SET ID:', splSetId);
                    return false;
                }
                console.warn('⚠️ FDA API Error:', data.error);
                return false;
            }
            
            if (data.results && data.results.length > 0) {
                console.log('✓ FDA label found for SPL SET ID:', splSetId);
                return true;
            }
            
            console.warn('❌ No results for SPL SET ID:', splSetId);
            return false;
        } catch (error) {
            console.error('❌ Error checking FDA label:', error);
            return false;
        }
    }

    /**
     * Add drug label button with FDA API validation - placed at bottom right like Open SBAR
     */
    async addDrugLabelButton() {
        // Find the dedicated button container at the bottom
        const buttonContainer = document.getElementById('drugLabelButtonContainer');
        if (!buttonContainer) {
            console.warn('⚠️ Drug label button container not found');
            return;
        }
        
        // Check if button section already exists
        let drugLabelSection = document.getElementById('drugLabelSection');
        if (!drugLabelSection) {
            // Create button section (no frame, just button at right)
            drugLabelSection = document.createElement('div');
            drugLabelSection.id = 'drugLabelSection';
            drugLabelSection.className = 'drug-label-section';
            drugLabelSection.innerHTML = `
                <div class="section-content" style="text-align: right; padding: 12px 0;">
                    <button class="drug-label-button" id="drugLabelButton" disabled>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        <span id="drugLabelButtonText">Checking availability...</span>
                    </button>
                </div>
            `;
            buttonContainer.appendChild(drugLabelSection);
        }
        
        const button = document.getElementById('drugLabelButton');
        const buttonText = document.getElementById('drugLabelButtonText');
        
        // Reset button state
        button.disabled = true;
        button.classList.remove('active', 'disabled');
        buttonText.textContent = 'Checking availability...';
        
        // Check if FDA label exists
        const labelExists = await this.checkFDALabelExists(this.currentSplSetId);
        
        if (labelExists) {
            button.disabled = false;
            button.classList.add('active');
            buttonText.textContent = 'View Drug Label';
            // Remove old listeners
            button.replaceWith(button.cloneNode(true));
            const newButton = document.getElementById('drugLabelButton');
            newButton.addEventListener('click', () => this.openDrugLabel());
        } else {
            button.classList.add('disabled');
            buttonText.textContent = 'No Drug Label Available';
        }
    }

    /**
     * Open drug label in FDA formatter in a popup window
     */
    openDrugLabel() {
        if (!this.currentSplSetId) {
            console.error('❌ No SPL SET ID available');
            return;
        }
        
        console.log('🔗 Opening FDA drug label for SPL SET ID:', this.currentSplSetId);
        const url = `fda_drug_label_formatter_v1_3.html?set_id=${this.currentSplSetId}`;
        
        // Open in popup window
        const width = 1200;
        const height = 900;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        
        const popup = window.open(
            url,
            'FDADrugLabel',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
        );
        
        if (popup) {
            popup.focus();
        } else {
            // Popup blocked, fallback to new tab
            console.warn('⚠️ Popup blocked, opening in new tab');
            window.open(url, '_blank');
        }
    }
}

// Export for use in browser as global
if (typeof window !== 'undefined') {
    window.ItemDetailsManager = ItemDetailsManager;
    window.itemDetailsManager = new ItemDetailsManager();
}
