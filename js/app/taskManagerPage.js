(function () {
    'use strict';

    const TASK_COLUMNS = ['taskId','parentId','sortOrder','level','title','description','status','priority','assignee','startDate','dueDate','percentComplete','itemCode','itemName','location','sublocation','dependencyIds','taskColor','archived','createdAt','updatedAt','createdBy'];
    const DEFAULT_STATUS = ['all', 'Not Started', 'In Progress', 'Blocked', 'Done'];
    const DEFAULT_PRIORITY = ['Low', 'Medium', 'High', 'Critical'];
    const DAY_MS = 86400000;

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
        showArchived: false,
        filtersOpen: false,
        drag: null,
        range: null,
        colPx: 42,
        itemLookupRows: []
    };

    const els = {};

    function byId(id) { return document.getElementById(id); }
    function isoNow() { return new Date().toISOString(); }
    function toDate(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    function toISODate(v) { const d = toDate(v); return d ? d.toISOString().slice(0, 10) : ''; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function normalizeColor(color) {
        const v = String(color || '').trim();
        return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#11998e';
    }

    function lightenHex(hex, amount) {
        const c = normalizeColor(hex).replace('#', '');
        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);
        const a = clamp(Number(amount || 0), 0, 1);
        const nr = Math.round(r + (255 - r) * a);
        const ng = Math.round(g + (255 - g) * a);
        const nb = Math.round(b + (255 - b) * a);
        return '#' + [nr, ng, nb].map(function (n) { return n.toString(16).padStart(2, '0'); }).join('');
    }

    function toColorGradient(hex, isChild) {
        const base = normalizeColor(hex);
        const light = lightenHex(base, isChild ? 0.32 : 0.18);
        return 'linear-gradient(135deg, ' + base + ', ' + light + ')';
    }

    function shiftIsoDate(iso, days) {
        const base = toDate(iso) || new Date();
        return new Date(base.getTime() + (days * DAY_MS)).toISOString().slice(0, 10);
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
        if (!els.zoomOutBtn) return;
        els.zoomOutBtn.textContent = state.zoomOutLevel > 0 ? ('Zoom Out x' + state.zoomOutLevel) : 'Zoom Out';
    }

    function jsonp(url, timeoutMs) {
        timeoutMs = timeoutMs || 10000;
        return new Promise(function (resolve, reject) {
            const cb = '__pbTaskCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            const script = document.createElement('script');
            const sep = url.indexOf('?') >= 0 ? '&' : '?';
            let done = false;
            const timer = setTimeout(function () { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
            function cleanup() {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { delete window[cb]; } catch (_) { window[cb] = null; }
                if (script.parentNode) script.parentNode.removeChild(script);
            }
            window[cb] = function (payload) { cleanup(); resolve(payload || {}); };
            script.onerror = function () { cleanup(); reject(new Error('JSONP failed')); };
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
        return (localStorage.getItem('spike_webAppUrl') || localStorage.getItem('jsonp_proxy_webAppUrl') || '').trim();
    }

    function emptyFallbackTasks() { return []; }

    function normalizeTask(raw, idx) {
        const out = {};
        TASK_COLUMNS.forEach(function (k) { out[k] = raw[k] != null ? raw[k] : ''; });
        out.taskId = String(out.taskId || ('TASK-' + Date.now() + '-' + idx));
        out.parentId = String(out.parentId || '');
        out.sortOrder = Number(out.sortOrder || ((idx + 1) * 10));
        out.title = String(out.title || 'New Task');
        out.status = String(out.status || 'Not Started');
        out.priority = String(out.priority || 'Medium');
        out.taskColor = String(out.taskColor || '#11998e');
        out.percentComplete = Math.max(0, Math.min(100, Number(out.percentComplete || 0)));
        out.archived = String(out.archived).toLowerCase() === 'true' || out.archived === true;
        out.startDate = toISODate(out.startDate);
        out.dueDate = toISODate(out.dueDate);
        out.createdAt = out.createdAt || isoNow();
        out.updatedAt = out.updatedAt || isoNow();
        out.children = [];
        ensureTaskDates(out);
        return out;
    }

    async function loadTasks() {
        state.loading = true;
        renderList();
        const webAppUrl = getWebAppUrl();
        if (!webAppUrl) {
            state.usingMock = true;
            state.tasks = emptyFallbackTasks().map(normalizeTask);
            state.loading = false;
            applyFilters();
            return;
        }

        try {
            const sheetId = (localStorage.getItem('spike_sheetId') || '').trim();
            const url = webAppUrl + '?action=tasksRead&sheetId=' + encodeURIComponent(sheetId) + '&tabName=' + encodeURIComponent('tasks');
            const res = await jsonp(url, 12000);
            if (!res || !res.ok || !Array.isArray(res.tasks)) throw new Error((res && res.error) || 'Invalid task payload');
            state.tasks = res.tasks.map(normalizeTask);
            state.usingMock = false;
        } catch (e) {
            console.warn('Task load failed, using empty fallback', e);
            state.usingMock = true;
            state.tasks = emptyFallbackTasks().map(normalizeTask);
        }

        state.loading = false;
        applyFilters();
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
            arr.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
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
        const itemTerm = (els.itemFilter.value || '').toLowerCase();
        const locTerm = (els.locationFilter.value || '').toLowerCase();

        state.filtered = state.tasks.filter(function (task) {
            if (!state.showArchived && task.archived) return false;
            if (status !== 'all' && task.status !== status) return false;
            if (assignee !== 'all' && task.assignee !== assignee) return false;
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
        renderList();
        requestAnimationFrame(renderGantt);
    }

    function populateFilters() {
        const currentAssignee = els.assigneeFilter.value || 'all';
        const assignees = ['all'].concat(Array.from(new Set(state.tasks.map(function (t) { return t.assignee || ''; }).filter(Boolean))).sort());

        els.assigneeFilter.innerHTML = assignees.map(function (a) {
            return '<option value="' + esc(a) + '">' + esc(a === 'all' ? 'All Assignees' : a) + '</option>';
        }).join('');
        if (assignees.indexOf(currentAssignee) >= 0) els.assigneeFilter.value = currentAssignee;

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
    }

    function renderList() {
        if (state.loading) {
            els.listBody.innerHTML = '<div class="tasks-empty">Loading tasks…</div>';
            return;
        }
        if (!state.flatRows.length) {
            els.listBody.innerHTML = '<div class="tasks-empty">No tasks match the current filters.</div>';
            return;
        }

        els.listBody.innerHTML = state.flatRows.map(function (row) {
            const task = row.task;
            const hasChildren = task.children && task.children.length;
            const expanded = state.expanded[task.taskId] !== false;
            const indent = row.depth * 14;
            return '<div class="tasks-row" data-task-id="' + esc(task.taskId) + '">' +
                '<button class="tree-toggle" data-toggle="' + esc(task.taskId) + '">' + (hasChildren ? (expanded ? '▾' : '▸') : '•') + '</button>' +
                '<div class="task-title-wrap" style="padding-left:' + indent + 'px">' +
                '<span class="task-color-badge" style="background:' + esc(normalizeColor(task.taskColor)) + '"></span>' +
                '<span class="task-title" title="' + esc(task.title) + '">' + esc(task.title) + '</span></div>' +
            '</div>';
        }).join('');
    }

    function computeRange(rows) {
        let start = null;
        let end = null;
        rows.forEach(function (row) {
            const s = toDate(row.task.startDate);
            const d = toDate(row.task.dueDate);
            if (s && (!start || s < start)) start = s;
            if (d && (!end || d > end)) end = d;
        });
        const now = new Date();
        if (!start) start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        if (!end) end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);

        const basePad = state.zoom === 'day' ? 3 : (state.zoom === 'week' ? 7 : 14);
        const zoomPad = state.zoomOutLevel * (state.zoom === 'day' ? 7 : (state.zoom === 'week' ? 14 : 28));
        start = new Date(start.getTime() - ((basePad + zoomPad) * DAY_MS));
        end = new Date(end.getTime() + ((basePad + zoomPad) * DAY_MS));

        if (state.zoom === 'day') {
            const minSpanDays = 7;
            const span = Math.floor((end - start) / DAY_MS) + 1;
            if (span < minSpanDays) {
                end = new Date(start.getTime() + ((minSpanDays - 1) * DAY_MS));
            }
        }
        return { start: start, end: end };
    }

    function ganttColor(status) {
        if (status === 'Done') return 'linear-gradient(135deg, #42e9a0, #20c8b5)';
        if (status === 'Blocked') return 'linear-gradient(135deg, #ff7f67, #ff5454)';
        if (status === 'Not Started') return 'linear-gradient(135deg, #8e9eab, #6b7280)';
        return 'linear-gradient(135deg, #11998e, #38ef7d)';
    }

    function renderGantt() {
        const rows = state.flatRows;
        if (!rows.length) {
            els.ganttWrap.innerHTML = '<div class="tasks-empty">No scheduled tasks to display.</div>';
            return;
        }

        const range = computeRange(rows);
        const days = Math.max(1, Math.ceil((range.end - range.start) / DAY_MS) + 1);
        const colPx = state.zoom === 'day' ? 54 : (state.zoom === 'week' ? 42 : 30);
        state.colPx = colPx;
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

        const gridCols = 'repeat(' + cols.length + ',' + colPx + 'px)';
        const monthHead = '<div class="gantt-head" style="grid-template-columns:' + gridCols + '">' + cols.map(function (d) {
            let monthLabel = '';
            if (state.zoom === 'month') monthLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            else if (d.getDate() === 1) monthLabel = d.toLocaleString('en-US', { month: 'short' });
            const weekAlt = (state.zoom !== 'month' && (weekIndexFrom(d) % 2 === 1)) ? ' week-alt' : '';
            return '<div class="gantt-cell month-marker' + weekAlt + '">' + esc(monthLabel) + '</div>';
        }).join('') + '</div>';

        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const axisHead = '<div class="gantt-head" style="grid-template-columns:' + gridCols + '">' + cols.map(function (d) {
            let label = '';
            if (state.zoom === 'day') label = dayNames[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0');
            else if (state.zoom === 'week') label = String(d.getDate()).padStart(2, '0');
            else label = d.toLocaleString('en-US', { month: 'short' });
            const weekAlt = (state.zoom !== 'month' && (weekIndexFrom(d) % 2 === 1)) ? ' week-alt' : '';
            return '<div class="gantt-cell' + weekAlt + '">' + esc(label) + '</div>';
        }).join('') + '</div>';

        const body = rows.map(function (row) {
            const t = row.task;
            const sDate = toDate(t.startDate);
            const dDate = toDate(t.dueDate);
            let bar = '';
            if (sDate && dDate) {
                const startOffsetDays = Math.max(0, Math.floor((sDate - range.start) / DAY_MS));
                const durationDays = Math.max(1, Math.floor((dDate - sDate) / DAY_MS) + 1);
                const leftUnits = state.zoom === 'month'
                    ? Math.max(0, ((sDate.getFullYear() * 12) + sDate.getMonth()) - ((range.start.getFullYear() * 12) + range.start.getMonth()))
                    : startOffsetDays;
                const widthUnits = state.zoom === 'month'
                    ? Math.max(1, (((dDate.getFullYear() * 12) + dDate.getMonth()) - ((sDate.getFullYear() * 12) + sDate.getMonth()) + 1))
                    : durationDays;
                const left = leftUnits * colPx;
                const width = Math.max(18, (widthUnits * colPx) - 6);
                const isChild = !!String(t.parentId || '').trim();
                const barBg = (t.taskColor && String(t.taskColor).trim()) ? toColorGradient(t.taskColor, isChild) : ganttColor(t.status);
                bar = '<div class="gantt-bar ' + (t.priority === 'High' || t.priority === 'Critical' ? 'priority-high' : '') + (isChild ? ' is-child' : '') + '" data-task-id="' + esc(t.taskId) + '" data-drag-type="move" style="left:' + left + 'px;width:' + width + 'px;background:' + barBg + '">' +
                    '<span class="gantt-handle left" data-task-id="' + esc(t.taskId) + '" data-drag-type="start"></span>' +
                    '<span class="gantt-handle right" data-task-id="' + esc(t.taskId) + '" data-drag-type="end"></span>' +
                '</div>';
            }
            return '<div class="gantt-row" style="grid-template-columns:' + gridCols + '">' + cols.map(function (d) {
                const weekAlt = (state.zoom !== 'month' && (weekIndexFrom(d) % 2 === 1)) ? ' week-alt' : '';
                return '<div class="gantt-cell' + weekAlt + '"></div>';
            }).join('') + bar + '</div>';
        }).join('');

        els.ganttWrap.innerHTML = monthHead + axisHead + body;
    }

    function openModal(taskId) {
        const task = state.tasks.find(function (t) { return t.taskId === taskId; });
        state.editingId = task ? task.taskId : null;
        byId('taskModalTitle').textContent = task ? task.title : 'New Task';

        byId('taskTitle').value = task ? task.title : '';
        byId('taskDescription').value = task ? task.description : '';
        byId('taskAssignee').value = task ? task.assignee : '';
        byId('taskStartDate').value = task ? task.startDate : toISODate(new Date());
        byId('taskDueDate').value = task ? task.dueDate : shiftIsoDate(toISODate(new Date()), 2);
        byId('taskPercent').value = task ? task.percentComplete : 0;
        byId('taskItemCode').value = task ? task.itemCode : '';
        byId('taskItemName').value = task ? task.itemName : '';
        autoSizeItemCodeInput((task && (task.itemName || task.description)) || byId('taskItemCode').value);
        closeItemLookup();
        byId('taskLocation').value = task ? task.location : '';
        byId('taskSublocation').value = task ? task.sublocation : '';
        byId('taskStatus').value = task ? task.status : 'Not Started';
        byId('taskPriority').value = task ? task.priority : 'Medium';
        byId('taskColor').value = normalizeColor(task ? task.taskColor : '#11998e');
        syncTaskColorPickerUi();

        byId('taskParentId').innerHTML = ['<option value="">No parent (group)</option>'].concat(
            state.tasks.filter(function (t) { return !task || t.taskId !== task.taskId; }).map(function (t) {
                return '<option value="' + esc(t.taskId) + '">' + esc(t.title) + '</option>';
            })
        ).join('');
        byId('taskParentId').value = task ? task.parentId : '';
        byId('taskArchiveBtn').style.display = task ? 'inline-block' : 'none';
        byId('taskModal').classList.add('open');
    }

    function closeModal() {
        byId('taskModal').classList.remove('open');
    }

    async function saveTask() {
        const now = isoNow();
        const payload = {
            taskId: state.editingId || ('TASK-' + Date.now()),
            parentId: byId('taskParentId').value,
            sortOrder: nextSortOrder(),
            level: byId('taskParentId').value ? 'child' : 'group',
            title: byId('taskTitle').value.trim() || 'New Task',
            description: byId('taskDescription').value.trim(),
            status: byId('taskStatus').value,
            priority: byId('taskPriority').value,
            assignee: byId('taskAssignee').value.trim(),
            startDate: byId('taskStartDate').value,
            dueDate: byId('taskDueDate').value,
            percentComplete: clamp(Number(byId('taskPercent').value || 0), 0, 100),
            itemCode: byId('taskItemCode').value.trim(),
            itemName: byId('taskItemName').value.trim(),
            location: byId('taskLocation').value.trim(),
            sublocation: byId('taskSublocation').value.trim(),
            dependencyIds: '',
            taskColor: normalizeColor(byId('taskColor').value),
            archived: false,
            createdAt: state.editingId ? (state.tasks.find(function (t) { return t.taskId === state.editingId; }) || {}).createdAt || now : now,
            updatedAt: now,
            createdBy: 'dashboard'
        };

        if (state.editingId) {
            const idx = state.tasks.findIndex(function (t) { return t.taskId === state.editingId; });
            if (idx >= 0) state.tasks[idx] = normalizeTask(payload, idx);
            await writeTask('updateTask', payload);
        } else {
            state.tasks.push(normalizeTask(payload, state.tasks.length));
            await writeTask('createTask', payload);
        }

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

    async function updateTaskDatesFromDrag(task, nextStart, nextDue) {
        task.startDate = nextStart;
        task.dueDate = nextDue;
        task.updatedAt = isoNow();
        await writeTask('updateTask', {
            taskId: task.taskId,
            startDate: task.startDate,
            dueDate: task.dueDate,
            updatedAt: task.updatedAt
        });
    }

    function startDrag(taskId, dragType, clientX) {
        const task = state.tasks.find(function (t) { return t.taskId === taskId; });
        if (!task) return;
        ensureTaskDates(task);

        state.drag = {
            taskId: task.taskId,
            dragType: dragType,
            startX: clientX,
            startDate: task.startDate,
            dueDate: task.dueDate,
            stepDays: state.zoom === 'month' ? 7 : 1,
            moved: false
        };
    }

    async function finishDrag() {
        const drag = state.drag;
        state.drag = null;
        if (!drag || !drag.moved) return;
        const task = state.tasks.find(function (t) { return t.taskId === drag.taskId; });
        if (!task) return;
        await updateTaskDatesFromDrag(task, task.startDate, task.dueDate);
        applyFilters();
    }

    function onDragMove(clientX) {
        const drag = state.drag;
        if (!drag) return;
        const task = state.tasks.find(function (t) { return t.taskId === drag.taskId; });
        if (!task) return;

        const deltaCols = Math.round((clientX - drag.startX) / state.colPx);
        const deltaDays = deltaCols * drag.stepDays;
        if (!deltaDays) return;

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
            renderGantt();
        }
    }

    async function writeTask(action, taskPayload) {
        const webAppUrl = getWebAppUrl();
        if (!webAppUrl) return;
        const sheetId = (localStorage.getItem('spike_sheetId') || '').trim();
        const payload = {
            action: 'taskWrite',
            taskAction: action,
            sheetId: sheetId,
            tabName: 'tasks',
            payload: JSON.stringify(taskPayload)
        };
        try {
            await postForm(webAppUrl, payload);
        } catch (e) {
            console.warn('Task write failed', e);
        }
    }

    function nextSortOrder() {
        return (state.tasks.reduce(function (max, t) { return Math.max(max, Number(t.sortOrder || 0)); }, 0) || 0) + 10;
    }

    function createNewTaskBlock() {
        state.editingId = null;
        openModal();
    }

    function bindEvents() {
        ['search','statusFilter','assigneeFilter','itemFilter','locationFilter'].forEach(function (k) {
            const ev = (k === 'statusFilter' || k === 'assigneeFilter') ? 'change' : 'input';
            els[k].addEventListener(ev, debounce(applyFilters, 120));
        });

        els.zoom.addEventListener('change', function () {
            state.zoom = els.zoom.value;
            renderGantt();
        });

        els.zoomOutBtn.addEventListener('click', function () {
            state.zoomOutLevel = (state.zoomOutLevel + 1) % 6;
            syncZoomOutUi();
            renderGantt();
        });

        byId('tasksExpandAll').addEventListener('click', function () {
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
            els.itemFilter.value = '';
            els.locationFilter.value = '';
            applyFilters();
        });

        byId('tasksAddBtn').addEventListener('click', createNewTaskBlock);
        byId('taskCancelBtn').addEventListener('click', closeModal);
        byId('taskSaveBtn').addEventListener('click', saveTask);
        byId('taskArchiveBtn').addEventListener('click', archiveEditingTask);

        const colorPicker = byId('taskColorPicker');
        if (colorPicker) {
            colorPicker.addEventListener('click', function (e) {
                const btn = e.target.closest('[data-task-color]');
                if (!btn) return;
                byId('taskColor').value = normalizeColor(btn.getAttribute('data-task-color'));
                syncTaskColorPickerUi();
            });
        }

        els.listBody.addEventListener('click', function (e) {
            const toggleId = e.target && e.target.getAttribute('data-toggle');
            if (toggleId) {
                state.expanded[toggleId] = state.expanded[toggleId] === false;
                applyFilters();
                return;
            }
            const row = e.target.closest('.tasks-row');
            if (row) openModal(row.getAttribute('data-task-id'));
        });

        els.ganttWrap.addEventListener('click', function (e) {
            if (state.drag && state.drag.moved) return;
            const bar = e.target.closest('.gantt-bar');
            if (bar) openModal(bar.getAttribute('data-task-id'));
        });

        els.ganttWrap.addEventListener('pointerdown', function (e) {
            const hit = e.target.closest('.gantt-bar, .gantt-handle');
            if (!hit) return;
            const taskId = hit.getAttribute('data-task-id');
            const dragType = hit.getAttribute('data-drag-type') || 'move';
            if (!taskId) return;
            e.preventDefault();
            startDrag(taskId, dragType, e.clientX);
        });

        window.addEventListener('pointermove', function (e) {
            if (!state.drag) return;
            onDragMove(e.clientX);
        });

        window.addEventListener('pointerup', function () {
            if (!state.drag) return;
            finishDrag();
        });

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) loadTasks();
        });

        window.addEventListener('message', function (event) {
            if (!event || !event.data) return;
            if (event.data.type === 'darkModeToggle') {
                document.body.classList.toggle('dark-mode', !!event.data.enabled);
            }
            if (event.data.type === 'setReferrer') {
                loadTasks();
            }
        });
    }

    function syncTaskColorPickerUi() {
        const active = normalizeColor((byId('taskColor') && byId('taskColor').value) || '#11998e');
        const nodes = document.querySelectorAll('#taskColorPicker [data-task-color]');
        nodes.forEach(function (node) {
            const c = normalizeColor(node.getAttribute('data-task-color'));
            node.classList.toggle('active', c === active);
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
        els.itemFilter = byId('tasksItemFilter');
        els.locationFilter = byId('tasksLocationFilter');
        els.zoom = byId('tasksZoom');
        els.zoomOutBtn = byId('tasksZoomOutBtn');
        els.filterToggle = byId('tasksFilterToggle');
        els.filtersPanel = byId('tasksFiltersPanel');
        els.clearFiltersBtn = byId('tasksClearFilters');
        els.listBody = byId('tasksListBody');
        els.ganttWrap = byId('tasksGanttWrap');
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

    async function init() {
        cacheEls();
        bindEvents();
        bindTaskItemLookup();
        bootstrapInventoryHint();
        syncFilterPanelUi();
        syncZoomOutUi();
        await loadTasks();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
