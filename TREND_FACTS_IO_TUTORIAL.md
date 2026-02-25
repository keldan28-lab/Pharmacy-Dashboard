# Trend Facts I/O + Quick Tutorial

This document explains how Dashboard saves and reads trend facts using the Apps Script Web App in **both**:
- `file://` (origin `null`)
- normal `http(s)` origin

## Endpoints used (server-compatible)

Client now uses only:
- `POST action=write`
- `GET action=read` (JSONP callback)

It does **not** depend on `append` or `readLatest` routes.

---

## Core client entrypoints

File: `js/app/dashboard.js`

### 1) `googleSheetsWrite({ webAppUrl, sheetId, tabName, rows2d, verify })`

Writes rows via Apps Script `action=write`.

#### Inputs
- `webAppUrl: string` (Web App `/exec` URL)
- `sheetId: string`
- `tabName: string`
- `rows2d: any[][]` (header + data rows)
- `verify: boolean` (default `true`)

#### Request format
`POST ${webAppUrl}?action=write&sheetId=...&tabName=...`

Body is URL-encoded form data:
- `payload={"rows":[...]}`

No custom headers are set (avoids preflight).

#### Behavior by context
- **file:// / origin null**
  - `fetch(..., { mode: "no-cors", body: URLSearchParams(...) })`
  - response is opaque, so write verification uses JSONP read-back
- **http(s)**
  - normal `fetch` with URL-encoded form body
  - optional JSONP read-back verify

#### Status strings
During write/verify this updates the UI line (`#trendFactsStatusText`) with:
- `Sheets write queued; verifying…`
- `Saved to Sheets`
- `Sheets write failed`

#### Output
Returns `{ ok: true, ... }` on success, throws on failure.

---

### 2) `googleSheetsReadJsonp({ webAppUrl, sheetId, tabName })`

Cross-origin read helper using `action=read&callback=...`.

#### Inputs
- `webAppUrl: string`
- `sheetId: string`
- `tabName: string`

#### Output
Promise resolving to Apps Script payload (usually `{ ok, rows, tabName }`).

---

### 3) `saveTrendFactsRun({ trendResult })`

Builds and writes trend facts for both tabs.

#### Inputs
- `trendResult` from trend calculation (`trendingUp`, `trendingDown` arrays)

#### Behavior
- Derives `calculatedAt` from represented data period (`_deriveTrendCalculatedAtISO()`).
- Writes to:
  - `trend_facts_up`
  - `trend_facts_down`
- Uses `googleSheetsWrite(..., verify:true)` for each tab.

#### Output
Promise.

> `appendTrendFactsRun(...)` is kept as a backward-compatible alias to `saveTrendFactsRun(...)`.

---

### 4) `loadLatestTrendFactsFromSheet()`

Loads both tabs via JSONP read and derives latest run client-side.

#### Behavior
- Calls `googleSheetsReadJsonp` for each tab.
- Extracts latest contiguous block by `calculatedAt` from column A.
- Updates shared `TrendFactsState`.
- Falls back to local calculation if read fails.

---

## Shared state

```js
{
  source: "sheet" | "calculated" | "cache" | "unknown",
  calculatedAt: "ISO timestamp",
  up: Array<object>,
  down: Array<object>,
  loadedAt: "ISO timestamp"
}
```

---

## Debug helper

Use in console:

```js
window.__sheetsDebug()
```

Returns:
- `lastWriteAttempt` (protocol, origin, requestUrl, mode, tab)
- `lastVerifyResult` (ok/error + comparison fields)

---

## Quick tutorial

1. Open Dashboard.
2. Trigger trend calculation flow (initial load or threshold change).
3. Dashboard writes trend facts using `action=write` for both tabs.
4. Dashboard verifies writes via JSONP read.
5. Dashboard loads latest trend facts into `TrendFactsState` and broadcasts to child pages.

If write fails, status line shows `Sheets write failed` and debug data is available from `window.__sheetsDebug()`.
