const path = require('path');
require('dotenv').config({
    path: path.join(__dirname, '..', '.env'),
    override: true,
    quiet: true,
});

// Constants
const TRADING_API_URL = process.env.APCA_API_BASE_URL || 'https://paper-api.alpaca.markets';
const MARKET_DATA_API_URL = 'https://data.alpaca.markets/v2';

// Configure axios instances
const tradingApi = require('axios').create({
    baseURL: TRADING_API_URL,
    headers: {
        'APCA-API-KEY-ID': process.env.APCA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET,
    },
    timeout: 10000, // 10 second timeout
});

const marketDataApi = require('axios').create({
    baseURL: MARKET_DATA_API_URL,
    headers: {
        'APCA-API-KEY-ID': process.env.APCA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET,
    },
    timeout: 10000, // 10 second timeout
});

/**
 * Get the latest quote for a symbol
 * @param {string} symbol - The stock symbol to fetch data for
 * @returns {Promise<object>} - Latest quote data
 */
async function getMarketData(symbol) {
    try {
        const response = await marketDataApi.get(`/stocks/${symbol}/quotes/latest`, {
            timeout: 5000, // Shorter timeout for market data
            params: {
                feed: 'iex' // Use IEX feed for real-time data
            }
        });
        
        const quote = response.data.quote;
        // Ensure timestamp is a valid Date object
        if (quote.timestamp) {
            quote.timestamp = new Date(quote.timestamp);
        }
        
        return {
            symbol: symbol,
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
        const requiredFields = ['symbol', 'qty', 'side', 'type', 'time_in_force'];
        const missingFields = requiredFields.filter(field => !(field in orderDetails));
        
        if (missingFields.length > 0) {
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        const response = await tradingApi.post('/v2/orders', orderDetails);
        return response.data;
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
    try {
        const response = await tradingApi.delete(`/v2/orders/${orderId}`);
        return response.data;
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
        const response = await tradingApi.delete('/v2/orders');
        return response.data;
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
        const response = await tradingApi.delete('/v2/positions');
        return response.data;
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
        const response = await tradingApi.get('/v2/positions');
        return response.data;
    } catch (error) {
        const errorMessage = error.response 
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        
        console.error('Error fetching positions:', errorMessage);
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
        const response = await tradingApi.get('/v2/orders', {
            params: {
                limit,
                status,
                direction: 'desc',
            },
        });
        return response.data;
    } catch (error) {
        const errorMessage = error.response
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;

        console.error('Error fetching orders:', errorMessage);
        throw new Error(`Failed to fetch orders: ${errorMessage}`);
    }
}

/**
 * Get account information
 * @returns {Promise<object>} - Account details
 */
async function getAccountInfo() {
    try {
        const response = await tradingApi.get('/v2/account');
        return response.data;
    } catch (error) {
        const errorMessage = error.response 
            ? `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
            : `Network Error: ${error.message}`;
        
        console.error('Error fetching account info:', errorMessage);
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
