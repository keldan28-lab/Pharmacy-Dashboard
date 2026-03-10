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


  if (action === "getTasks") {
    const sheetId = p.sheetId;
    const tabName = p.tabName || "taskList";
    const result = taskGetTasks_(sheetId, tabName);
    return jsonOrJsonp_(result, callback);
  }

  if (action === "getTaskById") {
    const sheetId = p.sheetId;
    const tabName = p.tabName || "taskList";
    const taskId = String(p.taskId || "").trim();
    const result = taskGetTaskById_(sheetId, tabName, taskId);
    return jsonOrJsonp_(result, callback);
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

  if (action === "readLatest") {
    const sheetId = p.sheetId || body.sheetId;
    const tabName = p.tabName || body.tabName || CONFIG.DEFAULT_TAB;
    const result = spikeReadLatest_(sheetId, tabName);
    if (callback) return jsonOrJsonp_(result, callback);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }


  if (action === "addTask" || action === "updateTask" || action === "archiveTask") {
    try {
      const sheetId = requireString_(p.sheetId || body.sheetId, "sheetId");
      const tabName = String(p.tabName || body.tabName || "taskList").trim() || "taskList";
      const payloadRaw = p.payload || body.payload || "{}";
      const payload = parseJson_(payloadRaw, "payload");
      let result;

      if (action === "addTask") result = taskAdd_(sheetId, tabName, payload);
      if (action === "updateTask") result = taskUpdate_(sheetId, tabName, payload);
      if (action === "archiveTask") result = taskArchive_(sheetId, tabName, payload);

      if (callback) return jsonOrJsonp_(Object.assign({ action }, result), callback);
      return ContentService.createTextOutput(JSON.stringify(Object.assign({ action }, result))).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      const out = { ok: false, action, error: String((err && err.message) || err || "Unknown error") };
      if (callback) return jsonOrJsonp_(out, callback);
      return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
    }
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


const TASK_COLUMNS_ = [
  'taskId','title','status','priority','assigneeUserId','assigneeName','startDate','endDate','progressPct','itemCode','location','taskType','notes','createdAt','updatedAt','createdBy','updatedBy','archived'
];
const TASK_STATUS_ = ['open','in_progress','blocked','done','cancelled'];
const TASK_PRIORITY_ = ['low','medium','high','urgent'];
const TASK_TYPES_ = ['review','transfer','adjust_par','investigate','count','expiry_check','deadstock_review','waste_followup','location_rebalance'];

function taskEnsureSheet_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(requireString_(sheetId, 'sheetId'));
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  if (sh.getLastRow() < 1) sh.getRange(1,1,1,TASK_COLUMNS_.length).setValues([TASK_COLUMNS_]);
  const head = sh.getRange(1,1,1,Math.max(sh.getLastColumn(), TASK_COLUMNS_.length)).getValues()[0];
  const normalized = TASK_COLUMNS_.every(function(c, i){ return String(head[i] || '').trim() === c; });
  if (!normalized) sh.getRange(1,1,1,TASK_COLUMNS_.length).setValues([TASK_COLUMNS_]);
  return sh;
}

function taskReadAll_(sheetId, tabName) {
  const sh = taskEnsureSheet_(sheetId, tabName);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];
  const rows = sh.getRange(2,1,lastRow-1,TASK_COLUMNS_.length).getValues();
  return rows.map(function(row){
    const obj = {};
    for (let i = 0; i < TASK_COLUMNS_.length; i++) obj[TASK_COLUMNS_[i]] = row[i];
    obj.archived = String(obj.archived) === 'true' || obj.archived === true;
    return obj;
  });
}

function taskNormalize_(src, isUpdate) {
  const now = new Date().toISOString();
  const out = {};
  TASK_COLUMNS_.forEach(function(k){ out[k] = src[k]; });
  out.taskId = String(out.taskId || ('task_' + Date.now())).trim();
  out.title = String(out.title || '').trim();
  out.status = TASK_STATUS_.indexOf(String(out.status)) >= 0 ? String(out.status) : 'open';
  out.priority = TASK_PRIORITY_.indexOf(String(out.priority)) >= 0 ? String(out.priority) : 'medium';
  out.assigneeUserId = String(out.assigneeUserId || '').trim();
  out.assigneeName = String(out.assigneeName || '').trim();
  out.startDate = toDateISO_(out.startDate);
  out.endDate = toDateISO_(out.endDate);
  const p = Number(out.progressPct);
  out.progressPct = isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0;
  out.itemCode = String(out.itemCode || '').trim();
  out.location = String(out.location || '').trim().toUpperCase();
  out.taskType = TASK_TYPES_.indexOf(String(out.taskType)) >= 0 ? String(out.taskType) : 'review';
  out.notes = String(out.notes || '').trim();
  out.createdAt = String(out.createdAt || now);
  out.updatedAt = now;
  out.createdBy = String(out.createdBy || out.updatedBy || 'dashboard_user');
  out.updatedBy = String(out.updatedBy || out.createdBy || 'dashboard_user');
  out.archived = String(out.archived) === 'true' || out.archived === true;

  if (!out.title) throw new Error('title required');
  if (!out.assigneeUserId) throw new Error('assigneeUserId required');
  if (!out.startDate) throw new Error('startDate required');
  if (!out.endDate) throw new Error('endDate required');
  const s = new Date(out.startDate); const e = new Date(out.endDate);
  if (!(s instanceof Date) || isNaN(s.getTime()) || !(e instanceof Date) || isNaN(e.getTime()) || e.getTime() < s.getTime()) {
    throw new Error('endDate must be >= startDate');
  }
  if (isUpdate && !out.taskId) throw new Error('taskId required');
  return out;
}

function taskObjToRow_(obj) {
  return TASK_COLUMNS_.map(function(k){ return obj[k]; });
}

function taskGetTasks_(sheetId, tabName) {
  const all = taskReadAll_(sheetId, tabName);
  return { ok: true, tasks: all.filter(function(t){ return !t.archived; }), tabName: tabName };
}

function taskGetTaskById_(sheetId, tabName, taskId) {
  const all = taskReadAll_(sheetId, tabName);
  const task = all.find(function(t){ return String(t.taskId) === String(taskId); }) || null;
  return { ok: !!task, task: task, tabName: tabName };
}

function taskAdd_(sheetId, tabName, payload) {
  const sh = taskEnsureSheet_(sheetId, tabName);
  const task = taskNormalize_(payload || {}, false);
  const all = taskReadAll_(sheetId, tabName);
  if (all.some(function(t){ return String(t.taskId) === task.taskId; })) throw new Error('taskId already exists');
  sh.appendRow(taskObjToRow_(task));
  return { ok: true, taskId: task.taskId, written: 1, tabName: tabName };
}

function taskUpdate_(sheetId, tabName, payload) {
  const sh = taskEnsureSheet_(sheetId, tabName);
  const task = taskNormalize_(payload || {}, true);
  const rows = taskReadAll_(sheetId, tabName);
  const idx = rows.findIndex(function(t){ return String(t.taskId) === String(task.taskId); });
  if (idx < 0) throw new Error('task not found');
  const rowNum = idx + 2;
  sh.getRange(rowNum, 1, 1, TASK_COLUMNS_.length).setValues([taskObjToRow_(task)]);
  return { ok: true, taskId: task.taskId, written: 1, tabName: tabName };
}

function taskArchive_(sheetId, tabName, payload) {
  const taskId = String((payload && payload.taskId) || '').trim();
  if (!taskId) throw new Error('taskId required');
  const sh = taskEnsureSheet_(sheetId, tabName);
  const rows = taskReadAll_(sheetId, tabName);
  const idx = rows.findIndex(function(t){ return String(t.taskId) === taskId; });
  if (idx < 0) throw new Error('task not found');
  const task = rows[idx];
  task.archived = true;
  task.updatedAt = new Date().toISOString();
  task.updatedBy = String((payload && payload.updatedBy) || task.updatedBy || task.createdBy || 'dashboard_user');
  const rowNum = idx + 2;
  sh.getRange(rowNum, 1, 1, TASK_COLUMNS_.length).setValues([taskObjToRow_(task)]);
  return { ok: true, taskId: taskId, archived: true, tabName: tabName };
}
