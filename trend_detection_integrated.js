/**
 * Trend Detection Algorithm - JavaScript Implementation
 * =====================================================
 * 
 * Deterministic, auditable trend detection for time-series data.
 * Extended with advanced detectors and ensemble decision logic.
 * 
 * Usage:
 *   const engine = new TrendAnalysisEngine();
 *   const result = engine.analyze([10, 12, 15, 18, 22, 25]);
 *   console.log(result.summary);
 */

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

const TrendDirection = {
    INCREASING: 'increasing',
    DECREASING: 'decreasing',
    STABLE: 'stable',
    VOLATILE: 'volatile',
    INSUFFICIENT_DATA: 'insufficient_data'
};

const ConfidenceLevel = {
    VERY_HIGH: 'very_high',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
    VERY_LOW: 'very_low'
};

// ============================================================================
// CONFIGURATION
// ============================================================================

class TrendDetectionConfig {
    constructor(options = {}) {
        // Window sizes
        this.shortTermWindow = options.shortTermWindow || 3;
        this.mediumTermWindow = options.mediumTermWindow || 6;
        this.longTermWindow = options.longTermWindow || 12;
        
        // Thresholds
        this.minSlopeThreshold = options.minSlopeThreshold || 0.1;
        this.anomalyZThreshold = options.anomalyZThreshold || 2.5;
        this.minConfidence = options.minConfidence || 0.3;
        
        // Data quality
        this.minDataPoints = options.minDataPoints || 3;
        this.interpolateMissing = options.interpolateMissing !== undefined ? options.interpolateMissing : true;
        this.maxConsecutiveMissing = options.maxConsecutiveMissing || 2;
        
        // Variance thresholds
        this.stableVarianceThreshold = options.stableVarianceThreshold || 0.5;
        this.highVarianceThreshold = options.highVarianceThreshold || 2.0;
        
        // Change point detection
        this.cusumThreshold = options.cusumThreshold || 5.0;
        this.cusumDrift = options.cusumDrift || 0.5;

        // Advanced methods weights for ensemble
        this.ensembleWeights = Object.assign({
            basicOverall: 0.4,
            mannKendall: 0.2,
            theilSen: 0.15,
            holtWinters: 0.15,
            piecewise: 0.1
        }, options.ensembleWeights || {});

        // Rule engine configuration
        this.decisionRules = options.decisionRules || [
            {
                id: 'strong_increase',
                direction: TrendDirection.INCREASING,
                minConfidence: 0.75,
                minMethodsAgree: 2
            },
            {
                id: 'strong_decrease',
                direction: TrendDirection.DECREASING,
                minConfidence: 0.75,
                minMethodsAgree: 2
            },
            {
                id: 'volatile_override',
                direction: TrendDirection.VOLATILE,
                minConfidence: 0.6,
                minMethodsAgree: 1
            }
        ];
    }
}

// ============================================================================
// STATISTICS UTILITIES
// ============================================================================

class Statistics {
    static mean(arr) {
        if (arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    
    static variance(arr) {
        if (arr.length === 0) return 0;
        const m = this.mean(arr);
        return arr.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / arr.length;
    }
    
    static std(arr) {
        return Math.sqrt(this.variance(arr));
    }
    
    static linearRegression(x, y) {
        const n = x.length;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
        const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
        
        const denom = (n * sumX2 - sumX * sumX);
        const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;
        
        // Calculate R²
        const yMean = sumY / n;
        const yPred = x.map(xi => slope * xi + intercept);
        const ssRes = y.reduce((sum, yi, i) => sum + Math.pow(yi - yPred[i], 2), 0);
        const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
        const rSquared = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
        
        return { slope, intercept, rSquared };
    }
    
    static zScore(arr) {
        const m = this.mean(arr);
        const s = this.std(arr);
        if (s === 0) return arr.map(() => 0);
        return arr.map(val => (val - m) / s);
    }

    // Error function approximation for normal CDF
    static erf(x) {
        // Abramowitz and Stegun approximation
        const sign = x >= 0 ? 1 : -1;
        x = Math.abs(x);

        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const t = 1 / (1 + p * x);
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return sign * y;
    }

    static normalCDF(z) {
        return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
    }
}

// ============================================================================
// DATA PREPROCESSING
// ============================================================================

class DataPreprocessor {
    static cleanData(data, config) {
        const metadata = {
            originalLength: data.length,
            missingCount: 0,
            interpolatedGaps: 0,
            finalLength: 0
        };
        
        // Convert to numbers, track missing
        let cleaned = data.map(v => {
            if (v === null || v === undefined || isNaN(v)) {
                metadata.missingCount++;
                return NaN;
            }
            return Number(v);
        });
        
        // Interpolate missing
        if (config.interpolateMissing && metadata.missingCount > 0) {
            cleaned = this.interpolateMissing(cleaned, config.maxConsecutiveMissing);
        }
        
        // Remove remaining NaN
        cleaned = cleaned.filter(v => !isNaN(v));
        
        metadata.finalLength = cleaned.length;
        
        return { data: cleaned, metadata };
    }
    
    static interpolateMissing(data, maxGap) {
        const result = [...data];
        let i = 0;
        
        while (i < result.length) {
            if (isNaN(result[i])) {
                const gapStart = i;
                while (i < result.length && isNaN(result[i])) i++;
                const gapEnd = i;
                const gapSize = gapEnd - gapStart;
                
                // Interpolate if gap is small enough
                if (gapSize <= maxGap && gapStart > 0 && gapEnd < result.length) {
                    const startVal = result[gapStart - 1];
                    const endVal = result[gapEnd];
                    
                    for (let j = gapStart; j < gapEnd; j++) {
                        const alpha = (j - gapStart + 1) / (gapSize + 1);
                        result[j] = startVal + alpha * (endVal - startVal);
                    }
                }
            } else {
                i++;
            }
        }
        
        return result;
    }
}

// ============================================================================
// TREND DETECTION (BASE)
// ============================================================================

class TrendDetector {
    static detectTrendSegment(data, config) {
        if (data.length < 2) return null;
        
        // Linear regression
        const x = Array.from({ length: data.length }, (_, i) => i);
        const regression = Statistics.linearRegression(x, data);
        
        // Calculate statistics
        const variance = Statistics.variance(data);
        const mean = Statistics.mean(data);
        
        // Determine direction
        let direction;
        const absSlope = Math.abs(regression.slope);
        
        if (variance > config.highVarianceThreshold) {
            direction = TrendDirection.VOLATILE;
        } else if (absSlope < config.minSlopeThreshold) {
            direction = TrendDirection.STABLE;
        } else if (regression.slope > 0) {
            direction = TrendDirection.INCREASING;
        } else {
            direction = TrendDirection.DECREASING;
        }
        
        // Calculate confidence
        const confidence = this.calculateConfidence(
            regression.rSquared, variance, data.length, config
        );
        
        const confidenceLevel = this.getConfidenceLevel(confidence);
        
        return {
            startIndex: 0,
            endIndex: data.length - 1,
            startValue: data[0],
            endValue: data[data.length - 1],
            slope: regression.slope,
            direction: direction,
            confidence: confidence,
            confidenceLevel: confidenceLevel,
            rSquared: regression.rSquared,
            variance: variance,
            meanValue: mean
        };
    }
    
    static calculateConfidence(rSquared, variance, nPoints, config) {
        // R² component
        const rComponent = rSquared;
        
        // Variance component (inverted)
        const varianceComponent = 1.0 / (1.0 + variance / config.stableVarianceThreshold);
        
        // Sample size component (logarithmic)
        const sizeComponent = Math.min(1.0, 
            Math.log(nPoints + 1) / Math.log(config.longTermWindow + 1)
        );
        
        // Weighted average
        const confidence = (
            0.5 * rComponent +
            0.3 * varianceComponent +
            0.2 * sizeComponent
        );
        
        return Math.max(0, Math.min(1, confidence));
    }
    
    static getConfidenceLevel(confidence) {
        if (confidence >= 0.9) return ConfidenceLevel.VERY_HIGH;
        if (confidence >= 0.7) return ConfidenceLevel.HIGH;
        if (confidence >= 0.5) return ConfidenceLevel.MEDIUM;
        if (confidence >= 0.3) return ConfidenceLevel.LOW;
        return ConfidenceLevel.VERY_LOW;
    }
}

// ============================================================================
// CHANGE POINT DETECTION
// ============================================================================

class ChangePointDetector {
    static detectCUSUM(data, config) {
        if (data.length < 4) return [];
        
        const mean = Statistics.mean(data);
        const std = Statistics.std(data);
        
        if (std === 0) return [];
        
        // Normalize
        const normalized = data.map(v => (v - mean) / std);
        
        // CUSUM
        let sPos = 0;
        let sNeg = 0;
        const changePoints = [];
        
        for (let i = 1; i < data.length; i++) {
            sPos = Math.max(0, sPos + normalized[i] - config.cusumDrift);
            sNeg = Math.min(0, sNeg + normalized[i] + config.cusumDrift);
            
            if (sPos > config.cusumThreshold || sNeg < -config.cusumThreshold) {
                const beforeMean = Statistics.mean(data.slice(0, i));
                const afterMean = Statistics.mean(data.slice(i));
                const changeMag = Math.abs(afterMean - beforeMean);
                
                changePoints.push({
                    index: i,
                    value: data[i],
                    changeMagnitude: changeMag,
                    confidence: Math.min(1.0, changeMag / (2 * std)),
                    method: 'cusum',
                    beforeMean: beforeMean,
                    afterMean: afterMean
                });
                
                sPos = 0;
                sNeg = 0;
            }
        }
        
        return changePoints;
    }
}

// ============================================================================
// ANOMALY DETECTION
// ============================================================================

class AnomalyDetector {
    static detectAnomalies(data, config) {
        if (data.length < 3) return [];
        
        const mean = Statistics.mean(data);
        const std = Statistics.std(data);
        
        if (std === 0) return [];
        
        const zScores = Statistics.zScore(data);
        const anomalies = [];
        
        zScores.forEach((z, i) => {
            if (Math.abs(z) > config.anomalyZThreshold) {
                anomalies.push({
                    index: i,
                    value: data[i],
                    expectedValue: mean,
                    deviation: data[i] - mean,
                    zScore: z,
                    anomalyType: z > 0 ? 'spike' : 'drop'
                });
            }
        });
        
        return anomalies;
    }
}

// ============================================================================
// ADVANCED TREND METHODS
// ============================================================================

// Mann–Kendall non-parametric trend test
class MannKendall {
    static test(data) {
        const n = data.length;
        if (n < 3) return null;

        let s = 0;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                if (data[j] > data[i]) s++;
                else if (data[j] < data[i]) s--;
            }
        }

        const varS = (n * (n - 1) * (2 * n + 5)) / 18;
        const z = s > 0 ? (s - 1) / Math.sqrt(varS)
              : s < 0 ? (s + 1) / Math.sqrt(varS)
              : 0;

        const pValue = 2 * (1 - Statistics.normalCDF(Math.abs(z)));

        let direction = TrendDirection.STABLE;
        if (z > 0) direction = TrendDirection.INCREASING;
        else if (z < 0) direction = TrendDirection.DECREASING;

        // Confidence: invert p-value
        const confidence = Math.max(0, Math.min(1, 1 - pValue));

        return {
            statistic: s,
            zScore: z,
            pValue: pValue,
            direction: direction,
            confidence: confidence,
            confidenceLevel: TrendDetector.getConfidenceLevel(confidence)
        };
    }
}

// Theil–Sen robust slope estimator
class TheilSen {
    static slope(data, config) {
        const n = data.length;
        if (n < 2) return null;

        const slopes = [];
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                slopes.push((data[j] - data[i]) / (j - i));
            }
        }

        slopes.sort((a, b) => a - b);
        const medianSlope = slopes[Math.floor(slopes.length / 2)];

        let direction = TrendDirection.STABLE;
        if (medianSlope > config.minSlopeThreshold) direction = TrendDirection.INCREASING;
        else if (medianSlope < -config.minSlopeThreshold) direction = TrendDirection.DECREASING;

        const absSlope = Math.abs(medianSlope);
        const slopeComponent = Math.min(1, absSlope / (config.minSlopeThreshold * 5));
        const confidence = Math.max(0, Math.min(1, slopeComponent));

        return {
            slope: medianSlope,
            direction: direction,
            confidence: confidence,
            confidenceLevel: TrendDetector.getConfidenceLevel(confidence)
        };
    }
}

// Piecewise linear segmentation (bottom-up style)
class PiecewiseLinear {
    static segment(data, maxError = 1.0, config = new TrendDetectionConfig()) {
        if (data.length < 3) return [];

        const segments = [];
        let start = 0;

        while (start < data.length - 2) {
            let end = start + 2;

            while (end < data.length) {
                const x = Array.from({ length: end - start + 1 }, (_, i) => i);
                const y = data.slice(start, end + 1);
                const reg = Statistics.linearRegression(x, y);

                const errors = y.map((v, i) => Math.abs(v - (reg.slope * i + reg.intercept)));
                const maxErr = Math.max(...errors);

                if (maxErr > maxError) break;
                end++;
            }

            const window = data.slice(start, end);
            const segmentTrend = TrendDetector.detectTrendSegment(window, config);

            if (segmentTrend) {
                segments.push({
                    ...segmentTrend,
                    startIndex: start,
                    endIndex: end - 1
                });
            }

            start = end - 1;
        }

        return segments;
    }

    static summarize(segments) {
        if (!segments || segments.length === 0) return null;

        const weights = segments.map(s => (s.endIndex - s.startIndex + 1) * s.confidence);
        const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

        const dirScores = {
            [TrendDirection.INCREASING]: 0,
            [TrendDirection.DECREASING]: 0,
            [TrendDirection.STABLE]: 0,
            [TrendDirection.VOLATILE]: 0
        };

        segments.forEach((s, idx) => {
            dirScores[s.direction] += weights[idx] / totalWeight;
        });

        let bestDir = TrendDirection.STABLE;
        let bestScore = -1;
        Object.keys(dirScores).forEach(d => {
            if (dirScores[d] > bestScore) {
                bestScore = dirScores[d];
                bestDir = d;
            }
        });

        const confidence = bestScore;

        return {
            direction: bestDir,
            confidence: confidence,
            confidenceLevel: TrendDetector.getConfidenceLevel(confidence),
            segments: segments
        };
    }
}

// Holt–Winters (simple level + trend, no seasonality)
class HoltWinters {
    static trend(data, alpha = 0.3, beta = 0.1, config = new TrendDetectionConfig()) {
        if (data.length < 3) return null;

        let level = data[0];
        let trend = data[1] - data[0];

        for (let i = 1; i < data.length; i++) {
            const value = data[i];
            const prevLevel = level;

            level = alpha * value + (1 - alpha) * (level + trend);
            trend = beta * (level - prevLevel) + (1 - beta) * trend;
        }

        let direction = TrendDirection.STABLE;
        if (trend > config.minSlopeThreshold) direction = TrendDirection.INCREASING;
        else if (trend < -config.minSlopeThreshold) direction = TrendDirection.DECREASING;

        const absTrend = Math.abs(trend);
        const trendComponent = Math.min(1, absTrend / (config.minSlopeThreshold * 5));
        const confidence = Math.max(0, Math.min(1, trendComponent));

        return {
            level,
            trend,
            direction,
            confidence,
            confidenceLevel: TrendDetector.getConfidenceLevel(confidence)
        };
    }
}

// ============================================================================
// RULE-ENGINE FOR TREND DECISION
// ============================================================================

class TrendDecisionRuleEngine {
    constructor(config) {
        this.rules = config.decisionRules || [];
    }

    evaluate(context) {
        // context: { methodDirections: {name: direction}, methodConfidences: {name: confidence} }
        const methods = Object.keys(context.methodDirections);

        for (const rule of this.rules) {
            const targetDir = rule.direction;
            const minConf = rule.minConfidence || 0;
            const minAgree = rule.minMethodsAgree || 1;

            const agreeing = methods.filter(m => 
                context.methodDirections[m] === targetDir &&
                (context.methodConfidences[m] || 0) >= minConf
            );

            if (agreeing.length >= minAgree) {
                return {
                    appliedRuleId: rule.id,
                    direction: targetDir
                };
            }
        }

        return null;
    }
}

// ============================================================================
// MAIN ANALYSIS ENGINE
// ============================================================================

class TrendAnalysisEngine {
    constructor(config) {
        this.config = config || new TrendDetectionConfig();
        this.ruleEngine = new TrendDecisionRuleEngine(this.config);
    }
    
    analyze(data) {
        // Convert to array
        const rawData = Array.isArray(data) ? data : [data];
        
        // Preprocess
        const { data: cleanedData, metadata: preprocessingMetadata } = 
            DataPreprocessor.cleanData(rawData, this.config);
        
        // Check if enough data
        if (cleanedData.length < this.config.minDataPoints) {
            return this.insufficientDataResult(preprocessingMetadata);
        }
        
        // Multi-scale trend detection
        const shortTermTrends = this.analyzeWindow(
            cleanedData, this.config.shortTermWindow
        );
        const mediumTermTrends = this.analyzeWindow(
            cleanedData, this.config.mediumTermWindow
        );
        const longTermTrends = this.analyzeWindow(
            cleanedData, this.config.longTermWindow
        );
        
        // Change point detection
        const changePoints = ChangePointDetector.detectCUSUM(cleanedData, this.config);
        
        // Anomaly detection
        const anomalies = AnomalyDetector.detectAnomalies(cleanedData, this.config);
        
        // Determine overall trend (base)
        const baseOverall = this.determineOverallTrend(shortTermTrends, mediumTermTrends, longTermTrends);
        
        // Advanced methods
        const mannKendall = MannKendall.test(cleanedData);
        const theilSen = TheilSen.slope(cleanedData, this.config);
        const piecewiseSegments = PiecewiseLinear.segment(cleanedData, 1.5, this.config);
        const piecewiseSummary = PiecewiseLinear.summarize(piecewiseSegments);
        const holtWinters = HoltWinters.trend(cleanedData, 0.3, 0.1, this.config);

        // Ensemble decision
        const ensemble = this.determineEnsembleTrend(baseOverall, {
            mannKendall,
            theilSen,
            piecewise: piecewiseSummary,
            holtWinters
        });

        // Rule-engine override / confirmation
        const ruleDecision = this.ruleEngine.evaluate({
            methodDirections: {
                basicOverall: baseOverall.direction,
                mannKendall: mannKendall ? mannKendall.direction : null,
                theilSen: theilSen ? theilSen.direction : null,
                piecewise: piecewiseSummary ? piecewiseSummary.direction : null,
                holtWinters: holtWinters ? holtWinters.direction : null
            },
            methodConfidences: {
                basicOverall: baseOverall.confidence,
                mannKendall: mannKendall ? mannKendall.confidence : 0,
                theilSen: theilSen ? theilSen.confidence : 0,
                piecewise: piecewiseSummary ? piecewiseSummary.confidence : 0,
                holtWinters: holtWinters ? holtWinters.confidence : 0
            }
        });

        const finalDirection = ruleDecision ? ruleDecision.direction : ensemble.direction;
        const finalConfidence = ensemble.confidence;

        // Generate summary
        const summary = this.generateSummary(
            cleanedData, shortTermTrends, mediumTermTrends, longTermTrends,
            changePoints, anomalies, finalDirection
        );
        
        return {
            shortTermTrends: shortTermTrends,
            mediumTermTrends: mediumTermTrends,
            longTermTrends: longTermTrends,
            changePoints: changePoints,
            anomalies: anomalies,
            overallDirection: finalDirection,
            overallConfidence: finalConfidence,
            baseOverall: baseOverall,
            ensembleTrend: ensemble,
            ruleDecision: ruleDecision,
            advanced: {
                mannKendall,
                theilSen,
                piecewise: piecewiseSummary,
                piecewiseSegments,
                holtWinters
            },
            summary: summary,
            metadata: {
                preprocessing: preprocessingMetadata,
                dataPoints: cleanedData.length,
                originalDataPoints: rawData.length
            }
        };
    }
    
    analyzeWindow(data, windowSize) {
        if (data.length < windowSize) {
            const segment = TrendDetector.detectTrendSegment(data, this.config);
            return segment ? [segment] : [];
        }
        
        const trends = [];
        const stepSize = Math.max(1, Math.floor(windowSize / 2));
        
        for (let i = 0; i <= data.length - windowSize; i += stepSize) {
            const window = data.slice(i, i + windowSize);
            const segment = TrendDetector.detectTrendSegment(window, this.config);
            
            if (segment && segment.confidence >= this.config.minConfidence) {
                segment.startIndex = i;
                segment.endIndex = i + windowSize - 1;
                trends.push(segment);
            }
        }
        
        return trends;
    }
    
    determineOverallTrend(shortTerm, mediumTerm, longTerm) {
        // Priority: long > medium > short
        const scales = [
            { trends: longTerm, weight: 0.5 },
            { trends: mediumTerm, weight: 0.3 },
            { trends: shortTerm, weight: 0.2 }
        ];
        
        for (const scale of scales) {
            if (scale.trends.length > 0) {
                // Get most confident trend
                const bestTrend = scale.trends.reduce((max, t) => 
                    t.confidence > max.confidence ? t : max
                );
                
                const weightedConfidence = Math.min(1.0, bestTrend.confidence * (scale.weight * 2));
                
                return {
                    direction: bestTrend.direction,
                    confidence: weightedConfidence
                };
            }
        }
        
        return {
            direction: TrendDirection.INSUFFICIENT_DATA,
            confidence: 0.0
        };
    }

    determineEnsembleTrend(baseOverall, advanced) {
        const weights = this.config.ensembleWeights;

        const directions = {};
        const confidences = {};

        const addVote = (name, dir, conf, weight) => {
            if (!dir || dir === TrendDirection.INSUFFICIENT_DATA) return;
            const w = (conf || 0) * (weight || 0);
            if (!directions[dir]) directions[dir] = 0;
            directions[dir] += w;
            confidences[name] = conf || 0;
        };

        addVote('basicOverall', baseOverall.direction, baseOverall.confidence, weights.basicOverall);

        if (advanced.mannKendall) {
            addVote('mannKendall', advanced.mannKendall.direction, advanced.mannKendall.confidence, weights.mannKendall);
        }
        if (advanced.theilSen) {
            addVote('theilSen', advanced.theilSen.direction, advanced.theilSen.confidence, weights.theilSen);
        }
        if (advanced.piecewise) {
            addVote('piecewise', advanced.piecewise.direction, advanced.piecewise.confidence, weights.piecewise);
        }
        if (advanced.holtWinters) {
            addVote('holtWinters', advanced.holtWinters.direction, advanced.holtWinters.confidence, weights.holtWinters);
        }

        let bestDir = TrendDirection.INSUFFICIENT_DATA;
        let bestScore = -1;
        Object.keys(directions).forEach(d => {
            if (directions[d] > bestScore) {
                bestScore = directions[d];
                bestDir = d;
            }
        });

        const totalWeight = Object.values(directions).reduce((a, b) => a + b, 0) || 1;
        const confidence = Math.max(0, Math.min(1, totalWeight));

        return {
            direction: bestDir,
            confidence: confidence,
            methodScores: directions,
            methodConfidences: confidences
        };
    }
    
    generateSummary(data, shortTerm, mediumTerm, longTerm, 
                   changePoints, anomalies, overallDirection) {
        const parts = [];
        
        // Overall trend
        const directionText = {
            [TrendDirection.INCREASING]: 'increasing',
            [TrendDirection.DECREASING]: 'decreasing',
            [TrendDirection.STABLE]: 'stable',
            [TrendDirection.VOLATILE]: 'highly volatile',
            [TrendDirection.INSUFFICIENT_DATA]: 'insufficient for analysis'
        };
        
        parts.push(`Overall trend: ${directionText[overallDirection]}.`);
        
        // Current value
        if (data.length > 0) {
            const current = data[data.length - 1];
            const mean = Statistics.mean(data);
            const change = data[0] !== 0 ? ((current - data[0]) / data[0] * 100) : 0;
            
            parts.push(
                `Current value: ${current.toFixed(1)} (mean: ${mean.toFixed(1)}, ` +
                `${change >= 0 ? '+' : ''}${change.toFixed(1)}% from start).`
            );
        }
        
        // Recent trend
        if (shortTerm.length > 0) {
            const recent = shortTerm[shortTerm.length - 1];
            parts.push(
                `Recent trend (${this.config.shortTermWindow} points): ` +
                `${directionText[recent.direction]} (confidence: ${recent.confidenceLevel}).`
            );
        }
        
        // Change points
        if (changePoints.length > 0) {
            const significant = changePoints.filter(cp => cp.confidence > 0.7);
            if (significant.length > 0) {
                parts.push(`Detected ${significant.length} significant change point(s).`);
            }
        }
        
        // Anomalies
        if (anomalies.length > 0) {
            const spikes = anomalies.filter(a => a.anomalyType === 'spike').length;
            const drops = anomalies.filter(a => a.anomalyType === 'drop').length;
            
            if (spikes || drops) {
                parts.push(
                    `Found ${anomalies.length} anomalies: ${spikes} spike(s), ${drops} drop(s).`
                );
            }
        }
        
        return parts.join(' ');
    }
    
    insufficientDataResult(preprocessingMetadata) {
        return {
            shortTermTrends: [],
            mediumTermTrends: [],
            longTermTrends: [],
            changePoints: [],
            anomalies: [],
            overallDirection: TrendDirection.INSUFFICIENT_DATA,
            overallConfidence: 0.0,
            baseOverall: {
                direction: TrendDirection.INSUFFICIENT_DATA,
                confidence: 0.0
            },
            ensembleTrend: {
                direction: TrendDirection.INSUFFICIENT_DATA,
                confidence: 0.0,
                methodScores: {},
                methodConfidences: {}
            },
            ruleDecision: null,
            advanced: {},
            summary: 'Insufficient data for trend analysis.',
            metadata: { preprocessing: preprocessingMetadata }
        };
    }
}

// ============================================================================
// EXPORT
// ============================================================================

// For use in browser
if (typeof window !== 'undefined') {
    window.TrendAnalysisEngine = TrendAnalysisEngine;
    window.TrendDetectionConfig = TrendDetectionConfig;
    window.TrendDirection = TrendDirection;
    window.ConfidenceLevel = ConfidenceLevel;
}

// For use in Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TrendAnalysisEngine,
        TrendDetectionConfig,
        TrendDirection,
        ConfidenceLevel
    };
}/**
 * Advanced Trending Items Calculator
 * ===================================
 * 
 * Integrates the advanced TrendAnalysisEngine with pharmaceutical inventory data.
 * Replaces the simple consecutive-weeks logic with multi-method ensemble detection.
 * 
 * Usage in Dashboard_Tabbed.html:
 *   Include this file.
 *   const result = calculateTrendingItemsAdvanced(MOCK_DATA.items, threshold);
 *
 * This file is intentionally self-contained (no dependency on trend_detection.js).
 */

/**
 * Calculate trending items for an arbitrary time-series field on each item.
 *
 * @param {Array} items
 * @param {string} seriesKey - e.g. 'usageRate', 'wasteRate', 'restockRate'
 * @param {number} threshold
 * @returns {Object|null}
 */
function calculateTrendingSeriesAdvanced(items, seriesKey, threshold = 2) {
    // Clone items with a normalized 'usageRate' alias so we can reuse the engine path.
    const aliased = (items || []).map(it => {
        const series = it && Array.isArray(it[seriesKey]) ? it[seriesKey] : null;
        return series ? { ...it, usageRate: series } : it;
    });
    const result = calculateTrendingItemsAdvanced(aliased, threshold);
    if (!result) return null;
    result.seriesKey = seriesKey;
    return result;
}

/**
 * Convenience wrapper: compute usage/waste/restock trends using the same integrated engine.
 *
 * @param {Array} items
 * @param {number} threshold
 * @returns {{usage:Object|null, waste:Object|null, restock:Object|null}}
 */
function calculateAllTrendsAdvanced(items, threshold = 2) {
    return {
        usage: calculateTrendingSeriesAdvanced(items, 'usageRate', threshold),
        waste: calculateTrendingSeriesAdvanced(items, 'wasteRate', threshold),
        restock: calculateTrendingSeriesAdvanced(items, 'restockRate', threshold)
    };
}

/**
 * Calculate trending items using advanced trend detection
 * 
 * @param {Array} items - Array of pharmaceutical items with usageRate arrays
 * @param {number} threshold - Minimum consecutive weeks (now used as confidence threshold)
 * @returns {Object} Trending items result with confidence scores
 */
function calculateTrendingItemsAdvanced(items, threshold = 2) {
    console.log('📈 Advanced trending calculation started...');
    console.log(`   Analyzing ${items.length} items`);
    console.log(`   Confidence threshold: ${threshold / 10} (derived from ${threshold} week setting)`);
    
    if (!items || items.length === 0) {
        console.error('❌ No items provided');
        return null;
    }
    
    // Create trend analysis engine with pharmaceutical-optimized config
    const config = new TrendDetectionConfig({
        shortTermWindow: 3,        // Last 3 weeks for recent trends
        mediumTermWindow: 6,       // Last 6 weeks for medium-term
        longTermWindow: 12,        // Last 12 weeks for long-term
        minSlopeThreshold: 0.05,   // Lower threshold for pharmaceutical data
        minConfidence: 0.3,        // Minimum confidence to report
        stableVarianceThreshold: 0.3,  // Pharma data is more stable
        highVarianceThreshold: 1.5,
        interpolateMissing: true,  // Handle zeros intelligently
        maxConsecutiveMissing: 2,
        // Adjust ensemble weights for pharmaceutical context
        ensembleWeights: {
            basicOverall: 0.35,     // Basic trend detection
            mannKendall: 0.25,      // Statistical test for monotonic trend
            theilSen: 0.20,         // Robust slope estimation
            holtWinters: 0.15,      // Time series forecasting
            piecewise: 0.05         // Change point detection
        }
    });
    
    const engine = new TrendAnalysisEngine(config);
    
    const trendingUp = [];
    const trendingDown = [];
    
    let itemsAnalyzed = 0;
    let itemsWithUsageRate = 0;
    let itemsWithEnoughData = 0;
    let itemsWithTrends = 0;
    
    // Convert threshold (weeks) to confidence threshold (0.0 - 1.0)
    // threshold 2 = 0.4 confidence minimum
    // threshold 3 = 0.5 confidence minimum
    // threshold 5 = 0.7 confidence minimum
    const confidenceThreshold = Math.min(0.9, 0.2 + (threshold * 0.1));
    
    items.forEach(item => {
        itemsAnalyzed++;
        
        if (!Array.isArray(item.usageRate)) {
            return;
        }
        
        itemsWithUsageRate++;
        
        // Need at least 4 data points for meaningful analysis
        if (item.usageRate.length < 4) {
            return;
        }
        
        itemsWithEnoughData++;
        
        // Exclude the last data point (current incomplete week)
        const completeWeeks = item.usageRate.slice(0, -1);
        
        if (completeWeeks.length < 3) {
            return;
        }
        
        try {
            // Analyze trend using advanced engine
            const analysis = engine.analyze(completeWeeks);
            
            // Skip if insufficient data or very low confidence
            if (analysis.overallDirection === TrendDirection.INSUFFICIENT_DATA ||
                analysis.overallConfidence < 0.2) {
                return;
            }
            
            // Calculate average weekly usage from last 4 complete weeks
            const recentCompleteWeeks = completeWeeks.slice(-4).filter(v => v > 0);
            const avgUsage = recentCompleteWeeks.length > 0
                ? recentCompleteWeeks.reduce((a, b) => a + b, 0) / recentCompleteWeeks.length
                : 0;

            // Keep consecutive weeks for UI thresholding/compatibility
            const consecutiveWeeks = estimateConsecutiveWeeks(completeWeeks, analysis.overallDirection);

            // Enforce a true "uptrend" requirement: the item must be increasing for at least `threshold` consecutive weeks.
            // (Prevents the card from looking like a raw top-usage list when the overall direction is increasing but
            // the last few weeks are not actually consecutively rising.)
            if (analysis.overallDirection === TrendDirection.INCREASING && consecutiveWeeks < threshold) {
                return;
            }

            // Compute percent change vs prior window for sorting ("uptrend" ranking)
            // recentWindow: last 4 complete weeks
            // baselineWindow: the 4 weeks immediately before recentWindow
            const recentWindow = completeWeeks.slice(-4);
            const baselineWindow = completeWeeks.slice(-8, -4);

            const avgNonZero = (arr) => {
                const v = (arr || []).filter(x => typeof x === 'number' && isFinite(x));
                if (v.length === 0) return 0;
                return v.reduce((a,b)=>a+b,0) / v.length;
            };

            const recentAvg = avgNonZero(recentWindow);
            const baselineAvg = avgNonZero(baselineWindow);

            // Percent change: (recent - baseline) / baseline * 100
            // IMPORTANT: baseline==0 is common in sparse pharmacy data and makes the list look like "top usage".
            // Instead of forcing an extreme value (9999), mark the item as NEW so the UI can label it and the sorter
            // can keep "real" % increases above newly-activated items.
            const isNew = (baselineAvg <= 0 && recentAvg > 0);
            const percentChange = (baselineAvg > 0)
                ? ((recentAvg - baselineAvg) / baselineAvg) * 100
                : null;
            
            // Determine if trend meets our threshold
            const meetsThreshold = analysis.overallConfidence >= confidenceThreshold;
            
            if (!meetsThreshold) {
                return;
            }
            
            itemsWithTrends++;
            
            // Create trending item object with advanced metrics
            const trendingItem = {
                itemCode: item.itemCode,
                drugName: item.drugName,
                description: item.description,
                avgWeeklyUsage: avgUsage,
                unitPrice: parseFloat(item.unitPrice) || 0,
                usageRate: item.usageRate,
                
                // Advanced trend metrics
                confidence: analysis.overallConfidence,
                confidenceLevel: getConfidenceLevel(analysis.overallConfidence),
                trendDirection: analysis.overallDirection,
                
                // Method agreement
                ensembleScores: analysis.ensembleTrend.methodScores,
                methodConfidences: analysis.ensembleTrend.methodConfidences,
                
                // Short-term recent trend
                recentTrend: analysis.shortTermTrends.length > 0 
                    ? analysis.shortTermTrends[analysis.shortTermTrends.length - 1].direction
                    : analysis.overallDirection,
                
                // Anomaly flags
                hasAnomalies: analysis.anomalies.length > 0,
                anomalyCount: analysis.anomalies.length,
                
                // Change points
                hasChangePoints: analysis.changePoints.length > 0,
                changePointCount: analysis.changePoints.length,
                
                // Summary text
                trendSummary: analysis.summary,
                
                // Keep consecutive weeks for backward compatibility
                consecutiveWeeks: consecutiveWeeks,

                // Percent change metrics for UI sorting/labeling
                recentAvgWeeklyUsage: recentAvg,
                baselineAvgWeeklyUsage: baselineAvg,
                percentChange: percentChange,
                isNew: isNew
            };
            
            // Categorize based on direction
            if (analysis.overallDirection === TrendDirection.INCREASING) {
                trendingUp.push(trendingItem);
            } else if (analysis.overallDirection === TrendDirection.DECREASING) {
                trendingDown.push(trendingItem);
            }
            
        } catch (error) {
            console.error(`⚠️ Error analyzing item ${item.itemCode}:`, error.message);
        }
    });
    
    // Sort trending up by highest percent increase, then NEW items, then confidence, then average usage
    const sortTrendingUp = (a, b) => {
        const aHasPct = (typeof a.percentChange === 'number' && isFinite(a.percentChange));
        const bHasPct = (typeof b.percentChange === 'number' && isFinite(b.percentChange));
        const aPct = aHasPct ? a.percentChange : -Infinity;
        const bPct = bHasPct ? b.percentChange : -Infinity;

        // Primary: Items with real % deltas first; sort by higher percent increase
        if (aHasPct !== bHasPct) {
            return bHasPct - aHasPct; // true > false
        }
        if (aHasPct && bHasPct && Math.abs(bPct - aPct) > 0.0001) {
            return bPct - aPct;
        }

        // Secondary: "NEW" items (baseline==0) after real % changes, but before everything else
        const aNew = !!a.isNew;
        const bNew = !!b.isNew;
        if (aNew !== bNew) {
            return bNew - aNew;
        }

        // If both are NEW, rank by recent average usage first (more meaningful than raw avgWeeklyUsage)
        if (aNew && bNew) {
            const aRecent = (typeof a.recentAvgWeeklyUsage === 'number' && isFinite(a.recentAvgWeeklyUsage)) ? a.recentAvgWeeklyUsage : 0;
            const bRecent = (typeof b.recentAvgWeeklyUsage === 'number' && isFinite(b.recentAvgWeeklyUsage)) ? b.recentAvgWeeklyUsage : 0;
            if (Math.abs(bRecent - aRecent) > 0.0001) {
                return bRecent - aRecent;
            }
        }

        // Secondary: Higher confidence
        if (Math.abs(b.confidence - a.confidence) > 0.05) {
            return b.confidence - a.confidence;
        }

        // Tertiary: Higher usage
        return b.avgWeeklyUsage - a.avgWeeklyUsage;
    };

    // Sort trending down by confidence, then usage (unchanged behavior)
    const sortTrendingDown = (a, b) => {
        if (Math.abs(b.confidence - a.confidence) > 0.1) {
            return b.confidence - a.confidence;
        }
        return b.avgWeeklyUsage - a.avgWeeklyUsage;
    };
    
    trendingUp.sort(sortTrendingUp);
    trendingDown.sort(sortTrendingDown);
    
    const result = {
        threshold: threshold,
        confidenceThreshold: confidenceThreshold,
        trendingUp: trendingUp,
        trendingDown: trendingDown,
        calculatedAt: new Date().toISOString(),
        
        // Statistics
        stats: {
            itemsAnalyzed,
            itemsWithUsageRate,
            itemsWithEnoughData,
            itemsWithTrends,
            trendingUpCount: trendingUp.length,
            trendingDownCount: trendingDown.length
        },
        
        // Algorithm info
        algorithm: {
            name: 'Advanced Ensemble Trend Detection',
            version: '2.0',
            methods: ['Mann-Kendall', 'Theil-Sen', 'Holt-Winters', 'CUSUM', 'Piecewise Linear'],
            config: {
                shortTermWindow: config.shortTermWindow,
                mediumTermWindow: config.mediumTermWindow,
                longTermWindow: config.longTermWindow,
                ensembleWeights: config.ensembleWeights
            }
        }
    };
    
    console.log('📈 Advanced analysis complete:');
    console.log(`   Items analyzed: ${itemsAnalyzed}`);
    console.log(`   Items with usageRate: ${itemsWithUsageRate}`);
    console.log(`   Items with enough data: ${itemsWithEnoughData}`);
    console.log(`   Items with significant trends: ${itemsWithTrends}`);
    console.log(`   ✓ Trending up: ${trendingUp.length} (confidence ≥ ${confidenceThreshold.toFixed(2)})`);
    console.log(`   ✓ Trending down: ${trendingDown.length} (confidence ≥ ${confidenceThreshold.toFixed(2)})`);
    
    // Log top 3 trending up items with details
    if (trendingUp.length > 0) {
        console.log('📊 Top trending up items:');
        trendingUp.slice(0, 3).forEach((item, i) => {
            console.log(`   ${i + 1}. ${item.description.substring(0, 40)}...`);
            console.log(`      Confidence: ${(item.confidence * 100).toFixed(1)}% (${item.confidenceLevel})`);
            console.log(`      Avg usage: ${item.avgWeeklyUsage.toFixed(1)}/wk`);
            if (typeof item.percentChange === 'number') {
                console.log(`      % change: ${item.percentChange.toFixed(1)}%`);
            }
            console.log(`      Direction: ${item.trendDirection}`);
        });
    }
    
    return result;
}

/**
 * Get confidence level text
 */
function getConfidenceLevel(confidence) {
    if (confidence >= 0.8) return ConfidenceLevel.VERY_HIGH;
    if (confidence >= 0.6) return ConfidenceLevel.HIGH;
    if (confidence >= 0.4) return ConfidenceLevel.MEDIUM;
    if (confidence >= 0.2) return ConfidenceLevel.LOW;
    return ConfidenceLevel.VERY_LOW;
}

/**
 * Estimate consecutive weeks for backward compatibility
 * Uses the old simple method to maintain compatibility with existing UI
 */
function estimateConsecutiveWeeks(data, direction) {
    if (data.length < 2) return 0;
    
    let consecutive = 0;
    for (let i = data.length - 1; i > 0; i--) {
        const current = data[i];
        const previous = data[i - 1];
        
        if (!current || !previous) break;
        
        if (direction === TrendDirection.INCREASING && current > previous) {
            consecutive++;
        } else if (direction === TrendDirection.DECREASING && current < previous) {
            consecutive++;
        } else {
            break;
        }
    }
    
    return consecutive;
}

/**
 * Wrapper function for backward compatibility with existing Dashboard code
 * This can replace the existing calculateTrendingItems() function
 */
function calculateTrendingItems() {
    if (!window.MOCK_DATA || !window.MOCK_DATA.items) {
        console.error('❌ MOCK_DATA not available');
        return null;
    }
    
    const threshold = parseInt(localStorage.getItem('consecutiveWeekThreshold') || '2');
    const result = calculateTrendingItemsAdvanced(MOCK_DATA.items, threshold);
    
    if (result) {
        // Store in MOCK_DATA for backward compatibility
        MOCK_DATA.trendingItems = result;
    }
    
    return result;
}

// Export for use in Dashboard
if (typeof window !== 'undefined') {
    window.calculateTrendingItemsAdvanced = calculateTrendingItemsAdvanced;
    window.getConfidenceLevel = getConfidenceLevel;
}
