require('dotenv').config();

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
 * Fetches performance metrics. (Placeholder)
 * @returns {Promise<object>} - A promise resolving to performance metrics.
 */
async function getPerformanceMetrics() {
    console.log('Fetching performance metrics... (Placeholder)');
    // Replace with actual API call to get performance metrics
    try {
        // Example: const response = await api.get('/v2/account/activities'); // Example endpoint
        return { daily_profit_loss: 500, total_equity: 150000 }; // Example placeholder
    } catch (error) {
        console.error('Error fetching performance metrics:', error);
        throw error;
    }
}

module.exports = {
    getMarketData,
    submitOrder,
    cancelOrder,
    getPositions,
    getAccountInfo,
    getHistoricalBars,
    getPerformanceMetrics,
};
