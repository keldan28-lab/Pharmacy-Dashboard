(function () {
  const ns = (window.InventoryApp = window.InventoryApp || {});

  // -----------------------------------------------------------------------------------
  // InventoryApp.Forecast
  // A deterministic selector that recognizes demand shape (stable/erratic/intermittent/
  // changing) and applies an appropriate forecasting method.
  //
  // User choices (confirmed):
  // - Intermittent: Croston (SBA)
  // - Trend cap: symmetric (upward == downward)
  // -----------------------------------------------------------------------------------

  function safeNumber(v, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function mean(arr) {
    if (!arr || !arr.length) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function stdSample(arr) {
    if (!arr || arr.length < 2) return 0;
    const m = mean(arr);
    let s2 = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - m;
      s2 += d * d;
    }
    return Math.sqrt(s2 / (arr.length - 1));
  }

  function median(arr) {
    if (!arr || !arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function ewma(series, alpha) {
    const a = clamp(safeNumber(alpha, 0.2), 0.01, 0.99);
    let level = 0;
    let initialized = false;
    for (let i = 0; i < series.length; i++) {
      const v = safeNumber(series[i], 0);
      if (!initialized) {
        level = v;
        initialized = true;
      } else {
        level = a * v + (1 - a) * level;
      }
    }
    return initialized ? level : 0;
  }

  // Simple least squares slope on y = a + b*t, where t = 0..n-1
  function linearSlope(series) {
    const n = series.length;
    if (n < 2) return 0;
    let sumT = 0,
      sumY = 0,
      sumTT = 0,
      sumTY = 0;
    for (let t = 0; t < n; t++) {
      const y = safeNumber(series[t], 0);
      sumT += t;
      sumY += y;
      sumTT += t * t;
      sumTY += t * y;
    }
    const denom = n * sumTT - sumT * sumT;
    if (denom === 0) return 0;
    return (n * sumTY - sumT * sumY) / denom;
  }

  function computeADI(series) {
    // Average interval between non-zero demands (in days)
    let last = -1;
    const gaps = [];
    for (let i = 0; i < series.length; i++) {
      const v = safeNumber(series[i], 0);
      if (v > 0) {
        if (last >= 0) gaps.push(i - last);
        last = i;
      }
    }
    return gaps.length ? mean(gaps) : 999;
  }

  function computeMetrics(series) {
    const W = series.length;
    let zeros = 0;
    const nz = [];
    for (let i = 0; i < W; i++) {
      const v = safeNumber(series[i], 0);
      if (v === 0) zeros++;
      if (v > 0) nz.push(v);
    }
    const p0 = W ? zeros / W : 1;
    const meanNZ = mean(nz);
    const cv = meanNZ > 0 ? stdSample(nz) / meanNZ : 999;
    const ADI = computeADI(series);

    // Use last 60 days for slope if available, else all
    const tail = series.slice(Math.max(0, W - 60));
    const slope = linearSlope(tail);
    const meanAll = mean(series);
    return { W, p0, ADI, cv, slope, meanAll, meanNZ, nonZeroCount: nz.length };
  }

  function classifySeries(metrics) {
    if (!metrics || metrics.nonZeroCount < 5) return 'insufficient';

    // Strong regime shift / trend
    const projected60 = Math.abs(metrics.slope * Math.min(60, metrics.W));
    if (metrics.meanAll > 0 && projected60 > 0.2 * metrics.meanAll) return 'changing';

    // Intermittency
    if (metrics.ADI >= 1.5 || metrics.p0 >= 0.6) return 'intermittent';

    // Stable vs erratic
    if (metrics.cv < 0.5) return 'stable';
    return 'erratic';
  }

  // Croston's method with Syntetos–Boylan Approximation (SBA)
  function crostonSBA(series, alpha) {
    const a = clamp(safeNumber(alpha, 0.1), 0.01, 0.5);
    let zHat = 0; // demand size
    let pHat = 1; // interval
    let initialized = false;
    let interval = 0;

    for (let i = 0; i < series.length; i++) {
      const y = safeNumber(series[i], 0);
      interval += 1;
      if (y > 0) {
        if (!initialized) {
          zHat = y;
          pHat = interval;
          initialized = true;
        } else {
          zHat = a * y + (1 - a) * zHat;
          pHat = a * interval + (1 - a) * pHat;
        }
        interval = 0;
      }
    }

    if (!initialized) return { forecast: 0, zHat: 0, pHat: 0, alpha: a };

    const croston = pHat > 0 ? zHat / pHat : 0;
    const sba = (1 - a / 2) * croston;
    return { forecast: Math.max(0, sba), zHat, pHat, alpha: a };
  }

  function forecastExpectedDailyUsage(series, opts) {
    const cfg = opts || {};
    const metrics = computeMetrics(series);
    const seriesType = classifySeries(metrics);

    // Symmetric trend cap: cap is a fraction of meanAll (or meanNZ if meanAll is tiny)
    const baseMean = metrics.meanAll > 0 ? metrics.meanAll : metrics.meanNZ;
    const trendCap = safeNumber(cfg.trendCapPerDay, 0);
    const cap = trendCap > 0 ? trendCap : Math.max(0.01, 0.02 * baseMean); // 2% of mean per day by default

    if (seriesType === 'insufficient') {
      return { expectedDailyUsage: 0, seriesType, method: 'none', metrics };
    }

    if (seriesType === 'intermittent') {
      const out = crostonSBA(series, safeNumber(cfg.crostonAlpha, 0.1));
      return { expectedDailyUsage: out.forecast, seriesType, method: 'Croston-SBA', metrics: { ...metrics, croston: out } };
    }

    if (seriesType === 'stable') {
      const f = ewma(series, safeNumber(cfg.ewmaAlphaStable, 0.15));
      return { expectedDailyUsage: Math.max(0, f), seriesType, method: 'EWMA', metrics };
    }

    if (seriesType === 'erratic') {
      // Robust: median of non-zero in last 90 days
      const tail = series.slice(Math.max(0, series.length - 90));
      const nz = tail.map((v) => safeNumber(v, 0)).filter((v) => v > 0);
      const f = median(nz);
      return { expectedDailyUsage: Math.max(0, f), seriesType, method: 'Median(non-zero,90d)', metrics };
    }

    // changing
    const tail = series.slice(Math.max(0, series.length - 60));
    const base = ewma(tail, safeNumber(cfg.ewmaAlphaChanging, 0.3));
    const slope = safeNumber(metrics.slope, 0);
    const slopeCapped = clamp(slope, -cap, cap);
    const f = Math.max(0, base + slopeCapped);
    return { expectedDailyUsage: f, seriesType, method: 'EWMA+TrendCap', metrics: { ...metrics, capPerDay: cap } };
  }

  function _parseISO(s) {
    if (typeof s !== 'string' || s.length < 10) return null;
    const d = new Date(s.slice(0, 10) + 'T00:00:00');
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function _toISO(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Convert sparse {yyyy-mm-dd: qty} into a dense daily series array.
  function materializeDailySeries(sparseMap, startISO, endISO) {
    const startD = _parseISO(startISO) || new Date();
    const endD = _parseISO(endISO) || new Date();
    const out = [];
    const cur = new Date(startD.getTime());
    while (cur <= endD) {
      const key = _toISO(cur);
      const v = sparseMap && sparseMap[key] != null ? safeNumber(sparseMap[key], 0) : 0;
      out.push(v);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  function forecastFromDailySeries(series, opts) {
    return forecastExpectedDailyUsage(series, opts);
  }

  ns.Forecast = {
    computeMetrics,
    classifySeries,
    forecastExpectedDailyUsage,
    crostonSBA,
    materializeDailySeries,
    forecastFromDailySeries
  };
})();
