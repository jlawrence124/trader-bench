const winston = require('winston');
const path = require('path');

function createAgentLogger(runId) {
    const logDir = path.join(__dirname, '..', 'logs', runId);

    return winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [
            new winston.transports.File({ filename: path.join(logDir, 'agent.log') }),
            new winston.transports.Console({
                format: winston.format.simple(),
                stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
            }),
        ],
    });
}

module.exports = createAgentLogger;
