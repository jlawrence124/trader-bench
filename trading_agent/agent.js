require('dotenv/config');
const fs = require('fs');
const path = require('path');
const MCPClient = require('../lib/shared/mcpClient');
const createAgentLogger = require('./lib/logger');

// --- Run Setup ---
const modelName = process.env.MODEL_NAME || 'default_agent';
const startDate = new Date().toISOString().split('T')[0];
const runId = `${modelName}_${startDate}`;
const logger = createAgentLogger(runId);
// -----------------

// Load the initial prompt to prime the model
const promptPath = process.env.AGENT_PROMPT_PATH || path.join(__dirname, 'prompt.txt');
let initialPrompt = '';
try {
    initialPrompt = fs.readFileSync(promptPath, 'utf8');
    logger.info(`Initial prompt loaded from ${promptPath}`);
    // Send the prompt to the underlying model/stdout before any trading logic
    console.log(initialPrompt);
} catch (err) {
    logger.warn(`Failed to load prompt file at ${promptPath}: ${err.message}`);
}

const mcpClient = new MCPClient(logger);

async function runTradingLogic() {
    logger.info("Agent activated. Starting trading logic...");

    try {
        // 1. Get capabilities to see what actions are possible
        logger.info("Fetching server capabilities...");
        const capabilities = await mcpClient.getCapabilities();
        logger.info("Available actions:", capabilities);

        // 2. Example: Get account information
        logger.info("\nFetching account info...");
        const accountInfo = await mcpClient.getAccountInfo();
        logger.info("Account Info:", accountInfo);

        // 3. Example: Get market data for a stock
        const symbol = 'AAPL';
        logger.info(`\nFetching market data for ${symbol}...`);
        const marketData = await mcpClient.getMarketData(symbol);
        logger.info(`Market Data for ${symbol}:`, marketData);

        // Example: Compare performance against the S&P 500 over the last week
        const end = new Date().toISOString().split('T')[0];
        const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];
        logger.info(`\nComparing portfolio performance to S&P 500 from ${start} to ${end}...`);
        const comparison = await mcpClient.compareWithSP500(start, end);
        logger.info('Performance vs S&P 500:', comparison);

        // =================================================================
        // TODO: Implement your trading strategy here.
        // You have 2 minutes from when the scheduler announces the window.
        // Use the capabilities above to submit, check, or cancel orders.
        // Example:
        // const orderDetails = {
        //     symbol: 'AAPL',
        //     qty: 1,
        //     side: 'buy',
        //     type: 'market',
        //     time_in_force: 'day'
        // };
        // const orderResult = await mcpClient.submitOrder(orderDetails);
        // logger.info("\nSubmitted order:", orderResult);
        // =================================================================

    } catch (error) {
        logger.error("An error occurred during trading logic:", { message: error.message, stack: error.stack });
    } finally {
        logger.info("\nAgent has finished its tasks.");
    }
}

runTradingLogic();
