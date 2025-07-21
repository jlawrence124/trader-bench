const { spawn } = require('child_process');
const path = require('path');
const alpacaService = require('./src/alpacaService');
const logger = require('./lib/logger');

const agentPath = process.env.AGENT_PATH ||
    path.join(__dirname, 'trading_agent', 'agent.js');

logger.info('MCP Server starting...');

const agent = spawn('node', [agentPath]);

let requestBuffer = '';

// Listen for requests from the agent's stdout
agent.stdout.on('data', (data) => {
    requestBuffer += data.toString();
    processRequestBuffer();
});

// Handle stderr from the agent
agent.stderr.on('data', (data) => {
    const text = data.toString().trim();
    const match = text.match(/^(\w+):\s*/);
    let level = 'info';
    let message = text;
    if (match) {
        level = match[1].toLowerCase();
        message = text.slice(match[0].length);
    }
    if (typeof logger[level] === 'function') {
        logger[level](`Agent ${message}`);
    } else {
        logger.info(`Agent ${message}`);
    }
});

// Handle agent exit
agent.on('close', (code) => {
    logger.info(`Agent process exited with code ${code}`);
});

agent.on('error', (err) => {
    logger.error('Failed to start agent process.', err);
});

function processRequestBuffer() {
    let newlineIndex;
    while ((newlineIndex = requestBuffer.indexOf('\n')) !== -1) {
        const completeRequest = requestBuffer.substring(0, newlineIndex);
        requestBuffer = requestBuffer.substring(newlineIndex + 1);

        try {
            const request = JSON.parse(completeRequest);
            handleRequest(request);
        } catch (err) {
            logger.error('Error parsing request from agent', {
                error: err.message,
                request: completeRequest,
            });
            sendResponse({
                id: null,
                error: { message: 'Invalid JSON request' },
            });
        }
    }
}

async function handleRequest(request) {
    const { id, method, params = [] } = request;
    let response = { id };

    try {
        if (!method) {
            throw new Error('Missing "method" field in request.');
        }

        logger.info('Processing request', { requestId: id, method });

        if (method === 'getCapabilities') {
            response.result = {
                functions: Object.keys(alpacaService),
                caveats: [
                    'This environment does not support options trading at this time.',
                ],
            };
        } else if (typeof alpacaService[method] === 'function') {
            response.result = await alpacaService[method](...params);
        } else {
            throw new Error(`Method "${method}" not found or is not a function in alpacaService.`);
        }
    } catch (error) {
        logger.error('Error processing request', {
            requestId: id,
            method,
            error: error.message,
        });
        response.error = { message: error.message, stack: error.stack };
    }

    sendResponse(response);
}

function sendResponse(response) {
    const responseString = JSON.stringify(response);
    agent.stdin.write(responseString + '\n');
    logger.debug('Sent response to agent', { responseId: response.id });
}

logger.info('MCP Server is running and connected to the agent via stdio.');
