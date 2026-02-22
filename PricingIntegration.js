/**
 * Pricing Integration Enhancement Script
 * Adds pricing comparison functionality to Item Details modal
 * Version: 1.0.0
 */

(function() {
    console.log('💰 Initializing Pricing Integration Enhancement...');

    /**
     * ENHANCEMENT 1: Add pricing comparison methods to ItemDetailsManager
     */
    function enhanceItemDetailsManager() {
        if (!window.itemDetailsManager) {
            console.error('❌ ItemDetailsManager not found');
            return false;
        }

        const manager = window.itemDetailsManager;

        // Add pricing data property
        manager.pricingData = null;
        manager.currentPriceComparison = null;
        manager.defaultPrice = null;

        /**
         * Load pricing data from global PRICING_DATA
         */
        manager.loadPricingData = function() {
            if (typeof PRICING_DATA !== 'undefined' && PRICING_DATA.pricing) {
                this.pricingData = PRICING_DATA.pricing;
                console.log('💰 Pricing data loaded:', this.pricingData.length, 'entries');
                return true;
            }
            console.warn('⚠️ PRICING_DATA not found');
            return false;
        };

        /**
         * Get pricing comparison for current item
         */
        manager.getPricingComparison = function(ndcList, currentPrice) {
            if (!this.pricingData) {
                console.log('📊 No pricing data available for comparison');
                return null;
            }

            console.log('💲 Starting pricing analysis for', ndcList.length, 'NDCs');
            
            const matchedPrices = [];
            
            ndcList.forEach(ndcObj => {
                const ndc = ndcObj.packageNDC || ndcObj.ndc10;
                if (!ndc) return;
                
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
                    
                    console.log(`  ✓ Found pricing for ${ndc}:`, {
                        gpo: gpoPrice === Infinity ? 'N/A' : gpoPrice,
                        wac: wacPrice === Infinity ? 'N/A' : wacPrice,
                        best: bestPrice === Infinity ? 'N/A' : bestPrice
                    });
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

            console.log('💰 Pricing Analysis Complete:', result);
            return result;
        };

        /**
         * Get price for specific labeler's NDC
         */
        manager.getLabelerPrice = function(products) {
            if (!this.pricingData || !products || products.length === 0) {
                return null;
            }

            for (const product of products) {
                const ndc = product.packageNDC || product.ndc10;
                if (!ndc) continue;
                
                const pricingEntry = this.pricingData.find(p => p.ndc === ndc);
                if (pricingEntry) {
                    const gpoPrice = parseFloat(pricingEntry.gpoPrice) || Infinity;
                    const wacPrice = parseFloat(pricingEntry.wacPrice) || Infinity;
                    const bestPrice = Math.min(gpoPrice, wacPrice);
                    
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
        };

        /**
         * Override initializeItemDetails to include pricing analysis
         */
        const originalInit = manager.initializeItemDetails.bind(manager);
        manager.initializeItemDetails = async function(itemDescription, dashboardData = {}) {
            // Load pricing data if not already loaded
            if (!this.pricingData) {
                this.loadPricingData();
            }

            // Store default price
            this.defaultPrice = dashboardData.price;

            // Call original init
            await originalInit(itemDescription, dashboardData);
        };

        /**
         * Override populateModal to include pricing display
         */
        const originalPopulateModal = manager.populateModal.bind(manager);
        manager.populateModal = function(processedData, dashboardData) {
            // Perform pricing analysis
            const allNDCs = [];
            processedData.labelers.forEach(labeler => {
                labeler.products.forEach(product => {
                    allNDCs.push({
                        packageNDC: product.packageNDC || product.ndc10,
                        ndc10: product.ndc10,
                        labelerName: labeler.labelerName
                    });
                });
            });

            this.currentPriceComparison = this.getPricingComparison(allNDCs, dashboardData.price);

            // Call original populate
            originalPopulateModal(processedData, dashboardData);

            // Enhance the price card after modal is populated
            this.enhancePriceCard();

            // Add price badges to labeler list
            this.addPriceBadgesToLabelers(processedData.labelers);
        };

        /**
         * Enhance the price summary card with comparison
         */
        manager.enhancePriceCard = function() {
            const priceCard = document.querySelector('.summary-cards-row .companion-summary-card:nth-child(2)');
            if (!priceCard || !this.currentPriceComparison) return;

            const priceValue = priceCard.querySelector('.summary-card-value');
            if (!priceValue) return;

            const currentPrice = this.currentPriceComparison.currentPrice;
            const lowestPrice = this.currentPriceComparison.lowestPrice;

            if (this.currentPriceComparison.isHigherThanBest) {
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
            } else if (currentPrice === lowestPrice) {
                // Price equals best price - show normally
                priceValue.style.color = 'var(--teal-primary)';
                priceValue.textContent = `$${currentPrice.toFixed(2)}`;
                console.log('💰 Price card - at best price');
            }
        };

        /**
         * Add price badges to labeler list items
         */
        manager.addPriceBadgesToLabelers = function(labelers) {
            if (!this.currentPriceComparison) return;

            const lowestPriceNDC = this.currentPriceComparison.lowestPriceNDC;
            if (!lowestPriceNDC) return;

            labelers.forEach((labeler, index) => {
                const labelerPrice = this.getLabelerPrice(labeler.products);
                
                if (labelerPrice && labelerPrice.ndc === lowestPriceNDC) {
                    // This labeler has the lowest price
                    const labelerItem = document.querySelector(`.labeler-item[data-labeler-index="${index}"]`);
                    if (labelerItem) {
                        // Add best price badge
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
                        
                        const existingBadge = labelerItem.querySelector('.labeler-badge');
                        if (existingBadge) {
                            existingBadge.parentNode.insertBefore(badge, existingBadge.nextSibling);
                        } else {
                            labelerItem.appendChild(badge);
                        }
                        
                        console.log('💰 Added best price badge to:', labeler.labelerName);
                    }
                }
            });
        };

        /**
         * Override showPackageDetails to update price when labeler is selected
         */
        const originalShowPackageDetails = manager.showPackageDetails.bind(manager);
        manager.showPackageDetails = function(labeler) {
            // Call original method
            originalShowPackageDetails(labeler);

            // Update price card with labeler's price
            const labelerPrice = this.getLabelerPrice(labeler.products);
            
            if (labelerPrice && labelerPrice.bestPrice) {
                const priceCard = document.querySelector('.summary-cards-row .companion-summary-card:nth-child(2)');
                if (priceCard) {
                    const priceValue = priceCard.querySelector('.summary-card-value');
                    if (priceValue) {
                        const isLowest = labelerPrice.ndc === this.currentPriceComparison?.lowestPriceNDC;
                        
                        if (isLowest) {
                            priceValue.style.color = '#10b981'; // Green for best price
                            priceValue.textContent = `$${labelerPrice.bestPrice.toFixed(2)}`;
                        } else {
                            priceValue.style.color = 'var(--teal-primary)';
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
                            isLowest: isLowest
                        });
                    }
                }
            }
        };

        console.log('✅ ItemDetailsManager enhanced with pricing comparison');
        return true;
    }

    /**
     * Initialize enhancements
     */
    function initialize() {
        // Wait for ItemDetailsManager to be available
        if (window.itemDetailsManager) {
            enhanceItemDetailsManager();
        } else {
            console.log('⏳ Waiting for ItemDetailsManager...');
            setTimeout(initialize, 500);
        }
    }

    // Start initialization
    setTimeout(initialize, 1000);

    console.log('✅ Pricing Integration Enhancement loaded');
})();
