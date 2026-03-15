(function () {
    'use strict';

    const TASK_COLUMNS = ['taskId','parentId','sortOrder','level','title','description','status','priority','assigner','assignees','startDate','dueDate','percentComplete','itemCode','itemName','location','sublocation','dependencyIds','dependencyRules','blockedByTaskId','blockReason','assignmentMode','assignmentGroup','requiredSkills','assignmentCursor','archived','createdAt','updatedAt','createdBy','colorKey','assignedAt','lastStatusChangeAt','slaHours','escalationState','escalatedAt','exceptionFlag','resourceKey','resourceCapacity','resourceConflictState'];
    const ASSIGNMENT_MODES = ['manual', 'round_robin', 'queue_claim', 'load_balanced', 'skill_based'];
    const DEFAULT_STATUS = ['all', 'Not Started', 'In Progress', 'On Hold', 'Blocked', 'Done'];
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
        taskAssignStages: [],
        taskAssignProgressByName: {},
        focusTaskId: '',
        tracksUnlocked: false,
        dragDeleteHot: false,
        bodyView: 'gantt',
        searchAutoHideTimer: null,
        checklistLoading: false,
        ganttRenderQueued: false,
        lastAssignerValue: '',
        autosaveTimer: null,
        autosaveSaving: false,
        autosaveQueued: false,
        autosaveSignature: '',
        checklistPersistMemoByTask: {},
        taskPersistMemoByTask: {},
        scheduleAnalytics: { byTaskId: {}, projectedFinishIso: '', criticalTaskIds: [] },
        addTypeMenuTaskId: ''
    };

    const els = {};

    function byId(id) { return document.getElementById(id); }
    function isoNow() { return new Date().toISOString(); }
    function toDate(v) { if (!v) return null; const raw = String(v).trim(); const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) { const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); return isNaN(d.getTime()) ? null : d; } const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
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
        // Zoom controls use static SVG icons; no dynamic label swap required.
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
        state.usingMock = true;
        return [
            {
                taskId: 'SMPL-1000',
                parentId: '',
                sortOrder: 10,
                title: 'Sample Cycle Count · Aisle A',
                description: 'Parent task shown when sheet data is unavailable.',
                status: 'In Progress',
                priority: 'High',
                assigner: 'Lead Pharmacist',
                assignees: 'Jordan Lee, Avery Kim',
                startDate: '2026-03-11',
                dueDate: '2026-03-18',
                percentComplete: 55,
                itemCode: 'NDC-00011-1111',
                itemName: 'Amoxicillin 500mg Cap',
                location: 'Main Store',
                sublocation: 'Aisle A / Shelf 3',
                dependencyIds: '',
                dependencyRules: '[]',
                colorKey: 'teal'
            },
            {
                taskId: 'SMPL-1001',
                parentId: 'SMPL-1000',
                sortOrder: 20,
                title: 'Count controlled stock',
                status: 'Not Started',
                priority: 'Critical',
                assigner: 'Lead Pharmacist',
                assignees: 'Jordan Lee',
                startDate: '2026-03-11',
                dueDate: '2026-03-13',
                percentComplete: 0,
                itemCode: 'NDC-00022-2222',
                itemName: 'Oxycodone 5mg Tab',
                location: 'Main Store',
                sublocation: 'C2 Safe',
                dependencyIds: '',
                dependencyRules: '[]',
                colorKey: 'red'
            },
            {
                taskId: 'SMPL-1002',
                parentId: 'SMPL-1000',
                sortOrder: 30,
                title: 'Reconcile variances',
                status: 'Blocked',
                priority: 'High',
                assigner: 'Lead Pharmacist',
                assignees: 'Avery Kim',
                startDate: '2026-03-13',
                dueDate: '2026-03-16',
                percentComplete: 25,
                itemCode: 'NDC-00033-3333',
                itemName: 'Insulin Glargine Pen',
                location: 'Main Store',
                sublocation: 'Cold Chain',
                dependencyIds: 'SMPL-1001',
                dependencyRules: '[{"taskId":"SMPL-1001","type":"FS","lagDays":0}]',
                blockedByTaskId: 'SMPL-1001',
                blockReason: 'Awaiting controlled stock count sign-off',
                colorKey: 'orange'
            },
            {
                taskId: 'SMPL-1003',
                parentId: 'SMPL-1000',
                sortOrder: 40,
                title: 'Prepare replenishment transfer',
                status: 'On Hold',
                priority: 'Medium',
                assigner: 'Operations Manager',
                assignees: 'Noah Patel, Maya Chen',
                startDate: '2026-03-16',
                dueDate: '2026-03-18',
                percentComplete: 10,
                itemCode: 'NDC-00044-4444',
                itemName: 'Metformin 1000mg Tab',
                location: 'Overflow',
                sublocation: 'Bin 12',
                dependencyIds: 'SMPL-1002',
                dependencyRules: '[{"taskId":"SMPL-1002","type":"FS","lagDays":1}]',
                colorKey: 'purple'
            },
            {
                taskId: 'SMPL-2000',
                parentId: '',
                sortOrder: 50,
                title: 'Satellite Fridge QA Sweep',
                status: 'Done',
                priority: 'Low',
                assigner: 'QA Team',
                assignees: 'Maya Chen',
                startDate: '2026-03-08',
                dueDate: '2026-03-10',
                percentComplete: 100,
                itemCode: 'NDC-00055-5555',
                itemName: 'Shingrix Vaccine',
                location: 'Satellite Clinic',
                sublocation: 'Fridge B',
                dependencyIds: '',
                dependencyRules: '[]',
                colorKey: 'green'
            }
        ];
    }

    function syncMockBanner() {
        if (!els.mockBanner) return;
        els.mockBanner.style.display = state.usingMock ? 'block' : 'none';
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
            const handoffBody = raw.slice(1, -1);
            if (handoffBody.indexOf('>') >= 0) {
                return handoffBody.replace(/["']/g, '').split('>').join(',').split(/[|,;\n]/).map(clean).filter(Boolean);
            }
        }
        return raw.split(/[|,;\n]/).map(clean).filter(Boolean);
    }

    function parseSkills(value) {
        if (Array.isArray(value)) {
            return value.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
        }
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return [];
        if (raw.charAt(0) === '[') {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
            } catch (_) {}
        }
        return raw.split(/[|,;\n]/).map(function (v) { return String(v || '').trim(); }).filter(Boolean);
    }

    function normalizeResourceConflictState(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'critical' || raw === 'block' || raw === 'blocked' || raw === 'critical_block') return 'critical';
        if (raw === 'warning' || raw === 'warn') return 'warning';
        return '';
    }

    function normalizeResourceCapacity(value) {
        const cap = Number(value);
        if (!Number.isFinite(cap) || cap < 1) return 1;
        return Math.max(1, Math.round(cap));
    }

    function serializeAssignees(list) {
        return JSON.stringify((Array.isArray(list) ? list : []).map(function (v) { return String(v || '').trim(); }).filter(Boolean));
    }



    function serializeAssigneeFlowForSheet(stages, fallbackList) {
        const cleanStages = (Array.isArray(stages) ? stages : []).map(function (st) {
            return (Array.isArray(st) ? st : []).map(function (v) { return String(v || '').trim(); }).filter(Boolean);
        }).filter(function (st) { return st.length; });
        if (cleanStages.length >= 2) {
            const left = cleanStages[0].map(function (n) { return '\"' + n + '\"'; }).join(',');
            const right = cleanStages[1].map(function (n) { return '\"' + n + '\"'; }).join(',');
            return '[' + left + '>' + right + ']';
        }
        return JSON.stringify((Array.isArray(fallbackList) ? fallbackList : []).map(function (v) { return String(v || '').trim(); }).filter(Boolean));
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



    function normalizeDependencyRulesForTask(out) {
        const depIds = String(out.dependencyIds || '').trim();
        let parsed = [];
        if (Array.isArray(out.dependencyRules)) parsed = out.dependencyRules;
        else {
            const raw = String(out.dependencyRules == null ? '' : out.dependencyRules).trim();
            if (raw) {
                try {
                    const candidate = JSON.parse(raw);
                    if (Array.isArray(candidate)) parsed = candidate;
                } catch (_) {}
            }
        }

        const normalized = parsed.map(function (rule) {
            const predecessorTaskId = String((rule && rule.predecessorTaskId) || '').trim();
            if (!predecessorTaskId) return null;
            const typeRaw = String((rule && rule.type) || 'FS').trim().toUpperCase();
            const type = (typeRaw === 'SS' || typeRaw === 'FF' || typeRaw === 'FS') ? typeRaw : 'FS';
            const lagNum = Number(rule && rule.lagDays);
            return { predecessorTaskId: predecessorTaskId, type: type, lagDays: Number.isFinite(lagNum) ? lagNum : 0 };
        }).filter(Boolean);

        if (!normalized.length && depIds) {
            depIds.split(/[|,;\n]/).map(function (v) { return String(v || '').trim(); }).filter(Boolean).forEach(function (id) {
                normalized.push({ predecessorTaskId: id, type: 'FS', lagDays: 0 });
            });
        }

        out.dependencyRulesParsed = normalized;
        out.dependencyRules = JSON.stringify(normalized);
    }

    function parseDependencyRulesStrict(rawValue) {
        if (Array.isArray(rawValue)) rawValue = JSON.stringify(rawValue);
        const raw = String(rawValue == null ? '' : rawValue).trim();
        if (!raw) return { ok: true, rules: [] };
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (_) {
            return { ok: false, error: 'Dependency Rules must be valid JSON.' };
        }
        if (!Array.isArray(parsed)) {
            return { ok: false, error: 'Dependency Rules must be a JSON array.' };
        }
        const rules = [];
        for (let i = 0; i < parsed.length; i++) {
            const rule = parsed[i] || {};
            const predecessorTaskId = String(rule.predecessorTaskId || '').trim();
            if (!predecessorTaskId) return { ok: false, error: 'Each dependency rule needs a predecessorTaskId.' };
            const typeRaw = String(rule.type || 'FS').trim().toUpperCase();
            if (typeRaw !== 'FS' && typeRaw !== 'SS' && typeRaw !== 'FF') {
                return { ok: false, error: 'Dependency rule type must be FS, SS, or FF.' };
            }
            const lagNum = Number(rule.lagDays);
            if (!Number.isFinite(lagNum)) return { ok: false, error: 'Dependency rule lagDays must be a number.' };
            rules.push({ predecessorTaskId: predecessorTaskId, type: typeRaw, lagDays: lagNum });
        }
        return { ok: true, rules: rules };
    }

    function detectDependencyCycle(taskList) {
        const activeTasks = (Array.isArray(taskList) ? taskList : []).filter(function (task) { return !(task && task.archived); });
        const byId = {};
        activeTasks.forEach(function (task) { byId[String(task.taskId || '').trim()] = task; });

        const graph = {};
        Object.keys(byId).forEach(function (taskId) { graph[taskId] = []; });
        Object.keys(byId).forEach(function (taskId) {
            const task = byId[taskId] || {};
            const rules = Array.isArray(task.dependencyRulesParsed) ? task.dependencyRulesParsed : [];
            rules.forEach(function (rule) {
                const predecessorTaskId = String((rule && rule.predecessorTaskId) || '').trim();
                if (!predecessorTaskId) return;
                if (!byId[predecessorTaskId]) {
                    const label = String(task.title || taskId).trim() || taskId;
                    throw new Error('Task "' + label + '" depends on missing task ID "' + predecessorTaskId + '".');
                }
                graph[predecessorTaskId].push(taskId);
            });
        });

        const visiting = {};
        const visited = {};
        const stack = [];
        let cyclePath = null;

        function dfs(nodeId) {
            if (cyclePath) return;
            visiting[nodeId] = true;
            stack.push(nodeId);
            const next = graph[nodeId] || [];
            for (let i = 0; i < next.length; i++) {
                const targetId = next[i];
                if (visited[targetId]) continue;
                if (visiting[targetId]) {
                    const start = stack.indexOf(targetId);
                    cyclePath = stack.slice(start >= 0 ? start : 0).concat(targetId);
                    return;
                }
                dfs(targetId);
                if (cyclePath) return;
            }
            stack.pop();
            visiting[nodeId] = false;
            visited[nodeId] = true;
        }

        const ids = Object.keys(graph);
        for (let i = 0; i < ids.length; i++) {
            if (visited[ids[i]]) continue;
            dfs(ids[i]);
            if (cyclePath) break;
        }

        return { hasCycle: !!cyclePath, path: cyclePath || [] };
    }

    function validateTaskDependenciesBeforeSave(payload) {
        const parsed = parseDependencyRulesStrict(payload.dependencyRules);
        if (!parsed.ok) return parsed;
        payload.dependencyRules = JSON.stringify(parsed.rules);

        const taskSnapshot = state.tasks.map(function (task) { return Object.assign({}, task); });
        const idx = taskSnapshot.findIndex(function (t) { return t.taskId === payload.taskId; });
        const normalizedPayload = normalizeTask(payload, idx >= 0 ? idx : taskSnapshot.length);
        if (idx >= 0) taskSnapshot[idx] = normalizedPayload;
        else taskSnapshot.push(normalizedPayload);

        let cycleCheck;
        try {
            cycleCheck = detectDependencyCycle(taskSnapshot);
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : 'Invalid dependency rules.' };
        }
        if (!cycleCheck.hasCycle) return { ok: true, rules: parsed.rules };

        const labelById = {};
        taskSnapshot.forEach(function (task) {
            labelById[task.taskId] = String(task.title || '').trim() ? (task.title + ' (' + task.taskId + ')') : task.taskId;
        });
        const cycleText = cycleCheck.path.map(function (id) { return labelById[id] || id; }).join(' → ');
        return { ok: false, error: 'Dependency cycle detected. Example cycle: ' + cycleText };
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
        out.assignedAt = out.assignedAt || '';
        out.lastStatusChangeAt = out.lastStatusChangeAt || '';
        out.slaHours = out.slaHours == null ? '' : out.slaHours;
        out.escalationState = String(out.escalationState || '');
        out.escalatedAt = out.escalatedAt || '';
        out.exceptionFlag = String(out.exceptionFlag || '').toLowerCase() === 'true';
        out.blockedByTaskId = String(out.blockedByTaskId || '');
        out.blockReason = String(out.blockReason || '');
        const assignmentModeRaw = String(out.assignmentMode || 'manual').trim().toLowerCase();
        out.assignmentMode = ASSIGNMENT_MODES.indexOf(assignmentModeRaw) >= 0 ? assignmentModeRaw : 'manual';
        out.assignmentGroup = String(out.assignmentGroup || '');
        out.requiredSkills = parseSkills(out.requiredSkills);
        out.assignmentCursor = String(out.assignmentCursor || '');
        out.colorKey = String(out.colorKey || 'teal');
        out.resourceKey = String(out.resourceKey || '').trim();
        out.resourceCapacity = normalizeResourceCapacity(out.resourceCapacity);
        out.resourceConflictState = normalizeResourceConflictState(out.resourceConflictState);
        out.hasResourceConflict = String(out.hasResourceConflict || '').toLowerCase() === 'true' || out.hasResourceConflict === true;
        out.resourceConflictPeak = Number(out.resourceConflictPeak || 0);
        normalizeDependencyRulesForTask(out);
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

    function dateRangeOverlaps(aStart, aDue, bStart, bDue) {
        const as = toDate(aStart);
        const ad = toDate(aDue);
        const bs = toDate(bStart);
        const bd = toDate(bDue);
        if (!as || !ad || !bs || !bd) return false;
        return as <= bd && bs <= ad;
    }

    function recomputeResourceConflicts(tasks) {
        const list = Array.isArray(tasks) ? tasks : [];
        const byKey = {};
        list.forEach(function (task) {
            task.hasResourceConflict = false;
            task.resourceConflictPeak = 0;
            const key = String(task.resourceKey || '').trim();
            if (!key || task.archived) return;
            if (!byKey[key]) byKey[key] = [];
            byKey[key].push(task);
        });
        Object.keys(byKey).forEach(function (key) {
            const group = byKey[key];
            const capacity = group.reduce(function (max, t) { return Math.max(max, normalizeResourceCapacity(t.resourceCapacity)); }, 1);
            group.forEach(function (task) {
                let concurrent = 0;
                for (let i = 0; i < group.length; i++) {
                    if (dateRangeOverlaps(task.startDate, task.dueDate, group[i].startDate, group[i].dueDate)) concurrent += 1;
                }
                task.resourceConflictPeak = concurrent;
                task.hasResourceConflict = concurrent > capacity;
            });
        });
    }

    function getResourceConflictForTask(candidate, sourceTasks) {
        const key = String((candidate && candidate.resourceKey) || '').trim();
        if (!key) return { hasConflict: false, peak: 0, capacity: normalizeResourceCapacity(candidate && candidate.resourceCapacity) };
        const pool = (Array.isArray(sourceTasks) ? sourceTasks : []).filter(function (task) {
            return !task.archived && String(task.resourceKey || '').trim() === key;
        });
        const capacity = Math.max(
            normalizeResourceCapacity(candidate && candidate.resourceCapacity),
            pool.reduce(function (max, t) { return Math.max(max, normalizeResourceCapacity(t.resourceCapacity)); }, 1)
        );
        let concurrent = 1;
        for (let i = 0; i < pool.length; i++) {
            if (candidate && pool[i] && String(pool[i].taskId || '') === String(candidate.taskId || '')) continue;
            if (dateRangeOverlaps(candidate.startDate, candidate.dueDate, pool[i].startDate, pool[i].dueDate)) concurrent += 1;
        }
        return { hasConflict: concurrent > capacity, peak: concurrent, capacity: capacity };
    }

    function syncAssignmentPanelVisibility() {
        const mode = String((byId('taskAssignmentMode') && byId('taskAssignmentMode').value) || 'manual').trim();
        const config = byId('taskAssignmentConfig');
        if (config) config.style.display = mode === 'manual' ? 'none' : 'grid';
        const skillsWrap = byId('taskRequiredSkillsWrap');
        if (skillsWrap) skillsWrap.style.display = mode === 'skill_based' ? '' : 'none';
    }

    function assignmentPanelToPayload(payload) {
        const modeEl = byId('taskAssignmentMode');
        const groupEl = byId('taskAssignmentGroup');
        const skillsEl = byId('taskRequiredSkills');
        const cursorEl = byId('taskAssignmentCursor');
        const modeRaw = String(modeEl ? modeEl.value : 'manual').trim().toLowerCase();
        payload.assignmentMode = ASSIGNMENT_MODES.indexOf(modeRaw) >= 0 ? modeRaw : 'manual';
        payload.assignmentGroup = String(groupEl ? groupEl.value : '').trim();
        payload.requiredSkills = parseSkills(skillsEl ? skillsEl.value : '');
        payload.assignmentCursor = String(cursorEl ? cursorEl.value : '').trim();
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
            state.tasks = emptyFallbackTasks().map(normalizeTask);
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
            recomputeResourceConflicts(state.tasks);
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
        state.scheduleAnalytics = buildScheduleAnalytics(state.filtered);
        renderTaskInsights(state.scheduleAnalytics);
        syncMockBanner();
        renderList();
        renderReportView();
        renderKanbanView();
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

        const assignmentModeEl = byId('taskAssignmentMode');
        if (assignmentModeEl && !assignmentModeEl.options.length) {
            assignmentModeEl.innerHTML = ASSIGNMENT_MODES.map(function (m) {
                return '<option value="' + esc(m) + '">' + esc(m) + '</option>';
            }).join('');
        }

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
        if (s === 'blocked' || s === 'on hold' || s === 'waiting') return 'status-blocked';
        if (s === 'done') return 'status-done';
        return 'status-not-started';
    }

    function isDateDragFrozen(task) {
        const status = String((task && task.status) || '').toLowerCase();
        return status === 'blocked' || status === 'on hold';
    }

    function hasBlockingTask(task) {
        const status = String((task && task.status) || '').toLowerCase();
        return status === 'blocked';
    }

    function getDownstreamDependentTaskIds(rootTaskId) {
        const visited = {};
        const queue = [String(rootTaskId || '').trim()];
        const out = [];
        while (queue.length) {
            const currentId = queue.shift();
            if (!currentId || visited[currentId]) continue;
            visited[currentId] = true;
            for (let i = 0; i < state.tasks.length; i++) {
                const candidate = state.tasks[i];
                const rules = Array.isArray(candidate.dependencyRulesParsed) ? candidate.dependencyRulesParsed : [];
                const dependsOnCurrent = rules.some(function (rule) {
                    return String((rule && rule.predecessorTaskId) || '').trim() === currentId;
                });
                if (!dependsOnCurrent) continue;
                const candidateId = String(candidate.taskId || '').trim();
                if (!candidateId || visited[candidateId]) continue;
                out.push(candidateId);
                queue.push(candidateId);
            }
        }
        return out;
    }

    async function applyOnHoldBlocking(rootTaskId) {
        const rootId = String(rootTaskId || '').trim();
        if (!rootId) return;
        const rootTask = state.tasks.find(function (t) { return String(t.taskId) === rootId; });
        const blockerTitle = rootTask ? String(rootTask.title || rootId).trim() : rootId;
        const downstreamIds = getDownstreamDependentTaskIds(rootId);
        for (let i = 0; i < downstreamIds.length; i++) {
            const task = state.tasks.find(function (t) { return String(t.taskId) === downstreamIds[i]; });
            if (!task || task.archived || isDoneStatus(task)) continue;
            const nextStatus = String(task.status || '').trim().toLowerCase() === 'waiting' ? 'Waiting' : 'Blocked';
            const nextReason = 'Blocked by On Hold dependency: ' + blockerTitle;
            if (task.status === nextStatus && task.blockedByTaskId === rootId && task.blockReason === nextReason) continue;
            task.status = nextStatus;
            task.blockedByTaskId = rootId;
            task.blockReason = nextReason;
            task.updatedAt = isoNow();
            await writeTask('updateTask', {
                taskId: task.taskId,
                status: task.status,
                blockedByTaskId: task.blockedByTaskId,
                blockReason: task.blockReason,
                updatedAt: task.updatedAt
            });
        }
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
        byId('taskStartDate').value = parent.dueDate ? shiftIsoDate(parent.dueDate, 1) : (parent.startDate || toISODate(new Date()));
        byId('taskDueDate').value = shiftIsoDate(byId('taskStartDate').value, 2);
        byId('taskLocation').value = parent.location || '';
        byId('taskSublocation').value = parent.sublocation || '';
        byId('taskItemCode').value = parent.itemCode || '';
        byId('taskItemName').value = parent.itemName || '';
        autoSizeItemCodeInput(byId('taskItemName').value || byId('taskItemCode').value);
    }


    function getSiblingTasksForRow(task) {
        return state.tasks.filter(function (t) {
            if (!t || t.archived || !task) return false;
            if (String(t.taskId || '') === String(task.taskId || '')) return false;
            return String(t.parentId || '') === String(task.parentId || '');
        });
    }

    function ensureNoRowOverlap(range, rowTasks, ignoreTaskId) {
        const out = { startDate: range.startDate, dueDate: range.dueDate };
        const ordered = (rowTasks || []).slice().sort(function (a, b) {
            return String(a.startDate || '').localeCompare(String(b.startDate || ''));
        });
        for (let i = 0; i < ordered.length; i++) {
            const t = ordered[i];
            if (String(t.taskId || '') === String(ignoreTaskId || '')) continue;
            if (!t.startDate || !t.dueDate) continue;
            if (dateRangeOverlaps(out.startDate, out.dueDate, t.startDate, t.dueDate)) {
                out.startDate = shiftIsoDate(t.dueDate, 1);
                out.dueDate = shiftIsoDate(out.startDate, 2);
            }
        }
        return out;
    }

    async function shiftTaskAndDescendantsByDays(task, days) {
        if (!task || !days) return;
        task.startDate = shiftIsoDate(task.startDate, days);
        task.dueDate = shiftIsoDate(task.dueDate, days);
        task.updatedAt = isoNow();
        await writeTask('updateTask', task);
        const children = getChildTasks(task.taskId);
        for (let i = 0; i < children.length; i++) {
            await shiftTaskAndDescendantsByDays(children[i], days);
        }
    }

    async function createLinkedTimelineTask(predecessorId, mode) {
        const predecessor = state.tasks.find(function (t) { return String(t.taskId || '') === String(predecessorId || ''); });
        if (!predecessor) return;
        ensureTaskDates(predecessor);

        const desiredStart = shiftIsoDate(predecessor.dueDate, 1);
        const range = { startDate: desiredStart, dueDate: shiftIsoDate(desiredStart, 2) };

        const payload = normalizeTask({
            taskId: 'TASK-' + Date.now(),
            parentId: predecessor.parentId || '',
            sortOrder: Number(predecessor.sortOrder || 0) + (mode === 'contingency' ? 2 : 1),
            level: predecessor.level || 0,
            title: mode === 'contingency' ? ('Contingency · ' + (predecessor.title || 'Task')) : ('Successor · ' + (predecessor.title || 'Task')),
            description: mode === 'contingency' ? 'Contingency task for blocked predecessor.' : 'Successor task generated from predecessor.',
            status: 'Waiting',
            priority: predecessor.priority || 'Medium',
            assigner: predecessor.assigner || '',
            assignees: '',
            startDate: range.startDate,
            dueDate: range.dueDate,
            percentComplete: 0,
            itemCode: predecessor.itemCode || '',
            itemName: predecessor.itemName || '',
            location: predecessor.location || '',
            sublocation: predecessor.sublocation || '',
            dependencyIds: predecessor.taskId,
            dependencyRules: JSON.stringify([{ predecessorTaskId: predecessor.taskId, type: 'FS', lagDays: 0 }]),
            blockedByTaskId: predecessor.taskId,
            blockReason: 'Waiting for predecessor to complete.',
            colorKey: predecessor.colorKey || 'teal',
            createdBy: 'task-manager'
        }, state.tasks.length);

        state.tasks.push(payload);
        await writeTask('createTask', payload);

        const dependents = state.tasks.filter(function (t) {
            if (String(t.taskId || '') === String(payload.taskId || '')) return false;
            const depIds = String(t.dependencyIds || '');
            if (depIds.split(',').map(function (x) { return x.trim(); }).indexOf(String(predecessor.taskId || '')) === -1) return false;
            if (!t.startDate || !t.dueDate) return false;
            return toDate(t.startDate) <= toDate(payload.dueDate);
        });
        for (let i = 0; i < dependents.length; i++) {
            const nextStart = shiftIsoDate(payload.dueDate, 1);
            const deltaDays = Math.round((toDate(nextStart) - toDate(dependents[i].startDate)) / DAY_MS);
            if (deltaDays > 0) await shiftTaskAndDescendantsByDays(dependents[i], deltaDays);
        }

        applyFilters();
    }

    function closeAddTypeMenu() {
        const menu = byId('tasksAddTypeMenu');
        if (!menu) return;
        menu.classList.remove('open');
        state.addTypeMenuTaskId = '';
    }

    function openAddTypeMenu(taskId, anchorEl) {
        const menu = byId('tasksAddTypeMenu');
        const predecessor = state.tasks.find(function (t) { return String(t.taskId || '') === String(taskId || ''); });
        if (!menu || !predecessor || !anchorEl) return;
        const blocked = String(predecessor.status || '').toLowerCase() === 'blocked';
        const opts = [
            '<button class="tasks-addtype-btn" type="button" data-addtype="child">Child Task</button>',
            '<button class="tasks-addtype-btn" type="button" data-addtype="successor">Successor</button>'
        ];
        if (blocked) opts.push('<button class="tasks-addtype-btn" type="button" data-addtype="contingency">Contingency Task</button>');
        menu.innerHTML = opts.join('');
        const rect = anchorEl.getBoundingClientRect();
        menu.style.left = Math.round(rect.left + window.scrollX + 8) + 'px';
        menu.style.top = Math.round(rect.bottom + window.scrollY + 6) + 'px';
        menu.classList.add('open');
        state.addTypeMenuTaskId = predecessor.taskId;
    }

    function renderReportView() {
        const wrap = byId('tasksPrintView');
        if (!wrap) return;
        if (state.bodyView !== 'report') { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        const rows = state.flatRows.map(function (r) {
            const t = r.task;
            return '<tr>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.taskId || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.title) + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc((Array.isArray(t.assignees) ? t.assignees.join(', ') : (t.assignee || '')) || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.status || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.priority || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.itemCode || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.location || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.startDate || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.dueDate || '') + '</td>' +
                '<td style=\"padding:6px;border-bottom:1px solid rgba(160,160,160,0.2)\">' + esc(t.blockedByTaskId || '') + '</td>' +
            '</tr>';
        }).join('');
        wrap.innerHTML = '<div style=\"font-weight:800;margin-bottom:10px;\">Task reports view</div>' +
            '<table style=\"width:100%;border-collapse:collapse;font-size:12px;\">' +
            '<thead><tr><th style=\"text-align:left;padding:6px;\">Task ID</th><th style=\"text-align:left;padding:6px;\">Title</th><th style=\"text-align:left;padding:6px;\">Assignees</th><th style=\"text-align:left;padding:6px;\">Status</th><th style=\"text-align:left;padding:6px;\">Priority</th><th style=\"text-align:left;padding:6px;\">Item</th><th style=\"text-align:left;padding:6px;\">Location</th><th style=\"text-align:left;padding:6px;\">Start</th><th style=\"text-align:left;padding:6px;\">Due</th><th style=\"text-align:left;padding:6px;\">Blocked By</th></tr></thead>' +
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
            const escalState = String(task.escalationState || '').toLowerCase();
            const escalBadge = escalState === 'escalated'
                ? '<span class="checklist-badge status-blocked" style="margin-left:6px;">Escalated</span>'
                : (escalState === 'overdue' ? '<span class="checklist-badge status-not-started" style="margin-left:6px;">Overdue</span>' : '');
            const resourceBadge = task.hasResourceConflict ? '<span class="checklist-badge status-blocked" style="margin-left:6px;">Resource conflict</span>' : '';
            const isFocused = String(state.focusTaskId || '') === String(task.taskId || '');
            return '<div class="tasks-row ' + depthClass + (isFocused ? ' active' : '') + '" data-task-id="' + esc(task.taskId) + '">' +
                '<button class="tree-toggle" data-toggle="' + esc(task.taskId) + '"></button>' +
                '<div class="task-title-wrap" style="padding-left:' + indent + 'px">' + connector + '<span class="task-title" title="' + esc(task.title) + '"><span class="task-color-badge" style="background:' + esc(badge) + '"></span>' + esc(task.title) + escalBadge + resourceBadge + '</span></div>' +
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

    function buildScheduleAnalytics(taskList) {
        const tasks = (Array.isArray(taskList) ? taskList : []).filter(function (task) { return task && !task.archived; });
        const byTaskId = {};
        const successors = {};
        const indegree = {};
        const nodes = [];

        tasks.forEach(function (task) {
            const taskId = String(task.taskId || '').trim();
            if (!taskId) return;
            const start = toDate(task.startDate);
            const due = toDate(task.dueDate) || start;
            if (!start || !due) return;
            const durDays = Math.max(1, Math.round((startOfDay(due) - startOfDay(start)) / DAY_MS) + 1);
            const rec = {
                task: task,
                taskId: taskId,
                startMs: startOfDay(start).getTime(),
                dueMs: startOfDay(due).getTime(),
                durationMs: durDays * DAY_MS,
                es: startOfDay(start).getTime(),
                ef: startOfDay(start).getTime() + ((durDays - 1) * DAY_MS),
                ls: 0,
                lf: 0,
                floatDays: null,
                isCritical: false
            };
            byTaskId[taskId] = rec;
            successors[taskId] = [];
            indegree[taskId] = 0;
            nodes.push(taskId);
        });

        nodes.forEach(function (taskId) {
            const node = byTaskId[taskId];
            const rules = Array.isArray(node.task.dependencyRulesParsed) ? node.task.dependencyRulesParsed : [];
            rules.forEach(function (rule) {
                const predId = String((rule && rule.predecessorTaskId) || '').trim();
                if (!predId || !byTaskId[predId]) return;
                successors[predId].push({ successorId: taskId, type: String((rule && rule.type) || 'FS').toUpperCase(), lagDays: Number(rule && rule.lagDays) || 0 });
                indegree[taskId] += 1;
            });
        });

        const queue = [];
        Object.keys(indegree).forEach(function (k) { if (indegree[k] === 0) queue.push(k); });
        const topo = [];
        while (queue.length) {
            const id = queue.shift();
            topo.push(id);
            (successors[id] || []).forEach(function (edge) {
                indegree[edge.successorId] -= 1;
                if (indegree[edge.successorId] === 0) queue.push(edge.successorId);
            });
        }
        if (topo.length !== nodes.length) {
            topo.length = 0;
            Array.prototype.push.apply(topo, nodes);
        }

        topo.forEach(function (taskId) {
            const node = byTaskId[taskId];
            let earliestStart = node.startMs;
            const rules = Array.isArray(node.task.dependencyRulesParsed) ? node.task.dependencyRulesParsed : [];
            rules.forEach(function (rule) {
                const pred = byTaskId[String((rule && rule.predecessorTaskId) || '').trim()];
                if (!pred) return;
                const lagMs = (Number(rule && rule.lagDays) || 0) * DAY_MS;
                const type = String((rule && rule.type) || 'FS').toUpperCase();
                if (type === 'SS') earliestStart = Math.max(earliestStart, pred.es + lagMs);
                else if (type === 'FF') earliestStart = Math.max(earliestStart, (pred.ef + lagMs) - (node.durationMs - DAY_MS));
                else earliestStart = Math.max(earliestStart, pred.ef + lagMs + DAY_MS);
            });
            node.es = earliestStart;
            node.ef = earliestStart + (node.durationMs - DAY_MS);
        });

        let projectFinish = 0;
        nodes.forEach(function (taskId) { projectFinish = Math.max(projectFinish, byTaskId[taskId].ef); });
        if (!projectFinish) return { byTaskId: {}, projectedFinishIso: '', criticalTaskIds: [] };

        topo.slice().reverse().forEach(function (taskId) {
            const node = byTaskId[taskId];
            const out = successors[taskId] || [];
            let latestFinish = projectFinish;
            if (out.length) {
                latestFinish = Number.POSITIVE_INFINITY;
                out.forEach(function (edge) {
                    const succ = byTaskId[edge.successorId];
                    if (!succ) return;
                    const lagMs = (Number(edge.lagDays) || 0) * DAY_MS;
                    const type = String(edge.type || 'FS').toUpperCase();
                    let candidateFinish = projectFinish;
                    if (type === 'SS') candidateFinish = (succ.ls - lagMs) + (node.durationMs - DAY_MS);
                    else if (type === 'FF') candidateFinish = succ.lf - lagMs;
                    else candidateFinish = succ.ls - lagMs - DAY_MS;
                    latestFinish = Math.min(latestFinish, candidateFinish);
                });
                if (!Number.isFinite(latestFinish)) latestFinish = projectFinish;
            }
            node.lf = latestFinish;
            node.ls = latestFinish - (node.durationMs - DAY_MS);
            node.floatDays = Math.round((node.ls - node.es) / DAY_MS);
            node.isCritical = node.floatDays === 0;
        });

        const criticalTaskIds = nodes.filter(function (taskId) { return byTaskId[taskId].isCritical; });
        return { byTaskId: byTaskId, projectedFinishIso: toISODate(new Date(projectFinish)), criticalTaskIds: criticalTaskIds };
    }

    function aggregateBottleneckDwell(taskList) {
        const tasks = Array.isArray(taskList) ? taskList : [];
        const buckets = {};
        function add(key, label, hours) {
            if (!key || !hours) return;
            if (!buckets[key]) buckets[key] = { label: label, hours: 0 };
            buckets[key].hours += hours;
        }

        tasks.forEach(function (task) {
            if (!task || task.archived) return;
            const stampKeys = ['createdAt', 'assignedAt', 'lastStatusChangeAt', 'updatedAt', 'escalatedAt'];
            const stamps = stampKeys.map(function (k) { return toDate(task[k]); }).filter(Boolean).map(function (d) { return d.getTime(); }).sort(function (a, b) { return a - b; });
            let dwellHours = 0;
            if (stamps.length >= 2) dwellHours = Math.max(0, (stamps[stamps.length - 1] - stamps[0]) / 3600000);
            if (!dwellHours) {
                const s = toDate(task.startDate);
                const d = toDate(task.dueDate);
                if (s && d) dwellHours = Math.max(0, ((startOfDay(d) - startOfDay(s)) / 3600000) + 24);
            }
            if (!dwellHours) return;

            const status = String(task.status || 'Unknown').trim() || 'Unknown';
            const assignee = (Array.isArray(task.assignees) && task.assignees[0]) ? String(task.assignees[0]) : (String(task.assignee || '').trim() || 'Unassigned');
            const location = String(task.location || task.sublocation || 'Unspecified').trim() || 'Unspecified';
            add('status:' + status, 'Status · ' + status, dwellHours);
            add('assignee:' + assignee, 'Assignee · ' + assignee, dwellHours);
            add('location:' + location, 'Location · ' + location, dwellHours);
        });

        return Object.keys(buckets).map(function (k) { return buckets[k]; }).sort(function (a, b) { return b.hours - a.hours; });
    }

    function renderTaskInsights(analytics) {
        if (!byId('tasksCriticalSummaryCard')) return;
        const projectedEl = byId('tasksProjectedCompletion');
        const metaEl = byId('tasksCriticalSensitivityMeta');
        const chipsEl = byId('tasksCriticalChipRow');
        const listEl = byId('tasksBottleneckList');
        if (!projectedEl || !metaEl || !chipsEl || !listEl) return;

        const byTask = (analytics && analytics.byTaskId) || {};
        const ids = Object.keys(byTask);
        if (!ids.length) {
            projectedEl.textContent = 'Projected completion: —';
            metaEl.textContent = 'Awaiting task dates.';
            chipsEl.innerHTML = '';
            listEl.innerHTML = '<li class="tasks-insight-meta">No timeline data available.</li>';
            return;
        }

        const criticalIds = (analytics && analytics.criticalTaskIds) || [];
        const projected = analytics && analytics.projectedFinishIso ? analytics.projectedFinishIso : '—';
        const minFloat = ids.reduce(function (acc, id) {
            const v = byTask[id] && Number(byTask[id].floatDays);
            if (!Number.isFinite(v)) return acc;
            return Math.min(acc, v);
        }, Number.POSITIVE_INFINITY);
        const positiveFloats = ids.map(function (id) { return byTask[id] && byTask[id].floatDays; }).filter(function (v) { return Number.isFinite(v) && v > 0; });
        const avgPositiveFloat = positiveFloats.length ? Math.round(positiveFloats.reduce(function (a, b) { return a + b; }, 0) / positiveFloats.length) : 0;

        projectedEl.textContent = 'Projected completion: ' + projected;
        metaEl.textContent = criticalIds.length
            ? (criticalIds.length + ' zero-float task(s) on the critical path; a 1-day slip there likely shifts completion by ~1 day.')
            : 'No zero-float tasks currently detected; schedule has slack buffer.';
        chipsEl.innerHTML = [
            '<span class="tasks-chip">Critical path tasks: <strong>' + criticalIds.length + '</strong></span>',
            '<span class="tasks-chip">Tightest float: <strong>' + (Number.isFinite(minFloat) ? (minFloat + 'd') : '—') + '</strong></span>',
            '<span class="tasks-chip">Avg slack (non-critical): <strong>' + (avgPositiveFloat ? (avgPositiveFloat + 'd') : '0d') + '</strong></span>'
        ].join('');

        const ranked = aggregateBottleneckDwell(state.filtered).slice(0, 8);
        if (!ranked.length) {
            listEl.innerHTML = '<li class="tasks-insight-meta">No timeline data available.</li>';
            return;
        }
        const peak = ranked[0].hours || 1;
        listEl.innerHTML = ranked.map(function (row) {
            const pct = Math.max(8, Math.round((row.hours / peak) * 100));
            return '<li class="tasks-rank-item">' +
                '<div class="tasks-rank-track"><span class="tasks-rank-fill" style="width:' + pct + '%"></span><span class="tasks-rank-label">' + esc(row.label) + '</span></div>' +
                '<span class="tasks-rank-value">' + Math.round(row.hours) + 'h</span>' +
            '</li>';
        }).join('');
    }


    function renderKanbanView() {
        const wrap = byId('tasksKanbanView');
        if (!wrap) return;
        if (state.bodyView !== 'kanban') { wrap.classList.remove('visible'); wrap.innerHTML = ''; return; }
        wrap.classList.add('visible');
        const columns = [
            { key: 'Not Started', label: 'To Do' },
            { key: 'In Progress', label: 'Doing' },
            { key: 'Blocked', label: 'Blocked' },
            { key: 'Done', label: 'Done' }
        ];
        wrap.innerHTML = columns.map(function (col) {
            const tasks = state.filtered.filter(function (t) { return String(t.status || 'Not Started') === col.key; });
            const cards = tasks.map(function (t) {
                const color = getColorDef(t.colorKey).base;
                const assignees = Array.isArray(t.assignees) ? t.assignees.join(', ') : (t.assignee || 'Unassigned');
                return '<div class="tasks-kanban-card" style="border-left:4px solid ' + esc(color) + '">' +
                    '<div class="tasks-kanban-title">' + esc(t.title || t.taskId) + '</div>' +
                    '<div class="tasks-kanban-meta">#' + esc(t.taskId || '') + ' · ' + esc(t.priority || 'Medium') + '</div>' +
                    '<div class="tasks-kanban-meta">Assignees: ' + esc(assignees || 'Unassigned') + '</div>' +
                    '<div class="tasks-kanban-meta">Item: ' + esc(t.itemCode || '—') + ' · ' + esc(t.itemName || '—') + '</div>' +
                    '<div class="tasks-kanban-meta">Location: ' + esc(t.location || '—') + ' / ' + esc(t.sublocation || '—') + '</div>' +
                    '<div class="tasks-kanban-meta">Dates: ' + esc(t.startDate || '—') + ' → ' + esc(t.dueDate || '—') + '</div>' +
                    '<div class="tasks-kanban-meta">Dependency: ' + esc(t.blockedByTaskId || t.dependencyIds || '—') + '</div>' +
                '</div>';
            }).join('');
            return '<div class="tasks-kanban-col"><div class="tasks-kanban-head"><span>' + esc(col.label) + '</span><span>' + tasks.length + '</span></div><div class="tasks-kanban-list">' + (cards || '<div class="tasks-empty" style="padding:10px">No tasks</div>') + '</div></div>';
        }).join('');
    }


    function renderGantt() {
        if (state.bodyView !== 'gantt') return;
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
                const schedMeta = state.scheduleAnalytics && state.scheduleAnalytics.byTaskId ? state.scheduleAnalytics.byTaskId[String(t.taskId || '')] : null;
                const criticalPathClass = schedMeta && schedMeta.isCritical ? ' critical-path' : '';
                const progressPct = taskProgressForBar(t);
                const timeline = buildTaskTimelineSegments(t, range, maxUnit);
                if (overlapStart <= overlapEnd) {
                    const left = overlapStart * colPx;
                    const widthUnits = Math.max(1, overlapEnd - overlapStart + 1);
                    const width = Math.max(18, (widthUnits * colPx) - 6);
                    const cascade = timeline.hasMultipleTracks
                        ? '<span class="gantt-bar-cascade back" style="background:' + ganttColor(t, row.depth) + ';"></span><span class="gantt-bar-cascade" style="background:' + ganttColor(t, row.depth) + ';"></span>'
                        : '';
                    const statusLower = String(t.status || '').toLowerCase();
                    const isBlocked = statusLower === 'blocked' || hasBlockingTask(t);
                    const isDone = statusLower === 'done';
                    const startIcon = isBlocked
                        ? '<svg class=\"gantt-status-icon start blocked\" viewBox=\"0 0 24 24\"><path d=\"M6 6l12 12M18 6L6 18\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\"/></svg>'
                        : (isDone ? '<svg class=\"gantt-status-icon start done\" viewBox=\"0 0 24 24\"><path d=\"M5 13l4 4L19 7\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\"/></svg>' : '');
                    const endIcon = isBlocked
                        ? '<svg class=\"gantt-status-icon end blocked\" viewBox=\"0 0 24 24\"><path d=\"M6 6l12 12M18 6L6 18\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\"/></svg>'
                        : (isDone ? '<svg class=\"gantt-status-icon end done\" viewBox=\"0 0 24 24\"><path d=\"M5 13l4 4L19 7\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\"/></svg>' : '');
                    bar = '<div class="gantt-bar ' + (t.priority === 'High' || t.priority === 'Critical' ? 'priority-high' : '') + (t.hasResourceConflict ? ' resource-conflict' : '') + criticalPathClass + '" data-task-id="' + esc(t.taskId) + '" data-drag-type="move" style="left:' + left + 'px;width:' + width + 'px;background:' + ganttColor(t, row.depth) + ';box-shadow:' + barShadow + '">' +
                        cascade +
                        startIcon + endIcon +
                        '<span class="gantt-label">' + esc(t.title) + '</span>' +
                        '<span class="gantt-progress" style="width:' + (progressPct > 0 ? Math.max(progressPct, 3) : 0) + '%"></span>' +
                        '<button class="gantt-child-btn" type="button" data-task-child="' + esc(t.taskId) + '" aria-label="Add child task">+</button>' +
                        '<button class="gantt-menu-btn" type="button" data-task-menu="' + esc(t.taskId) + '" aria-label="Open task">⋯</button>' +
                        '<span class="gantt-handle left" data-task-id="' + esc(t.taskId) + '" data-drag-type="start"></span>' +
                        '<span class="gantt-handle right" data-task-id="' + esc(t.taskId) + '" data-drag-type="end"></span>' +
                    '</div>';
                    if (isBlocked) {
                        const tailLeft = left + width + 2;
                        const tailWidth = Math.max(0, (cols.length * colPx) - tailLeft);
                        if (tailWidth > 0) bar += '<div class=\"gantt-blocked-tail\" style=\"left:' + tailLeft + 'px;width:' + tailWidth + 'px\"></div>';
                        bar += '<div class=\"gantt-blocked-x\" style=\"left:' + (left + width + 10) + 'px\">✕</div>';
                    }
                    const depIds = String(t.dependencyIds || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
                    if (depIds.length) {
                        const pred = state.tasks.find(function (pt) { return depIds.indexOf(String(pt.taskId || '')) >= 0 && String(pt.parentId || '') === String(t.parentId || '') && pt.dueDate; });
                        if (pred) {
                            const predEnd = toUnit(toDate(pred.dueDate));
                            const predPx = ((Math.max(0, Math.min(maxUnit, predEnd)) + 1) * colPx) - 3;
                            const lineLeft = Math.min(predPx, left);
                            const lineW = Math.max(6, Math.abs(left - predPx));
                            bar += '<div class=\"gantt-dep-line\" style=\"left:' + lineLeft + 'px;width:' + lineW + 'px\"></div>';
                        }
                    }
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

    function getChecklistAssignerName() {
        return String((byId('taskAssigner') && byId('taskAssigner').value) || '').trim();
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

    function openAssignProgressMenu(name, anchor) {
        const menu = byId('checklistProgressMenu');
        if (!menu || !anchor) return;
        const target = String(name || '').trim();
        if (!target) return;
        const current = normalizeChecklistStatus((state.taskAssignProgressByName || {})[target], false);
        menu.innerHTML = checklistProgressList().map(function (status) {
            return '<button class="checklist-progress-btn" type="button" data-assign-progress-name="' + esc(target) + '" data-assign-progress-status="' + esc(status) + '">' + (status === current ? '✓ ' : '') + esc(status) + '</button>';
        }).join('');
        const r = anchor.getBoundingClientRect();
        menu.style.left = Math.round(r.left) + 'px';
        menu.style.top = Math.round(r.bottom + 6) + 'px';
        menu.classList.add('open');
    }

    function closeAssignProgressMenu() {
        const menu = byId('checklistProgressMenu');
        if (menu) menu.classList.remove('open');
    }

    async function persistChecklistForTask(taskId, opts) {
        if (!taskId) return;
        ensureChecklistItemIds();
        const assignerName = getChecklistAssignerName();
        const options = opts || {};
        const checklistPayload = state.checklistDraft.map(function (item) {
            const cleanAssignees = removeAssignerFromAssignees(parseChecklistAssignees(item && item.assignees, ''), assignerName);
            return {
                itemId: String(item.itemId || ''),
                done: !!item.done,
                text: item.text || '',
                assignees: options.includeAssignees ? serializeAssignees(cleanAssignees) : '',
                notes: item.notes || '',
                startDate: item.startDate || '',
                dueDate: item.dueDate || '',
                handoffMode: item.handoffMode || '',
                progressStatus: normalizeChecklistStatus(item.progressStatus, item.done)
            };
        });
        const sig = JSON.stringify(checklistPayload);
        if (!options.force && state.checklistPersistMemoByTask[taskId] === sig) return;
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

    function toggleChecklistNotes(idx) {
        if (!Number.isFinite(idx) || !state.checklistDraft[idx]) return;
        state.checklistDraft[idx].notesOpen = !state.checklistDraft[idx].notesOpen;
        renderChecklistDraft();
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
            state.checklistDraft = [{ done: false, selected: false, text: '', assignees: '', notes: '', notesOpen: false, progressStatus: 'Not Started', itemId: '' }];
        }
        const renderIndexes = visibleChecklistIndexes();
        const selectedCount = state.checklistDraft.filter(function (it) { return !!(it && it.selected); }).length;
        const title = panel ? panel.querySelector('.task-checklist-title') : null;
        if (title) title.setAttribute('data-selected-count', String(selectedCount));
        ['taskChecklistDelete','taskChecklistDone'].forEach(function (id) {
            const btn = byId(id);
            if (btn) btn.disabled = selectedCount < 1;
        });

        wrap.innerHTML = renderIndexes.map(function (idx) {
            const item = state.checklistDraft[idx] || {};
            const notesOpen = !!item.notesOpen;
            return '<div class="checklist-row">' +
                '<input type="checkbox" data-check-select-idx="' + idx + '" ' + (item.selected ? 'checked' : '') + ' />' +
                '<div class="checklist-item-main">' +
                    '<div class="checklist-text-frame ' + (notesOpen ? 'notes-open' : '') + '">' +
                        '<input class="tasks-input checklist-text-input" data-check-text-idx="' + idx + '" placeholder="Checklist item" value="' + esc(item.text || '') + '" />' +
                        '<button type="button" class="checklist-notes-toggle" data-check-notes-toggle-idx="' + idx + '" aria-label="Toggle notes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="1.3"></circle><circle cx="12" cy="12" r="1.3"></circle><circle cx="18" cy="12" r="1.3"></circle></svg></button>' +
                        '<textarea class="tasks-input checklist-notes-input" data-check-notes-idx="' + idx + '" placeholder="Notes">' + esc(item.notes || '') + '</textarea>' +
                    '</div>' +
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
                notes: item.notes || '',
                notesOpen: !!item.notesOpen,
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
                notes: String((rows[i].querySelector('[data-check-notes-idx]') || {}).value || prev.notes || '').trim(),
                notesOpen: !!prev.notesOpen,
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
            return !!(String(item.text || '').trim()) || !!(String(item.notes || '').trim()) || !!item.done || !!item.selected;
        });
        syncEditingTaskChecklistToState();
    }


    function parseAssigneeInputList(raw) {
        return parseAssignees(String(raw || '').replace(/\n/g, ',').replace(/\|/g, ','));
    }

    function selectedChecklistIndexes() {
        const out = [];
        for (let i = 0; i < state.checklistDraft.length; i++) {
            if (state.checklistDraft[i] && state.checklistDraft[i].selected) out.push(i);
        }
        return out;
    }

    function renderTaskAssignBadges() {
        const wrap = byId('taskAssignBadges');
        if (!wrap) return;
        const badges = [];
        const assignerName = String(byId('taskAssigner') && byId('taskAssigner').value || '').trim();
        const stages = Array.isArray(state.taskAssignStages) ? state.taskAssignStages : [];
        if (assignerName) badges.push('<span class="checklist-badge assigner">' + esc(assignerName) + '</span>');
        stages.forEach(function (stage, idx) {
            const names = (Array.isArray(stage) ? stage : []).filter(Boolean);
            if (idx === 0) {
                if (assignerName && names.length) badges.push('<svg class="checklist-assign-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h13"></path><path d="M13 7l5 5-5 5"></path></svg>');
            } else {
                badges.push('<svg class="checklist-handoff-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"></circle><path d="M3 18c0-2.8 2.2-4.8 5-4.8"></path><path d="M11.5 12h8"></path><path d="M16.5 9l3 3-3 3"></path></svg>');
            }
            names.forEach(function (name) {
                const status = normalizeChecklistStatus((state.taskAssignProgressByName || {})[name], false);
                const statusCls = checklistStatusClass(status);
                badges.push('<button type="button" class="checklist-badge assignee ' + statusCls + '" data-assign-progress-name="' + esc(name) + '">' + esc(name) + '</button>');
            });
        });
        if (!badges.length) badges.push('<span class="tasks-empty" style="padding:2px 0;">No assignees</span>');
        wrap.innerHTML = badges.join('');
    }

    function syncTaskAssignFieldFromStages() {
        const stages = Array.isArray(state.taskAssignStages) ? state.taskAssignStages : [];
        const latest = stages.length ? stages[stages.length - 1] : [];
        const clean = removeAssignerFromAssignees((Array.isArray(latest) ? latest : []).filter(Boolean), String(byId('taskAssigner') && byId('taskAssigner').value || '').trim());
        byId('taskAssignee').value = clean.join(', ');
    }

    function initializeTaskAssignStages(task) {
        const base = removeAssignerFromAssignees(parseAssignees(task ? task.assignee : byId('taskAssignee').value), String(byId('taskAssigner') && byId('taskAssigner').value || '').trim());
        state.taskAssignStages = [base.filter(Boolean)];
        state.taskAssignProgressByName = state.taskAssignProgressByName || {};
        const inp = byId('taskAssignInput');
        if (inp) inp.value = '';
        syncTaskAssignFieldFromStages();
        renderTaskAssignBadges();
    }

    function applyTaskAssignAction(action) {
        const input = byId('taskAssignInput');
        const names = parseAssigneeInputList(input ? input.value : '');
        const stages = Array.isArray(state.taskAssignStages) ? state.taskAssignStages.slice() : [];
        if (!stages.length) stages.push(removeAssignerFromAssignees(parseAssignees(byId('taskAssignee').value), String(byId('taskAssigner') && byId('taskAssigner').value || '').trim()));
        if (action === 'handoff') {
            if (stages.length < 2) {
                stages.push(names.slice());
            } else {
                stages[1] = names.slice();
            }
        } else {
            if (stages.length > 1) {
                stages[1] = names.slice();
            } else {
                stages[0] = Array.from(new Set((stages[0] || []).concat(names))).filter(Boolean);
            }
        }
        state.taskAssignStages = stages;
        syncTaskAssignFieldFromStages();
        renderTaskAssignBadges();
        queueModalAutosave();
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
                notes: item.notes || '',
                notesOpen: !!item.notesOpen,
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
        if (!state.checklistDraft.length) state.checklistDraft = [{ done: false, selected: false, text: '', notes: '', notesOpen: false, progressStatus: 'Not Started', itemId: '' }];
        syncEditingTaskChecklistToState();
        syncChecklistMasterDates();
        renderChecklistDraft();
        queueRenderGantt();
        if (state.editingId) queueModalAutosave();
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
                        notes: String(it.notes || ''),
                        notesOpen: false,
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
        initializeTaskAssignStages(task || null);
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
        if (byId('taskAssignmentMode')) byId('taskAssignmentMode').value = task ? task.assignmentMode : 'manual';
        if (byId('taskAssignmentGroup')) byId('taskAssignmentGroup').value = task ? task.assignmentGroup : '';
        if (byId('taskRequiredSkills')) byId('taskRequiredSkills').value = task ? (Array.isArray(task.requiredSkills) ? task.requiredSkills.join(', ') : '') : '';
        if (byId('taskAssignmentCursor')) byId('taskAssignmentCursor').value = task ? task.assignmentCursor : '';
        if (byId('taskResourceKey')) byId('taskResourceKey').value = task ? String(task.resourceKey || '') : '';
        if (byId('taskResourceCapacity')) byId('taskResourceCapacity').value = task ? String(normalizeResourceCapacity(task.resourceCapacity)) : '1';
        if (byId('taskResourceConflictState')) byId('taskResourceConflictState').value = task ? normalizeResourceConflictState(task.resourceConflictState) : '';
        if (byId('taskResourceConflictBadge')) byId('taskResourceConflictBadge').style.display = 'none';
        syncAssignmentPanelVisibility();
        if (byId('taskDependencyRules')) byId('taskDependencyRules').value = task ? String(task.dependencyRules || '') : '';
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
        if (byId('taskSaveBtn')) byId('taskSaveBtn').disabled = false;
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
        const existingTask = state.editingId ? state.tasks.find(function (t) { return t.taskId === state.editingId; }) : null;
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
            percentComplete: 0,
            itemCode: byId('taskItemCode').value.trim(),
            itemName: byId('taskItemName').value.trim(),
            location: byId('taskLocation').value.trim(),
            sublocation: byId('taskSublocation').value.trim(),
            dependencyIds: '',
            dependencyRules: byId('taskDependencyRules') ? byId('taskDependencyRules').value.trim() : '',
            resourceKey: byId('taskResourceKey') ? byId('taskResourceKey').value.trim() : '',
            resourceCapacity: byId('taskResourceCapacity') ? normalizeResourceCapacity(byId('taskResourceCapacity').value) : 1,
            resourceConflictState: byId('taskResourceConflictState') ? normalizeResourceConflictState(byId('taskResourceConflictState').value) : '',
            blockedByTaskId: existingTask ? String(existingTask.blockedByTaskId || '') : '',
            blockReason: existingTask ? String(existingTask.blockReason || '') : '',
            assignmentMode: existingTask ? String(existingTask.assignmentMode || 'manual') : 'manual',
            assignmentGroup: existingTask ? String(existingTask.assignmentGroup || '') : '',
            requiredSkills: existingTask && Array.isArray(existingTask.requiredSkills) ? existingTask.requiredSkills.slice() : [],
            assignmentCursor: existingTask ? String(existingTask.assignmentCursor || '') : '',
            archived: false,
            createdAt: state.editingId ? (state.tasks.find(function (t) { return t.taskId === state.editingId; }) || {}).createdAt || now : now,
            updatedAt: now,
            createdBy: 'dashboard'
        };
        syncChecklistDraftFromUi();
        syncTaskAssignFieldFromStages();
        const assigneeInputList = parseAssignees(byId('taskAssignee').value);
        const assigneeList = removeAssignerFromAssignees(Array.from(new Set(assigneeInputList)).filter(Boolean), payload.assigner);
        byId('taskAssignee').value = assigneeList.join(', ');
        payload.assignees = serializeAssignees(assigneeList);
        if (Array.isArray(state.taskAssignStages) && state.taskAssignStages.length >= 2) {
            payload.assignmentCursor = serializeAssigneeFlowForSheet(state.taskAssignStages, assigneeList);
        }
        payload.assignee = assigneeList[0] || '';
        modalTracksToPayload(payload, assigneeList);
        assignmentPanelToPayload(payload);
        const checklistDone = (state.checklistDraft || []).filter(function (it) { return it && it.done; }).length;
        const checklistTotal = (state.checklistDraft || []).filter(Boolean).length;
        payload.percentComplete = checklistTotal ? clamp(Math.round((checklistDone / checklistTotal) * 100), 0, 100) : clamp(Number(existingTask && existingTask.percentComplete || 0), 0, 100);

        if (parentTask && payload.startDate && payload.dueDate && toDate(payload.dueDate) < toDate(payload.startDate)) {
            payload.dueDate = payload.startDate;
        }

        syncChecklistDraftFromUi();
        return payload;
    }

    function applyStatusTransitionTimestamps(payload, previousTask) {
        const now = isoNow();
        const prev = previousTask || null;
        const prevStatus = String((prev && prev.status) || '').trim();
        const nextStatus = String(payload.status || '').trim();
        payload.assignedAt = String(payload.assignedAt || (prev && prev.assignedAt) || '');
        payload.lastStatusChangeAt = String(payload.lastStatusChangeAt || (prev && prev.lastStatusChangeAt) || '');
        payload.slaHours = payload.slaHours == null ? ((prev && prev.slaHours) || '') : payload.slaHours;
        payload.escalationState = String(payload.escalationState || (prev && prev.escalationState) || '');
        payload.escalatedAt = String(payload.escalatedAt || (prev && prev.escalatedAt) || '');
        payload.exceptionFlag = payload.exceptionFlag === true || String(payload.exceptionFlag || '').toLowerCase() === 'true';

        if (nextStatus && !payload.assignedAt && nextStatus.toLowerCase() !== 'not started') {
            payload.assignedAt = now;
        }
        if (!prev || prevStatus !== nextStatus) {
            payload.lastStatusChangeAt = now;
        }
        if (nextStatus.toLowerCase() === 'done') {
            payload.escalationState = '';
            payload.escalatedAt = '';
        }
        return payload;
    }

    function refreshEditingTaskFromModal() {
        if (!state.editingId || !byId('taskModal').classList.contains('open')) return;
        const idx = state.tasks.findIndex(function (t) { return t.taskId === state.editingId; });
        if (idx < 0) return;
        const payload = buildTaskPayloadFromModal();
        const signature = JSON.stringify({ task: payload, checklist: state.checklistDraft });
        if (signature === state.autosaveSignature) return;
        state.tasks[idx] = normalizeTask(payload, idx);
        state.tasks[idx].checklistItems = state.checklistDraft.slice();
        state.autosaveSignature = signature;
        applyFilters();
    }

    function queueModalAutosave() {
        if (!state.editingId || !byId('taskModal').classList.contains('open')) return;
        if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
        state.autosaveTimer = setTimeout(function () {
            state.autosaveTimer = null;
            refreshEditingTaskFromModal();
        }, 100);
    }

    async function saveTask() {
        const payload = buildTaskPayloadFromModal();
        const resourceConflict = getResourceConflictForTask(payload, state.tasks);
        if (payload.resourceKey && resourceConflict.hasConflict) {
            if (byId('taskResourceConflictBadge')) {
                byId('taskResourceConflictBadge').style.display = 'inline-flex';
                byId('taskResourceConflictBadge').textContent = 'Resource conflict (' + resourceConflict.peak + '/' + resourceConflict.capacity + ')';
            }
            if (payload.resourceConflictState === 'critical') {
                alert('Resource capacity exceeded for key "' + payload.resourceKey + '". Save blocked for critical workflow.');
                return;
            }
        }
        const depValidation = validateTaskDependenciesBeforeSave(payload);
        if (!depValidation.ok) {
            alert(depValidation.error);
            return;
        }

        const predecessorIds = String(payload.dependencyIds || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        const isPredecessorGatedTask = /^\s*(Successor|Contingency)\s*·/i.test(String(payload.title || '')) || /Waiting for predecessor to complete/i.test(String(payload.blockReason || ''));
        if (isPredecessorGatedTask && predecessorIds.length) {
            const allDone = predecessorIds.every(function (id) {
                const p = state.tasks.find(function (t) { return String(t.taskId || '') === String(id); });
                return p && String(p.status || '').toLowerCase() === 'done';
            });
            if (!allDone) {
                if (String(payload.status || '').toLowerCase() !== 'waiting') alert('Previous task not done');
                payload.status = 'Waiting';
                payload.blockedByTaskId = predecessorIds[0] || payload.blockedByTaskId;
                payload.blockReason = payload.blockReason || 'Waiting for predecessor to complete.';
            }
        }

        let previousStatus = '';
        if (state.editingId) {
            const idx = state.tasks.findIndex(function (t) { return t.taskId === state.editingId; });
            const prevTask = idx >= 0 ? state.tasks[idx] : null;
            previousStatus = String((prevTask && prevTask.status) || '').trim().toLowerCase();
            applyStatusTransitionTimestamps(payload, prevTask);
            if (idx >= 0) state.tasks[idx] = normalizeTask(payload, idx);
            recomputeResourceConflicts(state.tasks);
            await writeTask('updateTask', payload);
        } else {
            applyStatusTransitionTimestamps(payload, null);
            state.tasks.push(normalizeTask(payload, state.tasks.length));
            recomputeResourceConflicts(state.tasks);
            await writeTask('createTask', payload);
        }

        const nextStatus = String(payload.status || '').trim().toLowerCase();
        if (nextStatus === 'on hold' && previousStatus !== 'on hold') {
            await applyOnHoldBlocking(payload.taskId);
        }

        await persistChecklistForTask(payload.taskId, { force: true, includeAssignees: false });
        const savedIdx = state.tasks.findIndex(function (t) { return t.taskId === payload.taskId; });
        if (savedIdx >= 0) state.tasks[savedIdx].checklistItems = state.checklistDraft.slice();
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
        const candidate = Object.assign({}, task, { startDate: nextStart, dueDate: nextDue });
        const resourceConflict = getResourceConflictForTask(candidate, state.tasks);
        if (candidate.resourceKey && resourceConflict.hasConflict && normalizeResourceConflictState(candidate.resourceConflictState) === 'critical') {
            alert('Resource capacity exceeded for key "' + candidate.resourceKey + '". Date move blocked for critical workflow.');
            queueRenderGantt();
            return;
        }
        const prevStart = task.startDate;
        task.startDate = nextStart;
        task.dueDate = nextDue;
        task.hasResourceConflict = resourceConflict.hasConflict;
        task.resourceConflictPeak = resourceConflict.peak;
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
        recomputeResourceConflicts(state.tasks);
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
        if (isDateDragFrozen(task)) return;
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
        const showGantt = state.bodyView === 'gantt';
        const showReport = state.bodyView === 'report';
        const showKanban = state.bodyView === 'kanban';
        els.shell.style.display = showGantt ? 'grid' : 'none';
        const rep = byId('tasksPrintView');
        if (rep) rep.style.display = showReport ? 'block' : 'none';
        const kan = byId('tasksKanbanView');
        if (kan) kan.classList.toggle('visible', showKanban);
        ['tasksReportViewBtn','tasksGanttViewBtn','tasksKanbanViewBtn'].forEach(function (id) {
            const btn = byId(id);
            if (!btn) return;
            btn.classList.toggle('active', (id === 'tasksReportViewBtn' && showReport) || (id === 'tasksGanttViewBtn' && showGantt) || (id === 'tasksKanbanViewBtn' && showKanban));
        });
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

        function openSearchWrap() {
            const wrap = byId('tasksSearchWrap');
            if (!wrap) return;
            wrap.classList.add('open');
            if (els.search) els.search.focus();
            clearTimeout(state.searchAutoHideTimer);
            state.searchAutoHideTimer = setTimeout(function () {
                if (els.search && !els.search.value.trim()) wrap.classList.remove('open');
            }, 2600);
        }
        byId('tasksSearchBtn').addEventListener('click', openSearchWrap);
        if (els.search) {
            els.search.addEventListener('input', function () {
                const wrap = byId('tasksSearchWrap');
                if (!wrap) return;
                if (!wrap.classList.contains('open')) wrap.classList.add('open');
                clearTimeout(state.searchAutoHideTimer);
                state.searchAutoHideTimer = setTimeout(function () {
                    if (!els.search.value.trim()) wrap.classList.remove('open');
                }, 2600);
            });
            els.search.addEventListener('blur', function () {
                const wrap = byId('tasksSearchWrap');
                if (!wrap) return;
                setTimeout(function () { if (!els.search.value.trim()) wrap.classList.remove('open'); }, 240);
            });
        }

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

        [['tasksReportViewBtn','report'],['tasksGanttViewBtn','gantt'],['tasksKanbanViewBtn','kanban']].forEach(function (pair) {
            const btn = byId(pair[0]);
            if (!btn) return;
            btn.addEventListener('click', function () {
                state.bodyView = pair[1];
                syncShellLayout();
                renderReportView();
                renderKanbanView();
                if (state.bodyView === 'gantt') requestAnimationFrame(renderGantt);
            });
        });

        byId('tasksAddBtn').addEventListener('click', createNewTaskBlock);
        byId('taskCancelBtn').addEventListener('click', closeModal);
        byId('taskSaveBtn').addEventListener('click', saveTask);
        ['taskTitle','taskDescription','taskStatus','taskPriority','taskColor','taskPercent','taskItemCode','taskItemName','taskLocation','taskSublocation','taskParentId','taskAssigneeTracks','taskDependencyRules'].forEach(function (id) {
            const field = byId(id);
            if (!field) return;
            const evt = (field.tagName === 'SELECT' || field.type === 'date' || field.type === 'range') ? 'change' : 'input';
            field.addEventListener(evt, queueModalAutosave);
            if (evt !== 'change') field.addEventListener('change', queueModalAutosave);
        });
        ['taskAssignmentMode','taskAssignmentGroup','taskRequiredSkills','taskAssignmentCursor'].forEach(function (id) {
            const field = byId(id);
            if (!field) return;
            const evt = field.tagName === 'SELECT' ? 'change' : 'input';
            field.addEventListener(evt, function () {
                if (id === 'taskAssignmentMode') syncAssignmentPanelVisibility();
                queueModalAutosave();
            });
            if (evt !== 'change') field.addEventListener('change', function () {
                if (id === 'taskAssignmentMode') syncAssignmentPanelVisibility();
                queueModalAutosave();
            });
        });
        byId('taskAssigner').addEventListener('input', function () {
            const next = String(byId('taskAssigner').value || '').trim();
            state.lastAssignerValue = next;
            renderTaskAssignBadges();
            queueModalAutosave();
        });
        byId('taskArchiveBtn').addEventListener('click', archiveEditingTask);
        byId('taskChecklistAdd').addEventListener('click', function () {
            if (state.checklistLoading) return;
            syncChecklistDraftFromUi();
            state.checklistDraft.push({ done: false, selected: false, text: '', assignees: '', notes: '', notesOpen: false, progressStatus: 'Not Started', startDate: byId('taskStartDate').value || '', dueDate: byId('taskDueDate').value || '', itemId: '' });
            renderChecklistDraft();
        });
        byId('taskChecklistRows').addEventListener('input', function () { if (!state.checklistLoading) { syncChecklistDraftFromUi(); syncChecklistMasterDates(); queueModalAutosave(); } });
        byId('taskChecklistRows').addEventListener('change', function () { if (!state.checklistLoading) { syncChecklistDraftFromUi(); syncChecklistMasterDates(); queueModalAutosave(); } });
        byId('taskChecklistRows').addEventListener('click', function (e) {
            const notesToggle = e.target.closest('[data-check-notes-toggle-idx]');
            if (notesToggle) {
                const idx = Number(notesToggle.getAttribute('data-check-notes-toggle-idx'));
                if (Number.isFinite(idx)) toggleChecklistNotes(idx);
                return;
            }
            const selectCb = e.target.closest('[data-check-select-idx]');
            if (!selectCb || state.checklistLoading) return;
            syncChecklistDraftFromUi();
            renderChecklistDraft();
        });
        byId('taskChecklistDelete').addEventListener('click', function () { if (!state.checklistLoading) applyChecklistSelectionAction('delete'); });
        byId('taskChecklistDone').addEventListener('click', function () { if (!state.checklistLoading) applyChecklistSelectionAction('done'); });
        const assignBtn = byId('taskAssignAddBtn');
        if (assignBtn) assignBtn.addEventListener('click', function () { applyTaskAssignAction('assign'); });
        const handoffBtn = byId('taskAssignHandoffBtn');
        if (handoffBtn) handoffBtn.addEventListener('click', function () { applyTaskAssignAction('handoff'); });
        const assignBadges = byId('taskAssignBadges');
        if (assignBadges) {
            assignBadges.addEventListener('click', function (e) {
                const badge = e.target.closest('[data-assign-progress-name]');
                if (!badge) return;
                const name = badge.getAttribute('data-assign-progress-name') || '';
                openAssignProgressMenu(name, badge);
            });
        }
        document.addEventListener('click', function (e) {

            const addTypeBtn = e.target.closest('[data-addtype]');
            if (addTypeBtn) {
                const action = addTypeBtn.getAttribute('data-addtype') || '';
                const taskId = state.addTypeMenuTaskId;
                closeAddTypeMenu();
                if (action === 'child') {
                    openNewChildTaskFrom(taskId);
                } else if (action === 'successor') {
                    createLinkedTimelineTask(taskId, 'successor').catch(function (err) { console.warn('Successor create failed', err); });
                } else if (action === 'contingency') {
                    createLinkedTimelineTask(taskId, 'contingency').catch(function (err) { console.warn('Contingency create failed', err); });
                }
                return;
            }
            const btn = e.target.closest('[data-assign-progress-name][data-assign-progress-status]');
            if (btn) {
                const name = String(btn.getAttribute('data-assign-progress-name') || '').trim();
                const status = String(btn.getAttribute('data-assign-progress-status') || '').trim();
                if (name) {
                    state.taskAssignProgressByName[name] = status;
                    renderTaskAssignBadges();
                    queueModalAutosave();
                }
                closeAssignProgressMenu();
                return;
            }
            if (!e.target.closest('#checklistProgressMenu,[data-assign-progress-name]')) closeAssignProgressMenu();
            if (!e.target.closest('#tasksAddTypeMenu,[data-task-child]')) closeAddTypeMenu();
        });
        const pr = byId('taskPriorityToggleRow');
        if (pr) {
            pr.addEventListener('click', function (e) {
                const btn = e.target.closest('[data-priority]');
                if (!btn) return;
                byId('taskPriority').value = btn.getAttribute('data-priority') || 'Medium';
                syncPriorityToggleUi();
            });
        }

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
            if (childBtn) { openAddTypeMenu(childBtn.getAttribute('data-task-child'), childBtn); return; }
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
        els.mockBanner = byId('tasksMockBanner');
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
        // Reverted to native date picker for reliability.
        return;
        const pairs = [
            { field: byId('taskStartDate'), pop: byId('taskStartDatePopover'), host: byId('taskStartCalendar') },
            { field: byId('taskDueDate'), pop: byId('taskDueDatePopover'), host: byId('taskDueCalendar') }
        ];
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const views = { taskStartDate: null, taskDueDate: null };

        function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
        function toIso(y, m, d) {
            return String(y) + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        }

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

        function closeAll() {
            pairs.forEach(function (p) {
                if (!p || !p.pop) return;
                if (p.pop.contains(document.activeElement)) {
                    if (p.field && typeof p.field.focus === 'function') p.field.focus();
                    else if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
                }
                p.pop.classList.remove('open');
                p.pop.setAttribute('aria-hidden', 'true');
                p.pop.setAttribute('inert', '');
            });
        }

        pairs.forEach(function (pair) {
            if (!pair.field || !pair.pop || !pair.host) return;
            pair.field.addEventListener('focus', function () {
                closeAll();
                views[pair.field.id] = pair.field.value || toISODate(new Date());
                renderCal(pair);
                pair.pop.classList.add('open');
                pair.pop.setAttribute('aria-hidden', 'false');
                pair.pop.removeAttribute('inert');
            });
            pair.field.addEventListener('click', function () {
                closeAll();
                views[pair.field.id] = pair.field.value || toISODate(new Date());
                renderCal(pair);
                pair.pop.classList.add('open');
                pair.pop.setAttribute('aria-hidden', 'false');
                pair.pop.removeAttribute('inert');
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
                        views[pair.field.id] = toIso(cur.getFullYear() + ystep, cur.getMonth(), 1);
                    } else {
                        const step = navType === 'prev' ? -1 : 1;
                        views[pair.field.id] = toIso(cur.getFullYear(), cur.getMonth() + step, 1);
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
                pair.pop.setAttribute('aria-hidden', 'true');
                pair.pop.setAttribute('inert', '');
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
