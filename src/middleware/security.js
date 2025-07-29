const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Rate limiting configurations
const createRateLimit = (windowMs, max, message) => 
    rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
    });

// General API rate limiting
const apiLimiter = createRateLimit(
    15 * 60 * 1000, // 15 minutes
    100, // limit each IP to 100 requests per windowMs
    'Too many requests from this IP, please try again later'
);

// Strict rate limiting for trading operations
const tradingLimiter = createRateLimit(
    1 * 60 * 1000, // 1 minute
    10, // limit each IP to 10 trading requests per minute
    'Too many trading requests, please slow down'
);

// Environment variable update limiting
const envUpdateLimiter = createRateLimit(
    5 * 60 * 1000, // 5 minutes
    5, // limit each IP to 5 environment updates per 5 minutes
    'Too many environment updates, please wait before trying again'
);

// Basic security headers
const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false // Disable for React dev tools
});

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
    // Remove null bytes and normalize strings
    const sanitizeString = (str) => {
        if (typeof str !== 'string') return str;
        return str.replace(/\0/g, '').trim();
    };

    const sanitizeObject = (obj) => {
        if (typeof obj !== 'object' || obj === null) return obj;
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                sanitized[key] = sanitizeString(value);
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    };

    // Sanitize request body
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
        req.query = sanitizeObject(req.query);
    }

    next();
};

// Environment variable validation
const validateEnvVarAccess = (req, res, next) => {
    const { name, value } = req.body || {};
    
    // Whitelist of allowed environment variables
    const allowedVars = [
        'APCA_API_KEY',
        'APCA_API_SECRET',
        'APCA_API_BASE_URL',
        'MCP_PORT',
        'AGENT_CMD',
        'MCP_SERVER_URL',
        'MODEL_NAME',
        'AGENT_STARTUP_DELAY'
    ];

    if (name && !allowedVars.includes(name)) {
        return res.status(403).json({ 
            error: 'Access to this environment variable is not allowed' 
        });
    }

    // Validate value length
    if (value && value.length > 1000) {
        return res.status(400).json({ 
            error: 'Environment variable value too long' 
        });
    }

    next();
};

// Trading operation validation
const validateTradingOperation = (req, res, next) => {
    const { symbol, qty, side, type } = req.body || {};

    // Basic validation for trading parameters
    if (symbol && !/^[A-Z]{1,5}$/.test(symbol)) {
        return res.status(400).json({ 
            error: 'Invalid symbol format' 
        });
    }

    if (qty && (isNaN(qty) || qty <= 0 || qty > 10000)) {
        return res.status(400).json({ 
            error: 'Invalid quantity - must be positive number under 10,000' 
        });
    }

    if (side && !['buy', 'sell'].includes(side)) {
        return res.status(400).json({ 
            error: 'Invalid side - must be buy or sell' 
        });
    }

    if (type && !['market', 'limit', 'stop', 'stop_limit'].includes(type)) {
        return res.status(400).json({ 
            error: 'Invalid order type' 
        });
    }

    next();
};

// Log security events
const logSecurityEvent = (event, req, additionalData = {}) => {
    const logger = require('../../lib/logger');
    logger.warn('Security event', {
        event,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method,
        ...additionalData
    });
};

// Error handling for rate limits
const handleRateLimitError = (req, res, next) => {
    res.on('finish', () => {
        if (res.statusCode === 429) {
            logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
                rateLimit: res.get('X-RateLimit-Limit'),
                remaining: res.get('X-RateLimit-Remaining')
            });
        }
    });
    next();
};

module.exports = {
    apiLimiter,
    tradingLimiter,
    envUpdateLimiter,
    securityHeaders,
    sanitizeInput,
    validateEnvVarAccess,
    validateTradingOperation,
    handleRateLimitError,
    logSecurityEvent
};