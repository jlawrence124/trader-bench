// Load env and ensure file values override any pre-set env vars
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { createClient, getAccount, getPositions, getLatestPrice } = require('./alpaca');
const { addSseClient, logEvent, readRecentLogs, DATA_DIR } = require('./log');
const { parseWindowsFromEnv, scheduleToday, setOverrides, openAdhocWindow, clearAdhocWindow } = require('./scheduler');
const { cumulativeReturn, maxDrawdown, sharpe } = require('./metrics');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Shared state
let alpaca;
function getAlpaca() {
  if (!alpaca) alpaca = createClient();
  return alpaca;
}

// Data files
const EQUITY_FILE = path.join(DATA_DIR, 'equity.jsonl');
const BENCH_FILE = path.join(DATA_DIR, 'benchmark.jsonl');
const SCRATCH_FILE = path.join(DATA_DIR, 'scratchpad.jsonl');
const BENCH_SYMBOL = process.env.BENCHMARK_SYMBOL || 'SPY';

function appendJsonl(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); } catch {}
}

function readSeries(file, limit = 2000) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const slice = lines.slice(Math.max(0, lines.length - limit));
  return slice.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function readJsonl(file, limit = 500) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const slice = lines.slice(Math.max(0, lines.length - limit));
  return slice.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function toDate(ts) { return new Date(ts).getTime(); }

function buildNormalizedSeries() {
  const equity = readSeries(EQUITY_FILE);
  const bench = readSeries(BENCH_FILE);

  // If we have no benchmark yet, we can't build a normalized SPY series
  if (!bench.length) {
    return {
      startEquity: equity[0]?.value ?? null,
      spyStartPrice: null,
      equity,
      spyUSD: [],
    };
  }

  // Determine a reasonable starting equity for normalization
  // Prefer the first observed equity sample; otherwise fall back to configured or default 100k
  const configuredStart = Number(process.env.START_EQUITY || process.env.DEFAULT_START_EQUITY || 100000);
  const startEquity = equity.length ? Number(equity[0].value) : configuredStart;

  // Align SPY samples to the equity start time if present; otherwise, start from first SPY sample
  const t0 = equity.length ? toDate(equity[0].ts) : toDate(bench[0].ts);
  let i0 = 0;
  for (let i = 0; i < bench.length; i++) { if (toDate(bench[i].ts) >= t0) { i0 = i; break; } }
  const spyStartPrice = bench[i0]?.value ?? bench[0].value;
  const spyUSD = bench.slice(i0).map(p => ({ ts: p.ts, value: startEquity * (p.value / spyStartPrice) }));

  return { startEquity, spyStartPrice, equity, spyUSD };
}

// SSE stream
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('\n');
  addSseClient(res);
});

// APIs
app.get('/api/account', async (req, res) => {
  try {
    const a = await getAccount(getAlpaca());
    res.json(a);
  } catch (e) {
    // Graceful fallback when Alpaca is forbidden/misconfigured
    const equity = readSeries(EQUITY_FILE);
    const last = equity[equity.length - 1];
    const fallback = {
      id: null,
      status: 'unavailable',
      cash: null,
      equity: last?.value ?? null,
      buyingPower: null,
      portfolioValue: last?.value ?? null,
      error: String(e.message || e),
    };
    logEvent('account.fetch.error', { error: fallback.error });
    res.json(fallback);
  }
});

app.get('/api/positions', async (req, res) => {
  try {
    const p = await getPositions(getAlpaca());
    res.json(p);
  } catch (e) {
    logEvent('positions.fetch.error', { error: String(e.message || e) });
    // Return empty list on error so UI renders
    res.json([]);
  }
});

app.get('/api/logs', (req, res) => {
  res.json(readRecentLogs());
});

app.get('/api/equity', (req, res) => {
  res.json(readSeries(EQUITY_FILE));
});

app.get('/api/benchmark', (req, res) => {
  res.json(readSeries(BENCH_FILE));
});

app.get('/api/metrics', (req, res) => {
  const equity = readSeries(EQUITY_FILE);
  const bench = readSeries(BENCH_FILE);
  let equityRet = 0, benchRet = 0;
  if (equity.length >= 2) equityRet = (equity[equity.length-1].value / equity[0].value) - 1;
  if (bench.length >= 2) benchRet = (bench[bench.length-1].value / bench[0].value) - 1;
  const m = {
    equityReturn: equityRet,
    benchReturn: benchRet,
    alpha: equityRet - benchRet,
    maxDrawdown: maxDrawdown(equity),
    sharpe: sharpe(equity),
  };
  res.json(m);
});

// Normalized USD series for charting (SPY scaled to starting equity)
app.get('/api/series', (req, res) => {
  res.json(buildNormalizedSeries());
});

// Scratchpad endpoints (agent notes for next window)
app.get('/api/scratchpad', (req, res) => {
  res.json(readJsonl(SCRATCH_FILE));
});

app.post('/api/scratchpad', (req, res) => {
  const { message, tags, author } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) required' });
  }
  const entry = {
    ts: new Date().toISOString(),
    author: author || 'agent',
    message,
    tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(s=>s.trim()).filter(Boolean) : [])
  };
  appendJsonl(SCRATCH_FILE, entry);
  logEvent('scratchpad.added', { entry });
  res.json(entry);
});

app.delete('/api/scratchpad', (req, res) => {
  try { if (fs.existsSync(SCRATCH_FILE)) fs.unlinkSync(SCRATCH_FILE); } catch {}
  logEvent('scratchpad.cleared', {});
  res.json({ ok: true });
});

// Scheduler window events
let windowTimers = [];
function setupWindowScheduler() {
  // Clear any existing timers
  for (const t of windowTimers) clearTimeout(t);
  windowTimers = scheduleToday(
    (w) => { logEvent('window.open', { window: w }); emitWindowPreamble(w); startAgentIfConfigured(w); },
    (w) => { stopAgent('window.close', w); logEvent('window.close', { window: w }); }
  );
}

// Pollers
async function pollersTick() {
  try {
    const a = await getAccount(getAlpaca());
    appendJsonl(EQUITY_FILE, { ts: new Date().toISOString(), value: a.equity });
  } catch {}
  try {
    const { price } = await getLatestPrice(getAlpaca(), BENCH_SYMBOL);
    if (price) appendJsonl(BENCH_FILE, { ts: new Date().toISOString(), value: price });
  } catch {}
}

function startPollers() {
  setInterval(pollersTick, 60 * 1000);
  // also seed once at start
  pollersTick();
}

// Start server
const PORT = parseInt(process.env.PORT || '8787', 10);
const http = require('http');
const httpServer = http.createServer(app);
// If port is already in use, log and continue so MCP can still run on stdio
httpServer.on('error', (err) => {
  try { logEvent('server.listen.error', { port: PORT, error: String(err && (err.message || err)) }); } catch {}
});
httpServer.listen(PORT, () => {
  logEvent('server.start', { port: PORT, windows: parseWindowsFromEnv() });
  setupWindowScheduler();
  startPollers();
});

// Optional MCP server on stdio
if (process.argv.includes('--mcp') || String(process.env.ENABLE_MCP || 'true') === 'true') {
  const { startMcpServer } = require('./mcp');
  startMcpServer({
    name: process.env.MCP_SERVER_NAME || 'trader-bench',
    description: process.env.MCP_SERVER_DESCRIPTION || 'AI trading benchmark MCP server',
  });
}

// Debug endpoints and config
const DEBUG_FILE = path.join(DATA_DIR, 'debug-config.json');
function readDebugConfig() {
  const defaults = {
    timezone: process.env.TIMEZONE || 'America/New_York',
    tradingWindows: process.env.TRADING_WINDOWS || '08:00,09:31,12:00,15:55',
    windowDurationMinutes: parseInt(process.env.WINDOW_DURATION_MINUTES || '4', 10),
    benchmarkSymbol: process.env.BENCHMARK_SYMBOL || 'SPY',
    tradingEnabled: true,
    sandbox: false,
    agent: process.env.AGENT || 'CodexCLI',
    agentStartCommand: process.env.AGENT_START_CMD || '',
    agentAutoStart: String(process.env.AGENT_AUTO_START || 'false') === 'true',
  };
  if (!fs.existsSync(DEBUG_FILE)) return defaults;
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(DEBUG_FILE, 'utf8')) }; } catch { return defaults; }
}
function writeDebugConfig(cfg) {
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(cfg, null, 2));
}
let debugConfig = readDebugConfig();

app.get('/api/debug/config', (req, res) => {
  res.json(debugConfig);
});

app.put('/api/debug/config', (req, res) => {
  const body = req.body || {};
  debugConfig = {
    timezone: body.timezone || debugConfig.timezone,
    tradingWindows: body.tradingWindows || debugConfig.tradingWindows,
    windowDurationMinutes: Number(body.windowDurationMinutes ?? debugConfig.windowDurationMinutes),
    benchmarkSymbol: body.benchmarkSymbol || debugConfig.benchmarkSymbol,
    tradingEnabled: Boolean(body.tradingEnabled ?? debugConfig.tradingEnabled),
    sandbox: Boolean(body.sandbox ?? debugConfig.sandbox),
    agent: body.agent || debugConfig.agent,
    agentStartCommand: body.agentStartCommand ?? debugConfig.agentStartCommand,
    agentAutoStart: Boolean(body.agentAutoStart ?? debugConfig.agentAutoStart),
  };
  writeDebugConfig(debugConfig);
  // Apply overrides for scheduler and symbol
  setOverrides({ tz: debugConfig.timezone, tradingWindowsCsv: debugConfig.tradingWindows, durationMin: debugConfig.windowDurationMinutes });
  // Update benchmark symbol for sampling
  process.env.BENCHMARK_SYMBOL = debugConfig.benchmarkSymbol;
  res.json(debugConfig);
});

app.post('/api/debug/reschedule', (req, res) => {
  setupWindowScheduler();
  res.json({ ok: true, windows: parseWindowsFromEnv() });
});

app.post('/api/debug/checkPrice', async (req, res) => {
  try {
    const { symbol } = req.body || {};
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const { price, raw } = await getLatestPrice(getAlpaca(), symbol);
    const result = { symbol, price, raw };
    logEvent('debug.checkPrice', { args: { symbol }, result });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Emit a short preamble and optional agent start command when windows open
function emitWindowPreamble(w) {
  try {
    const goal = `Trading window open (${w.id}). Goal: evaluate current positions, check opportunities, and place risk-aware market orders only if conviction is high. Use MCP tools (viewPortfolio, checkPrice, buyShares, sellShares). Keep notes via addScratchpad.`;
    const info = {
      window: w,
      agent: debugConfig.agent,
      benchmarkSymbol: process.env.BENCHMARK_SYMBOL || 'SPY',
      feed: (process.env.ALPACA_DATA_FEED || 'iex'),
      durationMinutes: debugConfig.windowDurationMinutes,
    };
    logEvent('agent.preamble', { message: goal, info });
    if (debugConfig.agentStartCommand && String(debugConfig.agentStartCommand).trim().length) {
      logEvent('agent.start.suggested', { command: debugConfig.agentStartCommand, agent: debugConfig.agent, window: w });
    }
  } catch {}
}

// Optionally auto-start an external agent process when a window opens
let agentProc = null;
function startAgentIfConfigured(w) {
  try {
    if (agentProc) return; // already running
    if (!debugConfig.agentAutoStart) return;
    const cmd = String(debugConfig.agentStartCommand || '').trim();
    if (!cmd) return;
    const { spawn } = require('node:child_process');
    const proc = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    agentProc = proc;
    logEvent('agent.started', { pid: proc.pid, command: cmd, window: w });
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      text.split(/\r?\n/).forEach((line) => { if (line.trim()) logEvent('agent.stdout', { line }); });
    });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      text.split(/\r?\n/).forEach((line) => { if (line.trim()) logEvent('agent.stderr', { line }); });
    });
    proc.on('close', (code, signal) => {
      logEvent('agent.exited', { code, signal });
      agentProc = null;
    });
  } catch (e) {
    logEvent('agent.start.error', { error: String(e.message || e) });
  }
}

function stopAgent(reason, w) {
  try {
    if (!agentProc) return;
    const p = agentProc;
    agentProc = null;
    logEvent('agent.stopping', { pid: p.pid, reason, window: w });
    // Try graceful stop
    try { p.kill('SIGINT'); } catch {}
    setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, 1500);
  } catch (e) {
    logEvent('agent.stop.error', { error: String(e.message || e) });
  }
}

app.post('/api/debug/placeOrder', async (req, res) => {
  try {
    const { symbol, side, quantity, note, force, dryRun } = req.body || {};
    if (!symbol || !side || !quantity) return res.status(400).json({ error: 'symbol, side, quantity required' });
    let result;
    if (dryRun || debugConfig.sandbox || !debugConfig.tradingEnabled) {
      result = { dryRun: true, symbol, side, quantity };
      logEvent('debug.order.dryRun', { args: { symbol, side, quantity, note }, result });
    } else {
      // If not forced, rely on regular window enforcement via MCP; for debug, allow force
      if (!force) {
        result = { error: 'Use force=true or run inside trading window' };
        logEvent('debug.order.denied', { args: { symbol, side, quantity, note }, result });
        return res.status(400).json(result);
      }
      const order = await require('./alpaca').placeOrder(getAlpaca(), { symbol, qty: quantity, side });
      result = { order };
      logEvent('debug.order.placed', { args: { symbol, side, quantity, note }, result });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/debug/log', (req, res) => {
  const { message } = req.body || {};
  const ev = logEvent('debug.note', { message });
  res.json(ev);
});

// Initiate a one-off trading window run now (opens immediately for N minutes)
app.post('/api/debug/run-once', (req, res) => {
  const duration = Number((req.body && req.body.durationMinutes) || process.env.WINDOW_DURATION_MINUTES || 4);
  const { start, end } = openAdhocWindow(duration, (process.env.TIMEZONE || 'America/New_York'));
  // Schedule open/close events for adhoc window explicitly
  const startDate = new Date(start);
  const endDate = new Date(end);
  const now = Date.now();
  setTimeout(() => {
    const w = { id: 'adhoc', start, end };
    logEvent('window.open', { window: w });
    emitWindowPreamble(w);
    startAgentIfConfigured(w);
  }, Math.max(0, startDate.getTime() - now));
  setTimeout(() => {
    const w = { id: 'adhoc', start, end };
    stopAgent('adhoc.close', w);
    logEvent('window.close', { window: w });
    clearAdhocWindow();
  }, Math.max(0, endDate.getTime() - now));
  res.json({ ok: true, start, end, durationMinutes: duration });
});

// Danger: Start-fresh reset endpoint (gated)
// (Reset endpoint removed; full paper account reset not supported via Alpaca API)
