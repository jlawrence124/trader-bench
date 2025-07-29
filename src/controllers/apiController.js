const tradingService = require('../services/tradingService');
const benchmarkService = require('../services/benchmarkService');
const logger = require('../../lib/logger');

class ApiController {
    // Account endpoints
    async getAccount(req, res) {
        try {
            const account = await tradingService.getAccountInfo();
            res.json(account);
        } catch (error) {
            logger.error('Failed to get account info', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    async getPositions(req, res) {
        try {
            const positions = await tradingService.getPositions();
            res.json(positions);
        } catch (error) {
            logger.error('Failed to get positions', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    async getOrders(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const status = req.query.status || 'all';
            const orders = await tradingService.getOrders(limit, status);
            res.json(orders);
        } catch (error) {
            logger.error('Failed to get orders', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    // Market data endpoints
    async getMarketData(req, res) {
        try {
            const { symbol } = req.params;
            if (!symbol) {
                return res.status(400).json({ error: 'Symbol is required' });
            }

            const marketData = await tradingService.getMarketData(symbol.toUpperCase());
            res.json(marketData);
        } catch (error) {
            logger.error('Failed to get market data', { 
                symbol: req.params.symbol,
                error: error.message 
            });
            res.status(500).json({ error: error.message });
        }
    }

    // Trading endpoints
    async submitOrder(req, res) {
        try {
            const orderDetails = req.body;
            const result = await tradingService.submitOrder(orderDetails);
            res.json(result);
        } catch (error) {
            logger.error('Failed to submit order', { 
                orderDetails: req.body,
                error: error.message 
            });
            res.status(500).json({ error: error.message });
        }
    }

    async cancelOrder(req, res) {
        try {
            const { orderId } = req.params;
            if (!orderId) {
                return res.status(400).json({ error: 'Order ID is required' });
            }

            const result = await tradingService.cancelOrder(orderId);
            res.json(result);
        } catch (error) {
            logger.error('Failed to cancel order', { 
                orderId: req.params.orderId,
                error: error.message 
            });
            res.status(500).json({ error: error.message });
        }
    }

    async cancelAllOrders(req, res) {
        try {
            const result = await tradingService.cancelAllOrders();
            res.json(result);
        } catch (error) {
            logger.error('Failed to cancel all orders', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    async closeAllPositions(req, res) {
        try {
            const result = await tradingService.closeAllPositions();
            res.json(result);
        } catch (error) {
            logger.error('Failed to close all positions', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    // Quick trading actions (for testing)
    async buyOklo(req, res) {
        try {
            const result = await tradingService.submitOrder({
                symbol: 'OKLO',
                qty: 1,
                side: 'buy',
                type: 'market',
                time_in_force: 'day',
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to buy OKLO', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    async sellOklo(req, res) {
        try {
            const result = await tradingService.submitOrder({
                symbol: 'OKLO',
                qty: 1,
                side: 'sell',
                type: 'market',
                time_in_force: 'day',
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to sell OKLO', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    async resetPaperAccount(req, res) {
        try {
            await tradingService.cancelAllOrders();
            const result = await tradingService.closeAllPositions();
            
            // Clear service caches
            tradingService.clearAllCache();
            
            res.json(result);
        } catch (error) {
            logger.error('Failed to reset paper account', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    // Health check
    async testConnection(req, res) {
        try {
            // Test basic connectivity by getting account info
            await tradingService.getAccountInfo();
            res.json({ ok: true, message: 'Connection successful' });
        } catch (error) {
            logger.error('Connection test failed', { error: error.message });
            res.status(500).json({ 
                ok: false, 
                error: error.message 
            });
        }
    }

    // Benchmark endpoints
    async getRuns(req, res) {
        try {
            const { readRuns } = require('../../lib/runLogger');
            const runs = await readRuns();
            res.json(runs);
        } catch (error) {
            logger.error('Failed to get runs', { error: error.message });
            res.json([]);
        }
    }

    async getRunsSummary(req, res) {
        try {
            const summary = await benchmarkService.getRunsSummary();
            res.json(summary);
        } catch (error) {
            logger.error('Failed to get runs summary', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }

    // Error handler middleware
    static errorHandler(error, req, res, next) {
        logger.error('API Controller Error', {
            error: error.message,
            stack: error.stack,
            url: req.url,
            method: req.method,
            body: req.body,
            query: req.query
        });

        // Don't leak error details in production
        const message = process.env.NODE_ENV === 'production' 
            ? 'An error occurred' 
            : error.message;

        res.status(error.status || 500).json({
            error: message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = new ApiController();