(function () {
    'use strict';

    const TASK_COLUMNS = ['taskId','parentId','sortOrder','level','title','description','status','priority','assignee','startDate','dueDate','percentComplete','itemCode','itemName','location','sublocation','dependencyIds','archived','createdAt','updatedAt','createdBy'];
    const DEFAULT_STATUS = ['all', 'Not Started', 'In Progress', 'Blocked', 'Done'];
    const DEFAULT_PRIORITY = ['Low', 'Medium', 'High', 'Critical'];
    const state = {
        loading: true,
        usingMock: false,
        expanded: {},
        tasks: [],
        filtered: [],
        flatRows: [],
        editingId: null,
        zoom: 'week',
        showArchived: false
    };

    const els = {};

    function byId(id) { return document.getElementById(id); }
    function isoNow() { return new Date().toISOString(); }
    function toDate(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    function toISODate(v) { const d = toDate(v); return d ? d.toISOString().slice(0, 10) : ''; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }

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
        return new Promise(function (resolve, reject) {
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

    function sampleTasks() {
        const now = isoNow();
        return [
            { taskId:'GRP-1', parentId:'', sortOrder:10, level:'group', title:'Quarterly Optimization', description:'Main group', status:'In Progress', priority:'High', assignee:'SARV', startDate:'2026-03-01', dueDate:'2026-03-31', percentComplete:48, itemCode:'', itemName:'', location:'Main Pharmacy', sublocation:'', dependencyIds:'', archived:false, createdAt:now, updatedAt:now, createdBy:'system' },
            { taskId:'TSK-1', parentId:'GRP-1', sortOrder:20, level:'parent', title:'Update shortage protocol', description:'Parent task', status:'In Progress', priority:'High', assignee:'Alex', startDate:'2026-03-02', dueDate:'2026-03-18', percentComplete:62, itemCode:'12345', itemName:'Epinephrine', location:'ED', sublocation:'Pyxis A', dependencyIds:'', archived:false, createdAt:now, updatedAt:now, createdBy:'system' },
            { taskId:'SUB-1', parentId:'TSK-1', sortOrder:30, level:'child', title:'Review substitution paths', description:'Subtask', status:'Not Started', priority:'Medium', assignee:'Jordan', startDate:'2026-03-08', dueDate:'2026-03-15', percentComplete:10, itemCode:'12345', itemName:'Epinephrine', location:'ED', sublocation:'Pyxis A', dependencyIds:'', archived:false, createdAt:now, updatedAt:now, createdBy:'system' },
            { taskId:'SUB-2', parentId:'TSK-1', sortOrder:40, level:'child', title:'Validate cabinet locations', description:'Subtask', status:'Blocked', priority:'Critical', assignee:'Taylor', startDate:'2026-03-11', dueDate:'2026-03-20', percentComplete:20, itemCode:'77612', itemName:'Norepinephrine', location:'ICU', sublocation:'Tower 3', dependencyIds:'SUB-1', archived:false, createdAt:now, updatedAt:now, createdBy:'system' }
        ];
    }

    function normalizeTask(raw, idx) {
        const out = {};
        TASK_COLUMNS.forEach(function (k) { out[k] = raw[k] != null ? raw[k] : ''; });
        out.taskId = String(out.taskId || ('TASK-' + Date.now() + '-' + idx));
        out.parentId = String(out.parentId || '');
        out.sortOrder = Number(out.sortOrder || ((idx + 1) * 10));
        out.title = String(out.title || 'Untitled Task');
        out.status = String(out.status || 'Not Started');
        out.priority = String(out.priority || 'Medium');
        out.percentComplete = Math.max(0, Math.min(100, Number(out.percentComplete || 0)));
        out.archived = String(out.archived).toLowerCase() === 'true' || out.archived === true;
        out.startDate = toISODate(out.startDate);
        out.dueDate = toISODate(out.dueDate);
        out.createdAt = out.createdAt || isoNow();
        out.updatedAt = out.updatedAt || isoNow();
        out.children = [];
        return out;
    }

    async function loadTasks() {
        state.loading = true;
        renderList();
        const webAppUrl = getWebAppUrl();
        if (!webAppUrl) {
            state.usingMock = true;
            state.tasks = sampleTasks().map(normalizeTask);
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
            console.warn('Task load failed, using sample data', e);
            state.usingMock = true;
            state.tasks = sampleTasks().map(normalizeTask);
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
        function sortChildren(arr) { arr.sort(function (a,b){ return a.sortOrder - b.sortOrder; }); arr.forEach(function (c){ sortChildren(c.children); }); }
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

    function applyFilters() {
        const q = (els.search.value || '').toLowerCase();
        const status = els.statusFilter.value;
        const assignee = els.assigneeFilter.value;
        const itemTerm = (els.itemFilter.value || '').toLowerCase();
        const locTerm = (els.locationFilter.value || '').toLowerCase();

        state.filtered = state.tasks.filter(function (t) {
            if (!state.showArchived && t.archived) return false;
            if (status !== 'all' && t.status !== status) return false;
            if (assignee !== 'all' && t.assignee !== assignee) return false;
            const hay = [t.title, t.description, t.itemCode, t.itemName, t.location, t.sublocation].join(' ').toLowerCase();
            if (q && hay.indexOf(q) === -1) return false;
            if (itemTerm && (String(t.itemCode).toLowerCase().indexOf(itemTerm) === -1 && String(t.itemName).toLowerCase().indexOf(itemTerm) === -1)) return false;
            if (locTerm && (String(t.location).toLowerCase().indexOf(locTerm) === -1 && String(t.sublocation).toLowerCase().indexOf(locTerm) === -1)) return false;
            return true;
        });

        populateFilters();
        const treeRoots = buildTree().filter(function (r) { return state.filtered.some(function (f) { return f.taskId === r.taskId; }) || hasFilteredDescendant(r); });
        const flat = [];
        flattenVisible(treeRoots, 0, flat);
        state.flatRows = flat.filter(function (x) { return state.filtered.some(function (f) { return f.taskId === x.task.taskId; }) || hasFilteredDescendant(x.task); });

        renderList();
        requestAnimationFrame(renderGantt);
    }

    function hasFilteredDescendant(task) {
        if (!task.children || !task.children.length) return false;
        for (let i = 0; i < task.children.length; i++) {
            const c = task.children[i];
            if (state.filtered.some(function (f) { return f.taskId === c.taskId; }) || hasFilteredDescendant(c)) return true;
        }
        return false;
    }

    function populateFilters() {
        const assignees = ['all'].concat(Array.from(new Set(state.tasks.map(function (t) { return t.assignee || ''; }).filter(Boolean))).sort());
        if (els.assigneeFilter.options.length !== assignees.length) {
            els.assigneeFilter.innerHTML = assignees.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a === 'all' ? 'All Assignees' : a) + '</option>'; }).join('');
        }
        if (!els.statusFilter.options.length) {
            els.statusFilter.innerHTML = DEFAULT_STATUS.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s === 'all' ? 'All Statuses' : s) + '</option>'; }).join('');
        }
        byId('taskStatus').innerHTML = DEFAULT_STATUS.filter(function (s) { return s !== 'all'; }).map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        byId('taskPriority').innerHTML = DEFAULT_PRIORITY.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    }

    function statusClass(status) {
        if (status === 'Done') return 'status-done';
        if (status === 'Blocked') return 'status-blocked';
        return 'status-open';
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
            const t = row.task;
            const hasChildren = t.children && t.children.length;
            const expanded = state.expanded[t.taskId] !== false;
            const indent = row.depth * 16;
            return '<div class="tasks-row" data-task-id="' + esc(t.taskId) + '">' +
                '<button class="tree-toggle" data-toggle="' + esc(t.taskId) + '">' + (hasChildren ? (expanded ? '▾' : '▸') : '•') + '</button>' +
                '<div class="task-title-wrap" style="padding-left:' + indent + 'px"><span class="task-title" title="' + esc(t.title) + '">' + esc(t.title) + '</span></div>' +
                '<div><span class="chip ' + statusClass(t.status) + '">' + esc(t.status) + '</span></div>' +
                '<div><span class="chip">' + esc(t.priority) + '</span></div>' +
                '<div>' + esc(t.percentComplete) + '%</div>' +
                '<div>' + esc(t.assignee || '—') + '</div>' +
                '<div><span class="chip" data-item-filter="' + esc(t.itemCode) + '">' + esc(t.itemCode || 'none') + '</span></div>' +
            '</div>';
        }).join('');
    }

    function computeRange(rows) {
        let start = null; let end = null;
        rows.forEach(function (row) {
            const s = toDate(row.task.startDate); const d = toDate(row.task.dueDate);
            if (s && (!start || s < start)) start = s;
            if (d && (!end || d > end)) end = d;
        });
        const now = new Date();
        if (!start) start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        if (!end) end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
        return { start: start, end: end };
    }

    function renderGantt() {
        const rows = state.flatRows;
        if (!rows.length) { els.ganttWrap.innerHTML = '<div class="tasks-empty">No scheduled tasks to display.</div>'; return; }
        const range = computeRange(rows);
        const dayMs = 86400000;
        const days = Math.max(1, Math.ceil((range.end - range.start) / dayMs) + 1);
        const colPx = state.zoom === 'month' ? 28 : 44;
        const cols = [];
        for (let i = 0; i < days; i++) {
            const dt = new Date(range.start.getTime() + (i * dayMs));
            if (state.zoom === 'month' && dt.getDay() !== 1) continue;
            cols.push(dt);
        }
        const gridCols = 'repeat(' + cols.length + ',' + colPx + 'px)';
        const head = '<div class="gantt-head" style="grid-template-columns:' + gridCols + '">' + cols.map(function (d) { return '<div class="gantt-cell">' + esc((d.getMonth() + 1) + '/' + d.getDate()) + '</div>'; }).join('') + '</div>';
        const body = rows.map(function (row) {
            const t = row.task;
            const sDate = toDate(t.startDate);
            const dDate = toDate(t.dueDate);
            const hasDates = sDate && dDate;
            let bar = '';
            if (hasDates) {
                const startOffsetDays = Math.max(0, Math.floor((sDate - range.start) / dayMs));
                const durDays = Math.max(1, Math.floor((dDate - sDate) / dayMs) + 1);
                const left = (state.zoom === 'month' ? Math.floor(startOffsetDays / 7) : startOffsetDays) * colPx;
                const width = (state.zoom === 'month' ? Math.max(1, Math.ceil(durDays / 7)) : durDays) * colPx - 6;
                bar = '<div class="gantt-bar ' + (t.priority === 'High' || t.priority === 'Critical' ? 'priority-high' : '') + '" data-task-open="' + esc(t.taskId) + '" style="left:' + left + 'px;width:' + width + 'px;background:' + ganttColor(t.status) + '"></div>';
            }
            return '<div class="gantt-row" style="grid-template-columns:' + gridCols + '">' + cols.map(function () { return '<div class="gantt-cell"></div>'; }).join('') + bar + '</div>';
        }).join('');
        els.ganttWrap.innerHTML = head + body;
    }

    function ganttColor(status) {
        if (status === 'Done') return 'rgba(92,184,92,0.85)';
        if (status === 'Blocked') return 'rgba(255,84,84,0.82)';
        if (status === 'Not Started') return 'rgba(102,126,234,0.75)';
        return 'rgba(17,153,142,0.82)';
    }

    function openModal(taskId) {
        const task = state.tasks.find(function (t) { return t.taskId === taskId; });
        state.editingId = task ? task.taskId : null;
        byId('taskModalTitle').textContent = task ? ('Edit ' + task.title) : 'Add Task';
        byId('taskTitle').value = task ? task.title : '';
        byId('taskDescription').value = task ? task.description : '';
        byId('taskAssignee').value = task ? task.assignee : '';
        byId('taskStartDate').value = task ? task.startDate : '';
        byId('taskDueDate').value = task ? task.dueDate : '';
        byId('taskPercent').value = task ? task.percentComplete : 0;
        byId('taskItemCode').value = task ? task.itemCode : '';
        byId('taskItemName').value = task ? task.itemName : '';
        byId('taskLocation').value = task ? task.location : '';
        byId('taskSublocation').value = task ? task.sublocation : '';
        byId('taskStatus').value = task ? task.status : 'Not Started';
        byId('taskPriority').value = task ? task.priority : 'Medium';
        byId('taskParentId').innerHTML = ['<option value="">No parent (group)</option>'].concat(state.tasks.filter(function (t) { return !task || t.taskId !== task.taskId; }).map(function (t) { return '<option value="' + esc(t.taskId) + '">' + esc(t.title) + '</option>'; })).join('');
        byId('taskParentId').value = task ? task.parentId : '';
        byId('taskArchiveBtn').style.display = task ? 'inline-block' : 'none';
        byId('taskModal').classList.add('open');
    }

    function closeModal() { byId('taskModal').classList.remove('open'); }

    async function saveTask() {
        const now = isoNow();
        const payload = {
            taskId: state.editingId || ('TASK-' + Date.now()),
            parentId: byId('taskParentId').value,
            sortOrder: nextSortOrder(),
            level: byId('taskParentId').value ? 'child' : 'group',
            title: byId('taskTitle').value.trim() || 'Untitled Task',
            description: byId('taskDescription').value.trim(),
            status: byId('taskStatus').value,
            priority: byId('taskPriority').value,
            assignee: byId('taskAssignee').value.trim(),
            startDate: byId('taskStartDate').value,
            dueDate: byId('taskDueDate').value,
            percentComplete: Math.max(0, Math.min(100, Number(byId('taskPercent').value || 0))),
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

    function bindEvents() {
        ['search','statusFilter','assigneeFilter','itemFilter','locationFilter'].forEach(function (k) {
            const ev = (k === 'statusFilter' || k === 'assigneeFilter') ? 'change' : 'input';
            els[k].addEventListener(ev, debounce(applyFilters, 120));
        });
        els.zoom.addEventListener('change', function () { state.zoom = els.zoom.value; renderGantt(); });
        byId('tasksExpandAll').addEventListener('click', function () {
            const collapse = state.flatRows.some(function (r) { return r.task.children && r.task.children.length && state.expanded[r.task.taskId] !== false; });
            state.flatRows.forEach(function (r) { if (r.task.children && r.task.children.length) state.expanded[r.task.taskId] = collapse ? false : true; });
            applyFilters();
        });
        byId('tasksAddBtn').addEventListener('click', function () { openModal(null); });
        byId('taskCancelBtn').addEventListener('click', closeModal);
        byId('taskSaveBtn').addEventListener('click', saveTask);
        byId('taskArchiveBtn').addEventListener('click', archiveEditingTask);
        els.listBody.addEventListener('click', function (e) {
            const toggleId = e.target && e.target.getAttribute('data-toggle');
            if (toggleId) { state.expanded[toggleId] = state.expanded[toggleId] === false; applyFilters(); return; }
            const row = e.target.closest('.tasks-row');
            if (row) openModal(row.getAttribute('data-task-id'));
            const itemCode = e.target && e.target.getAttribute('data-item-filter');
            if (itemCode) els.itemFilter.value = itemCode;
        });
        els.ganttWrap.addEventListener('click', function (e) {
            const tid = e.target && e.target.getAttribute('data-task-open');
            if (tid) openModal(tid);
        });
        window.addEventListener('message', function (event) {
            if (!event || !event.data) return;
            if (event.data.type === 'darkModeToggle') {
                document.body.classList.toggle('dark-mode', !!event.data.enabled);
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
        els.itemFilter = byId('tasksItemFilter');
        els.locationFilter = byId('tasksLocationFilter');
        els.zoom = byId('tasksZoom');
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

    async function init() {
        cacheEls();
        bindEvents();
        bootstrapInventoryHint();
        await loadTasks();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
