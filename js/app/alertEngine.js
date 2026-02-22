(function (global) {
  'use strict';

  function n(v, fallback) {
    const num = Number(v);
    return Number.isFinite(num) ? num : fallback;
  }

  function safeDiv(a, b) {
    const bn = Number(b);
    if (!Number.isFinite(bn) || bn === 0) return 0;
    return Number(a) / bn;
  }

  function getTrendingLookup(trendingItems) {
    const lookup = Object.create(null);
    const list = (trendingItems && Array.isArray(trendingItems.trendingUp)) ? trendingItems.trendingUp : [];
    list.forEach(function (item) {
      if (!item) return;
      const code = String(item.itemCode || '').trim();
      if (!code) return;
      lookup[code] = item;
    });
    return lookup;
  }

  function computeDemandRates(trendObj) {
    const avgWeeklyUsage = Math.max(0, n(trendObj && trendObj.avgWeeklyUsage, 0));
    const projectedPeak = n(trendObj && (trendObj.projectedPeakTrendAdj || (trendObj.analysis && trendObj.analysis.forecast && trendObj.analysis.forecast.projectedPeakTrendAdj)), NaN);
    const riskWeekly = Number.isFinite(projectedPeak) ? Math.max(avgWeeklyUsage, projectedPeak) : avgWeeklyUsage;
    return {
      avgWeeklyUsage,
      projectedPeak: Number.isFinite(projectedPeak) ? projectedPeak : null,
      seasonalStrength: n(trendObj && trendObj.seasonalStrength, 0),
      riskWeekly,
      riskDaily: riskWeekly / 7
    };
  }

  function computeAlerts(normalizedFacts, trendingItems, config) {
    const cfg = Object.assign({
      leadDays: 14,
      safetyDays: 7,
      tolerance: 0.5,
      maxDosDays: 90,
      lowUsageWeeklyThreshold: 0.25,
      severityWeights: { minTooLow: 3, minTooHigh: 2, overMax: 2, wasteRisk: 3, inactivity: 1, excessDaysOfSupply: 2 }
    }, config || {});

    const targetDays = cfg.leadDays + cfg.safetyDays;
    const rows = Array.isArray(normalizedFacts && normalizedFacts.facts) ? normalizedFacts.facts : [];
    const byItemRows = (normalizedFacts && normalizedFacts.factsByItemCode) || {};
    const trendByCode = getTrendingLookup(trendingItems || global.trendingItems || {});

    const allAlerts = [];
    const byMainLocation = Object.create(null);
    const bySublocation = Object.create(null);
    const byItem = Object.create(null);
    const countsByType = { minTooLow: 0, minTooHigh: 0, overMax: 0, wasteRisk: 0, inactivity: 0, excessDaysOfSupply: 0 };
    const valueByType = { excessValue: 0, wasteValue: 0 };

    function pushAlert(alert) {
      allAlerts.push(alert);
      if (countsByType[alert.type] === undefined) countsByType[alert.type] = 0;
      countsByType[alert.type] += 1;

      if (!byMainLocation[alert.mainLocation]) byMainLocation[alert.mainLocation] = { countsByType: {}, topAlerts: [], severityScore: 0 };
      if (!bySublocation[alert.sublocation]) {
        bySublocation[alert.sublocation] = { mainLocation: alert.mainLocation, department: alert.department, alerts: [], severityScore: 0 };
      }
      if (!byItem[alert.itemCode]) byItem[alert.itemCode] = { alerts: [], overallSeverity: 0 };

      byMainLocation[alert.mainLocation].topAlerts.push(alert);
      byMainLocation[alert.mainLocation].countsByType[alert.type] = (byMainLocation[alert.mainLocation].countsByType[alert.type] || 0) + 1;
      byMainLocation[alert.mainLocation].severityScore += alert.severityScore;

      bySublocation[alert.sublocation].alerts.push(alert);
      bySublocation[alert.sublocation].severityScore += alert.severityScore;

      byItem[alert.itemCode].alerts.push(alert);
      byItem[alert.itemCode].overallSeverity += alert.severityScore;
    }

    rows.forEach(function (fact) {
      const trendObj = trendByCode[fact.itemCode] || {};
      const demand = computeDemandRates(trendObj);
      const eps = 0.0001;
      const requiredMin = demand.riskDaily * targetDays;
      const minQty = n(fact.minQty, NaN);
      const maxQty = n(fact.maxQty, NaN);
      const curQty = n(fact.curQty, NaN);
      const coverageDays = safeDiv(minQty, Math.max(demand.riskDaily, eps));

      if (fact.department === 'Pyxis' && Number.isFinite(minQty) && demand.riskDaily > 0) {
        if (minQty < requiredMin * 0.95) {
          const deltaMin = requiredMin - minQty;
          const severity = (deltaMin / Math.max(requiredMin, 1)) > 0.3 ? 'high' : 'medium';
          const weight = cfg.severityWeights.minTooLow || 3;
          pushAlert({ type: 'minTooLow', severity, severityScore: severity === 'high' ? weight : Math.max(1, weight - 1), itemCode: fact.itemCode, sublocation: fact.sublocation, mainLocation: fact.mainLocation, department: fact.department, minQty, requiredMin, deltaMin, coverageDays, curQty, maxQty, riskDaily: demand.riskDaily });
        } else if (minQty > requiredMin * (1 + cfg.tolerance)) {
          const deltaMin = minQty - requiredMin;
          const weight = cfg.severityWeights.minTooHigh || 2;
          pushAlert({ type: 'minTooHigh', severity: 'medium', severityScore: weight, itemCode: fact.itemCode, sublocation: fact.sublocation, mainLocation: fact.mainLocation, department: fact.department, minQty, requiredMin, deltaMin, coverageDays, curQty, maxQty, riskDaily: demand.riskDaily });
        }
      }

      if (Number.isFinite(curQty) && Number.isFinite(maxQty) && maxQty > 0 && curQty > maxQty * 1.3) {
        pushAlert({ type: 'overMax', severity: 'medium', severityScore: cfg.severityWeights.overMax || 2, itemCode: fact.itemCode, sublocation: fact.sublocation, mainLocation: fact.mainLocation, department: fact.department, curQty, maxQty });
      }

      if (Number.isFinite(curQty) && demand.riskDaily > 0) {
        const dos = curQty / Math.max(demand.riskDaily, eps);
        if (dos > cfg.maxDosDays) {
          pushAlert({ type: 'excessDaysOfSupply', severity: 'medium', severityScore: cfg.severityWeights.excessDaysOfSupply || 2, itemCode: fact.itemCode, sublocation: fact.sublocation, mainLocation: fact.mainLocation, department: fact.department, curQty, daysOfSupply: dos });
        }
      }

      if (Number.isFinite(curQty) && curQty > 0 && demand.avgWeeklyUsage <= cfg.lowUsageWeeklyThreshold) {
        pushAlert({ type: 'inactivity', severity: 'low', severityScore: cfg.severityWeights.inactivity || 1, itemCode: fact.itemCode, sublocation: fact.sublocation, mainLocation: fact.mainLocation, department: fact.department, curQty, avgWeeklyUsage: demand.avgWeeklyUsage });
        if (curQty >= Math.max(10, demand.avgWeeklyUsage * 8)) {
          pushAlert({ type: 'wasteRisk', severity: 'high', severityScore: cfg.severityWeights.wasteRisk || 3, itemCode: fact.itemCode, sublocation: fact.sublocation, mainLocation: fact.mainLocation, department: fact.department, curQty, avgWeeklyUsage: demand.avgWeeklyUsage });
        }
      }
    });

    Object.keys(byMainLocation).forEach(function (loc) {
      byMainLocation[loc].topAlerts.sort(function (a, b) { return b.severityScore - a.severityScore; });
      byMainLocation[loc].topAlerts = byMainLocation[loc].topAlerts.slice(0, 10);
    });

    // Pharmacy feasibility pass
    Object.keys(byItemRows).forEach(function (itemCode) {
      const facts = byItemRows[itemCode] || [];
      const pharmacyFacts = facts.filter(function (f) { return f.department === 'Pharmacy'; });
      const pyxisFacts = facts.filter(function (f) { return f.department === 'Pyxis'; });
      const trend = computeDemandRates(trendByCode[itemCode] || {});
      const pharmacyOnHand = pharmacyFacts.reduce(function (sum, f) { return sum + Math.max(0, n(f.curQty, 0)); }, 0);
      const pyxisRiskDaily = pyxisFacts.length * trend.riskDaily;
      const pharmacyRequiredBuffer = pyxisRiskDaily * targetDays;
      const available = Math.max(0, pharmacyOnHand - pharmacyRequiredBuffer);

      (byItem[itemCode] && byItem[itemCode].alerts || []).forEach(function (alert) {
        if (alert.type !== 'minTooLow') return;
        const transferRecommendedQty = Math.max(0, Math.min(alert.deltaMin || 0, available));
        alert.transferRecommendedQty = transferRecommendedQty;
        alert.supplyFeasible = transferRecommendedQty > 0;
      });
    });

    const topItemsByRisk = Object.keys(byItem)
      .map(function (code) { return { itemCode: code, severity: byItem[code].overallSeverity, alertCount: byItem[code].alerts.length }; })
      .sort(function (a, b) { return b.severity - a.severity; })
      .slice(0, 10);

    return {
      totals: { countsByType, valueByType, topItemsByRisk },
      byMainLocation,
      bySublocation,
      byItem,
      allAlerts
    };
  }

  global.AlertEngine = global.AlertEngine || {};
  global.AlertEngine.computeAlerts = computeAlerts;
})(typeof window !== 'undefined' ? window : globalThis);
