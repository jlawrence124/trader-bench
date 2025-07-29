const express = require('express');
const compression = require('compression');
const alpacaService = require('./src/alpacaService');
const tradingService = require('./src/services/tradingService');
const logger = require('./lib/logger');
const { apiLimiter, securityHeaders, sanitizeInput } = require('./src/middleware/security');
require('dotenv/config');

// Initialize database
const database = require('./src/database/database');
database.initialize().catch(error => {
    logger.error('Failed to initialize database', { error: error.message });
});

const app = express();

// Security middleware
app.use(securityHeaders);
app.use(compression());
app.use(apiLimiter);

// Body parsing with limits
app.use(express.json({ limit: '1mb' }));
app.use(sanitizeInput);

const PORT = process.env.MCP_PORT || 4000;

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('MCP request completed', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration,
            requestId: req.body?.id
        });
    });
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// Main RPC endpoint
app.post('/rpc', async (req, res) => {
    const { id, method, params = [] } = req.body || {};
    let response = { id };
    const startTime = Date.now();

    try {
        if (!method) {
            throw new Error('Missing "method" field in request.');
        }

        logger.info('Processing MCP request', { requestId: id, method, paramsLength: params.length });

        // Route methods through appropriate services
        if (method === 'getCapabilities') {
            response.result = {
                functions: [
                    'getCapabilities',
                    'getMarketData',
                    'submitOrder', 
                    'cancelOrder',
                    'getPositions',
                    'getAccountInfo',
                    'getHistoricalBars',
                    'compareWithSP500',
                    'getOrders',
                    'cancelAllOrders',
                    'closeAllPositions'
                ],
                caveats: [
                    'This environment does not support options trading at this time.',
                    'All trades are executed on paper trading accounts only.',
                    'Rate limiting is applied to prevent abuse.'
                ],
                version: '1.0.0'
            };
        } else if (typeof tradingService[method] === 'function') {
            // Use trading service for better caching and validation
            response.result = await tradingService[method](...params);
        } else if (typeof alpacaService[method] === 'function') {
            // Fallback to direct alpaca service
            response.result = await alpacaService[method](...params);
        } else {
            throw new Error(`Method "${method}" not found or is not available.`);
        }

        const duration = Date.now() - startTime;
        logger.info('MCP request completed successfully', { 
            requestId: id, 
            method, 
            duration 
        });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Error processing MCP request', { 
            requestId: id, 
            method, 
            error: error.message,
            duration,
            stack: error.stack
        });
        
        response.error = { 
            message: error.message,
            code: error.code || 'INTERNAL_ERROR'
        };
    }

    res.json(response);
});

// Error handling middleware
app.use((error, req, res, next) => {
    logger.error('MCP server error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method
    });
    
    res.status(500).json({
        error: {
            message: 'Internal server error',
            code: 'INTERNAL_ERROR'
        }
    });
});

// Cleanup function
let isShuttingDown = false;

async function cleanup() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info('Cleaning up MCP server resources');
    
    // Close database connection
    await database.close();
    
    // Close logger
    const loggerInstance = require('./lib/logger');
    if (loggerInstance.close) {
        await loggerInstance.close();
    }
    
    logger.info('MCP server cleanup complete');
}

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    await cleanup();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully');
    await cleanup();
    process.exit(0);
});

process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    await cleanup();
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
    await cleanup();
    process.exit(1);
});

const server = app.listen(PORT, () => {
    logger.info(`MCP HTTP server listening on port ${PORT}`);
});

// Set server timeout
server.timeout = 30000; // 30 seconds

// Handle server errors
server.on('error', (error) => {
    logger.error('MCP server error', { error: error.message });
});

module.exports = { app, server, cleanup };
