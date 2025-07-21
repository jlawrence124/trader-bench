const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const alpaca = require('./src/alpacaService');
const logger = require('./lib/logger');
require('dotenv/config');

// provide defaults so missing MCP vars don't block the UI
process.env.MCP_PORT = process.env.MCP_PORT || '4000';
process.env.MCP_SERVER_URL = process.env.MCP_SERVER_URL || `http://localhost:${process.env.MCP_PORT}/rpc`;

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

app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, 'frontend')));

const logsDir = path.join(__dirname, 'logs');
const agentLogsDir = path.join(__dirname, 'trading_agent', 'logs');
let benchmarkProcess = null;
let runStartTime = null;
let serverLogFile = null;
let agentLogFile = null;
let modelOutputFile = null;

// ----- Utility Endpoints -----
app.get('/api/env-check', (req, res) => {
  const vars = ['APCA_API_KEY', 'APCA_API_SECRET', 'AGENT_CMD'];
  const missing = vars.filter(v => !process.env[v]);
  const hasKeys = missing.length === 0;
  res.json({ hasKeys, missing });
});

app.get('/api/run-status', (req, res) => {
  res.json({ running: Boolean(benchmarkProcess) });
});

// List configured environment variables for debugging
app.get('/api/env-vars', (req, res) => {
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
    value: process.env[v.name] || '',
    secret: v.secret,
  }));

  res.json(values);
});

app.post('/api/set-env-var', (req, res) => {
  const { name, value, override } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  if (benchmarkProcess && !override) {
    return res.status(400).json({ error: 'Benchmark is running' });
  }
  let env = '';
  if (fs.existsSync('.env')) env = fs.readFileSync('.env', 'utf8');

  if (!value) {
    delete process.env[name];
    if (name === 'AGENT_CMD') delete process.env.MODEL_NAME;
    env = env.replace(new RegExp(`^${name}=.*\n?`, 'm'), '');
    if (name === 'AGENT_CMD') env = env.replace(/^MODEL_NAME=.*\n?/m, '');
    fs.writeFileSync('.env', env.trim() + '\n');
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
  res.json({ success: true });
});

app.post('/api/save-keys', (req, res) => {
  const { key, secret } = req.body || {};
  if (!key || !secret) {
    return res.status(400).json({ error: 'Missing key or secret' });
  }
  process.env.APCA_API_KEY = key;
  process.env.APCA_API_SECRET = secret;
  let env = '';
  if (fs.existsSync('.env')) env = fs.readFileSync('.env', 'utf8');
  env = env.replace(/APCA_API_KEY=.*/g, '').replace(/APCA_API_SECRET=.*/g, '');
  env += `\nAPCA_API_KEY=${key}\nAPCA_API_SECRET=${secret}\n`;
  fs.writeFileSync('.env', env.trim() + '\n');
  res.json({ success: true });
});

app.post('/api/start-benchmark', (req, res) => {
  if (benchmarkProcess) return res.json({ running: true });
  benchmarkProcess = spawn('node', ['startAll.js']);
  runStartTime = new Date();
  serverLogFile = path.join(
    logsDir,
    `trading_${runStartTime.toISOString().split('T')[0]}.log`
  );
  agentLogFile = null;
  benchmarkProcess.on('close', () => {
    benchmarkProcess = null;
    runStartTime = null;
    serverLogFile = null;
    agentLogFile = null;
  });
  modelOutputFile = null;
  res.json({ running: true });
});

app.get('/api/runs', (req, res) => {
  try {
    const runsPath = path.join(__dirname, 'data', 'runs.json');
    const data = JSON.parse(fs.readFileSync(runsPath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.json([]);
  }
});

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
    if (!runStartTime) return '';
    const lines = text.split('\n').filter((l) => l.trim());
    const filtered = lines.filter((l) => {
      try {
        const t = JSON.parse(l).timestamp;
        return !t || new Date(t) >= runStartTime;
      } catch {
        return false;
      }
    });
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

// Simple API endpoints
app.get('/api/account', async (req, res) => {
  try {
    const data = await alpaca.getAccountInfo();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/market/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const data = await alpaca.getMarketData(symbol);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/positions', async (req, res) => {
  try {
    const data = await alpaca.getPositions();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/buy-oklo', async (req, res) => {
  try {
    const result = await alpaca.submitOrder({
      symbol: 'OKLO',
      qty: 1,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/test-alpaca', async (req, res) => {
  logger.info('Testing Alpaca connection');
  try {
    await alpaca.getAccountInfo();
    logger.info('Alpaca connection successful');
    res.json({ ok: true });
  } catch (err) {
    logger.error('Alpaca connection failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  logger.info(`Web server running on http://localhost:${PORT}`);
});
