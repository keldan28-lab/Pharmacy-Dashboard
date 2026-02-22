// Item Details Integration Script
// This script monitors the companion modal and populates it when it comes into focus

(function() {
    console.log('🔧 Initializing Item Details Integration...');
    
    let lastProcessedItem = null;
    
    /**
     * Monitor companion modal for when it comes into focus
     */
    function monitorCompanionModal() {
        const companionModal = document.getElementById('companionModal');
        
        if (!companionModal) {
            console.log('⏳ Companion modal not found, retrying...');
            setTimeout(monitorCompanionModal, 500);
            return;
        }
        
        // Use MutationObserver to watch for class changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const classes = companionModal.classList;
                    
                    // Check if companion modal is now in front (focused)
                    if (classes.contains('carousel-front') || classes.contains('carousel-entering-scaling')) {
                        console.log('📋 Companion modal came into focus, loading Item Details...');
                        setTimeout(() => {
                            loadItemDetailsForCurrentSelection();
                        }, 100);
                    }
                }
            });
        });
        
        observer.observe(companionModal, { attributes: true });
        console.log('✓ Companion modal observer initialized');
    }
    
    /**
     * Load Item Details for the currently selected item
     */
    async function loadItemDetailsForCurrentSelection() {
        console.log('🔍 Loading Item Details for current selection...');
        
        // Get the current selected item from global scope
        if (typeof currentModalItems === 'undefined' || typeof currentSelectedIndex === 'undefined') {
            console.error('❌ No item data available');
            showErrorInCompanionModal('No item data available');
            return;
        }
        
        const selectedItem = currentModalItems[currentSelectedIndex];
        if (!selectedItem) {
            console.error('❌ Selected item not found');
            showErrorInCompanionModal('Selected item not found');
            return;
        }
        
        // Check if we already processed this item
        const itemKey = `${selectedItem.description}_${currentSelectedIndex}`;
        
        // Allow re-render even if same item (fixes reload issue)
        if (lastProcessedItem === itemKey) {
            console.log('🔄 Re-rendering item (modal reopened)');
        }
        lastProcessedItem = itemKey;
        
        console.log('📦 Processing item:', selectedItem.description);
        lastProcessedItem = itemKey;
        
        // Extract brand name from description (text in square brackets)
        const brandMatch = selectedItem.description.match(/\[([^\]]+)\]/);
        const brandName = brandMatch ? brandMatch[1] : null;
        
        // Prepare dashboard data for the Item Details modal
        const dashboardData = {
            price: selectedItem.unitPrice || selectedItem.price || 'N/A',
            totalInventory: (selectedItem.pyxis || 0) + (selectedItem.pharmacy || 0),
            pyxis: selectedItem.pyxis || 0,
            pharmacy: selectedItem.pharmacy || 0,
            itemCode: selectedItem.itemCode || 'N/A',
            alt_itemCode: selectedItem.alt_itemCode || selectedItem.ads || 'N/A',
            brandName: brandName // Pass brand name for refresh button fallback
        };
        
        console.log('💰 Dashboard data:', dashboardData);
        
        // Load Item Details
        if (window.itemDetailsManager) {
            await window.itemDetailsManager.initializeItemDetails(
                selectedItem.description,
                dashboardData
            );
        } else {
            console.error('❌ ItemDetailsManager not loaded');
            showErrorInCompanionModal('ItemDetailsManager module not loaded');
        }
    }
    
    /**
     * Show error message in companion modal
     */
    function showErrorInCompanionModal(message) {
        const companionModalContent = document.getElementById('companionModalDrugInfo');
        if (companionModalContent) {
            companionModalContent.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #d32f2f;">
                    <h3>⚠️ Error</h3>
                    <p>${message}</p>
                </div>
            `;
        }
    }
    
    /**
     * Reset last processed item when details modal selection changes
     */
    function monitorItemSelection() {
        // Hook into the selectModalItem function if it exists
        const originalSelectModalItem = window.selectModalItem;
        if (originalSelectModalItem) {
            window.selectModalItem = function(...args) {
                console.log('🔄 Item selection changed, resetting cache');
                lastProcessedItem = null;
                return originalSelectModalItem.apply(this, args);
            };
            console.log('✓ Item selection monitor installed');
        } else {
            console.log('⚠️ selectModalItem function not found');
        }
    }
    
    // Initialize everything
    setTimeout(() => {
        monitorCompanionModal();
        monitorItemSelection();
    }, 1000);
    
    console.log('✓ Item Details Integration complete');
})();
