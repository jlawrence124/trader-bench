// lib/shared/mcpClient.js
const { v4: uuidv4 } = require('uuid');
const defaultLogger = require('../logger');

class MCPClient {
    constructor(logger = defaultLogger) {
        this.logger = logger;
        this.responseCallbacks = {};
        this.responseBuffer = '';
        this.requestCount = 0;

        this.logger.info('MCP Client initializing...');

        // Set up listeners for data on stdin (from the MCP server's stdout)
        process.stdin.on('data', (data) => {
            this.responseBuffer += data.toString();
            this.processBuffer();
        });

        process.stdin.on('end', () => {
            this.logger.info('MCP server input stream ended');
        });

        // Log any errors from stdin
        process.stdin.on('error', (err) => {
            this.logger.error('MCP client stdin error', err);
        });

        this.logger.info('MCP Client initialized and ready for requests');
    }

    // Convenience wrappers for supported RPC calls
    getCapabilities() {
        return this.sendRequest('getCapabilities');
    }

    getMarketData(symbol) {
        return this.sendRequest('getMarketData', [symbol]);
    }

    submitOrder(orderDetails) {
        return this.sendRequest('submitOrder', [orderDetails]);
    }

    cancelOrder(orderId) {
        return this.sendRequest('cancelOrder', [orderId]);
    }

    getPositions() {
        return this.sendRequest('getPositions');
    }

    getAccountInfo() {
        return this.sendRequest('getAccountInfo');
    }

    getHistoricalBars(symbol, timeframe, start, end) {
        return this.sendRequest('getHistoricalBars', [symbol, timeframe, start, end]);
    }

    getPerformanceMetrics() {
        return this.sendRequest('getPerformanceMetrics');
    }

    // Process the incoming data buffer
    processBuffer() {
        let newlineIndex;
        while ((newlineIndex = this.responseBuffer.indexOf('\n')) !== -1) {
            const completeResponse = this.responseBuffer.substring(0, newlineIndex);
            this.responseBuffer = this.responseBuffer.substring(newlineIndex + 1);

            try {
                const response = JSON.parse(completeResponse);
                this.logger.debug('Received MCP response', { 
                    responseId: response.id,
                    method: response.method || 'response',
                    response: this.sanitizeResponse(response)
                });
                this.handleResponse(response);
            } catch (err) {
                this.logger.error('Error parsing MCP response', {
                    error: err.message,
                    response: completeResponse
                });
            }
        }
    }

    // Handle a parsed JSON response
    handleResponse(response) {
        const { id, result, error } = response;

        if (id && this.responseCallbacks[id]) {
            const callback = this.responseCallbacks[id];
            delete this.responseCallbacks[id];

            if (error) {
                this.logger.error('MCP request failed', {
                    requestId: id,
                    error: error.message || error
                });
                callback(error);
            } else {
                this.logger.debug('MCP request completed successfully', {
                    requestId: id,
                    result: result ? 'success' : 'empty'
                });
                callback(null, result);
            }
        } else if (id) {
            this.logger.warn('Received response for unknown request ID', { 
                requestId: id,
                response: this.sanitizeResponse(response)
            });
        } else {
            this.logger.warn('Received malformed response', {
                response: this.sanitizeResponse(response)
            });
        }
    }

    // Sanitize response data for logging
    sanitizeResponse(response) {
        const sanitized = { ...response };
        // Redact sensitive data from responses
        if (sanitized.result?.account_number) {
            sanitized.result.account_number = '***REDACTED***';
        }
        return sanitized;
    }

    // Sanitize parameters for logging
    sanitizeParams(method, params) {
        // Redact sensitive parameters
        if (method.toLowerCase().includes('auth') || method.toLowerCase().includes('key')) {
            return params.map(p => (typeof p === 'string' ? '***REDACTED***' : p));
        }
        return params;
    }

    // Send a request to the MCP server
    sendRequest(method, params = []) {
        const id = uuidv4();
        const request = { id, method, params };
        this.requestCount++;

        return new Promise((resolve, reject) => {
            // Set timeout for the request
            const timeout = setTimeout(() => {
                if (this.responseCallbacks[id]) {
                    const error = new Error(`Request ${id} timed out after 30000ms`);
                    this.logger.error('Request timeout', {
                        requestId: id,
                        method,
                        params: this.sanitizeParams(method, params)
                    });
                    delete this.responseCallbacks[id];
                    reject(error);
                }
            }, 30000); // 30 second timeout

            // Store the callback for this request ID
            this.responseCallbacks[id] = (error, result) => {
                clearTimeout(timeout);
                if (error) {
                    this.logger.error('Request callback error', {
                        requestId: id,
                        method,
                        error: error.message || error,
                        params: this.sanitizeParams(method, params)
                    });
                    reject(error);
                } else {
                    this.logger.info('Request completed', {
                        requestId: id,
                        method,
                        params: this.sanitizeParams(method, params)
                    });
                    resolve(result);
                }
            };

            const requestString = JSON.stringify(request);
            this.logger.debug('Sending MCP request', {
                requestId: id,
                method,
                params: this.sanitizeParams(method, params)
            });
            
            process.stdout.write(requestString + '\n');
        });
    }
}

module.exports = MCPClient;
