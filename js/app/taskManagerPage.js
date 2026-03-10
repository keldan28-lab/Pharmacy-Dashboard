(function(){
  'use strict';

  const TASK_TAB = 'taskList';
  const TASK_COLUMNS = [
    'taskId','title','status','priority','assigneeUserId','assigneeName','startDate','endDate','progressPct','itemCode','location','taskType','notes','createdAt','updatedAt','createdBy','updatedBy','archived'
  ];
  const TASK_STATUS = ['open','in_progress','blocked','done','cancelled'];
  const TASK_PRIORITY = ['low','medium','high','urgent'];
  const TASK_TYPES = ['review','transfer','adjust_par','investigate','count','expiry_check','deadstock_review','waste_followup','location_rebalance'];

  const state = { tasks: [], selectedTaskId: '', filters: { assignee: '', status: '', search: '', itemCode: '', location: '' } };

  function isoDate(v){ if(!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10); }
  function parseDate(v){ const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  function clampPct(v){ const n = Number(v); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }
  function escapeHtml(s){ return String(s||'').replace(/[&<>\"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]||c; }); }

  function getBridgeConfig(){
    const webAppUrl = String(localStorage.getItem('spike_webAppUrl') || '').trim();
    const sheetId = String(localStorage.getItem('spike_sheetId') || '').trim();
    return { webAppUrl, sheetId, tabName: TASK_TAB };
  }

  function jsonp(url, timeoutMs){
    timeoutMs = timeoutMs || 25000;
    return new Promise(function(resolve, reject){
      const cb = '__task_jsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      const script = document.createElement('script');
      let done = false;
      const timer = setTimeout(function(){ if(done) return; done = true; cleanup(); reject(new Error('timeout')); }, timeoutMs);
      function cleanup(){ clearTimeout(timer); try{ delete window[cb]; }catch(_){ window[cb] = undefined; } if(script.parentNode) script.parentNode.removeChild(script); }
      window[cb] = function(payload){ if(done) return; done = true; cleanup(); resolve(payload); };
      script.onerror = function(){ if(done) return; done = true; cleanup(); reject(new Error('load failed')); };
      script.src = url + sep + 'callback=' + encodeURIComponent(cb);
      document.head.appendChild(script);
    });
  }

  function formPost(url, payload){
    return new Promise(function(resolve){
      const iframe = document.createElement('iframe'); iframe.name = 'taskPost_' + Date.now(); iframe.style.display = 'none';
      const form = document.createElement('form'); form.method = 'POST'; form.action = url; form.target = iframe.name; form.style.display = 'none';
      Object.keys(payload).forEach(function(k){ const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = String(payload[k] == null ? '' : payload[k]); form.appendChild(i); });
      document.body.appendChild(iframe); document.body.appendChild(form); form.submit();
      setTimeout(function(){ if(form.parentNode) form.parentNode.removeChild(form); if(iframe.parentNode) iframe.parentNode.removeChild(iframe); resolve({ ok: true }); }, 800);
    });
  }

  async function apiGet(action, extra){
    const cfg = getBridgeConfig(); if(!cfg.webAppUrl || !cfg.sheetId) return { ok:true, tasks:[] };
    const qs = new URLSearchParams(Object.assign({ action: action, sheetId: cfg.sheetId, tabName: cfg.tabName }, extra || {}));
    return jsonp(cfg.webAppUrl.replace(/\/+$/,'') + '?' + qs.toString(), 30000);
  }

  async function apiPost(action, payload){
    const cfg = getBridgeConfig(); if(!cfg.webAppUrl || !cfg.sheetId) return { ok:false, error:'Missing Apps Script config' };
    const data = { action: action, sheetId: cfg.sheetId, tabName: cfg.tabName, payload: JSON.stringify(payload || {}) };
    await formPost(cfg.webAppUrl, data);
    return apiGet('getTaskById', { taskId: payload.taskId });
  }

  function normalizeTask(input){
    const now = new Date().toISOString();
    const out = Object.assign({}, input || {});
    out.taskId = String(out.taskId || ('task_' + Date.now()));
    out.title = String(out.title || '').trim();
    out.status = TASK_STATUS.includes(String(out.status)) ? String(out.status) : 'open';
    out.priority = TASK_PRIORITY.includes(String(out.priority)) ? String(out.priority) : 'medium';
    out.assigneeUserId = String(out.assigneeUserId || '').trim();
    out.assigneeName = String(out.assigneeName || '').trim();
    out.startDate = isoDate(out.startDate);
    out.endDate = isoDate(out.endDate);
    out.progressPct = clampPct(out.progressPct);
    out.itemCode = String(out.itemCode || '').trim();
    out.location = String(out.location || '').trim().toUpperCase();
    out.taskType = TASK_TYPES.includes(String(out.taskType)) ? String(out.taskType) : 'review';
    out.notes = String(out.notes || '').trim();
    out.createdAt = String(out.createdAt || now);
    out.updatedAt = now;
    out.createdBy = String(out.createdBy || localStorage.getItem('currentUserName') || 'dashboard_user');
    out.updatedBy = String(localStorage.getItem('currentUserName') || out.updatedBy || out.createdBy || 'dashboard_user');
    out.archived = String(out.archived) === 'true' || out.archived === true;
    return out;
  }

  function validateTask(task){
    if(!task.title) return 'Title is required';
    if(!task.assigneeUserId) return 'Assignee user ID is required';
    if(!task.startDate || !task.endDate) return 'Start and end dates are required';
    const s = parseDate(task.startDate), e = parseDate(task.endDate);
    if(!s || !e || e.getTime() < s.getTime()) return 'End date must be on or after start date';
    return '';
  }

  function filteredTasks(){
    return state.tasks.filter(function(t){
      if (t.archived) return false;
      if (state.filters.assignee && t.assigneeUserId !== state.filters.assignee) return false;
      if (state.filters.status && t.status !== state.filters.status) return false;
      if (state.filters.itemCode && String(t.itemCode || '').toLowerCase().indexOf(state.filters.itemCode) < 0) return false;
      if (state.filters.location && String(t.location || '').toLowerCase().indexOf(state.filters.location) < 0) return false;
      if (state.filters.search) {
        const hay = [t.title,t.notes,t.taskId,t.assigneeName,t.itemCode].join(' ').toLowerCase();
        if (hay.indexOf(state.filters.search) < 0) return false;
      }
      return true;
    });
  }

  function buildTimelineRows(tasks){
    const grouped = {};
    tasks.forEach(function(t){ const key = t.assigneeUserId || 'unassigned'; if(!grouped[key]) grouped[key] = []; grouped[key].push(t); });
    const rows = [];
    Object.keys(grouped).sort().forEach(function(assignee){
      const lanes = [];
      grouped[assignee].sort(function(a,b){ return (parseDate(a.startDate)?.getTime()||0) - (parseDate(b.startDate)?.getTime()||0); }).forEach(function(t){
        const s = parseDate(t.startDate); const e = parseDate(t.endDate); if(!s || !e) return;
        let laneIndex = 0;
        while(laneIndex < lanes.length && s.getTime() <= lanes[laneIndex]) laneIndex++;
        if (laneIndex >= lanes.length) lanes.push(e.getTime()); else lanes[laneIndex] = e.getTime();
        rows.push({
          rowId: assignee + ':' + laneIndex + ':' + t.taskId,
          assigneeUserId: assignee,
          assigneeLabel: t.assigneeName || assignee,
          laneIndex: laneIndex,
          taskId: t.taskId,
          taskTitle: t.title,
          status: t.status,
          itemCode: t.itemCode,
          location: t.location,
          startDate: t.startDate,
          endDate: t.endDate,
          startTs: s.getTime(),
          endTs: e.getTime(),
          durationDays: Math.max(1, Math.round((e.getTime()-s.getTime())/86400000) + 1)
        });
      });
    });
    return rows;
  }

  function statusClass(status){
    if(status === 'done') return 'green';
    if(status === 'blocked') return 'orange';
    if(status === 'cancelled') return 'gray';
    if(status === 'in_progress') return 'blue';
    return 'green';
  }

  function render(){
    const tasks = filteredTasks();
    const tbody = document.getElementById('taskTableBody');
    const rowsByAssignee = {};
    tasks.forEach(function(t){ const k = t.assigneeUserId || 'unassigned'; if(!rowsByAssignee[k]) rowsByAssignee[k] = []; rowsByAssignee[k].push(t); });
    let html = '';
    Object.keys(rowsByAssignee).sort().forEach(function(k){
      const label = rowsByAssignee[k][0].assigneeName || k;
      html += '<tr><td colspan="5"><strong>' + escapeHtml(label) + '</strong></td></tr>';
      rowsByAssignee[k].forEach(function(t){
        const sel = t.taskId === state.selectedTaskId ? ' style="background: rgba(var(--teal-primary-rgb),0.15);"' : '';
        html += '<tr data-task-id="' + escapeHtml(t.taskId) + '"' + sel + '><td>' + escapeHtml(t.assigneeUserId) + '</td><td>' + escapeHtml(t.title) + '</td><td>' + escapeHtml(t.status) + '</td><td>' + escapeHtml(t.startDate + ' → ' + t.endDate) + '</td><td>' + escapeHtml([t.itemCode,t.location].filter(Boolean).join(' • ')) + '</td></tr>';
      });
    });
    tbody.innerHTML = html || '<tr><td colspan="5">No tasks</td></tr>';

    Array.from(tbody.querySelectorAll('tr[data-task-id]')).forEach(function(row){
      row.addEventListener('click', function(){ selectTask(row.getAttribute('data-task-id')); });
    });

    renderTimeline(tasks);
    populateFilterChoices();
  }

  function renderTimeline(tasks){
    const root = document.getElementById('taskTimelineRoot');
    const rows = buildTimelineRows(tasks);
    if(!rows.length){ root.innerHTML = '<div class="card-subtitle">No timeline rows</div>'; return; }
    const minTs = Math.min.apply(null, rows.map(r=>r.startTs));
    const maxTs = Math.max.apply(null, rows.map(r=>r.endTs));
    const span = Math.max(86400000, maxTs - minTs);
    let html = '';
    rows.forEach(function(r){
      const left = Math.max(0, ((r.startTs - minTs) / span) * 100);
      const width = Math.max(2, ((r.endTs - r.startTs + 86400000) / span) * 100);
      const selected = r.taskId === state.selectedTaskId;
      html += '<div data-task-id="'+escapeHtml(r.taskId)+'" class="opt-row'+(selected?' focus-parent':'')+'" style="grid-template-columns: 180px 1fr;">' +
        '<div><div class="opt-row-title">'+escapeHtml(r.assigneeLabel)+'</div><div class="opt-row-sub">'+escapeHtml(r.taskTitle)+'</div></div>' +
        '<div class="opt-bar-wrap" style="background:rgba(128,128,128,0.08); position:relative;">' +
        '<div class="opt-seg '+statusClass(r.status)+'" style="position:absolute;left:'+left+'%;width:'+width+'%;opacity:'+(selected?'1':'0.82')+';"></div>' +
        '<div style="position:absolute;left:6px;top:6px;font-size:11px;">'+escapeHtml(r.startDate+' → '+r.endDate)+'</div></div></div>';
    });
    root.innerHTML = html;
    Array.from(root.querySelectorAll('[data-task-id]')).forEach(function(el){ el.addEventListener('click', function(){ selectTask(el.getAttribute('data-task-id')); }); });
  }

  function getTaskById(taskId){ return state.tasks.find(function(t){ return t.taskId === taskId; }) || null; }

  function setSelectOptions(id, values){
    const el = document.getElementById(id); if(!el) return;
    el.innerHTML = values.map(function(v){ return '<option value="'+v+'">'+v+'</option>'; }).join('');
  }

  function populateFilterChoices(){
    const assignees = Array.from(new Set(state.tasks.filter(t=>!t.archived).map(t=>t.assigneeUserId))).sort();
    const aSel = document.getElementById('taskAssigneeFilter');
    const prev = aSel.value;
    aSel.innerHTML = '<option value="">All assignees</option>' + assignees.map(v => '<option value="'+escapeHtml(v)+'">'+escapeHtml(v)+'</option>').join('');
    if (assignees.indexOf(prev) >= 0) aSel.value = prev;
    const sSel = document.getElementById('taskStatusFilter');
    const p = sSel.value;
    sSel.innerHTML = '<option value="">All statuses</option>' + TASK_STATUS.map(v => '<option value="'+v+'">'+v+'</option>').join('');
    if (TASK_STATUS.indexOf(p) >= 0) sSel.value = p;
  }

  function fillEditor(task){
    const t = task || normalizeTask({});
    document.getElementById('taskIdField').value = t.taskId || '';
    document.getElementById('taskTitleField').value = t.title || '';
    document.getElementById('taskStatusField').value = t.status || 'open';
    document.getElementById('taskPriorityField').value = t.priority || 'medium';
    document.getElementById('taskAssigneeUserIdField').value = t.assigneeUserId || '';
    document.getElementById('taskAssigneeNameField').value = t.assigneeName || '';
    document.getElementById('taskStartDateField').value = t.startDate || '';
    document.getElementById('taskEndDateField').value = t.endDate || '';
    document.getElementById('taskProgressPctField').value = String(t.progressPct || 0);
    document.getElementById('taskItemCodeField').value = t.itemCode || '';
    document.getElementById('taskLocationField').value = t.location || '';
    document.getElementById('taskTypeField').value = t.taskType || 'review';
    document.getElementById('taskNotesField').value = t.notes || '';
  }

  function editorTask(){
    return normalizeTask({
      taskId: document.getElementById('taskIdField').value,
      title: document.getElementById('taskTitleField').value,
      status: document.getElementById('taskStatusField').value,
      priority: document.getElementById('taskPriorityField').value,
      assigneeUserId: document.getElementById('taskAssigneeUserIdField').value,
      assigneeName: document.getElementById('taskAssigneeNameField').value,
      startDate: document.getElementById('taskStartDateField').value,
      endDate: document.getElementById('taskEndDateField').value,
      progressPct: document.getElementById('taskProgressPctField').value,
      itemCode: document.getElementById('taskItemCodeField').value,
      location: document.getElementById('taskLocationField').value,
      taskType: document.getElementById('taskTypeField').value,
      notes: document.getElementById('taskNotesField').value,
      createdAt: (getTaskById(document.getElementById('taskIdField').value) || {}).createdAt,
      createdBy: (getTaskById(document.getElementById('taskIdField').value) || {}).createdBy
    });
  }

  function selectTask(taskId){
    state.selectedTaskId = taskId || '';
    fillEditor(getTaskById(state.selectedTaskId));
    render();
  }

  async function loadTasks(){
    const res = await apiGet('getTasks');
    state.tasks = Array.isArray(res && res.tasks) ? res.tasks.map(normalizeTask) : [];
    state.tasks.sort(function(a,b){ return String(a.startDate).localeCompare(String(b.startDate)); });
    if (state.selectedTaskId && !getTaskById(state.selectedTaskId)) state.selectedTaskId = '';
    render();
  }

  async function saveTask(){
    const task = editorTask();
    const err = validateTask(task);
    if(err){ alert(err); return; }
    const exists = !!getTaskById(task.taskId);
    const action = exists ? 'updateTask' : 'addTask';
    const res = await apiPost(action, task);
    if (res && res.ok === false) { alert(res.error || 'Failed to save task'); return; }
    await loadTasks();
    selectTask(task.taskId);
  }

  async function archiveSelectedTask(){
    if(!state.selectedTaskId) return;
    await apiPost('archiveTask', { taskId: state.selectedTaskId });
    state.selectedTaskId = '';
    await loadTasks();
    fillEditor(null);
  }

  function wire(){
    setSelectOptions('taskStatusField', TASK_STATUS);
    setSelectOptions('taskPriorityField', TASK_PRIORITY);
    setSelectOptions('taskTypeField', TASK_TYPES);

    document.getElementById('taskSearchInput').addEventListener('input', function(e){ state.filters.search = String(e.target.value || '').trim().toLowerCase(); render(); });
    document.getElementById('taskItemCodeInput').addEventListener('input', function(e){ state.filters.itemCode = String(e.target.value || '').trim().toLowerCase(); render(); });
    document.getElementById('taskLocationInput').addEventListener('input', function(e){ state.filters.location = String(e.target.value || '').trim().toLowerCase(); render(); });
    document.getElementById('taskAssigneeFilter').addEventListener('change', function(e){ state.filters.assignee = String(e.target.value || ''); render(); });
    document.getElementById('taskStatusFilter').addEventListener('change', function(e){ state.filters.status = String(e.target.value || ''); render(); });
    document.getElementById('taskAddBtn').addEventListener('click', function(){
      state.selectedTaskId = '';
      fillEditor(normalizeTask({ taskId: 'task_' + Date.now(), startDate: isoDate(new Date()), endDate: isoDate(new Date()) }));
      render();
    });
    document.getElementById('taskSaveBtn').addEventListener('click', saveTask);
    document.getElementById('taskArchiveBtn').addEventListener('click', archiveSelectedTask);
  }

  document.addEventListener('DOMContentLoaded', function(){ wire(); fillEditor(null); loadTasks(); });
})();
