const express = require('express');
const alpacaService = require('./src/alpacaService');
const logger = require('./lib/logger');
require('dotenv/config');

const app = express();
app.use(express.json());

const PORT = process.env.MCP_PORT || 4000;

app.post('/rpc', async (req, res) => {
    const { id, method, params = [] } = req.body || {};
    let response = { id };

    try {
        if (!method) {
            throw new Error('Missing "method" field in request.');
        }

        logger.info('Processing request', { requestId: id, method });

        if (method === 'getCapabilities') {
            response.result = {
                functions: Object.keys(alpacaService),
                caveats: ['This environment does not support options trading at this time.'],
            };
        } else if (typeof alpacaService[method] === 'function') {
            response.result = await alpacaService[method](...params);
        } else {
            throw new Error(`Method "${method}" not found or is not a function in alpacaService.`);
        }
    } catch (error) {
        logger.error('Error processing request', { requestId: id, method, error: error.message });
        response.error = { message: error.message };
    }

    res.json(response);
});

app.listen(PORT, () => {
    logger.info(`MCP HTTP server listening on port ${PORT}`);
});
