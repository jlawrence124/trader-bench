const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const alpaca = require('./src/alpacaService');
const logger = require('./lib/logger');
const apiController = require('./src/controllers/apiController');
const {
    apiLimiter,
    tradingLimiter,
    envUpdateLimiter,
    securityHeaders,
    sanitizeInput,
    validateEnvVarAccess,
    validateTradingOperation,
    handleRateLimitError
} = require('./src/middleware/security');
require('dotenv/config');

// Provide defaults so missing MCP vars don't block the UI
process.env.MCP_PORT = process.env.MCP_PORT || '4000';
process.env.MCP_SERVER_URL = process.env.MCP_SERVER_URL || `http://localhost:${process.env.MCP_PORT}/rpc`;

// Security configuration
const ALLOWED_ENV_VARS = [
    'APCA_API_KEY',
    'APCA_API_SECRET', 
    'APCA_API_BASE_URL',
    'MCP_PORT',
    'AGENT_CMD',
    'MCP_SERVER_URL',
    'MODEL_NAME',
    'AGENT_STARTUP_DELAY'
];

function tailFile(filePath, maxBytes = 65536) {
  const { size } = fs.statSync(filePath);
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(securityHeaders);
app.use(compression());
app.use(handleRateLimitError);

// Body parsing with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization
app.use(sanitizeInput);

// Serve static frontend with proper headers
app.use(express.static(path.join(__dirname, 'frontend'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000');
        }
    }
}));

const logsDir = path.join(__dirname, 'logs');
const agentLogsDir = path.join(__dirname, 'trading_agent', 'logs');
let benchmarkProcess = null;
let runStartTime = null;
let serverLogFile = null;
let agentLogFile = null;
let modelOutputFile = null;
let manualAgentProcess = null;

// Resource cleanup
const activeProcesses = new Set();
let isShuttingDown = false;

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// ----- Utility Endpoints -----
app.get('/api/env-check', (req, res) => {
  try {
    const vars = ['APCA_API_KEY', 'APCA_API_SECRET', 'AGENT_CMD'];
    const missing = vars.filter(v => !process.env[v]);
    const hasKeys = missing.length === 0;
    res.json({ hasKeys, missing });
  } catch (error) {
    logger.error('Error checking environment variables', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/run-status', (req, res) => {
  try {
    res.json({ 
      running: Boolean(benchmarkProcess),
      processes: activeProcesses.size,
      uptime: process.uptime()
    });
  } catch (error) {
    logger.error('Error getting run status', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List configured environment variables for debugging (with security)
app.get('/api/env-vars', (req, res) => {
  try {
    const vars = [
      { name: 'APCA_API_KEY', secret: true },
      { name: 'APCA_API_SECRET', secret: true },
      { name: 'APCA_API_BASE_URL', secret: false },
      { name: 'MCP_PORT', secret: false },
      { name: 'AGENT_CMD', secret: false },
      { name: 'MCP_SERVER_URL', secret: false },
      { name: 'MODEL_NAME', secret: false },
    ];

    const values = vars.map(v => ({
      name: v.name,
      value: v.secret ? (process.env[v.name] ? '***SET***' : '') : (process.env[v.name] || ''),
      secret: v.secret,
      hasValue: Boolean(process.env[v.name])
    }));

    res.json(values);
  } catch (error) {
    logger.error('Error getting environment variables', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/set-env-var', envUpdateLimiter, validateEnvVarAccess, (req, res) => {
  try {
    const { name, value, override } = req.body || {};
    
    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }
    
    if (!ALLOWED_ENV_VARS.includes(name)) {
      logger.warn('Unauthorized environment variable access attempt', { name, ip: req.ip });
      return res.status(403).json({ error: 'Access to this environment variable is not allowed' });
    }
    
    if (benchmarkProcess && !override) {
      return res.status(400).json({ error: 'Benchmark is running' });
    }
    
    // Validate value length and content
    if (value && value.length > 1000) {
      return res.status(400).json({ error: 'Value too long' });
    }
    
    let env = '';
    if (fs.existsSync('.env')) {
      env = fs.readFileSync('.env', 'utf8');
    }

    if (!value) {
      delete process.env[name];
      if (name === 'AGENT_CMD') delete process.env.MODEL_NAME;
      env = env.replace(new RegExp(`^${name}=.*\n?`, 'm'), '');
      if (name === 'AGENT_CMD') env = env.replace(/^MODEL_NAME=.*\n?/m, '');
      fs.writeFileSync('.env', env.trim() + '\n');
      logger.info('Environment variable cleared', { name });
      return res.json({ success: true });
    }

    process.env[name] = value;
    if (name === 'AGENT_CMD' && !process.env.MODEL_NAME) {
      const model = value.split(/\s+/)[0].toLowerCase();
      process.env.MODEL_NAME = model;
    }

    const line = new RegExp(`^${name}=.*$`, 'm');
    if (line.test(env)) {
      env = env.replace(line, `${name}=${value}`);
    } else {
      env += `\n${name}=${value}`;
    }
    
    if (name === 'AGENT_CMD') {
      const model = process.env.MODEL_NAME;
      if (/MODEL_NAME=/.test(env)) {
        env = env.replace(/^MODEL_NAME=.*$/m, `MODEL_NAME=${model}`);
      } else {
        env += `\nMODEL_NAME=${model}`;
      }
    }
    
    fs.writeFileSync('.env', env.trim() + '\n');
    logger.info('Environment variable updated', { name });
    res.json({ success: true });
  } catch (error) {
    logger.error('Error setting environment variable', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/save-keys', envUpdateLimiter, (req, res) => {
  try {
    const { key, secret } = req.body || {};
    
    if (!key || !secret) {
      return res.status(400).json({ error: 'Missing key or secret' });
    }
    
    // Basic validation for API key format
    if (key.length < 10 || secret.length < 10) {
      return res.status(400).json({ error: 'Invalid key or secret format' });
    }
    
    process.env.APCA_API_KEY = key;
    process.env.APCA_API_SECRET = secret;
    
    let env = '';
    if (fs.existsSync('.env')) {
      env = fs.readFileSync('.env', 'utf8');
    }
    
    env = env.replace(/APCA_API_KEY=.*/g, '').replace(/APCA_API_SECRET=.*/g, '');
    env += `\nAPCA_API_KEY=${key}\nAPCA_API_SECRET=${secret}\n`;
    fs.writeFileSync('.env', env.trim() + '\n');
    
    logger.info('API keys updated');
    res.json({ success: true });
  } catch (error) {
    logger.error('Error saving API keys', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/start-benchmark', (req, res) => {
  try {
    if (benchmarkProcess) {
      return res.json({ running: true, message: 'Benchmark already running' });
    }
    
    if (isShuttingDown) {
      return res.status(503).json({ error: 'Server is shutting down' });
    }
    
    benchmarkProcess = spawn('node', ['startAll.js'], {
      stdio: 'inherit',
      detached: false
    });
    
    activeProcesses.add(benchmarkProcess);
    
    runStartTime = new Date();
    serverLogFile = path.join(
      logsDir,
      `trading_${runStartTime.toISOString().split('T')[0]}.log`
    );
    agentLogFile = null;
    modelOutputFile = null;
    
    benchmarkProcess.on('error', (error) => {
      logger.error('Benchmark process error', { error: error.message });
      activeProcesses.delete(benchmarkProcess);
      benchmarkProcess = null;
    });
    
    benchmarkProcess.on('close', (code, signal) => {
      logger.info('Benchmark process closed', { code, signal });
      activeProcesses.delete(benchmarkProcess);
      benchmarkProcess = null;
      runStartTime = null;
      serverLogFile = null;
      agentLogFile = null;
    });
    
    logger.info('Benchmark process started');
    res.json({ running: true, message: 'Benchmark started successfully' });
  } catch (error) {
    logger.error('Failed to start benchmark', { error: error.message });
    res.status(500).json({ error: 'Failed to start benchmark' });
  }
});

app.post('/api/run-agent', (req, res) => {
  try {
    if (manualAgentProcess) {
      return res.status(400).json({ error: 'Agent already running' });
    }
    
    if (isShuttingDown) {
      return res.status(503).json({ error: 'Server is shutting down' });
    }
    
    const cmdStr = process.env.AGENT_CMD || `node ${path.join(__dirname, 'trading_agent', 'agent.js')}`;
    const promptArg = req.body?.prompt;

    // Validate prompt input
    if (promptArg && promptArg.length > 5000) {
      return res.status(400).json({ error: 'Prompt too long' });
    }

    const { parse } = require('shell-quote');
    const parts = parse(cmdStr);
    const cmd = parts[0];
    let args = parts.slice(1);
    
    if (promptArg) {
      const baseCmd = path.basename(cmd);
      if (/^gemini/i.test(baseCmd)) {
        args.push('-p', promptArg);
      } else if (/^codex/i.test(baseCmd)) {
        args.push('--full-auto', `"${promptArg}"`);
      } else if (/^claude/i.test(baseCmd)) {
        args.push(`-p "${promptArg}"`);
      } else if (/^opencode/i.test(baseCmd)) {
        args.unshift('run', '-q');
        args.push(`"${promptArg}"`);
      } else {
        args.push(promptArg);
      }
    }
    
    const mcpUrl = process.env.MCP_SERVER_URL || `http://localhost:${process.env.MCP_PORT || 4000}/rpc`;
    
    manualAgentProcess = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, MCP_SERVER_URL: mcpUrl },
      detached: false
    });
    
    activeProcesses.add(manualAgentProcess);
    
    // Set timeout for manual agent (10 minutes max)
    const agentTimeout = setTimeout(() => {
      if (manualAgentProcess && !manualAgentProcess.killed) {
        logger.warn('Manual agent process timeout, killing');
        manualAgentProcess.kill('SIGTERM');
      }
    }, 10 * 60 * 1000);
    
    manualAgentProcess.on('error', (error) => {
      logger.error('Manual agent process error', { error: error.message });
      clearTimeout(agentTimeout);
      activeProcesses.delete(manualAgentProcess);
      manualAgentProcess = null;
    });
    
    manualAgentProcess.on('close', (code, signal) => {
      logger.info('Manual agent process closed', { code, signal });
      clearTimeout(agentTimeout);
      activeProcesses.delete(manualAgentProcess);
      manualAgentProcess = null;
    });
    
    logger.info('Manual agent started', { cmd, promptLength: promptArg?.length || 0 });
    res.json({ started: true, message: 'Agent started successfully' });
  } catch (error) {
    logger.error('Failed to start agent', { error: error.message });
    res.status(500).json({ error: 'Failed to start agent' });
  }
});

// Moved to apiController.getRuns above

app.get('/api/logs', (req, res) => {
  const files = [];
  if (fs.existsSync(logsDir)) {
    fs.readdirSync(logsDir).forEach(f => files.push(f));
  }
  if (fs.existsSync(agentLogsDir)) {
    fs.readdirSync(agentLogsDir).forEach(dir => {
      const p = path.join(agentLogsDir, dir, 'agent.log');
      if (fs.existsSync(p)) files.push(`agent/${dir}/agent.log`);
      const m = path.join(agentLogsDir, dir, 'model_output.log');
      if (fs.existsSync(m)) files.push(`agent/${dir}/model_output.log`);
    });
  }
  res.json(files);
});

app.get('/api/logs/:name(*)', (req, res) => {
  const name = req.params.name;
  let filePath = path.join(logsDir, name);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(agentLogsDir, name);
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  const content = tailFile(filePath, 200000);
  res.type('text/plain').send(content);
});

app.get('/api/run-log', (req, res) => {
  let output = '';

  if (!serverLogFile && fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('trading_') && f.endsWith('.log'))
      .map(f => ({ file: path.join(logsDir, f), time: fs.statSync(path.join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length) serverLogFile = files[0].file;
  }

  if (!agentLogFile && fs.existsSync(agentLogsDir)) {
    const dirs = fs.readdirSync(agentLogsDir)
      .map(d => ({ dir: d, time: fs.statSync(path.join(agentLogsDir, d)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (dirs.length) {
      const p = path.join(agentLogsDir, dirs[0].dir, 'agent.log');
      if (fs.existsSync(p)) agentLogFile = p;
      const mo = path.join(agentLogsDir, dirs[0].dir, 'model_output.log');
      if (fs.existsSync(mo)) modelOutputFile = mo;
    }
  }

  const filterLog = (text) => {
    const lines = text.split('\n').filter((l) => l.trim());
    let filtered = lines;
    if (runStartTime) {
      filtered = lines.filter((l) => {
        try {
          const t = JSON.parse(l).timestamp;
          return !t || new Date(t) >= runStartTime;
        } catch {
          return false;
        }
      });
    }
    return filtered.slice(-100).join('\n');
  };

  // ----- server log -----
  if (serverLogFile && fs.existsSync(serverLogFile)) {
    const content = tailFile(serverLogFile);
    const lines = filterLog(content);
    if (lines) output += '--- server log ---\n' + lines + '\n';
  }

  // ----- agent log -----
  if (agentLogFile && fs.existsSync(agentLogFile)) {
    const content = tailFile(agentLogFile);
    const lines = filterLog(content);
    if (lines) output += '\n--- agent log ---\n' + lines;
  }

  if (modelOutputFile && fs.existsSync(modelOutputFile)) {
    const content = tailFile(modelOutputFile);
    if (content.trim()) output += '\n--- model output ---\n' + content.trim();
  }

  res.type('text/plain').send(output);
});

// API routes using the controller pattern
app.get('/api/account', apiController.getAccount.bind(apiController));
app.get('/api/market/:symbol', apiController.getMarketData.bind(apiController));
app.get('/api/orders', apiController.getOrders.bind(apiController));
app.get('/api/positions', apiController.getPositions.bind(apiController));

// Trading endpoints with validation
app.post('/api/submit-order', tradingLimiter, validateTradingOperation, apiController.submitOrder.bind(apiController));
app.delete('/api/orders/:orderId', tradingLimiter, apiController.cancelOrder.bind(apiController));
app.delete('/api/orders', tradingLimiter, apiController.cancelAllOrders.bind(apiController));
app.delete('/api/positions', tradingLimiter, apiController.closeAllPositions.bind(apiController));

// Quick trading actions (for testing) - with rate limits
app.post('/api/buy-oklo', tradingLimiter, apiController.buyOklo.bind(apiController));
app.post('/api/sell-oklo', tradingLimiter, apiController.sellOklo.bind(apiController));
app.post('/api/reset-paper', tradingLimiter, apiController.resetPaperAccount.bind(apiController));

// Health check
app.get('/api/test-alpaca', apiController.testConnection.bind(apiController));

// Benchmark endpoints
app.get('/api/runs', apiController.getRuns.bind(apiController));
app.get('/api/runs/summary', apiController.getRunsSummary.bind(apiController));

// Add global error handler - define it inline since we're using singleton pattern
app.use((error, req, res, _) => {
    logger.error('Web Server Error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        body: req.body,
        query: req.query
    });

    // Don't leak error details in production
    const message = process.env.NODE_ENV === 'production' 
        ? 'An error occurred' 
        : error.message;

    res.status(error.status || 500).json({
        error: message,
        timestamp: new Date().toISOString()
    });
});

// Cleanup function
async function cleanup() {
  logger.info('Cleaning up web server resources');
  isShuttingDown = true;
  
  // Kill all active processes
  const processPromises = Array.from(activeProcesses).map(proc => {
    return new Promise((resolve) => {
      if (proc && !proc.killed) {
        proc.on('close', resolve);
        proc.kill('SIGTERM');
        
        // Force kill after 5 seconds
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      } else {
        resolve();
      }
    });
  });
  
  await Promise.all(processPromises);
  activeProcesses.clear();
  
  // Close database connection
  const database = require('./src/database/database');
  await database.close();
  
  // Close logger
  const loggerInstance = require('./lib/logger');
  if (loggerInstance.close) {
    await loggerInstance.close();
  }
  
  logger.info('Web server cleanup complete');
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
  logger.info(`Web server running on http://localhost:${PORT}`);
});

// Set server timeout
server.timeout = 30000; // 30 seconds

// Handle server errors
server.on('error', (error) => {
  logger.error('Server error', { error: error.message });
});

module.exports = { app, server, cleanup };
