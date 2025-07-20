const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

class Logger {
    constructor(logDir = 'logs') {
        this.logDir = logDir;
        this.logFile = path.join(
            logDir,
            `trading_${format(new Date(), 'yyyy-MM-dd')}.log`,
        );

        // Ensure log directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
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

        // Write to file
        fs.appendFileSync(this.logFile, logLine, 'utf8');

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
}

module.exports = new Logger();
