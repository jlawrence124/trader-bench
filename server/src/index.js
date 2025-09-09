// Load env and ensure file values override any pre-set env vars
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { createClient, getAccount, getPositions, getLatestPrice } = require('./alpaca');
const { addSseClient, logEvent, readRecentLogs, DATA_DIR } = require('./log');
const { parseWindowsFromEnv, scheduleToday, setOverrides, openAdhocWindow, clearAdhocWindow, getWindowStatus } = require('./scheduler');
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
const LOG_FILE = path.join(DATA_DIR, 'event-log.jsonl');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const BENCH_SYMBOL = process.env.BENCHMARK_SYMBOL || 'SPY';

function appendJsonl(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); } catch {}
}

function readSeries(file, limit) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split('\n');
  let selected = lines;
  // If a finite numeric limit is provided, return the last N lines; otherwise return all
  if (typeof limit === 'number' && isFinite(limit)) {
    selected = lines.slice(Math.max(0, lines.length - limit));
  }
  return selected.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function readJsonl(file, limit = 500) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const slice = lines.slice(Math.max(0, lines.length - limit));
  return slice.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function toDate(ts) { return new Date(ts).getTime(); }

function buildNormalizedSeries(limit) {
  const equity = readSeries(EQUITY_FILE, limit);
  const bench = readSeries(BENCH_FILE, limit);

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
  const limit = (req.query && Number(req.query.limit));
  res.json(readSeries(EQUITY_FILE, Number.isFinite(limit) ? limit : undefined));
});

app.get('/api/benchmark', (req, res) => {
  const limit = (req.query && Number(req.query.limit));
  res.json(readSeries(BENCH_FILE, Number.isFinite(limit) ? limit : undefined));
});

app.get('/api/metrics', (req, res) => {
  const limit = (req.query && Number(req.query.limit));
  const equity = readSeries(EQUITY_FILE, Number.isFinite(limit) ? limit : undefined);
  const bench = readSeries(BENCH_FILE, Number.isFinite(limit) ? limit : undefined);
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
  const limit = (req.query && Number(req.query.limit));
  res.json(buildNormalizedSeries(Number.isFinite(limit) ? limit : undefined));
});

// Window status: active current window and next scheduled window
app.get('/api/window/status', (req, res) => {
  try { res.json(getWindowStatus()); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
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
let currentWindow = null; // { id, start, end }
const closedWindowKeys = new Set();
function windowKey(w) { return w ? `${w.id}|${w.start}|${w.end}` : null }
function markWindowOpen(w) { currentWindow = w }
function markWindowClosed(w) { if (w) closedWindowKeys.add(windowKey(w)); currentWindow = null }
function setupWindowScheduler() {
  // Clear any existing timers
  for (const t of windowTimers) clearTimeout(t);
  windowTimers = scheduleToday(
    (w) => { logEvent('window.open', { window: w }); markWindowOpen(w); startAgentIfConfigured(w); },
    (w) => {
      if (closedWindowKeys.has(windowKey(w))) return; // already closed manually/force
      stopAgent('window.close', w);
      logEvent('window.close', { window: w });
      markWindowClosed(w);
    }
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
    agentAutoStart: String(process.env.AGENT_AUTO_START || 'false') === 'true',
    alpacaKeyId: process.env.ALPACA_KEY_ID || '',
    alpacaSecretKey: process.env.ALPACA_SECRET_KEY || '',
    alpacaDataFeed: (process.env.ALPACA_DATA_FEED || 'iex'),
    // Built-in LLM agent config
    llmProvider: process.env.LLM_PROVIDER || 'openai',
    llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',
    llmBaseUrl: process.env.LLM_BASE_URL || '',
    llmStreaming: String(process.env.LLM_STREAMING || 'true') === 'true',
  };
  if (!fs.existsSync(DEBUG_FILE)) return defaults;
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(DEBUG_FILE, 'utf8')) }; } catch { return defaults; }
}
function writeDebugConfig(cfg) {
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(cfg, null, 2));
}
let debugConfig = readDebugConfig();

function readSecrets() {
  try {
    if (!fs.existsSync(SECRETS_FILE)) return {};
    const raw = fs.readFileSync(SECRETS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}
function writeSecrets(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(obj || {}, null, 2));
  } catch {}
}
let secrets = readSecrets();

// Provider-specific API key lookup and env management
function providerEnvName(providerRaw) {
  const p = String(providerRaw || '').toLowerCase();
  if (p === 'openai' || p === 'openai-compatible') return 'OPENAI_API_KEY';
  if (p === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (p === 'gemini') return 'GEMINI_API_KEY';
  if (p === 'mistral') return 'MISTRAL_API_KEY';
  if (p === 'deepseek') return 'DEEPSEEK_API_KEY';
  if (p === 'grok' || p === 'xai') return 'XAI_API_KEY';
  if (p === 'qwen') return 'QWEN_API_KEY';
  return 'LLM_API_KEY';
}
function getProviderApiKey(providerRaw) {
  const name = providerEnvName(providerRaw);
  return process.env[name] || process.env.LLM_API_KEY || '';
}
function updateEnvFile(updates) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    let content = '';
    try { if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8'); } catch {}
    const lines = content.split(/\r?\n/);
    const out = [];
    const set = new Set();
    const keys = Object.keys(updates || {});
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /^(\s*#.*|\s*)$/.test(line) ? null : line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) {
        const k = m[1];
        if (keys.includes(k)) {
          const v = updates[k];
          out.push(`${k}=${v != null ? v : ''}`);
          set.add(k);
          continue;
        }
      }
      out.push(line);
    }
    for (const k of keys) {
      if (!set.has(k)) out.push(`${k}=${updates[k] != null ? updates[k] : ''}`);
    }
    fs.writeFileSync(envPath, out.join('\n'));
  } catch {}
}

function maskConfig(cfg) {
  return {
    ...cfg,
    alpacaSecretSet: Boolean(cfg.alpacaSecretKey && String(cfg.alpacaSecretKey).length),
    alpacaSecretKey: cfg.alpacaSecretKey ? '********' : '',
    llmApiKeySet: Boolean(getProviderApiKey(cfg?.llmProvider || process.env.LLM_PROVIDER)),
  };
}

app.get('/api/debug/config', (req, res) => {
  // Do not leak the full secret; mask value if present
  res.json(maskConfig(debugConfig));
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
    agentAutoStart: Boolean(body.agentAutoStart ?? debugConfig.agentAutoStart),
    alpacaKeyId: body.alpacaKeyId ?? debugConfig.alpacaKeyId,
    alpacaSecretKey: (typeof body.alpacaSecretKey === 'string' && body.alpacaSecretKey !== '********' && body.alpacaSecretKey.length) ? body.alpacaSecretKey : debugConfig.alpacaSecretKey,
    alpacaDataFeed: body.alpacaDataFeed || debugConfig.alpacaDataFeed,
    llmProvider: body.llmProvider || debugConfig.llmProvider,
    llmModel: body.llmModel || debugConfig.llmModel,
    llmBaseUrl: body.llmBaseUrl ?? debugConfig.llmBaseUrl,
    llmStreaming: Boolean(body.llmStreaming ?? debugConfig.llmStreaming),
  };
  if (typeof body.llmApiKey === 'string' && body.llmApiKey !== '********') {
    const envName = providerEnvName(debugConfig.llmProvider || 'openai');
    updateEnvFile({ [envName]: body.llmApiKey });
    process.env[envName] = body.llmApiKey;
    // Also set generic LLM_API_KEY for convenience
    updateEnvFile({ LLM_API_KEY: body.llmApiKey });
    process.env.LLM_API_KEY = body.llmApiKey;
  }
  writeDebugConfig(debugConfig);
  // Apply overrides for scheduler and symbol
  setOverrides({ tz: debugConfig.timezone, tradingWindowsCsv: debugConfig.tradingWindows, durationMin: debugConfig.windowDurationMinutes });
  // Update benchmark symbol for sampling
  process.env.BENCHMARK_SYMBOL = debugConfig.benchmarkSymbol;
  // Update Alpaca runtime environment and reset client
  process.env.ALPACA_KEY_ID = debugConfig.alpacaKeyId || '';
  if (debugConfig.alpacaSecretKey) process.env.ALPACA_SECRET_KEY = debugConfig.alpacaSecretKey;
  process.env.ALPACA_DATA_FEED = debugConfig.alpacaDataFeed || 'iex';
  alpaca = null;
  try { logEvent('alpaca.reconfigured', { feed: debugConfig.alpacaDataFeed, hasKey: !!debugConfig.alpacaKeyId }); } catch {}
  // Return masked view to avoid exposing secrets
  res.json(maskConfig(debugConfig));
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

// Removed agent preamble emission; initial prompt should cover guidance

// Optionally auto-start an external agent process when a window opens
let agentProc = null;
function startAgentIfConfigured(w) {
  try {
    if (agentProc) return; // already running
    if (!debugConfig.agentAutoStart) return;
    const { spawn } = require('node:child_process');
    // Built-in LLM runner only
    const env = { ...process.env, ENABLE_MCP: 'true', PORT: '0',
      LLM_PROVIDER: debugConfig.llmProvider || 'openai',
      LLM_MODEL: debugConfig.llmModel || 'gpt-4o-mini',
      LLM_BASE_URL: debugConfig.llmBaseUrl || '',
      LLM_STREAMING: String(debugConfig.llmStreaming ? 'true' : 'false'),
      LLM_API_KEY: getProviderApiKey(debugConfig.llmProvider || process.env.LLM_PROVIDER || 'openai'),
    };
    const runner = path.join(__dirname, '..', '..', 'agent', 'llm-runner.js');
    const proc = spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'], env });
    agentProc = proc;
    logEvent('agent.started', { pid: proc.pid, command: 'builtin-llm', window: w });
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
      if (currentWindow) {
        const cw = currentWindow;
        stopAgent('agent.exited', cw);
        logEvent('window.close', { window: cw, reason: 'agent.exited' });
        markWindowClosed(cw);
        // If this was an ad-hoc window triggered via Debug → Run Once, clear it now
        try { if (cw && cw.id === 'adhoc') clearAdhocWindow(); } catch {}
      }
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
      // Allow during configured windows OR regular market hours unless force=false outside both
      const { isWithinTradingWindow, isWithinMarketHours } = require('./scheduler');
      if (!force) {
        if (!(isWithinTradingWindow() || isWithinMarketHours())) {
          result = { error: 'Use force=true or run inside trading window or market hours' };
          logEvent('debug.order.denied', { args: { symbol, side, quantity, note }, result });
          return res.status(400).json(result);
        }
      }
      const order = await require('./alpaca').placeOrder(getAlpaca(), { symbol, qty: quantity, side });
      result = { order };
      logEvent('debug.order.placed', { args: { symbol, side, quantity, note }, result });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Test LLM connectivity with a minimal chat call (no tools)
app.post('/api/debug/test-llm', async (req, res) => {
  try {
    const provider = (debugConfig.llmProvider || 'openai').toLowerCase();
    const model = debugConfig.llmModel || 'gpt-4o-mini';
    const resolvedKey = getProviderApiKey(provider);
    if (!resolvedKey) return res.status(400).json({ error: 'Missing LLM API key' });

    // Defaults per provider when base URL not supplied
    let baseUrl = (debugConfig.llmBaseUrl || '').trim();
    const defaults = {
      openai: 'https://api.openai.com/v1',
      'openai-compatible': 'https://api.openai.com/v1',
      mistral: 'https://api.mistral.ai/v1',
      deepseek: 'https://api.deepseek.com/v1',
      grok: 'https://api.x.ai/v1',
      xai: 'https://api.x.ai/v1',
      anthropic: 'https://api.anthropic.com',
      gemini: 'https://generativelanguage.googleapis.com/v1beta',
      qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    };
    if (!baseUrl) baseUrl = defaults[provider] || defaults.openai;

    // OpenAI-compatible providers
    const isOaiLike = ['openai', 'openai-compatible', 'mistral', 'deepseek', 'grok', 'xai', 'qwen'].includes(provider);
    if (isOaiLike) {
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      const body = { model, messages: [{ role: 'user', content: 'reply with OK' }] };
      // Some models (e.g., gpt-5 family) only allow default temperature; omit to avoid errors
      if (!(provider === 'openai' && /^gpt-5/i.test(model))) body.temperature = 0;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resolvedKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await r.json().catch(()=>({}));
      if (!r.ok) return res.status(r.status).json({ error: json?.error || json || await r.text() });
      const content = json?.choices?.[0]?.message?.content || '';
      return res.json({ ok: true, model: json?.model || model, content });
    }

    if (provider === 'anthropic') {
      const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
      const body = { model, messages: [{ role: 'user', content: [{ type: 'text', text: 'reply with OK' }] }] };
      const r = await fetch(url, { method: 'POST', headers: { 'x-api-key': resolvedKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) return res.status(r.status).json({ error: j || await r.text() });
      const content = (j?.content || []).filter(p=>p.type==='text').map(p=>p.text).join(' ');
      return res.json({ ok: true, model, content });
    }

    if (provider === 'gemini') {
      const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(resolvedKey)}`;
      const body = { contents: [{ role: 'user', parts: [{ text: 'reply with OK' }] }] };
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) return res.status(r.status).json({ error: j || await r.text() });
      const content = j?.candidates?.[0]?.content?.parts?.map(p=>p.text).filter(Boolean).join(' ') || '';
      return res.json({ ok: true, model, content });
    }

    return res.json({ ok: false, error: 'Unsupported provider' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/debug/log', (req, res) => {
  const { message } = req.body || {};
  const ev = logEvent('debug.note', { message });
  res.json(ev);
});

// Clear all event logs (gated via confirm string)
app.post('/api/debug/clear-logs', (req, res) => {
  const { confirm } = req.body || {};
  if (String(confirm || '').toUpperCase() !== 'CLEAR') {
    return res.status(400).json({ error: 'Confirmation required. Type "CLEAR" to proceed.' });
  }
  try { if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE); } catch {}
  const ev = logEvent('logs.cleared', {});
  res.json({ ok: true, event: ev });
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
    markWindowOpen(w);
    startAgentIfConfigured(w);
  }, Math.max(0, startDate.getTime() - now));
  setTimeout(() => {
    const w = { id: 'adhoc', start, end };
    stopAgent('adhoc.close', w);
    if (!closedWindowKeys.has(windowKey(w))) {
      logEvent('window.close', { window: w });
      markWindowClosed(w);
    }
    clearAdhocWindow();
  }, Math.max(0, endDate.getTime() - now));
  res.json({ ok: true, start, end, durationMinutes: duration });
});

// Manual stop of current open window
app.post('/api/debug/stop-window', (req, res) => {
  try {
    if (!currentWindow) return res.status(400).json({ error: 'No active window' });
    const w = currentWindow;
    stopAgent('manual.stop', w);
    if (!closedWindowKeys.has(windowKey(w))) {
      logEvent('window.close', { window: w, reason: 'manual' });
      markWindowClosed(w);
    }
    clearAdhocWindow();
    res.json({ ok: true, window: w });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Danger: Start-fresh reset endpoint (gated)
// (Reset endpoint removed; full paper account reset not supported via Alpaca API)
