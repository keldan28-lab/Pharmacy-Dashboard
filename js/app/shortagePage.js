        // ============================================================================
        // SHORTAGE BULLETIN - CAROUSEL VERSION 2.3 (REFINED INTERACTIONS)
        // Last Modified: January 4, 2026
        // Changes: 3px blur, 85% size, click outside to close, scroll arrows per modal
        // ============================================================================
        console.log('%c🎠 Shortage Bulletin v2.3 - Refined Interactions', 'color: #38ef7d; font-size: 14px; font-weight: bold');
        console.log('%cClick outside modals to close | Click unfocused modal to switch', 'color: #38ef7d');
        console.log('%cScroll arrows only on focused modal', 'color: #38ef7d');
        
        // Cache buster: Add timestamp to help identify version
        const CAROUSEL_VERSION = '2.3-refined-interactions-' + '20260104';
        
        // ==================================================================================
        // BACK BUTTON FUNCTIONALITY
        // ==================================================================================
        let previousPage = null;
        let backButtonVisible = false;
        let currentFilter = {
            type: null,
            value: null,
            itemCodes: null
        };
        
        // Listen for navigation messages that include referrer information
        window.addEventListener('message', (event) => {
            const backButton = document.getElementById('backButton');
            
            // Handle setReferrer message (for back button without filter application)
            if (event.data.type === 'setReferrer') {
                if (event.data.referrer && event.data.referrer !== null) {
                    previousPage = event.data.referrer;
                    if (backButton) {
                        backButton.classList.add('visible');
                        backButtonVisible = true;
                    }
                    console.log('📍 Inventory: Referrer set (state preserved):', previousPage);

                    if (event.data.isBackNavigation) {
                        restoreTableViewState();

                        const restore = readModalRestoreState();
                        if (restore && restore.keepOpenOnReturn && Array.isArray(restore.items) && restore.items.length > 0) {
                            setTimeout(() => {
                                openDetailsModal(
                                    restore.drugName || (restore.items[0] && restore.items[0].drugName) || '',
                                    restore.notes || '',
                                    restore.filePath || '',
                                    restore.items,
                                    !!restore.hasSBAR,
                                    Number.isFinite(Number(restore.selectedIndex)) ? Number(restore.selectedIndex) : 0
                                );
                                clearModalRestoreState();
                            }, 120);
                        }
                    }
                }
                return; // Exit early, don't process as navigateWithFilter
            }
            
            // Show back button when navigating TO this page with a referrer
            if (event.data.type === 'navigateWithFilter') {
                // Only show back button if referrer is explicitly set and not null
                if (event.data.referrer && event.data.referrer !== null) {
                    previousPage = event.data.referrer;
                    if (backButton) {
                        backButton.classList.add('visible');
                        backButtonVisible = true;
                    }
                    console.log('📍 Inventory: Referrer detected:', previousPage);
                } else {
                    // Hide back button if referrer is null or undefined
                    if (backButton && backButtonVisible) {
                        backButton.classList.remove('visible');
                        backButtonVisible = false;
                        previousPage = null;
                    }
                    console.log('📍 Inventory: No referrer (back button hidden)');
                }
            }
            
            // Hide back button when we're being told to do something else (navigating away)
            if (event.data.type === 'requestMockData' || 
                event.data.type === 'applyDarkMode') {
                if (backButton && backButtonVisible) {
                    backButton.classList.remove('visible');
                    backButtonVisible = false;
                    previousPage = null;
                    console.log('👋 Inventory: Hiding back button (navigated away)');
                }
            }
            
            // Handle clearFilters message - reset view to empty state
            if (event.data.type === 'clearFilters') {
                console.log('🧹 Clearing filters and resetting view');
                currentFilter.type = null;
                currentFilter.value = null;
                
                // Hide back button
                if (backButton && backButtonVisible) {
                    backButton.classList.remove('visible');
                    backButtonVisible = false;
                    previousPage = null;
                }
                
                // Reset to empty state
                autoLoadJSON();
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
        // MAIN SCRIPT
        // ==================================================================================
        
        const tableBody = document.getElementById('tableBody');
        const backorderTable = document.getElementById('backorderTable');
        const emptyState = document.getElementById('emptyState');
        let currentFilePath = '';  // Store the current file path for the modal
        let currentHasSBAR = false;  // Store whether SBAR document is available
        let etaStatusDraftByItem = {}; // Persist ETA/status draft values per item while modal is open
        let itemStatusOverlayPromise = null;

        function getItemStatusSheetConfig() {
            const webAppUrl = String(
                (window.ITEM_STATUS_WEBAPP_URL || localStorage.getItem('itemStatusWebAppUrl') || localStorage.getItem('spike_webAppUrl') || '')
            ).trim();
            const sheetId = String(
                (window.ITEM_STATUS_SHEET_ID || localStorage.getItem('itemStatusSheetId') || localStorage.getItem('spike_sheetId') || localStorage.getItem('gs_sheetId') || '')
            ).trim();
            return { webAppUrl, sheetId, tabName: 'itemStatus' };
        }

        function parseItemStatusRows(raw) {
            function normalizeRows(rows) {
                if (!Array.isArray(rows)) return [];
                if (!rows.length) return [];
                const first = rows[0];
                const headerLike = Array.isArray(first) && first.some((cell) => {
                    const key = String(cell || '').trim().toLowerCase();
                    return key === 'itemcode' || key === 'item_code' || key === 'status';
                });
                if (!headerLike) return rows;
                const headers = first.map((h) => String(h || '').trim());
                return rows.slice(1).map((row) => {
                    if (!Array.isArray(row)) return row;
                    const out = {};
                    headers.forEach((h, i) => { out[h] = row[i]; });
                    return out;
                });
            }

            if (typeof raw === 'string') {
                const text = raw.trim();
                if (!text) return [];
                try {
                    return parseItemStatusRows(JSON.parse(text));
                } catch (_) {
                    return [];
                }
            }
            if (Array.isArray(raw)) return normalizeRows(raw);
            if (!raw || typeof raw !== 'object') return [];
            if (Array.isArray(raw.rows)) return normalizeRows(raw.rows);
            if (Array.isArray(raw.items)) return normalizeRows(raw.items);
            if (Array.isArray(raw.values)) return normalizeRows(raw.values);
            if (Array.isArray(raw.data)) return normalizeRows(raw.data);
            if (raw.data && typeof raw.data === 'object') {
                if (Array.isArray(raw.data.rows)) return normalizeRows(raw.data.rows);
                if (Array.isArray(raw.data.items)) return normalizeRows(raw.data.items);
                if (Array.isArray(raw.data.values)) return normalizeRows(raw.data.values);
            }
            if (raw.result && typeof raw.result === 'object') {
                if (Array.isArray(raw.result.rows)) return normalizeRows(raw.result.rows);
                if (Array.isArray(raw.result.items)) return normalizeRows(raw.result.items);
                if (Array.isArray(raw.result.values)) return normalizeRows(raw.result.values);
                if (Array.isArray(raw.result.data)) return normalizeRows(raw.result.data);
                if (raw.result.data && typeof raw.result.data === 'object') {
                    if (Array.isArray(raw.result.data.rows)) return normalizeRows(raw.result.data.rows);
                    if (Array.isArray(raw.result.data.items)) return normalizeRows(raw.result.data.items);
                    if (Array.isArray(raw.result.data.values)) return normalizeRows(raw.result.data.values);
                }
            }
            return [];
        }

        function getItemStatusField(row, keys) {
            if (!row || typeof row !== 'object') return '';
            const keyMap = {};
            Object.keys(row).forEach((k) => {
                keyMap[String(k).trim().toLowerCase()] = row[k];
            });
            for (let i = 0; i < keys.length; i++) {
                const val = keyMap[String(keys[i]).trim().toLowerCase()];
                if (val !== undefined && val !== null) return val;
            }
            return '';
        }

        function formatDateMMDDYYYY(value) {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw;
            const direct = new Date(raw);
            if (!Number.isNaN(direct.getTime())) {
                const mm = String(direct.getMonth() + 1).padStart(2, '0');
                const dd = String(direct.getDate()).padStart(2, '0');
                const yyyy = String(direct.getFullYear());
                return `${mm}-${dd}-${yyyy}`;
            }
            const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m) return `${m[2]}-${m[3]}-${m[1]}`;
            return raw;
        }

        function isNonFormularyItem(item) {
            const v = item && item.formulary;
            if (v === false) return true;
            const norm = String(v == null ? '' : v).trim().toLowerCase();
            return norm === 'false' || norm === '0' || norm === 'no' || norm === 'non-formulary';
        }

        const SBAR_FILEPATH_PREFIX = 'M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\';

        function sanitizeSelectedFilePath(value) {
            const raw = String(value || '').trim();
            if (!raw) return '';
            return raw.replace(/^(?:[A-Za-z]:\\fakepath\\)/i, '');
        }

        function buildSelectedFilePath(files) {
            const list = Array.isArray(files) ? files : [];
            const names = list.map((f) => sanitizeSelectedFilePath((f && f.name) || '')).filter(Boolean);
            if (!names.length) return '';
            if (names.length === 1) return `${SBAR_FILEPATH_PREFIX}${names[0]}`;
            return names.map((n) => `${SBAR_FILEPATH_PREFIX}${n}`).join('; ');
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
                        availability: String(getItemStatusField(row, ['availability']) || ''),
                        status: String(getItemStatusField(row, ['status']) || ''),
                        ETA: formatDateMMDDYYYY(getItemStatusField(row, ['etaDate', 'eta_date', 'eta']) || ''),
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
                item.availability = String((agg && agg.availability) || '');
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
                const callbackName = '__itemStatusReadCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                const cleanUrl = String(cfg.webAppUrl || '').replace(/\/+$/, '');
                const url = `${cleanUrl}?action=read&sheetId=${encodeURIComponent(cfg.sheetId)}&tabName=${encodeURIComponent(cfg.tabName)}&callback=${encodeURIComponent(callbackName)}`;
                const script = document.createElement('script');
                let done = false;

                const finish = (rows) => {
                    if (done) return;
                    done = true;
                    try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
                    if (script.parentNode) script.parentNode.removeChild(script);
                    resolve(Array.isArray(rows) ? rows : []);
                };

                window[callbackName] = function(payload) {
                    finish(parseItemStatusRows(payload));
                };

                script.async = true;
                script.src = url;
                script.onerror = () => finish([]);
                document.head.appendChild(script);
                setTimeout(() => finish([]), 5000);
            });
        }

        async function fetchAndMergeItemStatusData(baseData) {
            if (!baseData || !Array.isArray(baseData.items)) return baseData;
            const cfg = getItemStatusSheetConfig();
            if (!cfg.webAppUrl || !cfg.sheetId) return baseData;

            try {
                const cleanUrl = String(cfg.webAppUrl || '').replace(/\/+$/, '');
                const url = `${cleanUrl}?action=read&sheetId=${encodeURIComponent(cfg.sheetId)}&tabName=${encodeURIComponent(cfg.tabName)}`;
                const resp = await fetch(url, { method: 'GET' });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const payload = await resp.json();
                return mergeItemStatusIntoData(baseData, parseItemStatusRows(payload));
            } catch (err) {
                console.warn('⚠️ itemStatus GET read failed; trying JSONP fallback', err);
                const rows = await fetchItemStatusRowsJsonp(cfg);
                return mergeItemStatusIntoData(baseData, rows);
            }
        }

        function ensureItemStatusOverlayLoaded() {
            if (!cachedMockData || !Array.isArray(cachedMockData.items)) return Promise.resolve(cachedMockData);
            const cfg = getItemStatusSheetConfig();
            if (!cfg.webAppUrl || !cfg.sheetId) return Promise.resolve(cachedMockData);
            if (!itemStatusOverlayPromise) {
                itemStatusOverlayPromise = fetchAndMergeItemStatusData(cachedMockData)
                    .then((merged) => {
                        cachedMockData = merged || cachedMockData;
                        return cachedMockData;
                    })
                    .catch((err) => {
                        console.warn('⚠️ itemStatus overlay skipped', err);
                        return cachedMockData;
                    });
            }
            return itemStatusOverlayPromise;
        }

        async function refreshItemStatusOverlay(forceReload) {
            if (forceReload) itemStatusOverlayPromise = null;
            return ensureItemStatusOverlayLoaded();
        }

        // Cookie utility functions
        function setCookie(name, value, days = 365) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            const expires = "expires=" + date.toUTCString();
            document.cookie = name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/;SameSite=Lax";
        }

        function getCookie(name) {
            const nameEQ = name + "=";
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                let cookie = cookies[i];
                while (cookie.charAt(0) === ' ') {
                    cookie = cookie.substring(1, cookie.length);
                }
                if (cookie.indexOf(nameEQ) === 0) {
                    return decodeURIComponent(cookie.substring(nameEQ.length, cookie.length));
                }
            }
            return null;
        }

        function deleteCookie(name) {
            document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        }

        function buildDeptBreakdown(sublocationsList) {
            const invMap = (typeof SUBLOCATION_MAP !== 'undefined' && SUBLOCATION_MAP) || (window.SUBLOCATION_MAP || {});
            const depts = {};
            const list = Array.isArray(sublocationsList) ? sublocationsList : [];

            function ensureDept(name) {
                if (!depts[name]) {
                    depts[name] = { qty: 0, min: 0, max: 0, standard: false, standardQty: 0, locations: [], main: {} };
                }
                return depts[name];
            }

            for (let i = 0; i < list.length; i++) {
                const s = list[i] || {};
                const code = s.sublocation;
                const qty = Number.isFinite(+s.curQty) ? +s.curQty : (Number.isFinite(+s.qty) ? +s.qty : 0);
                const min = Number.isFinite(+s.minQty) ? +s.minQty : (Number.isFinite(+s.min) ? +s.min : 0);
                const max = Number.isFinite(+s.maxQty) ? +s.maxQty : (Number.isFinite(+s.max) ? +s.max : 0);
                const standard = !!s.standard;

                const info = (code && invMap && invMap[code]) ? invMap[code] : null;
                let deptName = (info && info.department) ? String(info.department) : 'Pharmacy';
                let mainLocation = (info && info.mainLocation) ? String(info.mainLocation) : String(code || 'Unknown');

                if (deptName.toLowerCase() === 'pyxis') deptName = 'Pyxis';
                else deptName = 'Pharmacy';

                const dept = ensureDept(deptName);
                dept.qty += qty;
                dept.min += min;
                dept.max += max;
                dept.standard = dept.standard || standard;
                if (standard) dept.standardQty += (Number.isFinite(+s.standardQty) ? +s.standardQty : qty);

                const locObj = { code: String(code || ''), qty, min, max, standard, mainLocation, department: deptName };
                dept.locations.push(locObj);

                if (!dept.main[mainLocation]) dept.main[mainLocation] = { qty: 0, locations: [] };
                dept.main[mainLocation].qty += qty;
                dept.main[mainLocation].locations.push(locObj);
            }

            ensureDept('Pyxis');
            ensureDept('Pharmacy');
            return { depts };
        }


        function captionForDept(dept) {
            const d = dept || { min: 0, max: 0, standard: false };
            const parts = [];
            if (d.standard) parts.push('Standard');
            parts.push(`Min: ${Number(d.min) || 0}`);
            parts.push(`Max: ${Number(d.max) || 0}`);
            return parts.join('  |  ');
        }

        function buildPyxisLocationsBadges(dept, itemCode) {
            const d = dept || { main: {} };
            const mainKeys = Object.keys(d.main || {});
            mainKeys.sort((a, b) => a.localeCompare(b));

            let html = '';
            for (let m = 0; m < mainKeys.length; m++) {
                const main = mainKeys[m];
                const group = d.main[main];
                const locs = (group && Array.isArray(group.locations)) ? group.locations : [];
                const nonZero = locs.filter(l => (l && typeof l.qty === 'number' && l.qty > 0));
                if (nonZero.length === 0) continue;

                html += `<div class="inventory-locations-group"><div class="inventory-locations-group-title">${main}</div><div class="inventory-locations-badges">`;
                nonZero.sort((a, b) => String(a.code).localeCompare(String(b.code)));
                for (let i = 0; i < nonZero.length; i++) {
                    const l = nonZero[i];
                    const badgeText = `${l.code}  <span class="inv-loc-sep">|</span>  <span class="inv-loc-qty">${l.qty}</span>`;
                    const standardClass = l.standard ? ' is-standard' : '';
                    html += `<button type="button" class="inv-loc-badge${standardClass}" data-sublocation="${String(l.code)}" data-item-code="${String(itemCode || '')}" title="View ${String(l.code)} in Charts">${badgeText}</button>`;
                }
                html += `</div></div>`;
            }
            return html || '<div class="inventory-locations-empty">No Pyxis inventory on hand</div>';
        }

        function updateCompactInventoryHeader(pyxisQty, pyxisStandardQty, pharmacyQty, pyxCaption, phxCaption) {
            const pyxEl = document.getElementById('compactPyxisValue');
            const phxEl = document.getElementById('compactPharmacyValue');
            const pyxCapEl = document.getElementById('compactPyxisCaption');
            const phxCapEl = document.getElementById('compactPharmacyCaption');
            if (pyxEl) pyxEl.innerHTML = pyxisQty + (pyxisStandardQty > 0 ? ` <span class="compact-standard-note">(${pyxisStandardQty} Std)</span>` : '');
            if (phxEl) phxEl.textContent = String(pharmacyQty || 0);
            if (pyxCapEl) pyxCapEl.textContent = pyxCaption || '';
            if (phxCapEl) phxCapEl.textContent = phxCaption || '';
        }


        function submitItemStatusViaFormPost(scriptUrl, payload, timeoutMs = 1600) {
            return new Promise((resolve) => {
                try {
                    const iframeName = 'itemStatusFormTarget_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                    const iframe = document.createElement('iframe');
                    iframe.name = iframeName;
                    iframe.style.display = 'none';
                    document.body.appendChild(iframe);

                    const form = document.createElement('form');
                    form.method = 'POST';
                    form.action = scriptUrl;
                    form.target = iframeName;
                    form.style.display = 'none';

                    Object.keys(payload || {}).forEach((k) => {
                        const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = k;
                        input.value = String(payload[k] == null ? '' : payload[k]);
                        form.appendChild(input);
                    });

                    document.body.appendChild(form);
                    form.submit();

                    setTimeout(() => {
                        try { form.remove(); } catch (_) {}
                        try { iframe.remove(); } catch (_) {}
                        resolve(true);
                    }, timeoutMs);
                } catch (err) {
                    console.warn('⚠️ Form-post fallback failed', err);
                    resolve(false);
                }
            });
        }


        function initEtaExpansionControls() {
            const modalRoot = document.getElementById('detailsModal');
            if (!modalRoot) return;
            const etaCard = modalRoot.querySelector('#etaInfoCard');
            const expandBtn = modalRoot.querySelector('#etaExpandBtn');
            const saveBtn = modalRoot.querySelector('#etaSaveBtn');
            const expansion = modalRoot.querySelector('#etaExpansion');
            const dateRow = modalRoot.querySelector('#etaDateRow');
            const dateInput = modalRoot.querySelector('#etaDateInput');
            const notesInput = modalRoot.querySelector('#etaNotesInput');
            const statusButtons = modalRoot.querySelectorAll('#etaStatusToggleGroup .eta-toggle-btn[data-eta-status]');
            const notesButtons = modalRoot.querySelectorAll('#etaNotesToggleGroup .eta-toggle-btn[data-notes-type]');
            const severityButtons = modalRoot.querySelectorAll('#etaSeverityToggleGroup .eta-toggle-btn[data-eta-severity]');
            const severityGroup = modalRoot.querySelector('#etaSeverityToggleGroup');
            const severitySuggestion = modalRoot.querySelector('#etaSeveritySuggestion');
            const addTaskBtn = modalRoot.querySelector('#etaAddTaskBtn');
            const fileInput = modalRoot.querySelector('#etaFileInput');
            const fileBtn = modalRoot.querySelector('#etaFileBtn');
            const filePath = modalRoot.querySelector('#etaFilePath');
            const savingOverlay = modalRoot.querySelector('#etaSavingOverlay');
            if (!etaCard || !expandBtn || !saveBtn || !expansion || !savingOverlay || !severityGroup) return;

            let activeNotesType = 'general';

            function getSelectedItem() {
                return (Array.isArray(currentModalItems) && currentModalItems[currentSelectedIndex]) ? currentModalItems[currentSelectedIndex] : null;
            }

            function getDraftForSelectedItem() {
                const selected = getSelectedItem() || {};
                const key = String(selected.itemCode || selected.description || selected.drugName || 'unknown');
                if (!etaStatusDraftByItem[key]) {
                    etaStatusDraftByItem[key] = {
                        availability: String(selected.availability || ''),
                        status: String(selected.status || ''),
                        etaDate: String(selected.ETA || ''),
                        notes: String(selected.notes || ''),
                        SBARnotes: String(selected.assessment || ''),
                        filePath: String(selected.filePath || '')
                    };
                }
                return etaStatusDraftByItem[key];
            }

            function setExpanded(isOpen) {
                etaCard.classList.toggle('is-expanded', isOpen);
                expandBtn.setAttribute('aria-expanded', String(isOpen));
                expansion.setAttribute('aria-hidden', String(!isOpen));
            }

            function updateDateVisibility() {
                const active = modalRoot.querySelector('#etaStatusToggleGroup .eta-toggle-btn.active[data-eta-status]');
                const state = active ? active.getAttribute('data-eta-status') : '';
                const showExpandedFields = (state === 'watchlist' || state === 'backordered');
                dateRow.hidden = !showExpandedFields;
                severityGroup.hidden = !showExpandedFields;
            }


            function updateSeveritySuggestion() {
                if (!severitySuggestion) return;
                const draft = getDraftForSelectedItem();
                const selected = getSelectedItem() || {};
                const availability = String(draft.availability || '');
                if (availability !== 'backordered') {
                    severitySuggestion.hidden = true;
                    severitySuggestion.innerHTML = '';
                    return;
                }

                const effectiveInv = getEffectiveInventory(selected);
                const totalQty = Number(effectiveInv && effectiveInv.effectiveQuantity) || 0;
                let usageRateCurrent = selected.usageRate || 0;
                if (Array.isArray(selected.usageRate) && selected.usageRate.length > 0) {
                    const analysis = calculateTrueUsageRate(selected.usageRate, selected.status);
                    usageRateCurrent = Number(analysis.dailyBaseline) || 0;
                }
                if (!(usageRateCurrent > 0)) {
                    severitySuggestion.hidden = true;
                    severitySuggestion.innerHTML = '';
                    return;
                }

                const daysRemaining = totalQty / usageRateCurrent;
                let suggested = '';
                if (daysRemaining < 14) suggested = 'critical';
                else if (daysRemaining < 21) suggested = 'severe';
                else if (daysRemaining < 28) suggested = 'moderate';

                if (!suggested) {
                    severitySuggestion.hidden = true;
                    severitySuggestion.innerHTML = '';
                    return;
                }

                severitySuggestion.hidden = false;
                severitySuggestion.innerHTML = `Suggestion: ${suggested.toUpperCase()} severity (<button type="button" class="eta-days-link" data-scroll-target="inventoryProjectionSection">${daysRemaining.toFixed(1)} days remaining</button>).`;
                const daysLink = severitySuggestion.querySelector('.eta-days-link');
                if (daysLink) {
                    daysLink.addEventListener('click', () => {
                        const section = document.getElementById('inventoryProjectionSection') || document.querySelector('.chart-container');
                        if (section && typeof section.scrollIntoView === 'function') {
                            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    });
                }
            }

            function setSavingOverlay(isSaving) {
                etaCard.classList.toggle('is-saving', !!isSaving);
                savingOverlay.setAttribute('aria-hidden', String(!isSaving));
            }

            async function saveItemStatusToSheet() {
                const cfg = getItemStatusSheetConfig();
                if (!cfg.webAppUrl || !cfg.sheetId) {
                    console.warn('⚠️ Missing itemStatus web app configuration');
                    setSavingOverlay(true);
                    setTimeout(() => setSavingOverlay(false), 700);
                    return;
                }

                const selected = getSelectedItem() || {};
                const draft = getDraftForSelectedItem();
                const payload = {
                    action: 'itemStatusWrite',
                    sheetId: cfg.sheetId,
                    tabName: cfg.tabName,
                    itemCode: String(selected.itemCode || ''),
                    description: String(selected.description || selected.drugName || ''),
                    availability: String(draft.availability || 'available'),
                    status: (String(draft.availability || 'available') === 'watchlist' || String(draft.availability || 'available') === 'backordered') ? String(draft.status || 'moderate') : '',
                    notes: String(draft.notes || ''),
                    SBARnotes: String(draft.SBARnotes || ''),
                    filePath: String(draft.filePath || ''),
                    etaDate: String(draft.etaDate || ''),
                    updatedAt: new Date().toISOString(),
                    date: formatDateMMDDYYYY(new Date())
                };

                setSavingOverlay(true);
                saveBtn.disabled = true;
                let persisted = false;
                try {
                    const resp = await fetch(cfg.webAppUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!resp.ok) {
                        console.warn('⚠️ Failed to persist item status via fetch, HTTP', resp.status, '- trying form-post fallback');
                        await submitItemStatusViaFormPost(cfg.webAppUrl, payload);
                    } else {
                        persisted = true;
                    }
                } catch (err) {
                    console.warn('⚠️ Fetch save failed; trying form-post fallback', err);
                    await submitItemStatusViaFormPost(cfg.webAppUrl, payload);
                    persisted = true;
                } finally {
                    if (persisted) {
                        selected.availability = payload.availability;
                        selected.status = payload.status;
                        selected.ETA = payload.etaDate;
                        selected.notes = payload.notes;
                        selected.assessment = payload.SBARnotes;
                        selected.filePath = payload.filePath;
                        selected.SBAR = !!String(payload.filePath || '').trim();
                        if (typeof selectModalItem === 'function') {
                            selectModalItem(currentSelectedIndex);
                        }
                        await refreshItemStatusOverlay(true);
                        if (typeof selectModalItem === 'function') {
                            selectModalItem(currentSelectedIndex);
                        }
                        if (typeof applyCurrentFilter === 'function' && currentFilter && currentFilter.type) {
                            await applyCurrentFilter();
                        } else if (cachedMockData && Array.isArray(cachedMockData.items) && typeof displayData === 'function') {
                            displayData(cachedMockData);
                        }
                        refreshOpenModalFromCache(payload.itemCode);
                        try { localStorage.setItem('itemStatusLastUpdated', String(Date.now())); } catch (_) {}
                        try { window.parent && window.parent.postMessage({ type: 'itemStatusUpdated', itemCode: payload.itemCode }, '*'); } catch (_) {}
                    }
                    saveBtn.disabled = false;
                    setSavingOverlay(false);
                }
            }

            function syncNotesInputFromDraft() {
                if (!notesInput) return;
                const draft = getDraftForSelectedItem();
                notesInput.value = activeNotesType === 'sbar' ? (draft.SBARnotes || '') : (draft.notes || '');
            }

            function writeNotesToDraft() {
                if (!notesInput) return;
                const draft = getDraftForSelectedItem();
                if (activeNotesType === 'sbar') draft.SBARnotes = notesInput.value || '';
                else draft.notes = notesInput.value || '';
            }

            function setActiveButton(buttons, attr, value) {
                buttons.forEach((btn) => {
                    const isActive = btn.getAttribute(attr) === value;
                    btn.classList.toggle('active', isActive);
                });
            }

            function hydrateControlsFromDraft() {
                const draft = getDraftForSelectedItem();
                setActiveButton(statusButtons, 'data-eta-status', String(draft.availability || ''));
                setActiveButton(severityButtons, 'data-eta-severity', String(draft.status || ''));
                if (dateInput) dateInput.value = String(draft.etaDate || '');
                if (filePath) filePath.textContent = draft.filePath || 'No file selected';
                setActiveButton(notesButtons, 'data-notes-type', activeNotesType);
                syncNotesInputFromDraft();
                updateDateVisibility();
                updateSeveritySuggestion();
            }

            async function refreshSelectedItemFromLatestSheet() {
                const selected = getSelectedItem();
                if (!selected || !cachedMockData || !Array.isArray(cachedMockData.items)) return;
                const targetCode = String(selected.itemCode || '').trim();
                if (!targetCode) return;

                await refreshItemStatusOverlay(true);
                const latest = cachedMockData.items.find((item) => String(item && item.itemCode || '').trim() === targetCode) || null;
                if (!latest) return;

                selected.availability = String(latest.availability || '');
                selected.status = String(latest.status || '');
                selected.ETA = String(latest.ETA || '');
                selected.notes = String(latest.notes || '');
                selected.assessment = String(latest.assessment || '');
                selected.filePath = String(latest.filePath || '');
                selected.SBAR = !!latest.SBAR || !!String(latest.filePath || '').trim();

                const key = String(selected.itemCode || selected.description || selected.drugName || 'unknown');
                etaStatusDraftByItem[key] = {
                    availability: String(selected.availability || ''),
                    status: String(selected.status || ''),
                    etaDate: String(selected.ETA || ''),
                    notes: String(selected.notes || ''),
                    SBARnotes: String(selected.assessment || ''),
                    filePath: String(selected.filePath || '')
                };
                hydrateControlsFromDraft();
            }

            expandBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const willOpen = !etaCard.classList.contains('is-expanded');
                if (willOpen) {
                    const password = window.prompt('Enter password to expand details:');
                    if (password !== 'admin') {
                        window.alert('Access denied');
                        return;
                    }
                }
                setExpanded(willOpen);
                if (willOpen) {
                    await refreshSelectedItemFromLatestSheet();
                    if (typeof selectModalItem === 'function') selectModalItem(currentSelectedIndex);
                }
            });

            statusButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    statusButtons.forEach((node) => node.classList.remove('active'));
                    btn.classList.add('active');
                    const draft = getDraftForSelectedItem();
                    draft.availability = btn.getAttribute('data-eta-status') || 'available';
                    updateDateVisibility();
                    updateSeveritySuggestion();
                });
            });

            severityButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    severityButtons.forEach((node) => node.classList.remove('active'));
                    btn.classList.add('active');
                    const draft = getDraftForSelectedItem();
                    draft.status = btn.getAttribute('data-eta-severity') || 'moderate';
                    updateSeveritySuggestion();
                });
            });

            notesButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    writeNotesToDraft();
                    notesButtons.forEach((node) => node.classList.remove('active'));
                    btn.classList.add('active');
                    activeNotesType = btn.getAttribute('data-notes-type') || 'general';
                    syncNotesInputFromDraft();
                });
            });

            if (notesInput) {
                notesInput.addEventListener('input', () => {
                    writeNotesToDraft();
                });
            }

            if (dateInput) {
                dateInput.addEventListener('change', () => {
                    const draft = getDraftForSelectedItem();
                    draft.etaDate = dateInput.value || '';
                });
            }

            if (fileInput && fileBtn && filePath) {
                fileBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', () => {
                    const files = Array.from(fileInput.files || []);
                    const selectedFile = files.length ? files[0] : null;
                    const resolvedPath = selectedFile
                        ? buildSelectedFilePath(files)
                        : '';
                    filePath.textContent = resolvedPath || 'No file selected';
                    const draft = getDraftForSelectedItem();
                    draft.filePath = resolvedPath;
                });
            }



            if (addTaskBtn) {
                addTaskBtn.addEventListener('click', () => {
                    const selected = getSelectedItem() || {};
                    const itemCode = String(selected.itemCode || '').trim();
                    const itemName = String(selected.description || selected.drugName || selected.name || '').trim();
                    try {
                        window.parent && window.parent.postMessage({
                            type: 'OPEN_TASK_CREATE',
                            data: {
                                itemCode: itemCode,
                                itemName: itemName
                            }
                        }, '*');
                    } catch (err) {
                        console.warn('⚠️ Failed to open task composer from ETA modal', err);
                    }
                    if (typeof closeDetailsModal === 'function') closeDetailsModal();
                });
            }

            saveBtn.addEventListener('click', async () => {
                writeNotesToDraft();
                await saveItemStatusToSheet();
            });

            window.__shortageHydrateEtaDraft = hydrateControlsFromDraft;
            window.__shortageUpdateSeveritySuggestion = updateSeveritySuggestion;
            hydrateControlsFromDraft();
        }

        function wireInventoryBadgeActions(itemCode) {
            const badges = document.querySelectorAll('#pyxisLocationsPanel .inv-loc-badge[data-sublocation]');
            badges.forEach((badge) => {
                badge.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const sublocation = String(badge.getAttribute('data-sublocation') || '').trim();
                    const code = String(itemCode || badge.getAttribute('data-item-code') || '').trim();
                    if (!code || !sublocation) return;
                    try {
                        saveTableViewState();
                        saveModalRestoreState({
                            keepOpenOnReturn: true,
                            selectedIndex: currentSelectedIndex,
                            items: currentModalItems,
                            drugName: (currentModalItems[currentSelectedIndex] && currentModalItems[currentSelectedIndex].drugName) || '',
                            notes: (currentModalItems[currentSelectedIndex] && currentModalItems[currentSelectedIndex].notes) || '',
                            filePath: currentFilePath || '',
                            hasSBAR: !!currentHasSBAR
                        });
                        window.parent.postMessage({
                            type: 'drillToItemInVerticalBar',
                            itemCode: code,
                            sublocation: sublocation,
                            location: sublocation
                        }, '*');
                        closeDetailsModal();
                    } catch (err) {
                        console.warn('⚠️ Failed to send drillToItemInVerticalBar', err);
                    }
                };
            });
        }
        // Generate mock data for display
        // 
        // USAGE RATE FEATURE:
        // The "usageRate" field can accept either:
        //   - A single number: "usageRate": 5
        //   - An array of numbers: "usageRate": [3, 4.5, 6.1, 5.8, 7.2]
        // 
        // When an array is provided, the system will:
        //   1. Calculate a linear regression trend from the data points
        //   2. Use the trend line to project future usage (accounting for increasing/decreasing usage patterns)
        //   3. Display a more accurate inventory projection curve
        // 
        // Example: "usageRate": [3, 4, 5, 6] shows increasing usage from 3 to 6 units/day
        //          The chart will project continued increase based on this trend
        //
        // ==================================================================================
        // DATA REQUEST FROM PARENT DASHBOARD
        // ==================================================================================
        // This page now receives data from the parent Dashboard via postMessage
        // instead of generating it locally
        
        let cachedMockData = null;
        let dataRequestCallbacks = [];

        const PROJECTION_DEBUG_FLAG = '__projectionDebug';

        function _projectionClamp(value, min, max) {
            const n = Number(value);
            if (!Number.isFinite(n)) return min;
            return Math.max(min, Math.min(max, n));
        }

        function getTrendFactForItem(itemCode) {
            const code = String(itemCode || '').trim();
            if (!code) return null;
            const trendState = window.trendingItems || {};
            trendState._itemLookup = trendState._itemLookup || {};
            if (trendState._itemLookup[code] !== undefined) return trendState._itemLookup[code];

            const up = Array.isArray(trendState.trendingUp) ? trendState.trendingUp : [];
            const down = Array.isArray(trendState.trendingDown) ? trendState.trendingDown : [];
            const match = up.find((x) => String(x.itemCode || '').trim() === code) || down.find((x) => String(x.itemCode || '').trim() === code);
            if (!match) {
                trendState._itemLookup[code] = null;
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
            trendState._itemLookup[code] = trendFact;
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
        
        /**
         * Request mock data from parent Dashboard container
         */
        function requestMockDataFromParent() {
            return new Promise((resolve, reject) => {
                // If we already have cached data, return it immediately
                if (cachedMockData) {
                    console.log('✓ Returning cached mock data');
                    ensureItemStatusOverlayLoaded().then(() => resolve(cachedMockData));
                    return;
                }

                // Prefer shared helper (supports {raw, computed} payload)
                if (window.InventoryApp && window.InventoryApp.postMessage && window.InventoryApp.postMessage.requestMockData) {
                    window.InventoryApp.postMessage.requestMockData(({ computed }) => {
                        const fallback = { lastUpdated: new Date().toISOString().split('T')[0], items: [] };
                        cachedMockData = computed || fallback;
                        ensureItemStatusOverlayLoaded().then(() => resolve(cachedMockData));
                    });
                    return;
                }
                
                // Add this request to callbacks
                dataRequestCallbacks.push({ resolve, reject });
                
                // Only send request if this is the first callback
                if (dataRequestCallbacks.length === 1) {
                    console.log('📤 Requesting mock data from parent Dashboard...');
                    
                    // Send request to parent
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({
                            type: 'requestMockData'
                        }, '*');
                        
                        // Set timeout in case parent doesn't respond
                        setTimeout(() => {
                            if (!cachedMockData && dataRequestCallbacks.length > 0) {
                                console.error('❌ No response from parent Dashboard - using fallback empty data');
                                const fallbackData = { lastUpdated: new Date().toISOString().split('T')[0], items: [] };
                                cachedMockData = fallbackData;
                                dataRequestCallbacks.forEach(cb => cb.resolve(fallbackData));
                                dataRequestCallbacks = [];
                            }
                        }, 3000);
                    } else {
                        // Not in iframe, reject
                        const error = new Error('Not in iframe context');
                        dataRequestCallbacks.forEach(cb => cb.reject(error));
                        dataRequestCallbacks = [];
                    }
                }
            });
        }
        
        /**
         * Listen for mock data response from parent
         */
        window.addEventListener('message', function(event) {
            if (event.data.type === 'mockDataResponse') {
                console.log('📦 Received mock data from parent Dashboard');
                const payload = (window.InventoryApp && window.InventoryApp.postMessage && window.InventoryApp.postMessage.pickPayload)
                    ? window.InventoryApp.postMessage.pickPayload(event.data)
                    : { computed: event.data.data, raw: null };
                cachedMockData = payload.computed;
                ensureItemStatusOverlayLoaded().then(() => {
                    // Resolve all pending callbacks
                    dataRequestCallbacks.forEach(cb => cb.resolve(cachedMockData));
                    dataRequestCallbacks = [];
                });
                
                console.log('✓ Mock data cached:', cachedMockData.items.length, 'items');
            }
            
            // Handle navigation with filter
            if (event.data.type === 'navigateWithFilter') {
                console.log('📊 Received filter:', event.data.filter);
                
                // Special handling for filters that provide explicit itemCodes
                if ((event.data.filter === 'fdaShortages' || event.data.filter === 'expiringSoon' || event.data.filter === 'projectedWasteSpike') && event.data.itemCodes) {
                    console.log('📋', event.data.filter, 'filter with', event.data.itemCodes.length, 'itemCodes');
                    currentFilter.type = event.data.filter;
                    currentFilter.itemCodes = event.data.itemCodes;
                } else {
                    currentFilter.type = event.data.filter;
                    currentFilter.value = event.data.value || null;
                }
                
                // Apply filter immediately if data is loaded
                if (cachedMockData) {
                    applyCurrentFilter();
                } else {
                    // Wait for data to load, then apply filter
                    requestMockDataFromParent().then(() => {
                        applyCurrentFilter();
                    });
                }
            }
            
            // Also handle dark mode toggle
            if (event.data.type === 'darkModeToggle') {
                document.body.classList.toggle('dark-mode', event.data.enabled);
                console.log('📦 Shortage Bulletin: Dark mode', event.data.enabled ? 'enabled' : 'disabled', 'from parent');
            }
            
            // Handle trending items update
            if (event.data.type === 'trendingItemsUpdate' && event.data.trendingItems) {
                console.log('📈 Received trending items update:', {
                    trendingUp: event.data.trendingItems.trendingUp.length,
                    trendingDown: event.data.trendingItems.trendingDown.length,
                    threshold: event.data.trendingItems.threshold
                });
                window.trendingItems = event.data.trendingItems;
                
                // If currently showing topUsed filter, refresh it
                if (currentFilter.type === 'topUsed') {
                    applyCurrentFilter();
                }
            }
        });
        
        /**
         * Wrapper function that maintains the original function signature
         * but now gets data from parent instead of generating locally
         */
        async function generateMockData() {
            console.log('generateMockData() called - requesting from parent Dashboard');
            return await requestMockDataFromParent();
        }
        
        // ==================================================================================
        // END DATA REQUEST FROM PARENT DASHBOARD
        // ==================================================================================
        
        // LEGACY MOCK DATA GENERATOR - NOW DISABLED
        // This function has been replaced by requestMockDataFromParent()
        function generateMockData_LEGACY() {
            console.log('generateMockData_LEGACY() called - THIS FUNCTION IS DEPRECATED');

﻿return {
  "lastUpdated": "2025-11-21",
  "items": [
    {
      "drugName": "LORazepam Inj",
      "description": "LORazepam Inj 2 mg/1 mL (1 mL) Vial",
      "itemCode": 28387,
      "quantity": 740,
      "pyxis": 8,
      "pharmacy": 732,
      "usageRate": [2,4,8.5],
      "status": "moderate",
      "ETA": "11/30/2025",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - IV Lorazepam Shortage 4-28-25.docx",
      "notes": "30 day BUD at room temp\n",
      "assessment": "Continue SBAR - can use if no alternative available.  Can load to Pyxis for active patients Max=4 min=2"
    },
    {
      "drugName": "penicillin G benzathine",
      "description": "penicillin G benzathine 2400000 unit/4 mL (4 mL) Syringe",
      "itemCode": 130149,
      "quantity": 0,
      "pyxis": 0,
      "pharmacy": 0,
      "usageRate": [0],
      "status": "critical",
      "ETA": "3/1/2026",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Penicillin G Benzathine (Bicillin LA) Shortage SRMC.docx",
      "notes": "",
      "assessment": ""
    },
    {
      "drugName": "morphine",
      "description": "morphine 2 mg/1 mL (1 mL) Syringe",
      "itemCode": 13812,
      "quantity": 100,
      "pyxis": 0,
      "pharmacy": 100,
      "usageRate": [0],
      "status": "moderate",
      "ETA": "TBD",
      "SBAR": true,
      "filePath": "none",
      "notes": "",
      "assessment": ""
    },
    {
      "drugName": "penicillin G benzathine",
      "description": "penicillin G benzathine 600000 unit/1 mL (1 mL) Syringe",
      "itemCode": 324250,
      "quantity": 0,
      "pyxis": 0,
      "pharmacy": 0,
      "usageRate": [0],
      "status": "critical",
      "ETA": "12/2/2025",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Penicillin G Benzathine (Bicillin LA) Shortage SRMC.docx",
      "notes": "",
      "assessment": ""
    },
    {
      "drugName": "penicillin G benzathine",
      "description": "penicillin G benzathine 1200000 unit/2 mL (2 mL) Syringe",
      "itemCode": 324251,
      "quantity": 17,
      "pyxis": 4,
      "pharmacy": 13,
      "usageRate": [0],
      "status": "critical",
      "ETA": "11/30/2025",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Penicillin G Benzathine (Bicillin LA) Shortage SRMC.docx",
      "notes": "Available to order direct via Request Form. For patients with congenital syphilis only.\n",
      "assessment": ""
    },
    {
      "drugName": "droNABinol",
      "description": "droNABinol 2.5 mg  Capsule",
      "itemCode": 27083,
      "quantity": 170,
      "pyxis": 26,
      "pharmacy": 144,
      "usageRate": [1,1.2,6.8],
      "status": "severe",
      "ETA": "12/31/2025",
      "SBAR": true,
      "filePath": "none",
      "notes": "Room Temp BUD: 3 months.\n",
      "assessment": ""
    },
    {
      "drugName": "dipyridamole",
      "description": "dipyridamole 5 mg/1 mL (10 mL) Vial",
      "itemCode": 27010,
      "quantity": 0,
      "pyxis": 0,
      "pharmacy": 0,
      "usageRate": [0],
      "status": "critical",
      "ETA": "12/5/2025",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Dipyridamole Inj Shortage 11.20.2025.docx",
      "notes": "",
      "assessment": "	Provider to use alternative agent Regadenoson (Lexiscan) for Dipyridamole (PERSANTINE ®) injection as a diagnostic agent for the evaluation of coronary artery disease."
    },
    {
      "drugName": "LORazepam Inj",
      "description": "LORazepam Inj 2 mg/1 mL (1 mL) Cartridge",
      "itemCode": 28387,
      "quantity": 3,
      "pyxis": 3,
      "pharmacy": 0,
      "usageRate": [1,2.7,2.7],
      "status": "moderate",
      "ETA": "12/12/2025",
      "SBAR": false,
      "filePath": "none",
      "notes": "30 day BUD at room temp\n",
      "assessment": ""
    },
    {
      "drugName": "morphine PF",
      "description": "morphine PF 4 mg/1 mL (1 mL) Cartridge",
      "itemCode": 148679,
      "quantity": 48,
      "pyxis": 0,
      "pharmacy": 48,
      "usageRate": [0],
      "status": "moderate",
      "ETA": "12/12/2025",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Morphine Inj Shortage 11.20.2025.docx",
      "notes": "",
      "assessment": "	Providers to use alternative opioids (Hydromorphone and Fentanyl injections) for pain management. 	Restrict Morphine drips to comfort care patients only."
    },
    {
      "drugName": "morphine PF",
      "description": "morphine PF 2 mg/1 mL (1 mL) Cartridge",
      "itemCode": 151276,
      "quantity": 311,
      "pyxis": 311,
      "pharmacy": 0,
      "usageRate": [59.2,55,50,53,25,4,52,3,23,43,6,5,67],
      "status": "moderate",
      "ETA": "12/12/2025",
      "SBAR": false,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Morphine Inj Shortage 11.20.2025.docx",
      "notes": "",
      "assessment": "	Providers to use alternative opioids (Hydromorphone and Fentanyl injections) for pain management. 	Restrict Morphine drips to comfort care patients only."
    },
    {
      "drugName": "morphine PF",
      "description": "morphine PF 4 mg/1 mL (1 mL) Vial",
      "itemCode": 322531,
      "quantity": 524,
      "pyxis": 524,
      "pharmacy": 0,
      "usageRate": [75.7,72.5,79.4,2,2,3,80,60],
      "status": "moderate",
      "ETA": "TBD",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Morphine Inj Shortage 11.20.2025.docx",
      "notes": "",
      "assessment": "	Providers to use alternative opioids (Hydromorphone and Fentanyl injections) for pain management. 	Restrict Morphine drips to comfort care patients ony."
    },
    {
      "drugName": "morphine",
      "description": "morphine 10 mg/1 mL (1 mL) Vial",
      "itemCode": 38150,
      "quantity": 279,
      "pyxis": 275,
      "pharmacy": 4,
      "usageRate": [24.1,17,8.5],
      "status": "moderate",
      "ETA": "11/30/2025",
      "SBAR": true,
      "filePath": "none",
      "notes": "",
      "assessment": "	Providers to use alternative opioids (Hydromorphone and Fentanyl injections) for pain management. 	Restrict Morphine drips to comfort care patients ony."
    },
    {
      "drugName": "morphine PF",
      "description": "morphine PF 2 mg/1 mL (1 mL) Vial",
      "itemCode": 155990,
      "quantity": 175,
      "pyxis": 0,
      "pharmacy": 175,
      "usageRate": [0],
      "status": "moderate",
      "ETA": "TBD",
      "SBAR": true,
      "filePath": "M:\\RV-Pharmacy\\(3) SBAR-KDS\\SBAR\\1. Current SBAR\\SBAR - Morphine Inj Shortage 11.20.2025.docx",
      "notes": "",
      "assessment": "	Providers to use alternative opioids (Hydromorphone and Fentanyl injections) for pain management. 	Restrict Morphine drips to comfort care patients ony."
    },
  {
    "drugName": "Midazolam Inj",
    "description": "Midazolam Inj 5 mg/1 mL (1 mL) Vial",
    "itemCode": "",
    "quantity": 12,
    "pyxis": 7,
    "pharmacy": 3,
    "usageRate": [1.2, 2.8, 3.1],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  {
    "drugName": "Fentanyl Citrate Inj",
    "description": "Fentanyl Citrate Inj 100 mcg/2 mL (2 mL) Ampule",
    "itemCode": "",
    "quantity": 20,
    "pyxis": 12,
    "pharmacy": 6,
    "usageRate": [2.0, 2.5, 3.3],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  {
    "drugName": "Ketamine Inj",
    "description": "Ketamine Inj 50 mg/1 mL (1 mL) Vial",
    "itemCode": "",
    "quantity": 15,
    "pyxis": 9,
    "pharmacy": 4,
    "usageRate": [1.5, 2.2, 2.9],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  {
    "drugName": "Diazepam Inj",
    "description": "Diazepam Inj 10 mg/2 mL (2 mL) Ampule",
    "itemCode": "",
    "quantity": 6,
    "pyxis": 2,
    "pharmacy": 8,
    "usageRate": [0.7, 1.9, 2.6],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  {
    "drugName": "Hydromorphone Inj",
    "description": "Hydromorphone Inj 2 mg/1 mL (1 mL) Vial",
    "itemCode": "",
    "quantity": 14,
    "pyxis": 6,
    "pharmacy": 11,
    "usageRate": [1.4, 2.1, 2.8],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  {
    "drugName": "Propofol Inj",
    "description": "Propofol Inj 10 mg/1 mL (20 mL) Vial",
    "itemCode": "",
    "quantity": 18,
    "pyxis": 10,
    "pharmacy": 5,
    "usageRate": [2.2, 2.9, 3.4],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  {
    "drugName": "Etomidate Inj",
    "description": "Etomidate Inj 20 mg/10 mL (10 mL) Vial",
    "itemCode": "",
    "quantity": 9,
    "pyxis": 3,
    "pharmacy": 6,
    "usageRate": [0.8, 1.6, 2.5],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  {
    "drugName": "Succinylcholine Inj",
    "description": "Succinylcholine Inj 20 mg/1 mL (10 mL) Vial",
    "itemCode": "",
    "quantity": 11,
    "pyxis": 8,
    "pharmacy": 2,
    "usageRate": [1.3, 2.0, 2.7],
    "status": "",
    "ETA": "",
    "SBAR": "",
    "filePath": "",
    "notes": "",
    "assessment": ""
  },
  ]
}
;
        }

        // ==================================================================================
        // ENHANCED USAGE RATE ANALYSIS - Percentile-Based Statistical Algorithm
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
        
        /**
         * Calculate percentile value from sorted array
         */
        function calculatePercentile(sortedArray, percentile) {
            if (sortedArray.length === 0) return 0;
            const index = (percentile / 100) * (sortedArray.length - 1);
            const lower = Math.floor(index);
            const upper = Math.ceil(index);
            const weight = index - lower;
            
            let result;
            if (lower === upper) {
                result = sortedArray[lower];
            } else {
                result = sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
            }
            
            console.log('📐 calculatePercentile:', {
                percentile: percentile,
                arrayLength: sortedArray.length,
                index: index,
                lower: lower,
                upper: upper,
                lowerValue: sortedArray[lower],
                upperValue: sortedArray[upper],
                weight: weight,
                result: result
            });
            
            return result;
        }
        
        /**
         * Detect and filter outliers using configurable percentile cutoff
         * Returns filtered array with outliers removed
         */
        function filterOutliersIQR(dataArray, percentileCutoff = 25) {
            if (!Array.isArray(dataArray) || dataArray.length < 4) {
                console.log('⚠️ filterOutliersIQR: Array too small, returning original');
                return dataArray; // Need at least 4 points
            }
            
            // Sort the array
            const sorted = [...dataArray].sort((a, b) => a - b);
            console.log('🔍 filterOutliersIQR called with:', {
                original: dataArray,
                sorted: sorted,
                percentileCutoff: percentileCutoff
            });
            
            // Calculate percentile threshold
            const threshold = calculatePercentile(sorted, percentileCutoff);
            console.log('📏 Calculated threshold:', threshold, 'at', percentileCutoff + 'th percentile');
            
            // Calculate Q1 and Q3 for reference
            const q1 = calculatePercentile(sorted, 25);
            const q3 = calculatePercentile(sorted, 75);
            const iqr = q3 - q1;
            
            // Filter out values below threshold
            const filtered = dataArray.filter(value => value >= threshold);
            
            console.log('✂️ Filtering result:', {
                threshold: threshold,
                keptValues: filtered,
                filteredOut: dataArray.filter(value => value < threshold),
                keptCount: filtered.length,
                filteredCount: dataArray.length - filtered.length
            });
            
            return filtered;
        }
        
        function calculateTrueUsageRate(usageRateArray, itemStatus) {
            // ========== CONFIGURABLE CONSTANTS (from localStorage) ==========
            const PERCENTILE_CUTOFF = parseFloat(localStorage.getItem('usagePercentileCutoff') || '25');  // Percentile threshold
            const MIN_BASELINE_PERIODS = 2;          // Minimum weeks needed for calculation (lowered to allow aggressive filtering)
            const DAYS_PER_WEEK = 7;                 // Convert weekly to daily
            
            console.log('🎯 calculateTrueUsageRate called with:', {
                usageRateArray: usageRateArray,
                itemStatus: itemStatus,
                PERCENTILE_CUTOFF: PERCENTILE_CUTOFF,
                fromLocalStorage: localStorage.getItem('usagePercentileCutoff')
            });
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
                console.log('✅ Using filtered data:', filteredData.length, 'weeks');
            } else {
                // Not enough points after filtering - use all original data
                dataToUse = usageRateArray;
                useFiltered = false;
                console.log('⚠️ Not enough filtered data (' + filteredData.length + ' < ' + MIN_BASELINE_PERIODS + '), using ALL original data:', usageRateArray.length, 'weeks');
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

        // Get system information
        function getSystemInfo() {
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                screenResolution: `${screen.width}x${screen.height}`,
                windowSize: `${window.innerWidth}x${window.innerHeight}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                cookiesEnabled: navigator.cookieEnabled,
                onlineStatus: navigator.onLine
            };
        }

        // Get user settings
        function getUserSettings() {
            return {
                showItemCodes: getCookie('showItemCodes') === 'true',
                showQuantities: getCookie('showQuantities') === 'true',
                jsonFilePath: getCookie('jsonFilePath') || '',
                userName: 'SARV',
                darkMode: getCookie('darkMode') === 'true'
            };
        }

        // Get status tooltip description
        function getStatusTooltip(status) {
            const tooltips = {
                'critical': 'Critical shortage with immediate patient safety impact. Requires urgent action and alternative sourcing.',
                'severe': 'Severe shortage affecting multiple patients or services. Substitution protocols may be needed.',
                'moderate': 'Moderate shortage with manageable inventory levels. Monitor closely for potential escalation.',
                'resolved': 'Shortage resolved. Adequate inventory levels restored and supply chain stabilized.',
                'non-formulary': 'Non-formulary item. Please submit approval request to the management team before re-ordering.'
            };
            return tooltips[status] || 'Status information unavailable';
        }


        function getDisplayStatus(item) {
            if (isNonFormularyItem(item)) return 'non-formulary';
            return String((item && item.status) || '').toLowerCase();
        }

        function normalizeModalNotesText(value) {
            const raw = String(value == null ? '' : value);
            return raw.replace(/\r\n/g, '\n').trim();
        }


        /**
         * Extract display text from description by removing content in brackets
         * Keeps the brackets content for searching but hides it from display
         * @param {string} description - Full description with potential [BRAND] name
         * @returns {string} - Description without bracket content
         */
        function getDisplayDescription(description) {
            if (!description) return '';
            // Remove content in square brackets (including the brackets)
            return description.replace(/\s*\[.*?\]\s*/g, '').trim();
        }

        // Tooltip management functions
        let activeTooltip = null;

        function showTooltip(triggerElement, content, type = 'default') {
            // Remove any existing tooltip
            hideTooltip();
            
            const container = document.getElementById('tooltipContainer');
            const tooltip = document.createElement('div');
            tooltip.className = `tooltip-popup ${type}`;
            tooltip.textContent = content;
            
            container.appendChild(tooltip);
            activeTooltip = tooltip;
            
            // Position the tooltip
            positionTooltip(triggerElement, tooltip);
            
            // Show tooltip with animation
            requestAnimationFrame(() => {
                tooltip.classList.add('visible');
            });
        }

        function hideTooltip() {
            if (activeTooltip) {
                activeTooltip.remove();
                activeTooltip = null;
            }
        }

        function positionTooltip(triggerElement, tooltip) {
            const triggerRect = triggerElement.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;
            
            // Calculate position - centered above the trigger element
            // Arrow will always point to top center of the badge/icon
            let left = triggerRect.left + (triggerRect.width / 2);
            let top = triggerRect.top - tooltipRect.height - 10; // 10px gap above trigger
            
            // Always position above (arrow at bottom of tooltip pointing to top of badge)
            tooltip.classList.add('arrow-bottom');
            
            // Center horizontally
            left = left - (tooltipRect.width / 2);
            
            // Keep within viewport horizontally
            if (left < 10) {
                left = 10;
            } else if (left + tooltipRect.width > viewportWidth - 10) {
                left = viewportWidth - tooltipRect.width - 10;
            }
            
            // If not enough space above, position below instead
            if (top < 10) {
                top = triggerRect.bottom + 10; // Position below with 10px gap
                tooltip.classList.remove('arrow-bottom');
                tooltip.classList.add('arrow-top');
            }
            
            // Keep within viewport vertically
            if (top + tooltipRect.height > viewportHeight - 10) {
                top = viewportHeight - tooltipRect.height - 10;
            }
            
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        }

        function attachTooltipListeners(element, content, type = 'default') {
            element.addEventListener('mouseenter', () => {
                showTooltip(element, content, type);
            });
            
            element.addEventListener('mouseleave', () => {
                hideTooltip();
            });
        }

        // Initialize settings from cookies (Settings modal removed - this is now a no-op)
        function initializeSettings() {
            // Settings modal has been removed from the page
            // This function is kept to prevent errors in existing code that calls it
            console.log('ℹ️ Settings initialization skipped (settings modal removed)');
        }

        // Settings modal functions
        function openSettings() {
            document.getElementById('settingsModal').classList.add('active');
            
            // Modal is now visible
            setTimeout(() => {
                // Settings modal opened
            }, 100);
            setTimeout(() => {
                // Settings modal fully loaded
            }, 300);
        }

        function closeSettings() {
            document.getElementById('settingsModal').classList.remove('active');
        }

        // Details Modal functions
        let currentModalItems = [];
        let currentSelectedIndex = 0;
        let chartHoveredItemIndex = null;
        const MODAL_RESTORE_KEY = '__inventoryModalRestoreState';
        const TABLE_VIEW_RESTORE_KEY = '__inventoryTableViewState';

        function saveTableViewState() {
            try {
                const tableContainer = document.querySelector('.table-container');
                const searchInput = document.getElementById('searchInput');
                const payload = {
                    currentFilter: currentFilter ? JSON.parse(JSON.stringify(currentFilter)) : null,
                    searchTerm: searchInput ? String(searchInput.value || '') : '',
                    scrollTop: tableContainer ? Number(tableContainer.scrollTop || 0) : 0,
                    savedAt: Date.now()
                };
                sessionStorage.setItem(TABLE_VIEW_RESTORE_KEY, JSON.stringify(payload));
            } catch (_) {}
        }

        function readTableViewState() {
            try {
                const raw = sessionStorage.getItem(TABLE_VIEW_RESTORE_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (_) {
                return null;
            }
        }

        function clearTableViewState() {
            try { sessionStorage.removeItem(TABLE_VIEW_RESTORE_KEY); } catch (_) {}
        }

        function restoreTableViewState() {
            const state = readTableViewState();
            if (!state) return;

            try {
                if (state.currentFilter && typeof state.currentFilter === 'object') {
                    currentFilter = state.currentFilter;
                }

                const searchInput = document.getElementById('searchInput');
                if (searchInput && typeof state.searchTerm === 'string') {
                    searchInput.value = state.searchTerm;
                }

                const applyDone = () => {
                    const tableContainer = document.querySelector('.table-container');
                    if (tableContainer) tableContainer.scrollTop = Number(state.scrollTop || 0);
                };

                if (currentFilter && currentFilter.type) {
                    Promise.resolve(applyCurrentFilter()).then(() => setTimeout(applyDone, 0)).catch(() => setTimeout(applyDone, 0));
                } else {
                    Promise.resolve(autoLoadJSON()).then(() => setTimeout(applyDone, 0)).catch(() => setTimeout(applyDone, 0));
                }
            } catch (_) {}
        }

        function saveModalRestoreState(state) {
            try {
                sessionStorage.setItem(MODAL_RESTORE_KEY, JSON.stringify(state || {}));
            } catch (_) {}
        }

        function readModalRestoreState() {
            try {
                const raw = sessionStorage.getItem(MODAL_RESTORE_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (_) {
                return null;
            }
        }

        function clearModalRestoreState() {
            try { sessionStorage.removeItem(MODAL_RESTORE_KEY); } catch (_) {}
        }

        function openDetailsModal(drugName, notes, filePath, items, hasSBAR, initialIndex = 0) {
            const modal = document.getElementById('detailsModal');
            if (!readModalRestoreState()) {
                clearModalRestoreState();
            }
            const modalHeader = modal.querySelector('.modal-header');
            const modalDrugName = document.getElementById('modalDrugName');
            const modalnotes = document.getElementById('modalnotes');
            const modalDrugInfo = document.getElementById('modalDrugInfo');
            
            // Clean up any previously added sections first
            const oldItemList = document.querySelector('.item-list-container');
            const oldInventoryBreakdown = document.querySelector('.inventory-breakdown');
            const oldUsageRate = document.querySelector('.usage-rate-container');
            const oldChartContainer = document.querySelector('.chart-container');
            const oldAssessment = document.querySelector('.assessment-section');
            const oldNotesSection = document.querySelector('.notes-section');
            
            if (oldItemList) oldItemList.remove();
            if (oldInventoryBreakdown) oldInventoryBreakdown.remove();
            if (oldUsageRate) oldUsageRate.remove();
            if (oldChartContainer) oldChartContainer.remove();
            if (oldAssessment) oldAssessment.remove();
            if (oldNotesSection) oldNotesSection.remove();
            
            // Store items globally for selection handling
            etaStatusDraftByItem = {};
            currentModalItems = items;
            currentSelectedIndex = initialIndex;
            
            // Store the file path globally for the "Go To Sbar" button
            currentFilePath = filePath;
            
            // Store SBAR status for button control
            currentHasSBAR = hasSBAR;
            
            // Set drug name
            modalDrugName.textContent = drugName;
            
            // Get highest priority status for header color
            const statusPriority = { 'non-formulary': 5, critical: 4, severe: 3, moderate: 2, resolved: 1 };
            const highestPriority = items.reduce((highest, item) => {
                return statusPriority[item.status] > statusPriority[highest] ? item.status : highest;
            }, 'resolved');
            
            // Set header color based on status
            modalHeader.className = `modal-header status-${highestPriority}`;
            
            // Build item list (replaces Total Items card)
            const itemListHTML = `
                <div class="item-list-container">
                    <div class="item-list-header">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: #11998e;">
                            <path d="M9,5V9H21V5M9,19H21V15H9M9,14H21V10H9M4,9H8V5H4M4,19H8V15H4M4,14H8V10H4V14Z"/>
                        </svg>
                        Items (${items.length})
                    </div>
                    <div class="item-list" id="itemList">
                        ${items.map((item, index) => `
                            <div class="item-list-item ${index === initialIndex ? 'active' : ''}" onclick="selectModalItem(${index})" data-index="${index}">
                                <div class="item-list-radio"></div>
                                <div class="item-list-description">${getDisplayDescription(item.description)}</div>
                                <div class="item-list-badge ${getDisplayStatus(item)}">${getDisplayStatus(item)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            // Display metrics for the selected item (at initialIndex)
            const firstItem = items[initialIndex];
            const firstItemPyxis = firstItem.pyxis || 0;
            const firstItemPyxisStandard = firstItem.pyxisStandard || 0;
            const firstItemPharmacy = firstItem.pharmacy || 0;
            
            // Use effective inventory for days remaining calculation
            const firstItemEffectiveInv = getEffectiveInventory(firstItem);
            const firstItemQty = firstItemEffectiveInv.effectiveQuantity;
            
            // Normalize usageRate - handle both single value and array (weekly data)
            const firstItemUsageRateOriginal = firstItem.usageRate || 0;
            let firstItemUsageRateCurrent = firstItemUsageRateOriginal;
            let usageRateDisplay = '';
            
            if (Array.isArray(firstItemUsageRateOriginal)) {
                // Use enhanced algorithm for better projections (weekly → daily)
                const analysis = calculateTrueUsageRate(firstItemUsageRateOriginal, firstItem.status);
                
                if (analysis.constrainedPeriods > 0) {
                    // Show enhanced analysis with weekly context
                    firstItemUsageRateCurrent = analysis.dailyBaseline;
                    usageRateDisplay = `${analysis.dailyBaseline.toFixed(2)} units/day (${analysis.weeklyBaseline.toFixed(1)} units/week)`;
                } else {
                    // No constraint detected - show moving average from analysis
                    firstItemUsageRateCurrent = analysis.dailyBaseline;
                    usageRateDisplay = `${analysis.dailyBaseline.toFixed(2)} units/day (${analysis.weeklyBaseline.toFixed(1)} units/week)`;
                }
            } else {
                // Single value - assume it's already daily
                firstItemUsageRateCurrent = firstItemUsageRateOriginal;
                usageRateDisplay = `${firstItemUsageRateCurrent.toFixed(2)} units/day`;
            }
            
            const firstItemETA = firstItem.ETA || 'TBD';
            
            // Calculate days remaining for first item
            const daysRemaining = firstItemUsageRateCurrent > 0 ? (firstItemQty / firstItemUsageRateCurrent).toFixed(1) : '∞';
            const daysUntilETA = firstItemETA !== 'TBD' ? 
                Math.ceil((new Date(firstItemETA) - new Date()) / (1000 * 60 * 60 * 24)) : 
                null;
            
            // Build top summary info (NO STATUS CARD)
            modalDrugInfo.innerHTML = `
                <div class="modal-info-item modal-info-item-eta" id="etaInfoCard">
                    <div class="eta-summary-row">
                        <div>
                            <div class="eta-label-row">
                                <svg class="eta-label-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M19,3H18V1H16V3H8V1H6V3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M19,19H5V8H19V19M7,10H12V15H7V10Z"/>
                                </svg>
                                <span class="eta-label-text">Earliest ETA</span>
                            </div>
                            <div class="modal-info-value" id="displayETA">${firstItemETA}</div>
                        </div>
                        <div class="eta-summary-actions">
                            <button type="button" class="eta-expand-btn" id="etaExpandBtn" aria-label="Expand ETA details" aria-expanded="false">
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <circle cx="5" cy="12" r="2"></circle>
                                    <circle cx="12" cy="12" r="2"></circle>
                                    <circle cx="19" cy="12" r="2"></circle>
                                </svg>
                            </button>
                            <button type="button" class="eta-save-btn" id="etaSaveBtn" aria-label="Save ETA status">
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="eta-expansion" id="etaExpansion" aria-hidden="true">
                        <div class="eta-group-title">Availability</div>
                        <div class="eta-status-toggle-group" id="etaStatusToggleGroup" role="group" aria-label="Availability">
                            <button type="button" class="eta-toggle-btn" data-eta-status="available">Available</button>
                            <button type="button" class="eta-toggle-btn" data-eta-status="watchlist">Watchlist</button>
                            <button type="button" class="eta-toggle-btn" data-eta-status="backordered">Backordered</button>
                        </div>
                        <div class="eta-date-row" id="etaDateRow" hidden>
                            <label for="etaDateInput" class="eta-field-label">Expected Date</label>
                            <input type="date" id="etaDateInput" class="eta-date-input">
                        </div>
                        <div class="eta-group-title">Severity</div>
                        <div class="eta-status-toggle-group" id="etaSeverityToggleGroup" role="group" aria-label="Severity">
                            <button type="button" class="eta-toggle-btn" data-eta-severity="moderate">Moderate</button>
                            <button type="button" class="eta-toggle-btn" data-eta-severity="severe">Severe</button>
                            <button type="button" class="eta-toggle-btn" data-eta-severity="critical">Critical</button>
                        </div>
                        <div class="eta-severity-suggestion" id="etaSeveritySuggestion" hidden></div>
                        <div class="eta-notes-wrap">
                            <div class="eta-group-title">Notes</div>
                            <div class="eta-notes-toggle-group" id="etaNotesToggleGroup" role="group" aria-label="Notes type">
                                <button type="button" class="eta-toggle-btn" data-notes-type="general">General</button>
                                <button type="button" class="eta-toggle-btn" data-notes-type="sbar">SBAR</button>
                                <button type="button" class="eta-toggle-btn eta-add-task-btn" id="etaAddTaskBtn">+ Add Task</button>
                            </div>
                            <textarea id="etaNotesInput" class="eta-notes-input" rows="3" placeholder="Add notes"></textarea>
                        </div>
                        <div class="eta-file-row">
                            <input type="file" id="etaFileInput" class="eta-file-input">
                            <button type="button" class="eta-file-btn" id="etaFileBtn">Select File</button>
                            <span class="eta-file-path" id="etaFilePath">No file selected</span>
                        </div>
                    </div>
                    <div class="eta-saving-overlay" id="etaSavingOverlay" aria-hidden="true">Saving...</div>
                </div>
            `;
            
            // --------------------------------------------------------------------------
            // Inventory breakdown (grouped by department/mainLocation)
            // --------------------------------------------------------------------------
            const INV_MAP = (typeof SUBLOCATION_MAP !== 'undefined' && SUBLOCATION_MAP) || (window.SUBLOCATION_MAP || {});
            const invEntry = (cachedMockData && cachedMockData.inventory && cachedMockData.inventory[firstItem.itemCode])
                ? cachedMockData.inventory[firstItem.itemCode]
                : null;

            // Accept both shapes:
            //  A) normalized: { sublocations: [{sublocation, curQty, minQty, maxQty, standard, ...}, ...] }
            //  B) raw inventory: { "3TWA": {qty, min, max, standard, ...}, ... }
            let sublocations = [];
            if (invEntry && Array.isArray(invEntry.sublocations)) {
                sublocations = invEntry.sublocations;
            } else if (invEntry && typeof invEntry === 'object') {
                sublocations = Object.keys(invEntry).map(code => {
                    const row = invEntry[code] || {};
                    return {
                        sublocation: code,
                        curQty: Number(row.qty ?? row.curQty ?? 0),
                        minQty: Number(row.min ?? row.minQty ?? 0),
                        maxQty: Number(row.max ?? row.maxQty ?? 0),
                        standard: !!row.standard,
                        standardQty: Number(row.standardQty ?? 0),
                        pocket: row.pocket,
                        expires: row.expires
                    };
                });
            }

            const invGroups = buildDeptBreakdown(sublocations);
            const pyx = invGroups.depts.Pyxis;
            const phx = invGroups.depts.Pharmacy;

            // Build inventory breakdown section
            const inventoryBreakdownHTML = `
                <div class="inventory-breakdown" id="inventoryBreakdown">
                    <div class="inventory-item inventory-item-clickable" id="pyxisInvCard" role="button" tabindex="0" aria-expanded="false">
                        <div class="inventory-item-header">
                            <svg class="inventory-item-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path d="M21,16.5C21,16.88 20.79,17.21 20.47,17.38L12.57,21.82C12.41,21.94 12.21,22 12,22C11.79,22 11.59,21.94 11.43,21.82L3.53,17.38C3.21,17.21 3,16.88 3,16.5V7.5C3,7.12 3.21,6.79 3.53,6.62L11.43,2.18C11.59,2.06 11.79,2 12,2C12.21,2 12.41,2.06 12.57,2.18L20.47,6.62C20.79,6.79 21,7.12 21,7.5V16.5M12,4.15L6.04,7.5L12,10.85L17.96,7.5L12,4.15M5,15.91L11,19.29V12.58L5,9.21V15.91M19,15.91V9.21L13,12.58V19.29L19,15.91Z"/>
                            </svg>
                            <span class="inventory-item-label">Pyxis</span>
                        </div>
                        <div class="inventory-item-value" id="displayPyxis">${pyx.qty}</div>
                        <div class="inventory-item-caption" id="displayPyxisCaption">${captionForDept(pyx)}</div>

                        <div class="inventory-expansion" id="pyxisExpansion" aria-hidden="true">
                            <div class="inventory-expansion-header" id="pyxisExpansionHeader" role="button" tabindex="0" aria-label="Collapse location details">
                                <div class="inventory-expansion-metric">
                                    <span class="inventory-expansion-label">Pyxis</span>
                                    <span class="inventory-expansion-value" id="compactPyxisValue">${pyx.qty}${pyx.standardQty > 0 ? ` <span class="compact-standard-note">(${pyx.standardQty} Std)</span>` : ''}</span>
                                    <span class="inventory-expansion-caption" id="compactPyxisCaption">${captionForDept(pyx)}</span>
                                </div>
                                <div class="inventory-expansion-metric">
                                    <span class="inventory-expansion-label">Pharmacy</span>
                                    <span class="inventory-expansion-value" id="compactPharmacyValue">${phx.qty}</span>
                                    <span class="inventory-expansion-caption" id="compactPharmacyCaption">${captionForDept(phx)}</span>
                                </div>
                            </div>
                            <div class="inventory-locations-panel" id="pyxisLocationsPanel">
                                ${buildPyxisLocationsBadges(pyx, firstItem.itemCode)}
                            </div>
                        </div>
                    </div>

                    <div class="inventory-item" id="pharmacyInvCard">
                        <div class="inventory-item-header">
                            <svg class="inventory-item-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path d="M17,13H13V17H11V13H7V11H11V7H13V11H17M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>
                            </svg>
                            <span class="inventory-item-label">Pharmacy</span>
                        </div>
                        <div class="inventory-item-value" id="displayPharmacy">${phx.qty}</div>
                        <div class="inventory-item-caption" id="displayPharmacyCaption">${captionForDept(phx)}</div>
                    </div>
                </div>
            `;

            // Build usage rate section
            const usageRateHTML = `
                <div class="usage-rate-container">
                    <div class="usage-rate-header">
                        <svg class="usage-rate-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                            <path d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z"/>
                        </svg>
                        <span class="usage-rate-label">Average Usage Rate</span>
                    </div>
                    <div class="usage-rate-value" id="displayUsageRate">${usageRateDisplay}</div>
                    <div class="days-remaining" id="displayDaysRemaining">
                        ${daysRemaining !== '∞' ? 
                            `<strong>Days Remaining:</strong> ${daysRemaining} days ${daysUntilETA !== null && parseFloat(daysRemaining) < daysUntilETA ? '⚠️ <strong style="color: #d32f2f;">Stock will run out before ETA</strong>' : ''}` : 
                            '<strong>Days Remaining:</strong> No current usage'
                        }
                    </div>
                </div>
            `;
            
            // Build inventory projection chart
            const chartHTML = `
                <div class="chart-container" id="inventoryProjectionSection">
                    <div class="chart-header">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <svg class="chart-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path d="M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z"/>
                            </svg>
                            Inventory Projection
                        </div>
                        <button class="chart-analytics-btn" onclick="openAnalytics()" title="View in Analytics Charts">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
                                <rect x="7" y="11" width="2" height="3" fill="currentColor"/>
                                <rect x="10" y="8" width="2" height="6" fill="currentColor"/>
                                <rect x="13" y="10" width="2" height="4" fill="currentColor"/>
                                <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="chart-canvas-wrapper">
                        <canvas id="inventoryChart"></canvas>
                    </div>
                </div>
            `;
            
            // Get assessment (combine unique assessments - stays the same for all items)
            const assessments = items.map(item => item.assessment).filter(a => a);
            const assessmentText = assessments.length > 0 ? [...new Set(assessments)].join('\n\n') : 'No mitigation strategies documented.';
            const hasAssessment = assessments.length > 0;
            
            // Build assessment section with conditional styling
            // Hide only if SBAR is false AND assessment is empty, otherwise just gray out if no SBAR
            const assessmentHTML = `
                <div class="assessment-section ${!hasSBAR ? 'grayed-out' : ''}" id="assessmentSection" style="${!hasSBAR && !hasAssessment ? 'display: none;' : ''}" data-has-assessment="${hasAssessment}">
                    <div class="assessment-header">
                        <div class="assessment-title-wrapper">
                            <svg class="assessment-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path d="M9,22A1,1 0 0,1 8,21V18H4A2,2 0 0,1 2,16V4C2,2.89 2.9,2 4,2H20A2,2 0 0,1 22,4V16A2,2 0 0,1 20,18H13.9L10.2,21.71C10,21.9 9.75,22 9.5,22H9M10,16V19.08L13.08,16H20V4H4V16H10M16.5,6C16.78,6 17,6.22 17,6.5C17,6.78 16.78,7 16.5,7H7.5C7.22,7 7,6.78 7,6.5C7,6.22 7.22,6 7.5,6H16.5M16.5,9C16.78,9 17,9.22 17,9.5C17,9.78 16.78,10 16.5,10H7.5C7.22,10 7,9.78 7,9.5C7,9.22 7.22,9 7.5,9H16.5M16.5,12C16.78,12 17,12.22 17,12.5C17,12.78 16.78,13 16.5,13H7.5C7.22,13 7,12.78 7,12.5C7,12.22 7.22,12 7.5,12H16.5Z"/>
                            </svg>
                            <span class="assessment-title">Mitigation Strategies & Assessment</span>
                        </div>
                        <button class="open-sbar-btn" id="goToSbarBtnInline" onclick="openSbarFile()" ${!hasSBAR ? 'disabled style="opacity: 0.5; cursor: not-allowed; background: #999;"' : ''}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                            <span>Open SBAR</span>
                        </button>
                    </div>
                    <div class="assessment-content" id="assessmentContent">${assessmentText}</div>
                </div>
            `;
            
            // Build notes section (will show first item's notes)
            const firstItemNotes = normalizeModalNotesText(firstItem.notes || '');
            const notesHTML = `
                <div class="notes-section" id="notesSection" style="${!firstItemNotes ? 'display: none;' : ''}">
                    <div class="notes-header">
                        <svg class="notes-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M15,18V16H6V18H15M18,14V12H6V14H18Z"/>
                        </svg>
                        <span class="notes-title">Notes</span>
                    </div>
                    <div class="notes-content ${!firstItemNotes ? 'empty' : ''}" id="notesContent"></div>
                </div>
            `;
            
            // Insert assessment section right after modal-drug-info (after ETA)
            modalDrugInfo.insertAdjacentHTML('afterend', assessmentHTML);
            
            // Insert other sections
            const notesSection = document.querySelector('.modal-section');
            notesSection.insertAdjacentHTML('beforebegin', itemListHTML);
            notesSection.insertAdjacentHTML('beforebegin', inventoryBreakdownHTML);
            notesSection.insertAdjacentHTML('beforebegin', usageRateHTML);
            notesSection.insertAdjacentHTML('beforebegin', chartHTML);

            initEtaExpansionControls();

            // Enable Pyxis inventory expansion (locations badges)
            (function initPyxisInventoryExpansion() {
                const pyxisCard = document.getElementById('pyxisInvCard');
                const pharmacyCard = document.getElementById('pharmacyInvCard');
                const panel = document.getElementById('pyxisLocationsPanel');
                const expansion = document.getElementById('pyxisExpansion');
                const expansionHeader = document.getElementById('pyxisExpansionHeader');
                const breakdown = document.querySelector('.inventory-breakdown');
                if (!pyxisCard || !pharmacyCard || !panel || !expansion || !expansionHeader || !breakdown) return;

                function toggle(forceOpen) {
                    const isOpen = pyxisCard.classList.contains('is-expanded');
                    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
                    pyxisCard.setAttribute('aria-expanded', String(nextOpen));
                    pyxisCard.classList.toggle('is-expanded', nextOpen);
                    pharmacyCard.classList.toggle('is-collapsed', nextOpen);
                    breakdown.classList.toggle('is-expanded', nextOpen);
                    expansion.setAttribute('aria-hidden', String(!nextOpen));
                }

                pyxisCard.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!pyxisCard.classList.contains('is-expanded')) toggle(true);
                });

                pyxisCard.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!pyxisCard.classList.contains('is-expanded')) toggle(true);
                    }
                });

                expansionHeader.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggle(false);
                });
                expansionHeader.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(false);
                    }
                });

                wireInventoryBadgeActions(firstItem.itemCode);
            })();
            
            // Insert notes section - position depends on SBAR status
            if (hasSBAR) {
                // SBAR exists: Assessment first (already inserted), then notes after chart
                const chartContainer = document.querySelector('.chart-container');
                chartContainer.insertAdjacentHTML('afterend', notesHTML);
            } else {
                // No SBAR: Notes first (before assessment), assessment stays where it is
                const assessmentSection = document.getElementById('assessmentSection');
                assessmentSection.insertAdjacentHTML('beforebegin', notesHTML);
            }
            
            // Hide the original modal-section since we're using dynamic sections
            notesSection.style.display = 'none';


            const etaExpandBtn = document.getElementById('etaExpandBtn');
            if (etaExpandBtn) {
                etaExpandBtn.disabled = true;
                etaExpandBtn.setAttribute('aria-busy', 'true');
                etaExpandBtn.title = 'Loading latest status...';
            }

            refreshItemStatusOverlay(true)
                .then(() => {
                    if (!cachedMockData || !Array.isArray(cachedMockData.items) || !Array.isArray(currentModalItems)) return;
                    const latestByCode = {};
                    cachedMockData.items.forEach((item) => {
                        const code = String(item && item.itemCode || '').trim();
                        if (code) latestByCode[code] = item;
                    });
                    currentModalItems.forEach((item) => {
                        const code = String(item && item.itemCode || '').trim();
                        const latest = code ? latestByCode[code] : null;
                        if (!latest) return;
                        item.availability = String(latest.availability || '');
                        item.status = String(latest.status || '');
                        item.ETA = String(latest.ETA || '');
                        item.notes = String(latest.notes || '');
                        item.assessment = String(latest.assessment || '');
                        item.filePath = String(latest.filePath || '');
                        item.SBAR = !!latest.SBAR || !!String(latest.filePath || '').trim();
                    });
                    if (typeof selectModalItem === 'function') selectModalItem(currentSelectedIndex);
                })
                .catch((err) => {
                    console.warn('⚠️ Unable to refresh item status when opening details modal', err);
                })
                .finally(() => {
                    if (!etaExpandBtn) return;
                    etaExpandBtn.disabled = false;
                    etaExpandBtn.removeAttribute('aria-busy');
                    etaExpandBtn.title = 'Expand ETA details';
                });
            
            // Initialize carousel mode (shows both modals with animation)
            initializeCarousel();
            
            // Populate the companion modal with the same data (for demo/testing)
            // In production, you can populate with different related drug data
            populateCompanionModal(drugName, notes, filePath, items, hasSBAR, initialIndex);
            
            // Reset modal-body scroll to top immediately
            const modalBody = modal.querySelector('.modal-body');
            if (modalBody) {
                modalBody.scrollTop = 0;
                console.log('Modal body scrollTop reset to:', modalBody.scrollTop);
            }
            
            // Draw the chart after modal is visible
            setTimeout(() => {
                // Calculate what the chart will actually use
                const analysisForLog = Array.isArray(firstItemUsageRateOriginal) 
                    ? calculateTrueUsageRate(firstItemUsageRateOriginal, items[initialIndex].status)
                    : null;
                
                console.log('📊 Drawing chart with:');
                console.log('   Current Qty:', firstItemQty);
                console.log('   Usage Rate Array (original):', firstItemUsageRateOriginal);
                if (analysisForLog) {
                    console.log('   ✅ After filtering:');
                    console.log('      - Percentile cutoff:', localStorage.getItem('usagePercentileCutoff') || '25' + 'th');
                    console.log('      - Normal periods used:', analysisForLog.normalPeriods);
                    console.log('      - Filtered out:', analysisForLog.constrainedPeriods, 'values');
                    console.log('      - Weekly baseline:', analysisForLog.weeklyBaseline);
                    console.log('      - Daily baseline:', analysisForLog.dailyBaseline);
                }
                console.log('   ETA:', firstItemETA);
                console.log('   Days Until ETA:', daysUntilETA);
                drawInventoryProjectionChart(items, initialIndex);
                
                // Chart drawing complete
                setTimeout(() => {
                    // Chart rendered
                }, 200);
                setTimeout(() => {
                    // Chart fully displayed
                }, 500);
            }, 100);
        }

        function refreshOpenModalFromCache(preferredItemCode) {
            if (!cachedMockData || !Array.isArray(cachedMockData.items)) return;
            const modal = document.getElementById('detailsModal');
            if (!modal || !modal.classList.contains('show')) return;
            const drugName = String((document.getElementById('modalDrugName') && document.getElementById('modalDrugName').textContent) || '');
            if (!drugName) return;

            const refreshedItems = cachedMockData.items.filter((item) => String(item && item.drugName || '') === drugName);
            if (!refreshedItems.length) return;

            let preferredIndex = 0;
            const targetCode = String(preferredItemCode || (currentModalItems[currentSelectedIndex] && currentModalItems[currentSelectedIndex].itemCode) || '');
            if (targetCode) {
                const idx = refreshedItems.findIndex((item) => String(item && item.itemCode || '') === targetCode);
                if (idx >= 0) preferredIndex = idx;
            }
            const sbarItem = refreshedItems.find((item) => item && item.SBAR && item.filePath);
            openDetailsModal(
                drugName,
                (sbarItem && sbarItem.notes) || '',
                (sbarItem && sbarItem.filePath) || '',
                refreshedItems,
                !!sbarItem,
                preferredIndex
            );
        }

        // Function to handle item selection
        function selectModalItem(index) {
            if (index < 0 || index >= currentModalItems.length) return;
            
            currentSelectedIndex = index;
            const selectedItem = currentModalItems[index];
            
            // Update active state in item list
            document.querySelectorAll('.item-list-item').forEach((item, i) => {
                if (i === index) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
            
            // Calculate values for selected item
            const pyxis = selectedItem.pyxis || 0;
            const pyxisStandard = selectedItem.pyxisStandard || 0;
            const pharmacy = selectedItem.pharmacy || 0;
            
            // Use effective inventory for days remaining calculation
            const effectiveInv = getEffectiveInventory(selectedItem);
            const totalQty = effectiveInv.effectiveQuantity;
            
            const usageRateOriginal = selectedItem.usageRate || 0;
            const eta = selectedItem.ETA || 'TBD';
            
            // Normalize usageRate - handle both single value and array (weekly data)
            let usageRateCurrent = usageRateOriginal;
            let usageRateDisplay = '';
            
            if (Array.isArray(usageRateOriginal)) {
                // Use enhanced algorithm for better projections (weekly → daily)
                const analysis = calculateTrueUsageRate(usageRateOriginal, selectedItem.status);
                
                // Log the filtering details
                console.log('📊 Usage Rate Calculation for:', selectedItem.description);
                console.log('   Original array:', usageRateOriginal);
                console.log('   Percentile cutoff:', localStorage.getItem('usagePercentileCutoff') || '25' + 'th');
                console.log('   ✅ Filtered results:');
                console.log('      - Normal periods used:', analysis.normalPeriods, 'weeks');
                console.log('      - Filtered out:', analysis.constrainedPeriods, 'weeks');
                console.log('      - Weekly baseline:', analysis.weeklyBaseline, 'units/week');
                console.log('      - Daily baseline:', analysis.dailyBaseline, 'units/day');
                console.log('      - Confidence:', analysis.confidence + '%');
                
                if (analysis.constrainedPeriods > 0) {
                    // Show enhanced analysis with weekly context
                    usageRateCurrent = analysis.dailyBaseline;
                    usageRateDisplay = `${analysis.dailyBaseline.toFixed(2)} units/day (${analysis.weeklyBaseline.toFixed(1)} units/week)`;
                } else {
                    // No constraint detected - show moving average from analysis
                    usageRateCurrent = analysis.dailyBaseline;
                    usageRateDisplay = `${analysis.dailyBaseline.toFixed(2)} units/day (${analysis.weeklyBaseline.toFixed(1)} units/week)`;
                }
            } else {
                // Single value - assume it's already daily
                usageRateCurrent = usageRateOriginal;
                usageRateDisplay = `${usageRateCurrent.toFixed(2)} units/day`;
            }
            
            // Calculate days remaining
            const daysRemaining = usageRateCurrent > 0 ? (totalQty / usageRateCurrent).toFixed(1) : '∞';
            const daysUntilETA = eta !== 'TBD' ? 
                Math.ceil((new Date(eta) - new Date()) / (1000 * 60 * 60 * 24)) : 
                null;
            
            // Update display elements
            document.getElementById('displayETA').textContent = eta;
            if (typeof window.__shortageHydrateEtaDraft === 'function') {
                window.__shortageHydrateEtaDraft();
            }
            if (typeof window.__shortageUpdateSeveritySuggestion === 'function') {
                window.__shortageUpdateSeveritySuggestion();
            }

            const selectedInvEntry = (cachedMockData && cachedMockData.inventory && cachedMockData.inventory[selectedItem.itemCode])
                ? cachedMockData.inventory[selectedItem.itemCode]
                : null;
            let selectedSublocations = [];
            if (selectedInvEntry && Array.isArray(selectedInvEntry.sublocations)) {
                selectedSublocations = selectedInvEntry.sublocations;
            } else if (selectedInvEntry && typeof selectedInvEntry === 'object') {
                selectedSublocations = Object.keys(selectedInvEntry).map(code => {
                    const row = selectedInvEntry[code] || {};
                    return {
                        sublocation: code,
                        curQty: Number(row.qty ?? row.curQty ?? 0),
                        minQty: Number(row.min ?? row.minQty ?? 0),
                        maxQty: Number(row.max ?? row.maxQty ?? 0),
                        standard: !!row.standard,
                        standardQty: Number(row.standardQty ?? 0),
                        pocket: row.pocket,
                        expires: row.expires || row.expiry || ''
                    };
                });
            }
            const selectedGroups = buildDeptBreakdown(selectedSublocations);
            const selectedPyx = selectedGroups.depts.Pyxis;
            const selectedPhx = selectedGroups.depts.Pharmacy;
            const selectedPyxQty = Number(selectedPyx.qty) || 0;
            const selectedPhxQty = Number(selectedPhx.qty) || 0;
            const selectedStdQty = Number(selectedPyx.standardQty) || pyxisStandard;

            document.getElementById('displayPyxis').innerHTML = selectedPyxQty + (selectedStdQty > 0 ? ` <span style="color: var(--text-secondary); font-size: 0.9em;">(${selectedStdQty} Standard)</span>` : '');
            document.getElementById('displayPharmacy').textContent = String(selectedPhxQty);

            updateCompactInventoryHeader(selectedPyxQty, selectedStdQty, selectedPhxQty, captionForDept(selectedPyx), captionForDept(selectedPhx));

            const pyxisPanel = document.getElementById('pyxisLocationsPanel');
            if (pyxisPanel) {
                pyxisPanel.innerHTML = buildPyxisLocationsBadges(selectedPyx, selectedItem.itemCode);
                wireInventoryBadgeActions(selectedItem.itemCode);
            }

            document.getElementById('displayUsageRate').textContent = usageRateDisplay;
            
            const daysRemainingHTML = daysRemaining !== '∞' ? 
                `<strong>Days Remaining:</strong> ${daysRemaining} days ${daysUntilETA !== null && parseFloat(daysRemaining) < daysUntilETA ? '⚠️ <strong style="color: #d32f2f;">Stock will run out before ETA</strong>' : ''}` : 
                '<strong>Days Remaining:</strong> No current usage';
            document.getElementById('displayDaysRemaining').innerHTML = daysRemainingHTML;
            
            // Update notes for selected item
            const notesContent = document.getElementById('notesContent');
            const notesSection = document.getElementById('notesSection');
            if (notesContent && notesSection) {
                const itemNotes = normalizeModalNotesText(selectedItem.notes || '');
                if (itemNotes) {
                    notesContent.textContent = itemNotes;
                    notesContent.classList.remove('empty');
                    notesSection.style.display = '';
                } else {
                    notesContent.textContent = 'No notes available for this item';
                    notesContent.classList.add('empty');
                    notesSection.style.display = 'none';
                }
            }
            
            // Update SBAR button state and assessment styling based on selected item
            const sbarBtn = document.getElementById('goToSbarBtnInline');
            const assessmentSection = document.getElementById('assessmentSection');
            const assessmentContent = document.getElementById('assessmentContent');
            if (sbarBtn && assessmentSection) {
                const hasAssessment = selectedItem.assessment && selectedItem.assessment.trim().length > 0;
                
                // Update assessment content text
                if (assessmentContent) {
                    assessmentContent.textContent = hasAssessment ? selectedItem.assessment : 'No mitigation strategies documented.';
                }
                
                if (selectedItem.SBAR && selectedItem.filePath) {
                    sbarBtn.disabled = false;
                    sbarBtn.style.opacity = '1';
                    sbarBtn.style.cursor = 'pointer';
                    sbarBtn.style.background = 'transparent';
                    currentFilePath = selectedItem.filePath;
                    currentHasSBAR = true;
                    
                    // Remove grayed-out styling and show section
                    assessmentSection.classList.remove('grayed-out');
                    assessmentSection.style.display = '';
                } else {
                    sbarBtn.disabled = true;
                    sbarBtn.style.opacity = '0.5';
                    sbarBtn.style.cursor = 'not-allowed';
                    sbarBtn.style.background = '#999';
                    currentHasSBAR = false;
                    
                    // If no assessment content, hide completely; otherwise just gray out
                    if (!hasAssessment) {
                        assessmentSection.style.display = 'none';
                        assessmentSection.classList.add('grayed-out');
                    } else {
                        assessmentSection.style.display = '';
                        assessmentSection.classList.add('grayed-out');
                    }
                }
            }
            
            // Redraw chart with original usageRate (array or single value)
            drawInventoryProjectionChart(currentModalItems, index);
        }

        function openAnalytics() {
            console.log('🔍 Analytics button clicked!');
            
            // Get the currently selected item from the modal
            if (!currentModalItems || currentSelectedIndex < 0) {
                console.error('❌ No item selected in modal');
                console.log('currentModalItems:', currentModalItems);
                console.log('currentSelectedIndex:', currentSelectedIndex);
                return;
            }
            
            const selectedItem = currentModalItems[currentSelectedIndex];
            console.log('✓ Selected item:', selectedItem);
            
            // Extract filter parameters
            const filterData = {
                itemClass: selectedItem.itemClass || '',
                drugName: selectedItem.drugName || '',
                description: selectedItem.description || '',
                viewMode: 'usage' // Navigate to usage chart view
            };
            
            console.log('📊 Sending analytics filter:', filterData);
            console.log('📤 Sending to window.parent:', window.parent);
            console.log('🪟 Current window:', window);
            console.log('🎯 Is in iframe?', window !== window.parent);
            
            // Send message to parent (Dashboard) to switch to Analytics tab and apply filter
            try {
                window.parent.postMessage({
                    type: 'OPEN_ANALYTICS',
                    data: filterData
                }, '*');
                console.log('✓ Message sent successfully!');
            } catch (error) {
                console.error('❌ Error sending message:', error);
            }
            
            // Close the modal
            console.log('🚪 Closing modal...');
            closeDetailsModal();
            console.log('✓ Modal closed');
        }
        
        function closeDetailsModal() {
            // Remove dynamically added sections
            const itemList = document.querySelector('.item-list-container');
            const inventoryBreakdown = document.querySelector('.inventory-breakdown');
            const usageRate = document.querySelector('.usage-rate-container');
            const chartContainer = document.querySelector('.chart-container');
            const assessment = document.querySelector('.assessment-section');
            const notesSection = document.querySelector('.notes-section');
            
            if (itemList) itemList.remove();
            if (inventoryBreakdown) inventoryBreakdown.remove();
            if (usageRate) usageRate.remove();
            if (chartContainer) chartContainer.remove();
            if (assessment) assessment.remove();
            if (notesSection) notesSection.remove();
            
            // Restore original modal-section display
            const originalModalSection = document.querySelector('.modal-section');
            if (originalModalSection) {
                originalModalSection.style.display = '';
            }
            
            // Reset header color
            const modalHeader = document.querySelector('.modal-header');
            if (modalHeader) {
                modalHeader.className = 'modal-header';
            }
            
            
            // Reset hover state
            chartHoveredItemIndex = null;
            document.getElementById('detailsModal').classList.remove('active');
            document.getElementById('companionModal').classList.remove('active');
            
            // Hide background layer
            const carouselBackground = document.getElementById('carouselBackground');
            if (carouselBackground) {
                carouselBackground.classList.remove('active');
            }
            
            // Reset carousel states
            document.getElementById('detailsModal').classList.remove('carousel-front', 'carousel-back');
            document.getElementById('companionModal').classList.remove('carousel-front', 'carousel-back');
        }

        // ==================================================================================
        // MODAL CAROUSEL SYSTEM
        // Switch between detailsModal and companionModal with smooth animations
        // ==================================================================================
        
        // Track which modal is currently in front
        let frontModal = 'detailsModal';
        
        /**
         * Switch focus between modals (they don't change positions)
         * Details modal stays centered, companion stays on right
         * Only the focus/blur effect changes
         */
        function switchCarouselModal() {
            const detailsModal = document.getElementById('detailsModal');
            const companionModal = document.getElementById('companionModal');
            
            // Add switching class for animation
            detailsModal.classList.add('carousel-switching');
            companionModal.classList.add('carousel-switching');
            
            // 3-PHASE ANIMATION - prevents "going through" effect:
            // Phase 1 (0-400ms): Exiting modal moves to side (stays full scale, focused)
            // Phase 2 (400-800ms): SIMULTANEOUSLY - Entering scales up + gets focus, Exiting scales down + loses focus (both stay at sides)
            // Phase 3 (800-1200ms): Entering modal moves to center
            
            if (frontModal === 'detailsModal') {
                // Details is exiting (center -> left), Companion is entering (right -> center)
                
                // PHASE 1: Move exiting modal to side (keep it full scale and focused)
                detailsModal.classList.remove('carousel-front');
                detailsModal.classList.add('carousel-exiting-moved');
                
                // PHASE 2 (at 400ms): Scale + focus changes happen together (both at sides)
                setTimeout(() => {
                    // Entering modal: Scale up + gain focus (stays at right side)
                    companionModal.classList.remove('carousel-back');
                    companionModal.classList.add('carousel-entering-scaling');
                    
                    // Exiting modal: Scale down + lose focus (stays at left side)
                    detailsModal.classList.remove('carousel-exiting-moved');
                    detailsModal.classList.add('carousel-exiting-scaling');
                    
                    console.log('🔄 Phase 2: Scaling and focus switch (both at sides)');
                }, 400);
                
                // PHASE 3 (at 800ms): Move entering modal to center
                setTimeout(() => {
                    companionModal.classList.remove('carousel-entering-scaling');
                    companionModal.classList.add('carousel-front');
                    
                    detailsModal.classList.remove('carousel-exiting-scaling');
                    detailsModal.classList.add('carousel-back');
                    
                    frontModal = 'companionModal';
                    console.log('✅ Phase 3: Companion moved to center');
                }, 800);
                
            } else {
                // Companion is exiting (center -> right), Details is entering (left -> center)
                
                // PHASE 1: Move exiting modal to side (keep it full scale and focused)
                companionModal.classList.remove('carousel-front');
                companionModal.classList.add('carousel-exiting-moved');
                
                // PHASE 2 (at 400ms): Scale + focus changes happen together (both at sides)
                setTimeout(() => {
                    // Entering modal: Scale up + gain focus (stays at left side)
                    detailsModal.classList.remove('carousel-back');
                    detailsModal.classList.add('carousel-entering-scaling');
                    
                    // Exiting modal: Scale down + lose focus (stays at right side)
                    companionModal.classList.remove('carousel-exiting-moved');
                    companionModal.classList.add('carousel-exiting-scaling');
                    
                    console.log('🔄 Phase 2: Scaling and focus switch (both at sides)');
                }, 400);
                
                // PHASE 3 (at 800ms): Move entering modal to center
                setTimeout(() => {
                    detailsModal.classList.remove('carousel-entering-scaling');
                    detailsModal.classList.add('carousel-front');
                    
                    companionModal.classList.remove('carousel-exiting-scaling');
                    companionModal.classList.add('carousel-back');
                    
                    frontModal = 'detailsModal';
                    console.log('✅ Phase 3: Details moved to center');
                }, 800);
            }
            
            // Cleanup after all animations complete (1200ms total)
            setTimeout(() => {
                detailsModal.classList.remove('carousel-switching');
                companionModal.classList.remove('carousel-switching');
            }, 1200);
        }
        
        /**
         * Initialize carousel mode when opening details modal
         * Shows both modals with one in front and one in back
         */
        function initializeCarousel() {
            const detailsModal = document.getElementById('detailsModal');
            const companionModal = document.getElementById('companionModal');
            const carouselBackground = document.getElementById('carouselBackground');
            
            // DEBUG: Check if elements exist
            console.log('🔍 DEBUG - detailsModal exists:', !!detailsModal);
            console.log('🔍 DEBUG - companionModal exists:', !!companionModal);
            console.log('🔍 DEBUG - carouselBackground exists:', !!carouselBackground);
            
            if (!companionModal || !detailsModal || !carouselBackground) {
                console.error('❌ ERROR: Modal elements not found!');
                return;
            }
            
            // Show background layer
            carouselBackground.classList.add('active');
            
            // Show both modals
            detailsModal.classList.add('active', 'carousel-front');
            companionModal.classList.add('active', 'carousel-back');
            
            frontModal = 'detailsModal';
            
            // DEBUG: Log the applied classes
            console.log('🔍 DEBUG - detailsModal classes:', detailsModal.className);
            console.log('🔍 DEBUG - companionModal classes:', companionModal.className);
            
            // DEBUG: Check computed styles
            setTimeout(() => {
                const companionStyles = window.getComputedStyle(companionModal);
                const companionContainer = companionModal.querySelector('.modal-container');
                const containerStyles = companionContainer ? window.getComputedStyle(companionContainer) : null;
                
                console.log('🔍 DEBUG - companionModal computed display:', companionStyles.display);
                console.log('🔍 DEBUG - companionModal computed justifyContent:', companionStyles.justifyContent);
                console.log('🔍 DEBUG - companionModal computed zIndex:', companionStyles.zIndex);
                
                if (containerStyles) {
                    const rect = companionContainer.getBoundingClientRect();
                    console.log('🔍 DEBUG - companionModal container border:', containerStyles.border);
                    console.log('🔍 DEBUG - companionModal position:', {
                        top: rect.top,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        isVisible: rect.right > 0 && rect.left < window.innerWidth && rect.width > 0
                    });
                }
            }, 100);
            
            console.log('🎠 Carousel initialized: detailsModal focused (center), companionModal unfocused (right), background layer active');
        }
        
        /**
         * Populate the companion modal with content
         * This can be called to load different data into the back modal
         */
        function populateCompanionModal(drugName, notes, filePath, items, hasSBAR, initialIndex = 0) {
            const companionModal = document.getElementById('companionModal');
            const companionModalHeader = companionModal.querySelector('.modal-header');
            const companionModalDrugName = document.getElementById('companionModalDrugName');
            const companionModalDrugInfo = document.getElementById('companionModalDrugInfo');
            const companionModalnotes = document.getElementById('companionModalnotes');
            
            // Set drug name
            if (companionModalDrugName) {
                companionModalDrugName.textContent = drugName;
            }
            
            // Get highest priority status for header color
            const statusPriority = { 'non-formulary': 5, critical: 4, severe: 3, moderate: 2, resolved: 1 };
            const highestPriority = items.reduce((highest, item) => {
                return statusPriority[item.status] > statusPriority[highest] ? item.status : highest;
            }, 'resolved');
            
            // Set header color based on status
            if (companionModalHeader) {
                companionModalHeader.className = `modal-header status-${highestPriority}`;
            }
            
            // Get first item data
            const firstItem = items[initialIndex];
            const firstItemPyxis = firstItem.pyxis || 0;
            const firstItemPharmacy = firstItem.pharmacy || 0;
            
            // Build basic info display
            if (companionModalDrugInfo) {
                companionModalDrugInfo.innerHTML = `
                    <div class="modal-info-item">
                        <div class="modal-info-label">Total Inventory</div>
                        <div class="modal-info-value">${firstItemPyxis + firstItemPharmacy} units</div>
                    </div>
                    <div class="modal-info-item">
                        <div class="modal-info-label">Status</div>
                        <div class="modal-info-value" style="color: ${getStatusColor(getDisplayStatus(firstItem))}; font-weight: 600;">
                            ${getDisplayStatus(firstItem).toUpperCase()}
                        </div>
                    </div>
                    <div class="modal-info-item">
                        <div class="modal-info-label">Items Count</div>
                        <div class="modal-info-value">${items.length} item${items.length !== 1 ? 's' : ''}</div>
                    </div>
                `;
            }
            
            // Set notes
            if (companionModalnotes) {
                companionModalnotes.textContent = notes || 'No notes available';
            }
            
            console.log(`📝 Companion modal populated with: ${drugName} (${items.length} items, status: ${highestPriority})`);
        }
        
        // Helper function to get status color
        function getStatusColor(status) {
            const colors = {
                'critical': '#ff5454',
                'severe': '#ff8400',
                'moderate': '#ecdd16',
                'resolved': '#5cb85c',
                'non-formulary': '#9ca3af'
            };
            return colors[status] || '#666';
        }
        
        // Add click handler to back modal to trigger switch
        document.addEventListener('DOMContentLoaded', () => {
            const detailsModal = document.getElementById('detailsModal');
            const companionModal = document.getElementById('companionModal');
            const carouselBackground = document.getElementById('carouselBackground');
            
            console.log('🎯 Carousel click handlers initialized');
            
            // Click on background to close modals
            if (carouselBackground) {
                carouselBackground.addEventListener('click', (e) => {
                    console.log('🖱️ Background clicked - closing modals');
                    closeDetailsModal();
                });
            }
            
            // Click on unfocused modal container to switch focus
            // Only the container receives clicks, not the overlay
            detailsModal.addEventListener('click', (e) => {
                if (detailsModal.classList.contains('carousel-back')) {
                    // Only switch if clicking on the modal container (not overlay)
                    if (e.target.closest('.modal-container') && !e.target.closest('.modal-close-btn')) {
                        console.log('✅ Switching from detailsModal click');
                        switchCarouselModal();
                    }
                }
            });
            
            companionModal.addEventListener('click', (e) => {
                if (companionModal.classList.contains('carousel-back')) {
                    // Only switch if clicking on the modal container (not overlay)
                    if (e.target.closest('.modal-container') && !e.target.closest('.modal-close-btn')) {
                        console.log('✅ Switching from companionModal click');
                        switchCarouselModal();
                    }
                }
            });
        });
        
        // Draw inventory projection chart
        function drawInventoryProjectionChart(items, targetIndex) {
            const canvas = document.getElementById('inventoryChart');
            if (!canvas) return;
            
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            
            // Set canvas size with device pixel ratio for crisp rendering
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);
            
            const width = rect.width;
            const height = rect.height;
            const padding = 50;
            const chartWidth = width - padding * 2;
            const chartHeight = height - padding * 2;
            
            // Calculate earliest ETA across all items to use as max range
            const earliestDaysUntilETA = Math.min(...items.map(item => {
                const eta = item.ETA || '';
                if (!eta) return Infinity;
                return Math.ceil((new Date(eta) - new Date()) / (1000 * 60 * 60 * 24));
            }).filter(days => days > 0));
            
            // Use earliest ETA as max range, or 30 days if no valid ETAs
            const maxRangeDays = earliestDaysUntilETA !== Infinity ? earliestDaysUntilETA : 30;
            
            // Process all items and calculate their projections
            const itemProjections = items.map((item, itemIndex) => {
                const qty = (item.pyxis || 0) + (item.pharmacy || 0);
                const usageRateOriginal = item.usageRate || 0;
                const eta = item.ETA || '';
                const daysUntilETA = eta ? 
                    Math.ceil((new Date(eta) - new Date()) / (1000 * 60 * 60 * 24)) : 
                    null;
                
                // Process usage rate with enhanced algorithm
                let effectiveUsageRate, usageRateSlope = 0;
                let baselineWeeklyUsage = 0;
                
                if (Array.isArray(usageRateOriginal) && usageRateOriginal.length > 0) {
                    const analysis = calculateTrueUsageRate(usageRateOriginal, item.status);
                    
                    if (analysis.useOriginalData) {
                        // Use the calculated baseline (moving average) from analysis
                        effectiveUsageRate = analysis.dailyBaseline;
                        usageRateSlope = 0; // No slope when using moving average
                    } else {
                        effectiveUsageRate = analysis.dailyBaseline;
                        usageRateSlope = analysis.dailySlope;
                    }
                    baselineWeeklyUsage = (Number(analysis.weeklyBaseline) || (Number(effectiveUsageRate) || 0) * 7);
                } else if (Array.isArray(usageRateOriginal) && usageRateOriginal.length === 1) {
                    effectiveUsageRate = usageRateOriginal[0];
                    baselineWeeklyUsage = (Number(effectiveUsageRate) || 0) * 7;
                } else {
                    effectiveUsageRate = usageRateOriginal;
                    baselineWeeklyUsage = (Number(effectiveUsageRate) || 0) * 7;
                }

                const weightedUsage = getWeightedWeeklyUsage(item.itemCode, baselineWeeklyUsage, {
                    getTrendFactForItem,
                    getSpikeFactorForItem
                });
                const weightedDailyUsage = Math.max(0, (Number(weightedUsage.weightedWeeklyUsage) || 0) / 7);
                const slopeScale = (effectiveUsageRate > 0) ? (weightedDailyUsage / effectiveUsageRate) : 1;
                const adjustedUsageRateSlope = usageRateSlope * (Number.isFinite(slopeScale) ? slopeScale : 1);
                
                // Use the global max range (earliest ETA) for all projections
                const dataPoints = [];
                let cumulativeQty = qty;
                
                for (let day = 0; day <= maxRangeDays; day++) {
                    const dayUsageRate = weightedDailyUsage + (adjustedUsageRateSlope * day);
                    const actualUsageRate = Math.max(0, dayUsageRate);
                    dataPoints.push({ day, qty: cumulativeQty, usageRate: actualUsageRate });
                    cumulativeQty -= actualUsageRate;
                    cumulativeQty = Math.max(0, cumulativeQty);
                }
                
                // Assign colors: target is teal, others are grays with different shades
                const isTarget = itemIndex === targetIndex;
                const grayShade = 0.3 + (itemIndex * 0.15);
                
                return {
                    description: item.description,
                    dataPoints,
                    daysUntilETA,
                    color: isTarget ? '#11998e' : `rgba(100, 100, 100, ${grayShade})`,
                    lineWidth: isTarget ? 2.5 : 1.5,
                    isTarget,
                    itemIndex,
                    itemCode: item.itemCode,
                    usageDetails: {
                        baselineWeeklyUsage: weightedUsage.baselineWeeklyUsage,
                        weightedWeeklyUsage: weightedUsage.weightedWeeklyUsage,
                        trendMult: weightedUsage.trendMult,
                        spikeMult: weightedUsage.spikeMult
                    }
                };
            });
            
            // Find global max values for scaling
            const maxDay = Math.max(...itemProjections.map(p => p.dataPoints[p.dataPoints.length - 1].day));
            const maxQty = Math.max(...itemProjections.flatMap(p => p.dataPoints.map(d => d.qty)));
            
            // Clear canvas
            ctx.clearRect(0, 0, width, height);
            
            // Draw grid lines
            const hoverStroke = getComputedStyle(document.body)
                .getPropertyValue('--hover-stroke')
                .trim();
            const lineFill = getComputedStyle(document.body)
                .getPropertyValue('--line-fill')
                .trim();
            const gridLine = getComputedStyle(document.body)
                .getPropertyValue('--grid-line')
                .trim();
            const etaLine = getComputedStyle(document.body)
                .getPropertyValue('--eta-line')
                .trim();
            const axisLine = getComputedStyle(document.body)
                .getPropertyValue('--axis-line')
                .trim();

            ctx.strokeStyle = gridLine;
            ctx.lineWidth = 1;
            for (let i = 0; i <= 5; i++) {
                const y = padding + (chartHeight / 5) * i;
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(width - padding, y);
                ctx.stroke();
            }
            
            // Draw axes
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(padding, padding);
            ctx.lineTo(padding, height - padding);
            ctx.lineTo(width - padding, height - padding);
            ctx.stroke();
            
            // Sort projections so target is drawn last (on top)
            const sortedProjections = [...itemProjections].sort((a, b) => a.isTarget ? 1 : -1);
            
            // Draw all projections
            sortedProjections.forEach((projection) => {
                const isHovered = chartHoveredItemIndex === projection.itemIndex;
                
                // Fill area under target item's curve
                if (projection.isTarget) {
                    ctx.fillStyle = lineFill;
                    ctx.beginPath();
                    ctx.moveTo(padding, height - padding);
                    projection.dataPoints.forEach((point) => {
                        const x = padding + (point.day / maxDay) * chartWidth;
                        const y = height - padding - (point.qty / maxQty) * chartHeight;
                        ctx.lineTo(x, y);
                    });
                    ctx.lineTo(width - padding, height - padding);
                    ctx.closePath();
                    ctx.fill();
                }
                
                // Draw line (highlight if hovered)
                ctx.strokeStyle = isHovered ? hoverStroke : projection.color;
                ctx.lineWidth = isHovered ? 4 : projection.lineWidth;
                ctx.beginPath();
                
                projection.dataPoints.forEach((point, index) => {
                    const x = padding + (point.day / maxDay) * chartWidth;
                    const y = height - padding - (point.qty / maxQty) * chartHeight;
                    
                    if (index === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                ctx.stroke();
                
                // Mark earliest ETA across all items (always visible)
                // Find the projection with the earliest ETA
                const projectionsWithETA = itemProjections.filter(p => p.daysUntilETA !== null && p.daysUntilETA > 0);
                
                if (projectionsWithETA.length > 0) {
                    const earliestProjection = projectionsWithETA.reduce((min, current) => 
                        current.daysUntilETA < min.daysUntilETA ? current : min
                    );
                    
                    if (earliestProjection.daysUntilETA <= maxDay) {
                        const etaX = padding + (earliestProjection.daysUntilETA / maxDay) * chartWidth;
                        
                        // Find the quantity on the line that has the earliest ETA
                        const etaDataPoint = earliestProjection.dataPoints.find(p => Math.abs(p.day - earliestProjection.daysUntilETA) < 0.5) || 
                                            earliestProjection.dataPoints[Math.round(earliestProjection.daysUntilETA)];
                        const etaQty = etaDataPoint ? etaDataPoint.qty : 0;
                        const etaY = height - padding - (etaQty / maxQty) * chartHeight;
                        
                        // Vertical dashed line at ETA
                        ctx.strokeStyle = etaLine;
                        ctx.lineWidth = 2;
                        ctx.setLineDash([5, 5]);
                        ctx.beginPath();
                        ctx.moveTo(etaX, padding);
                        ctx.lineTo(etaX, height - padding);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        
                        // ETA marker dot
                        ctx.fillStyle = etaLine;
                        ctx.beginPath();
                        ctx.arc(etaX, etaY, 6, 0, Math.PI * 2);
                        ctx.fill();
                        
                        // ETA label
                        ctx.fillStyle = etaLine;
                        ctx.font = 'bold 12px Segoe UI';
                        ctx.textAlign = 'center';
                        ctx.fillText('ETA', etaX, etaY - 15);
                    }
                }
            });
            
            // Y-axis labels
            ctx.fillStyle = axisLine;
            ctx.font = '11px Segoe UI';
            ctx.textAlign = 'right';
            for (let i = 0; i <= 5; i++) {
                const qty = (maxQty / 5) * (5 - i);
                const y = padding + (chartHeight / 5) * i;
                ctx.fillText(Math.round(qty), padding - 10, y + 4);
            }
            
            // X-axis labels
            ctx.textAlign = 'center';
            const xLabelCount = 5;
            for (let i = 0; i <= xLabelCount; i++) {
                const day = (maxDay / xLabelCount) * i;
                const x = padding + (chartWidth / xLabelCount) * i;
                ctx.fillText(Math.round(day), x, height - padding + 20);
            }
            
            // Axis titles
            ctx.fillStyle = axisLine;
            ctx.font = 'bold 12px Segoe UI';
            ctx.textAlign = 'center';
            ctx.fillText('Days from Today', width / 2, height - 10);
            
            ctx.save();
            ctx.translate(15, height / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Quantity (units)', 0, 0);
            ctx.restore();
            
            // Set up hover interaction
            canvas.onmousemove = function(e) {
                const mouseRect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - mouseRect.left;
                const mouseY = e.clientY - mouseRect.top;
                
                let nearestItem = null;
                let minDistance = 15; // px threshold
                
                itemProjections.forEach((projection) => {
                    projection.dataPoints.forEach((point) => {
                        const x = padding + (point.day / maxDay) * chartWidth;
                        const y = height - padding - (point.qty / maxQty) * chartHeight;
                        const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));
                        
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestItem = projection;
                        }
                    });
                });
                
                if (nearestItem && chartHoveredItemIndex !== nearestItem.itemIndex) {
                    chartHoveredItemIndex = nearestItem.itemIndex;
                    const chartTitle = document.querySelector('.chart-header');
                    if (chartTitle) {
                        const leftContent = chartTitle.querySelector('div:first-child');
                        if (leftContent) {
                            leftContent.innerHTML = `
                                <svg class="chart-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                    <path d="M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z"/>
                                </svg>
                                ${nearestItem.description} · ${(Number((nearestItem.usageDetails || {}).baselineWeeklyUsage) || 0).toFixed(1)}/wk → ${(Number((nearestItem.usageDetails || {}).weightedWeeklyUsage) || 0).toFixed(1)}/wk (t×${(Number((nearestItem.usageDetails || {}).trendMult) || 1).toFixed(2)}, s×${(Number((nearestItem.usageDetails || {}).spikeMult) || 1).toFixed(2)})
                            `;
                        }
                    }
                    drawInventoryProjectionChart(items, targetIndex);
                } else if (!nearestItem && chartHoveredItemIndex !== null) {
                    chartHoveredItemIndex = null;
                    const chartTitle = document.querySelector('.chart-header');
                    if (chartTitle) {
                        const leftContent = chartTitle.querySelector('div:first-child');
                        if (leftContent) {
                            leftContent.innerHTML = `
                                <svg class="chart-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                    <path d="M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z"/>
                                </svg>
                                Inventory Projection
                            `;
                        }
                    }
                    drawInventoryProjectionChart(items, targetIndex);
                }
            };
            
            canvas.onmouseleave = function() {
                if (chartHoveredItemIndex !== null) {
                    chartHoveredItemIndex = null;
                    const chartTitle = document.querySelector('.chart-header');
                    if (chartTitle) {
                        const leftContent = chartTitle.querySelector('div:first-child');
                        if (leftContent) {
                            leftContent.innerHTML = `
                                <svg class="chart-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                    <path d="M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z"/>
                                </svg>
                                Inventory Projection
                            `;
                        }
                    }
                    drawInventoryProjectionChart(items, targetIndex);
                }
            };

            window.debugProjection = function(itemCode) {
                const code = String(itemCode || '').trim();
                const found = itemProjections.find((p) => String(p.itemCode || '').trim() === code) || itemProjections[targetIndex] || itemProjections[0];
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

            if (window[PROJECTION_DEBUG_FLAG] && itemProjections[targetIndex]) {
                const p = itemProjections[targetIndex];
                const d = p.usageDetails || {};
                console.log('🧪 Projection diagnostics (shortage)', {
                    itemCode: p.itemCode,
                    baselineWeeklyUsage: d.baselineWeeklyUsage,
                    trendMult: d.trendMult,
                    spikeMult: d.spikeMult,
                    weightedWeeklyUsage: d.weightedWeeklyUsage,
                    first3ProjectedPoints: (p.dataPoints || []).slice(0, 3)
                });
            }
        }

        function openSbarFile() {
            if (currentFilePath && currentHasSBAR) {
                openFile(currentFilePath);
            }
        }

        // Close modal when clicking outside
        document.getElementById('detailsModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeDetailsModal();
            }
        });

        document.getElementById('settingsModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeSettings();
            }
        });

        // Toggle functions
        function toggleItemCodes() {
            const isChecked = document.getElementById('showItemCodes').checked;
            setCookie('showItemCodes', isChecked, 365);
            // Column visibility is now handled automatically on expand
            // applyColumnVisibility();
        }

        function toggleQuantities() {
            const isChecked = document.getElementById('showQuantities').checked;
            setCookie('showQuantities', isChecked, 365);
            // Column visibility is now handled automatically on expand
            // applyColumnVisibility();
        }

        // Dark mode toggle - DISABLED (controlled by Dashboard)
        function toggleDarkMode() {
            // Dark mode is now controlled by the Dashboard container
            // This function is disabled to prevent conflicts
            console.log('Dark mode is controlled by Dashboard');
        }

        // Sorting functionality
        let currentSort = {
            column: 'drugName',
            direction: 'asc'
        };
        
        currentFilter = {
            type: null,  // 'critical', 'resolved', 'lowSupply', 'fdaShortages', 'search', null
            value: null,  // filter value (e.g., search term)
            itemCodes: null  // array of itemCodes for FDA shortages filter
        };

        function sortTable(column) {
            const tableBody = document.getElementById('tableBody');
            if (!tableBody || tableBody.children.length === 0) return;

            // Toggle direction if clicking the same column
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            // Get all group headers
            const groupHeaders = Array.from(tableBody.querySelectorAll('.group-header'));
            
            // Sort group headers
            groupHeaders.sort((a, b) => {
                let aVal, bVal;
                let isSecondarySortNeeded = false;
                
                if (column === 'drugName') {
                    aVal = (a.dataset.drugname || '').toLowerCase();
                    bVal = (b.dataset.drugname || '').toLowerCase();
                } else if (column === 'status') {
                    aVal = a.dataset.status || '';
                    bVal = b.dataset.status || '';
                    // Convert status to numeric for proper sorting
                    const statusOrder = { 'critical': 5, 'severe': 4, 'moderate': 3, 'resolved': 2, '': 1 };
                    const aStatus = statusOrder[aVal] || 1;
                    const bStatus = statusOrder[bVal] || 1;
                    
                    // If statuses are different, sort by status
                    if (aStatus !== bStatus) {
                        aVal = aStatus;
                        bVal = bStatus;
                    } else {
                        // If statuses are the same, sort alphabetically by drug name (always ascending)
                        isSecondarySortNeeded = true;
                        aVal = (a.dataset.drugname || '').toLowerCase();
                        bVal = (b.dataset.drugname || '').toLowerCase();
                    }
                }
                
                // For secondary sort, always use ascending order
                if (isSecondarySortNeeded) {
                    if (aVal < bVal) return -1;
                    if (aVal > bVal) return 1;
                    return 0;
                }
                
                // Apply sort direction
                // desc: higher values first (5, 4, 3, 2, 1)
                // asc: lower values first (1, 2, 3, 4, 5)
                if (aVal < bVal) return currentSort.direction === 'desc' ? 1 : -1;
                if (aVal > bVal) return currentSort.direction === 'desc' ? -1 : 1;
                return 0;
            });

            // Reorder the table
            groupHeaders.forEach(header => {
                const groupId = header.dataset.group;
                const childRows = Array.from(tableBody.querySelectorAll(`.group-${groupId}`));
                
                // Append header
                tableBody.appendChild(header);
                
                // Append child rows
                childRows.forEach(child => {
                    tableBody.appendChild(child);
                });
            });

            // Update sort indicators
            document.querySelectorAll('.header-col').forEach(col => {
                col.classList.remove('sorted');
                const indicator = col.querySelector('.sort-indicator');
                if (indicator) {
                    indicator.textContent = '▼';
                }
            });

            const sortedCol = document.querySelector(`.header-col.sortable[onclick*="${column}"]`);
            if (sortedCol) {
                sortedCol.classList.add('sorted');
                const indicator = sortedCol.querySelector('.sort-indicator');
                if (indicator) {
                    indicator.textContent = currentSort.direction === 'asc' ? '▼' : '▲';
                }
            }
            
            // Scroll to top of table container
            const tableContainer = document.querySelector('.table-container');
            if (tableContainer) {
                tableContainer.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        function applyColumnVisibility() {
            const headerColumns = document.querySelector('.header-columns');
            const allRows = document.querySelectorAll('tr');
            
            // Check if any group is expanded
            const hasExpanded = document.querySelector('.child-row.visible') !== null;
            
            console.log('applyColumnVisibility called. hasExpanded:', hasExpanded);
            console.log('Number of rows found:', allRows.length);
            
            if (hasExpanded) {
                console.log('Adding has-expanded class');
                headerColumns.classList.add('has-expanded');
                allRows.forEach(row => row.classList.add('has-expanded'));
            } else {
                console.log('Removing has-expanded class');
                headerColumns.classList.remove('has-expanded');
                allRows.forEach(row => row.classList.remove('has-expanded'));
            }
        }

        function updateHeaderColumnsState() {
            applyColumnVisibility();
        }

        // Save settings
        function saveJsonFilePath() {
            const path = document.getElementById('jsonFilePath').value;
            setCookie('jsonFilePath', path, 365);
        }

        function saveUserName() {
            const name = document.getElementById('userName').value;
            setCookie('userName', name, 365);
            updateHeaderUserName();
        }

        // Avatar is fixed SRMC logo - no selection needed

        

        

        function updateHeaderUserName() {
            // Username is fixed as SRMC - no update needed
        }

        function updateHeaderAvatar() {
            // Avatar is fixed SRMC logo - no update needed
        }

        // File handling
        function handleFileUpload(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        const data = JSON.parse(e.target.result);
                        displayData(data);
                    } catch (error) {
                        alert('Error parsing JSON file: ' + error.message);
                    }
                };
                reader.readAsText(file);
            }
        }

        // Auto-load from file path
        function autoLoadJSON() {
            console.log('autoLoadJSON called');
            
            // Check if there's a filter from navigation
            if (currentFilter.type) {
                console.log('Filter active, applying filter:', currentFilter.type);
                applyCurrentFilter();
                return;
            }
            
            // No filter - show empty state (wait for search)
            console.log('No filter active - showing empty state');
            showEmptyState('search');
        }

        function loadFromPath() {
            const filePathInput = document.getElementById('jsonFilePath');
            const filePath = filePathInput.value.trim();
            
            if (filePath) {
                // Determine if it's a server address or file path
                let fetchPath;
                if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
                    // Already a server address
                    fetchPath = filePath;
                } else if (filePath.includes('\\') || filePath.includes('/')) {
                    // Local file path
                    fetchPath = 'file:///' + filePath.replace(/\\/g, '/');
                } else {
                    // Assume it's just a filename, prepend server address
                    const serverAddress = 'http://localhost:8080/data/';
                    fetchPath = serverAddress + filePath;
                    filePathInput.value = fetchPath; // Update input with full URL
                }
                
                fetch(fetchPath)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                        displayData(data);
                        closeSettings();
                    })
                    .catch(async error => {
                        alert('Error loading file: ' + error.message + '\n\nLoading mock data instead.');
                        const mockData = await generateMockData();
                        displayData(mockData);
                        closeSettings();
                    });
            } else {
                // No path provided, load mock data
                generateMockData().then(mockData => {
                    displayData(mockData);
                    closeSettings();
                });
            }
        }

        // Display data in table
        /**
         * Apply current filter to data and display results
         */
        async function applyCurrentFilter() {
            console.log('🔍 Applying filter:', currentFilter);
            
            const data = await requestMockDataFromParent();
            if (!data || !data.items) {
                console.warn('No data available');
                return;
            }
            
            let filteredItems = [];
            let filterMessage = null;
            
            switch (currentFilter.type) {
                case 'critical':
                    // Show critical, severe, moderate status items
                    filteredItems = data.items.filter(item => {
                        const status = (item.status || '').toLowerCase();
                        return status === 'critical' || status === 'severe' || status === 'moderate';
                    });
                    filterMessage = 'Showing Critical, Severe, and Moderate Status Items';
                    console.log('📊 Critical filter: found', filteredItems.length, 'items');
                    break;
                    
                case 'resolved':
                    // Show resolved status items
                    filteredItems = data.items.filter(item => {
                        const status = (item.status || '').toLowerCase();
                        return status === 'resolved';
                    });
                    filterMessage = 'Showing Resolved Status Items';
                    console.log('📊 Resolved filter: found', filteredItems.length, 'items');
                    break;
                    
                case 'lowSupply':
                    // Show items with less than 1 week supply (based on cached usage)
                    filteredItems = data.items.filter(item => {
                        const weeklyUsage = item._cachedWeeklyUsage || 0;
                        const totalQty = (item.pyxis || 0) + (item.pharmacy || 0);
                        if (weeklyUsage === 0) return false; // Exclude items with no usage
                        const weeksSupply = totalQty / weeklyUsage;
                        return weeksSupply < 1;
                    });
                    filterMessage = 'Showing Items with Less Than 1 Week Supply';
                    console.log('📊 Low supply filter: found', filteredItems.length, 'items');
                    break;
                    
                case 'topUsed':
                    // Show trending items received from Dashboard
                    if (window.trendingItems && window.trendingItems.trendingUp && window.trendingItems.trendingUp.length > 0) {
                        const trendingItemCodes = window.trendingItems.trendingUp.map(item => item.itemCode);
                        filteredItems = data.items.filter(item => trendingItemCodes.includes(item.itemCode));
                        const threshold = window.trendingItems.threshold || 2;
                        filterMessage = `Trending Items (${threshold}+ consecutive weeks increasing usage)`;
                        console.log('📈 Trending items filter: found', filteredItems.length, 'items');
                    } else {
                        // Fallback to top 25 by usage if no trending data
                        filteredItems = data.items
                            .filter(item => (item._cachedWeeklyUsage || 0) > 0)
                            .sort((a, b) => (b._cachedWeeklyUsage || 0) - (a._cachedWeeklyUsage || 0))
                            .slice(0, 25);
                        filterMessage = 'Top 25 Most Used Items by Weekly Usage';
                        console.log('📊 Top used filter (fallback): found', filteredItems.length, 'items');
                    }
                    break;
                
                case 'expiredEta':
                    // Show items with ETA dates older than today
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    filteredItems = data.items.filter(item => {
                        if (!item.ETA) return false;
                        const etaDate = new Date(item.ETA);
                        etaDate.setHours(0, 0, 0, 0);
                        return etaDate < today;
                    });
                    filterMessage = 'Items with Expired ETA Dates';
                    console.log('📅 Expired ETA filter: found', filteredItems.length, 'items');
                    break;
                
                case 'etaWithin7Days':
                    // Show items with ETA within the next 7 days
                    const todayFor7Days = new Date();
                    todayFor7Days.setHours(0, 0, 0, 0);
                    const sevenDaysOut = new Date(todayFor7Days);
                    sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
                    filteredItems = data.items.filter(item => {
                        if (!item.ETA) return false;
                        const etaDate = new Date(item.ETA);
                        etaDate.setHours(0, 0, 0, 0);
                        return etaDate >= todayFor7Days && etaDate <= sevenDaysOut;
                    });
                    filterMessage = 'Items Arriving This Week (Next 7 Days)';
                    console.log('📅 ETA within 7 days filter: found', filteredItems.length, 'items');
                    break;
                
                case 'etaWithin14Days':
                    // Show items with ETA between 7-14 days out
                    const todayFor14Days = new Date();
                    todayFor14Days.setHours(0, 0, 0, 0);
                    const sevenDaysFrom = new Date(todayFor14Days);
                    sevenDaysFrom.setDate(sevenDaysFrom.getDate() + 7);
                    const fourteenDaysOut = new Date(todayFor14Days);
                    fourteenDaysOut.setDate(fourteenDaysOut.getDate() + 14);
                    filteredItems = data.items.filter(item => {
                        if (!item.ETA) return false;
                        const etaDate = new Date(item.ETA);
                        etaDate.setHours(0, 0, 0, 0);
                        return etaDate > sevenDaysFrom && etaDate <= fourteenDaysOut;
                    });
                    filterMessage = 'Items Arriving Next Week (7-14 Days)';
                    console.log('📅 ETA within 14 days filter: found', filteredItems.length, 'items');
                    break;
                
                case 'noUpcomingEta':
                    // Show items with no ETA within the next 14 days (but has ETA)
                    const todayForNoUpcoming = new Date();
                    todayForNoUpcoming.setHours(0, 0, 0, 0);
                    const fourteenDaysForward = new Date(todayForNoUpcoming);
                    fourteenDaysForward.setDate(fourteenDaysForward.getDate() + 14);
                    filteredItems = data.items.filter(item => {
                        if (!item.ETA) return false;
                        const etaDate = new Date(item.ETA);
                        etaDate.setHours(0, 0, 0, 0);
                        return etaDate > fourteenDaysForward;
                    });
                    filterMessage = 'Items with No Upcoming ETA (Beyond 14 Days)';
                    console.log('📅 No upcoming ETA filter: found', filteredItems.length, 'items');
                    break;
                
                case 'noEta':
                    // Show items with no ETA recorded at all
                    filteredItems = data.items.filter(item => {
                        return !item.ETA || item.ETA === '' || item.ETA.toLowerCase() === 'tbd';
                    });
                    filterMessage = 'Items with No ETA Recorded';
                    console.log('📅 No ETA filter: found', filteredItems.length, 'items');
                    break;
                
                case 'outOfStock':
                    // Show items with 0 days supply
                    filteredItems = data.items.filter(item => {
                        if (!item._cachedWeeklyUsage || item._cachedWeeklyUsage <= 0) return false;
                        const totalQty = (item.pyxis || 0) + (item.pharmacy || 0);
                        return totalQty === 0;
                    });
                    filterMessage = 'Out of Stock Items (0 Days Supply)';
                    console.log('🔴 Out of stock filter: found', filteredItems.length, 'items');
                    break;
                
                case 'lowStock':
                    // Show items with < 7 days supply
                    filteredItems = data.items.filter(item => {
                        if (!item._cachedWeeklyUsage || item._cachedWeeklyUsage <= 0) return false;
                        const totalQty = (item.pyxis || 0) + (item.pharmacy || 0);
                        if (totalQty === 0) return false; // Exclude out of stock
                        const daysSupply = (totalQty / item._cachedWeeklyUsage) * 7;
                        return daysSupply < 7;
                    });
                    filterMessage = 'Low Stock Items (<7 Days Supply)';
                    console.log('🟠 Low stock filter: found', filteredItems.length, 'items');
                    break;
                
                case 'normalStock':
                    // Show items with 7-60 days supply
                    filteredItems = data.items.filter(item => {
                        if (!item._cachedWeeklyUsage || item._cachedWeeklyUsage <= 0) return true; // Items with no usage
                        const totalQty = (item.pyxis || 0) + (item.pharmacy || 0);
                        const daysSupply = (totalQty / item._cachedWeeklyUsage) * 7;
                        return daysSupply >= 7 && daysSupply <= 60;
                    });
                    filterMessage = 'Normal Stock Items (7-60 Days Supply)';
                    console.log('🟢 Normal stock filter: found', filteredItems.length, 'items');
                    break;
                
                case 'overStock':
                    // Show items with > 60 days supply
                    filteredItems = data.items.filter(item => {
                        if (!item._cachedWeeklyUsage || item._cachedWeeklyUsage <= 0) return false;
                        const totalQty = (item.pyxis || 0) + (item.pharmacy || 0);
                        const daysSupply = (totalQty / item._cachedWeeklyUsage) * 7;
                        return daysSupply > 60;
                    });
                    filterMessage = 'Overstock Items (>60 Days Supply)';
                    console.log('🔵 Overstock filter: found', filteredItems.length, 'items');
                    break;
                    
                case 'itemClass':
                    // Filter by item class
                    if (currentFilter.value) {
                        filteredItems = data.items.filter(item => item.itemClass === currentFilter.value);
                        filterMessage = `Showing ${currentFilter.value}`;
                        console.log('📊 Item class filter: found', filteredItems.length, 'items');
                    }
                    break;
                    
                case 'drugName':
                    // Filter by drug name
                    if (currentFilter.value) {
                        filteredItems = data.items.filter(item => item.drugName === currentFilter.value);
                        filterMessage = `Showing ${currentFilter.value}`;
                        console.log('📊 Drug name filter: found', filteredItems.length, 'items');
                    }
                    break;
                    
                case 'description':
                    // Filter by description
                    if (currentFilter.value) {
                        filteredItems = data.items.filter(item => item.description === currentFilter.value);
                        filterMessage = `Showing ${currentFilter.value}`;
                        console.log('📊 Description filter: found', filteredItems.length, 'items');
                    }
                    break;
                    
                case 'fdaShortages':
                    // Filter by FDA shortage itemCodes and sort by update_date (newest first)
                    if (currentFilter.itemCodes && currentFilter.itemCodes.length > 0) {
                        // Convert itemCodes to strings for comparison
                        const itemCodeStrings = currentFilter.itemCodes.map(code => String(code));
                        
                        filteredItems = data.items.filter(item => {
                            const itemCodeStr = String(item.itemCode);
                            return itemCodeStrings.includes(itemCodeStr);
                        });
                        
                        // Sort by update_date (newest to oldest)
                        // Assuming update_date field exists on items, if not we'll use lastUpdated
                        filteredItems.sort((a, b) => {
                            const dateA = new Date(a.update_date || a.lastUpdated || 0);
                            const dateB = new Date(b.update_date || b.lastUpdated || 0);
                            return dateB - dateA; // Descending (newest first)
                        });
                        
                        filterMessage = `FDA Reported Shortages (${filteredItems.length} items)`;
                        console.log('📋 FDA Shortages filter: found', filteredItems.length, 'items from', currentFilter.itemCodes.length, 'itemCodes');
                    } else {
                        filterMessage = 'No FDA Shortage Items';
                        console.log('📋 FDA Shortages filter: no itemCodes provided');
                    }
                    break;

                case 'expiringSoon':
                    // Filter by itemCodes provided by Analytics (items with any on-hand expiring ≤3 months)
                    if (currentFilter.itemCodes && currentFilter.itemCodes.length > 0) {
                        const itemCodeStrings = currentFilter.itemCodes.map(code => String(code));
                        filteredItems = data.items.filter(item => itemCodeStrings.includes(String(item.itemCode)));
                        filterMessage = `Expiring ≤3 Months (${filteredItems.length} items)`;
                        console.log('🟡 ExpiringSoon filter: found', filteredItems.length, 'items from', currentFilter.itemCodes.length, 'itemCodes');
                    } else {
                        filterMessage = 'No Expiring Items (≤3 Months)';
                        console.log('🟡 ExpiringSoon filter: no itemCodes provided');
                    }
                    break;

                case 'projectedWasteSpike':
                    // Filter by itemCodes provided by Charts (items contributing to an expiry-day projected waste spike)
                    if (currentFilter.itemCodes && currentFilter.itemCodes.length > 0) {
                        const itemCodeStrings = currentFilter.itemCodes.map(code => String(code));
                        // Filter the inventory items dataset (not an undefined local)
                        filteredItems = data.items.filter(item =>
                            itemCodeStrings.includes(String(item.ndc || item.NDC || item.itemCode || item.itemId || item.id))
                        );
                        filterMessage = `Expiry-day projected waste spike (${filteredItems.length} items)`;
                        console.log('📌 ProjectedWasteSpike filter: found', filteredItems.length, 'items from', currentFilter.itemCodes.length, 'itemCodes');

                        // Update active filter chip label if present
                        try {
                            const dateISO = currentFilter.context && currentFilter.context.dateISO ? currentFilter.context.dateISO : '';
                            const qty = currentFilter.context && currentFilter.context.projectedWasteQty != null ? currentFilter.context.projectedWasteQty : null;
                            const cost = currentFilter.context && currentFilter.context.projectedWasteCost != null ? currentFilter.context.projectedWasteCost : null;
                            const pretty = dateISO ? `Expiry spike: ${dateISO}` : 'Expiry spike';
                            const extra = (qty != null || cost != null) 
                                ? ` (${qty != null ? Math.round(qty).toLocaleString() + ' units' : ''}${(qty != null && cost != null) ? ', ' : ''}${cost != null ? '$' + Math.round(cost).toLocaleString() : ''})`
                                : '';
                            currentFilter.displayName = pretty + extra;
                        } catch (e) {}
                    }
                    break;

                    
                case 'search':
                    // Search filter handled by search function
                    return;
                    
                case null:
                default:
                    // No specific filter - just show the data as is (auto-load will handle it)
                    console.log('📊 No filter specified - showing default view');
                    return;
            }
            
            // Display filtered results
            if (filteredItems.length > 0) {
                displayData({ 
                    items: filteredItems,
                    lastUpdated: data.lastUpdated  // Preserve last updated date
                }, filterMessage);
            } else {
                showEmptyState('noResults', filterMessage);
            }
        }
        
        /**
         * Show empty state message
         */
        function showEmptyState(type = 'search', filterMessage = null) {
            const tableBody = document.getElementById('tableBody');
            const backorderTable = document.getElementById('backorderTable');
            const itemCount = document.getElementById('itemCount');
            
            tableBody.innerHTML = '';
            backorderTable.classList.add('hidden');
            
            let icon, title, message, headerText;
            
            if (type === 'search') {
                icon = '🔍';
                title = 'Start typing to search';
                message = 'Enter a drug name or item code to find items';
                headerText = 'Start typing to initiate a search';  // For header
            } else if (type === 'noResults') {
                icon = '📭';
                title = 'No items found';
                message = filterMessage || 'No items match the current filter';
                headerText = filterMessage || 'No items found';  // Use filter message for header
            }
            
            // Update header
            if (itemCount) {
                itemCount.textContent = headerText;
            }
            
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <div class="empty-state-icon">${icon}</div>
                        <div class="empty-state-title">${title}</div>
                        <div class="empty-state-message">${message}</div>
                    </td>
                </tr>
            `;
        }
        
        function displayData(data, filterMessage = null) {
            console.log('=== displayData DEBUG ===');
            console.log('displayData called with:', data);
            console.log('tableBody element:', tableBody);
            console.log('backorderTable element:', backorderTable);
            console.log('emptyState element:', emptyState);
            console.log('data.items:', data.items);
            console.log('data.items.length:', data.items ? data.items.length : 'NO ITEMS PROPERTY');
            
            tableBody.innerHTML = '';
            
            // Clear child row cache when displaying new data
            childRowCache.clear();
            console.log('🗑️ Child row cache cleared - fresh data loaded');
            
            if (data.items && data.items.length > 0) {
                console.log('Data has items, displaying...');
                console.log('Removing hidden class from table');
                emptyState.style.display = 'none';
                backorderTable.classList.remove('hidden');
                
                
                // Group items by drugName
                const groupedItems = {};
                data.items.forEach(item => {
                    const drugName = item.drugName || 'Ungrouped';
                    if (!groupedItems[drugName]) {
                        groupedItems[drugName] = [];
                    }
                    groupedItems[drugName].push(item);
                });
                
                // Update item count to show number of groups (and filter message if present)
                const groupCount = Object.keys(groupedItems).length;
                const itemCountText = filterMessage 
                    ? `${filterMessage} - ${groupCount} Groups`
                    : `Total Groups: ${groupCount}`;
                document.getElementById('itemCount').textContent = itemCountText;
                
                console.log('Grouped items:', groupedItems);
                
                // Create rows for each group - SORT CASE-INSENSITIVE
                Object.keys(groupedItems).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).forEach(drugName => {
                    const items = groupedItems[drugName];
                    // Create safe groupId by replacing ALL special characters with safe alternatives
                    const groupId = drugName
                        .replace(/\s+/g, '-')           // spaces to dashes
                        .replace(/[()]/g, '')            // remove parentheses
                        .replace(/%/g, 'pct')            // percent to "pct"
                        .replace(/[./]/g, '-')           // dots and slashes to dashes
                        .replace(/[^\w-]/g, '')          // remove any other special chars
                        .toLowerCase();
                    
                    // Calculate group summary
                    const totalQty = items.reduce((sum, item) => sum + ((item.pyxis || 0) + (item.pharmacy || 0)), 0);
                    const statusPriority = { 'non-formulary': 5, critical: 4, severe: 3, moderate: 2, resolved: 1, '': 0 };
                    const displayStatuses = items.map(item => getDisplayStatus(item) || '');
                    const nonFormularyCount = displayStatuses.filter(status => status === 'non-formulary').length;
                    const allowGroupNonFormulary = nonFormularyCount > 0 && nonFormularyCount === items.length;
                    const highestPriority = displayStatuses.reduce((highest, itemStatus) => {
                        const normalizedStatus = (!allowGroupNonFormulary && itemStatus === 'non-formulary') ? '' : itemStatus;
                        const highestStatus = highest || '';
                        return (statusPriority[normalizedStatus] || 0) > (statusPriority[highestStatus] || 0) ? normalizedStatus : highestStatus;
                    }, '');
                    
                    // Check if any item in group has SBAR
                    const sbarItem = items.find(item => item.SBAR && item.filePath);
                    const hasSBAR = sbarItem ? true : false;
                    const filePath = sbarItem ? sbarItem.filePath : '';
                    
                    // Always show details icon for all groups
                    const detailsIconHtml = `
                        <div class="group-details-icon" onclick='openDetailsModal(${JSON.stringify(drugName)}, ${JSON.stringify(sbarItem?.notes || "")}, ${JSON.stringify(filePath)}, ${JSON.stringify(items)}, ${hasSBAR})' title="View details for ${drugName}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M10,19L12,15H9V10H13V12L11,16H14V19H10Z"/>
                            </svg>
                        </div>
                    `;
                    
                    // Create group header row
                    const headerRow = document.createElement('tr');
                    headerRow.className = `group-header status-${highestPriority}`;
                    headerRow.dataset.group = groupId;
                    headerRow.dataset.drugname = drugName;
                    headerRow.dataset.status = highestPriority;
                    
                    const statusTooltip = getStatusTooltip(highestPriority);
                    
                    headerRow.innerHTML = `
                        <td class="col-description">
                            <div class="drug-name-cell">
                                <svg class="expand-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                                </svg>
                                <span>${drugName}</span>
                            </div>
                        </td>
                        <td class="col-item-code"></td>
                        <td class="col-quantity">
                            <span class="group-total">${totalQty.toLocaleString()}</span>
                        </td>
                        <td class="col-status">
                            <span class="status highest-priority ${highestPriority} status-tooltip-wrapper">${highestPriority ? highestPriority.toUpperCase() : ''}</span>
                        </td>
                        <td class="col-eta"></td>
                        <td class="col-details">
                            ${detailsIconHtml}
                        </td>
                    `;
                    
                    headerRow.addEventListener('click', (e) => {
                        if (!e.target.closest('.group-details-icon')) {
                            toggleGroupLazy(groupId, items, highestPriority, drugName, hasSBAR, filePath);
                        }
                    });
                    tableBody.appendChild(headerRow);
                    
                    // Attach tooltip to status badge (only if status exists)
                    const statusBadge = headerRow.querySelector('.status-tooltip-wrapper');
                    if (statusBadge && highestPriority) {
                        attachTooltipListeners(statusBadge, statusTooltip, 'status-tooltip');
                    }
                    
                    // DON'T create child rows immediately - create them lazily on expand
                    // This reduces initial DOM nodes from 3,652 to ~1,172 (just group headers)
                    // Child rows will be created by toggleGroupLazy() when needed
                });
                
                console.log('All rows created. Total tbody children:', tableBody.children.length);
                
                // Update last updated date
                const lastUpdatedEl = document.getElementById('lastUpdated');
                if (data.lastUpdated) {
                    const lastUpdatedDate = new Date(data.lastUpdated + 'T00:00:00');
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    
                    const diffTime = today - lastUpdatedDate;
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                    
                    lastUpdatedEl.className = 'last-updated';
                    const daysText = diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
                    lastUpdatedEl.textContent = `Last Updated: ${data.lastUpdated} (${daysText})`;
                    
                    if (diffDays > 7) {
                        lastUpdatedEl.classList.add('critical');
                    } else if (diffDays > 2) {
                        lastUpdatedEl.classList.add('warning');
                    }
                } else {
                    lastUpdatedEl.className = 'last-updated';
                    lastUpdatedEl.textContent = 'Last Updated: Unknown';
                }
            } else {
                console.log('No items in data, showing empty state');
                backorderTable.classList.add('hidden');
                emptyState.style.display = 'block';
            }
            
            // Items are already sorted alphabetically by the displayData grouping
            // No need to re-sort unless specifically requested
            
            // Update scrollbar visibility after rendering table
            updateScrollbarVisibility();
        }

        // Toggle group expand/collapse with animations
        // ==================================================================================
        // LAZY GROUP EXPANSION - Performance Optimization
        // ==================================================================================
        // Cache for child rows to avoid recreating DOM elements
        const childRowCache = new Map();
        // Store group data for lazy access
        const groupDataStore = new Map();
        
        /**
         * Toggle group with lazy child row creation
         * Only creates child DOM elements when group is first expanded
         * Subsequent expansions reuse cached elements
         */
        function toggleGroupLazy(groupId, items, highestPriority, drugName, hasSBAR, filePath) {
            console.log('🚀 toggleGroupLazy called for:', groupId);
            
            // Store group data if not already stored
            if (!groupDataStore.has(groupId)) {
                groupDataStore.set(groupId, { items, highestPriority, drugName, hasSBAR, filePath });
            }
            const headerRow = document.querySelector(`[data-group="${groupId}"]`);
            const expandIcon = headerRow.querySelector('.expand-icon');
            const isCurrentlyExpanded = headerRow.classList.contains('expanded');
            
            // Check if child rows exist in cache
            let childRows = childRowCache.get(groupId);
            
            // If not in cache, create them now (lazy initialization)
            if (!childRows) {
                console.log('📦 Creating child rows for first expansion:', groupId);
                childRows = createChildRows(items, groupId, highestPriority, drugName, hasSBAR, filePath);
                childRowCache.set(groupId, childRows);
                
                // Insert rows after header
                const nextElement = headerRow.nextElementSibling;
                childRows.forEach(row => {
                    if (nextElement) {
                        tableBody.insertBefore(row, nextElement);
                    } else {
                        tableBody.appendChild(row);
                    }
                });
                console.log(`✅ Created ${childRows.length} child rows`);
            } else {
                console.log('♻️ Reusing cached child rows:', childRows.length);
            }
            
            // Now toggle with existing logic
            toggleGroup(groupId);
        }
        
        /**
         * Create child rows for a group (called lazily)
         */
        function createChildRows(items, groupId, highestPriority, drugName, hasSBAR, filePath) {
            const rows = [];
            
            items.forEach(item => {
                const childRow = document.createElement('tr');
                const displayStatus = getDisplayStatus(item);
                const hasStatus = displayStatus && displayStatus.trim() !== '';
                childRow.className = `child-row group-${groupId} status-${highestPriority}${!hasStatus ? ' no-status' : ''}`;
                
                // Calculate total quantity from pyxis and pharmacy
                const totalItemQuantity = (item.pyxis || 0) + (item.pharmacy || 0);
                
                // Show details icon only when there are notes
                let detailsCellContent = '';
                if (item.notes) {
                    detailsCellContent = `
                        <div class="item-details-icon tooltip-wrapper" data-notes="${item.notes.replace(/"/g, '&quot;')}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/>
                            </svg>
                        </div>
                    `;
                }
                
                const statusTooltip = getStatusTooltip(displayStatus);
                
                childRow.innerHTML = `
                    <td class="col-description">${getDisplayDescription(item.description)}</td>
                    <td class="col-item-code">${item.alt_itemCode}</td>
                    <td class="col-quantity">${totalItemQuantity.toLocaleString()}</td>
                    <td class="col-status">
                        <span class="status ${displayStatus} status-tooltip-wrapper">${displayStatus ? displayStatus.toUpperCase() : ''}</span>
                    </td>
                    <td class="col-eta">${item.ETA || ''}</td>
                    <td class="col-details">${detailsCellContent}</td>
                `;
                
                // Attach tooltip to status badge (only if status exists)
                const statusBadge = childRow.querySelector('.status-tooltip-wrapper');
                if (statusBadge && displayStatus) {
                    attachTooltipListeners(statusBadge, statusTooltip, 'status-tooltip');
                }
                
                // Attach tooltip to notes icon
                const notesIcon = childRow.querySelector('.tooltip-wrapper');
                if (notesIcon && item.notes) {
                    attachTooltipListeners(notesIcon, item.notes, 'notes-tooltip');
                }
                
                // Add click handler to open details modal with this specific item selected
                childRow.addEventListener('click', (e) => {
                    const itemIndex = items.indexOf(item);
                    openDetailsModal(drugName, item.notes || '', filePath, items, hasSBAR, itemIndex);
                });
                
                // Make the row look clickable
                childRow.style.cursor = 'pointer';
                
                rows.push(childRow);
            });
            
            return rows;
        }
        
        function toggleGroup(groupId) {
            console.log('toggleGroup called for:', groupId);
            const childRows = document.querySelectorAll(`.group-${groupId}`);
            const headerRow = document.querySelector(`[data-group="${groupId}"]`);
            const expandIcon = headerRow.querySelector('.expand-icon');
            
            console.log('Found child rows:', childRows.length);
            
            // Check if this group is currently expanded
            const isCurrentlyExpanded = headerRow.classList.contains('expanded');
            
            // Find if there's another group currently expanded
            const currentlyExpandedHeader = document.querySelector('.group-header.expanded');
            const hasOtherGroupExpanded = currentlyExpandedHeader && currentlyExpandedHeader !== headerRow;
            
            // If we're about to expand this group and another group is already open
            if (!isCurrentlyExpanded && hasOtherGroupExpanded) {
                // First, close the currently expanded group with animation
                const otherGroupId = currentlyExpandedHeader.dataset.group;
                const otherChildRows = document.querySelectorAll(`.group-${otherGroupId}`);
                const otherExpandIcon = currentlyExpandedHeader.querySelector('.expand-icon');
                
                console.log('Closing other group first:', otherGroupId);
                
                // Add closing class to trigger close animation
                otherChildRows.forEach(row => {
                    row.classList.add('closing');
                    row.classList.remove('visible', 'first-child', 'last-child');
                });
                otherExpandIcon.classList.remove('expanded');
                currentlyExpandedHeader.classList.remove('expanded');
                
                // Wait for close animation to complete, then open the new group
                setTimeout(() => {
                    // Remove closing class
                    otherChildRows.forEach(row => {
                        row.classList.remove('closing');
                    });
                    
                    // Now open the clicked group
                    expandGroup(groupId, childRows, headerRow, expandIcon);
                }, 400); // Match the CSS transition duration
            } else {
                // No other group open, or we're closing this group
                // Toggle immediately
                if (isCurrentlyExpanded) {
                    // Closing this group
                    childRows.forEach(row => {
                        row.classList.add('closing');
                        row.classList.remove('visible', 'first-child', 'last-child');
                    });
                    expandIcon.classList.remove('expanded');
                    headerRow.classList.remove('expanded');
                    
                    setTimeout(() => {
                        childRows.forEach(row => {
                            row.classList.remove('closing');
                        });
                    }, 400);
                } else {
                    // Opening this group
                    expandGroup(groupId, childRows, headerRow, expandIcon);
                }
            }
            
            // Update body class to indicate if any group is expanded
            setTimeout(() => {
                const hasAnyExpanded = document.querySelector('.group-header.expanded') !== null;
                if (hasAnyExpanded) {
                    document.body.classList.add('has-expanded-group');
                } else {
                    document.body.classList.remove('has-expanded-group');
                    // Show all group quantities when no group is expanded
                    document.querySelectorAll('.group-header .group-total').forEach(total => {
                        total.style.display = '';
                    });
                }
                
                // Update header columns and table state
                updateHeaderColumnsState();
                
                // Check scrollbar visibility AFTER animation completes
                setTimeout(() => {
                    updateScrollbarVisibility();
                    console.log('🔍 Checking scrollbar after group expand/collapse animation');
                }, 500); // Wait for animation to fully complete
            }, isCurrentlyExpanded ? 400 : (hasOtherGroupExpanded ? 450 : 50));
        }
        
        // Helper function to expand a group
        function expandGroup(groupId, childRows, headerRow, expandIcon) {
            console.log('Expanding group:', groupId);
            
            // Hide all other group quantities
            document.querySelectorAll('.group-header .group-total').forEach(total => {
                total.style.display = 'none';
            });
            
            childRows.forEach((row, index) => {
                // Add visible class to trigger open animation
                row.classList.add('visible');
                
                // Add first-child and last-child classes
                if (index === 0) {
                    row.classList.add('first-child');
                }
                if (index === childRows.length - 1) {
                    row.classList.add('last-child');
                }
                
                console.log('Row visible class:', row.classList.contains('visible'));
            });
            
            expandIcon.classList.add('expanded');
            headerRow.classList.add('expanded');
            
            // After animation completes, check if we need to scroll to show all children
            setTimeout(() => {
                if (childRows.length > 0) {
                    const tableContainer = document.querySelector('.table-container');
                    if (!tableContainer) return;
                    
                    const lastChildRow = childRows[childRows.length - 1];
                    const containerRect = tableContainer.getBoundingClientRect();
                    const lastRowRect = lastChildRow.getBoundingClientRect();
                    
                    // Check if the last child row is fully visible within the table container
                    const containerBottom = containerRect.bottom;
                    const rowBottom = lastRowRect.bottom;
                    
                    if (rowBottom > containerBottom) {
                        // Calculate how much to scroll to bring the last row into view
                        const scrollAmount = rowBottom - containerBottom + 20; // 20px padding
                        
                        tableContainer.scrollBy({
                            top: scrollAmount,
                            behavior: 'smooth'
                        });
                    }
                }
                
                // Check scrollbar visibility after expansion animation
                updateScrollbarVisibility();
            }, 450); // Wait for animation to complete (matches the transition duration)
        }

        // Open file from path
        function openFile(filePath) {
            const width = 1000;
            const height = 800;
            const left = (screen.width - width) / 2;
            const top = (screen.height - height) / 2;
            
            window.open(
                filePath, 
                'SBARDocument', 
                `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no`
            );
        }



        // Calculate scrollbar width dynamically
        function getScrollbarWidth() {
            // Create temporary element to measure scrollbar
            const outer = document.createElement('div');
            outer.style.visibility = 'hidden';
            outer.style.overflow = 'scroll';
            outer.style.msOverflowStyle = 'scrollbar'; // needed for WinJS apps
            document.body.appendChild(outer);

            const inner = document.createElement('div');
            outer.appendChild(inner);

            const scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
            outer.parentNode.removeChild(outer);

            return scrollbarWidth;
        }

        // Detect and toggle scrollbar-visible class
        function updateScrollbarVisibility() {
            // Use requestAnimationFrame to ensure DOM has updated
            requestAnimationFrame(() => {
                const tableContainer = document.querySelector('.table-container');
                const header = document.querySelector('.header');
                
                if (!tableContainer) {
                    console.log('⚠️ Table container not found');
                    return;
                }

                const scrollbarWidth = getScrollbarWidth();
                const scrollHeight = tableContainer.scrollHeight;
                const clientHeight = tableContainer.clientHeight;
                const hasVerticalScrollbar = scrollHeight > clientHeight;
                
                console.log('📊 Scrollbar Check:', {
                    scrollHeight,
                    clientHeight,
                    hasScrollbar: hasVerticalScrollbar,
                    scrollbarWidth: scrollbarWidth + 'px',
                    offsetWidth: tableContainer.offsetWidth,
                    clientWidth: tableContainer.clientWidth
                });
                
                if (hasVerticalScrollbar) {
                    tableContainer.classList.add('scrollbar-visible');
                    if (header) header.classList.add('scrollbar-visible');
                    console.log('✓ Scrollbar visible - extra padding applied (width: ' + scrollbarWidth + 'px)');
                } else {
                    tableContainer.classList.remove('scrollbar-visible');
                    if (header) header.classList.remove('scrollbar-visible');
                    console.log('✗ No scrollbar - normal padding');
                }
            });
        }


        // ============= UNIFIED ARROW SCROLL SYSTEM =============
        
        function updateArrowsForContainer(container, upArrow, downArrow) {
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
        
        function setupScrollArrows(container, upArrow, downArrow) {
            if (!container || !upArrow || !downArrow) return;
            
            upArrow.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                container.scrollBy({ top: -300, behavior: 'smooth' });
                setTimeout(() => updateArrowsForContainer(container, upArrow, downArrow), 400);
            };
            
            downArrow.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                container.scrollBy({ top: 300, behavior: 'smooth' });
                setTimeout(() => updateArrowsForContainer(container, upArrow, downArrow), 400);
            };
            
            container.addEventListener('scroll', () => updateArrowsForContainer(container, upArrow, downArrow), { passive: true });
            updateArrowsForContainer(container, upArrow, downArrow);
        }
        
        function initArrowScrollSystem() {
            console.log('🎯 Initializing scroll arrows');
            
            const tableContainer = document.querySelector('.table-container');
            const tableUp = document.getElementById('scrollArrowUp');
            const tableDown = document.getElementById('scrollArrowDown');
            if (tableContainer && tableUp && tableDown) {
                setupScrollArrows(tableContainer, tableUp, tableDown);
            }
            
            const detailsModal = document.getElementById('detailsModal');
            if (detailsModal) {
                const detailsBody = detailsModal.querySelector('.modal-body');
                const modalUp = document.getElementById('modalScrollArrowUp');
                const modalDown = document.getElementById('modalScrollArrowDown');
                if (detailsBody && modalUp && modalDown) {
                    setupScrollArrows(detailsBody, modalUp, modalDown);
                    const observer = new MutationObserver(() => {
                        // Only show arrows if modal is active AND focused (carousel-front)
                        if (detailsModal.classList.contains('active') && detailsModal.classList.contains('carousel-front')) {
                            // Modal opened and focused - update arrows
                            setTimeout(() => updateArrowsForContainer(detailsBody, modalUp, modalDown), 100);
                        } else {
                            // Modal closed or unfocused - hide arrows
                            modalUp.classList.remove('visible');
                            modalUp.classList.add('hidden');
                            modalDown.classList.remove('visible');
                            modalDown.classList.add('hidden');
                        }
                    });
                    observer.observe(detailsModal, { attributes: true, attributeFilter: ['class'] });
                }
            }
            
            // Add scroll arrows for companion modal
            const companionModal = document.getElementById('companionModal');
            if (companionModal) {
                const companionBody = companionModal.querySelector('.modal-body');
                const companionUp = document.getElementById('companionModalScrollArrowUp');
                const companionDown = document.getElementById('companionModalScrollArrowDown');
                if (companionBody && companionUp && companionDown) {
                    setupScrollArrows(companionBody, companionUp, companionDown);
                    const observer = new MutationObserver(() => {
                        // Only show arrows if modal is active AND focused (carousel-front)
                        if (companionModal.classList.contains('active') && companionModal.classList.contains('carousel-front')) {
                            // Modal opened and focused - update arrows
                            setTimeout(() => updateArrowsForContainer(companionBody, companionUp, companionDown), 100);
                        } else {
                            // Modal closed or unfocused - hide arrows
                            companionUp.classList.remove('visible');
                            companionUp.classList.add('hidden');
                            companionDown.classList.remove('visible');
                            companionDown.classList.add('hidden');
                        }
                    });
                    observer.observe(companionModal, { attributes: true, attributeFilter: ['class'] });
                }
            }
            
            window.addEventListener('resize', () => {
                if (tableContainer && tableUp && tableDown) {
                    updateArrowsForContainer(tableContainer, tableUp, tableDown);
                }
            }, { passive: true });
            
            setTimeout(() => tableContainer && updateArrowsForContainer(tableContainer, tableUp, tableDown), 100);
            setTimeout(() => tableContainer && updateArrowsForContainer(tableContainer, tableUp, tableDown), 500);
            setTimeout(() => tableContainer && updateArrowsForContainer(tableContainer, tableUp, tableDown), 1000);
            
            console.log('✅ Scroll arrows ready');
        }
        
        // ============= END ARROW SCROLL SYSTEM =============

        // ============= KEYBOARD SEARCH SYSTEM =============
        
        let searchTerm = '';
        let searchTimeout = null;
        let searchMatches = [];
        
        async function performSearch(term) {
            if (!term || term.trim() === '') {
                // Empty search - show empty state
                currentFilter.type = null;
                currentFilter.value = null;
                showEmptyState('search');
                return;
            }
            
            // Set filter to search mode
            currentFilter.type = 'search';
            currentFilter.value = term;
            
            // Get data and filter
            const data = await requestMockDataFromParent();
            if (!data || !data.items) {
                console.warn('No data available for search');
                return;
            }
            
            const searchLower = term.toLowerCase();
            const matchedItems = data.items.filter(item => {
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
            
            console.log(`🔍 Search for "${term}": found ${matchedItems.length} items`);
            
            if (matchedItems.length > 0) {
                displayData({ 
                    items: matchedItems,
                    lastUpdated: data.lastUpdated  // Preserve last updated date
                }, `Search: "${term}"`);
            } else {
                showEmptyState('noResults', `No results for "${term}"`);
            }
        }
        
        function showSearchBar() {
            const searchBar = document.getElementById('keyboardSearchBar');
            if (searchBar) searchBar.classList.add('visible');
        }
        
        function hideSearchBar() {
            const searchBar = document.getElementById('keyboardSearchBar');
            if (searchBar) searchBar.classList.remove('visible');
            // DON'T clear searchTerm or results - keep them on screen!
            // User can still see what they searched for
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
                if (e.target.tagName === 'INPUT' || 
                    document.querySelector('.modal-overlay.active') ||
                    e.ctrlKey || e.altKey || e.metaKey) {
                    return;
                }
                
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    return;
                }
                
                if (e.key.length > 1 && e.key !== 'Backspace') {
                    return;
                }
                
                if (!searchBar.classList.contains('visible')) {
                    showSearchBar();
                    searchTerm = '';
                }
                
                if (e.key === 'Backspace') {
                    e.preventDefault();
                    searchTerm = searchTerm.slice(0, -1);
                } else if (e.key.length === 1) {
                    searchTerm += e.key;
                }
                
                searchInput.value = searchTerm;
                
                if (searchTimeout) clearTimeout(searchTimeout);
                performSearch(searchTerm);
                searchTimeout = setTimeout(hideSearchBar, 3000);
            });
            
            let mouseMoveTimeout;
            document.addEventListener('mousemove', function() {
                if (searchBar.classList.contains('visible')) {
                    if (mouseMoveTimeout) clearTimeout(mouseMoveTimeout);
                    mouseMoveTimeout = setTimeout(hideSearchBar, 500);
                }
            });
            
            console.log('✅ Keyboard search ready');
        }
        
        // ============= END KEYBOARD SEARCH SYSTEM =============



        // Load data on page load
        // Initialize on both load events to ensure it works in iframe
        window.addEventListener('load', () => {
            console.log('=== PAGE LOAD EVENT ===');
            console.log('Window loaded, initializing...');
            
            // Initialize settings
            initializeSettings();
            
            // Try auto-loading from file path first
            console.log('Calling autoLoadJSON()...');
            autoLoadJSON();
            
            // Load user name into header
            updateHeaderUserName();
            
            // Load avatar into header
            updateHeaderAvatar();
            
            // Log system info to console for debugging
            console.log('=== Inventory System Info ===');
            console.log('System Information:', getSystemInfo());
            console.log('User Settings:', getUserSettings());
            console.log('Access via: window.getSystemInfo() or window.getUserSettings()');
            
            // Check scrollbar visibility
            updateScrollbarVisibility();
            
            // Initialize arrow scroll system
            initArrowScrollSystem();
            
            // Initialize keyboard search
            initKeyboardSearch();
        });

        // Backup initialization for iframe context
        document.addEventListener('DOMContentLoaded', () => {
            console.log('=== DOM CONTENT LOADED ===');
            // Small delay to ensure everything is ready
            setTimeout(() => {
                if (tableBody && tableBody.children.length === 0) {
                    console.log('DOMContentLoaded: Table empty, loading data...');
                    autoLoadJSON();
                }
            }, 100);
        });

        // Expose critical functions globally for Dashboard to call
        window.autoLoadJSON = autoLoadJSON;
        window.generateMockData = generateMockData;
        window.displayData = displayData;

        // Hide tooltips on scroll or resize
        window.addEventListener('scroll', hideTooltip, true);
        window.addEventListener('resize', () => { hideTooltip(); updateScrollbarVisibility(); });
        
        // Hide tooltips when table scrolls
        document.addEventListener('DOMContentLoaded', () => {
            const tableContainer = document.querySelector('.table-container');
            if (tableContainer) {
                tableContainer.addEventListener('scroll', hideTooltip);
            }
        });

        // Expose functions to window for console access
        window.getSystemInfo = getSystemInfo;
        window.getUserSettings = getUserSettings;


        // ============= SUNSET-BASED DARK MODE SYSTEM =============
        
        let sunsetData = {
            sunset: null,
            sunrise: null,
            lastFetch: null,
            latitude: null,
            longitude: null
        };
        
        /**
         * Get user's geographic location using IP-based lookup (no permission needed)
         * Falls back to Sacramento, CA if geolocation unavailable (e.g., local file access)
         */
        async function getUserLocation() {
            try {
                // First, check if we have cached location in localStorage
                const cachedLocation = localStorage.getItem('userLocation');
                if (cachedLocation) {
                    const location = JSON.parse(cachedLocation);
                    const cacheAge = Date.now() - location.timestamp;
                    
                    // Use cached location if it's less than 7 days old
                    if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
                        console.log('Using cached location:', location);
                        return {
                            latitude: location.latitude,
                            longitude: location.longitude
                        };
                    }
                }
                
                // Note: IP geolocation may fail in local file mode due to CORS
                console.log('Attempting to fetch location from IP...');
                const response = await fetch('https://ipapi.co/json/');
                
                if (!response.ok) {
                    throw new Error('IP geolocation failed');
                }
                
                const data = await response.json();
                
                if (data.latitude && data.longitude) {
                    const location = {
                        latitude: data.latitude,
                        longitude: data.longitude,
                        city: data.city,
                        region: data.region,
                        country: data.country_name,
                        timestamp: Date.now()
                    };
                    
                    // Cache the location
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
                const url = `https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&formatted=0`;
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error(`API request failed: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.status !== 'OK') {
                    throw new Error('API returned error status');
                }
                
                // Parse the UTC times and convert to local time
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
                console.error('Error fetching sunset times:', error);
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
            
            // If sunset is today and we're past it, or if we're before tomorrow's sunrise
            if (now >= sunset || now < sunrise) {
                return true;
            }
            
            return false;
        }
        
        /**
         * Update dark mode based on sunset/sunrise
         */
        function updateDarkModeBasedOnTime() {
            const isDark = isNighttime();
            const body = document.body;
            const currentlyDark = body.classList.contains('dark-mode');
            
            if (isDark && !currentlyDark) {
                body.classList.add('dark-mode');
                console.log('🌙 Dark mode activated (nighttime)');
                
                // Update toggle if it exists
                const toggle = document.getElementById('darkModeToggle');
                if (toggle) toggle.checked = true;
            } else if (!isDark && currentlyDark) {
                body.classList.remove('dark-mode');
                console.log('☀️ Light mode activated (daytime)');
                
                // Update toggle if it exists
                const toggle = document.getElementById('darkModeToggle');
                if (toggle) toggle.checked = false;
            }
        }
        
        /**
         * Initialize sunset-based dark mode system
         */
        async function initSunsetDarkMode() {
            try {
                console.log('Initializing sunset-based dark mode...');
                
                // Get user location
                const location = await getUserLocation();
                console.log('Location obtained:', location);
                
                // Fetch sunset times
                await fetchSunsetTimes(location.latitude, location.longitude);
                
                // Apply dark mode based on current time
                updateDarkModeBasedOnTime();
                
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
                currentTime: new Date().toLocaleString()
            };
        }
        
        /**
         * Clear cached location (forces fresh lookup on next load)
         */
        function clearLocationCache() {
            localStorage.removeItem('userLocation');
            console.log('✓ Location cache cleared. Refresh page to detect location again.');
        }
        
        // Initialize sunset dark mode when page loads
        // DISABLED - Dark mode now controlled by Dashboard container
        /*
        window.addEventListener('load', () => {
            // Wait a moment for other initializations, then start sunset system
            setTimeout(() => {
                initSunsetDarkMode();
            }, 500);
        });
        */
        
        // Expose sunset functions for console debugging (disabled)
        /*
        window.getSunsetInfo = getSunsetInfo;
        window.updateDarkModeBasedOnTime = updateDarkModeBasedOnTime;
        window.fetchSunsetTimes = fetchSunsetTimes;
        window.clearLocationCache = clearLocationCache;
        */
        
        // Listen for sort requests from parent Dashboard
        window.addEventListener('message', function(event) {
            if (event.data.type === 'sortTable' && event.data.column) {
                console.log('📥 Shortage Bulletin: Received sort request for column:', event.data.column);
                // Wait a moment for data to be loaded
                setTimeout(() => {
                    sortTable(event.data.column);
                }, 100);
            }
        });

        // ============= END SUNSET-BASED DARK MODE SYSTEM =============
        // Note: Dark mode is now controlled by the Dashboard container
        // Dark mode listener is now in the data request section above
