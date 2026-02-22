# Pharmacy-Dashboard

## Trend analysis additions

The integrated trend pipeline now includes additive seasonal planning outputs per analyzed series/item:

- `analysis.seasonal`: seasonality detection state, strength, period, indices, peak/trough phase.
- `analysis.forecast`: next seasonal peak offset, peak multiplier/window, seasonal baseline, projected peak demand.
- `analysis.reorder`: lead-time/safety-buffer reorder timing recommendation with severity and rationale.

Trending item rows now also include:

- `seasonalDetected`
- `seasonalStrength`
- `peakPhase`
- `nextPeakOffset`
- `projectedPeakTrendAdj`
- `reorderRecommendedOffset`
- `reorderSeverity`

## Validation scripts

- Parse/syntax gate:
  - `npm run check:parse`
- Flu-season + reorder validation with synthetic weekly data:
  - `node scripts/test_flu_reorder.js`
