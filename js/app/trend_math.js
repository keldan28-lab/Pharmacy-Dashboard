/**
 * js/app/trend_math.js
 * --------------------
 * Pure JS module implementing acceleration-first trend + spike math spec:
 * - Robust center/scale: median + MAD (sigma_r = 1.4826 * MAD)
 * - Theil–Sen slope for long/short slopes (median of pairwise slopes)
 * - Acceleration = shortSlope - longSlope (primary signal)
 * - Monotonicity score over last K diffs
 * - Robust zLatest, pctChangeShort (with floors/caps)
 * - Spike diagnostics (intensity/recency/frequency/persistence) over lookback M
 * - Shock classification: reinforcing | transient | noise
 * - Direction: acceleration-gated increasing/decreasing, else flat/weak sign
 * - Trend strength score [0..1] (acceleration weighted highest)
 * - Spike multiplier with decay + volatility damping + shock caps
 * - Ranking score (acceleration-forward)
 *
 * No external libraries. Deterministic and auditable.
 */

/** @typedef {"increasing"|"decreasing"|"flat"} TrendDirection */
/** @typedef {"reinforcing"|"transient"|"noise"|"none"} ShockClass */

/**
 * @typedef {Object} TrendMathConfig
 * @property {number} shortWindowWeeks K
 * @property {number} spikeLookbackWeeks M
 *
 * @property {number} eps
 * @property {number} nearZero
 *
 * // Floors/caps
 * @property {number} pctFloor p_min
 * @property {number} pctCap pCap
 *
 * // Direction gates
 * @property {number} accelStrong
 * @property {number} slopeMin
 * @property {number} monoMin
 * @property {number} pMin
 * @property {number} zMin
 * @property {number} slopeFlat
 * @property {number} pFlat
 * @property {number} monoFlat
 * @property {number} accelFlat
 * @property {number} weakLambda lambda
 *
 * // Spike thresholds
 * @property {number} zSpike
 * @property {number} zPersist
 *
 * // Score scales
 * @property {number} accelScale
 * @property {number} slopeScale
 * @property {number} pctScale
 * @property {number} zScale
 * @property {number} volScale
 * @property {number} volWeight
 *
 * // Shock/noise heuristics
 * @property {number} noiseMonoAbsMax
 * @property {number} noiseVolHigh
 * @property {number} spikeRecentWeeks
 *
 * // Spike multiplier params
 * @property {number} spikeZScale
 * @property {number} bumpMax
 * @property {number} halfLifeWeeks
 * @property {number} spikeVolPenaltyWeight
 *
 * // Ranking params
 * @property {number} usageScale
 * @property {number} urgencyZScale
 */

/**
 * @typedef {Object} SpikeDiagnostics
 * @property {number} spikeIntensity
 * @property {number} spikeRecencyWeeks
 * @property {number} spikeFrequency
 * @property {number} spikePersistence
 */

/**
 * @typedef {Object} TrendMetrics
 * @property {number} N
 * @property {number} avgWeeklyUsage
 * @property {number} latestWeeklyUsage
 * @property {number} med
 * @property {number} mad
 * @property {number} sigma_r
 * @property {number} longSlope
 * @property {number} shortSlope
 * @property {number} acceleration
 * @property {number} monotonicity
 * @property {number} pctChangeShort
 * @property {number} pctChangeShortClamped
 * @property {number} zLatest
 * @property {number} volatility // robust sigma_r (for penalties)
 * @property {SpikeDiagnostics} spike
 * @property {ShockClass} shockClass
 * @property {TrendDirection} direction
 * @property {number} trendStrengthScore
 * @property {number} spikeMultiplier
 * @property {number} rankScore
 */

/* ------------------------- Defaults ------------------------- */

/** @returns {TrendMathConfig} */
function defaultTrendMathConfig() {
  return {
    shortWindowWeeks: 6,
    spikeLookbackWeeks: 8,

    eps: 1e-9,
    nearZero: 1e-9,

    pctFloor: 1.0,
    pctCap: 2.0,

    accelStrong: 0.15,
    slopeMin: 0.10,
    monoMin: 0.25,
    pMin: 0.10,
    zMin: 0.75,

    slopeFlat: 0.05,
    pFlat: 0.05,
    monoFlat: 0.10,
    accelFlat: 0.05,

    weakLambda: 0.25,

    zSpike: 1.5,
    zPersist: 0.9,

    accelScale: 0.35,
    slopeScale: 0.50,
    pctScale: 0.50,
    zScale: 2.0,
    volScale: 20.0,
    volWeight: 0.5,

    noiseMonoAbsMax: 0.10,
    noiseVolHigh: 30.0, // tune with your data units
    spikeRecentWeeks: 2,

    spikeZScale: 3.0,
    bumpMax: 0.35,
    halfLifeWeeks: 2,
    spikeVolPenaltyWeight: 0.5,

    usageScale: 200,
    urgencyZScale: 3.0,
  };
}

/* ------------------------- Helpers ------------------------- */

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function safeDiv(num, den, eps) {
  return Math.abs(den) < eps ? 0 : num / den;
}

function sign(x, eps) {
  if (Math.abs(x) < eps) return 0;
  return x > 0 ? 1 : -1;
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function log1p(x) {
  return Math.log(1 + Math.max(0, x));
}

/* ------------------------- Median / MAD ------------------------- */

function median(arr) {
  const n = arr.length;
  if (!n) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const mid = Math.floor(n / 2);
  return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function mad(arr, med) {
  if (!arr.length) return 0;
  const dev = arr.map((v) => Math.abs(v - med));
  return median(dev);
}

/* ------------------------- Theil–Sen slope ------------------------- */

function theilSenSlope(y, eps) {
  const n = y.length;
  if (n < 2) return 0;

  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const den = j - i;
      if (den === 0) continue;
      slopes.push((y[j] - y[i]) / den);
    }
  }
  if (!slopes.length) return 0;
  return median(slopes);
}

/* ------------------------- Monotonicity ------------------------- */

function monotonicityScore(y, K, eps) {
  const n = y.length;
  if (n < 2) return 0;

  const start = Math.max(1, n - K + 1);
  let pos = 0, neg = 0;

  for (let i = start; i < n; i++) {
    const d = y[i] - y[i - 1];
    if (d > eps) pos++;
    else if (d < -eps) neg++;
  }

  return (pos - neg) / (pos + neg + eps);
}

/* ------------------------- pctChangeShort ------------------------- */

function pctChangeShort(y, K, pctFloor, eps) {
  const n = y.length;
  if (n === 0) return 0;

  const k = Math.max(1, Math.min(K, n));
  const last = y.slice(n - k);
  const prev = y.slice(Math.max(0, n - 2 * k), n - k);

  const mu1 = mean(last);
  const mu0 = mean(prev);

  const den = Math.max(Math.abs(mu0), pctFloor, eps);
  return (mu1 - mu0) / den;
}

/* ------------------------- Spike diagnostics ------------------------- */

function computeSpikeDiagnostics(y, cfg, med, sigma_r) {
  const n = y.length;
  const M = Math.max(1, Math.min(cfg.spikeLookbackWeeks, n));
  const start = Math.max(0, n - M);

  let intensity = -Infinity;
  let lastAboveIdx = -1;
  let frequency = 0;

  let bestRun = 0;
  let curRun = 0;

  for (let i = start; i < n; i++) {
    const z = sigma_r < cfg.eps ? 0 : (y[i] - med) / Math.max(sigma_r, cfg.eps);
    if (z > intensity) intensity = z;

    if (z >= cfg.zSpike) {
      frequency++;
      lastAboveIdx = i;
    }

    if (z >= cfg.zPersist) {
      curRun++;
      bestRun = Math.max(bestRun, curRun);
    } else {
      curRun = 0;
    }
  }

  const recencyWeeks =
    lastAboveIdx === -1 ? Number.POSITIVE_INFINITY : (n - 1 - lastAboveIdx);

  if (intensity === -Infinity) intensity = 0;

  return {
    spikeIntensity: intensity,
    spikeRecencyWeeks: recencyWeeks,
    spikeFrequency: frequency,
    spikePersistence: bestRun,
  };
}

/* ------------------------- Shock class ------------------------- */

function classifyShock(metrics, cfg) {
  const { spike, acceleration, monotonicity, volatility } = metrics;

  const hasRecentSpike =
    spike.spikeIntensity >= cfg.zSpike &&
    spike.spikeRecencyWeeks <= cfg.spikeRecentWeeks;

  const accelGate = acceleration > cfg.accelStrong;
  const monoGate = monotonicity > cfg.monoMin;

  const noise =
    volatility >= cfg.noiseVolHigh &&
    Math.abs(monotonicity) <= cfg.noiseMonoAbsMax;

  if (noise) return "noise";
  if (hasRecentSpike && accelGate && monoGate) return "reinforcing";
  if (hasRecentSpike && !accelGate) return "transient";
  return "none";
}

/* ------------------------- Direction (acceleration-first) ------------------------- */

function decideDirection(m, cfg) {
  const a = m.acceleration;
  const bS = m.shortSlope;
  const bL = m.longSlope;
  const mono = m.monotonicity;
  const p = m.pctChangeShort;
  const z = m.zLatest;

  const inc =
    a > cfg.accelStrong &&
    bS > cfg.slopeMin &&
    mono > cfg.monoMin &&
    (p > cfg.pMin || z > cfg.zMin);

  if (inc) return "increasing";

  const dec =
    a < -cfg.accelStrong &&
    bS < -cfg.slopeMin &&
    mono < -cfg.monoMin &&
    (p < -cfg.pMin || z < -cfg.zMin);

  if (dec) return "decreasing";

  const flat =
    (Math.abs(bL) <= cfg.slopeFlat && Math.abs(p) <= cfg.pFlat) ||
    (Math.abs(mono) <= cfg.monoFlat && Math.abs(a) <= cfg.accelFlat);

  if (flat) return "flat";

  const weak = bS + cfg.weakLambda * mono;
  return weak > 0 ? "increasing" : "decreasing";
}

/* ------------------------- Trend strength score ------------------------- */

function computeTrendStrengthScore(m, cfg) {
  const accelScore = clamp(Math.abs(m.acceleration) / Math.max(cfg.eps, cfg.accelScale), 0, 1);
  const shortSlopeScore = clamp(Math.abs(m.shortSlope) / Math.max(cfg.eps, cfg.slopeScale), 0, 1);

  const pctAbs = Math.abs(m.pctChangeShortClamped);
  const pctScore = clamp(pctAbs / Math.max(cfg.eps, cfg.pctScale), 0, 1);

  const monoScore = clamp(Math.abs(m.monotonicity), 0, 1);
  const zScore = clamp(Math.abs(m.zLatest) / Math.max(cfg.eps, cfg.zScale), 0, 1);

  let Sbase =
    0.40 * accelScore +
    0.20 * shortSlopeScore +
    0.15 * pctScore +
    0.15 * monoScore +
    0.10 * zScore;

  const volPenalty = clamp(m.volatility / Math.max(cfg.eps, cfg.volScale), 0, 1);
  let S = Sbase * (1 - volPenalty * clamp(cfg.volWeight, 0, 1));

  const s1 = sign(m.shortSlope, cfg.nearZero);
  const s2 = sign(m.pctChangeShort, cfg.nearZero);
  const s3 = sign(m.acceleration, cfg.nearZero);
  const consistent = s1 !== 0 && s1 === s2 && s2 === s3;
  if (consistent) S = Math.min(1, S + 0.05);

  if (m.shockClass === "reinforcing") S = Math.min(1, S + 0.05);
  if (m.shockClass === "noise") S = S * 0.85;

  return clamp(S, 0, 1);
}

/* ------------------------- Spike multiplier ------------------------- */

function expDecay(recencyWeeks, halfLifeWeeks) {
  if (!isFinite(recencyWeeks)) return 0;
  const hl = Math.max(1e-6, halfLifeWeeks);
  return Math.exp(-recencyWeeks / hl);
}

function computeSpikeMultiplier(m, cfg) {
  const volPenalty = clamp(m.volatility / Math.max(cfg.eps, cfg.volScale), 0, 1);

  const bump =
    clamp(m.spike.spikeIntensity / Math.max(cfg.eps, cfg.spikeZScale), 0, 1) *
    cfg.bumpMax;

  const decay = expDecay(m.spike.spikeRecencyWeeks, cfg.halfLifeWeeks);

  let spikeBump = 1 + bump * decay;

  spikeBump = spikeBump * (1 - volPenalty * clamp(cfg.spikeVolPenaltyWeight, 0, 1));

  let cap = 1 + cfg.bumpMax;
  if (m.shockClass === "transient") cap = 1 + cfg.bumpMax * 0.5;
  if (m.shockClass === "noise") cap = 1 + cfg.bumpMax * 0.25;

  return clamp(spikeBump, 1, cap);
}

/* ------------------------- Ranking score (acceleration-forward) ------------------------- */

function computeRankScore(m, cfg) {
  const accelScore = clamp(Math.abs(m.acceleration) / Math.max(cfg.eps, cfg.accelScale), 0, 1);
  const shortSlopeScore = clamp(Math.abs(m.shortSlope) / Math.max(cfg.eps, cfg.slopeScale), 0, 1);
  const volPenalty = clamp(m.volatility / Math.max(cfg.eps, cfg.volScale), 0, 1);

  const decay = expDecay(m.spike.spikeRecencyWeeks, cfg.halfLifeWeeks);
  const spikeUrgency =
    clamp(m.spike.spikeIntensity / Math.max(cfg.eps, cfg.urgencyZScale), 0, 1) * decay;

  const usageScore =
    clamp(
      safeDiv(log1p(m.avgWeeklyUsage), log1p(cfg.usageScale), cfg.eps),
      0,
      1
    );

  return (
    0.50 * accelScore +
    0.20 * shortSlopeScore +
    0.15 * m.trendStrengthScore +
    0.10 * spikeUrgency +
    0.05 * usageScore -
    0.15 * volPenalty
  );
}

/* ------------------------- Main API ------------------------- */

/**
 * Compute trend + spike metrics from weekly usage series.
 * @param {number[]} weeklyUsage
 * @param {Partial<TrendMathConfig>} [cfgIn]
 * @returns {TrendMetrics}
 */
function computeTrendMetrics(weeklyUsage, cfgIn) {
  const cfg = { ...defaultTrendMathConfig(), ...(cfgIn || {}) };
  const y = (weeklyUsage || []).map((v) => Number(v) || 0);
  const N = y.length;

  const avgWeeklyUsage = mean(y);
  const latestWeeklyUsage = N ? y[N - 1] : 0;

  const med = median(y);
  const MAD = mad(y, med);
  const sigma_r = 1.4826 * MAD;

  const longSlope = theilSenSlope(y, cfg.eps);

  const K = Math.max(1, Math.min(cfg.shortWindowWeeks, N));
  const shortSlice = y.slice(Math.max(0, N - K));
  const shortSlope = theilSenSlope(shortSlice, cfg.eps);

  const acceleration = shortSlope - longSlope;

  const monotonicity = monotonicityScore(y, K, cfg.eps);

  const pct = pctChangeShort(y, K, cfg.pctFloor, cfg.eps);
  const pctClamped = clamp(pct, -cfg.pctCap, cfg.pctCap);

  const zLatest =
    sigma_r < cfg.eps ? 0 : (latestWeeklyUsage - med) / Math.max(sigma_r, cfg.eps);

  const volatility = sigma_r;

  const spike = computeSpikeDiagnostics(y, cfg, med, sigma_r);

  const out = {
    N,
    avgWeeklyUsage,
    latestWeeklyUsage,
    med,
    mad: MAD,
    sigma_r,
    longSlope,
    shortSlope,
    acceleration,
    monotonicity,
    pctChangeShort: pct,
    pctChangeShortClamped: pctClamped,
    zLatest,
    volatility,
    spike,
    shockClass: "none",
    direction: "flat",
    trendStrengthScore: 0,
    spikeMultiplier: 1,
    rankScore: 0,
  };

  out.shockClass = classifyShock(out, cfg);
  out.direction = decideDirection(out, cfg);
  out.trendStrengthScore = computeTrendStrengthScore(out, cfg);
  out.spikeMultiplier = computeSpikeMultiplier(out, cfg);
  out.rankScore = computeRankScore(out, cfg);

  return out;
}

/* ------------------------- Exports ------------------------- */

const TrendMath = {
  defaultTrendMathConfig,
  computeTrendMetrics,

  _internals: {
    median,
    mad,
    theilSenSlope,
    monotonicityScore,
    pctChangeShort,
    computeSpikeDiagnostics,
    classifyShock,
    decideDirection,
    computeTrendStrengthScore,
    computeSpikeMultiplier,
    computeRankScore,
    clamp,
    mean,
    sign,
  },
};

// CommonJS (Node/tests)
if (typeof module !== "undefined" && module.exports) {
  module.exports = TrendMath;
}

// Browser global (your dashboard)
if (typeof window !== "undefined") {
  window.TrendMath = TrendMath;
}
