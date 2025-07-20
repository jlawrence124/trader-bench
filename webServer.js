const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const alpaca = require('./src/alpacaService');
require('dotenv/config');

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

// ----- Utility Endpoints -----
app.get('/api/env-check', (req, res) => {
  const vars = [
    'APCA_API_KEY',
    'APCA_API_SECRET',
    'APCA_API_BASE_URL',
    'MCP_PORT',
    'AGENT_CMD',
    'MCP_SERVER_URL',
    'MODEL_NAME'
  ];
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
  process.env[name] = value;
  let env = '';
  if (fs.existsSync('.env')) env = fs.readFileSync('.env', 'utf8');
  const line = new RegExp(`^${name}=.*$`, 'm');
  if (line.test(env)) {
    env = env.replace(line, `${name}=${value}`);
  } else {
    env += `\n${name}=${value}`;
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
  benchmarkProcess.on('close', () => { benchmarkProcess = null; });
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

  // ----- server log -----
  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log')).sort();
    if (files.length) {
      const logPath = path.join(logsDir, files[files.length - 1]);
      const content = tailFile(logPath);
      const lines = content.split('\n').slice(-100).join('\n');
      output += '--- server log ---\n' + lines + '\n';
    }
  }

  // ----- agent log -----
  if (fs.existsSync(agentLogsDir)) {
    const dirs = fs.readdirSync(agentLogsDir).map(d => {
      const full = path.join(agentLogsDir, d);
      return { dir: d, time: fs.statSync(full).mtimeMs };
    }).sort((a, b) => b.time - a.time);
    if (dirs.length) {
      const agentLog = path.join(agentLogsDir, dirs[0].dir, 'agent.log');
      if (fs.existsSync(agentLog)) {
        const content = tailFile(agentLog);
        const lines = content.split('\n').slice(-100).join('\n');
        output += '\n--- agent log ---\n' + lines;
      }
    }
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

app.listen(PORT, () => {
  console.log(`Web server running on http://localhost:${PORT}`);
});
