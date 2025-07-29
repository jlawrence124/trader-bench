const fs = require('fs').promises;
const path = require('path');
const { format } = require('date-fns');
const { createWriteStream } = require('fs');

class Logger {
    constructor(logDir = 'logs') {
        this.logDir = logDir;
        this.logFile = path.join(
            logDir,
            `trading_${format(new Date(), 'yyyy-MM-dd')}.log`,
        );
        this.writeQueue = [];
        this.isWriting = false;
        this.writeStream = null;
        
        this.init();
    }

    async init() {
        try {
            // Ensure log directory exists
            await fs.mkdir(this.logDir, { recursive: true });
            // Create write stream for better performance
            this.writeStream = createWriteStream(this.logFile, { flags: 'a' });
        } catch (error) {
            console.error('Failed to initialize logger:', error);
        }
    }

    async processWriteQueue() {
        if (this.isWriting || this.writeQueue.length === 0) return;
        
        this.isWriting = true;
        while (this.writeQueue.length > 0) {
            const logLine = this.writeQueue.shift();
            if (this.writeStream) {
                this.writeStream.write(logLine);
            }
        }
        this.isWriting = false;
    }

    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...data,
        };

        const logLine = JSON.stringify(logEntry) + '\n';

        // Queue write instead of blocking
        this.writeQueue.push(logLine);
        setImmediate(() => this.processWriteQueue());

        // Also log to console for development
        console[level === 'error' ? 'error' : 'log'](
            `[${timestamp}] ${level.toUpperCase()}: ${message}`,
        );

        return logEntry;
    }

    info(message, data) {
        return this.log('info', message, data);
    }

    error(message, data) {
        if (data instanceof Error) {
            return this.log('error', message, {
                error: data.message,
                stack: data.stack,
            });
        }
        return this.log('error', message, data);
    }

    debug(message, data) {
        return this.log('debug', message, data);
    }

    warn(message, data) {
        return this.log('warn', message, data);
    }

    async close() {
        if (this.writeStream) {
            await new Promise((resolve) => {
                this.writeStream.end(resolve);
            });
        }
    }
}

module.exports = new Logger();
