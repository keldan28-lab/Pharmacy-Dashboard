#!/usr/bin/env node
const TrendMath = require('../js/app/trend_math.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  const cfg = TrendMath.defaultTrendMathConfig();

  const accelUp = [1, 2, 3, 5, 8, 12, 17, 23];
  const m1 = TrendMath.computeTrendMetrics(accelUp, cfg);
  assert(m1.direction === 'increasing', 'accelerating upward series should be increasing');

  const oneSpike = [10, 10, 10, 10, 10, 25, 10, 10];
  const m2 = TrendMath.computeTrendMetrics(oneSpike, cfg);
  assert(m2.direction !== 'increasing', 'one-week spike with non-positive acceleration must not be increasing');

  const recentSpike = TrendMath.computeTrendMetrics([10, 10, 10, 10, 10, 10, 16, 10], cfg);
  const oldSpike = TrendMath.computeTrendMetrics([16, 10, 10, 10, 10, 10, 10, 10], cfg);
  assert(recentSpike.spikeMultiplier >= oldSpike.spikeMultiplier, 'spike multiplier should decay with recency');

  console.log('✓ TrendMath tests passed');
}

try {
  run();
} catch (err) {
  console.error('✗ TrendMath test failed:', err.message);
  process.exit(1);
}
