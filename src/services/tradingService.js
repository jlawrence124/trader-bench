const alpacaService = require('../alpacaService');
const logger = require('../../lib/logger');

class TradingService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 seconds
    }

    async getAccountInfo() {
        const cacheKey = 'account_info';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const account = await alpacaService.getAccountInfo();
            this.setCache(cacheKey, account, this.cacheTimeout);
            return account;
        } catch (error) {
            logger.error('Failed to fetch account info', { error: error.message });
            throw error;
        }
    }

    async getPositions() {
        const cacheKey = 'positions';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const positions = await alpacaService.getPositions();
            this.setCache(cacheKey, positions, this.cacheTimeout);
            return positions;
        } catch (error) {
            logger.error('Failed to fetch positions', { error: error.message });
            throw error;
        }
    }

    async getOrders(limit = 50, status = 'all') {
        const cacheKey = `orders_${limit}_${status}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const orders = await alpacaService.getOrders(limit, status);
            this.setCache(cacheKey, orders, 15000); // 15 seconds for orders
            return orders;
        } catch (error) {
            logger.error('Failed to fetch orders', { error: error.message });
            throw error;
        }
    }

    async getMarketData(symbol) {
        if (!symbol || typeof symbol !== 'string') {
            throw new Error('Invalid symbol provided');
        }

        const normalizedSymbol = symbol.toUpperCase();
        const cacheKey = `market_${normalizedSymbol}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const marketData = await alpacaService.getMarketData(normalizedSymbol);
            this.setCache(cacheKey, marketData, 5000); // 5 seconds for market data
            return marketData;
        } catch (error) {
            logger.error('Failed to fetch market data', { 
                symbol: normalizedSymbol, 
                error: error.message 
            });
            throw error;
        }
    }

    async submitOrder(orderDetails) {
        try {
            // Additional business logic validation
            await this.validateOrder(orderDetails);
            
            const result = await alpacaService.submitOrder(orderDetails);
            
            // Clear related caches
            this.clearCacheByPattern(/^(positions|orders|account_info)/);
            
            logger.info('Order submitted successfully', { 
                orderId: result.id,
                symbol: orderDetails.symbol,
                side: orderDetails.side,
                qty: orderDetails.qty
            });
            
            return result;
        } catch (error) {
            logger.error('Failed to submit order', { 
                orderDetails,
                error: error.message 
            });
            throw error;
        }
    }

    async cancelOrder(orderId) {
        try {
            const result = await alpacaService.cancelOrder(orderId);
            
            // Clear related caches
            this.clearCacheByPattern(/^orders/);
            
            logger.info('Order canceled successfully', { orderId });
            return result;
        } catch (error) {
            logger.error('Failed to cancel order', { 
                orderId,
                error: error.message 
            });
            throw error;
        }
    }

    async cancelAllOrders() {
        try {
            const result = await alpacaService.cancelAllOrders();
            
            // Clear related caches
            this.clearCacheByPattern(/^orders/);
            
            logger.info('All orders canceled successfully');
            return result;
        } catch (error) {
            logger.error('Failed to cancel all orders', { error: error.message });
            throw error;
        }
    }

    async closeAllPositions() {
        try {
            const result = await alpacaService.closeAllPositions();
            
            // Clear related caches
            this.clearCacheByPattern(/^(positions|account_info)/);
            
            logger.info('All positions closed successfully');
            return result;
        } catch (error) {
            logger.error('Failed to close all positions', { error: error.message });
            throw error;
        }
    }

    async validateOrder(orderDetails) {
        // Get current account info for validation
        const account = await this.getAccountInfo();
        
        if (account.trading_blocked) {
            throw new Error('Trading is currently blocked for this account');
        }

        // Check buying power for buy orders
        if (orderDetails.side === 'buy') {
            const estimatedCost = this.estimateOrderCost(orderDetails);
            if (estimatedCost > parseFloat(account.buying_power)) {
                throw new Error('Insufficient buying power for this order');
            }
        }

        // Check position exists for sell orders
        if (orderDetails.side === 'sell') {
            const positions = await this.getPositions();
            const position = positions.find(p => p.symbol === orderDetails.symbol);
            
            if (!position || Math.abs(parseFloat(position.qty)) < orderDetails.qty) {
                throw new Error('Insufficient shares to sell');
            }
        }
    }

    estimateOrderCost(orderDetails) {
        // Simple estimation - in reality would need current market price
        // For limit orders, use limit price; for market orders, add buffer
        if (orderDetails.type === 'limit' && orderDetails.limit_price) {
            return orderDetails.qty * orderDetails.limit_price;
        }
        
        // Conservative estimate for market orders
        return orderDetails.qty * 1000; // Assume $1000 per share max
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

    setCache(key, data, ttl) {
        this.cache.set(key, {
            data,
            expires: Date.now() + ttl
        });
    }

    clearCacheByPattern(pattern) {
        for (const key of this.cache.keys()) {
            if (pattern.test(key)) {
                this.cache.delete(key);
            }
        }
    }

    clearAllCache() {
        this.cache.clear();
    }
}

module.exports = new TradingService();