
const schedulingService = require('./src/services/schedulingService');
const logger = require('./lib/logger');

// Initialize database
const database = require('./src/database/database');
database.initialize().catch(error => {
    logger.error('Failed to initialize database', { error: error.message });
});

// Configuration moved to schedulingService

// Functions moved to schedulingService

logger.info('Scheduler started. Waiting for the next trading window.');

// Initialize the scheduling service
schedulingService.initialize();

// Health check endpoint for monitoring
if (process.env.NODE_ENV !== 'test') {
    const express = require('express');
    const healthApp = express();
    const healthPort = process.env.SCHEDULER_HEALTH_PORT || 3001;
    
    healthApp.get('/health', (_, res) => {
        const status = schedulingService.getStatus();
        res.json({
            status: 'healthy',
            ...status
        });
    });
    
    healthApp.listen(healthPort, () => {
        logger.info(`Scheduler health check listening on port ${healthPort}`);
    });
}
