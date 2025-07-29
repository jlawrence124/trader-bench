const path = require('path');
const CircuitBreaker = require('opossum');
require('dotenv').config({
    path: path.join(__dirname, '..', '.env'),
    override: true,
    quiet: true,
});

// Constants
const TRADING_API_URL = process.env.APCA_API_BASE_URL || 'https://paper-api.alpaca.markets';
const MARKET_DATA_API_URL = 'https://data.alpaca.markets/v2';

// Configure axios instances with retry logic
const axios = require('axios');

const axiosConfig = {
    timeout: 10000,
    retry: 3,
    retryDelay: (retryCount) => Math.min(1000 * Math.pow(2, retryCount), 10000)
};

// Add retry interceptor
function setupRetryInterceptor(axiosInstance) {
    if (!axiosInstance || !axiosInstance.interceptors) {
        console.warn('Invalid axios instance provided to setupRetryInterceptor');
        return;
    }
    
    axiosInstance.interceptors.response.use(
        (response) => response,
        async (error) => {
            const config = error.config;
            if (!config || !config.retry) return Promise.reject(error);
            
            config.__retryCount = config.__retryCount || 0;
            
            if (config.__retryCount >= config.retry) {
                return Promise.reject(error);
            }
            
            config.__retryCount += 1;
            
            const delay = config.retryDelay ? config.retryDelay(config.__retryCount) : 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            return axiosInstance(config);
        }
    );
}

const tradingApi = axios.create({
    baseURL: TRADING_API_URL,
    headers: {
        'APCA-API-KEY-ID': process.env.APCA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET,
    },
    ...axiosConfig
});

const marketDataApi = axios.create({
    baseURL: MARKET_DATA_API_URL,
    headers: {
        'APCA-API-KEY-ID': process.env.APCA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET,
    },
    ...axiosConfig
});

setupRetryInterceptor(tradingApi);
setupRetryInterceptor(marketDataApi);

// Circuit breaker options
const circuitBreakerOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    fallback: () => { throw new Error('Service temporarily unavailable'); }
};

// Create circuit breakers for critical operations
const marketDataBreaker = new CircuitBreaker(async (symbol) => {
    const response = await marketDataApi.get(`/stocks/${symbol}/quotes/latest`, {
        params: { feed: 'iex' }
    });
    return response.data;
}, circuitBreakerOptions);

const tradingBreaker = new CircuitBreaker(async (endpoint, data, method = 'get') => {
    const response = await tradingApi[method](endpoint, data);
    return response.data;
}, circuitBreakerOptions);

// Add circuit breaker event logging
marketDataBreaker.on('open', () => console.warn('Market data circuit breaker opened'));
marketDataBreaker.on('halfOpen', () => console.warn('Market data circuit breaker half-open'));
marketDataBreaker.on('close', () => console.info('Market data circuit breaker closed'));

tradingBreaker.on('open', () => console.warn('Trading circuit breaker opened'));
tradingBreaker.on('halfOpen', () => console.warn('Trading circuit breaker half-open'));
tradingBreaker.on('close', () => console.info('Trading circuit breaker closed'));

/**
 * Get the latest quote for a symbol
 * @param {string} symbol - The stock symbol to fetch data for
 * @returns {Promise<object>} - Latest quote data
 */
async function getMarketData(symbol) {
    if (!symbol || typeof symbol !== 'string') {
        throw new Error('Invalid symbol provided');
    }
    
    try {
        const data = await marketDataBreaker.fire(symbol.toUpperCase());
        const quote = data.quote;
        
        if (!quote) {
            throw new Error(`No quote data available for ${symbol}`);
        }
        
        // Ensure timestamp is a valid Date object
        if (quote.timestamp) {
            quote.timestamp = new Date(quote.timestamp);
        }
        
        return {
            symbol: symbol.toUpperCase(),
            bid: parseFloat(quote.bp) || 0,
            ask: parseFloat(quote.ap) || 0,
            bidSize: parseInt(quote.bs) || 0,
            askSize: parseInt(quote.as) || 0,
            timestamp: quote.timestamp || new Date()
        };
    } catch (error) {
        const errorMessage = error.response 
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        
        console.error(`Error fetching market data for ${symbol}:`, errorMessage);
        
        // Return cached/fallback data if available
        if (error.message.includes('temporarily unavailable')) {
            return {
                symbol: symbol.toUpperCase(),
                bid: 0,
                ask: 0,
                bidSize: 0,
                askSize: 0,
                timestamp: new Date(),
                cached: true,
                error: 'Service temporarily unavailable'
            };
        }
        
        throw new Error(`Failed to fetch market data: ${errorMessage}`);
    }
}

/**
 * Submit a new order
 * @param {object} orderDetails - Order parameters
 * @returns {Promise<object>} - Order confirmation
 */
async function submitOrder(orderDetails) {
    try {
        // Validate order details
        const requiredFields = ['symbol', 'qty', 'side', 'type', 'time_in_force'];
        const missingFields = requiredFields.filter(field => !(field in orderDetails));
        
        if (missingFields.length > 0) {
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }
        
        // Additional validation
        if (orderDetails.qty <= 0) {
            throw new Error('Order quantity must be positive');
        }
        
        if (!['buy', 'sell'].includes(orderDetails.side)) {
            throw new Error('Order side must be buy or sell');
        }
        
        if (!['market', 'limit', 'stop', 'stop_limit'].includes(orderDetails.type)) {
            throw new Error('Invalid order type');
        }
        
        // Sanitize symbol
        const sanitizedOrder = {
            ...orderDetails,
            symbol: orderDetails.symbol.toUpperCase(),
            qty: parseFloat(orderDetails.qty)
        };

        const result = await tradingBreaker.fire('/v2/orders', sanitizedOrder, 'post');
        console.info(`Order submitted: ${sanitizedOrder.side} ${sanitizedOrder.qty} ${sanitizedOrder.symbol}`);
        return result;
    } catch (error) {
        const errorMessage = error.response 
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        
        console.error('Error submitting order:', errorMessage);
        throw new Error(`Order submission failed: ${errorMessage}`);
    }
}

/**
 * Cancel an order
 * @param {string} orderId - ID of the order to cancel
 * @returns {Promise<object>} - Cancellation status
 */
async function cancelOrder(orderId) {
    if (!orderId) {
        throw new Error('Order ID is required');
    }
    
    try {
        const result = await tradingBreaker.fire(`/v2/orders/${orderId}`, null, 'delete');
        console.info(`Order canceled: ${orderId}`);
        return result;
    } catch (error) {
        const errorMessage = error.response 
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        
        console.error(`Error canceling order ${orderId}:`, errorMessage);
        throw new Error(`Failed to cancel order: ${errorMessage}`);
    }
}

/**
 * Cancel all open orders
 * @returns {Promise<object>} - Result of cancellation
 */
async function cancelAllOrders() {
    try {
        const result = await tradingBreaker.fire('/v2/orders', null, 'delete');
        console.info('All orders canceled');
        return result;
    } catch (error) {
        const errorMessage = error.response
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;

        console.error('Error canceling all orders:', errorMessage);
        throw new Error(`Failed to cancel orders: ${errorMessage}`);
    }
}

/**
 * Close all open positions
 * @returns {Promise<object>} - Result of liquidation
 */
async function closeAllPositions() {
    try {
        const result = await tradingBreaker.fire('/v2/positions', null, 'delete');
        console.info('All positions closed');
        return result;
    } catch (error) {
        const errorMessage = error.response
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;

        console.error('Error closing all positions:', errorMessage);
        throw new Error(`Failed to close positions: ${errorMessage}`);
    }
}

/**
 * Get current positions
 * @returns {Promise<Array>} - Array of current positions
 */
async function getPositions() {
    try {
        const result = await tradingBreaker.fire('/v2/positions');
        return result || [];
    } catch (error) {
        const errorMessage = error.response 
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        
        console.error('Error fetching positions:', errorMessage);
        
        // Return empty array if service unavailable
        if (error.message.includes('temporarily unavailable')) {
            return [];
        }
        
        throw new Error(`Failed to fetch positions: ${errorMessage}`);
    }
}

/**
 * Get recent orders
 * @param {number} limit - Maximum number of orders to fetch
 * @param {string} status - Order status filter
 * @returns {Promise<Array>} - Array of orders
 */
async function getOrders(limit = 50, status = 'all') {
    try {
        const result = await tradingBreaker.fire('/v2/orders', {
            params: {
                limit: Math.min(Math.max(1, limit), 500), // Clamp limit
                status,
                direction: 'desc',
            },
        });
        return result || [];
    } catch (error) {
        const errorMessage = error.response
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;

        console.error('Error fetching orders:', errorMessage);
        
        // Return empty array if service unavailable
        if (error.message.includes('temporarily unavailable')) {
            return [];
        }
        
        throw new Error(`Failed to fetch orders: ${errorMessage}`);
    }
}

/**
 * Get account information
 * @returns {Promise<object>} - Account details
 */
async function getAccountInfo() {
    try {
        const result = await tradingBreaker.fire('/v2/account');
        return result;
    } catch (error) {
        const errorMessage = error.response 
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        
        console.error('Error fetching account info:', errorMessage);
        
        // Return basic fallback account info
        if (error.message.includes('temporarily unavailable')) {
            return {
                equity: '100000',
                cash: '100000',
                buying_power: '100000',
                account_blocked: false,
                trading_blocked: false,
                cached: true,
                error: 'Service temporarily unavailable'
            };
        }
        
        throw new Error(`Failed to fetch account info: ${errorMessage}`);
    }
}

/**
 * Get portfolio equity history
 * @param {string} start - Start time (ISO 8601)
 * @param {string} end - End time (ISO 8601)
 * @param {string} [timeframe='1Min'] - Bar timeframe
 * @returns {Promise<object>} Portfolio history data
 */
async function getPortfolioHistory(start, end, timeframe = '1Min') {
    try {
        const response = await tradingApi.get('/v2/account/portfolio/history', {
            params: { start, end, timeframe },
        });
        return response.data;
    } catch (error) {
        const errorMessage = error.response
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        console.error('Error fetching portfolio history:', errorMessage);
        throw new Error(`Failed to fetch portfolio history: ${errorMessage}`);
    }
}

/**
 * Get historical market data
 * @param {string} symbol - Stock symbol
 * @param {string} timeframe - Bar timeframe (e.g., '1D', '1H', '15Min')
 * @param {string} start - Start time (ISO 8601)
 * @param {string} end - End time (ISO 8601)
 * @returns {Promise<object>} - Historical bar data
 */
async function getHistoricalBars(symbol, timeframe, start, end) {
    console.log(
        `Fetching historical bars for ${symbol} (${timeframe}) from ${start} to ${end}...`,
    );
    try {
        const response = await marketDataApi.get(`/v2/stocks/${symbol}/bars`, {
            params: {
                timeframe,
                start,
                end,
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching historical bars:', error);
        throw error;
    }
}


/**
 * Compare account performance against the S&P 500 (using SPY ETF data).
 * @param {string} start - Start date in ISO 8601 format (YYYY-MM-DD)
 * @param {string} end - End date in ISO 8601 format (YYYY-MM-DD)
 * @returns {Promise<object>} Performance comparison results
 */
async function compareWithSP500(start, end) {
    // Fetch portfolio equity history for the given period
    const portfolioRes = await tradingApi.get('/v2/account/portfolio/history', {
        params: { start, end, timeframe: '1Day' }
    });

    const equity = portfolioRes.data.equity || [];
    if (equity.length < 2) {
        throw new Error('Insufficient portfolio history data');
    }

    const startEquity = parseFloat(equity[0]);
    const endEquity = parseFloat(equity[equity.length - 1]);
    const accountGain = endEquity - startEquity;

    // Fetch SPY price history to approximate S&P 500 performance
    const spyRes = await getHistoricalBars('SPY', '1Day', start, end);
    const bars = spyRes.bars || spyRes;
    if (!Array.isArray(bars) || bars.length < 2) {
        throw new Error('Insufficient SPY data');
    }

    const openPrice = parseFloat(bars[0].c ?? bars[0].close ?? bars[0].o);
    const closePrice = parseFloat(bars[bars.length - 1].c ?? bars[bars.length - 1].close ?? bars[bars.length - 1].o);
    const spyReturnPct = (closePrice - openPrice) / openPrice;
    const spyGain = spyReturnPct * startEquity;

    return {
        startEquity,
        endEquity,
        accountGain,
        spyGain,
        relativeGain: accountGain - spyGain
    };
}

module.exports = {
    getMarketData,
    submitOrder,
    cancelOrder,
    cancelAllOrders,
    closeAllPositions,
    getPositions,
    getOrders,
    getAccountInfo,
    getPortfolioHistory,
    getHistoricalBars,
    compareWithSP500,
};
