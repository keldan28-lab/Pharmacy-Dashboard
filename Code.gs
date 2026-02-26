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
      Logger.log("WRITE action=%s tab=%s rows=%s", action, tabName, rows2d.length);

      const result = action === "write"
        ? spikeWrite_(sheetId, tabName, rows2d)
        : spikeAppend_(sheetId, tabName, rows2d);

      return jsonOrJsonp_(Object.assign({ action }, result), callback);
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
      Logger.log("WRITE action=%s tab=%s rows=%s", action, tabName, rows2d.length);

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

  sh.clearContents();
  sh.getRange(1, 1, rows2d.length, rows2d[0].length).setValues(rows2d);
  return { ok: true, written: rows2d.length, tabName, mode: "write", updatedRange: `A1:${toA1Col_(rows2d[0].length)}${rows2d.length}` };
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
