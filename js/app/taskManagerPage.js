(function () {
    'use strict';

    const TASK_COLUMNS = ['taskId','parentId','sortOrder','level','title','description','status','priority','assigner','assignees','startDate','dueDate','percentComplete','itemCode','itemName','location','sublocation','dependencyIds','archived','createdAt','updatedAt','createdBy','colorKey'];
    const DEFAULT_STATUS = ['all', 'Not Started', 'In Progress', 'Blocked', 'Done'];
    const DEFAULT_PRIORITY = ['Low', 'Medium', 'High', 'Critical'];
    const DAY_MS = 86400000;
    const PB_DEFAULT_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbx37Dl-Nnur3Z471A9Z0ATNqV4lHb_OR1M9-JamaPvcU2iktH9LoTqZUdOlmVRIMEMBEg/exec';
    const PB_DEFAULT_SHEET_ID = '1S5TnYiY3UIlPvJrgd063OVm3a77iaWx_f89I-hYP7tQ';
    const TASK_BADGE_COLORS = [
        { key: 'teal', label: 'Teal', base: '#2ab8ad' },{ key: 'green', label: 'Green', base: '#38c172' },{ key: 'blue', label: 'Blue', base: '#4f8ef7' },{ key: 'purple', label: 'Purple', base: '#8b6cf0' },{ key: 'orange', label: 'Orange', base: '#f39a45' },
        { key: 'rose', label: 'Rose', base: '#e66f97' },{ key: 'red', label: 'Red', base: '#e24f4f' },{ key: 'amber', label: 'Amber', base: '#d6a21f' },{ key: 'lime', label: 'Lime', base: '#91c91a' },{ key: 'mint', label: 'Mint', base: '#43d6a8' },
        { key: 'cyan', label: 'Cyan', base: '#22c7d8' },{ key: 'sky', label: 'Sky', base: '#4a9ff5' },{ key: 'indigo', label: 'Indigo', base: '#6474f2' },{ key: 'violet', label: 'Violet', base: '#9a5cf2' },{ key: 'magenta', label: 'Magenta', base: '#d64fd4' },
        { key: 'pink', label: 'Pink', base: '#ef6ea6' },{ key: 'peach', label: 'Peach', base: '#ef9570' },{ key: 'brown', label: 'Brown', base: '#9d7458' },{ key: 'slate', label: 'Slate', base: '#6f7f95' },{ key: 'steel', label: 'Steel', base: '#688aa1' },
        { key: 'navy', label: 'Navy', base: '#33528f' },{ key: 'forest', label: 'Forest', base: '#2f7a53' },{ key: 'olive', label: 'Olive', base: '#74853b' },{ key: 'gold', label: 'Gold', base: '#c9a040' },{ key: 'charcoal', label: 'Charcoal', base: '#4b5563' }
    ];

    const state = {
        loading: true,
        usingMock: false,
        expanded: {},
        tasks: [],
        filtered: [],
        flatRows: [],
        editingId: null,
        zoom: 'week',
        zoomOutLevel: 0,
        currentAnchorDate: toISODate(new Date()),
        showArchived: false,
        filtersOpen: false,
        drag: null,
        range: null,
        colPx: 42,
        itemLookupRows: [],
        leftPaneCollapsed: false,
        leftPaneWidth: 360,
        resizing: null,
        sortMode: 'manual',
        dragPreview: null,
        syncingScroll: false,
        checklistDraft: [],
        checklistAssignMode: '',
        focusTaskId: '',
        tracksUnlocked: false,
        dragDeleteHot: false,
        printView: false,
        checklistLoading: false,
        ganttRenderQueued: false,
        lastAssignerValue: '',
        autosaveTimer: null,
        autosaveSaving: false,
        autosaveQueued: false,
        autosaveSignature: '',
        checklistPersistMemoByTask: {},
        taskPersistMemoByTask: {}
    };

    const els = {};

    function byId(id) { return document.getElementById(id); }
    function isoNow() { return new Date().toISOString(); }
    function toDate(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    function toISODate(v) { const d = toDate(v); return d ? d.toISOString().slice(0, 10) : ''; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function shiftIsoDate(iso, days) {
        const base = toDate(iso) || new Date();
        return new Date(base.getTime() + (days * DAY_MS)).toISOString().slice(0, 10);
    }

    function clampIsoRange(iso, minIso, maxIso) {
        const v = String(iso || '').trim();
        if (!v) return v;
        if (minIso && v < minIso) return minIso;
        if (maxIso && v > maxIso) return maxIso;
        return v;
    }

    function queueRenderGantt() {
        if (state.ganttRenderQueued) return;
        state.ganttRenderQueued = true;
        requestAnimationFrame(function () {
            state.ganttRenderQueued = false;
            renderGantt();
        });
    }

    function ensureTaskDates(task) {
        if (!task.startDate && !task.dueDate) {
            const now = new Date();
            task.startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
            task.dueDate = shiftIsoDate(task.startDate, 2);
        } else if (!task.startDate && task.dueDate) {
            task.startDate = shiftIsoDate(task.dueDate, -1);
        } else if (task.startDate && !task.dueDate) {
            task.dueDate = shiftIsoDate(task.startDate, 1);
        }
    }

    function getActiveFilterCount() {
        let c = 0;
        if ((els.statusFilter && els.statusFilter.value && els.statusFilter.value !== 'all')) c++;
        if ((els.assigneeFilter && els.assigneeFilter.value && els.assigneeFilter.value !== 'all')) c++;
        if ((els.assignerFilter && els.assignerFilter.value && els.assignerFilter.value !== 'all')) c++;
        if ((els.itemFilter && (els.itemFilter.value || '').trim())) c++;
        if ((els.locationFilter && (els.locationFilter.value || '').trim())) c++;
        return c;
    }

    function syncFilterPanelUi() {
        if (!els.filtersPanel || !els.filterToggle) return;
        els.filtersPanel.classList.toggle('open', !!state.filtersOpen);
        const activeCount = getActiveFilterCount();
        els.filterToggle.textContent = activeCount > 0 ? ('Filters (' + activeCount + ')') : 'Filters';
    }

    function syncZoomOutUi() {
        if (els.zoomOutBtn) els.zoomOutBtn.textContent = '+';
        if (els.zoomInBtn) els.zoomInBtn.textContent = '-';
    }

    function syncZoomModeButtons() {
        const map = { day: byId('tasksZoomDayBtn'), week: byId('tasksZoomWeekBtn'), month: byId('tasksZoomMonthBtn') };
        Object.keys(map).forEach(function (k) { if (map[k]) map[k].classList.toggle('active', state.zoom === k); });
    }

    function syncTrackLockUi() {
        const row = byId('taskTrackRow');
        const unlockBtn = byId('taskTracksUnlockBtn');
        if (row) row.classList.toggle('locked', !state.tracksUnlocked);
        if (unlockBtn) unlockBtn.textContent = state.tracksUnlocked ? 'Assignee timeline tracks unlocked' : 'Unlock Assignee timeline tracks';
    }

    function startOfDay(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function startOfWeek(d) {
        const out = startOfDay(d);
        const off = (out.getDay() + 6) % 7;
        out.setDate(out.getDate() - off);
        return out;
    }

    function startOfMonth(d) {
        return new Date(d.getFullYear(), d.getMonth(), 1);
    }

    function shiftByMode(baseDate, step) {
        const d = new Date(baseDate);
        if (state.zoom === 'day') d.setDate(d.getDate() + step);
        else if (state.zoom === 'week') d.setDate(d.getDate() + (step * 7));
        else d.setMonth(d.getMonth() + step);
        return d;
    }

    function jsonp(url, timeoutMs) {
        timeoutMs = timeoutMs || 20000;
        return new Promise(function (resolve, reject) {
            const cb = '__pbTaskCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            const script = document.createElement('script');
            const sep = url.indexOf('?') >= 0 ? '&' : '?';
            let settled = false;

            function cleanup(removeCallback) {
                clearTimeout(timer);
                if (script.parentNode) script.parentNode.removeChild(script);
                if (removeCallback) {
                    try { delete window[cb]; } catch (_) { window[cb] = undefined; }
                }
            }

            const timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                // Keep a harmless callback to avoid "ReferenceError: <cb> is not defined" if response arrives late.
                window[cb] = function () {};
                cleanup(false);
                reject(new Error('JSONP timeout'));
                setTimeout(function () {
                    try { delete window[cb]; } catch (_) { window[cb] = undefined; }
                }, 15000);
            }, timeoutMs);

            window[cb] = function (payload) {
                if (settled) return;
                settled = true;
                cleanup(true);
                resolve(payload || {});
            };

            script.onerror = function () {
                if (settled) return;
                settled = true;
                cleanup(true);
                reject(new Error('JSONP failed'));
            };

            script.src = url + sep + 'callback=' + encodeURIComponent(cb);
            document.head.appendChild(script);
        });
    }


    function postForm(webAppUrl, payload) {
        return new Promise(function (resolve) {
            const form = document.createElement('form');
            const targetName = 'taskWriteFrame_' + Date.now();
            const iframe = document.createElement('iframe');
            iframe.name = targetName;
            iframe.style.display = 'none';
            form.method = 'POST';
            form.action = webAppUrl;
            form.target = targetName;
            form.style.display = 'none';

            Object.keys(payload).forEach(function (k) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = k;
                input.value = String(payload[k] == null ? '' : payload[k]);
                form.appendChild(input);
            });

            document.body.appendChild(iframe);
            document.body.appendChild(form);
            form.submit();
            setTimeout(function () {
                form.remove();
                iframe.remove();
                resolve({ ok: true, mode: 'form-post' });
            }, 450);
        });
    }

    function getWebAppUrl() {
        return (localStorage.getItem('spike_webAppUrl') || localStorage.getItem('jsonp_proxy_webAppUrl') || PB_DEFAULT_WEBAPP_URL).trim();
    }

    function getSheetId() {
        return (localStorage.getItem('spike_sheetId') || localStorage.getItem('gs_sheetId') || PB_DEFAULT_SHEET_ID).trim();
    }

    function emptyFallbackTasks() {
        return [];
    }

    function parseAssignees(value) {
        function clean(v) {
            const s = String(v || '').trim();
            if (!s) return '';
            if (s.toLowerCase() === 'unassigned') return '';
            return s;
        }
        if (Array.isArray(value)) {
            return value.map(clean).filter(Boolean);
        }
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return [];
        if (raw.charAt(0) === '[') {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean);
            } catch (_) {}
        }
        return raw.split(/[|,;\n]/).map(clean).filter(Boolean);
    }

    function serializeAssignees(list) {
        return JSON.stringify((Array.isArray(list) ? list : []).map(function (v) { return String(v || '').trim(); }).filter(Boolean));
    }

    function parseChecklistAssignees(value, fallbackAssignee) {
        const parsed = parseAssignees(value);
        if (parsed.length) return parsed;
        const f = String(fallbackAssignee || '').trim();
        return f ? [f] : [];
    }

    function removeAssignerFromAssignees(list, assignerName) {
        const assigner = String(assignerName || '').trim().toLowerCase();
        return (Array.isArray(list) ? list : []).map(function (v) { return String(v || '').trim(); }).filter(function (name) {
            if (!name) return false;
            return !assigner || name.toLowerCase() !== assigner;
        });
    }

    function normalizeTask(raw, idx) {
        const out = {};
        const source = raw && typeof raw === 'object' ? raw : {};
        const keyMap = {};
        Object.keys(source).forEach(function (k) { keyMap[String(k).trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = source[k]; });
        TASK_COLUMNS.forEach(function (k) {
            const direct = source[k];
            if (direct != null) { out[k] = direct; return; }
            const alt = keyMap[String(k).toLowerCase().replace(/[^a-z0-9]/g, '')];
            out[k] = alt != null ? alt : '';
        });
        out.taskId = String(out.taskId || ('TASK-' + Date.now() + '-' + idx));
        out.parentId = String(out.parentId || '');
        out.sortOrder = Number(out.sortOrder || ((idx + 1) * 10));
        out.title = String(out.title || 'New Task');
        out.status = String(out.status || 'Not Started');
        out.priority = String(out.priority || 'Medium');
        out.percentComplete = Math.max(0, Math.min(100, Number(out.percentComplete || 0)));
        out.archived = String(out.archived).toLowerCase() === 'true' || out.archived === true;
        out.startDate = toISODate(out.startDate);
        out.dueDate = toISODate(out.dueDate);
        out.createdAt = out.createdAt || isoNow();
        out.updatedAt = out.updatedAt || isoNow();
        out.colorKey = String(out.colorKey || 'teal');
        const assigneeList = parseAssignees(out.assignees);
        out.assignees = removeAssignerFromAssignees(assigneeList, out.assigner);
        out.assignee = String((out.assignees[0] || '')).trim();
        out.assigneeTracks = '';
        if (!Array.isArray(out.checklistItems)) {
            try {
                const parsedChecklist = JSON.parse(String(out.checklistItems || '[]'));
                out.checklistItems = Array.isArray(parsedChecklist) ? parsedChecklist : [];
            } catch (_) {
                out.checklistItems = [];
            }
        }
        out.children = [];
        ensureTaskDates(out);
        return out;
    }


    function parseTaskRowsPayload(payload) {
        if (!payload) return [];

        if (typeof payload === 'string') {
            const text = payload.trim();
            if (!text) return [];
            try { return parseTaskRowsPayload(JSON.parse(text)); } catch (_) { return []; }
        }

        function keyNorm(v) {
            return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        function rowsToObjects(rows) {
            if (!Array.isArray(rows) || !rows.length) return [];
            const first = rows[0];
            if (!Array.isArray(first)) return rows;
            const headers = first.map(function (h) { return String(h || '').trim(); });
            const headerNorm = headers.map(keyNorm);
            const hasHeader = headerNorm.some(function (k) {
                return k === 'taskid' || k === 'title' || k === 'status' || k === 'duedate' || k === 'taskname';
            });
            if (!hasHeader) return rows;
            return rows.slice(1).map(function (row) {
                if (!Array.isArray(row)) return row;
                const out = {};
                headers.forEach(function (h, i) { out[h] = row[i]; });
                return out;
            });
        }

        if (Array.isArray(payload)) return rowsToObjects(payload);
        if (payload && typeof payload === 'object' && payload.task && typeof payload.task === 'object') return rowsToObjects([payload.task]);
        if (Array.isArray(payload.tasks)) return rowsToObjects(payload.tasks);
        if (Array.isArray(payload.rows)) return rowsToObjects(payload.rows);
        if (Array.isArray(payload.values)) return rowsToObjects(payload.values);
        if (payload.data && typeof payload.data === 'object') {
            if (Array.isArray(payload.data.tasks)) return rowsToObjects(payload.data.tasks);
            if (Array.isArray(payload.data.rows)) return rowsToObjects(payload.data.rows);
            if (Array.isArray(payload.data.values)) return rowsToObjects(payload.data.values);
            if (Array.isArray(payload.data.data)) return rowsToObjects(payload.data.data);
        }
        if (Array.isArray(payload.result)) return rowsToObjects(payload.result);
        if (payload.result && typeof payload.result === 'object') {
            if (Array.isArray(payload.result.tasks)) return rowsToObjects(payload.result.tasks);
            if (Array.isArray(payload.result.rows)) return rowsToObjects(payload.result.rows);
            if (Array.isArray(payload.result.values)) return rowsToObjects(payload.result.values);
            if (payload.result.data && typeof payload.result.data === 'object') {
                if (Array.isArray(payload.result.data.tasks)) return rowsToObjects(payload.result.data.tasks);
                if (Array.isArray(payload.result.data.rows)) return rowsToObjects(payload.result.data.rows);
                if (Array.isArray(payload.result.data.values)) return rowsToObjects(payload.result.data.values);
            }
        }
        return [];
    }


    async function fetchTasksViaHttp(url) {
        try {
            const resp = await fetch(url, { method: 'GET' });
            if (!resp.ok) return [];
            const text = await resp.text();
            if (!text) return [];
            try {
                return parseTaskRowsPayload(JSON.parse(text));
            } catch (_) {
                return parseTaskRowsPayload(text);
            }
        } catch (_) {
            return [];
        }
    }


    async function loadTasks() {
        state.loading = true;
        renderList();
        const webAppUrl = getWebAppUrl();
        const sheetId = getSheetId();
        if (!webAppUrl || !sheetId) {
            state.usingMock = true;
            state.tasks = [];
            state.loading = false;
            applyFilters();
            return;
        }

        try {
            const url = webAppUrl + '?action=tasksRead&sheetId=' + encodeURIComponent(sheetId) + '&tabName=tasks';
            let rows = [];
            try {
                const payload = await jsonp(url, 25000);
                rows = parseTaskRowsPayload(payload);
            } catch (_) {
                rows = [];
            }
            if (!rows.length) rows = await fetchTasksViaHttp(url);

            if (rows.length) {
                state.tasks = rows.map(normalizeTask);
                state.usingMock = false;
            } else {
                state.tasks = emptyFallbackTasks().map(normalizeTask);
                state.usingMock = true;
            }
        } catch (e) {
            console.warn('Task load failed, using empty fallback', e);
            state.usingMock = true;
            state.tasks = emptyFallbackTasks().map(normalizeTask);
        }

        state.loading = false;
        applyFilters();
    }


    function priorityRank(priority) {
        const p = String(priority || '').toLowerCase();
        if (p === 'critical') return 0;
        if (p === 'high') return 1;
        if (p === 'medium') return 2;
        if (p === 'low') return 3;
        return 4;
    }

    function taskComparator(a, b) {
        if (state.sortMode === 'name') return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }) || (a.sortOrder - b.sortOrder);
        if (state.sortMode === 'priority') return priorityRank(a.priority) - priorityRank(b.priority) || String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
        if (state.sortMode === 'assignee') return String(a.assignee || '').localeCompare(String(b.assignee || ''), undefined, { sensitivity: 'base' }) || String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
        return a.sortOrder - b.sortOrder;
    }

    function buildTree() {
        const byIdMap = {};
        state.tasks.forEach(function (t) { t.children = []; byIdMap[t.taskId] = t; });
        const roots = [];
        state.tasks.forEach(function (t) {
            if (t.parentId && byIdMap[t.parentId]) byIdMap[t.parentId].children.push(t);
            else roots.push(t);
        });

        function sortChildren(arr) {
            arr.sort(taskComparator);
            arr.forEach(function (child) { sortChildren(child.children); });
        }
        sortChildren(roots);
        return roots;
    }

    function flattenVisible(nodes, depth, out) {
        nodes.forEach(function (node) {
            out.push({ task: node, depth: depth });
            const expanded = state.expanded[node.taskId] !== false;
            if (node.children && node.children.length && expanded) flattenVisible(node.children, depth + 1, out);
        });
    }

    function hasFilteredDescendant(task) {
        if (!task.children || !task.children.length) return false;
        for (let i = 0; i < task.children.length; i++) {
            const child = task.children[i];
            if (state.filtered.some(function (f) { return f.taskId === child.taskId; }) || hasFilteredDescendant(child)) return true;
        }
        return false;
    }

    function applyFilters() {
        const q = (els.search.value || '').toLowerCase();
        const status = els.statusFilter.value;
        const assignee = els.assigneeFilter.value;
        const assigner = els.assignerFilter.value;
        const itemTerm = (els.itemFilter.value || '').toLowerCase();
        const locTerm = (els.locationFilter.value || '').toLowerCase();

        state.filtered = state.tasks.filter(function (task) {
            if (!state.showArchived && task.archived) return false;
            if (status !== 'all' && task.status !== status) return false;
            if (assignee !== 'all' && (!Array.isArray(task.assignees) || task.assignees.indexOf(assignee) === -1)) return false;
            if (assigner !== 'all' && String(task.assigner || '').trim() !== assigner) return false;
            const hay = [task.title, task.description, task.itemCode, task.itemName, task.location, task.sublocation].join(' ').toLowerCase();
            if (q && hay.indexOf(q) === -1) return false;
            if (itemTerm && (String(task.itemCode).toLowerCase().indexOf(itemTerm) === -1 && String(task.itemName).toLowerCase().indexOf(itemTerm) === -1)) return false;
            if (locTerm && (String(task.location).toLowerCase().indexOf(locTerm) === -1 && String(task.sublocation).toLowerCase().indexOf(locTerm) === -1)) return false;
            return true;
        });

        populateFilters();
        const roots = buildTree().filter(function (root) {
            return state.filtered.some(function (f) { return f.taskId === root.taskId; }) || hasFilteredDescendant(root);
        });

        const flat = [];
        flattenVisible(roots, 0, flat);
        state.flatRows = flat.filter(function (row) {
            return state.filtered.some(function (f) { return f.taskId === row.task.taskId; }) || hasFilteredDescendant(row.task);
        });

        syncFilterPanelUi();
        syncZoomOutUi();
        syncZoomModeButtons();
        syncShellLayout();
        renderList();
        renderPrintView();
        requestAnimationFrame(renderGantt);
    }

    function populateFilters() {
        const currentAssignee = els.assigneeFilter.value || 'all';
        const assignees = ['all'].concat(Array.from(new Set(state.tasks.reduce(function (acc, t) {
            return acc.concat(Array.isArray(t.assignees) ? t.assignees : []);
        }, []).filter(Boolean))).sort());
        const currentAssigner = els.assignerFilter.value || 'all';
        const assigners = ['all'].concat(Array.from(new Set(state.tasks.map(function (t) { return String(t.assigner || '').trim(); }).filter(Boolean))).sort());

        els.assigneeFilter.innerHTML = assignees.map(function (a) {
            return '<option value="' + esc(a) + '">' + esc(a === 'all' ? 'All Assignees' : a) + '</option>';
        }).join('');
        if (assignees.indexOf(currentAssignee) >= 0) els.assigneeFilter.value = currentAssignee;

        els.assignerFilter.innerHTML = assigners.map(function (a) {
            return '<option value="' + esc(a) + '">' + esc(a === 'all' ? 'All Assigners' : a) + '</option>';
        }).join('');
        if (assigners.indexOf(currentAssigner) >= 0) els.assignerFilter.value = currentAssigner;

        if (!els.statusFilter.options.length) {
            els.statusFilter.innerHTML = DEFAULT_STATUS.map(function (s) {
                return '<option value="' + esc(s) + '">' + esc(s === 'all' ? 'All Statuses' : s) + '</option>';
            }).join('');
        }

        byId('taskStatus').innerHTML = DEFAULT_STATUS.filter(function (s) { return s !== 'all'; }).map(function (s) {
            return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
        }).join('');

        byId('taskPriority').innerHTML = DEFAULT_PRIORITY.map(function (p) {
            return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
        }).join('');

        byId('taskColor').innerHTML = TASK_BADGE_COLORS.map(function (c) {
            return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>';
        }).join('');
    }
    function initialsForAssignee(assigneeName) {
        const parts = String(assigneeName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '—';
        const a = parts[0] ? parts[0][0] : '';
        const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (a + b).toUpperCase();
    }

    function assigneeStatusClass(task) {
        const s = String((task && task.status) || '').toLowerCase();
        if (s === 'in progress') return 'status-in-progress';
        if (s === 'blocked') return 'status-blocked';
        if (s === 'done') return 'status-done';
        return 'status-not-started';
    }

    function assigneeAvatarContent(task, assigneeName) {
        return esc(initialsForAssignee(assigneeName));
    }

    function assigneeStackForTask(task, avatarClass) {
        const assignerName = String(task.assigner || '').trim().toLowerCase();
        const assigneesRaw = Array.isArray(task.assignees) && task.assignees.length
            ? task.assignees.slice()
            : [task.assignee || 'Unassigned'];
        const assignees = assigneesRaw.filter(function (n) {
            const v = String(n || '').trim();
            if (!v) return false;
            if (assignerName && v.toLowerCase() === assignerName) return false;
            return true;
        });
        const progressPct = Math.max(0, Math.min(100, Number(taskProgressForBar(task) || 0)));
        const total = Math.max(1, assignees.length);
        const displayAssignees = assignees.length ? assignees : ['Unassigned'];
        return '<div class="task-assignee-stack" style="--avatar-count:' + displayAssignees.length + '" role="group" aria-label="Task assignees">' + displayAssignees.map(function (assigneeName, idx) {
            const avatar = assigneeAvatarContent(task, assigneeName);
            const assigneeKey = String(assigneeName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('assignee-' + idx);
            const fade = Math.max(0.16, 0.32 - (idx * 0.08));
            const fill = Math.max(0.42, 0.78 - (idx * (0.2 / total)));
            const shadow = Math.max(1, 3 - idx);
            return '<button class="task-assignee-avatar ' + avatarClass + '" style="--avatar-index:' + idx + ';--avatar-count:' + displayAssignees.length + ';--avatar-progress:' + progressPct + '%;--avatar-fill-alpha:' + fill.toFixed(2) + ';--avatar-back-alpha:' + fade.toFixed(2) + ';--avatar-shadow:0 ' + shadow + 'px ' + (shadow + 2) + 'px rgba(15,32,40,' + (0.2 - (idx * 0.04)).toFixed(2) + ')" type="button" data-assignee-open="' + esc(task.taskId) + '" data-assignee-key="' + esc(assigneeKey) + '" aria-label="Edit task assignee: ' + esc(assigneeName || 'Unassigned') + '" title="' + esc(assigneeName || 'Unassigned') + '">' + avatar + '</button>';
        }).join('') + '</div>';
    }

    function childSpanCountFromFlatIndex(flatIdx) {
        const row = state.flatRows[flatIdx];
        if (!row) return 1;
        const baseDepth = row.depth;
        let count = 1;
        for (let i = flatIdx + 1; i < state.flatRows.length; i++) {
            if (state.flatRows[i].depth <= baseDepth) break;
            count++;
        }
        return count;
    }

    function taskProgressForBar(task) {
        const kids = getChildTasks(task.taskId);
        if (!kids.length) return clamp(Number(task.percentComplete || 0), 0, 100);
        const stack = kids.slice();
        let sum = 0;
        let count = 0;
        while (stack.length) {
            const cur = stack.shift();
            sum += clamp(Number(cur.percentComplete || 0), 0, 100);
            count++;
            const descendants = getChildTasks(cur.taskId);
            for (let i = 0; i < descendants.length; i++) stack.push(descendants[i]);
        }
        return count ? Math.round(sum / count) : 0;
    }


    function isDoneStatus(task) {
        return String(task.status || '').toLowerCase() === 'done';
    }

    function openNewChildTaskFrom(parentTaskId) {
        const parent = state.tasks.find(function (t) { return t.taskId === parentTaskId; });
        state.editingId = null;
        openModal();
        if (!parent) return;
        byId('taskParentId').value = parent.taskId;
        byId('taskTitle').value = 'New child task';
        byId('taskStatus').value = 'Not Started';
        byId('taskPriority').value = parent.priority || 'Medium';
        syncPriorityToggleUi();
        byId('taskColor').value = parent.colorKey || 'teal';
        byId('taskAssignee').value = '';
        byId('taskAssigner').value = parent.assigner || '';
        byId('taskStartDate').value = parent.startDate || toISODate(new Date());
        byId('taskDueDate').value = parent.dueDate || shiftIsoDate(byId('taskStartDate').value, 1);
        byId('taskLocation').value = parent.location || '';
        byId('taskSublocation').value = parent.sublocation || '';
        byId('taskItemCode').value = parent.itemCode || '';
        byId('taskItemName').value = parent.itemName || '';
        autoSizeItemCodeInput(byId('taskItemName').value || byId('taskItemCode').value);
    }


    function renderPrintView() {
        const wrap = byId('tasksPrintView');
        if (!wrap) return;
        if (!state.printView) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        const rows = state.flatRows.map(function (r) {
            const t = r.task;
            return '<tr>' +
                '<td style="padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)">' + esc(t.title) + '</td>' +
                '<td style="padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)">' + esc(t.assignee || '') + '</td>' +
                '<td style="padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)">' + esc(t.status || '') + '</td>' +
                '<td style="padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)">' + esc(t.startDate || '') + '</td>' +
                '<td style="padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)">' + esc(t.dueDate || '') + '</td>' +
                '<td style="padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)">' + esc(t.location || '') + '</td>' +
            '</tr>';
        }).join('');
        wrap.innerHTML = '<div style="font-weight:800;margin-bottom:10px;">Printable Action Plan</div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
            '<thead><tr><th style="text-align:left;padding:6px;">Task</th><th style="text-align:left;padding:6px;">Assignee</th><th style="text-align:left;padding:6px;">Status</th><th style="text-align:left;padding:6px;">Start</th><th style="text-align:left;padding:6px;">Due</th><th style="text-align:left;padding:6px;">Location</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    function renderList() {
        if (state.loading) {
            els.listBody.innerHTML = '<div class="tasks-empty">Loading tasks…</div>';
            return;
        }
        if (!state.flatRows.length) {
            els.listBody.innerHTML = '<div class="tasks-empty">' + (state.tasks.length ? 'No tasks match the current filters.' : 'No current task. Click "+ Task" to add a new task.') + '</div>';
            return;
        }

        els.listBody.innerHTML = state.flatRows.map(function (row) {
            const task = row.task;
            const indent = row.depth * 14;
            const badge = getColorDef(task.colorKey).base;
            const connector = row.depth > 0 ? '<span class="task-connector anim" style="color:' + esc(badge) + '" aria-hidden="true"></span>' : '';
            const depthClass = 'depth-' + Math.min(3, row.depth);
            const avatarClass = assigneeStatusClass(task);
            const assigneeStack = assigneeStackForTask(task, avatarClass);
            const isFocused = String(state.focusTaskId || '') === String(task.taskId || '');
            return '<div class="tasks-row ' + depthClass + (isFocused ? ' active' : '') + '" data-task-id="' + esc(task.taskId) + '">' +
                '<button class="tree-toggle" data-toggle="' + esc(task.taskId) + '"></button>' +
                '<div class="task-title-wrap" style="padding-left:' + indent + 'px">' + connector + '<span class="task-title" title="' + esc(task.title) + '"><span class="task-color-badge" style="background:' + esc(badge) + '"></span>' + esc(task.title) + '</span></div>' +
                assigneeStack +
            '</div>';
        }).join('');
    }

    function computeRange(rows) {
        const anchor = toDate(state.currentAnchorDate) || new Date();
        let start = state.zoom === 'day' ? startOfDay(anchor) : (state.zoom === 'week' ? startOfWeek(anchor) : startOfMonth(anchor));
        let end;

        if (state.zoom === 'day') {
            end = new Date(start.getTime());
        } else if (state.zoom === 'week') {
            end = new Date(start.getTime() + (6 * DAY_MS));
        } else {
            end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
        }

        for (let i = 0; i < state.zoomOutLevel; i++) {
            start = shiftByMode(start, -1);
            if (state.zoom === 'day') end = shiftByMode(end, 1);
            else if (state.zoom === 'week') end = new Date(end.getTime() + (7 * DAY_MS));
            else end = new Date(end.getFullYear(), end.getMonth() + 1, 0);
        }

        return { start: start, end: end };
    }

    function getColorDef(key) {
        return TASK_BADGE_COLORS.find(function (c) { return c.key === key; }) || TASK_BADGE_COLORS[0];
    }

    function hexToRgb(hex) {
        const h = String(hex || '').replace('#', '');
        if (h.length !== 6) return { r: 42, g: 184, b: 173 };
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }

    function lighten(hex, amount) {
        const rgb = hexToRgb(hex);
        const mix = function (v) { return Math.round(v + (255 - v) * amount); };
        return 'rgb(' + mix(rgb.r) + ',' + mix(rgb.g) + ',' + mix(rgb.b) + ')';
    }

    function ganttColor(task, depth) {
        const base = getColorDef(task.colorKey).base;
        const start = depth > 0 ? lighten(base, 0.18) : base;
        const end = depth > 0 ? lighten(base, 0.34) : lighten(base, 0.12);
        return 'linear-gradient(135deg, ' + start + ', ' + end + ')';
    }

    function parseAssigneeTracks(value) {
        if (Array.isArray(value)) return value;
        const raw = String(value == null ? '' : value).trim();
        if (!raw || raw.charAt(0) !== '[') return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function buildTaskTracks(task) {
        const parsed = parseAssigneeTracks(task.assigneeTracks);
        let baseTracks = [];
        if (parsed.length) {
            baseTracks = parsed.map(function (it, idx) {
                const who = String((it && it.assignee) || '').trim() || ('Track ' + (idx + 1));
                return {
                    key: String((it && it.key) || (who + '-' + idx)),
                    assignee: who,
                    startDate: toISODate((it && it.startDate) || task.startDate),
                    dueDate: toISODate((it && it.dueDate) || task.dueDate)
                };
            });
        } else {
            const list = Array.isArray(task.assignees) && task.assignees.length
                ? task.assignees.slice()
                : [task.assignee || 'Unassigned'];
            baseTracks = list.map(function (name, idx) {
                const who = String(name || '').trim() || ('Track ' + (idx + 1));
                return { key: who + '-' + idx, assignee: who, startDate: task.startDate, dueDate: task.dueDate };
            });
        }

        const extraTracks = [];
        const checklistItems = Array.isArray(task.checklistItems) ? task.checklistItems : [];
        checklistItems.forEach(function (item, itemIdx) {
            if (item && item.done) return;
            const start = toISODate((item && item.startDate) || task.startDate);
            const due = toISODate((item && item.dueDate) || start || task.dueDate);
            if (!start || !due) return;
            const assigned = parseChecklistAssignees(item && item.assignees, '');
            assigned.forEach(function (name, idx) {
                extraTracks.push({ key: 'chk-' + itemIdx + '-' + idx, assignee: name, startDate: start, dueDate: due });
            });
        });

        if (state.drag && String(state.drag.taskId) === String(task.taskId) && state.drag.segmentKey) {
            const active = baseTracks.concat(extraTracks).find(function (track) { return String(track.key) === String(state.drag.segmentKey); });
            if (active) {
                active.startDate = task.startDate;
                active.dueDate = task.dueDate;
            }
        }

        return baseTracks.concat(extraTracks);
    }

    function normalizeTrackRecord(track, idx, fallbackStart, fallbackDue) {
        const who = String((track && track.assignee) || '').trim() || ('Track ' + (idx + 1));
        const start = toISODate((track && track.startDate) || fallbackStart);
        const due = toISODate((track && track.dueDate) || fallbackDue || start);
        const key = String((track && track.key) || (who + '-' + idx));
        return { key: key, assignee: who, startDate: start, dueDate: due };
    }

    function serializeTracksForInput(tracks) {
        return (Array.isArray(tracks) ? tracks : []).map(function (t) {
            return [t.assignee, t.startDate, t.dueDate].join(' | ');
        }).join('\n');
    }

    function parseTracksFromInput(raw, fallbackStart, fallbackDue) {
        const text = String(raw || '').trim();
        if (!text) return [];
        const lines = text.split(/\n+/).map(function (line) { return String(line || '').trim(); }).filter(Boolean);
        const out = [];
        lines.forEach(function (line, idx) {
            const parts = line.split('|').map(function (p) { return String(p || '').trim(); });
            if (!parts[0]) return;
            out.push(normalizeTrackRecord({
                assignee: parts[0],
                startDate: parts[1] || fallbackStart,
                dueDate: parts[2] || parts[1] || fallbackDue || fallbackStart
            }, idx, fallbackStart, fallbackDue));
        });
        return out;
    }

    function writeTracksToModalFromTask(task) {
        const el = byId('taskAssigneeTracks');
        if (!el) return;
        const tracks = buildTaskTracks(task || {
            assigneeTracks: '',
            assignees: parseAssignees(byId('taskAssignee').value),
            assignee: byId('taskAssignee').value,
            startDate: byId('taskStartDate').value,
            dueDate: byId('taskDueDate').value
        });
        el.value = serializeTracksForInput(tracks);
    }

    function modalTracksToPayload(payload, preferredAssignees) {
        const preferred = Array.isArray(preferredAssignees) ? preferredAssignees.map(function (v) { return String(v || '').trim(); }).filter(Boolean) : [];
        const tracksEl = byId('taskAssigneeTracks');
        const tracks = parseTracksFromInput(tracksEl ? tracksEl.value : '', payload.startDate, payload.dueDate);
        if (!tracks.length) {
            payload.assigneeTracks = '';
            if (preferred.length) {
                payload.assignees = serializeAssignees(preferred);
                payload.assignee = preferred[0] || payload.assignee;
            }
            return;
        }
        const normalized = tracks.map(function (track, idx) { return normalizeTrackRecord(track, idx, payload.startDate, payload.dueDate); });
        payload.assigneeTracks = JSON.stringify(normalized);
        const assigneesFromTracks = Array.from(new Set(normalized.map(function (t) { return t.assignee; }).filter(Boolean)));
        const combined = Array.from(new Set(preferred.concat(assigneesFromTracks)));
        if (combined.length) {
            payload.assignees = serializeAssignees(combined);
            payload.assignee = preferred[0] || combined[0] || payload.assignee;
        }
        syncTaskDateEnvelopeFromTracks(payload, normalized);
    }

    function syncChecklistAssigneesWithTask(assigneeList) {
        let changed = false;
        for (let i = 0; i < state.checklistDraft.length; i++) {
            const item = state.checklistDraft[i];
            if (!item) continue;
            const existing = parseChecklistAssignees(item.assignees, '');
            const normalized = removeAssignerFromAssignees(existing, getChecklistAssignerName());
            if (serializeAssignees(existing) !== serializeAssignees(normalized)) {
                item.assignees = serializeAssignees(normalized);
                changed = true;
            }
        }
        if (changed) {
            syncEditingTaskChecklistToState();
            renderChecklistDraft();
        }
    }

    function buildTracksByMode(mode) {
        const assignees = parseAssignees(byId('taskAssignee').value);
        const baseStart = toDate(byId('taskStartDate').value) || new Date();
        const baseDue = toDate(byId('taskDueDate').value) || new Date(baseStart.getTime());
        const days = Math.max(0, Math.floor((startOfDay(baseDue) - startOfDay(baseStart)) / DAY_MS));
        if (!assignees.length) return [];
        if (mode === 'equal') {
            const tracks = [];
            const slots = Math.max(1, assignees.length);
            for (let i = 0; i < assignees.length; i++) {
                const slotStart = Math.floor((days + 1) * (i / slots));
                const slotEnd = Math.max(slotStart, Math.floor((days + 1) * ((i + 1) / slots)) - 1);
                tracks.push(normalizeTrackRecord({
                    assignee: assignees[i],
                    startDate: toISODate(new Date(baseStart.getTime() + (slotStart * DAY_MS))),
                    dueDate: toISODate(new Date(baseStart.getTime() + (slotEnd * DAY_MS)))
                }, i, byId('taskStartDate').value, byId('taskDueDate').value));
            }
            return tracks;
        }
        if (mode === 'handoff') {
            const tracks = [];
            let cursor = new Date(baseStart.getTime());
            const segmentDays = Math.max(1, Math.ceil((days + 1) / Math.max(1, assignees.length)));
            for (let i = 0; i < assignees.length; i++) {
                const segStart = new Date(cursor.getTime());
                const segEnd = (i === assignees.length - 1)
                    ? new Date(baseDue.getTime())
                    : new Date(segStart.getTime() + ((segmentDays - 1) * DAY_MS));
                tracks.push(normalizeTrackRecord({ assignee: assignees[i], startDate: toISODate(segStart), dueDate: toISODate(segEnd) }, i, byId('taskStartDate').value, byId('taskDueDate').value));
                cursor = new Date(segEnd.getTime() + DAY_MS);
                if (cursor > baseDue) cursor = new Date(baseDue.getTime());
            }
            return tracks;
        }
        return assignees.map(function (name, idx) {
            return normalizeTrackRecord({ assignee: name, startDate: byId('taskStartDate').value, dueDate: byId('taskDueDate').value }, idx, byId('taskStartDate').value, byId('taskDueDate').value);
        });
    }

    function syncTaskDateEnvelopeFromTracks(task, tracks) {
        if (!tracks || !tracks.length) return;
        let minStart = null;
        let maxDue = null;
        for (let i = 0; i < tracks.length; i++) {
            const s = toDate(tracks[i].startDate);
            const d = toDate(tracks[i].dueDate);
            if (!s || !d) continue;
            if (!minStart || s < minStart) minStart = s;
            if (!maxDue || d > maxDue) maxDue = d;
        }
        if (minStart && maxDue) {
            task.startDate = toISODate(minStart);
            task.dueDate = toISODate(maxDue);
        }
    }

    function assigneeTrackColor(task, depth, assignee) {
        const palette = ['#2ab8ad', '#4f8ef7', '#8b6cf0', '#f39a45', '#38c172', '#e66f97'];
        const seed = String(assignee || 'track');
        let h = 0;
        for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
        const base = palette[Math.abs(h) % palette.length] || getColorDef(task.colorKey).base;
        const start = depth > 0 ? lighten(base, 0.12) : base;
        const end = depth > 0 ? lighten(base, 0.28) : lighten(base, 0.1);
        return 'linear-gradient(135deg, ' + start + ', ' + end + ')';
    }

    function buildTaskTimelineSegments(task, range, maxUnit) {
        const rangeStartUnit = state.zoom === 'month'
            ? ((range.start.getFullYear() * 12) + range.start.getMonth())
            : 0;
        const toUnit = function (date) {
            if (state.zoom === 'month') return ((date.getFullYear() * 12) + date.getMonth()) - rangeStartUnit;
            return Math.floor((date - range.start) / DAY_MS);
        };
        const tracks = buildTaskTracks(task);
        const segments = tracks.map(function (track, idx) {
            const sDate = toDate(track.startDate);
            const dDate = toDate(track.dueDate);
            const startUnit = sDate ? toUnit(sDate) : 0;
            const endUnit = dDate ? toUnit(dDate) : startUnit;
            const overlapStart = Math.max(0, startUnit);
            const overlapEnd = Math.min(maxUnit, endUnit);
            return {
                key: track.key,
                assignee: track.assignee,
                trackIndex: idx,
                totalTracks: tracks.length,
                startDate: track.startDate,
                dueDate: track.dueDate,
                startUnit: startUnit,
                endUnit: endUnit,
                overlapStart: overlapStart,
                overlapEnd: overlapEnd,
                visible: overlapStart <= overlapEnd
            };
        });

        const coverage = new Array(maxUnit + 1).fill(0);
        for (let s = 0; s < segments.length; s++) {
            if (!segments[s].visible) continue;
            for (let u = segments[s].overlapStart; u <= segments[s].overlapEnd; u++) coverage[u] += 1;
        }
        const overlaps = [];
        let runStart = -1;
        for (let u = 0; u <= maxUnit; u++) {
            if (coverage[u] > 1 && runStart < 0) runStart = u;
            if ((coverage[u] <= 1 || u === maxUnit) && runStart >= 0) {
                const runEnd = (coverage[u] <= 1) ? (u - 1) : u;
                if (runEnd >= runStart) overlaps.push({ startUnit: runStart, endUnit: runEnd });
                runStart = -1;
            }
        }

        const overlapAssignees = tracks.map(function (t) { return t.assignee; }).filter(Boolean).join(' + ');
        return { segments: segments, overlaps: overlaps, hasMultipleTracks: tracks.length > 1, overlapAssignees: overlapAssignees };
    }

    function renderGantt() {
        const rows = state.flatRows;
        if (!rows.length) {
            els.ganttWrap.innerHTML = '<div class="tasks-empty">' + (state.tasks.length ? 'No tasks match the current filters.' : 'No current task. Click "+ Task" to add a new task.') + '</div>';
            return;
        }

        const range = computeRange(rows);
        const days = Math.max(1, Math.ceil((range.end - range.start) / DAY_MS) + 1);
        state.range = range;

        const cols = [];
        if (state.zoom === 'month') {
            const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
            while (cursor <= range.end) {
                cols.push(new Date(cursor));
                cursor.setMonth(cursor.getMonth() + 1);
            }
        } else {
            for (let i = 0; i < days; i++) {
                const dt = new Date(range.start.getTime() + (i * DAY_MS));
                cols.push(dt);
            }
        }

        function weekIndexFrom(date) {
            const startMonday = new Date(range.start);
            const startOffset = (startMonday.getDay() + 6) % 7;
            startMonday.setDate(startMonday.getDate() - startOffset);
            return Math.floor((date - startMonday) / DAY_MS / 7);
        }

        const availableWidth = Math.max(320, (els.ganttWrap.clientWidth || 960) - 64);
        const colPx = Math.max(28, Math.floor(availableWidth / Math.max(cols.length, 1)));
        state.colPx = colPx;
        const gridCols = 'repeat(' + cols.length + ',' + colPx + 'px)';
        function cellClassForDate(d) {
            const day = d.getDay();
            const isWeekend = day === 0 || day === 6;
            const today = new Date();
            let isToday = false;
            if (state.zoom === 'month') isToday = (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth());
            else isToday = (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate());
            return (isWeekend ? ' weekend-cell' : '') + (isToday ? ' today-cell' : '');
        }

        const monthHead = '<div class="gantt-head" style="grid-template-columns:' + gridCols + '">' + cols.map(function (d) {
            let monthLabel = '';
            if (state.zoom === 'month') monthLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            else if (state.zoom === 'day') monthLabel = String(d.getDate()).padStart(2, '0');
            else if (d.getDate() === 1) monthLabel = d.toLocaleString('en-US', { month: 'short' });
            return '<div class="gantt-cell month-marker' + cellClassForDate(d) + '">' + esc(monthLabel) + '</div>';
        }).join('') + '</div>';

        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const axisHead = '<div class="gantt-head" style="grid-template-columns:' + gridCols + '">' + cols.map(function (d) {
            let label = '';
            if (state.zoom === 'day') label = dayNames[d.getDay()];
            else if (state.zoom === 'week') label = String(d.getDate()).padStart(2, '0');
            else label = d.toLocaleString('en-US', { month: 'short' });
            return '<div class="gantt-cell' + cellClassForDate(d) + '">' + esc(label) + '</div>';
        }).join('') + '</div>';

        const today = new Date();
        today.setHours(0,0,0,0);
        const body = rows.map(function (row, rowIdx) {
            const t = row.task;
            const sDate = toDate(t.startDate);
            const dDate = toDate(t.dueDate);
            let overdueShade = '';
            let bar = '';
            if (sDate && dDate) {
                const rangeStartUnit = state.zoom === 'month'
                    ? ((range.start.getFullYear() * 12) + range.start.getMonth())
                    : 0;
                const toUnit = function (date) {
                    if (state.zoom === 'month') return ((date.getFullYear() * 12) + date.getMonth()) - rangeStartUnit;
                    return Math.floor((date - range.start) / DAY_MS);
                };
                const startUnit = toUnit(sDate);
                const endUnit = toUnit(dDate);
                const maxUnit = cols.length - 1;
                const overlapStart = Math.max(0, startUnit);
                const overlapEnd = Math.min(maxUnit, endUnit);

                if (!isDoneStatus(t) && dDate < today) {
                    const overdueStartUnit = Math.max(0, Math.min(maxUnit, endUnit + 1));
                    const todayUnit = state.zoom === 'month'
                        ? ((today.getFullYear() * 12) + today.getMonth()) - rangeStartUnit
                        : Math.floor((today - range.start) / DAY_MS);
                    const overdueEndUnit = Math.max(0, Math.min(maxUnit, todayUnit));
                    if (overdueStartUnit <= overdueEndUnit) {
                        const oLeft = overdueStartUnit * colPx;
                        const oWidth = Math.max(10, ((overdueEndUnit - overdueStartUnit + 1) * colPx) - 2);
                        overdueShade = '<div class="gantt-overdue" style="left:' + oLeft + 'px;width:' + oWidth + 'px"></div>';
                    }
                }
                const barShadow = row.depth > 0 ? '0 2px 8px rgba(17, 153, 142, 0.12)' : '0 4px 12px rgba(17, 153, 142, 0.18)';
                const progressPct = taskProgressForBar(t);
                const timeline = buildTaskTimelineSegments(t, range, maxUnit);
                if (overlapStart <= overlapEnd) {
                    const left = overlapStart * colPx;
                    const widthUnits = Math.max(1, overlapEnd - overlapStart + 1);
                    const width = Math.max(18, (widthUnits * colPx) - 6);
                    const cascade = timeline.hasMultipleTracks
                        ? '<span class="gantt-bar-cascade back" style="background:' + ganttColor(t, row.depth) + ';"></span><span class="gantt-bar-cascade" style="background:' + ganttColor(t, row.depth) + ';"></span>'
                        : '';
                    bar = '<div class="gantt-bar ' + (t.priority === 'High' || t.priority === 'Critical' ? 'priority-high' : '') + '" data-task-id="' + esc(t.taskId) + '" data-drag-type="move" style="left:' + left + 'px;width:' + width + 'px;background:' + ganttColor(t, row.depth) + ';box-shadow:' + barShadow + '">' +
                        cascade +
                        '<span class="gantt-label">' + esc(t.title) + '</span>' +
                        '<span class="gantt-progress" style="width:' + (progressPct > 0 ? Math.max(progressPct, 3) : 0) + '%"></span>' +
                        '<button class="gantt-child-btn" type="button" data-task-child="' + esc(t.taskId) + '" aria-label="Add child task">+</button>' +
                        '<button class="gantt-menu-btn" type="button" data-task-menu="' + esc(t.taskId) + '" aria-label="Open task">⋯</button>' +
                        '<span class="gantt-handle left" data-task-id="' + esc(t.taskId) + '" data-drag-type="start"></span>' +
                        '<span class="gantt-handle right" data-task-id="' + esc(t.taskId) + '" data-drag-type="end"></span>' +
                    '</div>';
                } else if (timeline.hasMultipleTracks) {
                    bar = timeline.overlaps.map(function (ov) {
                        const left = ov.startUnit * colPx;
                        const widthUnits = Math.max(1, ov.endUnit - ov.startUnit + 1);
                        const width = Math.max(8, (widthUnits * colPx) - 6);
                        return '<button class="gantt-bar-composite" type="button" data-composite-task-id="' + esc(t.taskId) + '" title="Overlap: ' + esc(timeline.overlapAssignees || 'multiple assignees') + '" style="left:' + left + 'px;width:' + width + 'px"></button>';
                    }).join('');
                } else {
                    const stubWidth = Math.max(20, Math.round(colPx * 0.9));
                    if (endUnit < 0) {
                        bar = '<div class="gantt-bar out-of-range left" data-task-id="' + esc(t.taskId) + '" data-drag-type="move" style="left:2px;width:' + stubWidth + 'px">' + esc(t.title) + '</div>';
                    } else if (startUnit > maxUnit) {
                        const leftEdge = Math.max(2, (maxUnit * colPx) - stubWidth + colPx - 4);
                        bar = '<div class="gantt-bar out-of-range right" data-task-id="' + esc(t.taskId) + '" data-drag-type="move" style="left:' + leftEdge + 'px;width:' + stubWidth + 'px">' + esc(t.title) + '</div>';
                    }
                }
            }
            const focusClass = String(state.focusTaskId || '') === String(t.taskId || '') ? ' focus-task' : '';
            return '<div class="gantt-row' + focusClass + '" data-row-index="' + rowIdx + '" data-task-id="' + esc(t.taskId) + '" data-parent-id="' + esc(t.parentId || '') + '" style="grid-template-columns:' + gridCols + '">' + cols.map(function (d) {
                return '<div class="gantt-cell' + cellClassForDate(d) + '"></div>';
            }).join('') + overdueShade + bar + '</div>';
        }).join('');

        els.ganttWrap.innerHTML = '<div id="tasksDeleteZone" class="gantt-delete-zone" aria-hidden="true">🗑</div>' + '<button id="tasksPrevRange" class="timeline-nav-arrow left" type="button" aria-label="Previous period">‹</button>' + '<button id="tasksNextRange" class="timeline-nav-arrow right" type="button" aria-label="Next period">›</button>' + monthHead + axisHead + body;

        const prevBtn = els.ganttWrap.querySelector('#tasksPrevRange');
        const nextBtn = els.ganttWrap.querySelector('#tasksNextRange');
        const tableHeight = (2 * 34) + (rows.length * 44);
        const navTop = Math.max(56, Math.min(Math.round(tableHeight / 2), (els.ganttWrap.clientHeight || tableHeight) - 18));
        if (prevBtn) prevBtn.style.top = navTop + 'px';
        if (nextBtn) nextBtn.style.top = navTop + 'px';
        const heads = els.ganttWrap.querySelectorAll('.gantt-head');
        let headH = 0;
        for (let i = 0; i < heads.length; i++) headH += Math.round(heads[i].getBoundingClientRect().height || 0);
        if (els.listGap) els.listGap.style.height = '0px';
        if (els.listBody && els.ganttWrap) els.ganttWrap.scrollTop = els.listBody.scrollTop;
    }



    function checklistProgressList() { return ['Not Started', 'In Progress', 'Blocked', 'Done']; }

    function checklistStatusClass(status) {
        const s = String(status || '').toLowerCase();
        if (s === 'done') return 'status-done';
        if (s === 'in progress') return 'status-in-progress';
        if (s === 'blocked') return 'status-blocked';
        return 'status-not-started';
    }

    function normalizeChecklistStatus(status, done) {
        const raw = String(status || '').trim();
        if (raw) return raw;
        return done ? 'Done' : 'Not Started';
    }

    function getChecklistAssignerName() {
        return String((byId('taskAssigner') && byId('taskAssigner').value) || '').trim();
    }

    function syncChecklistAssignerBadges(previousValue, nextValue) {
        const prev = String(previousValue || '').trim();
        const next = String(nextValue || '').trim();
        if (!Array.isArray(state.checklistDraft) || !state.checklistDraft.length) return;
        state.checklistDraft.forEach(function (item) {
            if (!item) return;
            const names = parseChecklistAssignees(item.assignees, prev);
            if (!names.length) {
                item.assignees = serializeAssignees(next ? [next] : []);
                return;
            }
            if (names.length === 1 && (!prev || names[0] === prev)) {
                item.assignees = serializeAssignees(next ? [next] : []);
            }
        });
    }

    async function persistChecklistForTask(taskId) {
        if (!taskId) return;
        ensureChecklistItemIds();
        const assignerName = getChecklistAssignerName();
        const checklistPayload = state.checklistDraft.map(function (item) {
            const cleanAssignees = removeAssignerFromAssignees(parseChecklistAssignees(item && item.assignees, ''), assignerName);
            return {
                itemId: String(item.itemId || ''),
                done: !!item.done,
                text: item.text || '',
                assignees: serializeAssignees(cleanAssignees),
                startDate: item.startDate || '',
                dueDate: item.dueDate || '',
                handoffMode: item.handoffMode || '',
                progressStatus: normalizeChecklistStatus(item.progressStatus, item.done)
            };
        });
        const sig = JSON.stringify(checklistPayload);
        if (state.checklistPersistMemoByTask[taskId] === sig) return;
        try {
            await writeTask('saveChecklist', { taskId: taskId, items: checklistPayload });
            state.checklistPersistMemoByTask[taskId] = sig;
        } catch (err) {
            throw err;
        }
        const savedTask = state.tasks.find(function (t) { return t.taskId === taskId; });
        if (savedTask) savedTask.checklistItems = checklistPayload;
    }

    function checklistOverallProgressStatus(items) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return 'Not Started';
        const statuses = list.map(function (it) { return String((it && it.progressStatus) || (it && it.done ? 'Done' : 'Not Started')); });
        if (statuses.indexOf('Done') >= 0) return 'Done';
        if (statuses.indexOf('Not Started') >= 0) return 'Not Started';
        if (statuses.indexOf('In Progress') >= 0) return 'In Progress';
        if (statuses.indexOf('Blocked') >= 0) return 'Blocked';
        return 'Not Started';
    }

    function syncChecklistMasterDates() {
        if (!Array.isArray(state.checklistDraft) || !state.checklistDraft.length) return;
        const ms = byId('taskStartDate');
        const me = byId('taskDueDate');
        if (!ms || !me) return;
        const start = ms.value || '';
        const due = me.value || start || '';
        let earliest = '';
        let latest = '';
        state.checklistDraft.forEach(function (item) {
            if (!item) return;
            if (start && (!item.startDate || item.startDate < start)) item.startDate = start;
            if (due && item.startDate && item.startDate > due) item.startDate = due;
            if (!item.dueDate || (start && item.dueDate < start)) item.dueDate = start || item.dueDate;
            if (due && item.dueDate > due) item.dueDate = due;
            if (!earliest || (item.startDate && item.startDate < earliest)) earliest = item.startDate;
            if (!latest || (item.dueDate && item.dueDate > latest)) latest = item.dueDate;
        });
    }

    function openChecklistProgressMenu(idx, anchor, assigneeName) {
        const menu = byId('checklistProgressMenu');
        if (!menu || !anchor) return;
        const item = state.checklistDraft[idx] || {};
        const current = normalizeChecklistStatus(item.progressStatus, item.done);
        const targetAssignee = String(assigneeName || '').trim();
        const progressButtons = checklistProgressList().map(function (status) {
            return '<button class="checklist-progress-btn" type="button" data-progress-status="' + esc(status) + '" data-progress-idx="' + idx + '">' + (status === current ? '✓ ' : '') + esc(status) + '</button>';
        });
        if (targetAssignee) {
            progressButtons.unshift('<button class="checklist-progress-btn unassign" type="button" data-progress-action="unassign" data-progress-idx="' + idx + '" data-progress-assignee="' + esc(targetAssignee) + '">Unassign</button>');
        }
        menu.innerHTML = progressButtons.join('');
        const r = anchor.getBoundingClientRect();
        menu.style.left = Math.round(r.left) + 'px';
        menu.style.top = Math.round(r.bottom + 6) + 'px';
        menu.classList.add('open');
    }

    function closeChecklistProgressMenu() {
        const menu = byId('checklistProgressMenu');
        if (menu) menu.classList.remove('open');
    }

    function checklistTextKey(item) {
        return String((item && item.text) || '').trim().toLowerCase();
    }

    function checklistItemKey(item, idx) {
        const itemId = String((item && item.itemId) || '').trim();
        if (itemId) return itemId;
        const textKey = checklistTextKey(item);
        return textKey ? ('legacy-text:' + textKey) : ('legacy-idx:' + idx);
    }

    function ensureChecklistItemIds() {
        let maxId = 0;
        state.checklistDraft.forEach(function (item) {
            const raw = String((item && item.itemId) || '').trim();
            const n = Number(raw);
            if (raw && Number.isFinite(n)) maxId = Math.max(maxId, n);
        });
        state.checklistDraft.forEach(function (item) {
            if (!item) return;
            const raw = String(item.itemId || '').trim();
            if (raw) return;
            maxId += 1;
            item.itemId = String(maxId);
        });
    }

    function visibleChecklistIndexes() {
        const visible = [];
        const seenKeys = {};
        for (let i = 0; i < state.checklistDraft.length; i++) {
            const item = state.checklistDraft[i];
            if (!item) continue;
            if (String(item.handoffMode || '') === 'handoff') continue;
            const key = checklistItemKey(item, i);
            if (seenKeys[key]) continue;
            seenKeys[key] = true;
            visible.push(i);
        }
        return visible;
    }

    function buildChecklistAssigneeStages(idx, item, assignerName) {
        const stages = [];
        const seen = {};

        function addStage(list) {
            const names = (Array.isArray(list) ? list : []).map(function (n) { return String(n || '').trim(); }).filter(Boolean);
            if (!names.length) return;
            const key = names.join('|').toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            stages.push(names);
        }

        const base = parseChecklistAssignees(item && item.assignees, '').filter(function (n) {
            return String(n || '').trim() && String(n || '').trim() !== assignerName;
        });
        addStage(base);

        const key = checklistItemKey(item, idx);
        for (let i = idx + 1; i < state.checklistDraft.length; i++) {
            const next = state.checklistDraft[i];
            if (!next || String(next.handoffMode || '') !== 'handoff') continue;
            if (checklistItemKey(next, i) !== key) continue;
            addStage(parseChecklistAssignees(next.assignees, '').filter(function (n) {
                return String(n || '').trim() && String(n || '').trim() !== assignerName;
            }));
        }
        return stages;
    }


    function renderChecklistDraft() {
        const wrap = byId('taskChecklistRows');
        const panel = byId('taskChecklistPanel');
        if (!wrap) return;
        if (panel) panel.classList.toggle('loading', !!state.checklistLoading);
        if (state.checklistLoading) {
            wrap.innerHTML = '<div class="tasks-empty" style="padding:8px 6px;">Loading checklist…</div>';
            return;
        }
        if (!state.checklistDraft.length) {
            state.checklistDraft = [{ done: false, selected: false, text: '', assignees: '', progressStatus: 'Not Started', itemId: '' }];
        }
        const renderIndexes = visibleChecklistIndexes();
        const selectedCount = state.checklistDraft.filter(function (it) { return !!(it && it.selected); }).length;
        const selectedRows = state.checklistDraft.filter(function (it) { return !!(it && it.selected); });
        const indexPos = {};
        renderIndexes.forEach(function (idx, pos) { indexPos[idx] = pos; });
        const canHandoff = selectedRows.length > 0 && selectedRows.every(function (it) { return hasChecklistAssignees(it); }) && selectedChecklistIndexes().every(function (idx) {
            const pos = Object.prototype.hasOwnProperty.call(indexPos, idx) ? indexPos[idx] : -1;
            if (pos < 0) return false;
            if (pos === 0) return true;
            const prev = state.checklistDraft[renderIndexes[pos - 1]];
            return hasChecklistAssignees(prev);
        });
        const title = panel ? panel.querySelector('.task-checklist-title') : null;
        if (title) title.setAttribute('data-selected-count', String(selectedCount));
        ['taskChecklistDelete','taskChecklistDone','taskChecklistCollaborate'].forEach(function (id) {
            const btn = byId(id);
            if (btn) btn.disabled = selectedCount < 1;
        });
        const handoffBtn = byId('taskChecklistHandoff');
        if (handoffBtn) handoffBtn.disabled = !canHandoff;

        wrap.innerHTML = renderIndexes.map(function (idx) {
            const item = state.checklistDraft[idx];
            const badges = [];
            const progressStatus = normalizeChecklistStatus(item && item.progressStatus, item && item.done);
            const statusCls = checklistStatusClass(progressStatus);
            const assignerName = getChecklistAssignerName();
            const assigneeStages = buildChecklistAssigneeStages(idx, item, assignerName);
            const assigned = assigneeStages.length ? assigneeStages[0] : [];
            if (assignerName) {
                badges.push('<button type="button" class="checklist-badge assignee assigner" data-check-progress-idx="' + idx + '">' + esc(assignerName) + '</button>');
                badges.push('<svg class="checklist-handoff-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:' + (assigned.length ? '1' : '0.35') + ';"><circle cx="8" cy="8" r="3"></circle><path d="M3 18c0-2.8 2.2-4.8 5-4.8"></path><path d="M11.5 12h8"></path><path d="M16.5 9l3 3-3 3"></path></svg>');
            }
            assigneeStages.forEach(function (stage, stageIdx) {
                if (stageIdx > 0) {
                    badges.push('<svg class="checklist-assign-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h13"></path><path d="M13 7l5 5-5 5"></path></svg>');
                }
                stage.forEach(function (name) {
                    badges.push('<button type="button" class="checklist-badge assignee ' + statusCls + '" data-check-progress-idx="' + idx + '" data-check-assignee="' + esc(name) + '">' + esc(name) + '</button>');
                });
            });
            if (item && item.done) badges.push('<span class="checklist-badge done"><svg class="checklist-done-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"></path></svg></span>');
            return '<div class="checklist-row">' +
                '<input type="checkbox" data-check-select-idx="' + idx + '" ' + (item && item.selected ? 'checked' : '') + ' />' +
                '<div class="checklist-item-main">' +
                    '<input class="tasks-input" data-check-text-idx="' + idx + '" placeholder="Checklist item" value="' + esc(item.text || '') + '" />' +
                    '<div class="checklist-badges">' + badges.join('') + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }


    function syncChecklistDraftFromUi() {
        const wrap = byId('taskChecklistRows');
        if (!wrap) return;
        const next = state.checklistDraft.map(function (item) {
            return item ? {
                done: !!item.done,
                selected: !!item.selected,
                text: item.text || '',
                assignees: item.assignees || '',
                startDate: item.startDate || '',
                dueDate: item.dueDate || '',
                handoffMode: item.handoffMode || '',
                progressStatus: item.progressStatus || (item.done ? 'Done' : 'Not Started'),
                itemId: String(item.itemId || '')
            } : null;
        }).filter(Boolean);
        const rows = wrap.querySelectorAll('.checklist-row');
        for (let i = 0; i < rows.length; i++) {
            const cb = rows[i].querySelector('input[type="checkbox"]');
            const tx = rows[i].querySelector('input[data-check-text-idx]');
            const idx = Number(tx ? tx.getAttribute('data-check-text-idx') : NaN);
            if (!Number.isFinite(idx) || !next[idx]) continue;
            const text = String((tx && tx.value) || '').trim();
            const prev = next[idx] || {};
            next[idx] = {
                done: !!prev.done,
                selected: !!(cb && cb.checked),
                text: text,
                assignees: prev.assignees || '',
                startDate: prev.startDate || '',
                dueDate: prev.dueDate || '',
                handoffMode: prev.handoffMode || '',
                progressStatus: prev.progressStatus || (prev.done ? 'Done' : 'Not Started'),
                itemId: String(prev.itemId || '')
            };
        }
        state.checklistDraft = next.filter(function (item) {
            if (!item) return false;
            if (String(item.handoffMode || '') === 'handoff') return true;
            return !!(String(item.text || '').trim()) || !!item.done || !!item.selected;
        });
        syncEditingTaskChecklistToState();
    }


    function parseAssigneeInputList(raw) {
        return parseAssignees(String(raw || '').replace(/\n/g, ',').replace(/\|/g, ','));
    }

    function hasChecklistAssignees(item) {
        return parseChecklistAssignees(item && item.assignees, '').length > 0;
    }

    function selectedChecklistIndexes() {
        const out = [];
        for (let i = 0; i < state.checklistDraft.length; i++) {
            if (state.checklistDraft[i] && state.checklistDraft[i].selected) out.push(i);
        }
        return out;
    }

    function syncEditingTaskChecklistToState() {
        if (!state.editingId) return;
        const task = state.tasks.find(function (t) { return t.taskId === state.editingId; });
        if (!task) return;
        task.checklistItems = state.checklistDraft.map(function (item) {
            return {
                itemId: String(item.itemId || ''),
                done: !!item.done,
                text: item.text || '',
                assignees: item.assignees || '',
                startDate: item.startDate || '',
                dueDate: item.dueDate || '',
                handoffMode: item.handoffMode || '',
                progressStatus: item.progressStatus || (item.done ? 'Done' : 'Not Started')
            };
        });
    }

    function applyChecklistSelectionAction(action) {
        syncChecklistDraftFromUi();
        const indexes = selectedChecklistIndexes();
        if (!indexes.length) return;
        if (action === 'delete') {
            if (!window.confirm('Delete selected checklist item(s)?')) return;
            state.checklistDraft = state.checklistDraft.filter(function (item) { return !item.selected; });
        } else if (action === 'done') {
            indexes.forEach(function (idx) {
                state.checklistDraft[idx].done = true;
                state.checklistDraft[idx].progressStatus = 'Done';
                state.checklistDraft[idx].selected = false;
            });
        }
        if (!state.checklistDraft.length) state.checklistDraft = [{ done: false, selected: false, text: '', progressStatus: 'Not Started', itemId: '' }];
        syncEditingTaskChecklistToState();
        syncChecklistMasterDates();
        renderChecklistDraft();
        queueRenderGantt();
        if (state.editingId) { persistChecklistForTask(state.editingId); queueModalAutosave(); }
    }

    function openChecklistAssignMenu(mode) {
        syncChecklistDraftFromUi();
        if (!selectedChecklistIndexes().length) return;
        state.checklistAssignMode = mode;
        const menu = byId('taskChecklistAssigneeMenu');
        if (!menu) return;
        byId('taskChecklistAssignName').value = '';
        byId('taskChecklistAssignStart').value = '';
        byId('taskChecklistAssignDue').value = '';
        const saveLabel = byId('taskChecklistAssignSaveLabel');
        if (saveLabel) saveLabel.textContent = 'Assign';
        menu.classList.add('open');
        byId('taskChecklistAssignName').focus();
    }

    function closeChecklistAssignMenu() {
        const menu = byId('taskChecklistAssigneeMenu');
        if (menu) menu.classList.remove('open');
        state.checklistAssignMode = '';
    }

    function saveChecklistAssignMenu() {
        syncChecklistDraftFromUi();
        const selected = selectedChecklistIndexes();
        if (!selected.length) { closeChecklistAssignMenu(); return; }
        const assigneeNames = parseAssigneeInputList(byId('taskChecklistAssignName').value || '');
        const masterStart = String(byId('taskStartDate').value || '').trim();
        const masterDue = String(byId('taskDueDate').value || '').trim() || masterStart;
        const rawStart = String(byId('taskChecklistAssignStart').value || '').trim() || masterStart;
        const rawDue = String(byId('taskChecklistAssignDue').value || '').trim() || rawStart || masterDue;
        const startDate = clampIsoRange(rawStart, masterStart, masterDue);
        const dueDate = clampIsoRange(rawDue, startDate || masterStart, masterDue);

        selected.forEach(function (idx) {
            const item = state.checklistDraft[idx];
            const current = parseChecklistAssignees(item.assignees, getChecklistAssignerName());
            const merged = Array.from(new Set(current.concat(assigneeNames))).filter(Boolean);
            item.assignees = serializeAssignees(merged);
            item.handoffMode = '';
            item.startDate = startDate;
            item.dueDate = dueDate;
            item.selected = false;
        });

        const checklistAssignees = [];
        state.checklistDraft.forEach(function (item) {
            parseChecklistAssignees(item.assignees, '').forEach(function (name) { checklistAssignees.push(name); });
        });
        const mergedForField = removeAssignerFromAssignees(Array.from(new Set(parseAssignees(byId('taskAssignee').value).concat(checklistAssignees))).filter(Boolean), getChecklistAssignerName());
        byId('taskAssignee').value = mergedForField.join(', ');

        syncEditingTaskChecklistToState();
        closeChecklistAssignMenu();
        syncChecklistMasterDates();
        renderChecklistDraft();
        queueRenderGantt();
        if (state.editingId) { persistChecklistForTask(state.editingId); queueModalAutosave(); }
    }

    function createChecklistHandoffEntries() {
        syncChecklistDraftFromUi();
        const selected = selectedChecklistIndexes();
        if (!selected.length) return;
        const appended = [];
        selected.forEach(function (idx) {
            const item = state.checklistDraft[idx];
            const assignees = parseChecklistAssignees(item.assignees, '');
            if (!assignees.length) return;
            const clone = {
                done: false,
                selected: false,
                text: String(item.text || 'Handoff').trim() || 'Handoff',
                assignees: serializeAssignees(assignees),
                startDate: item.startDate || byId('taskStartDate').value || '',
                dueDate: item.dueDate || byId('taskDueDate').value || '',
                handoffMode: 'handoff',
                progressStatus: 'Not Started',
                itemId: String(item.itemId || '')
            };
            appended.push(clone);
        });
        if (!appended.length) return;
        state.checklistDraft = state.checklistDraft.concat(appended);
        syncEditingTaskChecklistToState();
        syncChecklistMasterDates();
        renderChecklistDraft();
        queueRenderGantt();
        if (state.editingId) { persistChecklistForTask(state.editingId); queueModalAutosave(); }
    }


    async function loadChecklist(taskId) {
        state.checklistLoading = true;
        state.checklistDraft = [];
        renderChecklistDraft();
        if (!taskId) {
            state.checklistLoading = false;
            renderChecklistDraft();
            return;
        }
        const webAppUrl = getWebAppUrl();
        const sheetId = getSheetId();
        if (!webAppUrl || !sheetId) {
            state.checklistLoading = false;
            renderChecklistDraft();
            return;
        }
        try {
            const url = webAppUrl + '?action=checklistRead&sheetId=' + encodeURIComponent(sheetId) + '&taskId=' + encodeURIComponent(taskId);
            const res = await jsonp(url, 12000);
            if (res && res.ok && Array.isArray(res.items)) {
                state.checklistDraft = res.items.map(function (it) {
                    return {
                        done: String(it.done) === 'true' || it.done === true,
                        selected: false,
                        text: String(it.text || ''),
                        assignees: String(it.assignees || ''),
                        startDate: String(it.startDate || ''),
                        dueDate: String(it.dueDate || ''),
                        handoffMode: String(it.handoffMode || ''),
                        progressStatus: String(it.progressStatus || (String(it.done) === 'true' || it.done === true ? 'Done' : 'Not Started')),
                        itemId: String(it.itemId || '')
                    };
                });
                ensureChecklistItemIds();
                const task = state.tasks.find(function (t) { return t.taskId === taskId; });
                if (task) task.checklistItems = state.checklistDraft.slice();
            }
        } catch (_) {}
        state.checklistLoading = false;
        syncChecklistMasterDates();
        renderChecklistDraft();
    }

    function openModal(taskId) {
        closeChecklistAssignMenu();
        state.tracksUnlocked = false;
        syncTrackLockUi();
        const task = state.tasks.find(function (t) { return t.taskId === taskId; });
        state.editingId = task ? task.taskId : null;
        byId('taskModalTitle').textContent = task ? task.title : 'New Task';

        byId('taskTitle').value = task ? task.title : '';
        byId('taskDescription').value = task ? task.description : '';
        byId('taskAssignee').value = task ? task.assignee : '';
        byId('taskAssigner').value = task ? task.assigner : '';
        state.lastAssignerValue = byId('taskAssigner').value || ''; 
        byId('taskStartDate').value = task ? task.startDate : toISODate(new Date());
        byId('taskDueDate').value = task ? task.dueDate : shiftIsoDate(toISODate(new Date()), 2);

const pctEl = byId('taskPercent');
        if (pctEl) pctEl.value = task ? task.percentComplete : 0;
        byId('taskItemCode').value = task ? task.itemCode : '';
        byId('taskItemName').value = task ? task.itemName : '';
        autoSizeItemCodeInput((task && (task.itemName || task.description)) || byId('taskItemCode').value);
        closeItemLookup();
        byId('taskLocation').value = task ? task.location : '';
        byId('taskSublocation').value = task ? task.sublocation : '';
        byId('taskStatus').value = task ? task.status : 'Not Started';
        byId('taskPriority').value = task ? task.priority : 'Medium';
        syncPriorityToggleUi();
        byId('taskColor').value = task ? task.colorKey : 'teal';
        syncTaskColorPicker();
        syncPriorityToggleUi();
        const modalHeader = byId('taskModalTitle');
        if (modalHeader) {
            const headerColor = getColorDef(task ? task.colorKey : byId('taskColor').value).base;
            modalHeader.style.background = 'linear-gradient(135deg, ' + headerColor + ', ' + lighten(headerColor, 0.28) + ')';
        }
        writeTracksToModalFromTask(task || {
            assigneeTracks: '', assignee: byId('taskAssignee').value, assignees: parseAssignees(byId('taskAssignee').value), startDate: byId('taskStartDate').value, dueDate: byId('taskDueDate').value
        });

        byId('taskParentId').innerHTML = ['<option value="">No parent (group)</option>'].concat(
            state.tasks.filter(function (t) { return !task || t.taskId !== task.taskId; }).map(function (t) {
                return '<option value="' + esc(t.taskId) + '">' + esc(t.title) + '</option>';
            })
        ).join('');
        byId('taskParentId').value = task ? task.parentId : '';
        byId('taskArchiveBtn').style.display = task ? 'inline-block' : 'none';
        byId('taskModal').classList.add('open');
        const opt = byId('taskOptionalDetails');
        if (opt) opt.open = false;

        byId('taskParentId').onchange = function () {
            const parent = state.tasks.find(function (t) { return t.taskId === byId('taskParentId').value; });
            if (!parent) return;
            byId('taskStartDate').value = parent.startDate;
            if (toDate(byId('taskDueDate').value) < toDate(parent.startDate)) byId('taskDueDate').value = parent.startDate;
        };

loadChecklist(task ? task.taskId : null);
        syncChecklistMasterDates();
    }


    function focusAssigneeFieldSoon() {
        const assignee = byId('taskAssignee');
        if (!assignee) return;
        setTimeout(function () {
            assignee.focus();
            assignee.classList.add('assignee-focus');
            setTimeout(function () { assignee.classList.remove('assignee-focus'); }, 1200);
        }, 40);
    }

    function closeModal() {
        byId('taskModal').classList.remove('open');
        closeChecklistAssignMenu();
        if (state.autosaveTimer) {
            clearTimeout(state.autosaveTimer);
            state.autosaveTimer = null;
        }
        state.autosaveQueued = false;
        state.autosaveSignature = '';
    }

    function buildTaskPayloadFromModal() {
        const now = isoNow();
        const parentIdValue = byId('taskParentId').value;
        const parentTask = parentIdValue ? state.tasks.find(function (t) { return t.taskId === parentIdValue; }) : null;
        const payload = {
            taskId: state.editingId || ('TASK-' + Date.now()),
            parentId: parentIdValue,
            sortOrder: state.editingId
                ? Number((state.tasks.find(function (t) { return t.taskId === state.editingId; }) || {}).sortOrder || nextSortOrder())
                : nextSortOrder(),
            level: byId('taskParentId').value ? 'child' : 'group',
            title: byId('taskTitle').value.trim() || 'New Task',
            description: byId('taskDescription').value.trim(),
            status: byId('taskStatus').value,
            priority: byId('taskPriority').value,
            colorKey: byId('taskColor').value,
            assigner: byId('taskAssigner').value.trim(),
            assignees: [],
            startDate: byId('taskStartDate').value,
            dueDate: byId('taskDueDate').value,
            percentComplete: clamp(Number((byId('taskPercent') && byId('taskPercent').value) || 0), 0, 100),
            itemCode: byId('taskItemCode').value.trim(),
            itemName: byId('taskItemName').value.trim(),
            location: byId('taskLocation').value.trim(),
            sublocation: byId('taskSublocation').value.trim(),
            dependencyIds: '',
            archived: false,
            createdAt: state.editingId ? (state.tasks.find(function (t) { return t.taskId === state.editingId; }) || {}).createdAt || now : now,
            updatedAt: now,
            createdBy: 'dashboard'
        };
        syncChecklistDraftFromUi();
        const checklistAssignees = [];
        state.checklistDraft.forEach(function (item) {
            parseChecklistAssignees(item.assignees, '').forEach(function (name) { checklistAssignees.push(name); });
        });
        const assigneeInputList = parseAssignees(byId('taskAssignee').value);
        const assigneeList = removeAssignerFromAssignees(Array.from(new Set(assigneeInputList.concat(checklistAssignees))).filter(Boolean), payload.assigner);
        byId('taskAssignee').value = assigneeList.join(', ');
        payload.assignees = assigneeList.slice();
        payload.assignee = assigneeList[0] || '';
        modalTracksToPayload(payload, assigneeList);
        syncChecklistAssigneesWithTask(assigneeList);
        payload.status = checklistOverallProgressStatus(state.checklistDraft);

        if (parentTask) {
            payload.startDate = parentTask.startDate;
            if (payload.dueDate && toDate(payload.dueDate) < toDate(payload.startDate)) payload.dueDate = payload.startDate;
        }

        syncChecklistDraftFromUi();
        return payload;
    }

    function queueModalAutosave() {
        if (!state.editingId || !byId('taskModal').classList.contains('open')) return;
        if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
        state.autosaveTimer = setTimeout(function () {
            state.autosaveTimer = null;
            autosaveEditingTaskNow();
        }, 300);
    }

    async function autosaveEditingTaskNow() {
        if (!state.editingId || state.autosaveSaving) {
            if (state.editingId) state.autosaveQueued = true;
            return;
        }
        const idx = state.tasks.findIndex(function (t) { return t.taskId === state.editingId; });
        if (idx < 0) return;
        const payload = buildTaskPayloadFromModal();
        const signature = JSON.stringify({ task: payload, checklist: state.checklistDraft });
        if (signature === state.autosaveSignature) return;
        if (state.taskPersistMemoByTask[payload.taskId] === signature) return;
        state.autosaveSaving = true;
        try {
            state.tasks[idx] = normalizeTask(payload, idx);
            await writeTask('updateTask', payload);
            await persistChecklistForTask(payload.taskId);
            state.autosaveSignature = signature;
            state.taskPersistMemoByTask[payload.taskId] = signature;
            applyFilters();
        } finally {
            state.autosaveSaving = false;
            if (state.autosaveQueued) {
                state.autosaveQueued = false;
                queueModalAutosave();
            }
        }
    }

    async function saveTask() {
        const payload = buildTaskPayloadFromModal();

        if (state.editingId) {
            const idx = state.tasks.findIndex(function (t) { return t.taskId === state.editingId; });
            if (idx >= 0) state.tasks[idx] = normalizeTask(payload, idx);
            await writeTask('updateTask', payload);
        } else {
            state.tasks.push(normalizeTask(payload, state.tasks.length));
            await writeTask('createTask', payload);
        }

        await persistChecklistForTask(payload.taskId);
        state.autosaveSignature = JSON.stringify({ task: payload, checklist: state.checklistDraft });
        state.taskPersistMemoByTask[payload.taskId] = state.autosaveSignature;
        closeModal();
        applyFilters();
    }

    async function archiveEditingTask() {
        if (!state.editingId) return;
        const task = state.tasks.find(function (t) { return t.taskId === state.editingId; });
        if (!task) return;
        task.archived = true;
        task.updatedAt = isoNow();
        await writeTask('archiveTask', { taskId: task.taskId, archived: true, updatedAt: task.updatedAt });
        closeModal();
        applyFilters();
    }

    function getChildTasks(parentId) {
        return state.tasks.filter(function (t) { return String(t.parentId || '') === String(parentId || ''); });
    }

    function getDescendantTaskIds(parentId, out) {
        const children = getChildTasks(parentId);
        for (let i = 0; i < children.length; i++) {
            out.push(children[i].taskId);
            getDescendantTaskIds(children[i].taskId, out);
        }
    }

    function shiftTaskWithChildren(parentTask, deltaDays, out) {
        const children = getChildTasks(parentTask.taskId);
        children.forEach(function (child) {
            ensureTaskDates(child);
            child.startDate = shiftIsoDate(child.startDate, deltaDays);
            child.dueDate = shiftIsoDate(child.dueDate, deltaDays);
            child.updatedAt = isoNow();
            out.push(child);
            shiftTaskWithChildren(child, deltaDays, out);
        });
    }

    async function updateTaskDatesFromDrag(task, nextStart, nextDue) {
        const prevStart = task.startDate;
        task.startDate = nextStart;
        task.dueDate = nextDue;
        task.updatedAt = isoNow();
        await writeTask('updateTask', {
            taskId: task.taskId,
            startDate: task.startDate,
            dueDate: task.dueDate,
            updatedAt: task.updatedAt
        });

        const deltaDays = Math.round((toDate(task.startDate) - toDate(prevStart)) / DAY_MS);
        if (deltaDays && getChildTasks(task.taskId).length) {
            const shifted = [];
            shiftTaskWithChildren(task, deltaDays, shifted);
            for (let i = 0; i < shifted.length; i++) {
                const child = shifted[i];
                await writeTask('updateTask', {
                    taskId: child.taskId,
                    startDate: child.startDate,
                    dueDate: child.dueDate,
                    updatedAt: child.updatedAt
                });
            }
        }
    }



    function clearDragRowHighlights() {
        const rows = els.ganttWrap ? els.ganttWrap.querySelectorAll('.gantt-row') : [];
        for (let i = 0; i < rows.length; i++) {
            rows[i].classList.remove('drag-disabled');
            rows[i].classList.remove('drag-target');
        }
    }

    function clearDropPreviewTransforms() {
        const rows = els.ganttWrap ? els.ganttWrap.querySelectorAll('.gantt-row[data-row-index]') : [];
        for (let i = 0; i < rows.length; i++) rows[i].style.transform = '';
    }

    function updateDropPreviewTransforms(drag) {
        clearDropPreviewTransforms();
        if (!drag || drag.pendingTargetRowIndex == null || !drag.pendingTargetTaskId || !drag.draggedRowIndexes || !drag.draggedRowIndexes.length) return;
        const shiftPx = drag.draggedRowIndexes.length * 44;
        const targetIdx = drag.pendingTargetRowIndex;
        const draggedSet = new Set(drag.draggedRowIndexes);
        const rows = els.ganttWrap ? els.ganttWrap.querySelectorAll('.gantt-row[data-row-index]') : [];
        for (let i = 0; i < rows.length; i++) {
            const idx = Number(rows[i].getAttribute('data-row-index'));
            if (draggedSet.has(idx)) continue;
            if (idx >= targetIdx) rows[i].style.transform = 'translateY(' + shiftPx + 'px)';
        }
    }

    function updateDragRowHighlights(drag) {
        if (!drag || drag.dragType !== 'move') { clearDragRowHighlights(); return; }
        const rows = els.ganttWrap ? els.ganttWrap.querySelectorAll('.gantt-row[data-task-id]') : [];
        for (let i = 0; i < rows.length; i++) {
            const rowTaskId = rows[i].getAttribute('data-task-id') || '';
            const allowed = String(rows[i].getAttribute('data-parent-id') || '') === String(drag.sourceParentId || '');
            rows[i].classList.toggle('drag-disabled', !allowed);
            rows[i].classList.toggle('drag-target', !!drag.pendingTargetTaskId && rowTaskId === drag.pendingTargetTaskId);
        }
    }

    function reorderSiblingsLocal(taskId, targetTaskId) {
        const task = state.tasks.find(function (t) { return t.taskId === taskId; });
        const target = state.tasks.find(function (t) { return t.taskId === targetTaskId; });
        if (!task || !target) return false;
        if (String(task.parentId || '') !== String(target.parentId || '')) return false;
        const siblings = state.tasks
            .filter(function (t) { return String(t.parentId || '') === String(task.parentId || ''); })
            .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
        const fromIdx = siblings.findIndex(function (t) { return t.taskId === task.taskId; });
        const toIdx = siblings.findIndex(function (t) { return t.taskId === target.taskId; });
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return false;
        const moved = siblings.splice(fromIdx, 1)[0];
        siblings.splice(toIdx, 0, moved);
        siblings.forEach(function (sibling, orderIdx) { sibling.sortOrder = (orderIdx + 1) * 10; sibling.updatedAt = isoNow(); });
        return true;
    }

    function updateSortUi() {
        const btn = byId('tasksSortBtn');
        const modeEl = byId('tasksSortMode');
        const labels = { manual: 'Manual', name: 'Name', priority: 'Importance', assignee: 'Assignee' };
        const label = labels[state.sortMode] || 'Manual';
        if (btn) btn.title = 'Sort: ' + label;
        if (modeEl) modeEl.textContent = label;
    }

    function persistSiblingOrder(parentId) {
        const siblings = state.tasks
            .filter(function (t) { return String(t.parentId || '') === String(parentId || ''); })
            .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
        return Promise.all(siblings.map(function (task, idx) {
            task.sortOrder = (idx + 1) * 10;
            task.updatedAt = isoNow();
            return writeTask('reorderTask', { taskId: task.taskId, parentId: task.parentId || '', sortOrder: task.sortOrder, updatedAt: task.updatedAt });
        }));
    }

    function reorderWithinHierarchy(drag, clientY) {
        const task = state.tasks.find(function (t) { return t.taskId === drag.taskId; });
        if (!task || !els.ganttWrap) return;
        const wrapRect = els.ganttWrap.getBoundingClientRect();
        const yInWrap = clientY - wrapRect.top + els.ganttWrap.scrollTop;
        const rowHeight = 44;
        const headerOffset = 68;
        let targetRowIndex = Math.floor((yInWrap - headerOffset) / rowHeight);
        targetRowIndex = Math.max(0, Math.min(state.flatRows.length - 1, targetRowIndex));

        const draggedSet = new Set(drag.draggedRowIndexes || []);
        if (draggedSet.has(targetRowIndex)) {
            drag.pendingTargetTaskId = '';
            drag.pendingTargetRowIndex = null;
            updateDragRowHighlights(drag);
            updateDropPreviewTransforms(drag);
            return;
        }

        let targetId = '';
        const row = state.flatRows[targetRowIndex];
        if (row && String(row.task.parentId || '') === String(task.parentId || '') && row.task.taskId !== task.taskId) {
            targetId = row.task.taskId;
        }

        drag.pendingTargetTaskId = targetId;
        drag.pendingTargetRowIndex = targetId ? targetRowIndex : null;
        if (targetId) drag.moved = true;
        updateDragRowHighlights(drag);
        updateDropPreviewTransforms(drag);
    }

    function startDrag(taskId, dragType, clientX, clientY, segmentKey) {
        const task = state.tasks.find(function (t) { return t.taskId === taskId; });
        if (!task) return;
        ensureTaskDates(task);

        let dragStart = task.startDate;
        let dragDue = task.dueDate;
        if (segmentKey) {
            const tracks = buildTaskTracks(task);
            const seg = tracks.find(function (it) { return String(it.key) === String(segmentKey); });
            if (seg) {
                dragStart = seg.startDate;
                dragDue = seg.dueDate;
                task.assigneeTracks = JSON.stringify(tracks);
            }
        }

        state.drag = {
            taskId: task.taskId,
            dragType: dragType,
            startX: clientX,
            startDate: dragStart,
            dueDate: dragDue,
            stepDays: 1,
            moved: false,
            lastDeltaDays: 0,
            startY: clientY,
            reordered: false,
            sourceParentId: task.parentId || '',
            pendingTargetTaskId: '',
            pendingTargetRowIndex: null,
            dragEl: null,
            dragElStartLeft: 0,
            draggedRowStartIndex: state.flatRows.findIndex(function (r) { return r.task.taskId === task.taskId; }),
            draggedRowIndexes: [],
            deleteHot: false,
            segmentKey: segmentKey || ''
        };
        const dz = byId('tasksDeleteZone');
        if (dz) dz.classList.add('show');
        if (state.drag.draggedRowStartIndex >= 0) {
            const span = childSpanCountFromFlatIndex(state.drag.draggedRowStartIndex);
            const list = [];
            for (let i = 0; i < span; i++) list.push(state.drag.draggedRowStartIndex + i);
            state.drag.draggedRowIndexes = list;
        }
    }

    async function finishDrag() {
        const drag = state.drag;
        state.drag = null;
        const dz0 = byId('tasksDeleteZone');
        if (dz0) { dz0.classList.remove('show'); dz0.classList.remove('hot'); }
        const movedEls = els.ganttWrap ? els.ganttWrap.querySelectorAll('.gantt-bar[data-task-id]') : [];
        for (let i = 0; i < movedEls.length; i++) {
            if (movedEls[i].style.pointerEvents === 'none' || movedEls[i].style.transform) {
                movedEls[i].style.transform = '';
                movedEls[i].style.zIndex = '';
                movedEls[i].style.pointerEvents = '';
            }
        }
        if (!drag || (!drag.moved && !drag.deleteHot)) return;
        const task = state.tasks.find(function (t) { return t.taskId === drag.taskId; });
        if (!task) return;
        clearDragRowHighlights();
        clearDropPreviewTransforms();
        const dz = byId('tasksDeleteZone');
        if (dz) { dz.classList.remove('show'); dz.classList.remove('hot'); }
        if (drag.deleteHot) {
            const ids = [task.taskId];
            getDescendantTaskIds(task.taskId, ids);
            for (let i = 0; i < ids.length; i++) {
                const t = state.tasks.find(function (x) { return x.taskId === ids[i]; });
                if (!t) continue;
                t.archived = true;
                t.updatedAt = isoNow();
                writeTask('archiveTask', { taskId: t.taskId, archived: true, updatedAt: t.updatedAt });
            }
            applyFilters();
            return;
        }

        if (drag.pendingTargetTaskId) {
            const changed = reorderSiblingsLocal(task.taskId, drag.pendingTargetTaskId);
            if (changed) {
                applyFilters();
                persistSiblingOrder(task.parentId || '').catch(function () {});
                return;
            }
        }
        if (drag.moved) {
            if (drag.segmentKey) {
                const tracks = buildTaskTracks(task);
                const seg = tracks.find(function (it) { return String(it.key) === String(drag.segmentKey); });
                if (seg) {
                    seg.startDate = task.startDate;
                    seg.dueDate = task.dueDate;
                }
                syncTaskDateEnvelopeFromTracks(task, tracks);
                task.assigneeTracks = JSON.stringify(tracks);
                task.updatedAt = isoNow();
                await writeTask('updateTask', {
                    taskId: task.taskId,
                    startDate: task.startDate,
                    dueDate: task.dueDate,
                    assigneeTracks: task.assigneeTracks,
                    updatedAt: task.updatedAt
                });
                applyFilters();
                return;
            }
            await updateTaskDatesFromDrag(task, task.startDate, task.dueDate);
            applyFilters();
        }
    }

    function onDragMove(clientX, clientY) {
        const drag = state.drag;
        if (!drag) return;
        const task = state.tasks.find(function (t) { return t.taskId === drag.taskId; });
        if (!task) return;

        const yDelta = clientY - drag.startY;
        const xDelta = clientX - drag.startX;
        const dz = byId('tasksDeleteZone');
        if (dz) {
            const r = dz.getBoundingClientRect();
            const hot = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
            drag.deleteHot = hot;
            if (hot) drag.moved = true;
            dz.classList.toggle('hot', hot);
        }
        if (!drag.segmentKey && drag.dragType === 'move' && Math.abs(yDelta) > 12 && Math.abs(yDelta) > Math.abs(xDelta)) {
            if (!drag.dragEl) {
                drag.dragEl = els.ganttWrap.querySelector('.gantt-bar[data-task-id="' + task.taskId + '"]');
                if (drag.dragEl) {
                    drag.dragEl.style.zIndex = '15';
                    drag.dragEl.style.pointerEvents = 'none';
                }
            }
            const moveIds = [task.taskId];
            getDescendantTaskIds(task.taskId, moveIds);
            for (let i = 0; i < moveIds.length; i++) {
                const el = els.ganttWrap.querySelector('.gantt-bar[data-task-id="' + moveIds[i] + '"]');
                if (el) { el.style.zIndex = '15'; el.style.pointerEvents = 'none'; el.style.transform = 'translate(' + xDelta + 'px,' + yDelta + 'px)'; }
            }
            reorderWithinHierarchy(drag, clientY);
            return;
        }
        if (drag.dragEl) {
            drag.dragEl.style.transform = '';
            drag.dragEl.style.zIndex = '';
            drag.dragEl.style.pointerEvents = '';
            drag.dragEl = null;
            drag.pendingTargetTaskId = '';
            drag.pendingTargetRowIndex = null;
            clearDragRowHighlights();
            clearDropPreviewTransforms();
        }

        const rawDeltaCols = (clientX - drag.startX) / Math.max(1, state.colPx);
        const deltaDays = (rawDeltaCols >= 0 ? Math.floor(rawDeltaCols) : Math.ceil(rawDeltaCols)) * drag.stepDays;
        if (deltaDays === drag.lastDeltaDays) return;
        drag.lastDeltaDays = deltaDays;

        let newStart = drag.startDate;
        let newDue = drag.dueDate;

        if (drag.dragType === 'move') {
            newStart = shiftIsoDate(drag.startDate, deltaDays);
            newDue = shiftIsoDate(drag.dueDate, deltaDays);
        } else if (drag.dragType === 'start') {
            newStart = shiftIsoDate(drag.startDate, deltaDays);
            if (toDate(newStart) > toDate(newDue)) newStart = newDue;
        } else if (drag.dragType === 'end') {
            newDue = shiftIsoDate(drag.dueDate, deltaDays);
            if (toDate(newDue) < toDate(newStart)) newDue = newStart;
        }

        if (task.startDate !== newStart || task.dueDate !== newDue) {
            task.startDate = newStart;
            task.dueDate = newDue;
            drag.moved = true;
            queueRenderGantt();
        }
    }

    async function writeTask(action, taskPayload) {
        const webAppUrl = getWebAppUrl();
        if (!webAppUrl) return;
        const sheetId = getSheetId();
        const wrappedPayload = {
            action: 'taskWrite',
            taskAction: action,
            sheetId: sheetId,
            tabName: 'tasks',
            payload: JSON.stringify((function(){ var cp=Object.assign({}, taskPayload||{}); delete cp.assignee; delete cp.assigneeTracks; return cp; })())
        };
        try {
            await postForm(webAppUrl, wrappedPayload);
        } catch (e1) {
            console.warn('Task write failed', e1);
        }
    }

    function nextSortOrder() {
        return (state.tasks.reduce(function (max, t) { return Math.max(max, Number(t.sortOrder || 0)); }, 0) || 0) + 10;
    }

    function createNewTaskBlock() {
        state.editingId = null;
        openModal();
    }


    function openNewTaskWithPrefill(prefill) {
        state.editingId = null;
        openModal();
        const itemCode = String((prefill && prefill.itemCode) || '').trim();
        const itemName = String((prefill && prefill.itemName) || '').trim();
        if (itemCode) byId('taskItemCode').value = itemCode;
        if (itemName) byId('taskItemName').value = itemName;
        autoSizeItemCodeInput(itemName || itemCode);
        closeItemLookup();
    }

    function syncShellLayout() {
        if (!els.shell) return;
        els.shell.style.setProperty('--left-pane-width', Math.max(240, Math.min(620, state.leftPaneWidth)) + 'px');
        els.shell.classList.toggle('left-collapsed', !!state.leftPaneCollapsed);
        els.shell.style.display = state.printView ? 'none' : 'grid';
        const v = byId('tasksViewToggle');
        if (v) v.textContent = state.printView ? 'Planner View' : 'Printable Layout';
    }

    function bindEvents() {
        ['search','statusFilter','assigneeFilter','assignerFilter','itemFilter','locationFilter'].forEach(function (k) {
            const ev = (k === 'statusFilter' || k === 'assigneeFilter' || k === 'assignerFilter') ? 'change' : 'input';
            els[k].addEventListener(ev, debounce(applyFilters, 120));
        });

        [['tasksZoomDayBtn','day'],['tasksZoomWeekBtn','week'],['tasksZoomMonthBtn','month']].forEach(function (pair) {
            const btn = byId(pair[0]);
            if (!btn) return;
            btn.addEventListener('click', function () {
                state.zoom = pair[1];
                state.zoomOutLevel = 0;
                state.currentAnchorDate = toISODate(new Date());
                syncZoomOutUi();
                syncZoomModeButtons();
                renderGantt();
            });
        });

        els.zoomInBtn.addEventListener('click', function () {
            state.zoomOutLevel = Math.max(0, state.zoomOutLevel - 1);
            syncZoomOutUi();
            renderGantt();
        });

        els.zoomOutBtn.addEventListener('click', function () {
            state.zoomOutLevel = Math.min(8, state.zoomOutLevel + 1);
            syncZoomOutUi();
            renderGantt();
        });

        byId('tasksSortBtn').addEventListener('click', function () {
            const order = ['manual', 'name', 'priority', 'assignee'];
            const idx = order.indexOf(state.sortMode);
            state.sortMode = order[(idx + 1) % order.length];
            updateSortUi();
            applyFilters();
        });

        byId('tasksExpandAllMini').addEventListener('click', function () {
            const collapse = state.flatRows.some(function (r) { return r.task.children && r.task.children.length && state.expanded[r.task.taskId] !== false; });
            state.flatRows.forEach(function (r) {
                if (r.task.children && r.task.children.length) state.expanded[r.task.taskId] = collapse ? false : true;
            });
            applyFilters();
        });

        els.filterToggle.addEventListener('click', function () {
            state.filtersOpen = !state.filtersOpen;
            syncFilterPanelUi();
        });

        els.clearFiltersBtn.addEventListener('click', function () {
            els.statusFilter.value = 'all';
            els.assigneeFilter.value = 'all';
            els.assignerFilter.value = 'all';
            els.itemFilter.value = '';
            els.locationFilter.value = '';
            applyFilters();
        });

        byId('tasksSearchBtn').addEventListener('click', function () {
            const wrap = byId('tasksSearchWrap');
            if (!wrap) return;
            wrap.classList.toggle('open');
            if (wrap.classList.contains('open') && els.search) els.search.focus();
        });

        els.listBody.addEventListener('scroll', function () {
            if (state.syncingScroll) return;
            state.syncingScroll = true;
            if (els.ganttWrap) els.ganttWrap.scrollTop = els.listBody.scrollTop;
            requestAnimationFrame(function () { state.syncingScroll = false; });
        });
        els.ganttWrap.addEventListener('scroll', function () {
            if (state.syncingScroll) return;
            state.syncingScroll = true;
            if (els.listBody) els.listBody.scrollTop = els.ganttWrap.scrollTop;
            requestAnimationFrame(function () { state.syncingScroll = false; });
        });

        byId('tasksViewToggle').addEventListener('click', function () {
            state.printView = !state.printView;
            syncShellLayout();
            renderPrintView();
        });

        byId('tasksAddBtn').addEventListener('click', createNewTaskBlock);
        byId('taskCancelBtn').addEventListener('click', closeModal);
        byId('taskSaveBtn').addEventListener('click', saveTask);
        ['taskTitle','taskDescription','taskStatus','taskPriority','taskColor','taskAssignee','taskPercent','taskItemCode','taskItemName','taskLocation','taskSublocation','taskParentId','taskAssigneeTracks'].forEach(function (id) {
            const field = byId(id);
            if (!field) return;
            const evt = (field.tagName === 'SELECT' || field.type === 'date' || field.type === 'range') ? 'change' : 'input';
            field.addEventListener(evt, queueModalAutosave);
            if (evt !== 'change') field.addEventListener('change', queueModalAutosave);
        });
        byId('taskAssigner').addEventListener('input', function () {
            const next = String(byId('taskAssigner').value || '').trim();
            syncChecklistAssignerBadges(state.lastAssignerValue, next);
            state.lastAssignerValue = next;
            renderChecklistDraft();
            queueModalAutosave();
        });
        byId('taskArchiveBtn').addEventListener('click', archiveEditingTask);
        byId('taskChecklistAdd').addEventListener('click', function () {
            if (state.checklistLoading) return;
            syncChecklistDraftFromUi();
            state.checklistDraft.push({ done: false, selected: false, text: '', assignees: '', progressStatus: 'Not Started', startDate: byId('taskStartDate').value || '', dueDate: byId('taskDueDate').value || '', itemId: '' });
            renderChecklistDraft();
        });
        byId('taskChecklistRows').addEventListener('input', function () { if (!state.checklistLoading) { syncChecklistDraftFromUi(); syncChecklistMasterDates(); queueModalAutosave(); } });
        byId('taskChecklistRows').addEventListener('change', function () { if (!state.checklistLoading) { syncChecklistDraftFromUi(); syncChecklistMasterDates(); queueModalAutosave(); } });
        byId('taskChecklistRows').addEventListener('click', function (e) {
            const progressBtn = e.target.closest('[data-check-progress-idx]');
            if (progressBtn) {
                const idx = Number(progressBtn.getAttribute('data-check-progress-idx'));
                if (Number.isFinite(idx)) openChecklistProgressMenu(idx, progressBtn, progressBtn.getAttribute('data-check-assignee') || '');
                return;
            }
            const selectCb = e.target.closest('[data-check-select-idx]');
            if (!selectCb || state.checklistLoading) return;
            syncChecklistDraftFromUi();
            renderChecklistDraft();
        });
        byId('taskChecklistDelete').addEventListener('click', function () { if (!state.checklistLoading) applyChecklistSelectionAction('delete'); });
        byId('taskChecklistDone').addEventListener('click', function () { if (!state.checklistLoading) applyChecklistSelectionAction('done'); });
        byId('taskChecklistHandoff').addEventListener('click', function () { if (!state.checklistLoading) createChecklistHandoffEntries(); });
        byId('taskChecklistCollaborate').addEventListener('click', function () { if (!state.checklistLoading) openChecklistAssignMenu('assign'); });
        byId('taskChecklistAssignSave').addEventListener('click', function () { if (!state.checklistLoading) saveChecklistAssignMenu(); });
        byId('taskChecklistAssignCancel').addEventListener('click', closeChecklistAssignMenu);
        const pr = byId('taskPriorityToggleRow');
        if (pr) {
            pr.addEventListener('click', function (e) {
                const btn = e.target.closest('[data-priority]');
                if (!btn) return;
                byId('taskPriority').value = btn.getAttribute('data-priority') || 'Medium';
                syncPriorityToggleUi();
            });
        }


        document.addEventListener('click', function (e) {
            const menu = byId('checklistProgressMenu');
            if (!menu || !menu.classList.contains('open')) return;
            const btn = e.target.closest('[data-progress-idx][data-progress-status], [data-progress-idx][data-progress-action]');
            if (btn) {
                const idx = Number(btn.getAttribute('data-progress-idx'));
                const action = String(btn.getAttribute('data-progress-action') || '').trim();
                const next = String(btn.getAttribute('data-progress-status') || 'Not Started');
                if (Number.isFinite(idx) && state.checklistDraft[idx]) {
                    if (action === 'unassign') {
                        const removeName = String(btn.getAttribute('data-progress-assignee') || '').trim().toLowerCase();
                        const currentNames = parseChecklistAssignees(state.checklistDraft[idx].assignees, '');
                        const kept = currentNames.filter(function (name) {
                            return String(name || '').trim().toLowerCase() !== removeName;
                        });
                        state.checklistDraft[idx].assignees = serializeAssignees(kept);
                    } else {
                        state.checklistDraft[idx].progressStatus = next;
                        state.checklistDraft[idx].done = next === 'Done';
                    }
                    syncChecklistMasterDates();
                    renderChecklistDraft();
                    syncEditingTaskChecklistToState();
                    if (state.editingId) { persistChecklistForTask(state.editingId); queueModalAutosave(); }
                }
                closeChecklistProgressMenu();
                return;
            }
            if (!e.target.closest('#checklistProgressMenu,[data-check-progress-idx]')) closeChecklistProgressMenu();
        });

        byId('taskStartDate').addEventListener('change', function () { syncChecklistMasterDates(); renderChecklistDraft(); queueModalAutosave(); });
        byId('taskDueDate').addEventListener('change', function () { syncChecklistMasterDates(); renderChecklistDraft(); queueModalAutosave(); });

        els.listBody.addEventListener('click', function (e) {
            const assigneeOpen = e.target.closest('[data-assignee-open]');
            if (assigneeOpen) {
                openModal(assigneeOpen.getAttribute('data-assignee-open'));
                focusAssigneeFieldSoon();
                return;
            }
            const toggleId = e.target && e.target.getAttribute('data-toggle');
            if (toggleId) {
                state.expanded[toggleId] = state.expanded[toggleId] === false;
                applyFilters();
                return;
            }
            const row = e.target.closest('.tasks-row');
            if (!row) return;
            const taskId = row.getAttribute('data-task-id');
            state.focusTaskId = taskId || '';
            renderList();
            queueRenderGantt();
            const task = state.tasks.find(function (t) { return t.taskId === taskId; });
            if (task && task.children && task.children.length) {
                state.expanded[taskId] = state.expanded[taskId] === false;
                applyFilters();
            }
        });

        els.ganttWrap.addEventListener('click', function (e) {
            const navPrev = e.target.closest('#tasksPrevRange');
            const navNext = e.target.closest('#tasksNextRange');
            if (navPrev || navNext) {
                const step = navPrev ? -1 : 1;
                state.currentAnchorDate = toISODate(shiftByMode(toDate(state.currentAnchorDate) || new Date(), step));
                renderGantt();
                return;
            }
            if (state.drag && state.drag.moved) return;
            const childBtn = e.target.closest('[data-task-child]');
            if (childBtn) { openNewChildTaskFrom(childBtn.getAttribute('data-task-child')); return; }
            const menuBtn = e.target.closest('[data-task-menu]');
            if (menuBtn) openModal(menuBtn.getAttribute('data-task-menu'));
            const compositeBtn = e.target.closest('[data-composite-task-id]');
            if (compositeBtn) {
                openModal(compositeBtn.getAttribute('data-composite-task-id'));
                setTimeout(function () {
                    const el = byId('taskAssigneeTracks');
                    if (el) { el.focus(); el.classList.add('assignee-focus'); setTimeout(function () { el.classList.remove('assignee-focus'); }, 1200); }
                }, 50);
                return;
            }
        });

        byId('taskTrackSyncBtn').addEventListener('click', function () {
            byId('taskAssigneeTracks').value = serializeTracksForInput(buildTracksByMode('sync'));
        });
        byId('taskTrackSplitBtn').addEventListener('click', function () {
            byId('taskAssigneeTracks').value = serializeTracksForInput(buildTracksByMode('equal'));
        });
        byId('taskTrackHandoffBtn').addEventListener('click', function () {
            byId('taskAssigneeTracks').value = serializeTracksForInput(buildTracksByMode('handoff'));
        });
        byId('taskTracksUnlockBtn').addEventListener('click', function () {
            if (state.tracksUnlocked) return;
            const pw = window.prompt('Admin password required to edit Assignee timeline tracks:');
            if (String(pw || '') !== 'admin') return;
            state.tracksUnlocked = true;
            syncTrackLockUi();
        });

        els.splitter.addEventListener('pointerdown', function (e) {
            state.resizing = { startX: e.clientX, width: state.leftPaneWidth };
            e.preventDefault();
        });

        els.ganttWrap.addEventListener('pointerdown', function (e) {
            if (e.target.closest('.gantt-menu-btn, .gantt-child-btn')) return;
            const hit = e.target.closest('.gantt-bar, .gantt-handle');
            if (!hit) return;
            const taskId = hit.getAttribute('data-task-id');
            const dragType = hit.getAttribute('data-drag-type') || 'move';
            const segmentKey = hit.getAttribute('data-segment-key') || '';
            if (!taskId) return;
            e.preventDefault();
            startDrag(taskId, dragType, e.clientX, e.clientY, segmentKey);
        });

        window.addEventListener('pointermove', function (e) {
            if (state.resizing) {
                state.leftPaneCollapsed = false;
                state.leftPaneWidth = state.resizing.width + (e.clientX - state.resizing.startX);
                syncShellLayout();
                return;
            }
            if (!state.drag) return;
            onDragMove(e.clientX, e.clientY);
        });

        window.addEventListener('pointerup', function () {
            if (state.resizing) { state.resizing = null; return; }
            if (!state.drag) return;
            finishDrag();
        });

        window.addEventListener('message', function (event) {
            if (!event || !event.data) return;
            if (event.data.type === 'darkModeToggle') {
                document.body.classList.toggle('dark-mode', !!event.data.enabled);
            }
            if (event.data.type === 'setReferrer') {
                loadTasks();
            }
            if (event.data.type === 'openTaskComposer') {
                const prefill = event.data.prefill || {};
                openNewTaskWithPrefill(prefill);
            }
        });
    }

    function debounce(fn, ms) {
        let t;
        return function () {
            const args = arguments;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(null, args); }, ms);
        };
    }

    function cacheEls() {
        els.search = byId('tasksSearch');
        els.statusFilter = byId('tasksStatusFilter');
        els.assigneeFilter = byId('tasksAssigneeFilter');
        els.assignerFilter = byId('tasksAssignerFilter');
        els.itemFilter = byId('tasksItemFilter');
        els.locationFilter = byId('tasksLocationFilter');
        els.zoomInBtn = byId('tasksZoomInBtn');
        els.zoomOutBtn = byId('tasksZoomOutBtn');
        els.filterToggle = byId('tasksFilterToggle');
        els.filtersPanel = byId('tasksFiltersPanel');
        els.clearFiltersBtn = byId('tasksClearFilters');
        els.listBody = byId('tasksListBody');
        els.listGap = byId('tasksListGap');
        els.ganttWrap = byId('tasksGanttWrap');
        els.shell = byId('tasksShell');
        els.splitter = byId('tasksSplitter');
        els.panelToggleBtn = byId('tasksViewToggle');
    }

    function bootstrapInventoryHint() {
        try {
            const parentData = window.parent && window.parent.MOCK_DATA;
            if (!parentData || !Array.isArray(parentData.items)) return;
            const firstItem = parentData.items[0] || {};
            if (!els.itemFilter.placeholder && firstItem.itemCode) {
                els.itemFilter.placeholder = 'Item code (e.g., ' + firstItem.itemCode + ')';
            }
        } catch (_) {}
    }


    function getLookupItems() {
        const uniq = new Map();
        function addRows(rows) {
            if (!Array.isArray(rows)) return;
            rows.forEach(function (row) {
                const itemCode = String((row && row.itemCode) || '').trim();
                const description = String((row && row.description) || '').trim();
                const drugName = String((row && row.drugName) || '').trim();
                if (!itemCode && !description && !drugName) return;
                const key = (itemCode + '|' + description + '|' + drugName).toLowerCase();
                if (!uniq.has(key)) uniq.set(key, { itemCode: itemCode, description: description, drugName: drugName });
            });
        }
        try {
            if (window.parent && window.parent.ITEMS_DATA && Array.isArray(window.parent.ITEMS_DATA.items)) addRows(window.parent.ITEMS_DATA.items);
        } catch (_) {}
        try { if (window.ITEMS_DATA && Array.isArray(window.ITEMS_DATA.items)) addRows(window.ITEMS_DATA.items); } catch (_) {}
        try {
            const parentData = window.parent && window.parent.MOCK_DATA;
            if (parentData && Array.isArray(parentData.items)) addRows(parentData.items);
        } catch (_) {}
        return Array.from(uniq.values());
    }

    function autoSizeItemCodeInput(text) {
        const el = byId('taskItemCode');
        if (!el) return;
        const next = String(text || '').trim();
        const len = clamp(next.length, 18, 90);
        el.style.minWidth = (len * 7) + 'px';
    }

    function closeItemLookup() {
        const dd = byId('taskItemLookup');
        if (!dd) return;
        dd.style.display = 'none';
        dd.innerHTML = '';
    }

    function renderItemLookup(matches) {
        const dd = byId('taskItemLookup');
        if (!dd) return;
        if (!matches.length) { closeItemLookup(); return; }
        dd.innerHTML = matches.map(function (m, idx) {
            const label = m.description || m.drugName || '';
            return '<div class="dropdown-option" data-lookup-idx="' + idx + '" role="option">' +
                '<span class="lookup-option-code">' + esc(m.itemCode || '—') + '</span>' +
                '<span class="lookup-option-name">' + esc(label) + '</span>' +
            '</div>';
        }).join('');
        dd.style.display = 'block';
    }

    function bindTaskItemLookup() {
        const input = byId('taskItemCode');
        const itemNameInput = byId('taskItemName');
        const dd = byId('taskItemLookup');
        if (!input || !dd || !itemNameInput) return;

        state.itemLookupRows = getLookupItems();

        function findMatches(term) {
            const q = String(term || '').trim().toLowerCase();
            if (!q) return [];
            const results = [];
            for (let i = 0; i < state.itemLookupRows.length; i++) {
                const row = state.itemLookupRows[i];
                const hay = [row.description, row.drugName, row.itemCode].join(' ').toLowerCase();
                if (hay.indexOf(q) === -1) continue;
                results.push(row);
                if (results.length >= 12) break;
            }
            return results;
        }

        input.addEventListener('input', function () {
            const matches = findMatches(input.value);
            renderItemLookup(matches);
            autoSizeItemCodeInput(input.value);
        });

        input.addEventListener('focus', function () {
            if (!input.value) return;
            renderItemLookup(findMatches(input.value));
        });

        dd.addEventListener('mousedown', function (e) {
            const opt = e.target.closest('.dropdown-option');
            if (!opt) return;
            e.preventDefault();
            const idx = Number(opt.getAttribute('data-lookup-idx'));
            const rows = findMatches(input.value);
            const pick = rows[idx];
            if (!pick) return;
            input.value = String(pick.itemCode || '');
            itemNameInput.value = String(pick.description || pick.drugName || '');
            autoSizeItemCodeInput(itemNameInput.value || input.value);
            closeItemLookup();
        });

        document.addEventListener('click', function (e) {
            const wrap = e.target.closest('.task-itemcode-lookup');
            if (!wrap) closeItemLookup();
        });
    }


    function getLocationRows() {
        const map = (window.SUBLOCATION_MAP || (window.parent && window.parent.SUBLOCATION_MAP) || {});
        return Object.keys(map || {}).map(function (key) {
            const row = map[key] || {};
            return { sublocation: String(key || ''), location: String(row.mainLocation || ''), department: String(row.department || '') };
        });
    }

    function bindTaskLocationLookup() {
        const locationInput = byId('taskLocation');
        const subInput = byId('taskSublocation');
        const locationDd = byId('taskLocationLookup');
        const subDd = byId('taskSublocationLookup');
        if (!locationInput || !subInput || !locationDd || !subDd) return;

        const rows = getLocationRows().filter(function (r) { return String(r.location || '').trim() || String(r.sublocation || '').trim(); });
        const uniqLocations = Array.from(new Set(rows.map(function (r) { return String(r.location || '').trim(); }).filter(Boolean)));

        function locationForSubloc(text) {
            const q = String(text || '').trim().toLowerCase();
            if (!q) return '';
            for (let i = 0; i < rows.length; i++) {
                if (String(rows[i].sublocation || '').trim().toLowerCase() === q) return String(rows[i].location || '').trim();
            }
            return '';
        }

        function showDropdown(dd, items, mode) {
            if (!items.length) { dd.style.display = 'none'; dd.innerHTML = ''; return; }
            dd.innerHTML = items.map(function (r, idx) {
                const primary = mode === 'location' ? String(r.location || '') : String(r.sublocation || '');
                const secondary = mode === 'location' ? String(r.sublocation || '') : String(r.location || '');
                return '<div class="dropdown-option" data-loc-idx="' + idx + '"><span class="lookup-option-code">' + esc(primary) + '</span><span class="lookup-option-name">' + esc(secondary) + '</span></div>';
            }).join('');
            dd.style.display = 'block';
        }

        function findLocations(term) {
            const q = String(term || '').trim().toLowerCase();
            const out = [];
            for (let i = 0; i < uniqLocations.length; i++) {
                const loc = uniqLocations[i];
                if (!q || loc.toLowerCase().indexOf(q) !== -1) out.push({ location: loc, sublocation: '' });
                if (out.length >= 12) break;
            }
            return out;
        }

        function findSublocations(term) {
            const q = String(term || '').trim().toLowerCase();
            const selectedLoc = String(locationInput.value || '').trim().toLowerCase();
            const out = [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const sub = String(r.sublocation || '').trim();
                const loc = String(r.location || '').trim();
                if (!sub) continue;
                if (selectedLoc && loc.toLowerCase() !== selectedLoc) continue;
                const hay = (sub + ' ' + loc + ' ' + String(r.department || '')).toLowerCase();
                if (!q || hay.indexOf(q) !== -1) out.push(r);
                if (out.length >= 12) break;
            }
            return out;
        }

        locationInput.addEventListener('input', function () {
            showDropdown(locationDd, findLocations(locationInput.value), 'location');
            if (String(locationInput.value || '').trim()) {
                showDropdown(subDd, findSublocations(subInput.value), 'sub');
            }
        });

        locationInput.addEventListener('focus', function () {
            showDropdown(locationDd, findLocations(locationInput.value), 'location');
        });

        subInput.addEventListener('input', function () {
            showDropdown(subDd, findSublocations(subInput.value), 'sub');
            const inferred = locationForSubloc(subInput.value);
            if (inferred) {
                locationInput.value = inferred;
                showDropdown(locationDd, findLocations(inferred), 'location');
            }
        });

        subInput.addEventListener('focus', function () {
            showDropdown(subDd, findSublocations(subInput.value), 'sub');
        });

        locationDd.addEventListener('mousedown', function (e) {
            const opt = e.target.closest('[data-loc-idx]'); if (!opt) return; e.preventDefault();
            const pick = findLocations(locationInput.value)[Number(opt.getAttribute('data-loc-idx'))]; if (!pick) return;
            locationInput.value = pick.location;
            locationDd.style.display = 'none';
            showDropdown(subDd, findSublocations(subInput.value), 'sub');
        });

        subDd.addEventListener('mousedown', function (e) {
            const opt = e.target.closest('[data-loc-idx]'); if (!opt) return; e.preventDefault();
            const pick = findSublocations(subInput.value)[Number(opt.getAttribute('data-loc-idx'))]; if (!pick) return;
            locationInput.value = pick.location;
            subInput.value = pick.sublocation;
            subDd.style.display = 'none';
        });

        document.addEventListener('click', function (e) {
            if (!e.target.closest('.task-link-lookup')) { locationDd.style.display='none'; subDd.style.display='none'; }
        });
    }


    function syncPriorityToggleUi() {
        const row = byId('taskPriorityToggleRow');
        const sel = byId('taskPriority');
        if (!row || !sel) return;
        const current = String(sel.value || 'Medium');
        row.querySelectorAll('[data-priority]').forEach(function (btn) {
            btn.classList.toggle('active', String(btn.getAttribute('data-priority')) === current);
        });
    }

    function syncTaskColorPicker() {
        const color = byId('taskColor');
        const badge = byId('taskColorBadge');
        const grid = byId('taskColorGrid');
        if (!color || !badge || !grid) return;
        const active = String(color.value || 'teal');
        const def = getColorDef(active);
        badge.style.background = def.base;
        grid.innerHTML = TASK_BADGE_COLORS.map(function (c) {
            const cls = c.key === active ? 'task-color-chip active' : 'task-color-chip';
            return '<button type="button" class="' + cls + '" style="background:' + esc(c.base) + '" data-color-key="' + esc(c.key) + '" aria-label="' + esc(c.label) + '"></button>';
        }).join('');
    }


    function bindTaskDatePopovers() {
        const pairs = [
            { field: byId('taskStartDate'), pop: byId('taskStartDatePopover'), host: byId('taskStartCalendar') },
            { field: byId('taskDueDate'), pop: byId('taskDueDatePopover'), host: byId('taskDueCalendar') }
        ];
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const views = { taskStartDate: null, taskDueDate: null };

        function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
        function toIso(y, m, d) { return new Date(y, m, d).toISOString().slice(0, 10); }

        function renderCal(pair) {
            if (!pair || !pair.host || !pair.field) return;
            const selected = String(pair.field.value || toISODate(new Date()));
            const base = toDate(views[pair.field.id] || selected || new Date()) || new Date();
            const year = base.getFullYear();
            const month = base.getMonth();
            const firstDow = new Date(year, month, 1).getDay();
            const dim = daysInMonth(year, month);
            const cells = [];
            ['S','M','T','W','T','F','S'].forEach(function (d) { cells.push('<div class="task-cal-dow">' + d + '</div>'); });
            for (let i = 0; i < firstDow; i++) cells.push('<button type="button" class="task-cal-day muted" disabled></button>');
            for (let d = 1; d <= dim; d++) {
                const iso = toIso(year, month, d);
                const cls = iso === selected ? 'task-cal-day active' : 'task-cal-day';
                cells.push('<button type="button" class="' + cls + '" data-cal-date="' + iso + '">' + d + '</button>');
            }
            pair.host.innerHTML = '<div class=\"task-cal-pop-head\">' +
                '<button type=\"button\" data-cal-nav=\"prevYear\" aria-label=\"Previous year\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M18 6l-6 6 6 6\"></path><path d=\"M12 6l-6 6 6 6\"></path></svg></button>' +
                '<button type=\"button\" data-cal-nav=\"prev\" aria-label=\"Previous month\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M15 18l-6-6 6-6\"></path></svg></button>' +
                '<span class=\"task-cal-pop-title\">' + monthNames[month] + ' ' + year + '</span>' +
                '<button type=\"button\" data-cal-nav=\"next\" aria-label=\"Next month\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M9 6l6 6-6 6\"></path></svg></button>' +
                '<button type=\"button\" data-cal-nav=\"nextYear\" aria-label=\"Next year\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l6 6-6 6\"></path><path d=\"M12 6l6 6-6 6\"></path></svg></button>' +
                '</div><div class=\"task-cal-grid\">' + cells.join('') + '</div>';
        }

        function closeAll() { pairs.forEach(function (p) { if (p && p.pop) p.pop.classList.remove('open'); }); }

        pairs.forEach(function (pair) {
            if (!pair.field || !pair.pop || !pair.host) return;
            pair.field.addEventListener('focus', function () {
                closeAll();
                views[pair.field.id] = pair.field.value || toISODate(new Date());
                renderCal(pair);
                pair.pop.classList.add('open');
            });
            pair.field.addEventListener('click', function () {
                closeAll();
                views[pair.field.id] = pair.field.value || toISODate(new Date());
                renderCal(pair);
                pair.pop.classList.add('open');
            });
            pair.host.addEventListener('click', function (e) {
                const nav = e.target.closest('[data-cal-nav]');
                if (nav) {
                    e.preventDefault();
                    e.stopPropagation();
                    const cur = toDate(views[pair.field.id] || pair.field.value || new Date()) || new Date();
                    const navType = nav.getAttribute('data-cal-nav');
                    if (navType === 'prevYear' || navType === 'nextYear') {
                        const ystep = navType === 'prevYear' ? -1 : 1;
                        views[pair.field.id] = new Date(cur.getFullYear() + ystep, cur.getMonth(), 1).toISOString().slice(0, 10);
                    } else {
                        const step = navType === 'prev' ? -1 : 1;
                        views[pair.field.id] = new Date(cur.getFullYear(), cur.getMonth() + step, 1).toISOString().slice(0, 10);
                    }
                    renderCal(pair);
                    return;
                }
                const day = e.target.closest('[data-cal-date]');
                if (!day) return;
                pair.field.value = String(day.getAttribute('data-cal-date') || '');
                syncChecklistMasterDates();
                renderChecklistDraft();
                pair.pop.classList.remove('open');
            });
        });

        document.addEventListener('click', function (e) {
            if (e.target.closest('.task-date-field') || e.target.closest('.task-date-popover') || e.target.closest('[data-cal-nav]') || e.target.closest('[data-cal-date]')) return;
            closeAll();
        });
    }

    async function init() {

        cacheEls();
        bindEvents();
        bindTaskItemLookup();
        bindTaskLocationLookup();
        bindTaskDatePopovers();
        bootstrapInventoryHint();
        syncFilterPanelUi();
        syncZoomOutUi();
        syncZoomModeButtons();
        syncShellLayout();
        updateSortUi();
        syncTaskColorPicker();
        const colorBadge = byId('taskColorBadge');
        const colorGrid = byId('taskColorGrid');
        if (colorBadge && colorGrid) {
            colorBadge.addEventListener('click', function () { colorGrid.classList.toggle('open'); });
            colorGrid.addEventListener('click', function (e) {
                const chip = e.target.closest('[data-color-key]');
                if (!chip) return;
                byId('taskColor').value = chip.getAttribute('data-color-key') || 'teal';
                syncTaskColorPicker();
                colorGrid.classList.remove('open');
            });
            document.addEventListener('click', function (e) { if (!e.target.closest('.task-color-picker')) colorGrid.classList.remove('open'); });
        }
        await loadTasks();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
