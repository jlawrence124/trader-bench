const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const alpaca = require('./src/alpacaService');

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
  const hasKeys = Boolean(process.env.APCA_API_KEY && process.env.APCA_API_SECRET);
  res.json({ hasKeys });
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
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/api/run-log', (req, res) => {
  if (!fs.existsSync(logsDir)) return res.type('text/plain').send('');
  const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log')).sort();
  if (!files.length) return res.type('text/plain').send('');
  const logPath = path.join(logsDir, files[files.length - 1]);
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').slice(-100).join('\n');
  res.type('text/plain').send(lines);
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
