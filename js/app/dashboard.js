        // ==================================================================================
        // DASHBOARD VERSION: PERCENTILE-BASED USAGE RATE ALGORITHM v4.0
        // Migrated to statistical percentile filtering on 2024-12-29
        // Uses configurable percentile cutoff for automatic outlier detection
        // No explicit thresholds - purely statistical approach
        // ==================================================================================
        console.log('🚀 Dashboard v4.0 - Percentile-Based Statistical Algorithm');
        console.log('📊 Algorithm: Configurable percentile cutoff + Universal application');
        


// Ensure debug state container exists in Dashboard frame (file:// + iframes)
window.costChartState = window.costChartState || {};

// Ensure SpikeFactors is available (self-heal if script failed to load)
function _ensureSpikeFactorsLoaded() {
    return new Promise(function(resolve) {
        if (window.SpikeFactors && typeof window.SpikeFactors.computeSpikeFactorTable === 'function') {
            return resolve(true);
        }

        // Infer spikeFactors.js path next to dashboard.js when possible
        var scripts = document.getElementsByTagName('script');
        var dashSrc = null;
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (src.indexOf('dashboard.js') !== -1) { dashSrc = src; break; }
        }

        var sfSrc = dashSrc
            ? dashSrc.replace(/dashboard\.js(\?.*)?$/i, 'spikeFactors.js?v=' + Date.now())
            : ('js/app/spikeFactors.js?v=' + Date.now());

        console.warn('SpikeFactors not found; loading ' + sfSrc);

        var s = document.createElement('script');
        s.src = sfSrc;
        s.onload = function() { resolve(!!window.SpikeFactors); };
        s.onerror = function() { console.error('Failed to load SpikeFactors'); resolve(false); };
        document.head.appendChild(s);
    });
}

// Manual request: ask child frames to resend chart projection state
window.requestChartStateMirror = function() {
    try {
        var iframes = document.getElementsByTagName('iframe');
        for (var i = 0; i < iframes.length; i++) {
            try {
                if (iframes[i].contentWindow) {
                    iframes[i].contentWindow.postMessage({ type: 'PB_REQUEST_CHART_STATE' }, '*');
                }
            } catch (_) {}
        }
    } catch (_) {}
};
        // ============= SUNSET-BASED DARK MODE SYSTEM =============
        
        let sunsetData = {
            sunset: null,
            sunrise: null,
            lastFetch: null,
            latitude: null,
            longitude: null
        };
        
        let darkModeOverride = null; // null = auto, true = force dark, false = force light

        function jsonp(url, { callbackParam = 'callback', timeoutMs = 8000 } = {}) {
            return new Promise((resolve, reject) => {
                const callbackName = `__pbJsonpCb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const separator = url.includes('?') ? '&' : '?';
                const script = document.createElement('script');
                let timeoutId;
                let settled = false;

                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    try {
                        delete window[callbackName];
                    } catch (_) {
                        window[callbackName] = undefined;
                    }
                    if (script.parentNode) script.parentNode.removeChild(script);
                };

                window[callbackName] = function(payload) {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(payload);
                };

                script.onerror = function() {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(new Error('JSONP script load failed'));
                };

                timeoutId = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(new Error(`JSONP request timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                script.src = `${url}${separator}${encodeURIComponent(callbackParam)}=${encodeURIComponent(callbackName)}`;
                document.head.appendChild(script);
            });
        }
        
        /**
         * Get user's geographic location using IP-based lookup
         * Falls back to Sacramento, CA if geolocation unavailable (e.g., local file access)
         */
        async function getUserLocation() {
            try {
                const cachedLocation = localStorage.getItem('userLocation');
                if (cachedLocation) {
                    const location = JSON.parse(cachedLocation);
                    const cacheAge = Date.now() - location.timestamp;
                    
                    if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
                        console.log('Using cached location:', location);
                        return {
                            latitude: location.latitude,
                            longitude: location.longitude
                        };
                    }
                }
                
                console.log('Attempting JSONP location lookup via ipapi...');
                const data = await jsonp('https://ipapi.co/jsonp/', { callbackParam: 'callback' });
                
                if (data.latitude && data.longitude) {
                    const location = {
                        latitude: data.latitude,
                        longitude: data.longitude,
                        city: data.city,
                        region: data.region,
                        country: data.country_name,
                        timestamp: Date.now()
                    };
                    
                    localStorage.setItem('userLocation', JSON.stringify(location));
                    console.log('Location detected:', `${location.city}, ${location.region}`);
                    
                    return {
                        latitude: location.latitude,
                        longitude: location.longitude
                    };
                }
                
                throw new Error('Invalid location data');
                
            } catch (error) {
                // Silently fall back to default location (Sacramento, CA)
                // This is expected when running from local file (CORS restriction)
                console.log('Using default location: Sacramento, CA');
                return {
                    latitude: 38.5816,
                    longitude: -121.4944
                };
            }
        }
        
        /**
         * Fetch sunset/sunrise times from API
         */
        async function fetchSunsetTimes(latitude, longitude) {
            try {
                const baseWebAppUrl = (localStorage.getItem('jsonp_proxy_webAppUrl') || localStorage.getItem('spike_webAppUrl') || '').trim();
                if (!baseWebAppUrl) {
                    throw new Error('Missing Apps Script Web App URL. Configure spike_webAppUrl in Settings for file:// JSONP proxy usage.');
                }

                const url = `${baseWebAppUrl}?fn=sun&lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`;
                console.log('Attempting JSONP sunset lookup via Apps Script proxy...');
                const data = await jsonp(url, { callbackParam: 'callback' });
                
                if (data.status !== 'OK') {
                    throw new Error('API returned error status');
                }
                
                const sunset = new Date(data.results.sunset);
                const sunrise = new Date(data.results.sunrise);
                
                sunsetData = {
                    sunset: sunset,
                    sunrise: sunrise,
                    lastFetch: new Date(),
                    latitude: latitude,
                    longitude: longitude
                };
                
                console.log('Sunset data fetched:', {
                    sunrise: sunrise.toLocaleTimeString(),
                    sunset: sunset.toLocaleTimeString(),
                    location: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
                });
                
                return sunsetData;
            } catch (error) {
                console.log('Sunset lookup unavailable; keeping time-based defaults.', (error && error.message) ? error.message : error);
                return null;
            }
        }
        
        /**
         * Check if current time is between sunset and sunrise (nighttime)
         */
        function isNighttime() {
            if (!sunsetData.sunset || !sunsetData.sunrise) {
                return false;
            }
            
            const now = new Date();
            const sunset = new Date(sunsetData.sunset);
            const sunrise = new Date(sunsetData.sunrise);
            
            if (now >= sunset || now < sunrise) {
                return true;
            }
            
            return false;
        }
        
        /**
         * Apply dark mode to all containers with aggressive retry
         */
        function applyDarkMode(isDark) {
            console.log('🎨 Applying dark mode:', isDark);
            
            // Apply to main body
            document.body.classList.toggle('dark-mode', isDark);
            
            // Update toggle
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) toggle.checked = isDark;
            
            // Apply to inventory iframe with multiple methods
            const inventoryIframe = document.getElementById('inventoryFrame');
            if (inventoryIframe) {
                const applyToInventory = (attempt = 1) => {
                    try {
                        // Try direct access first (same-origin)
                        if (inventoryIframe.contentDocument && inventoryIframe.contentDocument.body) {
                            if (isDark) {
                                inventoryIframe.contentDocument.body.classList.add('dark-mode');
                            } else {
                                inventoryIframe.contentDocument.body.classList.remove('dark-mode');
                            }
                            console.log(`✓ Dark mode ${isDark ? 'enabled' : 'disabled'} in Inventory via direct access (attempt ${attempt})`);
                        }
                    } catch (e) {
                        console.log(`⏳ Inventory iframe direct access failed (attempt ${attempt}):`, e.message);
                    }
                    
                    // Also send postMessage (works for both same-origin and cross-origin)
                    try {
                        if (inventoryIframe.contentWindow) {
                            inventoryIframe.contentWindow.postMessage({
                                type: 'darkModeToggle',
                                enabled: isDark
                            }, '*');
                            console.log(`✓ Dark mode message sent to Inventory iframe (attempt ${attempt})`);
                            return true;
                        }
                    } catch (e) {
                        console.log(`⏳ Inventory iframe postMessage failed (attempt ${attempt}):`, e.message);
                    }
                    
                    // Retry up to 5 times
                    if (attempt < 5) {
                        setTimeout(() => applyToInventory(attempt + 1), 500);
                    } else {
                        console.warn('❌ Failed to apply dark mode to Inventory after 5 attempts');
                    }
                    return false;
                };
                
                applyToInventory();
            }
            
            // Apply to overview iframe with multiple methods
            const overviewIframe = document.getElementById('overviewFrame');
            if (overviewIframe) {
                const applyToOverview = (attempt = 1) => {
                    try {
                        // Try direct access first (same-origin)
                        if (overviewIframe.contentDocument && overviewIframe.contentDocument.body) {
                            if (isDark) {
                                overviewIframe.contentDocument.body.classList.add('dark-mode');
                            } else {
                                overviewIframe.contentDocument.body.classList.remove('dark-mode');
                            }
                            console.log(`✓ Dark mode ${isDark ? 'enabled' : 'disabled'} in Overview via direct access (attempt ${attempt})`);
                        }
                    } catch (e) {
                        console.log(`⏳ Overview iframe direct access failed (attempt ${attempt}):`, e.message);
                    }
                    
                    // Also send postMessage (works for both same-origin and cross-origin)
                    try {
                        if (overviewIframe.contentWindow) {
                            overviewIframe.contentWindow.postMessage({
                                type: 'darkModeToggle',
                                enabled: isDark
                            }, '*');
                            console.log(`✓ Dark mode message sent to Overview iframe (attempt ${attempt})`);
                            return true;
                        }
                    } catch (e) {
                        console.log(`⏳ Overview iframe postMessage failed (attempt ${attempt}):`, e.message);
                    }
                    
                    // Retry up to 5 times
                    if (attempt < 5) {
                        setTimeout(() => applyToOverview(attempt + 1), 500);
                    } else {
                        console.warn('❌ Failed to apply dark mode to Overview after 5 attempts');
                    }
                    return false;
                };
                
                applyToOverview();
            }
            
            // Apply to analytics iframe with multiple methods
            const analyticsIframe = document.getElementById('analyticsFrame');
            if (analyticsIframe) {
                const applyToAnalytics = (attempt = 1) => {
                    try {
                        // Try direct access first (same-origin)
                        if (analyticsIframe.contentDocument && analyticsIframe.contentDocument.body) {
                            if (isDark) {
                                analyticsIframe.contentDocument.body.classList.add('dark-mode');
                            } else {
                                analyticsIframe.contentDocument.body.classList.remove('dark-mode');
                            }
                            console.log(`✓ Dark mode ${isDark ? 'enabled' : 'disabled'} in Analytics via direct access (attempt ${attempt})`);
                        }
                    } catch (e) {
                        console.log(`⏳ Analytics iframe direct access failed (attempt ${attempt}):`, e.message);
                    }
                    
                    // Also send postMessage (works for both same-origin and cross-origin)
                    try {
                        if (analyticsIframe.contentWindow) {
                            analyticsIframe.contentWindow.postMessage({
                                type: 'darkModeToggle',
                                enabled: isDark
                            }, '*');
                            console.log(`✓ Dark mode message sent to Analytics iframe (attempt ${attempt})`);
                            return true;
                        }
                    } catch (e) {
                        console.log(`⏳ Analytics iframe postMessage failed (attempt ${attempt}):`, e.message);
                    }
                    
                    // Retry up to 5 times
                    if (attempt < 5) {
                        setTimeout(() => applyToAnalytics(attempt + 1), 500);
                    } else {
                        console.warn('❌ Failed to apply dark mode to Analytics after 5 attempts');
                    }
                    return false;
                };
                
                applyToAnalytics();
            }

            // Apply to stockout iframe (Stock-Out tab)
            const optimizationIframe = document.getElementById('optimizationFrame');
            if (optimizationIframe) {
                const applyToOptimization = (attempt = 1) => {
                    try {
                        if (optimizationIframe.contentDocument && optimizationIframe.contentDocument.body) {
                            if (isDark) optimizationIframe.contentDocument.body.classList.add('dark-mode');
                            else optimizationIframe.contentDocument.body.classList.remove('dark-mode');
                        }
                    } catch (e) {}
                    try {
                        if (optimizationIframe.contentWindow) {
                            optimizationIframe.contentWindow.postMessage({ type: 'darkModeToggle', enabled: isDark }, '*');
                            return true;
                        }
                    } catch (e) {}
                    if (attempt < 3) setTimeout(() => applyToOptimization(attempt + 1), 400);
                    return false;
                };
                applyToOptimization();
            }

        }
        
        /**
         * Update dark mode based on sunset/sunrise (automatic mode)
         */
        function updateDarkModeBasedOnTime() {
            // If user has manually overridden, don't auto-update
            if (darkModeOverride !== null) {
                console.log('Dark mode override active, skipping auto-update');
                return;
            }
            
            const isDark = isNighttime();
            const currentlyDark = document.body.classList.contains('dark-mode');
            
            if (isDark !== currentlyDark) {
                applyDarkMode(isDark);
                console.log(isDark ? '🌙 Dark mode activated (nighttime)' : '☀️ Light mode activated (daytime)');
            }
        }
        
        /**
         * Toggle dark mode manually (user override)
         */
        function toggleDarkMode() {
            const toggle = document.getElementById('darkModeToggle');
            const isDark = toggle.checked;
            
            // Set override
            darkModeOverride = isDark;
            localStorage.setItem('darkModeOverride', isDark);
            
            applyDarkMode(isDark);
            console.log('Dark mode manually set to:', isDark);
        }
        
        /**
         * Initialize sunset-based dark mode system
         */
        async function initSunsetDarkMode() {
            try {
                console.log('Initializing sunset-based dark mode...');
                
                // Check for manual override first
                const savedOverride = localStorage.getItem('darkModeOverride');
                if (savedOverride !== null) {
                    darkModeOverride = savedOverride === 'true';
                    applyDarkMode(darkModeOverride);
                    console.log('Dark mode override loaded:', darkModeOverride);
                }
                
                // Get user location
                const location = await getUserLocation();
                
                // Fetch sunset times
                await fetchSunsetTimes(location.latitude, location.longitude);
                
                // If no manual override, apply automatic mode
                if (darkModeOverride === null) {
                    updateDarkModeBasedOnTime();
                }
                
                // Check every minute if we should toggle dark mode
                setInterval(updateDarkModeBasedOnTime, 60000);
                
                // Refresh sunset data once per day (at 2 AM)
                setInterval(async () => {
                    const now = new Date();
                    if (now.getHours() === 2 && now.getMinutes() === 0) {
                        console.log('Refreshing sunset data...');
                        await fetchSunsetTimes(location.latitude, location.longitude);
                    }
                }, 60000);
                
                console.log('✓ Sunset-based dark mode initialized successfully');
            } catch (error) {
                console.error('Failed to initialize sunset dark mode:', error);
            }
        }
        
        /**
         * Get sunset info for debugging
         */
        function getSunsetInfo() {
            if (!sunsetData.sunset) {
                return 'Sunset data not loaded yet';
            }
            
            const cachedLocation = localStorage.getItem('userLocation');
            let locationInfo = 'Location cache: None';
            
            if (cachedLocation) {
                const loc = JSON.parse(cachedLocation);
                const age = Math.floor((Date.now() - loc.timestamp) / (1000 * 60 * 60 * 24));
                locationInfo = `${loc.city}, ${loc.region} (cached ${age} days ago)`;
            }
            
            return {
                location: `${sunsetData.latitude?.toFixed(4)}, ${sunsetData.longitude?.toFixed(4)}`,
                locationCache: locationInfo,
                sunrise: sunsetData.sunrise.toLocaleString(),
                sunset: sunsetData.sunset.toLocaleString(),
                lastFetch: sunsetData.lastFetch.toLocaleString(),
                isNighttime: isNighttime(),
                override: darkModeOverride,
                currentTime: new Date().toLocaleString()
            };
        }
        
        /**
         * Clear cached location
         */
        function clearLocationCache() {
            localStorage.removeItem('userLocation');
            console.log('✓ Location cache cleared. Refresh page to detect location again.');
        }
        
        /**
         * Reset dark mode to automatic (remove override)
         */
        function resetDarkModeToAuto() {
            darkModeOverride = null;
            localStorage.removeItem('darkModeOverride');
            updateDarkModeBasedOnTime();
            console.log('✓ Dark mode reset to automatic (sunset-based)');
        }
        
        // ============= END SUNSET-BASED DARK MODE SYSTEM =============

        
function _isLogEnabled(section) {
    try {
        return localStorage.getItem(`log_${section}`) !== '0';
    } catch (_) {
        return true;
    }
}

function _sectionLog(section, ...args) {
    if (_isLogEnabled(section)) console.log(...args);
}

function _initLogToggles() {
    const map = {
        dashboard: 'logToggleDashboard',
        analytics: 'logToggleAnalytics',
        charts: 'logToggleCharts',
        spike: 'logToggleSpike'
    };
    Object.keys(map).forEach((k) => {
        const el = document.getElementById(map[k]);
        if (!el) return;
        el.checked = _isLogEnabled(k);
        el.addEventListener('change', () => {
            try { localStorage.setItem(`log_${k}`, el.checked ? '1' : '0'); } catch (_) {}
        });
    });
}

function _initSettingsCardCollapse() {
    const cards = document.querySelectorAll('#settingsModal .usage-params-card');
    cards.forEach((card, idx) => {
        const title = card.querySelector('.usage-params-title');
        if (!title || title.dataset.collapseBound) return;
        title.dataset.collapseBound = '1';
        if (idx > 0) card.classList.add('is-collapsed');
        title.addEventListener('click', () => {
            card.classList.toggle('is-collapsed');
        });
    });
}

// Settings Modal Functions
        function openSettings() {
            document.getElementById('settingsModal').classList.add('active');
            _initLogToggles();
            _initSettingsCardCollapse();

            // Load Google Sheets admin config (for spike-factor cache) into inputs
            try {
                const apiKey = localStorage.getItem('gs_apiKey') || '';
                const clientId = localStorage.getItem('gs_clientId') || '';
                const sheetId = localStorage.getItem('gs_sheetId') || '';
                const tabName = localStorage.getItem('gs_tabName') || 'min_spike_factors';

                const apiEl = document.getElementById('gsApiKeyInput');
                const cidEl = document.getElementById('gsClientIdInput');
                const sidEl = document.getElementById('gsSheetIdInput');
                const tabEl = document.getElementById('gsTabNameInput');

                if (apiEl) apiEl.value = apiKey;
                if (cidEl) cidEl.value = clientId;
                if (sidEl) sidEl.value = sheetId;
                if (tabEl) tabEl.value = tabName;

                // Update runtime config for SpikeFactors (no auth yet)
                if (window.SpikeFactors && typeof window.SpikeFactors.setConfig === 'function') {
                    window.SpikeFactors.setConfig({
                        apiKey,
                        clientId,
                        spreadsheetId: sheetId,
                        tabName,
                    });
                }

                const status = document.getElementById('spikeFactorsStatus');
                if (status) {
                    const cached = localStorage.getItem('__spikeFactorCache');
                    status.textContent = cached ? 'Cached (local)' : 'Not loaded';
                }
            } catch (_) {}
        
            // Load Apps Script spike-factor cache config (no OAuth required)
            try {
                const webAppUrl = localStorage.getItem('spike_webAppUrl') || '';
                const sheetId2 = localStorage.getItem('spike_sheetId') || (localStorage.getItem('gs_sheetId') || '');
                const tabName2 = localStorage.getItem('spike_tabName') || 'min_spike_factors';

                const tabEl2 = document.getElementById('spikeTabName');

                const urlEl = document.getElementById('spikeWebAppUrl');
                const sidEl2 = document.getElementById('spikeSheetId');

                if (urlEl) urlEl.value = webAppUrl;
                __setSpikeBridgeFrameSrc(webAppUrl);
                if (sidEl2) sidEl2.value = sheetId2;
                if (tabEl2) tabEl2.value = tabName2;

                const st = document.getElementById('spikeAdminStatusText');
                if (st) {
                    if (!(webAppUrl && sheetId2)) {
                        st.textContent = 'Not configured';
                    } else {
                        // If we already have a cached factor table, surface counts immediately.
                        try {
                            if (window.SpikeFactors && window.SpikeFactors.getCacheSummary) {
                                const s = window.SpikeFactors.getCacheSummary();
                                if ((s.pocket + s.item + s.subloc) > 0) {
                                    const when = s.loadedAt ? new Date(s.loadedAt).toLocaleString() : 'unknown';
                                    st.textContent = `Cached: pocket=${s.pocket}, item=${s.item}, subloc=${s.subloc} (${when})`;
                                } else {
                                    st.textContent = 'Ready (no cache loaded)';
                                }
                            } else {
                                st.textContent = 'Ready';
                            }
                        } catch (_) {
                            st.textContent = 'Ready';
                        }
                    }
                }
            } catch (e) {}

        }

        function closeSettings() {
            document.getElementById('settingsModal').classList.remove('active');
        }

        function __readAndPersistGsConfigFromInputs() {
            const apiKey = (document.getElementById('gsApiKeyInput')?.value || '').trim();
            const clientId = (document.getElementById('gsClientIdInput')?.value || '').trim();
            const sheetId = (document.getElementById('gsSheetIdInput')?.value || '').trim();
            const tabName = (document.getElementById('gsTabNameInput')?.value || 'min_spike_factors').trim() || 'min_spike_factors';

            localStorage.setItem('gs_apiKey', apiKey);
            localStorage.setItem('gs_clientId', clientId);
            localStorage.setItem('gs_sheetId', sheetId);
            localStorage.setItem('gs_tabName', tabName);

            if (window.SpikeFactors && typeof window.SpikeFactors.setConfig === 'function') {
                window.SpikeFactors.setConfig({
                    apiKey,
                    clientId,
                    spreadsheetId: sheetId,
                    tabName,
                });
            }

            return { apiKey, clientId, sheetId, tabName };
        }


        
function __setSpikeBridgeFrameSrc(execUrl){
    // Apps Script Web Apps send X-Frame-Options: SAMEORIGIN which blocks embedding in iframes.
    // Keep as a no-op to avoid console spam; verification uses JSONP read instead.
    const frame = document.getElementById('spikeBridgeFrame');
    if(!frame) return;
    frame.removeAttribute('src');
}

function __readAndPersistSpikeWebAppConfigFromInputs() {
            const webAppUrl = (document.getElementById('spikeWebAppUrl')?.value || '').trim();
            const sheetId = (document.getElementById('spikeSheetId')?.value || '').trim();
            const tabName = (document.getElementById('spikeTabName')?.value || 'min_spike_factors').trim() || 'min_spike_factors';

            localStorage.setItem('spike_webAppUrl', webAppUrl);
            localStorage.setItem('spike_sheetId', sheetId);
            localStorage.setItem('spike_tabName', tabName);

            __setSpikeBridgeFrameSrc(webAppUrl);

            return { webAppUrl, sheetId, tabName };
        }
        async function adminLoadSpikeFactorsFromSheet() {
            const statusEl = document.getElementById('spikeAdminStatusText') || document.getElementById('spikeFactorsStatus');
            try {
                if (!window.SpikeFactors) {
                    alert('SpikeFactors module not loaded.');
                    return;
                }

                // Prefer Apps Script Web App (no OAuth) if configured
                const wcfg = __readAndPersistSpikeWebAppConfigFromInputs();
                if (wcfg.webAppUrl && wcfg.sheetId) {
                    if (statusEl) statusEl.textContent = 'Loading…';
                    const cache = await window.SpikeFactors.loadFromWebApp(wcfg.webAppUrl, wcfg.sheetId, wcfg.tabName);
                    const pocketN = cache && cache.pocketMap ? Object.keys(cache.pocketMap).length : 0;
                    const itemN = cache && cache.itemMap ? Object.keys(cache.itemMap).length : 0;
                    const subN = cache && cache.sublocMap ? Object.keys(cache.sublocMap).length : 0;
                    const when = (cache && cache.meta && cache.meta.loadedAt) ? new Date(cache.meta.loadedAt).toLocaleString() : '';
                    if (statusEl) statusEl.textContent = `Cached: pocket=${pocketN}, item=${itemN}, subloc=${subN}${when ? ' (' + when + ')' : ''}`;
                    console.log('✅ Loaded spike factors via Web App', { pocketN, itemN, subN });
                    return;
                }

                // Fallback: direct Sheets API (OAuth)
                const cfg = __readAndPersistGsConfigFromInputs();
                if (!cfg.apiKey || !cfg.clientId || !cfg.sheetId) {
                    alert(
                        'Missing Web App config (preferred) and missing Google OAuth config.\n\n' +
                        'To use the Web App method, fill in Apps Script Web App URL + Spreadsheet ID.'
                    );
                    return;
                }
                if (statusEl) statusEl.textContent = 'Loading…';
                const cache = await window.SpikeFactors.loadSpikeFactorsFromSheet();
                const pocketN = cache && cache.pocketMap ? Object.keys(cache.pocketMap).length : 0;
                const itemN = cache && cache.itemMap ? Object.keys(cache.itemMap).length : 0;
                const subN = cache && cache.sublocMap ? Object.keys(cache.sublocMap).length : 0;
                if (statusEl) statusEl.textContent = `Loaded (pocket ${pocketN}, item ${itemN}, subloc ${subN})`;
                console.log('✅ Loaded spike factors from sheet (OAuth)', { pocketN, itemN, subN });
            } catch (e) {
                console.error('❌ Failed to load spike factors', e);
                if (statusEl) statusEl.textContent = 'Load failed';
                alert('Failed to load spike factors. Check console for details.');
            }
        }

        
        async function adminComputeAndSaveSpikeFactors() {
            const statusEl = document.getElementById('spikeAdminStatusText') || document.getElementById('spikeFactorsStatus');
            try {
                if (!window.SpikeFactors) {
                    alert('SpikeFactors module not loaded.');
                    return;
                }

                // Transactions source: prefer raw/processed store, then canonical cached store, then MOCK_DATA
                const txAny = (typeof cachedRawData !== 'undefined' && cachedRawData && cachedRawData.transactions)
                    ? cachedRawData.transactions
                    : (window.cachedMockData && window.cachedMockData.transactions)
                        ? window.cachedMockData.transactions
                        : (window.costChartState && window.costChartState.cachedMockData && window.costChartState.cachedMockData.transactions)
                            ? window.costChartState.cachedMockData.transactions
                            : (typeof MOCK_DATA !== 'undefined' && MOCK_DATA && MOCK_DATA.transactions)
                                ? MOCK_DATA.transactions
                                : null;

                const txFlat = window.SpikeFactors.flattenTransactions(txAny);
                if (!txFlat.length) {
                    alert('No transactions found. Spike factors require transaction history.');
                    if (statusEl) statusEl.textContent = 'No transactions';
                    return;
                }

                // Anchor endDate to max tx date
                let maxISO = null;
                for (const t of txFlat) {
                    const d = window.SpikeFactors.getTxDateISO(t);
                    if (!d) continue;
                    if (!maxISO || new Date(d) > new Date(maxISO)) maxISO = d;
                }
                if (!maxISO) maxISO = new Date().toISOString();

                if (statusEl) statusEl.textContent = 'Computing…';
                const { allRows, counts, computedOn } = window.SpikeFactors.computeSpikeFactorTable({
                    transactions: txAny,
                    endDateISO: maxISO,
                });

                // Prefer Apps Script Web App (no OAuth) if configured
                const wcfg = __readAndPersistSpikeWebAppConfigFromInputs();
                if (wcfg.webAppUrl && wcfg.sheetId) {
                    if (statusEl) statusEl.textContent = `Saving… (rows ${allRows.length})`;
                    await window.SpikeFactors.saveToWebApp(wcfg.webAppUrl, wcfg.sheetId, wcfg.tabName, allRows);
                    if (statusEl) statusEl.textContent = 'Refreshing cache…';
                    await window.SpikeFactors.loadFromWebApp(wcfg.webAppUrl, wcfg.sheetId, wcfg.tabName);

                    if (statusEl) statusEl.textContent = `Saved ${allRows.length} (p${counts.pocket}/i${counts.item}/s${counts.subloc}) @ ${String(computedOn || '').slice(0, 10)}`;
                    alert(`Saved spike factors to Google Sheet (via Web App).
Pocket: ${counts.pocket}
Item: ${counts.item}
Subloc: ${counts.subloc}`);
                    return;
                }

                // Fallback: direct Sheets API (OAuth)
                const cfg = __readAndPersistGsConfigFromInputs();
                if (!cfg.apiKey || !cfg.clientId || !cfg.sheetId) {
                    alert(
                        'Missing Web App config (preferred) and missing Google OAuth config.\n\n' +
                        'To use the Web App method, fill in Apps Script Web App URL + Spreadsheet ID.'
                    );
                    if (statusEl) statusEl.textContent = 'Not configured';
                    return;
                }

                if (statusEl) statusEl.textContent = `Saving… (rows ${allRows.length})`;
                await window.SpikeFactors.writeSpikeFactorsToSheet(allRows);
                await window.SpikeFactors.loadSpikeFactorsFromSheet();

                if (statusEl) statusEl.textContent = `Saved ${allRows.length} (p${counts.pocket}/i${counts.item}/s${counts.subloc}) @ ${String(computedOn || '').slice(0, 10)}`;
                alert(`Saved spike factors to Google Sheet (OAuth).
Pocket: ${counts.pocket}
Item: ${counts.item}
Subloc: ${counts.subloc}`);
            } catch (e) {
                console.error('❌ Failed to compute/save spike factors', e);
                if (statusEl) statusEl.textContent = 'Save failed';
                alert('Failed to compute/save spike factors. Check console for details.');
            }
        }


        function toggleExcludeStandard() {
            const toggle = document.getElementById('excludeStandardToggle');
            const excludeStandard = toggle.checked;
            
            // Save to localStorage
            localStorage.setItem('excludeStandardInventory', excludeStandard ? 'true' : 'false');
            
            console.log('⚙️ Exclude Standard Inventory:', excludeStandard ? 'ON' : 'OFF');
            
            // Clear cached data to force recalculation
            cachedProcessedData = null;
            
            // Recalculate and update all displays
            recalculateUsageRates();
            
            console.log('✓ Settings updated, data recalculated');
        }

        // Usage Calculation Parameter Functions
        function calculatePercentile(sortedArray, percentile) {
            if (sortedArray.length === 0) return 0;
            const index = (percentile / 100) * (sortedArray.length - 1);
            const lower = Math.floor(index);
            const upper = Math.ceil(index);
            const weight = index - lower;
            
            if (lower === upper) {
                return sortedArray[lower];
            }
            return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
        }

        function updatePercentileCutoffValue(value) {
            const suffix = value == 1 ? 'st' : value == 2 ? 'nd' : value == 3 ? 'rd' : 'th';
            document.getElementById('percentileCutoffValue').textContent = value + suffix;
            localStorage.setItem('usagePercentileCutoff', value);
        }

        function updateTrendThresholdValue(value) {
            const weeks = value == 1 ? 'week' : 'weeks';
            document.getElementById('trendThresholdValue').textContent = value + ' ' + weeks;
            localStorage.setItem('consecutiveWeekThreshold', value);
            
            // Recalculate trending items (only if function is defined and MOCK_DATA exists)
            if (typeof calculateTrendingItems === 'function' && 
                typeof MOCK_DATA !== 'undefined' && 
                MOCK_DATA && 
                MOCK_DATA.items && 
                MOCK_DATA.items.length > 0) {
                const recomputed = calculateTrendingItems();
                Promise.resolve()
                    .then(() => saveTrendFactsRun({ trendResult: recomputed }))
                    .then(() => appendTrendFactsRun({ trendResult: recomputed }))
                    .catch(() => {})
                    .then(() => loadLatestTrendFactsFromSheet())
                    .then(() => { if (typeof sendTrendingItemsToPages === 'function') sendTrendingItemsToPages(); })
                    .catch(() => {});
            } else {
                console.log('⏳ Trending calculation will happen after data and functions load');
            }
        }

        function updateBarGraph() {
            // Get data from input
            const inputText = document.getElementById('testDataInput').value;
            const values = inputText.split(/[\s,]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
            
            if (values.length === 0) {
                document.getElementById('barGraphContainer').innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">Enter values to see visualization</div>';
                return;
            }
            
            // Get percentile cutoff
            const percentile = parseFloat(document.getElementById('percentileCutoffSlider').value);
            
            // Calculate threshold
            const sorted = [...values].sort((a, b) => a - b);
            const threshold = calculatePercentile(sorted, percentile);
            
            // Determine which values are filtered
            const filtered = values.map(v => v < threshold);
            const keptValues = values.filter(v => v >= threshold);
            
            // Calculate statistics
            const originalAvg = values.reduce((a, b) => a + b, 0) / values.length;
            const newAvg = keptValues.length > 0 ? keptValues.reduce((a, b) => a + b, 0) / keptValues.length : 0;
            const filteredCount = values.length - keptValues.length;
            
            // Update stats
            document.getElementById('originalAvg').textContent = originalAvg.toFixed(2);
            document.getElementById('newAvg').textContent = newAvg.toFixed(2);
            document.getElementById('filteredCount').textContent = filteredCount;
            document.getElementById('thresholdValue').textContent = threshold.toFixed(2);
            
            // Find max value for scaling
            const maxValue = Math.max(...values);
            
            // Generate bar graph HTML
            const barsHTML = values.map((value, index) => {
                const heightPercent = (value / maxValue) * 100;
                const isFiltered = filtered[index];
                return `
                    <div class="bar ${isFiltered ? 'filtered' : ''}">
                        <div class="bar-value">${value}</div>
                        <div class="bar-column" style="height: ${Math.max(heightPercent, 10)}px;"></div>
                        <div class="bar-label">#${index + 1}</div>
                    </div>
                `;
            }).join('');
            
            document.getElementById('barGraphContainer').innerHTML = barsHTML;
        }

        function recalculateUsageRates() {
            console.log('🔄 Recalculating usage rates with new parameters...');
            
            // Get current parameter values
            const percentileCutoff = parseFloat(localStorage.getItem('usagePercentileCutoff') || '25');
            
            console.log('📊 New parameters:', {
                percentileCutoff: percentileCutoff + 'th percentile'
            });
            
            // Clear the cached data to force recalculation
            cachedProcessedData = null;
            
            // Close settings modal
            closeSettings();
            
            // Reload the page to apply new calculations
            console.log('♻️ Reloading page with new parameters...');
            location.reload();
        }

        // Update threshold line value display
        function updateThresholdLineValue(value) {
            const displayValue = parseFloat(value).toFixed(2);
            document.getElementById('thresholdLineValue').textContent = displayValue;
        }

        // Update Pyxis restock frequency (restocks per day) display
        function updatePyxisRestockFreqValue(value) {
            const v = parseFloat(value);
            const displayValue = (Number.isFinite(v) ? v : 1).toFixed(2);
            const el = document.getElementById('pyxisRestockFreqValue');
            if (el) el.textContent = displayValue;
        }

        function updateBudPeriodValue(value) {
            const displayValue = parseInt(value);
            document.getElementById('budPeriodValue').textContent = displayValue;
        }

        // Update expiring window (months) display
        function updateExpiringMonthsValue(value) {
            const displayValue = parseInt(value, 10);
            const el = document.getElementById('expiringMonthsValue');
            if (el) el.textContent = displayValue;
        }

        // Optimization setting: IUR Trend Weight (w)
        function updateIurTrendWeightValue(value) {
            const v = parseFloat(value);
            const el = document.getElementById('iurTrendWeightValue');
            if (el) el.textContent = (Number.isFinite(v) ? v.toFixed(2) : '2.00');
        }

        // ---------------------------
        // What-if (Optimization) controls
        // ---------------------------

        function updateLeadTimeMultiplierValue(value) {
            const v = parseFloat(value);
            const el = document.getElementById('leadTimeMultiplierValue');
            if (el) el.textContent = (Number.isFinite(v) ? v.toFixed(2) : '1.00') + '×';
        }

        function updateLeadTimeAddDaysValue(value) {
            const v = parseFloat(value);
            const el = document.getElementById('leadTimeAddDaysValue');
            if (el) el.textContent = (Number.isFinite(v) ? ((v >= 0 ? '+' : '') + v.toFixed(1)) : '+0.0');
        }

        function updateSurgeMultiplierValue(value) {
            const v = parseFloat(value);
            const el = document.getElementById('surgeMultiplierValue');
            if (el) el.textContent = (Number.isFinite(v) ? v.toFixed(2) : '1.00') + '×';
        }

        function updateReviewPeriodDaysValue(value) {
            const v = parseInt(value, 10);
            const el = document.getElementById('reviewPeriodDaysValue');
            if (el) el.textContent = (Number.isFinite(v) ? String(v) : '1');
        }

        function setServiceLevelPreset(preset) {
            const hidden = document.getElementById('serviceLevelPresetHidden');
            const label = document.getElementById('serviceLevelPresetValue');
            if (hidden) hidden.value = preset;
            if (label) label.textContent = (preset === '975' ? '97.5' : preset) + '%';
            // Optional visual selection (best-effort)
            try {
                const card = label?.closest('.slider-control');
                if (card) {
                    card.querySelectorAll('button.recalculate-btn').forEach(btn => {
                        const t = (btn.textContent || '').replace('%','').trim();
                        const is975 = (t === '97.5');
                        const matches = (preset === '975' ? is975 : (t === preset));
                        btn.style.opacity = matches ? '1' : '0.55';
                    });
                }
            } catch(_) {}
        }

        function _getLogSettingsFromUI() {
            const val = (id, key) => {
                const el = document.getElementById(id);
                const enabled = !!(el && el.checked);
                try { localStorage.setItem(`log_${key}`, enabled ? '1' : '0'); } catch (_) {}
                return enabled;
            };
            return {
                logDashboard: val('logToggleDashboard', 'dashboard'),
                logAnalytics: val('logToggleAnalytics', 'analytics'),
                logCharts: val('logToggleCharts', 'charts'),
                logSpike: val('logToggleSpike', 'spike')
            };
        }

        // New unified apply function for all settings
        function applyAllSettings() {
            console.log('⚙️ Applying all settings...');
            const logSettings = _getLogSettingsFromUI();
            
            // Get threshold value
            const thresholdValue = parseFloat(document.getElementById('thresholdLineSlider').value);
            
            // Get Shelf Life value
            const shelfLife = parseInt(document.getElementById('budPeriodSlider').value);

            // Get Pyxis restock frequency (restocks per day)
            const pyxisRestockFreq = parseFloat(document.getElementById('pyxisRestockFreqSlider')?.value || '1');

            // IUR Trend Weight (w)
            const iurTrendWeightW = parseFloat(document.getElementById('iurTrendWeightSlider')?.value || '2');

            // What-if (Optimization)
            const leadTimeMultiplier = parseFloat(document.getElementById('leadTimeMultiplierSlider')?.value || '1');
            const leadTimeAddDays = parseFloat(document.getElementById('leadTimeAddDaysSlider')?.value || '0');
            const surgeMultiplier = parseFloat(document.getElementById('surgeMultiplierSlider')?.value || '1');
            const reviewPeriodDays = parseInt(document.getElementById('reviewPeriodDaysSlider')?.value || '1', 10);
            const serviceLevelPreset = (document.getElementById('serviceLevelPresetHidden')?.value || '95');
            const whatIfHorizonDays = parseInt(document.getElementById('whatIfHorizonSelect')?.value || '14', 10);
            const applyLeadTimeTo = (document.getElementById('applyLeadTimeToSelect')?.value || 'ALL');


            // Get expiring window months
            const expiringMonths = parseInt(document.getElementById('expiringMonthsSlider')?.value || '3', 10);
            
            // Save to localStorage
            localStorage.setItem('usageRestockThreshold', thresholdValue);
            localStorage.setItem('budPeriod', shelfLife);
            localStorage.setItem('pyxisRestockFreqPerDay', String(Number.isFinite(pyxisRestockFreq) ? pyxisRestockFreq : 1));
            localStorage.setItem('iurTrendWeightW', String(Number.isFinite(iurTrendWeightW) ? iurTrendWeightW : 2));
            localStorage.setItem('expiringMonths', expiringMonths);

            // What-if (Optimization)
            localStorage.setItem('whatIfLeadTimeMultiplier', String(Number.isFinite(leadTimeMultiplier) ? leadTimeMultiplier : 1));
            localStorage.setItem('whatIfLeadTimeAddDays', String(Number.isFinite(leadTimeAddDays) ? leadTimeAddDays : 0));
            localStorage.setItem('whatIfSurgeMultiplier', String(Number.isFinite(surgeMultiplier) ? surgeMultiplier : 1));
            localStorage.setItem('whatIfReviewPeriodDays', String(Number.isFinite(reviewPeriodDays) ? reviewPeriodDays : 1));
            localStorage.setItem('whatIfServiceLevelPreset', String(serviceLevelPreset || '95'));
            localStorage.setItem('whatIfHorizonDays', String(Number.isFinite(whatIfHorizonDays) ? whatIfHorizonDays : 14));
            localStorage.setItem('whatIfApplyLeadTimeTo', String(applyLeadTimeTo || 'ALL'));

            // (avoid writing duplicate keys)
            
            console.log('✓ Threshold saved:', thresholdValue);
            console.log('✓ Shelf Life saved:', shelfLife, 'weeks');
            console.log('✓ Expiring window saved:', expiringMonths, 'months');
            console.log('✓ Pyxis restock frequency saved:', pyxisRestockFreq, 'restocks/day');
            console.log('✓ IUR trend weight saved:', iurTrendWeightW);
            
            // IMPORTANT: Clear cached processed data to force recalculation with new Shelf Life
            cachedProcessedData = null;
            console.log('🔄 Cleared cached data - will recalculate with new Shelf Life');
            
            // Recalculate data with new settings
            const updatedData = getProcessedMockData();
            console.log('✅ Data recalculated with new Shelf Life:', updatedData.projectedWaste);
            
            // Send updated data and settings to Analytics iframe
            const analyticsFrame = document.getElementById('analyticsFrame');
            if (analyticsFrame && analyticsFrame.contentWindow) {
                analyticsFrame.contentWindow.postMessage({
                    type: 'updateSettings',
                    settings: {
                        usageRestockThreshold: thresholdValue,
                        budPeriod: shelfLife,
                        expiringMonths: expiringMonths,
                        pyxisRestockFreqPerDay: (Number.isFinite(pyxisRestockFreq) ? pyxisRestockFreq : 1),
                        iurTrendWeightW: (Number.isFinite(iurTrendWeightW) ? iurTrendWeightW : 2)
                    },
                    projectedWaste: updatedData.projectedWaste,
                    pyxisProjectedWaste: updatedData.pyxisProjectedWaste,
                    usageVsRestock: updatedData.usageVsRestock,
                    pyxisMetrics: updatedData.pyxisMetrics
                }, '*');
                console.log('✓ Sent updated settings and all metrics to Analytics');
            }
            
            // Send settings to Charts iframe  
            const chartsFrame = document.getElementById('chartsFrame');
            if (chartsFrame && chartsFrame.contentWindow) {
                chartsFrame.contentWindow.postMessage({
                    type: 'updateSettings',
                    settings: {
                        usageRestockThreshold: thresholdValue,
                        budPeriod: shelfLife,
                        expiringMonths: expiringMonths,
                        pyxisRestockFreqPerDay: (Number.isFinite(pyxisRestockFreq) ? pyxisRestockFreq : 1),
                        iurTrendWeightW: (Number.isFinite(iurTrendWeightW) ? iurTrendWeightW : 2)
                    }
                }, '*');
                console.log('✓ Sent settings to Charts');
            }

            // Send settings to Optimization iframe
            const optimizationFrame = document.getElementById('optimizationFrame');
            if (optimizationFrame && optimizationFrame.contentWindow) {
                optimizationFrame.contentWindow.postMessage({
                    type: 'updateSettings',
                    settings: {
                        pyxisRestockFreqPerDay: (Number.isFinite(pyxisRestockFreq) ? pyxisRestockFreq : 1),
                        iurTrendWeightW: (Number.isFinite(iurTrendWeightW) ? iurTrendWeightW : 2),

                        // What-if (Optimization)
                        whatIfLeadTimeMultiplier: (Number.isFinite(leadTimeMultiplier) ? leadTimeMultiplier : 1),
                        whatIfLeadTimeAddDays: (Number.isFinite(leadTimeAddDays) ? leadTimeAddDays : 0),
                        whatIfSurgeMultiplier: (Number.isFinite(surgeMultiplier) ? surgeMultiplier : 1),
                        whatIfReviewPeriodDays: (Number.isFinite(reviewPeriodDays) ? reviewPeriodDays : 1),
                        whatIfServiceLevelPreset: (serviceLevelPreset || '95'),
                        whatIfHorizonDays: (Number.isFinite(whatIfHorizonDays) ? whatIfHorizonDays : 14),
                        whatIfApplyLeadTimeTo: (applyLeadTimeTo || 'ALL')
                    }
                }, '*');
                console.log('✓ Sent settings to Optimization');
            }
            
            // Also call the original recalculate function for usage rates
            recalculateUsageRates();
        }

        // Initialize slider values from localStorage on page load
        function initializeUsageParams() {
            const percentileCutoff = parseFloat(localStorage.getItem('usagePercentileCutoff') || '25');
            const thresholdValue = parseFloat(localStorage.getItem('usageRestockThreshold') || '0.5');
            const budPeriod = parseInt(localStorage.getItem('budPeriod') || '52');
            const expiringMonths = parseInt(localStorage.getItem('expiringMonths') || '3', 10);
            const pyxisRestockFreq = parseFloat(localStorage.getItem('pyxisRestockFreqPerDay') || '1');
            const iurTrendWeightW = parseFloat(localStorage.getItem('iurTrendWeightW') || '2');

            // What-if (Optimization)
            const whatIfLeadTimeMultiplier = parseFloat(localStorage.getItem('whatIfLeadTimeMultiplier') || '1');
            const whatIfLeadTimeAddDays = parseFloat(localStorage.getItem('whatIfLeadTimeAddDays') || '0');
            const whatIfSurgeMultiplier = parseFloat(localStorage.getItem('whatIfSurgeMultiplier') || '1');
            const whatIfReviewPeriodDays = parseInt(localStorage.getItem('whatIfReviewPeriodDays') || '1', 10);
            const whatIfServiceLevelPreset = (localStorage.getItem('whatIfServiceLevelPreset') || '95');
            const whatIfHorizonDays = parseInt(localStorage.getItem('whatIfHorizonDays') || '14', 10);
            const whatIfApplyLeadTimeTo = (localStorage.getItem('whatIfApplyLeadTimeTo') || 'ALL');

            const excludeStandard = localStorage.getItem('excludeStandardInventory') === 'true';
            const trendThreshold = parseInt(localStorage.getItem('consecutiveWeekThreshold') || '2');
            
            // Set trend threshold slider value
            const trendSlider = document.getElementById('trendThresholdSlider');
            if (trendSlider) {
                trendSlider.value = trendThreshold;
                updateTrendThresholdValue(trendThreshold);
            }
            
            // Set percentile slider value
            const percentileSlider = document.getElementById('percentileCutoffSlider');
            
            if (percentileSlider) {
                percentileSlider.value = percentileCutoff;
                updatePercentileCutoffValue(percentileCutoff);
            }
            
            // Set exclude standard toggle
            const excludeToggle = document.getElementById('excludeStandardToggle');
            if (excludeToggle) {
                excludeToggle.checked = excludeStandard;
            }
            
            // Set threshold slider value
            const thresholdSlider = document.getElementById('thresholdLineSlider');
            if (thresholdSlider) {
                thresholdSlider.value = thresholdValue;
                updateThresholdLineValue(thresholdValue);
            }

            // Set Pyxis restock frequency slider value
            const pyxisFreqSlider = document.getElementById('pyxisRestockFreqSlider');
            if (pyxisFreqSlider) {
                pyxisFreqSlider.value = pyxisRestockFreq;
                updatePyxisRestockFreqValue(pyxisRestockFreq);
            }

            // Set IUR trend weight slider value
            const iurWSlider = document.getElementById('iurTrendWeightSlider');
            if (iurWSlider) {
                iurWSlider.value = iurTrendWeightW;
                updateIurTrendWeightValue(iurTrendWeightW);

            // Set What-if sliders/selects
            const ltMultSlider = document.getElementById('leadTimeMultiplierSlider');
            if (ltMultSlider) {
                ltMultSlider.value = whatIfLeadTimeMultiplier;
                updateLeadTimeMultiplierValue(whatIfLeadTimeMultiplier);
            }

            const ltAddSlider = document.getElementById('leadTimeAddDaysSlider');
            if (ltAddSlider) {
                ltAddSlider.value = whatIfLeadTimeAddDays;
                updateLeadTimeAddDaysValue(whatIfLeadTimeAddDays);
            }

            const surgeSlider = document.getElementById('surgeMultiplierSlider');
            if (surgeSlider) {
                surgeSlider.value = whatIfSurgeMultiplier;
                updateSurgeMultiplierValue(whatIfSurgeMultiplier);
            }

            const reviewSlider = document.getElementById('reviewPeriodDaysSlider');
            if (reviewSlider) {
                reviewSlider.value = whatIfReviewPeriodDays;
                updateReviewPeriodDaysValue(whatIfReviewPeriodDays);
            }

            const horizonSel = document.getElementById('whatIfHorizonSelect');
            if (horizonSel) horizonSel.value = String(whatIfHorizonDays);

            const applySel = document.getElementById('applyLeadTimeToSelect');
            if (applySel) applySel.value = whatIfApplyLeadTimeTo;

            // Service level preset buttons
            setServiceLevelPreset(whatIfServiceLevelPreset);

            }
            
            // Set BUD Period slider value
            const budPeriodSlider = document.getElementById('budPeriodSlider');
            if (budPeriodSlider) {
                budPeriodSlider.value = budPeriod;
                updateBudPeriodValue(budPeriod);
            }

            // Set expiring months slider value
            const expiringMonthsSlider = document.getElementById('expiringMonthsSlider');
            if (expiringMonthsSlider) {
                expiringMonthsSlider.value = expiringMonths;
                updateExpiringMonthsValue(expiringMonths);
            }
            
            // Initialize bar graph
            setTimeout(() => {
                updateBarGraph();
            }, 100);
            
            console.log('✓ Usage calculation parameters initialized:', {
                percentileCutoff: percentileCutoff + 'th percentile',
                thresholdValue: thresholdValue,
                shelfLife: budPeriod + ' weeks',
                expiringWindow: expiringMonths + ' months',
                trendThreshold: trendThreshold + ' weeks',
                pyxisRestockFreq: pyxisRestockFreq + ' / day'
            });
        }

        // Close modal when clicking outside
        document.getElementById('settingsModal')?.addEventListener('click', function(e) {
            if (e.target === this) {
                closeSettings();
            }
        });

        // Track current tab for back button navigation
        let currentTab = 'overview'; // Default starting tab
        let sendReferrerOnSwitch = true; // Flag to control referrer sending

        // Tab switching functionality
        function switchTab(tabName) {
            // Store previous tab before switching
            const previousTab = currentTab;
            currentTab = tabName;
            
            console.log('🔄 Switching from', previousTab, 'to', tabName);

            document.querySelectorAll('.sidebar-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
            if (activeTab) activeTab.classList.add('active');

            document.querySelectorAll('.tab-container').forEach(container => {
                container.classList.remove('active');
            });
            const activeContainer = document.getElementById(`${tabName}Container`);
            if (activeContainer) activeContainer.classList.add('active');

            // Reapply dark mode when switching tabs
            setTimeout(() => {
                const isDark = document.body.classList.contains('dark-mode');
                console.log('🔄 Tab switched - reapplying dark mode:', isDark);
                applyDarkMode(isDark);
            }, 100);
            
            // Notify the target iframe about the referrer (for back button)
            // Only if sendReferrerOnSwitch is true (not triggered by back button)
            if (sendReferrerOnSwitch) {
                setTimeout(() => {
                    if (tabName === 'inventory') {
                        const inventoryFrame = document.getElementById('inventoryFrame');
                        if (inventoryFrame && inventoryFrame.contentWindow) {
                            // Clear filters when navigating from sidebar
                            inventoryFrame.contentWindow.postMessage({
                                type: 'clearFilters'
                            }, '*');
                            console.log('🧹 Sent clearFilters to inventory (sidebar navigation)');
                            
                            // Send referrer notification for back button
                            setTimeout(() => {
                                inventoryFrame.contentWindow.postMessage({
                                    type: 'setReferrer',
                                    referrer: previousTab,
                                    isBackNavigation: (window.__lastIsBackNavigation === true)
                                }, '*');
                                console.log('📍 Notified inventory of referrer:', previousTab);
                            }, 100);
                        }
                    } else if (tabName === 'optimization') {
                    const stockoutFrame = document.getElementById('optimizationFrame');
                    if (stockoutFrame && stockoutFrame.contentWindow) {
                        stockoutFrame.contentWindow.focus();
                    }
                } else if (tabName === 'analytics') {
                        const analyticsFrame = document.getElementById('analyticsFrame');
                        if (analyticsFrame && analyticsFrame.contentWindow) {
                            // Only clear filters if not coming from a specific navigation request
                            if (window.skipNextClearFilters) {
                                console.log('⏭️ Skipping clearFilters - specific navigation in progress');
                                window.skipNextClearFilters = false;
                            } else {
                                // Clear filters when navigating from sidebar
                                analyticsFrame.contentWindow.postMessage({
                                    type: 'clearFilters'
                                }, '*');
                                console.log('🧹 Sent clearFilters to analytics (sidebar navigation)');
                            }
                            
                            // Send referrer notification for back button
                            setTimeout(() => {
                                analyticsFrame.contentWindow.postMessage({
                                    type: 'setReferrer',
                                    referrer: previousTab,
                                    isBackNavigation: (window.__lastIsBackNavigation === true)
                                }, '*');
                                console.log('📍 Notified analytics of referrer:', previousTab);
                            }, 100);
                        }
                    }
                }, 300);
            } else {
                console.log('📍 Skipping referrer notification (back button navigation)');
                sendReferrerOnSwitch = true; // Reset flag for next switch
            }

            setTimeout(() => {
                if (tabName === 'inventory') {
                    const iframe = document.getElementById('inventoryFrame');
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.focus();
                    }
                } else if (tabName === 'overview') {
                    const overviewFrame = document.getElementById('overviewFrame');
                    if (overviewFrame && overviewFrame.contentWindow) {
                        overviewFrame.contentWindow.focus();
                    }
                } else if (tabName === 'optimization') {
                    const stockoutFrame = document.getElementById('optimizationFrame');
                    if (stockoutFrame && stockoutFrame.contentWindow) {
                        stockoutFrame.contentWindow.focus();
                    }
                } else if (tabName === 'analytics') {
                    const analyticsFrame = document.getElementById('analyticsFrame');
                    if (analyticsFrame && analyticsFrame.contentWindow) {
                        analyticsFrame.contentWindow.focus();
                    }
                } else {
                    if (activeContainer) activeContainer.focus();
                }
            }, 100);

            console.log('Switched to tab:', tabName);
        }

        // Setup inventory iframe
        function setupInventoryIframe() {
            const iframe = document.getElementById('inventoryFrame');
            console.log('📦 Setting up Inventory iframe...');
            
            // Wait for iframe to be fully loaded
            const initializeInventory = () => {
                console.log('📦 Inventory iframe content loading...');
                
                // Modify content (hide elements)
                try {
                    modifyIframeContent();
                } catch (e) {
                    console.log('⏳ Waiting for iframe content...');
                }
                
                // Apply current dark mode
                const isDark = document.body.classList.contains('dark-mode');
                console.log('📦 Current dark mode state:', isDark);
                applyDarkMode(isDark);
                
                // Force data load if table is empty
                setTimeout(() => {
                    try {
                        const iframeWindow = iframe.contentWindow;
                        const contentDoc = iframe.contentDocument;
                        
                        // Check if contentDocument is accessible
                        if (!contentDoc) {
                            console.log('📦 Cannot access iframe content yet, skipping data check');
                            return;
                        }
                        
                        const tableBody = contentDoc.getElementById('tableBody');
                        
                        if (tableBody && tableBody.children.length === 0) {
                            console.log('📦 Table is empty, forcing data load...');
                            
                            if (typeof iframeWindow.autoLoadJSON === 'function') {
                                iframeWindow.autoLoadJSON();
                            } else if (typeof iframeWindow.generateMockData === 'function' && 
                                       typeof iframeWindow.displayData === 'function') {
                                const mockData = iframeWindow.generateMockData();
                                iframeWindow.displayData(mockData);
                            }
                        } else {
                            console.log('📦 Table has data, skipping force load');
                        }
                    } catch (e) {
                        console.log('📦 Could not check/force data load:', e);
                    }
                }, 1500);
            };
            
            // Try immediate initialization
            initializeInventory();
            
            // Try to listen for load event (may fail with CORS)
            try {
                if (iframe.contentWindow) {
                    iframe.contentWindow.addEventListener('load', initializeInventory);
                }
            } catch (e) {
                console.log('⚠️ Cannot access iframe contentWindow (CORS/file protocol) - using fallback timing');
            }
            
            // Backup: try again after delay
            setTimeout(initializeInventory, 2000);
        }

        function modifyIframeContent() {
            const iframe = document.getElementById('inventoryFrame');
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                
                // Hide gear icon
                const gearIcon = iframeDoc.querySelector('.gear-icon');
                if (gearIcon) {
                    gearIcon.style.display = 'none';
                    console.log('✓ Gear icon hidden');
                }
                
                // Hide user avatar
                const userInfo = iframeDoc.querySelector('.header-user-info');
                if (userInfo) {
                    userInfo.style.display = 'none';
                    console.log('✓ User avatar hidden');
                }
            } catch (e) {
                // Expected CORS error when running from file:// protocol
                // This is harmless - just means we can't modify iframe content
                if (e.name === 'SecurityError') {
                    console.log('ℹ️ Cannot access iframe content (CORS restriction from file:// protocol)');
                } else {
                    console.error('Error modifying iframe content:', e);
                }
            }
        }

        // Setup analytics iframe
        function setupAnalyticsIframe() {
            const iframe = document.getElementById('analyticsFrame');
            console.log('📊 Setting up Analytics iframe...');

            const initializeAnalytics = () => {
                console.log('📊 Analytics iframe content loading...');
                
                // Apply current dark mode
                const isDark = document.body.classList.contains('dark-mode');
                console.log('📊 Current dark mode state:', isDark);
                applyDarkMode(isDark);
            };
            
            // Try immediate initialization
            initializeAnalytics();
            
            // Try to listen for load event (may fail with CORS)
            try {
                if (iframe.contentWindow) {
                    iframe.contentWindow.addEventListener('load', initializeAnalytics);
                }
            } catch (e) {
                console.log('⚠️ Cannot access iframe contentWindow (CORS/file protocol) - using fallback timing');
            }
            
            // Backup: try again after delay
            setTimeout(initializeAnalytics, 2000);
        }

        // Setup overview iframe
        function setupOverviewIframe() {
            const iframe = document.getElementById('overviewFrame');
            console.log('📊 Setting up Overview iframe...');

            const initializeOverview = () => {
                console.log('📊 Overview iframe content loading...');
                
                // Apply current dark mode
                const isDark = document.body.classList.contains('dark-mode');
                console.log('📊 Current dark mode state:', isDark);
                applyDarkMode(isDark);
            };
            
            // Try immediate initialization
            initializeOverview();
            
            // Try to listen for load event (may fail with CORS)
            try {
                if (iframe.contentWindow) {
                    iframe.contentWindow.addEventListener('load', initializeOverview);
                }
            } catch (e) {
                console.log('⚠️ Cannot access iframe contentWindow (CORS/file protocol) - using fallback timing');
            }
            
            // Backup: try again after delay
            setTimeout(initializeOverview, 2000);
        }

        // Disable tab navigation
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('button').forEach(button => {
                button.setAttribute('tabindex', '-1');
            });
            
            document.querySelectorAll('.tab-container').forEach(container => {
                container.setAttribute('tabindex', '-1');
            });
        });

        // Initialize on page load
        window.addEventListener('load', function() {
            console.log('Dashboard loaded');
            
            // Initialize usage calculation parameters
            initializeUsageParams();
            
            // Initialize sunset-based dark mode
            setTimeout(() => {
                initSunsetDarkMode();
            }, 500);
            
            // Initialize modal scroll arrows
            setTimeout(() => {
                initModalScrollArrows();
            }, 1000);
            
            // Add click-outside-to-close listeners for all modals
            const modals = ['stockoutModal', 'wasteModal', 'unusedModal', 'overloadModal'];
            modals.forEach(modalId => {
                const modal = document.getElementById(modalId);
                if (modal) {
                    modal.addEventListener('click', function(e) {
                        if (e.target === this) {
                            // Clicked on overlay (outside modal content)
                            const closeFunctionName = 'close' + modalId.charAt(0).toUpperCase() + modalId.slice(1, -5) + 'Modal';
                            if (typeof window[closeFunctionName] === 'function') {
                                window[closeFunctionName]();
                            }
                        }
                    });
                    console.log(`✓ Click-outside-to-close enabled for ${modalId}`);
                }
            });
        });

        // Expose functions for console debugging
        window.getSunsetInfo = getSunsetInfo;
        window.updateDarkModeBasedOnTime = updateDarkModeBasedOnTime;
        window.fetchSunsetTimes = fetchSunsetTimes;
        window.clearLocationCache = clearLocationCache;
        window.resetDarkModeToAuto = resetDarkModeToAuto;

        // ==================================================================================
        // CENTRALIZED MOCK DATA STORE
        // ==================================================================================
        // All pharmaceutical data is now loaded from external JS files and merged here
        
        // Merge data from external files into single MOCK_DATA object
        var MOCK_DATA = {};

        // Track readiness so iframes don't receive an empty structure during reload/race conditions.
        // Some environments (e.g., network drive file://) load iframes faster than the parent finishes
        // merging external JS data, causing a one-time "0 items" render unless the iframe hard-refreshes.
        let __mockDataReady = false;
        const __pendingMockDataRequests = [];

        // Simple full-screen loading overlay (Dashboard_Tabbed.html)
        function __setAppLoading(isLoading, text) {
            try {
                const el = document.getElementById('appLoadingOverlay');
                if (!el) return;
                el.style.display = isLoading ? 'flex' : 'none';
                const t = document.getElementById('appLoadingText');
                if (t && typeof text === 'string') t.textContent = text;
            } catch (e) {}
        }

        function __flushPendingMockDataRequests() {
            if (!__mockDataReady) return;
            while (__pendingMockDataRequests.length) {
                const src = __pendingMockDataRequests.shift();
                try {
                    const computed = getProcessedMockData();
                    const raw = getRawMockData();
                    src.postMessage({
                        type: 'mockDataResponse',
                        data: computed,
                        computed: computed,
                        raw: raw
                    }, '*');
                } catch (e) {
                    console.warn('⚠️ Failed to respond to pending mock data request', e);
                }
            }
        }
        
        // Function to merge mock data from external files
        function initializeMockData() {
            console.log('🔄 Initializing mock data from external files...');
            
            // Check if external data files are loaded
            if (typeof ITEMS_DATA === 'undefined') {
                console.error('❌ ITEMS_DATA not loaded from items_details_mockdata.js');
                return false;
            }
            if (typeof ITEMS_INVENTORY === 'undefined') {
                console.error('❌ ITEMS_INVENTORY not loaded from items_inventory_mockdata.js');
                return false;
            }
            
            // Merge monthly transaction files
            console.log('📅 Merging monthly transaction files...');
            const mergedTransactions = mergeMonthlyTransactions();
            
            if (Object.keys(mergedTransactions).length === 0) {
                console.warn('⚠️ No transaction files found. Looking for files like transaction_2025_01_mockdata.js');
                console.warn('   Make sure each file exports as: const TRANSACTION_2025_01 = {...}');
            }
            
            // Merge all data into MOCK_DATA
            MOCK_DATA = {
                lastUpdated: ITEMS_DATA.lastUpdated,
                items: ITEMS_DATA.items || [],
                inventory: ITEMS_INVENTORY || {},
                transactions: mergedTransactions
            };
            
            // Initialize compatibility layer - generates stockFlow and stockOutsByArea
            MOCK_DATA = initializeDataCompatibility(MOCK_DATA);
            
            console.log('✅ Mock data initialized:');
            console.log('   - Items:', MOCK_DATA.items.length);
            console.log('   - Inventory item codes:', Object.keys(MOCK_DATA.inventory).length);
            console.log('   - Transaction records:', Object.keys(MOCK_DATA.transactions).length);
            console.log('   - Stock flows (generated):', MOCK_DATA.stockFlow ? MOCK_DATA.stockFlow.flows.length : 0);
            console.log('   - Stock-outs by area (generated):', MOCK_DATA.stockOutsByArea ? MOCK_DATA.stockOutsByArea.length : 0);
            console.log('   - Last Updated:', MOCK_DATA.lastUpdated);
            
            return true;
        }
        
        // Initialization (STATIC HTML): ensure any dynamically listed transaction scripts
        // are loaded before we attempt to merge them.
        function initializeWhenReady() {
            console.log('🚀 Initializing dashboard...');

            // Show loading overlay ASAP (data merge + compute caches)
            __setAppLoading(true, 'Loading inventory data…');

            const loader = window.InventoryApp && window.InventoryApp.DataLoader;
            const ensureLoaded = loader && typeof loader.ensureTransactionsLoaded === 'function'
                ? loader.ensureTransactionsLoaded()
                : Promise.resolve({ loaded: true, count: 0 });

            ensureLoaded.then((info) => {
                if (info && info.count) {
                    console.log(`📦 Transaction loader: ensured ${info.count} script(s) processed`);
                }

                // Initialize the mock data (now that scripts are available)
                __setAppLoading(true, 'Merging transaction files…');
                if (!initializeMockData()) {
                    console.error('❌ Failed to initialize mock data!');
                    // Create empty structure to prevent errors
                    MOCK_DATA = {
                        lastUpdated: "2026-01-13",
                        items: [],
                        inventory: {},
                        transactions: {},
                        stockFlow: { flows: [] },
                        stockOutsByArea: []
                    };
                    // Mark ready even if empty, so iframes don't hang
                    __mockDataReady = true;
                    __flushPendingMockDataRequests();
                    __setAppLoading(false);
                } else {
                    // Warm up compute/cache up-front so chart switches don't feel laggy.
                    // This also precomputes full-range weekly bins so week/day views include all months.
                    __setAppLoading(true, 'Building analytics cache…');
                    try {
                        // Force-build processed data now (fills cachedProcessedData)
                        // Use compute pipeline when available.
                        if (window.InventoryApp && InventoryApp.Compute) {
                            const store = InventoryApp.Compute.buildStoreFromGlobals({
                                shelfLifeWeeks: parseInt(localStorage.getItem('budPeriod') || '52', 10),
                                precomputeWeeklyBins: true,
                                includeSublocationUsageMaps: false
                            });
                            cachedRawData = store && store.rawLegacy ? store.rawLegacy : cachedRawData;
                            cachedProcessedData = store && store.computedLegacy ? store.computedLegacy : cachedProcessedData;
                        } else {
                            // Fallback triggers legacy processing cache
                            getProcessedMockData();
                        }
                    } catch (e) {
                        console.warn('⚠️ Cache warmup failed; charts may compute lazily.', e);
                        try { getProcessedMockData(); } catch(_) {}
                    }

                    __mockDataReady = true;
                    __flushPendingMockDataRequests();
                    __setAppLoading(false);
                }

                // After data is loaded, initialize trending items
                if (typeof calculateTrendingItems === 'function' && MOCK_DATA && MOCK_DATA.items && MOCK_DATA.items.length > 0) {
                    console.log('🔄 Calculating trending items...');
                    const localTrendResult = calculateTrendingItems();
                    Promise.resolve()
                        .then(() => appendTrendFactsRun({ trendResult: localTrendResult }))
                        .catch((err) => console.warn('⚠️ appendTrendFactsRun failed', err))
                        .then(() => loadLatestTrendFactsFromSheet())
                        .then(() => sendTrendingItemsToPages())
                        .catch((err) => console.warn('⚠️ loadLatestTrendFactsFromSheet fallback', err));
                } else {
                    console.warn('⚠️ Trending items not calculated - waiting for data');
                }
            });
        }
        
        // Wait for DOM to be ready, then initialize
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeWhenReady);
        } else {
            // DOM already loaded
            initializeWhenReady();
        }


        // ==================================================================================
        // TRENDING ITEMS CALCULATION
        // ==================================================================================
        // NOTE: calculateTrendingItems() is now provided by calculateTrendingItems_advanced.js
        // which uses the TrendAnalysisEngine for multi-method ensemble detection
        // The old simple consecutive-weeks method is kept here for reference only
        
        // NOTE: calculateTrendingItems() is now provided by trend_detection_integrated.js
        // which combines the TrendAnalysisEngine with pharmaceutical data integration
        // The old simple consecutive-weeks method has been replaced with multi-method ensemble detection
        
        /**
         * Send trending items to all iframe pages
         */
        function sendTrendingItemsToPages() {
            // Safety check: make sure MOCK_DATA exists
            if (!MOCK_DATA || !MOCK_DATA.items || MOCK_DATA.items.length === 0) {
                console.warn('⚠️ MOCK_DATA not ready, cannot send trending items');
                return;
            }
            
            const trendState = getTrendFactsState();
            const trendingItems = {
                trendingUp: Array.isArray(trendState.up) ? trendState.up : [],
                trendingDown: Array.isArray(trendState.down) ? trendState.down : [],
                calculatedAt: trendState.calculatedAt || '',
                source: trendState.source || 'unknown',
                threshold: (MOCK_DATA.trendingItems && MOCK_DATA.trendingItems.threshold) || parseInt(localStorage.getItem('consecutiveWeekThreshold') || '2', 10)
            };
            
            if (!trendingItems) {
                console.error('❌ No trending items to send');
                return;
            }
            
            _sectionLog('dashboard', '📤 Sending trending items to pages:', {
                trendingUp: trendingItems.trendingUp.length,
                trendingDown: trendingItems.trendingDown.length,
                threshold: trendingItems.threshold
            });
            
            // Send to Analytics (Overview page - Analytics_Page.html)
            const overviewFrame = document.getElementById('overviewFrame');
            if (overviewFrame && overviewFrame.contentWindow) {
                overviewFrame.contentWindow.postMessage({
                    type: 'trendingItemsUpdate',
                    trendingItems: trendingItems
                }, '*');
                console.log('✓ Sent trending items to Overview/Analytics');
            }
            
            // Send to Charts (analyticsFrame - Charts.html)
            const analyticsFrame = document.getElementById('analyticsFrame');
            if (analyticsFrame && analyticsFrame.contentWindow) {
                analyticsFrame.contentWindow.postMessage({
                    type: 'trendingItemsUpdate',
                    trendingItems: trendingItems
                }, '*');
                console.log('✓ Sent trending items to Charts');
            }
            
            // Send to Shortage Bulletin (inventoryFrame)
            const inventoryFrame = document.getElementById('inventoryFrame');
            if (inventoryFrame && inventoryFrame.contentWindow) {
                inventoryFrame.contentWindow.postMessage({
                    type: 'trendingItemsUpdate',
                    trendingItems: trendingItems
                }, '*');
                console.log('✓ Sent trending items to Shortage Bulletin');
            }
            
            console.log('✅ Trending items sent to all pages');
        }
        
        // Expose to window for debugging
        window.MOCK_DATA = MOCK_DATA;
        window.calculateTrendingItems = calculateTrendingItems;
        window.sendTrendingItemsToPages = sendTrendingItemsToPages;
        window.loadLatestTrendFactsFromSheet = loadLatestTrendFactsFromSheet;
        window.appendTrendFactsRun = appendTrendFactsRun;
        window.updateTrendFactsStatusLine = updateTrendFactsStatusLine;


	// ==================================================================================
        // POST MESSAGE DATA COMMUNICATION SYSTEM
        // ==================================================================================
        // Handles data requests from iframe children and responds with mock data
        

        /**
         * Cache for pre-calculated data to avoid redundant processing
         */
        let cachedProcessedData = null;
        let cachedRawData = null;

        function getRawMockData() {
            // Raw snapshot captured before processing/mutation for deterministic consumers.
            // Invalidate if new monthly transaction scripts were loaded.
            try {
                const v = (window.InventoryApp && InventoryApp.DataLoader && typeof InventoryApp.DataLoader.__txVersion === 'number')
                    ? InventoryApp.DataLoader.__txVersion : 0;
                if (__cachedRawTxVersion !== v) {
                    cachedRawData = null;
                    cachedProcessedData = null; // conservative: derived caches may depend on tx
                    __cachedRawTxVersion = v;
                }
            } catch (eV) {}

            if (cachedRawData) return cachedRawData;

            // --- Raw transactions (critical for Charts page) ---
            // The computed MOCK_DATA structure contains derived weekly rate arrays
            // (usageRate/restockRate/wasteRate), but those do not respond to arbitrary
            // date-range selections. The Charts page needs the underlying transaction
            // rows so it can re-aggregate deterministically for the selected range.
            //
            // We build a minimal raw payload that always includes merged monthly
            // transactions when possible.
            try {
                if (typeof mergeMonthlyTransactions === 'function') {
                    const mergedTx = mergeMonthlyTransactions();
                    cachedRawData = { transactions: mergedTx };
                    return cachedRawData;
                }
            } catch (eTx) {
                console.warn('⚠️ Unable to merge monthly transactions for raw payload.', eTx);
            }
            try {
                if (window.InventoryApp && InventoryApp.Compute) {
                    const store = InventoryApp.Compute.getStore() || InventoryApp.Compute.buildStoreFromGlobals();
                    cachedRawData = store && store.rawLegacy ? store.rawLegacy : (window.MOCK_DATA || {});
                    return cachedRawData;
                }
            } catch (e) {
                console.warn('⚠️ Compute store not available; falling back to legacy raw snapshot.', e);
            }

            try {
                cachedRawData = JSON.parse(JSON.stringify(MOCK_DATA));
            } catch (e2) {
                console.warn('⚠️ Unable to snapshot raw MOCK_DATA; falling back to reference.', e2);
                cachedRawData = MOCK_DATA;
            }
            return cachedRawData;
        }
        
        /**
         * Simple usage rate calculator for pre-caching (lightweight version)
         */
        // ==================================================================================
        // ENHANCED USAGE RATE ANALYSIS (from Shortage Bulletin)
        // ==================================================================================
        
        /**
         * Calculate percentile value from sorted array
         */
        function calculatePercentile(sortedArray, percentile) {
            if (sortedArray.length === 0) return 0;
            const index = (percentile / 100) * (sortedArray.length - 1);
            const lower = Math.floor(index);
            const upper = Math.ceil(index);
            const weight = index - lower;
            
            if (lower === upper) {
                return sortedArray[lower];
            }
            return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
        }
        
        /**
         * Detect and filter outliers using configurable percentile cutoff
         * Returns filtered array with outliers removed
         */
        function filterOutliersIQR(dataArray, percentileCutoff = 25) {
            if (!Array.isArray(dataArray) || dataArray.length < 4) {
                return dataArray; // Need at least 4 points
            }
            
            // Sort the array
            const sorted = [...dataArray].sort((a, b) => a - b);
            
            // Calculate percentile threshold
            const threshold = calculatePercentile(sorted, percentileCutoff);
            
            // Calculate Q1 and Q3 for reference
            const q1 = calculatePercentile(sorted, 25);
            const q3 = calculatePercentile(sorted, 75);
            const iqr = q3 - q1;
            
            // Filter out values below threshold
            const filtered = dataArray.filter(value => value >= threshold);
            
            return filtered;
        }
        
        function calculateTrueUsageRate(usageRateArray, itemStatus) {
            // ========== CONFIGURABLE CONSTANTS (from localStorage) ==========
            const PERCENTILE_CUTOFF = parseFloat(localStorage.getItem('usagePercentileCutoff') || '25');  // Percentile threshold
            const MIN_BASELINE_PERIODS = 2;          // Minimum weeks needed for calculation (lowered to allow aggressive filtering)
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
            
            // ========== NEW APPROACH: Percentile-based outlier filtering for ALL items ==========
            
            // Step 1: Filter outliers using percentile method
            const filteredData = filterOutliersIQR(usageRateArray, PERCENTILE_CUTOFF);
            
            // Step 2: Decide whether to use filtered or original data
            let dataToUse;
            let useFiltered = false;
            
            if (filteredData.length >= MIN_BASELINE_PERIODS) {
                // Have enough data points after filtering - use filtered data
                dataToUse = filteredData;
                useFiltered = true;
            } else {
                // Not enough points after filtering - use all original data
                dataToUse = usageRateArray;
                useFiltered = false;
            }
            
            // Step 3: Calculate average of the data we're using
            const weeklyBaseline = dataToUse.reduce((sum, val) => sum + val, 0) / dataToUse.length;
            
            // Step 4: Calculate trend slope (linear regression)
            const weeklySlope = calculateTrendSlopeForUsageRate(dataToUse);
            
            // Step 5: Convert weekly values to daily
            const dailyBaseline = weeklyBaseline / DAYS_PER_WEEK;
            const dailySlope = weeklySlope / DAYS_PER_WEEK / DAYS_PER_WEEK; // Per day per day
            
            // Step 6: Calculate confidence
            const confidence = calculateConfidence(dataToUse, weeklySlope);
            
            return {
                weeklyBaseline: Math.round(weeklyBaseline * 10) / 10,
                weeklySlope: Math.round(weeklySlope * 100) / 100,
                dailyBaseline: Math.round(dailyBaseline * 100) / 100,
                dailySlope: Math.round(dailySlope * 1000) / 1000,
                projectedDailyUsage: Math.round(dailyBaseline * 100) / 100,
                normalPeriods: dataToUse.length,
                constrainedPeriods: usageRateArray.length - dataToUse.length,
                confidence: confidence,
                useOriginalData: !useFiltered,
                usedIQRFiltering: useFiltered
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
         * Pre-process mock data with cached calculations
         */
        /**
         * Sanitize and normalize item data to handle all possible parsing issues
         * Handles: strings/numbers, missing fields, invalid characters, punctuation, data types
         */
        function sanitizeItemData(item) {
            if (!item || typeof item !== 'object') {
                console.warn('⚠️ Invalid item:', item);
                return null;
            }
            
            const sanitized = {};
            
            // Helper: safely convert to string and clean
            const cleanString = (value) => {
                if (value === null || value === undefined) return '';
                let str = String(value).trim();
                // Remove control characters but keep normal punctuation
                str = str.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
                // Normalize multiple spaces
                str = str.replace(/\s+/g, ' ');
                return str;
            };
            
            // Helper: safely parse number
            const parseNumber = (value, defaultValue = 0) => {
                if (value === null || value === undefined || value === '') return defaultValue;
                // Handle string numbers with commas
                if (typeof value === 'string') {
                    value = value.replace(/,/g, '');
                }
                const num = Number(value);
                return isNaN(num) || !isFinite(num) ? defaultValue : num;
            };
            
            // Helper: safely parse array
            const parseArray = (value, defaultValue = []) => {
                if (Array.isArray(value)) return value.map(v => parseNumber(v, 0));
                if (typeof value === 'string') {
                    try {
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed)) return parsed.map(v => parseNumber(v, 0));
                    } catch (e) {
                        // Try splitting by comma
                        const parts = value.split(',').map(v => parseNumber(v.trim(), 0));
                        if (parts.length > 0) return parts;
                    }
                }
                if (typeof value === 'number') return [value];
                return defaultValue;
            };
            
            // Core fields - strings
            sanitized.drugName = cleanString(item.drugName || item.drug_name || item.name || '');
            sanitized.description = cleanString(item.description || item.desc || '');
            sanitized.itemCode = cleanString(item.itemCode || item.item_code || item.code || '');
            sanitized.alt_itemCode = cleanString(item.alt_itemCode || item.altItemCode || '');
            sanitized.itemClass = cleanString(item.itemClass || item.item_class || item.class || '');
            sanitized.status = cleanString(item.status || '').toLowerCase();
            sanitized.ETA = cleanString(item.ETA || item.eta || '');
            
            // Numeric fields
            sanitized.quantity = parseNumber(item.quantity);
            sanitized.pyxis = parseNumber(item.pyxis);
            sanitized.pyxisStandard = parseNumber(item.pyxisStandard);  // New field for standard inventory
            sanitized.pharmacy = parseNumber(item.pharmacy);
            sanitized.unitPrice = cleanString(item.unitPrice || item.unit_price || '0');
            
            // Parse unitPrice as number if it's a string
            if (sanitized.unitPrice && typeof sanitized.unitPrice === 'string') {
                // Remove currency symbols and parse
                const priceStr = sanitized.unitPrice.replace(/[$,]/g, '');
                const priceNum = parseFloat(priceStr);
                if (!isNaN(priceNum) && isFinite(priceNum)) {
                    sanitized.unitPrice = priceNum.toFixed(2);
                } else {
                    sanitized.unitPrice = '0.00';
                }
            }
            
            // Usage rate array
            sanitized.usageRate = parseArray(item.usageRate || item.usage_rate || item.usage, [0,0,0,0,0,0,0,0,0,0,0,0]);
            
            // Waste rate array
            sanitized.wasteRate = parseArray(item.wasteRate || item.waste_rate, [0,0,0,0,0,0,0,0,0,0,0,0]);
            
            // Restock rate - keep as string, will be parsed later
            sanitized.restockRate = item.restockRate || item.restock_rate || '0';
            // Boolean fields
            sanitized.SBAR = Boolean(item.SBAR || item.sbar);
            
            // Optional fields
            sanitized.filePath = cleanString(item.filePath || item.file_path || '');
            sanitized.notes = cleanString(item.notes || '');
            sanitized.assessment = cleanString(item.assessment || '');
            
            // Validate required fields
            if (!sanitized.drugName && !sanitized.description) {
                console.warn('⚠️ Item missing both drugName and description:', item);
                return null;
            }
            
            // If drugName is missing but description exists, use first part of description
            if (!sanitized.drugName && sanitized.description) {
                sanitized.drugName = sanitized.description.split(' ').slice(0, 3).join(' ');
            }
            
            // Validate itemCode
            if (!sanitized.itemCode) {
                // Generate a fallback itemCode from drugName
                sanitized.itemCode = 'UNKNOWN_' + sanitized.drugName.substring(0, 10).replace(/\s+/g, '_').toUpperCase();
                console.warn('⚠️ Item missing itemCode, generated:', sanitized.itemCode);
            }
            
            // Ensure quantity is valid
            if (sanitized.quantity < 0) {
                console.warn('⚠️ Negative quantity found, setting to 0:', sanitized.itemCode);
                sanitized.quantity = 0;
            }
            
            // Ensure pyxis + pharmacy = quantity (or close to it)
            const calculatedTotal = sanitized.pyxis + sanitized.pharmacy;
            if (Math.abs(calculatedTotal - sanitized.quantity) > 1) {
                console.warn(`⚠️ Quantity mismatch for ${sanitized.itemCode}: pyxis(${sanitized.pyxis}) + pharmacy(${sanitized.pharmacy}) != quantity(${sanitized.quantity})`);
                // Trust the individual counts over total
                sanitized.quantity = calculatedTotal;
            }
            
            return sanitized;
        }
        
        // ==================================================================================
        // EFFECTIVE INVENTORY HELPER
        // ==================================================================================
        /**
         * Get effective inventory for an item based on excludeStandardInventory setting
         * If setting is ON, subtracts pyxisStandard from pyxis
         * @param {Object} item - The item object with pyxis, pyxisStandard, pharmacy fields
         * @returns {Object} - Object with effectivePyxis, effectivePharmacy, effectiveQuantity
         */
        function getEffectiveInventory(item) {
            const excludeStandard = localStorage.getItem('excludeStandardInventory') === 'true';
            
            const pyxis = item.pyxis || 0;
            const pyxisStandard = item.pyxisStandard || 0;
            const pharmacy = item.pharmacy || 0;
            
            if (excludeStandard) {
                const effectivePyxis = Math.max(0, pyxis - pyxisStandard);
                return {
                    effectivePyxis: effectivePyxis,
                    effectivePharmacy: pharmacy,
                    effectiveQuantity: effectivePyxis + pharmacy
                };
            } else {
                return {
                    effectivePyxis: pyxis,
                    effectivePharmacy: pharmacy,
                    effectiveQuantity: pyxis + pharmacy
                };
            }
        }
        
        // ==================================================================================
        // RESTOCK RATE PARSER
        // ==================================================================================
        /**
         * Parse restockRate from string to array
         * Handles formats: "[0,0,0,31,0,0]", "0", or already an array
         */
        function parseRestockRate(restockRate) {
            // Already an array
            if (Array.isArray(restockRate)) {
                return restockRate;
            }
            
            // String that needs parsing
            if (typeof restockRate === 'string') {
                // Handle "0" string
                if (restockRate === '0' || restockRate === '') {
                    return [];
                }
                
                // Handle JSON array string like "[0,0,0,31,0,0]"
                try {
                    const parsed = JSON.parse(restockRate);
                    if (Array.isArray(parsed)) {
                        return parsed;
                    }
                } catch (e) {
                    console.warn('Failed to parse restockRate:', restockRate);
                    return [];
                }
            }
            
            // Number or other type - convert to array
            if (typeof restockRate === 'number') {
                return restockRate === 0 ? [] : [restockRate];
            }
            
            return [];
        }
        
        function getProcessedMockData() {
            // Safety check: Make sure MOCK_DATA is initialized
            if (!MOCK_DATA || !MOCK_DATA.items || MOCK_DATA.items.length === 0) {
                console.warn('⚠️ MOCK_DATA not ready yet, returning empty structure');
                return {
                    lastUpdated: "2026-01-13",
                    items: [],
                    inventory: {},
                    transactions: {},
                    stockFlow: { flows: [] },
                    stockOutsByArea: []
                };
            }
            
            // Return cached version if already processed
            if (cachedProcessedData) {
                console.log('✓ Returning cached processed data');
                return cachedProcessedData;
            }

            // Preferred path: centralized compute pipeline (deterministic, expandable)
            try {
                if (window.InventoryApp && InventoryApp.Compute) {
                    const store = InventoryApp.Compute.buildStoreFromGlobals({
                        shelfLifeWeeks: parseInt(localStorage.getItem('budPeriod') || '52', 10),
                        precomputeWeeklyBins: true,
                        includeSublocationUsageMaps: false
                    });
                    cachedRawData = store && store.rawLegacy ? store.rawLegacy : cachedRawData;
                    cachedProcessedData = store && store.computedLegacy ? store.computedLegacy : cachedProcessedData;
                    if (cachedProcessedData) {
                        console.log('✓ Processed data built via InventoryApp.Compute');
                        return cachedProcessedData;
                    }
                }
            } catch (e) {
                console.warn('⚠️ InventoryApp.Compute failed; falling back to legacy processing.', e);
            }

            // Capture raw snapshot on first processing pass
            if (!cachedRawData) {
                getRawMockData();
            }
            
            console.log('🔧 Pre-processing and sanitizing', MOCK_DATA.items.length, 'items...');
            const startTime = performance.now();
            
            // STEP 1: Sanitize all items
            const sanitizedItems = [];
            let skippedCount = 0;
            for (let i = 0; i < MOCK_DATA.items.length; i++) {
                const sanitized = sanitizeItemData(MOCK_DATA.items[i]);
                if (sanitized) {
                    sanitizedItems.push(sanitized);
                } else {
                    skippedCount++;
                }
            }
            
            if (skippedCount > 0) {
                console.warn(`⚠️ Skipped ${skippedCount} invalid items during sanitization`);
            }
            
            // Replace items array with sanitized version
            MOCK_DATA.items = sanitizedItems;
            
            console.log('🔧 Calculating usage rates for', MOCK_DATA.items.length, 'items using ENHANCED ALGORITHM...');
            
            // STEP 2: Add cached properties directly to items
            let testCount = 0;
            for (let i = 0; i < MOCK_DATA.items.length; i++) {
                const item = MOCK_DATA.items[i];
                try {
                    // Use the sophisticated calculateTrueUsageRate from Shortage Bulletin
                    const usageCalc = calculateTrueUsageRate(item.usageRate, item.status);
                    item._cachedWeeklyUsage = usageCalc.weeklyBaseline;
                    item._cachedDailyUsage = usageCalc.dailyBaseline;
                    
                    // Generate restockRate from usageRate
                    item.restockRate = parseRestockRate(item.restockRate);
                    
                    // Log details for albumin item
                    if (item.description && item.description.includes('albumin human (5%) 0.05')) {
                        console.log('📊 ALBUMIN CALCULATION DETAILS:');
                        console.log('  - Description:', item.description);
                        console.log('  - Usage array:', item.usageRate);
                        console.log('  - Status:', item.status || '(empty)');
                        console.log('  - Weekly baseline:', usageCalc.weeklyBaseline);
                        console.log('  - Daily baseline:', usageCalc.dailyBaseline);
                        console.log('  - Normal periods:', usageCalc.normalPeriods);
                        console.log('  - Filtered outliers:', usageCalc.constrainedPeriods);
                        console.log('  - Confidence:', usageCalc.confidence);
                        console.log('  - Used percentile filtering:', usageCalc.usedIQRFiltering || false);
                    }
                    
                    // Log first 3 items as examples
                    if (testCount < 3) {
                        console.log(`  Item ${i}: ${item.description} - Weekly: ${usageCalc.weeklyBaseline}, Confidence: ${usageCalc.confidence}%`);
                        testCount++;
                    }
                } catch (error) {
                    console.error(`❌ Error calculating usage for item ${item.itemCode}:`, error);
                    // Set fallback values
                    item._cachedWeeklyUsage = 0;
                    item._cachedDailyUsage = 0;
                }
            }
            
            const endTime = performance.now();
            console.log(`✓ Processing complete in ${(endTime - startTime).toFixed(2)}ms`);
            console.log(`✅ Successfully processed ${MOCK_DATA.items.length} items`);
            console.log('✅ USING ENHANCED ALGORITHM FROM SHORTAGE BULLETIN');
            console.log(`✅ RestockRate auto-generated for all ${MOCK_DATA.items.length} items`);
            
            // STEP 3: Calculate projected waste using Shelf Life
            console.log('🗑️ Calculating projected waste...');
            const shelfLife = parseInt(localStorage.getItem('budPeriod') || '52'); // Get from settings
            let projectedWasteTotal = 0;
            const projectedWasteItemsList = [];
            
            console.log(`  Processing ${MOCK_DATA.items.length} items with Shelf Life = ${shelfLife} weeks`);
            
            MOCK_DATA.items.forEach(item => {
                // Projected waste uses ORIGINAL inventory (not affected by pyxisStandard)
                const totalInventory = item.quantity || 0;
                const unitPrice = parseFloat(item.unitPrice || 0);
                
                // Calculate total usage from usageRate array
                let totalUsage = 0;
                let dataPointCount = 0;
                if (item.usageRate && Array.isArray(item.usageRate)) {
                    totalUsage = item.usageRate.reduce((sum, val) => sum + (val || 0), 0);
                    dataPointCount = item.usageRate.length;
                }
                
                // Skip if no usage data
                if (dataPointCount === 0) {
                    return;
                }
                
                // Calculate average usage and projected usage over shelf life
                const averageUsagePerPeriod = totalUsage / dataPointCount;
                const projectedUsageOverShelfLife = averageUsagePerPeriod * shelfLife;
                
                // Calculate excess inventory (what will be left after shelf life period)
                const excessInventory = totalInventory - projectedUsageOverShelfLife;
                
                // Only include items with positive excess (projected waste)
                if (excessInventory > 0) {
                    const wasteValue = excessInventory * unitPrice;
                    projectedWasteTotal += wasteValue;
                    projectedWasteItemsList.push({
                        ...item,
                        excessInventory: excessInventory,
                        wasteValue: wasteValue,
                        averageUsagePerPeriod: averageUsagePerPeriod,
                        projectedUsageOverShelfLife: projectedUsageOverShelfLife,
                        dataPointCount: dataPointCount,
                        shelfLife: shelfLife
                    });
                }
            });
            
            // Store projected waste results in MOCK_DATA for sharing with iframes
            MOCK_DATA.projectedWaste = {
                totalCost: projectedWasteTotal,
                itemCount: projectedWasteItemsList.length,
                items: projectedWasteItemsList,
                shelfLife: shelfLife
            };
            
            console.log(`✓ Projected Waste calculated: $${projectedWasteTotal.toFixed(2)} (${projectedWasteItemsList.length} items)`);
            console.log(`  Shelf Life used: ${shelfLife} weeks`);
            
            // Log a few sample items with projected waste
            if (projectedWasteItemsList.length > 0) {
                console.log('📊 Sample projected waste items:', projectedWasteItemsList.slice(0, 3).map(item => ({
                    description: item.description,
                    itemCode: item.itemCode,
                    inventory: item.quantity,
                    excess: item.excessInventory.toFixed(2),
                    wasteValue: item.wasteValue.toFixed(2)
                })));
            } else {
                console.warn('⚠️ No items with projected waste found!');
            }
            
            // STEP 4: Calculate Pyxis Projected Waste using Shelf Life
            console.log('🏥 Calculating Pyxis projected waste...');
            let pyxisWasteTotal = 0;
            const pyxisWasteItemsList = [];
            
            MOCK_DATA.items.forEach(item => {
                // Pyxis projected waste uses ORIGINAL pyxis (not affected by pyxisStandard)
                const pyxisInventory = item.pyxis || 0;
                const unitPrice = parseFloat(item.unitPrice || 0);
                
                // Skip if no pyxis inventory
                if (pyxisInventory === 0) {
                    return;
                }
                
                // Calculate total usage from usageRate array
                let totalUsage = 0;
                let dataPointCount = 0;
                if (item.usageRate && Array.isArray(item.usageRate)) {
                    totalUsage = item.usageRate.reduce((sum, val) => sum + (val || 0), 0);
                    dataPointCount = item.usageRate.length;
                }
                
                // Skip if no usage data
                if (dataPointCount === 0) {
                    return;
                }
                
                // Calculate average usage and projected usage over shelf life
                const averageUsagePerPeriod = totalUsage / dataPointCount;
                const projectedUsageOverShelfLife = averageUsagePerPeriod * shelfLife;
                
                // Calculate excess Pyxis inventory (what will be left after shelf life period)
                const excessPyxisInventory = pyxisInventory - projectedUsageOverShelfLife;
                
                // Only include items with positive excess (projected waste)
                if (excessPyxisInventory > 0) {
                    const pyxisWasteValue = excessPyxisInventory * unitPrice;
                    pyxisWasteTotal += pyxisWasteValue;
                    pyxisWasteItemsList.push({
                        ...item,
                        excessPyxisInventory: excessPyxisInventory,
                        pyxisWasteValue: pyxisWasteValue,
                        averageUsagePerPeriod: averageUsagePerPeriod,
                        projectedUsageOverShelfLife: projectedUsageOverShelfLife,
                        dataPointCount: dataPointCount,
                        shelfLife: shelfLife
                    });
                }
            });
            
            // Store Pyxis projected waste results in MOCK_DATA
            MOCK_DATA.pyxisProjectedWaste = {
                totalCost: pyxisWasteTotal,
                itemCount: pyxisWasteItemsList.length,
                items: pyxisWasteItemsList,
                shelfLife: shelfLife
            };
            
            console.log(`✓ Pyxis Projected Waste calculated: $${pyxisWasteTotal.toFixed(2)} (${pyxisWasteItemsList.length} items)`);
            
            // STEP 5: Calculate Usage vs Restock items below threshold
            console.log('📊 Calculating Usage vs Restock items below threshold...');
            const usageRestockThreshold = parseFloat(localStorage.getItem('usageRestockThreshold') || '0.5');
            const itemsBelowThreshold = [];
            
            MOCK_DATA.items.forEach(item => {
                if (item.usageRate && item.restockRate) {
                    let totalUsage = item.usageRate.reduce((sum, val) => sum + (val || 0), 0);
                    let totalRestock = item.restockRate.reduce((sum, val) => sum + (val || 0), 0);
                    
                    if (totalRestock > 0) {
                        const ratio = totalUsage / totalRestock;
                        if (ratio < usageRestockThreshold) {
                            itemsBelowThreshold.push({
                                ...item,
                                usageRestockRatio: ratio,
                                totalUsage: totalUsage,
                                totalRestock: totalRestock
                            });
                        }
                    }
                }
            });
            
            // Store Usage vs Restock results in MOCK_DATA
            MOCK_DATA.usageVsRestock = {
                threshold: usageRestockThreshold,
                itemCount: itemsBelowThreshold.length,
                items: itemsBelowThreshold
            };
            
            console.log(`✓ Usage vs Restock: ${itemsBelowThreshold.length} items below threshold ${usageRestockThreshold}`);
            
            // STEP 6: Process Pyxis Metrics from stockOutsByArea
            console.log('🏥 Processing Pyxis metrics from area data (NEW FORMAT)...');
            const areaData = MOCK_DATA.stockOutsByArea || [];
            
            // Helper function to check if last week value > 0
            const hasCurrentWeekActivity = (weekArray) => {
                if (!Array.isArray(weekArray) || weekArray.length === 0) return false;
                const lastValue = weekArray[weekArray.length - 1];
                return lastValue > 0;
            };
            
            // Helper function to check if second-to-last week value > 0
            const hasPreviousWeekActivity = (weekArray) => {
                if (!Array.isArray(weekArray) || weekArray.length < 2) return false;
                const secondToLastValue = weekArray[weekArray.length - 2];
                return secondToLastValue > 0;
            };
            
            // Helper function to get last week value
            const getLastWeekValue = (weekArray) => {
                if (!Array.isArray(weekArray) || weekArray.length === 0) return 0;
                return weekArray[weekArray.length - 1] || 0;
            };
            
            // Tracking sets for unique itemCodes
            const currentWeekStockOutItems = new Set();
            const currentWeekWasteItems = new Set();
            const currentWeekUnusedItems = new Set();
            const currentWeekOverLoadItems = new Set();
            
            const previousWeekStockOutItems = new Set();
            const previousWeekWasteItems = new Set();
            const previousWeekUnusedItems = new Set();
            const previousWeekOverLoadItems = new Set();
            
            // Track locations for highest count analysis
            const stockOutLocationCounts = {};
            const wasteLocationCounts = {};
            const unusedLocationCounts = {};
            const overLoadLocationCounts = {};
            
            // Arrays to store all itemCodes for each category (for modal lists)
            const allStockOutItems = [];
            const allWasteItems = [];
            const allUnusedItems = [];
            const allOverLoadItems = [];
            
            // Group by location for organized display
            const locationGroups = {};
            
            areaData.forEach(area => {
                // Skip entries without itemCode or with empty location/sublocation
                if (!area.itemCode || !area.location || area.location === '' || !area.sublocation || area.sublocation === '') {
                    return;
                }
                
                const itemCode = area.itemCode;
                const location = area.location;
                const sublocation = area.sublocation;
                
                // Process each metric type
                // Stock Outs
                if (hasCurrentWeekActivity(area.stockOut)) {
                    currentWeekStockOutItems.add(itemCode);
                    const value = getLastWeekValue(area.stockOut);
                    
                    // Track by sublocation
                    const key = `${location}-${sublocation}`;
                    stockOutLocationCounts[key] = (stockOutLocationCounts[key] || 0) + value;
                    
                    allStockOutItems.push(itemCode);
                }
                if (hasPreviousWeekActivity(area.stockOut)) {
                    previousWeekStockOutItems.add(itemCode);
                }
                
                // Waste
                if (hasCurrentWeekActivity(area.waste)) {
                    currentWeekWasteItems.add(itemCode);
                    const value = getLastWeekValue(area.waste);
                    
                    const key = `${location}-${sublocation}`;
                    wasteLocationCounts[key] = (wasteLocationCounts[key] || 0) + value;
                    
                    allWasteItems.push(itemCode);
                }
                if (hasPreviousWeekActivity(area.waste)) {
                    previousWeekWasteItems.add(itemCode);
                }
                
                // Unused
                if (hasCurrentWeekActivity(area.unused)) {
                    currentWeekUnusedItems.add(itemCode);
                    const value = getLastWeekValue(area.unused);
                    
                    const key = `${location}-${sublocation}`;
                    unusedLocationCounts[key] = (unusedLocationCounts[key] || 0) + value;
                    
                    allUnusedItems.push(itemCode);
                }
                if (hasPreviousWeekActivity(area.unused)) {
                    previousWeekUnusedItems.add(itemCode);
                }
                
                // Overload
                if (hasCurrentWeekActivity(area.overLoad)) {
                    currentWeekOverLoadItems.add(itemCode);
                    const value = getLastWeekValue(area.overLoad);
                    
                    const key = `${location}-${sublocation}`;
                    overLoadLocationCounts[key] = (overLoadLocationCounts[key] || 0) + value;
                    
                    allOverLoadItems.push(itemCode);
                }
                if (hasPreviousWeekActivity(area.overLoad)) {
                    previousWeekOverLoadItems.add(itemCode);
                }
                
                // Group by location for organized display
                if (!locationGroups[area.location]) {
                    locationGroups[area.location] = {
                        location: area.location,
                        stockOuts: 0,
                        waste: 0,
                        unused: 0,
                        overLoad: 0,
                        sublocations: []
                    };
                }
                
                // Find or create sublocation entry
                let sublocationEntry = locationGroups[area.location].sublocations.find(
                    sub => sub.sublocation === area.sublocation
                );
                
                if (!sublocationEntry) {
                    sublocationEntry = {
                        sublocation: area.sublocation,
                        stockOut: 0,
                        stockOutItems: [],
                        waste: 0,
                        wasteItems: [],
                        unused: 0,
                        unusedItems: [],
                        overLoad: 0,
                        overLoadItems: []
                    };
                    locationGroups[area.location].sublocations.push(sublocationEntry);
                }
                
                // Add to sublocation counts if active this week
                if (hasCurrentWeekActivity(area.stockOut)) {
                    sublocationEntry.stockOut++;
                    sublocationEntry.stockOutItems.push(itemCode);
                    locationGroups[area.location].stockOuts++;
                }
                if (hasCurrentWeekActivity(area.waste)) {
                    sublocationEntry.waste++;
                    sublocationEntry.wasteItems.push(itemCode);
                    locationGroups[area.location].waste++;
                }
                if (hasCurrentWeekActivity(area.unused)) {
                    sublocationEntry.unused++;
                    sublocationEntry.unusedItems.push(itemCode);
                    locationGroups[area.location].unused++;
                }
                if (hasCurrentWeekActivity(area.overLoad)) {
                    sublocationEntry.overLoad++;
                    sublocationEntry.overLoadItems.push(itemCode);
                    locationGroups[area.location].overLoad++;
                }
            });
            
            // Find highest count sublocations
            const findHighestCountLocations = (locationCounts) => {
                if (Object.keys(locationCounts).length === 0) return [];
                const maxCount = Math.max(...Object.values(locationCounts));
                return Object.entries(locationCounts)
                    .filter(([key, count]) => count === maxCount)
                    .map(([key, count]) => ({ location: key, count }));
            };
            
            const highestStockOutLocations = findHighestCountLocations(stockOutLocationCounts);
            const highestWasteLocations = findHighestCountLocations(wasteLocationCounts);
            const highestUnusedLocations = findHighestCountLocations(unusedLocationCounts);
            const highestOverLoadLocations = findHighestCountLocations(overLoadLocationCounts);
            
            // Store processed Pyxis metrics in MOCK_DATA
            MOCK_DATA.pyxisMetrics = {
                totals: {
                    stockOuts: currentWeekStockOutItems.size,
                    waste: currentWeekWasteItems.size,
                    unused: currentWeekUnusedItems.size,
                    overLoad: currentWeekOverLoadItems.size
                },
                trends: {
                    stockOuts: previousWeekStockOutItems.size,
                    waste: previousWeekWasteItems.size,
                    unused: previousWeekUnusedItems.size,
                    overLoad: previousWeekOverLoadItems.size
                },
                highestCountLocations: {
                    stockOut: highestStockOutLocations,
                    waste: highestWasteLocations,
                    unused: highestUnusedLocations,
                    overLoad: highestOverLoadLocations
                },
                byLocation: Object.values(locationGroups),
                allItems: {
                    stockOut: allStockOutItems,
                    waste: allWasteItems,
                    unused: allUnusedItems,
                    overLoad: allOverLoadItems
                },
                areaData: areaData  // Include raw stockOutsByArea for trend calculation
            };
            
            console.log(`✓ Pyxis Metrics processed (NEW FORMAT):`, {
                currentWeek: {
                    stockOuts: currentWeekStockOutItems.size,
                    waste: currentWeekWasteItems.size,
                    unused: currentWeekUnusedItems.size,
                    overLoad: currentWeekOverLoadItems.size
                },
                previousWeek: {
                    stockOuts: previousWeekStockOutItems.size,
                    waste: previousWeekWasteItems.size,
                    unused: previousWeekUnusedItems.size,
                    overLoad: previousWeekOverLoadItems.size
                },
                locations: Object.keys(locationGroups).length,
                highestCounts: {
                    stockOut: highestStockOutLocations,
                    waste: highestWasteLocations,
                    unused: highestUnusedLocations,
                    overLoad: highestOverLoadLocations
                }
            });
            
            // STEP 6: Calculate Waste Costs by Week (for Analytics mini chart)
            console.log('📊 Calculating waste costs by week...');
            const wasteCostsByWeek = [];
            const itemsWithWaste = MOCK_DATA.items.filter(item => item.wasteRate && Array.isArray(item.wasteRate));
            
            // Find max week count
            let maxWeeks = 13;
            itemsWithWaste.forEach(item => {
                if (item.wasteRate && item.wasteRate.length > maxWeeks) {
                    maxWeeks = item.wasteRate.length;
                }
            });
            
            // Initialize array
            for (let i = 0; i < maxWeeks; i++) {
                wasteCostsByWeek[i] = 0;
            }
            
            // Sum waste costs across all items for each week
            itemsWithWaste.forEach(item => {
                const unitPrice = parseFloat(item.unitPrice) || 0;
                item.wasteRate.forEach((wasteQty, weekIndex) => {
                    if (weekIndex < maxWeeks) {
                        wasteCostsByWeek[weekIndex] += (wasteQty || 0) * unitPrice;
                    }
                });
            });
            
            MOCK_DATA.wasteCostsByWeek = wasteCostsByWeek;
            console.log(`✓ Waste costs by week calculated: ${wasteCostsByWeek.length} weeks`);
            
            // Log a sample to verify restockRate
            if (MOCK_DATA.items.length > 0) {
                console.log('📊 Sample item with restockRate:', {
                    description: MOCK_DATA.items[0].description,
                    usageRate: MOCK_DATA.items[0].usageRate,
                    restockRate: MOCK_DATA.items[0].restockRate
                });
            }
            
            // Cache reference to the now-processed data
            cachedProcessedData = MOCK_DATA;
            return MOCK_DATA;
        }
        /**
         * Listen for data requests from iframes
         */
        window.addEventListener('message', function(event) {
            console.log('📨 Dashboard received message:', event.data);

            // Ack from Charts to stop retrying direct navigation messages
            window.__directNavPending = window.__directNavPending || {};
            if (event && event.data && event.data.type === 'directNavAck' && event.data.navId) {
                const navId = String(event.data.navId);
                if (window.__directNavPending[navId]) {
                    window.__directNavPending[navId].acked = true;
                    (window.__directNavPending[navId].timers || []).forEach(t => { try { clearTimeout(t); } catch(e) {} });
                    delete window.__directNavPending[navId];
                }
                return;
            }

            // Mirror chart projection state from Charts iframe for debugging under file://
            if (event && event.data && event.data.type === 'COST_CHART_STATE') {
                try {
                    const p = event.data.payload || {};
                    if (!window.costChartState) window.costChartState = {};
                    if (p.projUsageCI) window.costChartState._projUsageCI = p.projUsageCI;
                    if (p.projUsageSigmaRel != null) window.costChartState._projUsageSigmaRel = p.projUsageSigmaRel;
                    if (p.projUsagePiMethod) window.costChartState._projUsagePiMethod = p.projUsagePiMethod;
                    if (p.projUsagePiN != null) window.costChartState._projUsagePiN = p.projUsagePiN;
                    window.costChartState._mirrorMeta = { view: p.view, drillLevel: p.drillLevel };
                    window.costChartState._lastMirroredAt = new Date().toISOString();
                } catch (e) {
                    // ignore
                }
                return;
            }

            
            
            // Handle data requests
            if (event.data.type === 'requestMockData') {
                console.log('📦 Data request received from iframe');

                // If parent is still initializing, defer responding so the iframe doesn't render a
                // permanent empty state (common on reload / network drive file://).
                if (!__mockDataReady || !MOCK_DATA || !MOCK_DATA.items) {
                    console.warn('⚠️ MOCK_DATA not ready yet - deferring response until ready');
                    if (event.source && !__pendingMockDataRequests.includes(event.source)) {
                        __pendingMockDataRequests.push(event.source);
                    }
                    return;
                }

                const computed = getProcessedMockData();
                const raw = getRawMockData();

                event.source.postMessage({
                    type: 'mockDataResponse',
                    data: computed,
                    computed: computed,
                    raw: raw
                }, '*');

                console.log('✓ Mock data sent to iframe');
            }

            // Ensure a date range of monthly transaction scripts is loaded (Charts on-demand)
            if (event.data.type === 'ensureTxRange') {
                const fromISO = event.data.fromISO;
                const toISO = event.data.toISO;
                const reqId = event.data.reqId || null;

                // De-duplicate repeated range requests (Charts can ask multiple times during redraw).
                // We key by the exact ISO range and fan-out responses to each requester.
                window.__ensureTxRangeInflight = window.__ensureTxRangeInflight || {};
                const rangeKey = String(fromISO || '') + '|' + String(toISO || '');

                const loader = window.InventoryApp && window.InventoryApp.DataLoader;
                if (!loader || typeof loader.ensureRangeLoaded !== 'function') {
                    event.source && event.source.postMessage({ type: 'txRangeReady', ok: false, reqId: reqId, error: 'DataLoader.ensureRangeLoaded not available' }, '*');
                    return;
                }

                const inflight = window.__ensureTxRangeInflight[rangeKey];
                const respond = (payload) => {
                    const base = { type: 'txRangeReady', reqId: reqId, fromISO: fromISO, toISO: toISO, rangeKey: rangeKey };
                    try { event.source && event.source.postMessage(Object.assign(base, payload), '*'); } catch (e) {}
                };

                if (inflight && inflight.promise) {
                    // Attach to existing promise.
                    inflight.promise.then((info) => respond({ ok: true, info })).catch((err) => respond({ ok: false, error: String(err && err.message ? err.message : err) }));
                    return;
                }

                const p = loader.ensureRangeLoaded(fromISO, toISO, { yieldEvery: 1, yieldMs: 0 }).then((info) => {
                    // Invalidate caches so subsequent mockDataResponse includes newly merged months.
                    cachedRawData = null;
                    cachedProcessedData = null;
                    return info;
                });

                window.__ensureTxRangeInflight[rangeKey] = { promise: p, startedAt: Date.now() };

                p.then((info) => {
                    delete window.__ensureTxRangeInflight[rangeKey];
                    respond({ ok: true, info: info });
                }).catch((err) => {
                    delete window.__ensureTxRangeInflight[rangeKey];
                    respond({ ok: false, error: String(err && err.message ? err.message : err) });
                });
            }
            
            // Handle navigation requests
            if (event.data.type === 'navigateToTab') {
                console.log('🔀 Navigation request received:', event.data.tab, 'isBackNav:', event.data.isBackNavigation);
                window.__lastIsBackNavigation = (event.data.isBackNavigation === true);
                
                // Capture referrer BEFORE tab switch
                const referrerForCard = currentTab;
                
                // Handle 'shortage' tab as 'inventory' tab (for compatibility)
                let tab = event.data.tab;
                if (tab === 'shortage') {
                    tab = 'inventory';
                    console.log('📋 Remapping shortage tab to inventory tab');
                }
                
                // Find the tab button and trigger click based on the requested tab
                const tabButton = document.querySelector(`[data-tab="${tab}"]`);
                
                if (tabButton) {
                    // Only disable referrer sending if this is back button navigation
                    if (event.data.isBackNavigation === true) {
                        // Back navigation: preserve tab state, but still inform the target tab
                        // of the referrer so it can restore UI state (e.g., analytics returning
                        // from inventory). We just skip the automatic clearFilters.
                        sendReferrerOnSwitch = true;
                        skipNextClearFilters = true;
                        console.log('📍 Back button navigation detected - referrer will be sent, clearFilters skipped');
                    } else {
                        console.log('📍 Card navigation detected - referrer will be sent:', referrerForCard);
                    }
                    
                    tabButton.click();
                    console.log(`✓ Navigated to ${tab} tab from ${referrerForCard}`);
                    
                    // Only send filter instruction if navigating to inventory AND it's NOT back navigation
                    // Back navigation should preserve the page's current state
                    if (tab === 'inventory' && event.data.isBackNavigation !== true) {
                        setTimeout(() => {
                            const inventoryFrame = document.getElementById('inventoryFrame');
                            if (inventoryFrame && inventoryFrame.contentWindow) {
                                // Only send filter message if there's actually a filter
                                if (event.data.filter) {
                                    const filterMessage = {
                                        type: 'navigateWithFilter',
                                        filter: event.data.filter,
                                        value: event.data.value || null,
                                        referrer: referrerForCard
                                    };
                                    
                                    // Add itemCodes for filters that provide explicit item lists
                                    if ((event.data.filter === 'fdaShortages' || event.data.filter === 'expiringSoon' || event.data.filter === 'projectedWasteSpike') && event.data.itemCodes) {
                                        filterMessage.itemCodes = event.data.itemCodes;
                                        console.log('✓ Including', event.data.itemCodes.length, 'itemCodes for', event.data.filter, 'filter');
                                    }
                                    
                                    inventoryFrame.contentWindow.postMessage(filterMessage, '*');
                                    console.log('✓ Sent filter instruction to inventory/shortage bulletin with referrer:', referrerForCard);
                                } else {
                                    console.log('✓ Navigated to inventory without filter - showing current state');
                                }
                            }
                        }, 500);
                    } else if (tab === 'inventory' && event.data.isBackNavigation === true) {
                        console.log('🔙 Back navigation to inventory - preserving current state (no filter message sent)');
                    }
                } else {
                    console.warn('⚠️ Tab button not found for:', tab);
                }
            }
            
            // Handle navigation to Charts with trending items filter
            if (event.data.type === 'navigateToChartsWithFilter') {
                console.log('📊 Navigate to Charts with filter request received');
                console.log('   Filter type:', event.data.filterType);
                console.log('   Item codes:', event.data.itemCodes ? event.data.itemCodes.length : 0);
                
                const referrerForCard = currentTab;
                
                // First, switch to analytics tab
                const analyticsButton = document.querySelector('[data-tab="analytics"]');
                if (analyticsButton) {
                    console.log('📍 Card navigation detected - referrer will be sent:', referrerForCard);
                    analyticsButton.click();
                    console.log('✓ Navigated to analytics tab');
                    
                    // Then send filter to Charts page after a delay
                    setTimeout(() => {
                        const analyticsFrame = document.getElementById('analyticsFrame');
                        if (analyticsFrame && analyticsFrame.contentWindow) {
                            analyticsFrame.contentWindow.postMessage({
                                type: 'applyTrendingItemsFilter',
                                itemCodes: event.data.itemCodes,
                                filterType: event.data.filterType,
                                threshold: event.data.threshold
                            }, '*');
                            console.log('✓ Sent trending items filter to Charts:', event.data.itemCodes.length, 'items');
                        } else {
                            console.error('❌ Could not find analyticsFrame');
                        }
                    }, 500); // Wait for tab switch and iframe load
                } else {
                    console.warn('⚠️ Analytics tab button not found');
                }
            }

            // Handle direct chart navigation actions from Analytics UI (no filter chips):
            //  - drillToItemInVerticalBar: switch to Charts tab and instruct Charts to drill Class→Name→Description
            //  - navigateToFlowFromStockoutSegment: switch to Charts tab and instruct Charts to open Flow view with item+sublocation constraint
            if (event.data && (event.data.type === 'drillToItemInVerticalBar' || event.data.type === 'navigateToFlowFromStockoutSegment')) {
                try {
                    const referrerForCard = currentTab;
                    // Prevent automatic clearFilters on tab switch for these targeted navigations
                    window.skipNextClearFilters = true;

                    const analyticsButton = document.querySelector('[data-tab="analytics"]');
                    if (analyticsButton) {
                        console.log('📍 Direct chart navigation detected - switching to analytics tab:', event.data.type);
                        analyticsButton.click();

                        
                        // Send with retry-until-ack (prevents duplicate deliveries when Charts is already ready)
                        window.__directNavSig = window.__directNavSig || {};
                        const navSig = JSON.stringify({ type: event.data.type, itemCode: event.data.itemCode || '', sublocation: event.data.sublocation || '', location: event.data.location || '' });
                        if (window.__directNavSig[navSig] && window.__directNavSig[navSig].ts && (Date.now() - window.__directNavSig[navSig].ts) < 2500) {
                            return;
                        }
                        const navId = 'nav_' + Math.random().toString(36).slice(2) + '_' + Date.now();
                        window.__directNavSig[navSig] = { ts: Date.now(), navId: navId };
                        window.__directNavPending = window.__directNavPending || {};
                        window.__directNavPending[navId] = { acked: false, timers: [] };
                        
                        const sendWithDelay = (delayMs) => {
                            const t = setTimeout(() => {
                                if (!window.__directNavPending[navId] || window.__directNavPending[navId].acked) return;
                                const analyticsFrame = document.getElementById('analyticsFrame');
                                if (analyticsFrame && analyticsFrame.contentWindow) {
                                    const payload = Object.assign({ referrer: referrerForCard, navId: navId }, event.data);
                                    analyticsFrame.contentWindow.postMessage(payload, '*');
                                    console.log('✓ Sent direct chart navigation to Charts iframe:', event.data.type, '(attempt)', delayMs, 'navId', navId);
                                } else {
                                    console.warn('⚠️ Analytics/Charts iframe not found or not ready for', event.data.type, '(attempt)', delayMs);
                                }
                            }, delayMs);
                            window.__directNavPending[navId].timers.push(t);
                        };
                        // Staggered attempts; will stop automatically on ack
                        sendWithDelay(250);
                        sendWithDelay(800);
                        sendWithDelay(1400);

                    } else {
                        console.warn('⚠️ Analytics tab button not found for', event.data.type);
                    }
                } catch (e) {
                    console.warn('⚠️ Direct chart navigation handler failed', e);
                }
            }
            
            // Handle navigateToPage requests from Analytics (for inventory cost metrics)
            if (event.data.type === 'navigateToPage' && event.data.page === 'charts') {
                console.log('📊 Navigate to Charts page request:', event.data);
                
                // Set flag to prevent automatic clearFilters
                window.skipNextClearFilters = true;
                
                // Switch to analytics tab (which contains the Charts iframe)
                const chartsButton = document.querySelector('[data-tab="analytics"]');
                if (chartsButton) {
                    chartsButton.click();
                    console.log('✓ Switched to Analytics/Charts tab');
                    
                    // Wait longer for iframe to load and be ready (1 second)
                    setTimeout(() => {
                        const analyticsFrame = document.getElementById('analyticsFrame');
                        if (analyticsFrame && analyticsFrame.contentWindow) {
                            // Forward the entire message to Charts iframe
                            analyticsFrame.contentWindow.postMessage(event.data, '*');
                            console.log('✓ Forwarded navigation data to Charts iframe:', event.data);
                        } else {
                            console.warn('⚠️ Analytics/Charts iframe not found or not ready');
                        }
                    }, 1000);
                } else {
                    console.warn('⚠️ Analytics tab button not found');
                }
            }
            
            // Handle requestItemsByCode from Analytics iframe (for Pyxis modal)
            if (event.data.type === 'requestItemsByCode' && event.data.itemCodes) {
                console.log('📦 Request for items by code received:', event.data.itemCodes.length, 'codes');
                
                const requestedCodes = event.data.itemCodes;
                const items = [];
                
                // Find items in MOCK_DATA
                requestedCodes.forEach(code => {
                    const item = MOCK_DATA.items.find(i => i.itemCode === code);
                    if (item) {
                        items.push(item);
                    }
                });
                
                console.log('✓ Found', items.length, 'items out of', requestedCodes.length, 'requested');
                
                // Send items back to requesting iframe
                if (event.source) {
                    event.source.postMessage({
                        type: 'itemsByCodeResponse',
                        items: items
                    }, '*');
                    console.log('✓ Items sent to Analytics iframe');
                }
            }
            
            // Handle stockout modal open request
            if (event.data.type === 'openStockoutModal') {
                console.log('📊 Stockout modal request received');
                openStockoutModal();
            }
            
            // Handle FDA count request from Analytics iframe
            if (event.data.type === 'requestFDACount') {
                console.log('📊 FDA count request received from Analytics');
                
                // Get FDA shortage count
                getFDAShortageCount().then(count => {
                    // Send count back to the requesting iframe using event.source
                    if (event.source) {
                        event.source.postMessage({
                            type: 'fdaCountResponse',
                            count: count
                        }, '*');
                        console.log('✓ Sent FDA count to Analytics via event.source:', count);
                    } else {
                        // Fallback: use analyticsFrame
                        const analyticsFrame = document.getElementById('analyticsFrame');
                        if (analyticsFrame && analyticsFrame.contentWindow) {
                            analyticsFrame.contentWindow.postMessage({
                                type: 'fdaCountResponse',
                                count: count
                            }, '*');
                            console.log('✓ Sent FDA count to Analytics via iframe:', count);
                        }
                    }
                }).catch(error => {
                    console.error('❌ Error getting FDA count:', error);
                    // Send 0 on error
                    if (event.source) {
                        event.source.postMessage({
                            type: 'fdaCountResponse',
                            count: 0
                        }, '*');
                    } else {
                        const analyticsFrame = document.getElementById('analyticsFrame');
                        if (analyticsFrame && analyticsFrame.contentWindow) {
                            analyticsFrame.contentWindow.postMessage({
                                type: 'fdaCountResponse',
                                count: 0
                            }, '*');
                        }
                    }
                });
            }
            
            // Handle request for FDA filtered items (for Shortage Bulletin navigation)
            if (event.data.type === 'requestFDAFilteredItems') {
                console.log('📊 FDA filtered items request received from Analytics');
                
                // Get FDA filtered items (those that meet the criteria)
                getFDAFilteredItems().then(itemCodes => {
                    // Send itemCodes back to Analytics
                    if (event.source) {
                        event.source.postMessage({
                            type: 'fdaFilteredItemsResponse',
                            itemCodes: itemCodes
                        }, '*');
                        console.log('✓ Sent', itemCodes.length, 'FDA filtered itemCodes to Analytics');
                    }
                }).catch(error => {
                    console.error('❌ Error getting FDA filtered items:', error);
                    if (event.source) {
                        event.source.postMessage({
                            type: 'fdaFilteredItemsResponse',
                            itemCodes: []
                        }, '*');
                    }
                });
            }
            
            // Handle waste modal open request
            if (event.data.type === 'openWasteModal') {
                console.log('📊 Waste modal request received');
                openWasteModal();
            }
            
            // Handle unused modal open request
            if (event.data.type === 'openUnusedModal') {
                console.log('📊 Unused modal request received');
                openUnusedModal();
            }
            
            // Handle excessive loads modal open request
            if (event.data.type === 'openOverloadModal') {
                console.log('📊 Excessive loads modal request received');
                openOverloadModal();
            }
            
            // Handle analytics navigation with filter
            if (event.data.type === 'OPEN_ANALYTICS') {
                console.log('========================================');
                console.log('📊 OPEN_ANALYTICS message received!');
                console.log('📦 Filter data:', event.data.data);
                console.log('📤 Event source:', event.source);
                console.log('========================================');
                
                // Capture the previous tab BEFORE switching
                const previousTabForReferrer = currentTab;
                console.log('📍 Previous tab for referrer:', previousTabForReferrer);
                
                // Disable switchTab's referrer notification (we'll handle it ourselves)
                sendReferrerOnSwitch = false;
                
                // Switch to Analytics tab using switchTab function directly
                console.log('🔄 Calling switchTab("analytics")...');
                switchTab('analytics');
                console.log('✓ Tab switch triggered');
                
                // Send filter instruction to analytics iframe WITH referrer
                setTimeout(() => {
                    console.log('⏰ Timeout fired after 1000ms');
                    const analyticsFrame = document.getElementById('analyticsFrame');
                    console.log('🖼️ Found analyticsFrame:', analyticsFrame);
                    
                    if (analyticsFrame && analyticsFrame.contentWindow) {
                        console.log('📤 Sending message to analyticsFrame with referrer:', previousTabForReferrer);
                        analyticsFrame.contentWindow.postMessage({
                            type: 'applyFilterWithHighlight',
                            filterData: event.data.data,
                            referrer: previousTabForReferrer
                        }, '*');
                        console.log('✓ Message sent to analyticsFrame');
                    } else {
                        console.error('❌ analyticsFrame or contentWindow not found');
                    }
                }, 1000); // Wait for tab switch and iframe load
            }
        });
        
        /**
         * Get mock data (for direct access if needed)
         */
        window.getMockData = function() {
            return MOCK_DATA;
        };
        
        // Data will be processed on first request from iframe
        console.log('✓ PostMessage communication system ready');
        
        // ==================================================================================
        // STOCKOUT MODAL FUNCTIONALITY
        // ==================================================================================
        
        /**
         * Open stockout details modal
         */
        /**
         * Generic function to display category modal
         * @param {string} category - 'stockOut', 'waste', 'unused', 'overLoad'
         * @param {string} modalId - ID of the modal element
         * @param {string} containerId - ID of the container element
         * @param {string} title - Display title for the category
         */
        function displayCategoryModal(category, modalId, containerId, title) {
            console.log(`🎬 displayCategoryModal called:`, {category, modalId, containerId, title});
            
            const metrics = MOCK_DATA.pyxisMetrics;
            if (!metrics) {
                console.warn('❌ No Pyxis metrics available');
                return;
            }
            
            console.log('✓ Metrics found:', metrics.totals);
            
            const modal = document.getElementById(modalId);
            const container = document.getElementById(containerId);
            
            if (!modal || !container) {
                console.warn(`❌ Modal or container not found: ${modalId}, ${containerId}`);
                return;
            }
            
            console.log('✓ Modal and container elements found');
            
            // Collect all items with details for this category
            const allItems = [];
            const itemFrequency = {};
            
            metrics.byLocation.forEach(location => {
                location.sublocations.forEach(sub => {
                    const items = sub[category + 'Items'];
                    if (items && items.length > 0) {
                        items.forEach(itemCode => {
                            const itemCodeStr = String(itemCode);
                            const item = MOCK_DATA.items.find(d => d.itemCode === itemCodeStr);
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
            
            // Sort by price initially (highest to lowest)
            allItems.sort((a, b) => b.unitPrice - a.unitPrice);
            
            // Store in window for re-sorting
            const dataKey = modalId.replace('Modal', 'ModalData');
            window[dataKey] = {
                allItems: allItems,
                itemFrequency: itemFrequency,
                currentSort: 'cost',
                category: category,
                modalId: modalId,
                containerId: containerId,
                title: title
            };
            
            // Render the content
            renderCategoryModalContent(modalId);
            
            // Show modal with animation
            modal.style.visibility = 'visible';
            modal.style.opacity = '1';
            modal.style.pointerEvents = 'auto';
            modal.classList.add('active');
            
            console.log(`✅ Modal ${modalId} should now be visible`);
        }
        
        function renderCategoryModalContent(modalId) {
            const dataKey = modalId.replace('Modal', 'ModalData');
            const data = window[dataKey];
            
            if (!data) {
                console.warn('No data found for', modalId);
                return;
            }
            
            const container = document.getElementById(data.containerId);
            if (!container) return;
            
            if (!data.allItems || data.allItems.length === 0) {
                container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No ${data.title.toLowerCase()} items found</div>`;
                return;
            }
            
            // Apply price filter
            const minPrice = data.minPrice || 0;
            let filteredItems = data.allItems.filter(item => item.unitPrice >= minPrice);
            
            // Sort items based on current sort mode
            let sortedItems = [...filteredItems];
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
                case 'location':
                    sortedItems.sort((a, b) => {
                        const locCompare = a.location.localeCompare(b.location);
                        if (locCompare !== 0) return locCompare;
                        return a.sublocation.localeCompare(b.sublocation);
                    });
                    break;
            }
            
            if (sortedItems.length === 0) {
                container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No items found matching filter criteria (Min price: $${minPrice.toFixed(2)})</div>`;
                return;
            }
            
            // Calculate summary stats from filtered items
            const highestCostItem = sortedItems.reduce((max, item) => 
                item.unitPrice > max.unitPrice ? item : max, sortedItems[0]);
            
            const mostFrequentItem = sortedItems.reduce((max, item) => {
                const freq = data.itemFrequency[item.itemCode];
                const maxFreq = data.itemFrequency[max.itemCode];
                return freq > maxFreq ? item : max;
            }, sortedItems[0]);
            
            const mostFrequentCount = data.itemFrequency[mostFrequentItem.itemCode];
            
            // Calculate max price from all items (not filtered)
            const maxPrice = Math.max(...data.allItems.map(item => item.unitPrice));
            
            // Build HTML
            const modalPrefix = modalId.replace('Modal', '');
            const selectId = `${modalPrefix}SortSelect`;
            const filterPanelId = `${modalPrefix}FilterPanel`;
            const filterSliderId = `${modalPrefix}PriceSlider`;
            
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
                
                <!-- Sort and Filter Controls -->
                <div class="modal-controls-section">
                    <div class="modal-sort-control">
                        <select class="modal-sort-select" id="${selectId}" onchange="changeCategorySort('${modalId}', this.value)">
                            <option value="cost" ${data.currentSort === 'cost' ? 'selected' : ''}>Cost</option>
                            <option value="description" ${data.currentSort === 'description' ? 'selected' : ''}>Item Description</option>
                            <option value="frequency" ${data.currentSort === 'frequency' ? 'selected' : ''}>Frequency</option>
                            <option value="location" ${data.currentSort === 'location' ? 'selected' : ''}>Location</option>
                        </select>
                    </div>
                    <div class="modal-filter-control">
                        <button class="modal-filter-button" onclick="toggleFilterPanel('${filterPanelId}')">
                            <span>Filter</span>
                            <svg viewBox="0 0 24 24"><path d="M14,12V19.88C14.04,20.18 13.94,20.5 13.71,20.71C13.32,21.1 12.69,21.1 12.3,20.71L10.29,18.7C10.06,18.47 9.96,18.16 10,17.87V12H9.97L4.21,4.62C3.87,4.19 3.95,3.56 4.38,3.22C4.57,3.08 4.78,3 5,3V3H19V3C19.22,3 19.43,3.08 19.62,3.22C20.05,3.56 20.13,4.19 19.79,4.62L14.03,12H14Z"/></svg>
                        </button>
                    </div>
                </div>
                
                <!-- Filter Slider Panel -->
                <div class="filter-slider-panel" id="${filterPanelId}">
                    <div class="filter-panel-header">
                        <div class="filter-panel-title">Filter Options</div>
                        <button class="filter-panel-close" onclick="toggleFilterPanel('${filterPanelId}')">&times;</button>
                    </div>
                    <div class="filter-panel-body">
                        <div class="filter-group">
                            <div class="filter-group-title">Price Range</div>
                            <div class="price-range-display">
                                <div>
                                    <div class="price-range-label">Minimum Price</div>
                                    <div class="price-range-value" id="${modalPrefix}MinPriceDisplay">$${minPrice.toFixed(2)}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div class="price-range-label">Maximum</div>
                                    <div class="price-range-value">$${maxPrice.toFixed(2)}</div>
                                </div>
                            </div>
                            <div class="price-slider-container">
                                <input type="range" 
                                       class="price-slider" 
                                       id="${filterSliderId}"
                                       min="0" 
                                       max="${maxPrice}" 
                                       step="0.01" 
                                       value="${minPrice}"
                                       oninput="updatePriceDisplay('${modalPrefix}', this.value)">
                            </div>
                        </div>
                    </div>
                    <div class="filter-actions">
                        <button class="filter-button-reset" onclick="resetCategoryFilter('${modalId}', '${filterPanelId}')">Reset</button>
                        <button class="filter-button-apply" onclick="applyCategoryFilter('${modalId}', '${filterPanelId}')">Apply Filter</button>
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
            
            // Build location cards (accordion style - only one open at a time)
            Object.keys(locationGroups).forEach((location, locIdx) => {
                const sublocations = locationGroups[location];
                const totalCount = Object.values(sublocations).reduce((sum, items) => sum + items.length, 0);
                
                if (totalCount > 0) {
                    html += `
                        <div class="area-card" id="${modalPrefix}-location-${locIdx}">
                            <div class="area-card-header" onclick="toggleCategoryLocation('${modalPrefix}', ${locIdx})">
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
            
            container.innerHTML = html;
            console.log(`✓ Rendered ${modalId} with sorting, filtering, and summary cards`);
        }
        
        function changeCategorySort(modalId, sortType) {
            const dataKey = modalId.replace('Modal', 'ModalData');
            if (window[dataKey]) {
                window[dataKey].currentSort = sortType;
                renderCategoryModalContent(modalId);
            }
        }
        
        function toggleCategoryLocation(modalPrefix, locIdx) {
            // Close all other locations first (accordion behavior)
            document.querySelectorAll(`[id^="${modalPrefix}-location-"]`).forEach(card => {
                if (card.id !== `${modalPrefix}-location-${locIdx}`) {
                    card.classList.remove('expanded');
                }
            });
            
            // Toggle the clicked location
            const card = document.getElementById(`${modalPrefix}-location-${locIdx}`);
            if (card) {
                card.classList.toggle('expanded');
            }
        }
        
        // Filter Panel Functions
        function toggleFilterPanel(panelId) {
            const panel = document.getElementById(panelId);
            if (panel) {
                const isActive = panel.classList.contains('active');
                
                if (!isActive) {
                    // Get the filter button position to place panel below it
                    const filterButton = document.querySelector('.modal-filter-button');
                    if (filterButton) {
                        const rect = filterButton.getBoundingClientRect();
                        panel.style.top = `${rect.bottom + 8}px`;
                        panel.style.left = `${rect.right - 320}px`; // Align to right edge of button
                    }
                    
                    // Opening - add click-away listener
                    panel.classList.add('active');
                    setTimeout(() => {
                        document.addEventListener('click', function closeOnClickAway(e) {
                            if (!panel.contains(e.target) && !e.target.closest('.modal-filter-button')) {
                                panel.classList.remove('active');
                                document.removeEventListener('click', closeOnClickAway);
                            }
                        });
                    }, 100);
                } else {
                    // Closing
                    panel.classList.remove('active');
                }
            }
        }
        
        function updatePriceDisplay(modalPrefix, value) {
            const displayElement = document.getElementById(`${modalPrefix}MinPriceDisplay`);
            if (displayElement) {
                displayElement.textContent = `$${parseFloat(value).toFixed(2)}`;
            }
        }
        
        function applyCategoryFilter(modalId, filterPanelId) {
            const dataKey = modalId.replace('Modal', 'ModalData');
            const modalPrefix = modalId.replace('Modal', '');
            const slider = document.getElementById(`${modalPrefix}PriceSlider`);
            
            if (window[dataKey] && slider) {
                window[dataKey].minPrice = parseFloat(slider.value);
                renderCategoryModalContent(modalId);
                toggleFilterPanel(filterPanelId);
            }
        }
        
        function resetCategoryFilter(modalId, filterPanelId) {
            const dataKey = modalId.replace('Modal', 'ModalData');
            const modalPrefix = modalId.replace('Modal', '');
            const slider = document.getElementById(`${modalPrefix}PriceSlider`);
            
            if (window[dataKey] && slider) {
                window[dataKey].minPrice = 0;
                slider.value = 0;
                updatePriceDisplay(modalPrefix, 0);
                renderCategoryModalContent(modalId);
                toggleFilterPanel(filterPanelId);
            }
        }
        
        // Toggle functions for modal expandable lists
        function toggleModalLocation(locId) {
            const card = document.getElementById(locId);
            if (card) {
                card.classList.toggle('expanded');
            }
        }
        
        function toggleModalSublocation(sublocId) {
            const item = document.getElementById(sublocId);
            if (item) {
                item.classList.toggle('expanded');
            }
        }
        
        /**
         * Open Stock Out Modal
         */
        function openStockoutModal() {
            displayCategoryModal('stockOut', 'stockoutModal', 'stockoutListContainer', 'Stock Out');
        }
        
        /**
         * Close Stock Out Modal
         */
        function closeStockoutModal() {
            const modal = document.getElementById('stockoutModal');
            modal.classList.add('closing');
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.remove('closing');
                modal.style.visibility = 'hidden';
            }, 300);
        }
        
        /**
         * Open Waste Modal
         */
        function openWasteModal() {
            displayCategoryModal('waste', 'wasteModal', 'wasteSummaryContainer', 'Wasted Items');
        }
        
        /**
         * Close Waste Modal
         */
        function closeWasteModal() {
            const modal = document.getElementById('wasteModal');
            modal.classList.add('closing');
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.remove('closing');
                modal.style.visibility = 'hidden';
            }, 300);
        }
        
        /**
         * Open Unused Modal
         */
        function openUnusedModal() {
            displayCategoryModal('unused', 'unusedModal', 'unusedSummaryContainer', 'Unused Items');
        }
        
        /**
         * Close Unused Modal
         */
        function closeUnusedModal() {
            const modal = document.getElementById('unusedModal');
            modal.classList.add('closing');
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.remove('closing');
                modal.style.visibility = 'hidden';
            }, 300);
        }
        
        /**
         * Open Overload Modal
         */
        function openOverloadModal() {
            displayCategoryModal('overLoad', 'overloadModal', 'overloadSummaryContainer', 'Overloaded Items');
        }
        
        /**
         * Close Overload Modal
         */
        function closeOverloadModal() {
            const modal = document.getElementById('overloadModal');
            modal.classList.add('closing');
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.remove('closing');
                modal.style.visibility = 'hidden';
            }, 300);
        }
        
        // ==================================================================================
        // MODAL SCROLL ARROW SYSTEM
        // ==================================================================================
        
        /**
         * Update scroll arrow visibility for a container
         */
        function updateModalScrollArrows(container, upArrow, downArrow) {
            if (!container || !upArrow || !downArrow) return;
            
            const scrollTop = container.scrollTop;
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;
            const isScrollable = scrollHeight > clientHeight + 5;
            const atTop = scrollTop <= 5;
            const atBottom = (scrollHeight - scrollTop - clientHeight) <= 5;
            
            if (isScrollable) {
                upArrow.classList.toggle('visible', !atTop);
                upArrow.classList.toggle('hidden', atTop);
                downArrow.classList.toggle('visible', !atBottom);
                downArrow.classList.toggle('hidden', atBottom);
            } else {
                upArrow.classList.remove('visible');
                upArrow.classList.add('hidden');
                downArrow.classList.remove('visible');
                downArrow.classList.add('hidden');
            }
        }
        
        /**
         * Setup scroll arrows for a modal
         */
        function setupModalScrollArrows(modalId, bodyId, upId, downId) {
            const modal = document.getElementById(modalId);
            const modalBody = document.getElementById(bodyId);
            const upArrow = document.getElementById(upId);
            const downArrow = document.getElementById(downId);
            
            if (!modal || !modalBody || !upArrow || !downArrow) {
                console.warn(`Scroll arrows not found for ${modalId}`);
                return;
            }
            
            // Click handlers
            upArrow.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                modalBody.scrollBy({ top: -300, behavior: 'smooth' });
                setTimeout(() => updateModalScrollArrows(modalBody, upArrow, downArrow), 400);
            };
            
            downArrow.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                modalBody.scrollBy({ top: 300, behavior: 'smooth' });
                setTimeout(() => updateModalScrollArrows(modalBody, upArrow, downArrow), 400);
            };
            
            // Scroll listener
            modalBody.addEventListener('scroll', () => {
                updateModalScrollArrows(modalBody, upArrow, downArrow);
            }, { passive: true });
            
            // Observer to update arrows when modal opens/closes
            const observer = new MutationObserver(() => {
                if (modal.classList.contains('active')) {
                    // Modal opened - update arrows after short delay
                    setTimeout(() => updateModalScrollArrows(modalBody, upArrow, downArrow), 100);
                } else {
                    // Modal closed - hide arrows
                    upArrow.classList.remove('visible');
                    upArrow.classList.add('hidden');
                    downArrow.classList.remove('visible');
                    downArrow.classList.add('hidden');
                }
            });
            observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
            
            console.log(`✓ Scroll arrows initialized for ${modalId}`);
        }
        
        /**
         * Initialize all modal scroll arrows
         */
        function initModalScrollArrows() {
            setupModalScrollArrows('stockoutModal', 'stockoutModalBody', 'stockoutScrollUp', 'stockoutScrollDown');
            setupModalScrollArrows('wasteModal', 'wasteModalBody', 'wasteScrollUp', 'wasteScrollDown');
            setupModalScrollArrows('unusedModal', 'unusedModalBody', 'unusedScrollUp', 'unusedScrollDown');
            setupModalScrollArrows('overloadModal', 'overloadModalBody', 'overloadScrollUp', 'overloadScrollDown');
        }
        
        /**
         * Navigate to Charts page with filtered items
         * @param {string} category - 'Stock Out', 'Wasted Items', 'Unused Items', 'Overloaded Items'
         * @param {string} sublocation - Sublocation name
         * @param {Array} itemCodes - Array of itemCodes to filter
         */
        function navigateToChartsWithFilter(category, sublocation, itemCodes) {
            console.log(`🔍 Filtering by ${category} for ${sublocation}:`, itemCodes);
            
            // Get full item objects for the itemCodes
            const allItems = MOCK_DATA.items || [];
            const filteredItems = allItems.filter(item => {
                // Convert both to strings for comparison to handle mixed types
                const itemCodeStr = String(item.itemCode);
                return itemCodes.some(code => String(code) === itemCodeStr);
            });
            
            console.log(`✓ Found ${filteredItems.length} items from ${itemCodes.length} itemCodes`);
            
            if (filteredItems.length === 0) {
                console.warn('❌ No items found!');
                console.warn('Requested itemCodes:', itemCodes);
                console.warn('Checking if items exist in MOCK_DATA.items...');
                
                // Check first itemCode
                const firstCode = itemCodes[0];
                const foundByNum = allItems.find(i => parseInt(i.itemCode) === parseInt(firstCode));
                const foundByStr = allItems.find(i => String(i.itemCode) === String(firstCode));
                
                console.warn('Search for itemCode', firstCode, ':', {
                    foundByNum: foundByNum ? 'YES' : 'NO',
                    foundByStr: foundByStr ? 'YES' : 'NO'
                });
                
                alert(`No inventory data found for ${category} items in ${sublocation}.\n\nThe itemCodes exist in the area data but these items may not be in your current inventory.`);
                return;
            }
            
            // Calculate total cost
            const totalCost = filteredItems.reduce((sum, item) => {
                const qty = item.quantity || 0;
                const price = parseFloat(item.unitPrice || 0);
                return sum + (qty * price);
            }, 0);
            
            // Create filter data with appropriate filter chip text
            const filterChipText = `${category} for ${sublocation}`;
            const filterData = {
                filterType: filterChipText,
                items: filteredItems,
                totalCost: totalCost,
                itemsCount: filteredItems.length,
                sublocation: sublocation,
                category: category
            };
            
            console.log('📊 Filter data prepared:', {
                filterType: filterChipText,
                itemsCount: filteredItems.length,
                totalCost: totalCost.toFixed(2)
            });
            
            // Send message to Analytics iframe which contains Charts
            const analyticsFrame = document.getElementById('analyticsFrame');
            if (analyticsFrame && analyticsFrame.contentWindow) {
                analyticsFrame.contentWindow.postMessage({
                    type: 'OPEN_CHARTS_WITH_FILTER',
                    filterData: filterData
                }, '*');
                console.log('✓ Filter message sent to Analytics iframe');
            } else {
                console.warn('⚠️ Analytics iframe not found');
            }
            
            // Switch to analytics tab
            switchTab('analytics');
            
            // Close all modals
            closeStockoutModal();
            closeWasteModal();
            closeUnusedModal();
            closeOverloadModal();
        }
        
        /**
         * Scroll modal content (keeping for stockout modal compatibility)
         */
        function scrollStockoutModal(direction) {
            const modalBody = document.getElementById('stockoutModalBody');
            const scrollAmount = 300;
            
            if (direction === 'up') {
                modalBody.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
            } else {
                modalBody.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            }
        }
        
        /**
         * Update scroll arrow visibility
         */
        function updateStockoutScrollArrows() {
            const modalBody = document.getElementById('stockoutModalBody');
            const upArrow = document.getElementById('stockoutScrollUp');
            const downArrow = document.getElementById('stockoutScrollDown');
            
            if (!modalBody || !upArrow || !downArrow) return;
            
            const scrollTop = modalBody.scrollTop;
            const scrollHeight = modalBody.scrollHeight;
            const clientHeight = modalBody.clientHeight;
            const scrollBottom = scrollHeight - scrollTop - clientHeight;
            
            // Show/hide up arrow
            if (scrollTop > 50) {
                upArrow.classList.add('visible');
                upArrow.classList.remove('hidden');
            } else {
                upArrow.classList.add('hidden');
                upArrow.classList.remove('visible');
            }
            
            // Show/hide down arrow
            if (scrollBottom > 50) {
                downArrow.classList.add('visible');
                downArrow.classList.remove('hidden');
            } else {
                downArrow.classList.add('hidden');
                downArrow.classList.remove('visible');
            }
        }
        
        // Close modal when clicking outside
        document.getElementById('stockoutModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeStockoutModal();
            }
        });
        
        // ==================================================================================
        // END STOCKOUT MODAL FUNCTIONALITY
        // ==================================================================================
        
        // ==================================================================================
        // END CENTRALIZED MOCK DATA STORE & COMMUNICATION
        // ==================================================================================
        
        // ==================================================================================
        // FDA SHORTAGES API PARSER
        // ==================================================================================
        
        /**
         * Cache for FDA parsed data
         */
        let FDA_CACHE = null;
        let FDA_LAST_FETCH = null;
        const FDA_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        
        /**
         * Parse FDA drug shortages API and cache results
         * Filters: availability <> "Available"
         * Date range: Last 45 days
         * Groups by generic_name
         * Calculates manufacturer ratios from RxNorm API
         */
        async function parseFDAShortages() {
            console.log('🏥 Starting FDA Shortages Parser...');
            
            // Check cache validity
            if (FDA_CACHE && FDA_LAST_FETCH && (Date.now() - FDA_LAST_FETCH) < FDA_CACHE_DURATION) {
                console.log('✓ Using cached FDA data (age:', Math.round((Date.now() - FDA_LAST_FETCH) / 1000 / 60), 'minutes)');
                return FDA_CACHE;
            }
            
            const BASE_URL = 'https://api.fda.gov/drug/shortages.json';
            const SEARCH_PARAMS = 'search=status:"Current"&sort=update_date:desc';
            const LIMIT = 300;
            const DATE_CUTOFF_DAYS = 45;
            
            try {
                // Calculate cutoff date (45 days ago)
                const today = new Date();
                const cutoffDate = new Date(today - (DATE_CUTOFF_DAYS * 24 * 60 * 60 * 1000));
                console.log(`📅 Cutoff date: ${cutoffDate.toLocaleDateString()} (45 days ago)`);
                
                // Parse records starting from skip=0
                console.log(`📝 Starting to parse records from skip=0...`);
                const parsedItems = [];
                const processedNDCs = new Set();
                let skip = 0;
                let shouldContinue = true;
                
                // Collect all items that pass filters
                while (shouldContinue) {
                    console.log(`  Fetching skip=${skip}, limit=${LIMIT}...`);
                    const url = `${BASE_URL}?${SEARCH_PARAMS}&limit=${LIMIT}&skip=${skip}`;
                    
                    try {
                        const response = await fetch(url);
                        const data = await response.json();
                        
                        if (!data.results || data.results.length === 0) {
                            console.log(`  ✓ No more results at skip=${skip}`);
                            break;
                        }
                        
                        console.log(`  Processing ${data.results.length} items at skip=${skip}...`);
                        
                        // Log the structure of the first node to see what fields are available
                        if (skip === 0 && data.results.length > 0) {
                            console.log(`  📋 FDA Node Structure (first item):`, {
                                allKeys: Object.keys(data.results[0]),
                                presentation: data.results[0].presentation,
                                generic_name: data.results[0].generic_name,
                                availability: data.results[0].availability,
                                package_ndc: data.results[0].package_ndc,
                                update_date: data.results[0].update_date,
                                full_node: data.results[0]
                            });
                        }
                        
                        let itemsProcessedInBatch = 0;
                        
                        // Process each node
                        for (const node of data.results) {
                            // Check date cutoff
                            const updateDate = new Date(node.update_date);
                            
                            if (updateDate < cutoffDate) {
                                console.log(`  ⏹️ Stopping: Found item with update_date ${node.update_date} (> 45 days old)`);
                                shouldContinue = false;
                                break;
                            }
                            
                            // Filter: availability <> "Available"
                            if (node.availability && node.availability.toLowerCase() === 'available') {
                                continue;
                            }
                            
                            // Get package_ndc - it's a string, not an array
                            const packageNdc = node.package_ndc || '';
                            
                            // Log the first few package_ndc values to debug
                            if (parsedItems.length < 3) {
                                console.log(`  📦 FDA package_ndc for item ${parsedItems.length + 1}: "${packageNdc}"`);
                            }
                            
                            if (!packageNdc || processedNDCs.has(packageNdc)) {
                                continue;
                            }
                            processedNDCs.add(packageNdc);
                            
                            // Extract name from presentation or other FDA fields
                            let name = '';
                            
                            // Try multiple possible fields in order of preference
                            if (node.presentation && Array.isArray(node.presentation) && node.presentation.length > 0) {
                                // presentation is an array - take the first element
                                const presentation = node.presentation[0];
                                if (typeof presentation === 'string') {
                                    name = presentation.replace(/\(NDC\s+[\d-]+\)/gi, '').trim();
                                }
                            } else if (node.presentation && typeof node.presentation === 'string') {
                                // presentation is a string
                                name = node.presentation.replace(/\(NDC\s+[\d-]+\)/gi, '').trim();
                            } else if (node.generic_name) {
                                // Fallback to generic_name
                                name = node.generic_name.trim();
                            } else if (node.product_description) {
                                // Fallback to product_description if it exists
                                name = node.product_description.trim();
                            }
                            
                            // Log extraction for first few items
                            if (parsedItems.length < 3) {
                                console.log(`  🔍 Name extraction for item ${parsedItems.length + 1}:`, {
                                    presentation_type: Array.isArray(node.presentation) ? 'array' : typeof node.presentation,
                                    presentation_value: node.presentation,
                                    generic_name: node.generic_name,
                                    extracted_name: name
                                });
                            }
                            
                            // Skip if name is too short (likely invalid data)
                            if (!name || name.length < 3) {
                                console.warn(`  ⚠️ Skipping invalid presentation: "${name}" (too short or empty)`, {
                                    raw_presentation: node.presentation,
                                    generic_name: node.generic_name,
                                    ndc: packageNdc
                                });
                                continue;
                            }
                            
                            // Determine severity
                            let severity = '';
                            if (node.availability) {
                                const avail = node.availability.toLowerCase();
                                if (avail === 'unavailable') {
                                    severity = 'severe';
                                } else if (avail.includes('limited')) {
                                    severity = 'moderate';
                                }
                            }
                            
                            // Build the parsed item (without manufacturer ratio and itemCode yet)
                            const item = {
                                update_date: node.update_date,
                                generic_name: node.generic_name || '',
                                severity: severity,
                                name: name,
                                availability: node.availability || '',
                                ndc: packageNdc,
                                details: node.related_info || '',
                                shortage_reason: node.shortage_reason || '',
                                manufactureRatio: 0, // Will be filled in later after grouping
                                itemCode: '' // Will be matched after grouping
                            };
                            
                            parsedItems.push(item);
                            itemsProcessedInBatch++;
                            
                            // Log first few items for debugging
                            if (parsedItems.length <= 3) {
                                console.log(`    Item #${parsedItems.length}:`, {
                                    raw_presentation: node.presentation,
                                    extracted_name: name,
                                    generic_name: node.generic_name,
                                    availability: node.availability,
                                    ndc: packageNdc,
                                    update_date: node.update_date,
                                    itemCode: '(will match later)'
                                });
                            }
                        }
                        
                        console.log(`  ✓ Processed ${itemsProcessedInBatch} items from this batch`);
                        
                        // If we should continue, move to next batch
                        if (shouldContinue) {
                            skip += LIMIT;
                        }
                        
                    } catch (error) {
                        console.error(`❌ Error fetching skip=${skip}:`, error);
                        break;
                    }
                }
                
                console.log(`✓ Parsed ${parsedItems.length} FDA shortage items (within last 45 days)`);
                
                // STEP 1: Group by NDC to eliminate duplicates (same NDC = same item)
                const ndcMap = new Map();
                for (const item of parsedItems) {
                    if (!ndcMap.has(item.ndc)) {
                        ndcMap.set(item.ndc, item);
                    }
                }
                
                const uniqueByNdc = Array.from(ndcMap.values());
                console.log(`📦 Step 1: ${uniqueByNdc.length} unique items after grouping by NDC (from ${parsedItems.length} total)`);
                
                // STEP 2: Group by name and sum manufacturerRatios
                const nameMap = new Map();
                for (const item of uniqueByNdc) {
                    if (nameMap.has(item.name)) {
                        // Add to existing group
                        const existing = nameMap.get(item.name);
                        existing.ndcs.push(item.ndc);
                    } else {
                        // Create new group
                        nameMap.set(item.name, {
                            ...item,
                            ndcs: [item.ndc],
                            manufactureRatio: 0 // Will be calculated later
                        });
                    }
                }
                
                const groupedByName = Array.from(nameMap.values());
                console.log(`📦 Step 2: ${groupedByName.length} unique items after grouping by name`);
                
                // Show all items for debugging (first 30)
                console.log(`\n📋 All FDA items (first 30):`);
                groupedByName.slice(0, 30).forEach((item, i) => {
                    console.log(`  ${i+1}. ${item.name} (${item.availability})`);
                });
                
                // STEP 3: Match to MOCK_DATA BEFORE fetching ratios
                console.log(`\n🔗 Step 3: Matching to MOCK_DATA...`);
                for (const item of groupedByName) {
                    item.itemCode = matchItemCode(item.name);
                }
                
                const matchedItems = groupedByName.filter(i => i.itemCode);
                const unmatchedItems = groupedByName.filter(i => !i.itemCode);
                const matchedCount = matchedItems.length;
                console.log(`✓ Matched ${matchedCount}/${groupedByName.length} items to MOCK_DATA`);
                
                // Show unmatched items for debugging
                if (unmatchedItems.length > 0 && unmatchedItems.length <= 10) {
                    console.log(`\n⚠️ Unmatched FDA items:`);
                    unmatchedItems.forEach(item => {
                        console.log(`  - ${item.name}`);
                    });
                } else if (unmatchedItems.length > 10) {
                    console.log(`\n⚠️ ${unmatchedItems.length} unmatched FDA items (showing first 10):`);
                    unmatchedItems.slice(0, 10).forEach(item => {
                        console.log(`  - ${item.name}`);
                    });
                }
                
                // STEP 4: Filter matched items by availability (need ratios)
                const itemsNeedingRxNorm = matchedItems.filter(item => {
                    const avail = (item.availability || '').toLowerCase();
                    return avail === 'unavailable' || avail.includes('limited');
                });
                
                console.log(`\n🔍 Step 4: ${itemsNeedingRxNorm.length} matched items need manufacturer ratios`);
                console.log(`   (Skipping ${matchedItems.length - itemsNeedingRxNorm.length} items - wrong availability)`);
                console.log(`   (Skipping ${groupedByName.length - matchedCount} items - no MOCK_DATA match)`);
                
                // STEP 5: Fetch manufacturer ratios ONLY for matched items that need them
                if (itemsNeedingRxNorm.length > 0) {
                    console.log(`\n📞 Step 5: Fetching manufacturer ratios for ${itemsNeedingRxNorm.length} items...`);
                }
                
                const batchSize = 10;
                for (let i = 0; i < itemsNeedingRxNorm.length; i += batchSize) {
                    const batch = itemsNeedingRxNorm.slice(i, i + batchSize);
                    
                    console.log(`\n--- Batch ${Math.floor(i / batchSize) + 1} ---`);
                    
                    // Use first NDC from each group
                    const ratioPromises = batch.map(item => 
                        getManufacturerRatio(item.ndcs[0])
                            .then(ratio => {
                                item.manufactureRatio = ratio;
                            })
                            .catch(err => {
                                console.warn('RxNorm error:', err.message);
                                item.manufactureRatio = 0;
                            })
                    );
                    
                    await Promise.all(ratioPromises);
                    
                    console.log(`✓ Batch complete: ${Math.min(i + batchSize, itemsNeedingRxNorm.length)}/${itemsNeedingRxNorm.length}`);
                    
                    if (i + batchSize < itemsNeedingRxNorm.length) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
                
                console.log(`\n📊 Manufacturer Ratio Summary:`);
                console.log(`  Total items needing ratios: ${itemsNeedingRxNorm.length}`);
                console.log(`  Items with ratio > 0: ${itemsNeedingRxNorm.filter(i => i.manufactureRatio > 0).length}`);
                console.log(`  Items with ratio = 0: ${itemsNeedingRxNorm.filter(i => i.manufactureRatio === 0).length}`);
                
                console.log(`\n✓ All processing complete`);
                console.log(`  Total FDA items: ${groupedByName.length}`);
                console.log(`  Matched to MOCK_DATA: ${matchedCount}`);
                console.log(`  Fetched ratios for: ${itemsNeedingRxNorm.length}`);
                
                // FINAL COUNT: Items that will show in Shortage Bulletin
                const finalFiltered = groupedByName.filter(item => {
                    if (!item.itemCode) return false;
                    const avail = (item.availability || '').toLowerCase();
                    const ratio = item.manufactureRatio || 0;
                    return (avail === 'unavailable' && ratio > 0.3) || 
                           (avail.includes('limited') && ratio > 0.5);
                });
                
                console.log(`\n🎯 FINAL COUNT FOR FDA CARD: ${finalFiltered.length}`);
                if (finalFiltered.length > 0) {
                    console.log(`   Items that will appear in Shortage Bulletin:`);
                    finalFiltered.forEach((item, i) => {
                        console.log(`   ${i+1}. ${item.name} (${item.itemCode}, ratio: ${item.manufactureRatio.toFixed(2)})`);
                    });
                }
                
                // Cache ALL grouped items (not just those passing ratio)
                // This allows us to see all FDA items if needed
                FDA_CACHE = groupedByName;
                FDA_LAST_FETCH = Date.now();
                
                console.log(`\n✅ FDA parsing complete, returning ${groupedByName.length} grouped items`);
                return groupedByName;
                
            } catch (error) {
                console.error('❌ FDA Parser Error:', error);
                return [];
            }
        }
        
        /**
         * Get manufacturer ratio from RxNorm API
         * Counts distinct manufacturers for an NDC
         * Returns 1 / count
         */
        async function getManufacturerRatio(ndc) {
            if (!ndc) {
                console.warn('getManufacturerRatio: No NDC provided');
                return 0;
            }
            
            try {
                // Use the FULL NDC format (with dashes) in the API call
                const url = `https://rxnav.nlm.nih.gov/REST/relatedndc?ndc=${ndc}&relation=drug&ndcstatus=active`;
                
                console.log(`  🔍 RxNorm API call for NDC: ${ndc}`);
                
                const response = await fetch(url);
                
                if (!response.ok) {
                    console.warn(`  ⚠️ RxNorm API returned status ${response.status} for NDC ${ndc}`);
                    return 0;
                }
                
                const text = await response.text();
                console.log(`  ✓ RxNorm response received (${text.length} chars)`);
                
                // Parse XML response
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, 'text/xml');
                
                // Check for parsing errors
                const parseError = xmlDoc.querySelector('parsererror');
                if (parseError) {
                    console.warn(`  ⚠️ XML parse error for NDC ${ndc}:`, parseError.textContent);
                    return 0;
                }
                
                // RxNorm relatedndc API returns structure: <rxnormdata><ndcInfoList><ndcInfo><ndc11>...</ndc11></ndcInfo>...
                // Get all <ndc11> elements (11-digit NDCs without dashes)
                const ndcElements = xmlDoc.getElementsByTagName('ndc11');
                console.log(`  Found ${ndcElements.length} <ndc11> elements`);
                
                if (ndcElements.length === 0) {
                    console.log(`  ⚠️ No <ndc11> elements found`);
                    return 0;
                }
                
                const uniqueNdcs = new Set();
                
                // Parse the 9 digits from EACH NDC in the results
                for (let i = 0; i < ndcElements.length; i++) {
                    const ndcValue = ndcElements[i].textContent?.trim();
                    if (ndcValue) {
                        // NDC11 values are already without dashes (e.g., "00409909331")
                        // Extract first 9 digits to identify unique manufacturers
                        const ndc9digit = ndcValue.substring(0, 9);
                        uniqueNdcs.add(ndc9digit);
                        
                        // Log first few for debugging
                        if (i < 5) {
                            console.log(`     NDC ${i + 1}: "${ndcValue}" → 9-digit: "${ndc9digit}"`);
                        }
                    }
                }
                
                const count = uniqueNdcs.size;
                const ratio = count === 0 ? 0 : 1 / count;
                
                console.log(`  ✓ NDC ${ndc}: ${count} unique manufacturers (from ${ndcElements.length} total NDCs) → ratio = ${ratio.toFixed(4)}`);
                
                return ratio;
                
            } catch (error) {
                console.error('  ❌ RxNorm API error for NDC', ndc, ':', error);
                return 0;
            }
        }
        
        /**
         * Match FDA drug name to itemCode in MOCK_DATA.items
         * Progressive matching with fallback:
         * 1. Exact: full name + form + strength
         * 2. Loose: first word + form + strength
         * 3. Fallback: first word only
         */
        function matchItemCode(fdaName) {
            if (!fdaName || !MOCK_DATA.items) return '';
            
            console.log(`\n🔍 Matching: "${fdaName}"`);
            
            // Extract components
            const { drugName, strength, dosageForm } = extractDrugComponents(fdaName);
            if (!drugName) {
                console.log(`  ✗ Could not extract drug name`);
                return '';
            }
            
            // Debug logging for specific drugs
            if (drugName.toLowerCase().includes('dopamine')) {
                console.log(`  [DOPAMINE DEBUG] Extracted:`, { drugName, strength, dosageForm });
            }
            
            const fdaFormNormalized = normalizeDosageForm(dosageForm);
            const strengthInfo = strength ? generateStrengthVariants(strength) : { variants: [], totalVolume: null };
            const strengthVariants = strengthInfo.variants;
            const fdaTotalVolume = strengthInfo.totalVolume;
            
            // Debug logging for volume-sensitive drugs
            if (drugName.toLowerCase().includes('dopamine') || 
                drugName.toLowerCase().includes('precedex') || 
                drugName.toLowerCase().includes('dexmed') ||
                drugName.toLowerCase().includes('hydroxo')) {
                console.log(`  [VOLUME DEBUG] Extracted:`, { drugName, strength, dosageForm });
                console.log(`  [VOLUME DEBUG] FDA total volume: "${fdaTotalVolume}"`);
                console.log(`  [VOLUME DEBUG] Strength variants (first 5):`, strengthVariants.slice(0, 5));
            }
            
            // LEVEL 1: Exact match (full drug name + form + strength + volume)
            const exactMatches = findMatches(drugName.toLowerCase(), fdaFormNormalized, strengthVariants, fdaTotalVolume, 'exact');
            if (exactMatches.length === 1) {
                console.log(`  ✓ EXACT match: ${exactMatches[0].itemCode}`);
                return exactMatches[0].itemCode;
            } else if (exactMatches.length > 1) {
                console.log(`  ⚠️ Multiple exact matches (${exactMatches.length}) - skipping`);
                return '';
            }
            
            // LEVEL 2: First word + form + strength + volume
            const firstWord = drugName.split(/[\s,;]+/)[0].toLowerCase();
            const looseMatches = findMatches(firstWord, fdaFormNormalized, strengthVariants, fdaTotalVolume, 'loose');
            if (looseMatches.length === 1) {
                console.log(`  ✓ LOOSE match: ${looseMatches[0].itemCode}`);
                return looseMatches[0].itemCode;
            } else if (looseMatches.length > 1) {
                console.log(`  ⚠️ Multiple loose matches (${looseMatches.length}) - skipping`);
                return '';
            }
            
            // LEVEL 3: Removed - fallback matching caused too many false positives
            // Items must match on form AND strength, not just drug name
            
            console.log(`  ✗ No match found`);
            return '';
        }
        
        /**
         * Find matches based on criteria
         * @param {string} searchName - Drug name to search for (full or first word)
         * @param {string} requiredForm - Required dosage form (or null to skip)
         * @param {array} strengthVariants - Strength variants to match (or empty to skip)
         * @param {string} fdaTotalVolume - Total volume from FDA (e.g., "250 ml") or null
         * @param {string} level - 'exact', 'loose', or 'fallback'
         */
        function findMatches(searchName, requiredForm, strengthVariants, fdaTotalVolume, level) {
            const matches = [];
            const isExact = (level === 'exact');
            
            let checkedItems = 0;
            let nameMatches = 0;
            let formMatches = 0;
            let strengthMatches = 0;
            
            for (const item of MOCK_DATA.items) {
                if (!item.description) continue;
                checkedItems++;
                
                const cleanDescription = item.description
                    .replace(/\([^)]*\)/g, '')  // Remove (parentheses) but keep [brackets]
                    .trim()
                    .toLowerCase();
                
                // Extract brand name from [brackets] if present
                const brandMatch = item.description.match(/\[([^\]]+)\]/);
                const brandName = brandMatch ? brandMatch[1].toLowerCase() : '';
                
                // Name matching - check both generic name AND brand name
                let nameMatch = false;
                if (isExact) {
                    // Exact: full drug name must be in description or brand name
                    nameMatch = cleanDescription.includes(searchName) || 
                               (brandName && brandName.includes(searchName));
                } else {
                    // Loose/Fallback: first word with word boundary in description or brand
                    const wordBoundaryRegex = new RegExp(`\\b${searchName}\\b`, 'i');
                    nameMatch = wordBoundaryRegex.test(cleanDescription) || 
                               (brandName && wordBoundaryRegex.test(brandName));
                }
                
                if (!nameMatch) continue;
                nameMatches++;
                
                // Extract form once for reuse
                const itemForm = extractDosageFormFromDescription(item.description);
                const itemFormNormalized = normalizeDosageForm(itemForm, item.description);
                
                // Skip combination drugs (has / or - in DRUG NAME ONLY) unless we're in fallback mode
                // Extract drug name before any numbers to avoid matching "10 mg/1 mL"
                if (level !== 'fallback') {
                    // Find where numbers start in the description
                    const firstNumberMatch = cleanDescription.match(/\d/);
                    const drugNameOnly = firstNumberMatch 
                        ? cleanDescription.substring(0, firstNumberMatch.index)
                        : cleanDescription.substring(0, 40);
                    
                    if (drugNameOnly.includes('/') || drugNameOnly.includes('-')) {
                        const beforeSlash = drugNameOnly.split(/[\/\-]/)[0].trim();
                        const wordBoundaryRegex = new RegExp(`\\b${searchName}\\b`, 'i');
                        if (wordBoundaryRegex.test(beforeSlash)) {
                            continue; // Skip combinations
                        }
                    }
                }
                
                // Form matching (if required) - use already extracted form
                if (requiredForm) {
                    if (itemFormNormalized !== requiredForm) {
                        continue; // Form doesn't match
                    }
                }
                formMatches++;
                
                // Strength matching (if required)
                if (strengthVariants.length > 0) {
                    let strengthMatch = false;
                    for (const variant of strengthVariants) {
                        if (cleanDescription.includes(variant)) {
                            strengthMatch = true;
                            break;
                        }
                    }
                    
                    if (!strengthMatch) {
                        continue; // Strength doesn't match
                    }
                }
                strengthMatches++;
                
                // Volume matching (if FDA has total volume)
                // FDA: "1000 mcg/250 mL" → fdaTotalVolume = "250 ml"
                // MOCK: "4 mcg/1 mL (250 mL)" → extract volume from parentheses
                if (fdaTotalVolume && level !== 'fallback') {
                    const volumeMatch = item.description.match(/\((\d+\.?\d*)\s*(ml|l)\)/i);
                    if (volumeMatch) {
                        const mockVolume = `${volumeMatch[1]} ${volumeMatch[2]}`.toLowerCase();
                        if (mockVolume !== fdaTotalVolume.toLowerCase()) {
                            continue; // Volume doesn't match
                        }
                    } else {
                        // MOCK has no volume in parentheses, skip volume check
                    }
                }
                
                // All criteria met
                matches.push({
                    itemCode: item.itemCode,
                    description: item.description
                });
            }
            
            // Log summary only for non-fallback levels
            if (level !== 'fallback' && matches.length === 0) {
                console.log(`    No matches at ${level} level (checked ${checkedItems} items, ${nameMatches} name matches, ${formMatches} form matches)`);
            }
            
            return matches;
        }
        
        /**
         * Normalize dosage form for comparison
         */
        function normalizeDosageForm(form, fullDescription) {
            if (!form) return '';
            
            const formLower = form.toLowerCase();
            const descLower = (fullDescription || '').toLowerCase();
            
            // Check for oral first (before syringe check)
            // This handles "Oral Syringe", "Oral Soln", etc.
            if (descLower.includes('oral')) {
                return 'oral';
            }
            
            // Injection forms - ALL of these map to 'injection'
            if (formLower.includes('injection') || 
                formLower.includes('inj') ||
                formLower.includes('vial') || 
                formLower.includes('syringe') ||
                formLower.includes('flex cont') ||
                formLower.includes('plas cont') ||
                formLower.includes('plastic container') ||
                formLower.includes('bag') ||
                formLower.includes('iv') ||
                formLower.includes('ampule') ||
                formLower.includes('amp')) {
                return 'injection';
            }
            
            // Transdermal forms
            if (formLower.includes('patch') || formLower.includes('transdermal')) {
                return 'transdermal';
            }
            
            // Oral forms
            if (formLower.includes('tablet') || 
                formLower.includes('tab') ||
                formLower.includes('capsule') ||
                formLower.includes('cap')) {
                return 'oral';
            }
            
            // Ophthalmic
            if (formLower.includes('ophth') || formLower.includes('ophthalmic')) {
                return 'ophthalmic';
            }
            
            // Other common forms
            if (formLower.includes('cream') || formLower.includes('ointment') || formLower.includes('gel')) {
                return 'topical';
            }
            
            if (formLower.includes('solution') || formLower.includes('suspension')) {
                return 'liquid';
            }
            
            if (formLower.includes('inhaler') || formLower.includes('spray')) {
                return 'inhalation';
            }
            
            return formLower;
        }
        
        /**
         * Extract dosage form from MOCK_DATA description
         */
        function extractDosageFormFromDescription(description) {
            if (!description) return '';
            
            const descLower = description.toLowerCase();
            
            // Common dosage form patterns - order matters (check specific before general)
            const forms = [
                'recon soln', 'powder',  // Check these BEFORE solution
                'injection', 'inj', 
                'vial', 'syringe', 'flex cont', 'plas cont',
                'bag', 'iv', 'ampule', 'amp',
                'tablet', 'tab', 'capsule', 'cap',
                'patch', 'transdermal',
                'cream', 'ointment', 'gel', 'lotion',
                'solution', 'suspension', 'susp',
                'ophth', 'ophthalmic',
                'inhaler', 'spray'
            ];
            
            for (const form of forms) {
                if (descLower.includes(form)) {
                    return form;
                }
            }
            
            return '';
        }
        
        /**
         * Generate strength variants with unit conversions
         * Handles: ug <-> mcg, ug/mcg <-> mg <-> g
         * Also generates per-mL concentration from total volume (e.g., 800 mg/250 mL → 3.2 mg/1 mL)
         * Returns: { variants: [...], totalVolume: "250 ml" or null }
         */
        function generateStrengthVariants(strength) {
            const variants = new Set();
            const strengthLower = strength.toLowerCase();
            variants.add(strengthLower);
            variants.add(strengthLower.replace(/\s+/g, ''));
            
            let totalVolume = null;
            
            // Extract: "800 mg/250 mL" -> value=800, unit=mg, perValue=250, perUnit=ml
            const match = strength.match(/(\d+\.?\d*)\s*(ug|mcg|mg|g)\s*(?:\/\s*(\d+\.?\d*)\s*(ml|l))?/i);
            
            if (match) {
                const value = parseFloat(match[1]);
                const unit = match[2].toLowerCase();
                const perValue = match[3] ? parseFloat(match[3]) : null;
                const perUnit = match[4] ? match[4].toLowerCase() : null;
                
                // Store total volume (e.g., "250 ml" from "800 mg/250 mL")
                if (perValue && perUnit) {
                    totalVolume = `${perValue} ${perUnit}`;
                }
                
                // Convert to mg for calculations
                let mgValue = value;
                if (unit === 'g') mgValue = value * 1000;
                if (unit === 'ug' || unit === 'mcg') mgValue = value / 1000;
                
                const ugValue = mgValue * 1000;
                
                if (perValue && perUnit) {
                    // Has /ml component - add all variants
                    
                    // Original unit variants
                    variants.add(`${value} ${unit}/${perValue} ${perUnit}`);
                    variants.add(`${value}${unit}/${perValue}${perUnit}`);
                    
                    // ug/mcg variants
                    if (unit === 'ug' || unit === 'mcg') {
                        variants.add(`${value} ug/${perValue} ${perUnit}`);
                        variants.add(`${value} mcg/${perValue} ${perUnit}`);
                        variants.add(`${value}ug/${perValue}${perUnit}`);
                        variants.add(`${value}mcg/${perValue}${perUnit}`);
                    }
                    
                    // mg variants
                    variants.add(`${mgValue} mg/${perValue} ${perUnit}`);
                    variants.add(`${mgValue}mg/${perValue}${perUnit}`);
                    
                    // CRITICAL: Calculate per-1mL concentration
                    // Example: 800 mg/250 mL → 3.2 mg/1 mL
                    if (perValue !== 1) {
                        const concentration = mgValue / perValue;
                        
                        // Add concentration variants
                        variants.add(`${concentration} mg/1 ${perUnit}`);
                        variants.add(`${concentration}mg/1${perUnit}`);
                        
                        // Also add with "ml" instead of perUnit
                        variants.add(`${concentration} mg/1 ml`);
                        variants.add(`${concentration}mg/1ml`);
                        
                        // ug/mcg concentration variants
                        const ugConcentration = concentration * 1000;
                        if (ugConcentration >= 1) {
                            variants.add(`${ugConcentration} ug/1 ml`);
                            variants.add(`${ugConcentration} mcg/1 ml`);
                            variants.add(`${ugConcentration}ug/1ml`);
                            variants.add(`${ugConcentration}mcg/1ml`);
                        }
                    }
                    
                    // ug variants if value is large enough
                    if (unit !== 'ug' && unit !== 'mcg' && ugValue >= 1) {
                        variants.add(`${ugValue} ug/${perValue} ${perUnit}`);
                        variants.add(`${ugValue} mcg/${perValue} ${perUnit}`);
                    }
                }
            }
            
            return { 
                variants: Array.from(variants),
                totalVolume: totalVolume
            };
        }
        
        
        /**
         * Extract drug name (first word), strength, and dosage form from FDA presentation string
         * 
         * Strategy: First word is the drug name (e.g., "Morphine" from "Morphine Sulfate")
         * 
         * Examples:
         *   "Carboplatin, Injection, 10 mg/1 mL" -> { drugName: "Carboplatin", strength: "10 mg/1 mL", dosageForm: "Injection" }
         *   "Morphine Sulfate 500 mg Tablet" -> { drugName: "Morphine", strength: "500 mg", dosageForm: "Tablet" }
         *   "Sodium Chloride 0.9% Solution" -> { drugName: "Sodium", strength: "0.9%", dosageForm: "Solution" }
         */
        function extractDrugComponents(fdaPresentation) {
            // Normalize common variations FIRST
            let normalized = fdaPresentation
                .replace(/\bIn Dextrose 5%\b/gi, 'in D5W')
                .replace(/\bDextrose 5%\b/gi, 'D5W')
                .replace(/\bIn Sodium Chloride 0\.9%\b/gi, 'in NaCl 0.9%')
                .replace(/\bSodium Chloride 0\.9%\b/gi, 'NaCl 0.9%')
                .replace(/\bIn Plastic Container\b/gi, '')
                .replace(/\bPlastic Container\b/gi, '');
            
            // Remove NDC codes in parentheses
            let cleaned = normalized.replace(/\(NDC\s+[\d-]+\)/gi, '').trim();
            
            // Validate input
            if (!cleaned || cleaned.length < 3) {
                console.warn(`     Invalid presentation string: "${fdaPresentation}"`);
                return { drugName: '', strength: '', dosageForm: '' };
            }
            
            // Common dosage forms to identify
            const dosageForms = [
                'injection', 'tablet', 'capsule', 'solution', 'suspension', 'cream', 'ointment',
                'gel', 'lotion', 'patch', 'suppository', 'powder', 'syrup', 'elixir', 'spray',
                'drops', 'foam', 'film', 'kit', 'inhaler', 'vial', 'ampule', 'bag', 'bottle',
                'flex cont', 'chew tab', 'oral susp', 'ec tab', 'er tab', 'sr tab'
            ];
            
            // Strength patterns (numbers with units)
            // Matches: "10 mg", "0.9%", "0.05 mg/1 mL", "1000 MCG/ML" (implied /1 mL), ".05 mg/1 mL", "500mg", "1.5 g", etc.
            // Pattern prioritizes decimal: (\d+\.\d+|\.\d+|\d+) matches "0.05" or ".05" before just "05"
            const strengthPattern = /(\d+\.\d+|\.\d+|\d+)\s*(mg|g|mcg|ug|%|ml|l|unit|iu|meq|mmol)(?:\s*\/\s*(?:(\d+\.\d+|\.\d+|\d+)\s*)?(mg|g|mcg|ml|l|ea|tab))?/gi;
            
            let drugName = '';
            let strength = '';
            let dosageForm = '';
            
            // Extract dosage form FIRST
            const cleanedLower = cleaned.toLowerCase();
            let dosageFormIndex = -1;
            for (const form of dosageForms) {
                const idx = cleanedLower.indexOf(form);
                if (idx !== -1) {
                    dosageForm = form;
                    dosageFormIndex = idx;
                    break;
                }
            }
            
            // Extract strength AFTER dosage form (if found)
            if (dosageFormIndex !== -1) {
                // Look for strength after the dosage form
                const afterDosageForm = cleaned.substring(dosageFormIndex + dosageForm.length);
                
                // Debug for hydroxo
                if (cleaned.toLowerCase().includes('hydroxo')) {
                    console.log(`  [EXTRACTION DEBUG] Full cleaned: "${cleaned}"`);
                    console.log(`  [EXTRACTION DEBUG] After dosage form: "${afterDosageForm}"`);
                }
                
                strengthPattern.lastIndex = 0;
                const strengthMatch = strengthPattern.exec(afterDosageForm);
                
                if (strengthMatch) {
                    // Debug for hydroxo
                    if (cleaned.toLowerCase().includes('hydroxo')) {
                        console.log(`  [EXTRACTION DEBUG] Regex match:`, strengthMatch);
                    }
                    
                    let value = strengthMatch[1];
                    const unit = strengthMatch[2];
                    let perValue = strengthMatch[3];
                    const perUnit = strengthMatch[4];
                    
                    // If we have perUnit but no perValue, it means format like "1000 MCG/ML" (implied /1 ML)
                    if (perUnit && !perValue) {
                        perValue = '1';
                    }
                    
                    // Normalize: ".05" -> "0.05"
                    if (value.startsWith('.')) {
                        value = '0' + value;
                    }
                    
                    // Rebuild strength string
                    if (perValue && perUnit) {
                        strength = `${value} ${unit}/${perValue} ${perUnit}`;
                        
                        // Look for total volume after the strength (e.g., "1000 MCG/ML, 30 ML")
                        // Find where this match ended and look for another number + ml/l pattern
                        const afterStrength = afterDosageForm.substring(strengthMatch.index + strengthMatch[0].length);
                        const volumeMatch = afterStrength.match(/[,\s]+(\d+\.?\d*)\s*(ml|l)\b/i);
                        if (volumeMatch && cleaned.toLowerCase().includes('hydroxo')) {
                            console.log(`  [EXTRACTION DEBUG] Found volume after strength: ${volumeMatch[1]} ${volumeMatch[2]}`);
                        }
                    } else {
                        strength = `${value} ${unit}`;
                    }
                }
            }
            
            // Extract drug name: JUST GET THE FIRST WORD
            // Split by spaces, commas, or semicolons
            const words = cleaned.split(/[\s,;]+/).filter(w => w.length > 1);
            
            if (words.length > 0) {
                // Take the very first word as the drug name
                drugName = words[0].trim();
            }
            
            return {
                drugName: drugName,
                strength: strength,
                dosageForm: dosageForm
            };
        }
        
        /**
         * Get FDA shortage count for analytics card
         * Returns count of items that will appear in Shortage Bulletin
         */
        async function getFDAShortageCount() {
            const fdaData = await parseFDAShortages();
            
            if (!fdaData || fdaData.length === 0) {
                console.log('📊 FDA Count: No data');
                return 0;
            }
            
            console.log(`\n📊 FDA CARD COUNT CALCULATION`);
            console.log(`   Total FDA items: ${fdaData.length}`);
            
            // Count items that meet ALL criteria:
            // 1. Has itemCode (matched to MOCK_DATA)
            // 2. Has manufactureRatio > 0
            // 3. Passes availability + ratio threshold:
            //    - unavailable + ratio > 0.3
            //    - OR limited + ratio > 0.5
            
            let countWithItemCode = 0;
            let countWithRatio = 0;
            let countPassing = 0;
            
            for (const item of fdaData) {
                if (item.itemCode) countWithItemCode++;
                if (item.manufactureRatio > 0) countWithRatio++;
                
                // Check if passes filter
                if (item.itemCode) {
                    const avail = (item.availability || '').toLowerCase();
                    const ratio = item.manufactureRatio || 0;
                    
                    const passes = (avail === 'unavailable' && ratio > 0.3) || 
                                 (avail.includes('limited') && ratio > 0.5);
                    
                    if (passes) {
                        countPassing++;
                        if (countPassing <= 5) {
                            console.log(`   ✓ Item ${countPassing}: ${item.name} (${avail}, ratio: ${ratio.toFixed(2)})`);
                        }
                    }
                }
            }
            
            console.log(`   Items with itemCode: ${countWithItemCode}`);
            console.log(`   Items with ratio > 0: ${countWithRatio}`);
            console.log(`   Items passing filter: ${countPassing}`);
            console.log(`   → FDA CARD WILL SHOW: ${countPassing}`);
            
            return countPassing;
        }
        
        /**
         * Get FDA filtered itemCodes for Shortage Bulletin navigation
         * Returns array of itemCodes that meet the filter criteria
         */
        async function getFDAFilteredItems() {
            const fdaData = await parseFDAShortages();
            
            if (!fdaData || fdaData.length === 0) {
                console.log('📊 FDA Filtered Items: No FDA data available');
                return [];
            }
            
            // Same filter criteria as getFDAShortageCount
            const filteredItems = [];
            
            for (const item of fdaData) {
                if (!item.itemCode) continue;
                
                const avail = (item.availability || '').toLowerCase();
                const ratio = item.manufactureRatio || 0;
                
                if ((avail === 'unavailable' && ratio > 0.3) || 
                    (avail.includes('limited') && ratio > 0.5)) {
                    filteredItems.push(item);
                }
            }
            
            // Extract just the itemCodes
            const itemCodes = filteredItems.map(item => item.itemCode);
            
            console.log(`📊 FDA Filtered Items: Returning ${itemCodes.length} itemCodes`);
            
            return itemCodes;
        }
        
        /**
         * Initialize FDA data on page load (non-blocking)
         */
        function initFDAData() {
            console.log('🏥 Initializing FDA data...');
            
            // Parse FDA data in background without blocking page load
            parseFDAShortages().then(() => {
                console.log('✓ FDA data initialized and cached');
                
                // Get the count and send to Analytics iframe
                return getFDAShortageCount();
            }).then(count => {
                console.log(`\n✅ FDA shortage count calculated: ${count}`);
                console.log(`   Sending count to Analytics iframe...`);
                
                // Notify Analytics iframe with the count
                const analyticsFrame = document.getElementById('analyticsFrame');
                if (analyticsFrame && analyticsFrame.contentWindow) {
                    console.log(`   Analytics iframe found, posting messages...`);
                    
                    analyticsFrame.contentWindow.postMessage({
                        type: 'FDA_DATA_READY'
                    }, '*');
                    
                    // Also send the count immediately
                    analyticsFrame.contentWindow.postMessage({
                        type: 'fdaCountResponse',
                        count: count
                    }, '*');
                    
                    console.log(`   ✓ Sent: { type: 'fdaCountResponse', count: ${count} }`);
                } else {
                    console.warn(`   ⚠️ Analytics iframe not found!`);
                }
            }).catch(error => {
                console.error('❌ FDA initialization error:', error);
                
                // Send 0 count on error
                const analyticsFrame = document.getElementById('analyticsFrame');
                if (analyticsFrame && analyticsFrame.contentWindow) {
                    analyticsFrame.contentWindow.postMessage({
                        type: 'fdaCountResponse',
                        count: 0
                    }, '*');
                }
            });
        }
        
        // Auto-initialize FDA data when page loads (after a short delay)
        setTimeout(initFDAData, 2000);
        
        // ==================================================================================
        // END FDA SHORTAGES API PARSER
        // ==================================================================================


            


        // ---- Trend Facts (Google Sheets append-only timeline) ----
const TREND_FACTS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzeo7jxZzEyP-kYxmNLjyycuAwsJCIoLf2wigbhvDeFUMAOEKFi7uKUOwgXJl-GRCsH5g/exec";
const TREND_FACTS_SHEET_ID = "1S5TnYiY3UIlPvJrgd063OVm3a77iaWx_f89I-hYP7tQ";
const TREND_FACTS_UP_TAB = "trend_facts_up";
const TREND_FACTS_DOWN_TAB = "trend_facts_down";

function getTrendFactsState() {
    if (!window.TrendFactsState || typeof window.TrendFactsState !== "object") {
        window.TrendFactsState = { source: "unknown", calculatedAt: "", up: [], down: [], loadedAt: "" };
    }
    return window.TrendFactsState;
}

function _setTrendFactsState(next) {
    const current = getTrendFactsState();
    window.TrendFactsState = Object.assign({}, current, next || {});
    try {
        localStorage.setItem('__trendFactsState', JSON.stringify(window.TrendFactsState));
    } catch (_) {}
    updateTrendFactsStatusLine();
}

function updateTrendFactsStatusLine() {
    const el = document.getElementById('trendFactsStatusText');
    const state = getTrendFactsState();
    if (!el) return;
    const ts = state.calculatedAt || 'unknown';
    if (state.source === 'sheet') {
        el.textContent = `Loaded from Google Sheet • Trend timestamp: ${ts}`;
    } else if (state.source === 'calculated') {
        el.textContent = `Calculated locally • Trend timestamp: ${ts}`;
    } else if (state.source === 'cache') {
        el.textContent = `Loaded from cache • Trend timestamp: ${ts}`;
    } else {
        el.textContent = 'Trend facts not loaded';
    }
}

function _trendFactsRowsFromTrending(trendingItems, calculatedAt, dir) {
    const header = [
        'calculatedAt','itemCode','description','drugName','avgWeeklyUsage','percentChange','consecutiveWeeks','confidence','confidenceLevel','trendDirection','isNew','suggestion'
    ];
    const src = dir === 'up' ? (trendingItems.trendingUp || []) : (trendingItems.trendingDown || []);
    const rows = src.map((item) => [
        calculatedAt,
        String(item.itemCode || ''),
        String(item.description || ''),
        String(item.drugName || ''),
        Number.isFinite(Number(item.avgWeeklyUsage)) ? Number(item.avgWeeklyUsage) : '',
        Number.isFinite(Number(item.percentChange)) ? Number(item.percentChange) : '',
        Number.isFinite(Number(item.consecutiveWeeks)) ? Number(item.consecutiveWeeks) : '',
        Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : '',
        String(item.confidenceLevel || ''),
        String(item.trendDirection || ''),
        item.isNew ? 'true' : 'false',
        String(item.suggestion || item.recommendation || '')
    ]);
    return [header].concat(rows);
}

async function _postTrendRowsAppend(webAppUrl, sheetId, tabName, rows2d) {
    const url = `${webAppUrl}?action=append`;
    const body = { action: 'append', sheetId, tabName, rows: rows2d };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { return { ok: /ok:/i.test(txt), raw: txt }; }
}


async function appendTrendFactsRun({ trendResult }) {
    if (!trendResult) return;
    const calculatedAt = new Date().toISOString();
    trendResult.calculatedAt = calculatedAt;
    const rowsUp = _trendFactsRowsFromTrending(trendResult, calculatedAt, 'up');
    const rowsDown = _trendFactsRowsFromTrending(trendResult, calculatedAt, 'down');
    await _postTrendRowsAppend(TREND_FACTS_WEBAPP_URL, TREND_FACTS_SHEET_ID, TREND_FACTS_UP_TAB, rowsUp);
    await _postTrendRowsAppend(TREND_FACTS_WEBAPP_URL, TREND_FACTS_SHEET_ID, TREND_FACTS_DOWN_TAB, rowsDown);
}

async function _readLatestTrendTab(tabName) {
    const url = `${TREND_FACTS_WEBAPP_URL}?action=readLatest&sheetId=${encodeURIComponent(TREND_FACTS_SHEET_ID)}&tabName=${encodeURIComponent(tabName)}`;
    const res = await fetch(url, { method: 'GET' });
    return res.json();
}

function _rowsToObjects(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const header = rows[0].map((h) => String(h || ''));
    return rows.slice(1).map((r) => {
        const o = {};
        header.forEach((k, i) => { o[k] = r[i]; });
        return o;
    });
}

async function loadLatestTrendFactsFromSheet() {
    try {
        const [upRes, downRes] = await Promise.all([_readLatestTrendTab(TREND_FACTS_UP_TAB), _readLatestTrendTab(TREND_FACTS_DOWN_TAB)]);
        const up = _rowsToObjects(upRes && upRes.rows);
        const down = _rowsToObjects(downRes && downRes.rows);
        const calculatedAt = (upRes && upRes.calculatedAt) || (downRes && downRes.calculatedAt) || '';
        _setTrendFactsState({ source: 'sheet', calculatedAt, up, down, loadedAt: new Date().toISOString() });
        return getTrendFactsState();
    } catch (e) {
        const fallback = (typeof calculateTrendingItems === 'function') ? calculateTrendingItems() : null;
        _setTrendFactsState({
            source: 'calculated',
            calculatedAt: (fallback && fallback.calculatedAt) || new Date().toISOString(),
            up: (fallback && fallback.trendingUp) || [],
            down: (fallback && fallback.trendingDown) || [],
            loadedAt: new Date().toISOString()
        });
        return getTrendFactsState();
    }
}

// ---- Spike Factor Admin (Apps Script Web App) ----
        function _spikeGetConfigFromUI() {
            const webAppUrl = (document.getElementById('spikeWebAppUrl')?.value || '').trim();
            const sheetId = (document.getElementById('spikeSheetId')?.value || '').trim();
            const tabName = 'min_spike_factors';
            return { webAppUrl, sheetId, tabName };
        }

        // Prefill Admin fields from localStorage and show cache summary when available.
        document.addEventListener('DOMContentLoaded', function () {
            try {
                const urlEl = document.getElementById('spikeWebAppUrl');
                const idEl = document.getElementById('spikeSheetId');
                const savedUrl = localStorage.getItem('spike_webAppUrl') || '';
                const savedId = localStorage.getItem('spike_sheetId') || '';
                if (urlEl && !urlEl.value && savedUrl) urlEl.value = savedUrl;
                if (idEl && !idEl.value && savedId) idEl.value = savedId;

                if (window.SpikeFactors && typeof window.SpikeFactors.loadFromLocalStorage === 'function') {
                    window.SpikeFactors.loadFromLocalStorage();
                    _spikeSetLoadedSummary('Cached');
                }
                try {
                    const raw = localStorage.getItem('__trendFactsState');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        _setTrendFactsState({
                            source: parsed.source || 'cache',
                            calculatedAt: parsed.calculatedAt || '',
                            up: Array.isArray(parsed.up) ? parsed.up : [],
                            down: Array.isArray(parsed.down) ? parsed.down : [],
                            loadedAt: parsed.loadedAt || ''
                        });
                    } else {
                        updateTrendFactsStatusLine();
                    }
                } catch (_) {
                    updateTrendFactsStatusLine();
                }
            } catch (_) {}
        });

        function _spikeSetStatus(msg) {
            const el = document.getElementById('spikeAdminStatusText');
            if (el) el.textContent = msg;
        }

        function _spikeSetLoadedSummary(prefix) {
            try {
                if (!window.SpikeFactors || !window.SpikeFactors.getCacheSummary) {
                    _spikeSetStatus(prefix || 'Loaded');
                    return;
                }
                const s = window.SpikeFactors.getCacheSummary() || {};
                const when = s.loadedAt ? new Date(s.loadedAt).toLocaleString() : 'unknown';
                const computed = s.maxComputedOn ? new Date(s.maxComputedOn).toLocaleString() : null;
                const extra = computed ? `, sheetComputed=${computed}` : '';
                const parts = [];
                if (Number.isFinite(s.itemLoc)) parts.push(`itemLoc=${s.itemLoc}`);
                if (Number.isFinite(s.item)) parts.push(`item=${s.item}`);
                if (Number.isFinite(s.location)) parts.push(`loc=${s.location}`);
                if (Number.isFinite(s.subloc)) parts.push(`subloc=${s.subloc}`);
                if (Number.isFinite(s.pocket)) parts.push(`pocket=${s.pocket}`);
                const countsStr = parts.length ? parts.join(', ') : 'no rows';
                const allZero = !((s.itemLoc||0)+(s.item||0)+(s.location||0)+(s.subloc||0)+(s.pocket||0));
                const warn = allZero ? ' ⚠️ 0 rows loaded (check Web App URL / permissions / tabName / transaction data)' : '';
                _spikeSetStatus(`${prefix || 'Loaded'}: ${countsStr}${warn} (cached ${when}${extra})`);
            } catch (e) {
                _spikeSetStatus(prefix || 'Loaded');
            }
        }

        function _getTxArrayForSpikeJob() {
            // Prefer the same dataset used by charts/optimization.
            // NOTE: Dashboard runs in its own frame (Dashboard_Tabbed.html). Charts/Analytics may run in iframes.
            // We therefore need robust fallbacks that work even when charts state isn't reachable under file://.
            const tx = (
                // Raw merged monthly transactions if present
                (typeof cachedRawData !== 'undefined' && cachedRawData && cachedRawData.transactions) ? cachedRawData.transactions :
                // Cached mock/processed payloads
                (window.cachedMockData && window.cachedMockData.transactions) ? window.cachedMockData.transactions :
                // If a prior mirror succeeded
                (window.costChartState && window.costChartState.cachedMockData && window.costChartState.cachedMockData.transactions) ? window.costChartState.cachedMockData.transactions :
                // Base mock payload
                (typeof MOCK_DATA !== 'undefined' && MOCK_DATA && MOCK_DATA.transactions) ? MOCK_DATA.transactions :
                // Explicit accessor if defined
                (typeof window.getRawMockData === 'function' && window.getRawMockData() && window.getRawMockData().transactions) ? window.getRawMockData().transactions :
                null
            );

            // Flatten legacy object-of-history if needed
            if (Array.isArray(tx)) return tx;
            if (tx && typeof tx === 'object') {
                const out = [];
                for (const code of Object.keys(tx)) {
                    const h = tx[code] && tx[code].history;
                    if (!Array.isArray(h)) continue;
                    for (const rec of h) out.push(Object.assign({ itemCode: code }, rec));
                }
                return out;
            }
            return [];
        }

        // Request raw data from child iframes (Charts/Analytics) via postMessage.
        // This is required on some Chrome file:// configurations where direct parent/child object access is blocked.
        function _requestTxFromChildFrames(timeoutMs) {
            timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 1500;
            return new Promise(function(resolve) {
                try {
                    const iframes = Array.from(document.querySelectorAll('iframe'));
                    if (!iframes.length) return resolve(null);

                    const requestId = 'txReq_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                    let done = false;

                    function finish(payload) {
                        if (done) return;
                        done = true;
                        try { window.removeEventListener('message', onMsg); } catch (_) {}
                        resolve(payload || null);
                    }

                    function onMsg(ev) {
                        const d = ev && ev.data;
                        if (!d || d.type !== 'PB_TX_DATA' || d.requestId !== requestId) return;
                        finish(d);
                    }

                    window.addEventListener('message', onMsg);

                    // Broadcast request
                    for (const fr of iframes) {
                        try {
                            fr.contentWindow && fr.contentWindow.postMessage({
                                type: 'PB_REQUEST_TX',
                                requestId
                            }, '*');
                        } catch (_) {}
                    }

                    setTimeout(function() { finish(null); }, timeoutMs);
                } catch (e) {
                    resolve(null);
                }
            });
        }

        function _getTxMaxDateISO(txArr) {
            // Use charts state if available (already computed)
            try {
                const maxISO = window.costChartState?._txDateBounds?.maxISO;
                if (maxISO) return maxISO;
            } catch (_) {}

            let best = null;
            for (let i = 0; i < txArr.length; i++) {
                const r = txArr[i];
                const d = r.transDate || r.transactionDate || r.date || r.trans_date || r.datetime;
                if (!d) continue;
                const t = +new Date(d);
                if (!isFinite(t)) continue;
                if (best == null || t > best) best = t;
            }
            return (best != null) ? new Date(best).toISOString() : new Date().toISOString();
        }

        async function adminComputeAndSaveSpikeFactors() {
            try {
                await _ensureSpikeFactorsLoaded();

                const cfg = _spikeGetConfigFromUI();
                if (!cfg.webAppUrl || !cfg.sheetId) {
                    _spikeSetStatus('Missing Web App URL or Sheet ID');
                    return;
                }

                localStorage.setItem('spike_webAppUrl', cfg.webAppUrl);
                localStorage.setItem('spike_sheetId', cfg.sheetId);

                _spikeSetStatus('Computing…');

                let txArr = _getTxArrayForSpikeJob();

                // If Dashboard frame doesn't have tx data, force-load transaction scripts and rebuild once.
                if (!Array.isArray(txArr) || txArr.length === 0) {
                    try {
                        const loader = window.InventoryApp && window.InventoryApp.DataLoader;
                        if (loader && typeof loader.ensureTransactionsLoaded === 'function') {
                            await loader.ensureTransactionsLoaded();
                        }
                        try { initializeMockData && initializeMockData(); } catch (_) {}
                        txArr = _getTxArrayForSpikeJob();
                    } catch (_) {}
                }

                // If Dashboard frame still doesn't have tx data (common when charts live in an iframe under file://),
                // request it from child frames.
                if (!Array.isArray(txArr) || txArr.length === 0) {
                    const resp = await _requestTxFromChildFrames(2500);
                    if (resp && Array.isArray(resp.transactions)) {
                        txArr = resp.transactions;
                    }
                }

                if (!Array.isArray(txArr) || txArr.length === 0) {
                    _spikeSetStatus('No transactions found (data not loaded yet)');
                    return;
                }

                const endISO = _getTxMaxDateISO(txArr);

                if (!window.SpikeFactors) {
                    _spikeSetStatus('SpikeFactors module not loaded');
                    return;
                }

                const computed = window.SpikeFactors.computeSpikeFactorTable({ transactions: txArr, endDateISO: endISO });
                const c = (computed && computed.counts) ? computed.counts : {};
                _spikeSetStatus(`Saving… (itemLoc=${c.itemLoc || 0}, item=${c.item || 0}, loc=${c.location || 0})`);

                await window.SpikeFactors.saveToWebApp(cfg.webAppUrl, cfg.sheetId, cfg.tabName, computed.rows);

                // Load back into cache to use immediately (best-effort; write may still succeed if read JSONP is delayed)
                try {
                    await window.SpikeFactors.loadFromWebApp(cfg.webAppUrl, cfg.sheetId, cfg.tabName);
                    _spikeSetLoadedSummary('Saved & loaded');
                } catch (loadErr) {
                    console.warn('⚠️ SpikeFactors write succeeded but read-back load timed out.', loadErr);
                    _spikeSetStatus('Saved to Sheets (read-back timeout; retry Load From Sheet)');
                }
            } catch (e) {
                console.error(e);
                _spikeSetStatus('Error: ' + (e && e.message ? e.message : String(e)));
            }
        }

        // Expose admin functions for inline onclick handlers in the settings modal
        // NOTE: Bind independently so a missing alias cannot prevent the other binding.
        try { window.adminComputeAndSaveSpikeFactors = adminComputeAndSaveSpikeFactors; } catch (_) {}
        // Back-compat name used by the Settings modal button
        try { window.adminLoadSpikeFactorsFromSheet = adminLoadSpikeFactors; } catch (_) {}
        try { window.adminTestSpikeWebApp = adminTestSpikeWebApp; } catch (_) {}
        try { window.adminClearLocalSpikeCache = adminClearLocalSpikeCache; } catch (_) {}
        try { window.adminWriteTrendFactsTestRow = adminWriteTrendFactsTestRow; } catch (_) {}


        window.__spikeDebug = async function __spikeDebug() {
            const cfg = _spikeGetConfigFromUI();
            let txArr = [];
            try { txArr = _getTxArrayForSpikeJob(); } catch (_) { txArr = []; }
            return {
                webAppUrl: cfg.webAppUrl,
                sheetId: cfg.sheetId,
                tabName: cfg.tabName,
                txCount: Array.isArray(txArr) ? txArr.length : 0,
                txSample: Array.isArray(txArr) ? txArr.slice(0, 3) : [],
                spikeSummary: (window.SpikeFactors && window.SpikeFactors.getCacheSummary) ? window.SpikeFactors.getCacheSummary() : null,
                trendState: (window.TrendFactsState || null),
                sheetsDebug: (window.__sheetsDebug ? window.__sheetsDebug() : null)
            };
        };


        window.__spikeDebug = async function __spikeDebug() {
            const cfg = _spikeGetConfigFromUI();
            let txArr = [];
            try { txArr = _getTxArrayForSpikeJob(); } catch (_) { txArr = []; }
            return {
                webAppUrl: cfg.webAppUrl,
                sheetId: cfg.sheetId,
                tabName: cfg.tabName,
                txCount: Array.isArray(txArr) ? txArr.length : 0,
                txSample: Array.isArray(txArr) ? txArr.slice(0, 3) : [],
                spikeSummary: (window.SpikeFactors && window.SpikeFactors.getCacheSummary) ? window.SpikeFactors.getCacheSummary() : null,
                trendState: (window.TrendFactsState || null),
                sheetsDebug: (window.__sheetsDebug ? window.__sheetsDebug() : null)
            };
        };

        
        

        async function adminWriteTrendFactsTestRow() {
            try {
                const ts = new Date().toISOString();
                const mkRows = (tab) => [[
                    'calculatedAt','itemCode','description','drugName','avgWeeklyUsage','percentChange','consecutiveWeeks','confidence','confidenceLevel','trendDirection','isNew','suggestion'
                ], [
                    ts, `TEST_${tab.toUpperCase()}`, 'Trend test row', 'Trend test row', 0, 0, 0, 0, 'LOW', 'STABLE', 'false', 'test write'
                ]];

                _setTrendFactsWriteStatus('Writing test rows…');
                await googleSheetsWrite({
                    webAppUrl: TREND_FACTS_WEBAPP_URL,
                    sheetId: TREND_FACTS_SHEET_ID,
                    tabName: TREND_FACTS_UP_TAB,
                    rows2d: mkRows('up'),
                    verify: false
                });
                await googleSheetsWrite({
                    webAppUrl: TREND_FACTS_WEBAPP_URL,
                    sheetId: TREND_FACTS_SHEET_ID,
                    tabName: TREND_FACTS_DOWN_TAB,
                    rows2d: mkRows('down'),
                    verify: false
                });
                _setTrendFactsWriteStatus(`Saved to Sheets (test row ${ts})`);
            } catch (e) {
                _setTrendFactsWriteStatus('Sheets write failed');
                console.error('adminWriteTrendFactsTestRow failed', e);
            }
        }

        async function adminTestSpikeWebApp() {
            try {
                await _ensureSpikeFactorsLoaded();

                const cfg = _spikeGetConfigFromUI();
                if (!cfg.webAppUrl) { _spikeSetStatus('Missing Web App URL'); return; }
                if (!cfg.sheetId) { _spikeSetStatus('Missing Sheet ID'); return; }

                if (!window.SpikeFactors || typeof window.SpikeFactors.pingWebApp !== 'function') {
                    _spikeSetStatus('SpikeFactors not loaded (check script include/order)');
                    return;
                }

                _spikeSetStatus('Testing…');

                const result = await window.SpikeFactors.pingWebApp(cfg.webAppUrl);

                if (!result || result.ok !== true) {
                    throw new Error((result && result.error) ? result.error : 'Ping failed');
                }

                _spikeSetStatus(`Connected ✓ (${result.ts || 'ok'})`);
            } catch (err) {
                console.error(err);
                _spikeSetStatus('Error: ' + (err && err.message ? err.message : String(err)));
            }
        }

        function adminClearLocalSpikeCache() {
            try {
                localStorage.removeItem('__spikeFactorCache');
            } catch (_) {}
            try {
                if (window.SpikeFactors && typeof window.SpikeFactors.loadFromLocalStorage === 'function') {
                    // reset in-memory cache too (best-effort)
                    window.SpikeFactors.loadFromLocalStorage();
                }
            } catch (_) {}
            _spikeSetStatus('Local cache cleared');
        }

async function adminLoadSpikeFactors() {
            try {
                await _ensureSpikeFactorsLoaded();

                const cfg = _spikeGetConfigFromUI();
                if (!cfg.webAppUrl || !cfg.sheetId) {
                    _spikeSetStatus('Missing Web App URL or Sheet ID');
                    return;
                }
                localStorage.setItem('spike_webAppUrl', cfg.webAppUrl);
                localStorage.setItem('spike_sheetId', cfg.sheetId);

                _spikeSetStatus('Loading…');
                await window.SpikeFactors.loadFromWebApp(cfg.webAppUrl, cfg.sheetId, cfg.tabName);
                _spikeSetLoadedSummary('Loaded');
            } catch (e) {
                console.error(e);
                _spikeSetStatus('Error: ' + (e && e.message ? e.message : String(e)));
            }
        }

        // Hook buttons once
        document.addEventListener('DOMContentLoaded', function () {
            const btnSave = document.getElementById('btnComputeSaveSpikeFactors');
            const btnLoad = document.getElementById('btnLoadSpikeFactors');

            if (btnSave && !btnSave.dataset.bound) {
                btnSave.dataset.bound = '1';
                btnSave.addEventListener('click', function (e) {
                    e.preventDefault();
                    adminComputeAndSaveSpikeFactors();
                });
            }

            if (btnLoad && !btnLoad.dataset.bound) {
                btnLoad.dataset.bound = '1';
                btnLoad.addEventListener('click', function (e) {
                    e.preventDefault();
                    adminLoadSpikeFactors();
                });
            }
        });
