const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const MCPClient = require('../lib/shared/mcpClient');
const createAgentLogger = require('./lib/logger');

require('dotenv').config({
    path: path.join(__dirname, '..', '.env'),
    override: true,
    quiet: true,
});

// --- Run Setup ---
const modelName = process.env.MODEL_NAME || 'default_agent';
const startDate = new Date().toISOString().split('T')[0];
const runId = process.env.RUN_ID || `${modelName}_${startDate}`;
const logger = createAgentLogger(runId);

const logDir = path.join(__dirname, 'logs', runId);
const tradesFile = path.join(logDir, 'trades.json');
const modelOutputFile = path.join(logDir, 'model_output.log');

if (!fsSync.existsSync(logDir)) {
    fsSync.mkdirSync(logDir, { recursive: true });
}

let tradeQueue = [];
let outputQueue = [];
let isProcessing = false;

async function processTrades() {
    if (isProcessing || tradeQueue.length === 0) return;
    isProcessing = true;
    
    while (tradeQueue.length > 0) {
        const entry = tradeQueue.shift();
        try {
            let arr = [];
            try {
                const data = await fs.readFile(tradesFile, 'utf8');
                arr = JSON.parse(data);
            } catch {}
            
            arr.push(entry);
            await fs.writeFile(tradesFile, JSON.stringify(arr, null, 2));
        } catch (error) {
            console.error('Failed to write trade:', error);
        }
    }
    isProcessing = false;
}

async function processOutput() {
    if (outputQueue.length === 0) return;
    
    const texts = outputQueue.splice(0);
    try {
        await fs.appendFile(modelOutputFile, texts.join('\n') + '\n');
    } catch (error) {
        console.error('Failed to write model output:', error);
    }
}

function appendTrade(entry) {
    tradeQueue.push(entry);
    setImmediate(() => processTrades());
}

function logModelOutput(text) {
    outputQueue.push(text);
    setImmediate(() => processOutput());
}
// -----------------

// Load the initial prompt to prime the model
let initialPrompt = '';
let promptPath = process.env.AGENT_PROMPT_PATH;

async function loadPrompt() {
    if (promptPath) {
        try {
            initialPrompt = await fs.readFile(promptPath, 'utf8');
            logger.info(`Initial prompt loaded from ${promptPath}`);
            return;
        } catch (err) {
            logger.warn(`Failed to load prompt file at ${promptPath}: ${err.message}. Falling back to AGENTS.md`);
        }
    }

    try {
        const agentsMdPath = path.join(__dirname, '..', 'AGENTS.md');
        initialPrompt = await fs.readFile(agentsMdPath, 'utf8');
        logger.info(`Initial prompt loaded from ${agentsMdPath}`);
    } catch (err) {
        logger.warn(`Failed to load prompt file at AGENTS.md: ${err.message}`);
    }
}

// Load prompt asynchronously
loadPrompt().then(() => {
    if (initialPrompt) {
        logModelOutput(initialPrompt);
    }
});


const mcpClient = new MCPClient(logger);

const client = new Proxy(mcpClient, {
    get(target, prop) {
        const value = target[prop];
        if (typeof value === 'function') {
            return async (...args) => {
                let result, error;
                try {
                    result = await value.apply(target, args);
                    return result;
                } catch (err) {
                    error = err.message;
                    throw err;
                } finally {
                    appendTrade({
                        timestamp: new Date().toISOString(),
                        method: prop,
                        params: args,
                        result,
                        error,
                    });
                }
            };
        }
        return value;
    }
});

async function runTradingLogic() {
    logger.info("Agent activated. Starting trading logic...");
    logModelOutput('Agent started');

    try {
        // 1. Get capabilities to see what actions are possible
        logger.info("Fetching server capabilities...");
        const capabilities = await client.getCapabilities();
        logger.info("Available actions:", capabilities);

        // 2. Example: Get account information
        logger.info("\nFetching account info...");
        const accountInfo = await client.getAccountInfo();
        logger.info("Account Info:", accountInfo);

        // 3. Example: Get market data for a stock
        const symbol = 'AAPL';
        logger.info(`\nFetching market data for ${symbol}...`);
        const marketData = await client.getMarketData(symbol);
        logger.info(`Market Data for ${symbol}:`, marketData);

        // Example: Compare performance against the S&P 500 over the last week
        const end = new Date().toISOString().split('T')[0];
        const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];
        logger.info(`\nComparing portfolio performance to S&P 500 from ${start} to ${end}...`);
        const comparison = await client.compareWithSP500(start, end);
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
        // const orderResult = await client.submitOrder(orderDetails);
        // logger.info("\nSubmitted order:", orderResult);
        // =================================================================

    } catch (error) {
        logger.error("An error occurred during trading logic:", { message: error.message, stack: error.stack });
    } finally {
        logger.info("\nAgent has finished its tasks.");
        logModelOutput('Agent finished');
    }
}

runTradingLogic();
