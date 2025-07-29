const alpacaService = require('../alpacaService');
const { appendRun } = require('../../lib/runLogger');
const logger = require('../../lib/logger');

class BenchmarkService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute for benchmark data
    }

    async recordRunResults({ modelName, runId, startTime, endTime }) {
        try {
            logger.info('Recording run results', { runId, modelName });

            const [comparison, history, spyBars] = await Promise.all([
                this.getPerformanceComparison(startTime, endTime),
                this.getPortfolioHistory(startTime, endTime),
                this.getSpyHistory(startTime, endTime)
            ]);

            const runData = {
                model: modelName,
                runId,
                startDate: startTime.toISOString(),
                endDate: endTime.toISOString(),
                spyGain: comparison.spyGain || 0,
                portfolioGain: comparison.accountGain || 0,
                equityHistory: history.equity || history || [],
                spyHistory: spyBars,
            };

            appendRun(runData);
            logger.info('Run results recorded successfully', { runId });
            
            return runData;
        } catch (error) {
            logger.error('Failed to record run results', { 
                runId, 
                error: error.message,
                stack: error.stack 
            });
            throw error;
        }
    }

    async getPerformanceComparison(startTime, endTime) {
        const cacheKey = `comparison_${startTime.toISOString()}_${endTime.toISOString()}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const comparison = await alpacaService.compareWithSP500(
                startTime.toISOString().split('T')[0],
                endTime.toISOString().split('T')[0]
            );

            this.setCache(cacheKey, comparison);
            return comparison;
        } catch (error) {
            logger.warn('Failed to get performance comparison, using fallback', { 
                error: error.message 
            });
            
            // Return fallback data
            return {
                spyGain: 0,
                accountGain: 0,
                relativeGain: 0
            };
        }
    }

    async getPortfolioHistory(startTime, endTime) {
        const cacheKey = `portfolio_${startTime.toISOString()}_${endTime.toISOString()}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const history = await alpacaService.getPortfolioHistory(
                startTime.toISOString(),
                endTime.toISOString(),
                '1Min'
            );

            this.setCache(cacheKey, history);
            return history;
        } catch (error) {
            logger.warn('Failed to get portfolio history, using fallback', { 
                error: error.message 
            });
            
            // Return fallback data
            return {
                equity: [100000], // Default starting equity
                timestamp: [startTime.toISOString()]
            };
        }
    }

    async getSpyHistory(startTime, endTime) {
        const cacheKey = `spy_${startTime.toISOString()}_${endTime.toISOString()}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const spyBars = await alpacaService.getHistoricalBars(
                'SPY',
                '1Min',
                startTime.toISOString(),
                endTime.toISOString()
            );

            const bars = spyBars.bars || spyBars;
            const spyHistory = Array.isArray(bars)
                ? bars.map(b => parseFloat(b.c ?? b.close ?? b.o))
                : [];

            this.setCache(cacheKey, spyHistory);
            return spyHistory;
        } catch (error) {
            logger.warn('Failed to get SPY history, using fallback', { 
                error: error.message 
            });
            
            // Return fallback data (flat line)
            return [400]; // Approximate SPY price
        }
    }

    async getRunsSummary() {
        // This would typically come from a database
        // For now, we'll read from the file system
        try {
            const { readRuns } = require('../../lib/runLogger');
            const runs = await readRuns();
            
            return {
                totalRuns: runs.length,
                successfulRuns: runs.filter(r => r.portfolioGain !== undefined).length,
                averageGain: this.calculateAverageGain(runs),
                bestRun: this.getBestRun(runs),
                worstRun: this.getWorstRun(runs),
                lastRun: runs[runs.length - 1] || null
            };
        } catch (error) {
            logger.error('Failed to get runs summary', { error: error.message });
            return {
                totalRuns: 0,
                successfulRuns: 0,
                averageGain: 0,
                bestRun: null,
                worstRun: null,
                lastRun: null
            };
        }
    }

    calculateAverageGain(runs) {
        const validRuns = runs.filter(r => r.portfolioGain !== undefined);
        if (validRuns.length === 0) return 0;
        
        const totalGain = validRuns.reduce((sum, run) => sum + run.portfolioGain, 0);
        return totalGain / validRuns.length;
    }

    getBestRun(runs) {
        const validRuns = runs.filter(r => r.portfolioGain !== undefined);
        if (validRuns.length === 0) return null;
        
        return validRuns.reduce((best, run) => 
            run.portfolioGain > (best?.portfolioGain || -Infinity) ? run : best
        );
    }

    getWorstRun(runs) {
        const validRuns = runs.filter(r => r.portfolioGain !== undefined);
        if (validRuns.length === 0) return null;
        
        return validRuns.reduce((worst, run) => 
            run.portfolioGain < (worst?.portfolioGain || Infinity) ? run : worst
        );
    }

    getCached(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() > cached.expires) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    setCache(key, data, ttl = this.cacheTimeout) {
        this.cache.set(key, {
            data,
            expires: Date.now() + ttl
        });
    }

    clearCache() {
        this.cache.clear();
    }
}

module.exports = new BenchmarkService();