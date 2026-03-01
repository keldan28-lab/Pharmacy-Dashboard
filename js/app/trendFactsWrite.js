/* js/app/trendFactsWrite.js
 * Minimal, reliable TrendFacts writer for file:// dashboards + Apps Script WebApp
 * Writes trend_facts_up and trend_facts_down using chunked JSONP appends.
 *
 * Expected trend object fields (from calculateTrendingItems()):
 *  - itemCode (string/number)
 *  - avgWeeklyUsage (number)
 *  - confidence (number)
 *  - trendDirection (string)
 */

(function () {
  "use strict";

  function _getTrendFactsConfig() {
    const scriptUrl =
      window.TREND_FACTS_WEBAPP_URL ||
      localStorage.getItem("spike_webAppUrl") || // Settings modal values
      "";
    const sheetId =
      window.TREND_FACTS_SHEET_ID ||
      localStorage.getItem("spike_sheetId") ||
      "";
    return { scriptUrl, sheetId };
  }

  function _jsonp(url, timeoutMs) {
    timeoutMs = timeoutMs || 25000;
    return new Promise((resolve, reject) => {
      const cbName = "__tf_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e9);
      const sep = url.indexOf("?") >= 0 ? "&" : "?";
      const fullUrl = url + sep + "callback=" + encodeURIComponent(cbName);

      const script = document.createElement("script");
      let done = false;

      function cleanup() {
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
      }

      const t = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("JSONP timeout"));
      }, timeoutMs);

      window[cbName] = (data) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        cleanup();
        reject(new Error("JSONP load error"));
      };

      script.src = fullUrl;
      document.head.appendChild(script);
    });
  }

  function _rowsFromTrending(list, calculatedAt) {
    const header = ["calculatedAt", "rank", "itemCode", "confidence", "avgWeeklyUsage", "direction"];
    const rows = [header];
    for (let i = 0; i < list.length; i++) {
      const x = list[i] || {};
      rows.push([
        calculatedAt,
        i + 1,
        String(x.itemCode ?? ""),
        Number(x.confidence ?? 0),
        Number(x.avgWeeklyUsage ?? 0),
        String(x.trendDirection ?? x.direction ?? "increasing"),
      ]);
    }
    return rows;
  }

  
async function _ensureHeaderJsonp({ scriptUrl, sheetId, tabName, header }) {
  // Read first row; if missing or mismatched, reset tab header via action=write.
  try {
    const url =
      `${scriptUrl}?action=read` +
      `&sheetId=${encodeURIComponent(sheetId)}` +
      `&tabName=${encodeURIComponent(tabName)}`;
    const res = await _jsonp(url, 20000);
    const first = (res && Array.isArray(res.rows) && res.rows[0]) ? res.rows[0] : null;
    const same = Array.isArray(first) && first.length === header.length &&
      first.every((v, i) => String(v) === String(header[i]));
    if (!same) {
      console.log("[TrendFacts] header mismatch/empty; resetting tab:", tabName);
      const payload = encodeURIComponent(JSON.stringify({ rows: [header] }));
      const wurl =
        `${scriptUrl}?action=write` +
        `&sheetId=${encodeURIComponent(sheetId)}` +
        `&tabName=${encodeURIComponent(tabName)}` +
        `&payload=${payload}`;
      const wres = await _jsonp(wurl, 25000);
      if (!wres || wres.ok !== true) throw new Error(wres?.error || "header write failed");
    }
  } catch (e) {
    console.warn("[TrendFacts] ensureHeader failed (continuing):", e);
  }
}

async function _appendChunkedJsonp(opts) {
    const scriptUrl = opts.scriptUrl;
    const sheetId = opts.sheetId;
    const tabName = opts.tabName;
    const rows2d = opts.rows2d;
    const chunkSize = Number(opts.chunkSize || 50);

    const header = rows2d[0] || [];
    const data = rows2d.slice(1);

    await _ensureHeaderJsonp({ scriptUrl, sheetId, tabName, header });
let writtenTotal = 0;
    let chunks = 0;

    // If no data rows, still write header+marker row so the tab is initialized
    if (!data.length) {
      const payload = encodeURIComponent(JSON.stringify({ rows: [header] }));
      const url =
        `${scriptUrl}?action=append` +
        `&sheetId=${encodeURIComponent(sheetId)}` +
        `&tabName=${encodeURIComponent(tabName)}` +
        `&payload=${payload}`;
      console.log("[TrendFacts] chunk append", { tabName, chunk: chunks, from: i, count: chunkRows.length });
      const res = await _jsonp(url, 25000);
      if (!res || res.ok !== true) throw new Error(res?.error || "append failed");
      return { ok: true, mode: "jsonp-chunked", tabName, written: Number(res.written || 0), chunks: 1 };
    }

    for (let i = 0; i < data.length; i += chunkSize) {
      chunks++;
      const chunkData = data.slice(i, i + chunkSize);
      const chunkRows = (i === 0) ? [header, ...chunkData] : chunkData;

      const payload = encodeURIComponent(JSON.stringify({ rows: chunkRows }));
      const url =
        `${scriptUrl}?action=append` +
        `&sheetId=${encodeURIComponent(sheetId)}` +
        `&tabName=${encodeURIComponent(tabName)}` +
        `&payload=${payload}`;

      console.log("[TrendFacts] chunk append", { tabName, chunk: chunks, from: i, count: chunkRows.length });
      const res = await _jsonp(url, 25000);
      if (!res || res.ok !== true) {
        throw new Error(`chunk ${chunks} failed: ` + (res?.error || "unknown error"));
      }
      writtenTotal += Number(res.written || 0);
    }

    return { ok: true, mode: "jsonp-chunked", tabName, written: writtenTotal, chunks };
  }

  async function writeTrendFactsTabs(args) {
    args = args || {};
    const trendResult = args.trendResult;
    if (!trendResult) throw new Error("Missing trendResult");

    const cfg = _getTrendFactsConfig();
    const scriptUrl = args.scriptUrl || cfg.scriptUrl;
    const sheetId = args.sheetId || cfg.sheetId;
    if (!scriptUrl || !sheetId) throw new Error("Missing scriptUrl or sheetId");

    const calculatedAt = trendResult.calculatedAt || new Date().toISOString();
    const up = Array.isArray(trendResult.trendingUp) ? trendResult.trendingUp : [];
    const down = Array.isArray(trendResult.trendingDown) ? trendResult.trendingDown : [];

    console.log("[TrendFactsTabs] build:", {
      calculatedAt,
      upCount: up.length,
      downCount: down.length,
      sample: up[0] ? { itemCode: up[0].itemCode, avgWeeklyUsage: up[0].avgWeeklyUsage, confidence: up[0].confidence } : null
    });

    const rowsUp = _rowsFromTrending(up, calculatedAt);
    const rowsDown = down.length
      ? _rowsFromTrending(down, calculatedAt)
      : [["calculatedAt","note"], [calculatedAt, "NO_TRENDING_DOWN_ITEMS"]];

    const rUp = await _appendChunkedJsonp({ scriptUrl, sheetId, tabName: "trend_facts_up", rows2d: rowsUp, chunkSize: 50 });
    const rDown = await _appendChunkedJsonp({ scriptUrl, sheetId, tabName: "trend_facts_down", rows2d: rowsDown, chunkSize: 50 });

    console.log("[TrendFactsTabs] results:", rUp, rDown);
    return { ok: true, calculatedAt, up: rUp, down: rDown };
  }

  window.writeTrendFactsTabs = writeTrendFactsTabs;
})();
