#!/usr/bin/env node

const { TrendAnalysisEngine, TrendDetectionConfig } = require('../trend_detection_integrated');

function createFluLikeSeries(length = 140, period = 52) {
  const baseline = 100;
  const slopePerStep = 0.12;
  const seasonal = Array.from({ length: period }, (_, p) => {
    // Peak near week 48, trough near mid-year (around week 26)
    const distanceToPeak = Math.min(Math.abs(p - 48), period - Math.abs(p - 48));
    const distanceToTrough = Math.min(Math.abs(p - 26), period - Math.abs(p - 26));
    const peakBump = Math.max(0, 1 - distanceToPeak / 8) * 0.6;
    const troughDip = Math.max(0, 1 - distanceToTrough / 10) * 0.25;
    return 1 + peakBump - troughDip;
  });

  const data = [];
  for (let i = 0; i < length; i++) {
    const noise = (Math.random() - 0.5) * 8;
    const value = (baseline + slopePerStep * i) * seasonal[i % period] + noise;
    data.push(Math.max(1, value));
  }
  return data;
}

function createNonSeasonalSeries(length = 140) {
  return Array.from({ length }, (_, i) => {
    const trend = 85 + i * 0.08;
    const noise = (Math.random() - 0.5) * 10;
    return Math.max(1, trend + noise);
  });
}

function withinTolerance(value, expected, tolerance) {
  return Math.abs(value - expected) <= tolerance;
}

function runCase(name, data, checks) {
  const engine = new TrendAnalysisEngine(new TrendDetectionConfig());
  const analysis = engine.analyze(data, { defaultPeriod: 52, leadTimeSteps: 2, safetyBufferSteps: 1 });

  const metrics = {
    seasonalStrength: analysis.seasonal.strength,
    peakPhase: analysis.forecast.peakPhase,
    nextPeakOffset: analysis.forecast.nextPeakOffset,
    recommendedOrderOffset: analysis.reorder.recommendedOrderOffset,
    projectedPeakTrendAdj: analysis.forecast.projectedPeakTrendAdj,
    severity: analysis.reorder.severity
  };

  const failures = checks.filter(check => !check.test(analysis));
  const pass = failures.length === 0;

  console.log(`\n[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(' metrics:', metrics);
  if (!pass) {
    failures.forEach(f => console.log(`  - ${f.message}`));
  }

  return pass;
}

const fluPass = runCase('Flu-like seasonal weekly series', createFluLikeSeries(), [
  {
    message: 'Expected seasonalStrength > 0.6',
    test: a => a.seasonal.strength > 0.6
  },
  {
    message: 'Expected peakPhase near 48 (+/- 3)',
    test: a => typeof a.forecast.peakPhase === 'number' && withinTolerance(a.forecast.peakPhase, 48, 3)
  },
  {
    message: 'Expected nextPeakOffset to be computed',
    test: a => a.forecast.nextPeakOffset !== null
  },
  {
    message: 'Expected recommendedOrderOffset <= peakStartOffset',
    test: a => {
      if (a.reorder.recommendedOrderOffset === null || !a.forecast.peakWindow) return false;
      const period = a.seasonal.period;
      const lastPhase = (a.metadata.dataPoints - 1) % period;
      const peakStartOffset = ((a.forecast.peakWindow.startPhase - lastPhase) % period + period) % period || period;
      return a.reorder.recommendedOrderOffset <= peakStartOffset;
    }
  },
  {
    message: 'Expected severity medium/high when peak projection materially exceeds recent average',
    test: a => {
      const recent = a.metadata.adjustedData.slice(-8);
      const recentAvg = recent.reduce((acc, v) => acc + v, 0) / recent.length;
      if (a.forecast.projectedPeakTrendAdj > recentAvg * 1.1) {
        return a.reorder.severity === 'medium' || a.reorder.severity === 'high';
      }
      return true;
    }
  }
]);

const nonSeasonalPass = runCase('Non-seasonal series', createNonSeasonalSeries(), [
  {
    message: 'Expected seasonalStrength < 0.3',
    test: a => a.seasonal.strength < 0.3
  },
  {
    message: 'Expected reorder recommendation to be null without seasonality',
    test: a => a.reorder.recommendedOrderOffset === null
  }
]);

const allPass = fluPass && nonSeasonalPass;
console.log(`\nOverall: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
