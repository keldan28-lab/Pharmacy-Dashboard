const CONFIG = { DEFAULT_TAB: "min_spike_factors" };

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || "";
  const fn = p.fn || "";
  const callback = p.callback;

  if (fn === "sun") {
    const lat = Number(p.lat);
    const lng = Number(p.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return jsonOrJsonp_({ status: "ERROR", error: "Missing or invalid lat/lng" }, callback);
    }

    try {
      const apiUrl = `https://api.sunrise-sunset.org/json?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&formatted=0`;
      const response = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        return jsonOrJsonp_({ status: "ERROR", error: `Sun API request failed: ${code}` }, callback);
      }

      const body = response.getContentText();
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch (_) {
        return jsonOrJsonp_({ status: "ERROR", error: "Invalid sun API response" }, callback);
      }
      return jsonOrJsonp_(payload, callback);
    } catch (err) {
      return jsonOrJsonp_({ status: "ERROR", error: String((err && err.message) || err || "Unknown error") }, callback);
    }
  }

  if (action === "read") {
    const sheetId = p.sheetId;
    const tabName = p.tabName || CONFIG.DEFAULT_TAB;
    const result = spikeRead_(sheetId, tabName);
    return jsonOrJsonp_(result, callback);
  }



  if (action === "readLatest") {
    const sheetId = p.sheetId;
    const tabName = p.tabName || CONFIG.DEFAULT_TAB;
    const result = spikeReadLatest_(sheetId, tabName);
    return jsonOrJsonp_(result, callback);
  }

  if (action === "write" || action === "append") {
    try {
      const sheetId = requireString_(p.sheetId, "sheetId");
      const tabName = requireString_(p.tabName || CONFIG.DEFAULT_TAB, "tabName");
      const payload = parseJson_(p.payload || "{}", "payload");
      const rows2d = extractRows2d_(payload);

      const result = action === "write"
        ? spikeWrite_(sheetId, tabName, rows2d)
        : spikeAppend_(sheetId, tabName, rows2d);

      return jsonOrJsonp_(Object.assign({ action }, result), callback);
    } catch (err) {
      return jsonOrJsonp_({ ok: false, action, error: String((err && err.message) || err || "Unknown error") }, callback);
    }
  }


  if (action === "tasksRead") {
    try {
      const sheetId = requireString_(p.sheetId, "sheetId");
      const result = tasksRead_(sheetId, 'tasks');
      return jsonOrJsonp_(result, callback);
    } catch (err) {
      return jsonOrJsonp_({ ok: false, action, error: String((err && err.message) || err || "Unknown error") }, callback);
    }
  }

  if (action === "checklistRead") {
    try {
      const sheetId = requireString_(p.sheetId, "sheetId");
      const taskId = requireString_(p.taskId, "taskId");
      const result = checklistRead_(sheetId, 'check list', taskId);
      return jsonOrJsonp_(result, callback);
    } catch (err) {
      return jsonOrJsonp_({ ok: false, action, error: String((err && err.message) || err || "Unknown error") }, callback);
    }
  }

  if (action === "ping") {
    return jsonOrJsonp_({ ok: true, ts: new Date().toISOString() }, callback);
  }

  return jsonOrJsonp_({ ok: true, status: "ok" }, callback);
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const body = parsePostBody_(e);
  const callback = p.callback || body.callback;
  const action = p.action || body.action || "";

  if (action === "write" || action === "append") {
    try {
      const sheetId = requireString_(p.sheetId || body.sheetId, "sheetId");
      const tabName = requireString_(p.tabName || body.tabName || CONFIG.DEFAULT_TAB, "tabName");

      let rows2d = [];
      if (Array.isArray(body.rows)) {
        rows2d = body.rows;
      } else {
        const payloadRaw = p.payload || body.payload;
        const payload = parseJson_(payloadRaw || "{}", "payload");
        rows2d = payload.rows;
      }
      validateRows2d_(rows2d);

      const result = action === "write"
        ? spikeWrite_(sheetId, tabName, rows2d)
        : spikeAppend_(sheetId, tabName, rows2d);

      if (callback) return jsonOrJsonp_(Object.assign({ action }, result), callback);
      return ContentService
        .createTextOutput(JSON.stringify(Object.assign({ action }, result)))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      const out = { ok: false, action, error: String((err && err.message) || err || "Unknown error") };
      if (callback) return jsonOrJsonp_(out, callback);
      return ContentService
        .createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (action === "taskWrite") {
    try {
      const sheetId = requireString_(p.sheetId || body.sheetId, "sheetId");
      const tabName = String(p.tabName || body.tabName || 'tasks').trim() || 'tasks';
      const taskAction = String(p.taskAction || body.taskAction || '').trim();
      const payload = parseJson_(p.payload || body.payload || '{}', 'payload');
      const result = taskWrite_(sheetId, tabName, taskAction, payload);
      if (callback) return jsonOrJsonp_(Object.assign({ action, taskAction }, result), callback);
      return ContentService
        .createTextOutput(JSON.stringify(Object.assign({ action, taskAction }, result)))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      const out = { ok: false, action, error: String((err && err.message) || err || "Unknown error") };
      if (callback) return jsonOrJsonp_(out, callback);
      return ContentService
        .createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (action === "readLatest") {
    const sheetId = p.sheetId || body.sheetId;
    const tabName = p.tabName || body.tabName || CONFIG.DEFAULT_TAB;
    const result = spikeReadLatest_(sheetId, tabName);
    if (callback) return jsonOrJsonp_(result, callback);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "itemStatusWrite") {
    try {
      const sheetId = requireString_(p.sheetId || body.sheetId, "sheetId");
      const tabName = String(p.tabName || body.tabName || 'itemStatus').trim() || 'itemStatus';
      const rowObj = {
        updatedAt: p.updatedAt || body.updatedAt || new Date().toISOString(),
        itemCode: p.itemCode || body.itemCode || '',
        description: p.description || body.description || '',
        availability: p.availability || body.availability || '',
        status: p.status || body.status || '',
        notes: p.notes || body.notes || '',
        SBARnotes: p.SBARnotes || body.SBARnotes || '',
        filePath: p.filePath || body.filePath || '',
        etaDate: p.etaDate || body.etaDate || '',
        date: p.date || body.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
      };

      const result = itemStatusWrite_(sheetId, tabName, rowObj);
      if (callback) return jsonOrJsonp_(Object.assign({ action }, result), callback);
      return ContentService
        .createTextOutput(JSON.stringify(Object.assign({ action }, result)))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      const out = { ok: false, action, error: String((err && err.message) || err || "Unknown error") };
      if (callback) return jsonOrJsonp_(out, callback);
      return ContentService
        .createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: "unknown op" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== helpers =====

function spikeRead_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(tabName);
  if (!sh) return { ok: true, rows: [], tabName };
  const values = sh.getDataRange().getValues();
  return { ok: true, rows: values, tabName };
}

function spikeWrite_(sheetId, tabName, rows2d) {
  validateRows2d_(rows2d);
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);

  const hasData = sh.getLastRow() > 0 && sh.getLastColumn() > 0;
  const existingHeader = hasData
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    : [];

  const incomingHasHeader = isHeaderRow_(rows2d[0], existingHeader);
  let header = incomingHasHeader ? rows2d[0].slice() : (hasData ? existingHeader.slice() : []);
  if (!header.length) {
    header = incomingHasHeader ? rows2d[0].slice() : rows2d[0].map(function (_, i) { return 'col' + (i + 1); });
  }

  const rowsToWrite = incomingHasHeader ? rows2d.slice(1) : rows2d.slice();
  const prep = prepareTrendUpsertRows_(header, rowsToWrite);
  header = prep.header;
  const bodyRows = prep.rows;

  const keyIdx = getTrendKeyIndexes_(header);
  const canUpsert = keyIdx.dateISO >= 0 && keyIdx.location >= 0 && keyIdx.itemCode >= 0;

  if (!hasData) {
    const allRows = [header].concat(bodyRows);
    if (allRows.length) {
      sh.getRange(1, 1, allRows.length, header.length).setValues(allRows);
    }
    return { ok: true, written: bodyRows.length, tabName, mode: canUpsert ? 'upsert' : 'append', inserted: bodyRows.length, updated: 0, headerWritten: true };
  }

  const existingHeaderNorm = existingHeader.map(function (v) { return String(v || '').trim().toLowerCase(); });
  const incomingHeaderNorm = header.map(function (v) { return String(v || '').trim().toLowerCase(); });
  let headerMatches = existingHeaderNorm.length === incomingHeaderNorm.length;
  if (headerMatches) {
    for (let i = 0; i < existingHeaderNorm.length; i++) {
      if (existingHeaderNorm[i] !== incomingHeaderNorm[i]) { headerMatches = false; break; }
    }
  }

  if (!headerMatches) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }

  if (!bodyRows.length) {
    return { ok: true, written: 0, tabName, mode: canUpsert ? 'upsert' : 'append', inserted: 0, updated: 0, headerWritten: !headerMatches };
  }

  if (!canUpsert) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, bodyRows.length, header.length).setValues(bodyRows);
    return { ok: true, written: bodyRows.length, tabName, mode: 'append', inserted: bodyRows.length, updated: 0, headerWritten: !headerMatches };
  }

  const lastRow = sh.getLastRow();
  const existingRows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, header.length).getValues() : [];
  const rowByKey = {};
  for (let i = 0; i < existingRows.length; i++) {
    const key = trendKeyFromRow_(existingRows[i], keyIdx);
    if (!key) continue;
    rowByKey[key] = i + 2;
  }

  let updated = 0;
  let inserted = 0;
  const appendRows = [];
  for (let i = 0; i < bodyRows.length; i++) {
    const row = bodyRows[i];
    const key = trendKeyFromRow_(row, keyIdx);
    if (!key) continue;
    const targetRow = rowByKey[key];
    if (targetRow) {
      sh.getRange(targetRow, 1, 1, header.length).setValues([row]);
      updated++;
    } else {
      appendRows.push(row);
      rowByKey[key] = -1;
    }
  }

  if (appendRows.length) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, appendRows.length, header.length).setValues(appendRows);
    inserted = appendRows.length;
  }

  return { ok: true, written: updated + inserted, tabName, mode: 'upsert', inserted, updated, key: 'dateISO|location|itemCode', headerWritten: !headerMatches };
}

function prepareTrendUpsertRows_(header, rows) {
  let outHeader = Array.isArray(header) ? header.slice() : [];
  const headerMap = mapHeaderIndexes_(outHeader);
  let dateIdx = headerMap.dateiso;
  const tsIdx = (headerMap.calculatedat != null) ? headerMap.calculatedat : ((headerMap.timestamp != null) ? headerMap.timestamp : -1);

  if (dateIdx == null || dateIdx < 0) {
    outHeader.push('dateISO');
    dateIdx = outHeader.length - 1;
  }

  const width = outHeader.length;
  const outRows = [];
  for (let i = 0; i < rows.length; i++) {
    const src = Array.isArray(rows[i]) ? rows[i] : [];
    const row = src.slice(0, width);
    while (row.length < width) row.push('');

    let dateISO = toDateISO_(row[dateIdx]);
    if (!dateISO && tsIdx >= 0) dateISO = toDateISO_(row[tsIdx]);
    if (dateISO) row[dateIdx] = dateISO;

    outRows.push(row);
  }

  return { header: outHeader, rows: outRows };
}

function mapHeaderIndexes_(header) {
  const map = {};
  for (let i = 0; i < header.length; i++) {
    const k = String(header[i] || '').trim().toLowerCase().replace(/\s+/g, '');
    if (k && map[k] == null) map[k] = i;
  }
  return map;
}

function getTrendKeyIndexes_(header) {
  const map = mapHeaderIndexes_(header || []);
  return {
    dateISO: (map.dateiso != null) ? map.dateiso : ((map.date != null) ? map.date : -1),
    location: (map.location != null) ? map.location : ((map.sublocation != null) ? map.sublocation : ((map.sendtolocation != null) ? map.sendtolocation : -1)),
    itemCode: (map.itemcode != null) ? map.itemcode : ((map.code != null) ? map.code : -1)
  };
}

function trendKeyFromRow_(row, idx) {
  if (!row || !idx) return '';
  const d = toDateISO_(row[idx.dateISO]);
  const l = String(row[idx.location] || '').trim().toUpperCase();
  const i = String(row[idx.itemCode] || '').trim().toUpperCase();
  if (!d || !l || !i) return '';
  return [d, l, i].join('|');
}

function toDateISO_(value) {
  if (value == null || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function spikeAppend_(sheetId, tabName, rows2d) {
  validateRows2d_(rows2d);
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);

  const hasData = sh.getLastRow() > 0 && sh.getLastColumn() > 0;
  const firstIncomingRow = rows2d[0] || [];
  const existingHeader = hasData
    ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), firstIncomingRow.length || 1)).getValues()[0]
    : [];

  const skipHeader = hasData && isHeaderRow_(firstIncomingRow, existingHeader);
  const rowsToWrite = skipHeader ? rows2d.slice(1) : rows2d;
  if (!rowsToWrite.length) return { ok: true, written: 0, tabName, mode: "append" };

  const startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);

  const endRow = startRow + rowsToWrite.length - 1;
  return {
    ok: true,
    written: rowsToWrite.length,
    tabName,
    mode: "append",
    updatedRange: `A${startRow}:${toA1Col_(rowsToWrite[0].length)}${endRow}`,
    skippedHeader: skipHeader
  };
}

function spikeReadLatest_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(tabName);
  if (!sh) return { ok: true, rows: [], tabName, calculatedAt: "" };

  const values = sh.getDataRange().getValues();
  if (!values || values.length === 0) return { ok: true, rows: [], tabName, calculatedAt: "" };
  if (values.length === 1) return { ok: true, rows: [values[0]], tabName, calculatedAt: "" };

  const header = values[0];
  let i = values.length - 1;
  let latestTs = values[i] && values[i][0] ? String(values[i][0]) : "";

  while (i > 0 && !latestTs) {
    i--;
    latestTs = values[i] && values[i][0] ? String(values[i][0]) : "";
  }
  if (!latestTs) return { ok: true, rows: [header], tabName, calculatedAt: "" };

  const block = [];
  for (let j = i; j > 0; j--) {
    const ts = values[j] && values[j][0] ? String(values[j][0]) : "";
    if (ts !== latestTs) break;
    block.push(values[j]);
  }
  block.reverse();

  return {
    ok: true,
    rows: [header].concat(block),
    tabName,
    calculatedAt: latestTs
  };
}

function itemStatusWrite_(sheetId, tabName, rowObj) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);

  const header = ['updatedAt', 'date', 'itemCode', 'description', 'availability', 'status', 'notes', 'SBARnotes', 'filePath', 'etaDate'];
  const lastRow = sh.getLastRow();

  if (lastRow < 1) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    const existingHeader = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), header.length)).getValues()[0].slice(0, header.length);
    let same = true;
    for (let i = 0; i < header.length; i++) {
      if (String(existingHeader[i] || '').trim() !== header[i]) { same = false; break; }
    }
    if (!same) sh.getRange(1, 1, 1, header.length).setValues([header]);
  }

  const row = [
    String(rowObj.updatedAt || new Date().toISOString()),
    String(rowObj.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')),
    String(rowObj.itemCode || ''),
    String(rowObj.description || ''),
    String(rowObj.availability || ''),
    String(rowObj.status || ''),
    String(rowObj.notes || ''),
    String(rowObj.SBARnotes || ''),
    String(rowObj.filePath || ''),
    String(rowObj.etaDate || '')
  ];

  sh.appendRow(row);
  return { ok: true, written: 1, tabName };
}


function taskColumns_() {
  return ['taskId','parentId','sortOrder','level','title','description','status','priority','assigner','assignees','startDate','dueDate','percentComplete','itemCode','itemName','location','sublocation','dependencyIds','dependencyRules','blockedByTaskId','blockReason','assignmentMode','assignmentGroup','requiredSkills','assignmentCursor','archived','createdAt','updatedAt','createdBy','colorKey','assignedAt','lastStatusChangeAt','slaHours','escalationState','escalatedAt','exceptionFlag'];
}

function parseRequiredSkills_(raw) {
  if (Array.isArray(raw)) {
    return raw.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
  }
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return [];
  if (text.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
    } catch (err) {}
  }
  return text.split(/[|,;\n]/).map(function (v) { return String(v || '').trim(); }).filter(Boolean);
}

function normalizeTaskAssignmentFields_(obj) {
  var out = obj || {};
  var mode = String(out.assignmentMode || '').trim().toLowerCase();
  var allowed = { manual: true, round_robin: true, queue_claim: true, load_balanced: true, skill_based: true };
  out.assignmentMode = allowed[mode] ? mode : 'manual';
  out.assignmentGroup = String(out.assignmentGroup || '').trim();
  out.requiredSkills = JSON.stringify(parseRequiredSkills_(out.requiredSkills));
  out.assignmentCursor = String(out.assignmentCursor || '').trim();
  return out;
}

function deriveAssignmentCandidates_(rows, idx, selfTaskId, groupName, requiredSkills) {
  var seen = {};
  var candidates = [];
  var targetGroup = String(groupName || '').trim().toLowerCase();
  var required = (Array.isArray(requiredSkills) ? requiredSkills : []).map(function (s) { return String(s || '').trim().toLowerCase(); }).filter(Boolean);

  function includeByGroup_(row) {
    if (!targetGroup) return true;
    return String(row[idx.assignmentGroup] || '').trim().toLowerCase() === targetGroup;
  }

  function includeBySkill_(row) {
    if (!required.length) return true;
    var skills = parseRequiredSkills_(row[idx.requiredSkills]).map(function (s) { return String(s || '').trim().toLowerCase(); });
    for (var i = 0; i < required.length; i++) {
      if (skills.indexOf(required[i]) >= 0) return true;
    }
    return false;
  }

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var taskId = String(row[idx.taskId] || '').trim();
    if (!taskId || taskId === selfTaskId) continue;
    if (!includeByGroup_(row)) continue;
    if (!includeBySkill_(row)) continue;
    var names = parseAssignees_(row[idx.assignees]);
    for (var i = 0; i < names.length; i++) {
      var key = names[i].toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      candidates.push(names[i]);
    }
  }
  return candidates;
}

function applyAssignmentModeForRow_(row, rows, idx, taskId) {
  var mode = String(row[idx.assignmentMode] || 'manual').trim().toLowerCase();
  var providedAssignees = parseAssignees_(row[idx.assignees]);
  var groupName = String(row[idx.assignmentGroup] || '').trim();
  var requiredSkills = parseRequiredSkills_(row[idx.requiredSkills]);
  var candidatePool = deriveAssignmentCandidates_(rows, idx, taskId, groupName, mode === 'skill_based' ? requiredSkills : []);
  if (!candidatePool.length && mode === 'skill_based') {
    candidatePool = deriveAssignmentCandidates_(rows, idx, taskId, groupName, []);
  }

  if (mode === 'queue_claim') {
    row[idx.assignees] = JSON.stringify([]);
    return;
  }

  if (mode === 'manual') {
    row[idx.assignees] = JSON.stringify(providedAssignees);
    return;
  }

  if (!candidatePool.length) {
    row[idx.assignees] = JSON.stringify(providedAssignees);
    return;
  }

  if (mode === 'round_robin') {
    var cursor = Number(row[idx.assignmentCursor]);
    if (!isFinite(cursor) || cursor < 0) cursor = 0;
    var pick = candidatePool[cursor % candidatePool.length];
    row[idx.assignees] = JSON.stringify(pick ? [pick] : []);
    row[idx.assignmentCursor] = String((cursor + 1) % candidatePool.length);
    return;
  }

  if (mode === 'load_balanced') {
    var counts = {};
    for (var c = 0; c < candidatePool.length; c++) counts[candidatePool[c]] = 0;
    for (var r = 0; r < rows.length; r++) {
      var existingTaskId = String(rows[r][idx.taskId] || '').trim();
      if (!existingTaskId || existingTaskId === taskId) continue;
      if (String(rows[r][idx.archived] || '').toLowerCase() === 'true') continue;
      if (isTaskDone_(rows[r][idx.status])) continue;
      var names = parseAssignees_(rows[r][idx.assignees]);
      for (var n = 0; n < names.length; n++) {
        if (Object.prototype.hasOwnProperty.call(counts, names[n])) counts[names[n]]++;
      }
    }
    candidatePool.sort(function (a, b) {
      var d = (counts[a] || 0) - (counts[b] || 0);
      return d || String(a).localeCompare(String(b));
    });
    row[idx.assignees] = JSON.stringify(candidatePool.length ? [candidatePool[0]] : []);
    return;
  }

  if (mode === 'skill_based') {
    row[idx.assignees] = JSON.stringify(candidatePool.length ? [candidatePool[0]] : providedAssignees);
    return;
  }

  row[idx.assignees] = JSON.stringify(providedAssignees);
}

function normalizeTaskEscalationFields_(obj) {
  const out = obj || {};
  const state = String(out.escalationState || '').trim();
  out.escalationState = state;
  out.exceptionFlag = String(out.exceptionFlag || '').toLowerCase() === 'true' ? 'true' : '';
  return out;
}

function normalizeTaskBlockFields_(obj) {
  const out = obj || {};
  out.blockedByTaskId = String(out.blockedByTaskId || '').trim();
  out.blockReason = String(out.blockReason || '').trim();
  return out;
}

function toDateSafe_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const dt = new Date(text);
  return isNaN(dt.getTime()) ? null : dt;
}

function isTaskDone_(status) {
  return String(status || '').trim().toLowerCase() === 'done';
}

function computeEscalationState_(rowObj, nowMs) {
  const archived = String(rowObj.archived || '').toLowerCase() === 'true';
  const done = isTaskDone_(rowObj.status);
  if (archived || done) return '';
  if (String(rowObj.exceptionFlag || '').toLowerCase() === 'true') return '';

  const due = toDateSafe_(rowObj.dueDate);
  const isOverdue = !!(due && due.getTime() < nowMs);
  const slaHours = Number(rowObj.slaHours);
  const baseline = toDateSafe_(rowObj.lastStatusChangeAt) || toDateSafe_(rowObj.assignedAt) || toDateSafe_(rowObj.createdAt);
  const slaBreached = !!(isFinite(slaHours) && slaHours > 0 && baseline && (nowMs - baseline.getTime()) > (slaHours * 3600000));

  if (slaBreached) return 'escalated';
  if (isOverdue) return 'overdue';
  return '';
}

function normalizeDependencyRules_(obj) {
  var depIds = String((obj && obj.dependencyIds) || '').trim();
  var rawRules = obj && obj.dependencyRules;
  var parsed = [];

  if (Array.isArray(rawRules)) {
    parsed = rawRules;
  } else {
    var text = String(rawRules == null ? '' : rawRules).trim();
    if (text) {
      try {
        var candidate = JSON.parse(text);
        if (Array.isArray(candidate)) parsed = candidate;
      } catch (err) {}
    }
  }

  var normalized = [];
  for (var i = 0; i < parsed.length; i++) {
    var r = parsed[i] || {};
    var predecessorTaskId = String(r.predecessorTaskId || '').trim();
    if (!predecessorTaskId) continue;
    var typeRaw = String(r.type || 'FS').trim().toUpperCase();
    var type = (typeRaw === 'SS' || typeRaw === 'FF' || typeRaw === 'FS') ? typeRaw : 'FS';
    var lag = Number(r.lagDays);
    normalized.push({ predecessorTaskId: predecessorTaskId, type: type, lagDays: isFinite(lag) ? lag : 0 });
  }

  if (!normalized.length && depIds) {
    var ids = depIds.split(/[|,;\n]/).map(function (v) { return String(v || '').trim(); }).filter(Boolean);
    normalized = ids.map(function (id) { return { predecessorTaskId: id, type: 'FS', lagDays: 0 }; });
  }

  obj.dependencyRules = JSON.stringify(normalized);
  return obj;
}

function parseDependencyRulesStrict_(rawValue) {
  var text = '';
  if (Array.isArray(rawValue)) text = JSON.stringify(rawValue);
  else text = String(rawValue == null ? '' : rawValue).trim();
  if (!text) return { ok: true, rules: [] };
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: 'dependencyRules must be valid JSON array' };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'dependencyRules must be a JSON array' };
  var out = [];
  for (var i = 0; i < parsed.length; i++) {
    var rule = parsed[i] || {};
    var predecessorTaskId = String(rule.predecessorTaskId || '').trim();
    if (!predecessorTaskId) return { ok: false, error: 'Each dependency rule requires predecessorTaskId' };
    var typeRaw = String(rule.type || 'FS').trim().toUpperCase();
    if (typeRaw !== 'FS' && typeRaw !== 'SS' && typeRaw !== 'FF') return { ok: false, error: 'Dependency type must be FS, SS, or FF' };
    var lag = Number(rule.lagDays);
    if (!isFinite(lag)) return { ok: false, error: 'Dependency lagDays must be numeric' };
    out.push({ predecessorTaskId: predecessorTaskId, type: typeRaw, lagDays: lag });
  }
  return { ok: true, rules: out };
}

function validateTaskDependenciesForWrite_(values, header, idxTaskId, pendingTaskId, pendingDependencyRules) {
  var idxArchived = header.indexOf('archived');
  var idxDepRules = header.indexOf('dependencyRules');
  var idxTitle = header.indexOf('title');
  var taskById = {};
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var taskId = String(row[idxTaskId] || '').trim();
    if (!taskId) continue;
    taskById[taskId] = {
      taskId: taskId,
      title: String(row[idxTitle] || '').trim(),
      archived: String(row[idxArchived] || '').toLowerCase() === 'true',
      dependencyRules: String(row[idxDepRules] == null ? '' : row[idxDepRules]).trim()
    };
  }

  if (!taskById[pendingTaskId]) {
    taskById[pendingTaskId] = { taskId: pendingTaskId, title: '', archived: false, dependencyRules: '' };
  }
  taskById[pendingTaskId].dependencyRules = String(pendingDependencyRules == null ? '' : pendingDependencyRules).trim();

  var activeIds = Object.keys(taskById).filter(function (id) { return !taskById[id].archived; });
  var graph = {};
  for (var a = 0; a < activeIds.length; a++) graph[activeIds[a]] = [];

  for (var t = 0; t < activeIds.length; t++) {
    var taskId = activeIds[t];
    var parsed = parseDependencyRulesStrict_(taskById[taskId].dependencyRules);
    if (!parsed.ok) throw new Error('Invalid dependencyRules for task ' + taskId + ': ' + parsed.error);
    for (var r = 0; r < parsed.rules.length; r++) {
      var predecessorTaskId = parsed.rules[r].predecessorTaskId;
      if (!graph[predecessorTaskId]) throw new Error('Task ' + taskId + ' depends on missing task ID ' + predecessorTaskId);
      graph[predecessorTaskId].push(taskId);
    }
  }

  var visiting = {};
  var visited = {};
  var stack = [];
  var cyclePath = null;

  function dfs_(nodeId) {
    if (cyclePath) return;
    visiting[nodeId] = true;
    stack.push(nodeId);
    var next = graph[nodeId] || [];
    for (var i = 0; i < next.length; i++) {
      var targetId = next[i];
      if (visited[targetId]) continue;
      if (visiting[targetId]) {
        var start = stack.indexOf(targetId);
        cyclePath = stack.slice(start >= 0 ? start : 0).concat(targetId);
        return;
      }
      dfs_(targetId);
      if (cyclePath) return;
    }
    stack.pop();
    visiting[nodeId] = false;
    visited[nodeId] = true;
  }

  for (var c = 0; c < activeIds.length; c++) {
    var root = activeIds[c];
    if (visited[root]) continue;
    dfs_(root);
    if (cyclePath) break;
  }

  if (cyclePath) {
    var labelById = {};
    for (var li = 0; li < activeIds.length; li++) {
      var id = activeIds[li];
      var title = String(taskById[id].title || '').trim();
      labelById[id] = title ? (title + ' (' + id + ')') : id;
    }
    var msg = cyclePath.map(function (id) { return labelById[id] || id; }).join(' -> ');
    throw new Error('Dependency cycle detected: ' + msg);
  }
}

function parseAssignees_(value) {
  function clean_(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    if (s.toLowerCase() === 'unassigned') return '';
    return s;
  }
  if (Array.isArray(value)) {
    return value.map(clean_).filter(Boolean);
  }
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return [];
  if (raw.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(clean_).filter(Boolean);
    } catch (err) {}
  }
  return raw.split(/[|,;\n]/).map(clean_).filter(Boolean);
}

function normalizeAssigneeFields_(obj) {
  var list = parseAssignees_(obj && obj.assignees);
  obj.assignees = JSON.stringify(list);
  return obj;
}

function ensureTaskSheet_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  const header = taskColumns_();
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), header.length)).getValues()[0].slice(0, header.length);
    let same = true;
    for (let i = 0; i < header.length; i++) {
      if (String(existing[i] || '').trim() !== header[i]) { same = false; break; }
    }
    if (!same) sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return { ss: ss, sh: sh, header: header };
}

function tasksRead_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(tabName);
  const header = taskColumns_();
  if (!sh) return { ok: true, tasks: [], tabName, schema: header };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, tasks: [], tabName, schema: header };
  const values = sh.getRange(2, 1, lastRow - 1, header.length).getValues();
  const tasks = values.map(function (row) {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = row[i];
    normalizeAssigneeFields_(obj);
    normalizeDependencyRules_(obj);
    normalizeTaskBlockFields_(obj);
    normalizeTaskEscalationFields_(obj);
    normalizeTaskAssignmentFields_(obj);
    return obj;
  });
  return { ok: true, tasks: tasks, tabName, schema: header };
}

function taskWrite_(sheetId, tabName, taskAction, payload) {
  const allowed = { createTask: true, updateTask: true, archiveTask: true, reorderTask: true, saveChecklist: true };
  if (!allowed[taskAction]) throw new Error('Unsupported taskAction');
  if (taskAction === 'saveChecklist') {
    return checklistWrite_(sheetId, 'check list', payload);
  }

  const pack = ensureTaskSheet_(sheetId, tabName);
  const sh = pack.sh;
  const header = pack.header;
  const idx = {};
  for (let i = 0; i < header.length; i++) idx[header[i]] = i;

  const taskId = requireString_(payload.taskId, 'taskId');
  const lastRow = sh.getLastRow();
  const values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, header.length).getValues() : [];
  let foundOffset = -1;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][idx.taskId] || '').trim() === taskId) { foundOffset = i; break; }
  }

  if (taskAction === 'createTask' && foundOffset >= 0) throw new Error('Task already exists');
  if ((taskAction === 'updateTask' || taskAction === 'archiveTask' || taskAction === 'reorderTask') && foundOffset < 0) throw new Error('Task not found');

  const existing = foundOffset >= 0 ? values[foundOffset] : header.map(function () { return ''; });
  const row = existing.slice();
  const now = new Date().toISOString();
  var normalizedPayload = normalizeAssigneeFields_(Object.assign({}, payload));
  normalizedPayload = normalizeTaskBlockFields_(normalizedPayload);
  normalizedPayload = normalizeTaskAssignmentFields_(normalizedPayload);
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'dependencyRules')) {
    normalizedPayload.dependencyRules = typeof payload.dependencyRules === 'string'
      ? payload.dependencyRules
      : JSON.stringify(payload.dependencyRules == null ? [] : payload.dependencyRules);
  }

  if (taskAction === 'createTask' || taskAction === 'updateTask') {
    var parsedDepRules = parseDependencyRulesStrict_(normalizedPayload.dependencyRules);
    if (!parsedDepRules.ok) throw new Error(parsedDepRules.error);
    normalizedPayload.dependencyRules = JSON.stringify(parsedDepRules.rules);
    validateTaskDependenciesForWrite_(values, header, idx.taskId, taskId, normalizedPayload.dependencyRules);
  }

  header.forEach(function (k) {
    if (normalizedPayload[k] != null && normalizedPayload[k] !== '') row[idx[k]] = normalizedPayload[k];
  });

  applyAssignmentModeForRow_(row, values, idx, taskId);

  const priorStatus = String(existing[idx.status] || '').trim();
  const nextStatus = String((normalizedPayload.status != null ? normalizedPayload.status : row[idx.status]) || '').trim();
  const hasAssignedAt = !!String(row[idx.assignedAt] || '').trim();
  if (nextStatus && !hasAssignedAt && nextStatus.toLowerCase() !== 'not started') {
    row[idx.assignedAt] = normalizedPayload.assignedAt || now;
  }
  const hasStatusChange = taskAction === 'createTask' || (nextStatus && priorStatus !== nextStatus);
  if (hasStatusChange) {
    row[idx.lastStatusChangeAt] = normalizedPayload.lastStatusChangeAt || now;
  }

  if (normalizedPayload.exceptionFlag === true || String(normalizedPayload.exceptionFlag || '').toLowerCase() === 'true') {
    row[idx.exceptionFlag] = 'true';
  } else if (normalizedPayload.exceptionFlag === false || String(normalizedPayload.exceptionFlag || '').toLowerCase() === 'false') {
    row[idx.exceptionFlag] = '';
  }

  if (taskAction === 'createTask' && !String(row[idx.escalationState] || '').trim()) {
    row[idx.escalationState] = '';
  }

  if (isTaskDone_(nextStatus)) {
    row[idx.escalationState] = '';
  }

  if (taskAction === 'createTask' && !String(row[idx.escalatedAt] || '').trim()) {
    row[idx.escalatedAt] = '';
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'escalationState')) {
    row[idx.escalationState] = String(normalizedPayload.escalationState || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'escalatedAt')) {
    row[idx.escalatedAt] = String(normalizedPayload.escalatedAt || '').trim();
  }

  row[idx.taskId] = taskId;
  if (!row[idx.createdAt]) row[idx.createdAt] = now;
  row[idx.updatedAt] = normalizedPayload.updatedAt || now;
  if (taskAction === 'archiveTask') row[idx.archived] = 'true';

  if (foundOffset >= 0) {
    sh.getRange(foundOffset + 2, 1, 1, header.length).setValues([row]);
    return { ok: true, taskId: taskId, mode: 'update', taskAction: taskAction };
  }

  sh.appendRow(row);
  return { ok: true, taskId: taskId, mode: 'create', taskAction: taskAction };
}

function tasksEscalationSweep() {
  const activeId = SpreadsheetApp.getActiveSpreadsheet() ? SpreadsheetApp.getActiveSpreadsheet().getId() : '';
  if (!activeId) return { ok: false, error: 'No active spreadsheet' };
  return tasksEscalationSweepForSheet_(activeId, 'tasks');
}

function tasksEscalationSweepForSheet_(sheetId, tabName) {
  const pack = ensureTaskSheet_(sheetId, tabName || 'tasks');
  const sh = pack.sh;
  const header = pack.header;
  const idx = {};
  for (let i = 0; i < header.length; i++) idx[header[i]] = i;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, scanned: 0, escalated: 0, overdue: 0, cleared: 0 };
  const values = sh.getRange(2, 1, lastRow - 1, header.length).getValues();
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  let escalated = 0;
  let overdue = 0;
  let cleared = 0;
  let changed = 0;

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const rowObj = {};
    for (let c = 0; c < header.length; c++) rowObj[header[c]] = row[c];
    const prevState = String(row[idx.escalationState] || '').trim();
    const nextState = computeEscalationState_(rowObj, nowMs);
    if (nextState === 'escalated') escalated++;
    if (nextState === 'overdue') overdue++;
    if (!nextState && prevState) cleared++;
    if (prevState !== nextState) {
      row[idx.escalationState] = nextState;
      changed++;
      if (nextState === 'escalated' && !String(row[idx.escalatedAt] || '').trim()) {
        row[idx.escalatedAt] = nowIso;
      }
      if (nextState !== 'escalated' && prevState === 'escalated') {
        row[idx.escalatedAt] = '';
      }
    }
  }

  if (changed > 0) {
    sh.getRange(2, 1, values.length, header.length).setValues(values);
  }
  return { ok: true, scanned: values.length, escalated: escalated, overdue: overdue, cleared: cleared, changed: changed };
}


function checklistColumns_() {
  return ['taskId', 'itemId', 'done', 'text', 'assignees', 'startDate', 'dueDate', 'notes', 'handoffMode', 'updatedAt'];
}

function ensureChecklistSheet_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  const header = checklistColumns_();
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), header.length)).getValues()[0].slice(0, header.length);
    let same = true;
    for (let i = 0; i < header.length; i++) {
      if (String(existing[i] || '').trim() !== header[i]) { same = false; break; }
    }
    if (!same) sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return { ss: ss, sh: sh, header: header };
}

function checklistRead_(sheetId, tabName, taskId) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(tabName);
  const header = checklistColumns_();
  if (!sh) return { ok: true, items: [], taskId: taskId };
  const idxTask = header.indexOf('taskId');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [], taskId: taskId };
  const values = sh.getRange(2, 1, lastRow - 1, header.length).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][idxTask] || '').trim() !== String(taskId)) continue;
    out.push({
      taskId: values[i][0],
      itemId: values[i][1],
      done: String(values[i][2] || '') === 'true',
      text: String(values[i][3] || ''),
      assignees: String(values[i][4] || ''),
      startDate: String(values[i][5] || ''),
      dueDate: String(values[i][6] || ''),
      notes: String(values[i][7] || ''),
      handoffMode: String(values[i][8] || ''),
      updatedAt: values[i][9]
    });
  }
  return { ok: true, items: out, taskId: taskId };
}

function checklistWrite_(sheetId, tabName, payload) {
  const taskId = requireString_(payload.taskId, 'taskId');
  const items = Array.isArray(payload.items) ? payload.items : [];
  const pack = ensureChecklistSheet_(sheetId, tabName);
  const sh = pack.sh;
  const header = pack.header;
  const now = new Date().toISOString();

  const incomingByKey = {};
  for (let i = 0; i < items.length; i++) {
    const itemId = String((items[i] && items[i].itemId) || (i + 1)).trim();
    const text = String((items[i] && items[i].text) || '').trim();
    if (!itemId || !text) continue;
    const assignees = String((items[i] && items[i].assignees) || '').trim();
    const startDate = String((items[i] && items[i].startDate) || '').trim();
    const dueDate = String((items[i] && items[i].dueDate) || '').trim();
    const notes = String((items[i] && items[i].notes) || '').trim();
    const handoffMode = String((items[i] && items[i].handoffMode) || '').trim();
    const key = taskId + '||' + itemId;
    incomingByKey[key] = [taskId, itemId, items[i].done ? 'true' : 'false', text, assignees, startDate, dueDate, notes, handoffMode, now];
  }

  const lastRow = sh.getLastRow();
  const values = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, header.length).getValues() : [];
  const merged = [];
  for (let i = 0; i < values.length; i++) {
    const rowTaskId = String(values[i][0] || '').trim();
    const rowItemId = String(values[i][1] || '').trim();
    if (rowTaskId !== taskId) {
      merged.push(values[i]);
      continue;
    }
    const key = rowTaskId + '||' + rowItemId;
    if (Object.prototype.hasOwnProperty.call(incomingByKey, key)) {
      merged.push(incomingByKey[key]);
      delete incomingByKey[key];
    }
  }

  Object.keys(incomingByKey).forEach(function (key) {
    merged.push(incomingByKey[key]);
  });

  if (lastRow >= 2) sh.getRange(2, 1, Math.max(lastRow - 1, 1), header.length).clearContent();
  if (merged.length) sh.getRange(2, 1, merged.length, header.length).setValues(merged);
  return { ok: true, taskId: taskId, written: merged.filter(function (row) { return String(row[0] || '').trim() === taskId; }).length, taskAction: 'saveChecklist' };
}

function parsePostBody_(e) {
  let body = {};
  try {
    const raw = e && e.postData && typeof e.postData.contents === "string" ? e.postData.contents : "";
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    body = {};
  }
  return body;
}

function parseJson_(raw, label) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch (_) {
    throw new Error(`Invalid ${label || "json"}`);
  }
}

function requireString_(value, label) {
  const out = String(value || "").trim();
  if (!out) throw new Error(`Missing ${label || "value"}`);
  return out;
}

function extractRows2d_(payload) {
  const rows2d = payload && payload.rows;
  validateRows2d_(rows2d);
  return rows2d;
}

function validateRows2d_(rows2d) {
  if (!Array.isArray(rows2d) || rows2d.length < 1) {
    throw new Error("payload.rows must be a non-empty 2D array");
  }
  const width = Array.isArray(rows2d[0]) ? rows2d[0].length : 0;
  if (width < 1) {
    throw new Error("payload.rows[0] must have at least 1 column");
  }
  for (let i = 0; i < rows2d.length; i++) {
    if (!Array.isArray(rows2d[i]) || rows2d[i].length < 1) {
      throw new Error(`payload.rows[${i}] must be a non-empty row array`);
    }
  }
}

function isHeaderRow_(row, existingHeader) {
  if (!Array.isArray(row) || !row.length) return false;

  const first = String(row[0] || "").trim();
  const firstLooksIso = isIsoTs_(first);
  if (firstLooksIso) return false;

  const normalized = row.map(function (v) { return String(v || "").trim().toLowerCase(); });
  const known = {
    calculatedat: true,
    itemcode: true,
    description: true,
    drugname: true,
    avgweeklyusage: true,
    percentchange: true,
    consecutiveweeks: true,
    confidence: true,
    confidencelevel: true,
    trenddirection: true,
    isnew: true,
    suggestion: true
  };

  let knownCount = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (known[normalized[i]]) knownCount++;
  }
  if (knownCount >= 2) return true;

  if (Array.isArray(existingHeader) && existingHeader.length) {
    const cmpLen = Math.min(existingHeader.length, row.length);
    let allMatch = cmpLen > 0;
    for (let i = 0; i < cmpLen; i++) {
      if (String(existingHeader[i] || "").trim().toLowerCase() !== normalized[i]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }

  return false;
}

function isIsoTs_(value) {
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return true;
  const d = new Date(value);
  return String(d) !== "Invalid Date";
}

function toA1Col_(n) {
  let col = "";
  let x = Number(n) || 1;
  while (x > 0) {
    const rem = (x - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    x = Math.floor((x - 1) / 26);
  }
  return col || "A";
}

function jsonOrJsonp_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
