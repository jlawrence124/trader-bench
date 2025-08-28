const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { createClient, getAccount, getPositions, placeOrder, getLatestPrice } = require('./alpaca');
const { isWithinTradingWindow } = require('./scheduler');
const { logEvent, DATA_DIR } = require('./log');
const path = require('path');
const fs = require('fs');

async function startMcpServer({ name, description }) {
  const transport = new StdioServerTransport();
  const server = new McpServer({ name, version: '0.1.0' }, { capabilities: { tools: {} } });

  // lazily init Alpaca
  let alpaca;
  function getAlpaca() {
    if (!alpaca) alpaca = createClient();
    return alpaca;
  }

  server.tool('viewPortfolio', 'View open positions and basic account summary', async () => {
    const a = await getAccount(getAlpaca());
    const p = await getPositions(getAlpaca());
    const result = { account: a, positions: p };
    logEvent('tool.viewPortfolio', { result });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('checkPrice', 'Get latest price/quote for a symbol', { symbol: z.string() }, async ({ symbol }) => {
    const { price, raw, source } = await getLatestPrice(getAlpaca(), symbol);
    const result = { symbol, price, source, raw };
    logEvent('tool.checkPrice', { args: { symbol }, result });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('buyShares', 'Place a market buy order (paper trading only). Only allowed during trading windows.', {
    symbol: z.string(),
    quantity: z.number().int().min(1),
    note: z.string().optional(),
  }, async ({ symbol, quantity, note }) => {
    if (!isWithinTradingWindow()) {
      const err = { error: 'Trading not allowed outside configured windows' };
      logEvent('tool.buyShares.denied', { args: { symbol, quantity, note }, result: err });
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
    }
    const order = await placeOrder(getAlpaca(), { symbol, qty: quantity, side: 'buy' });
    const result = { order };
    logEvent('tool.buyShares', { args: { symbol, quantity, note }, result });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('sellShares', 'Place a market sell order (paper trading only). Only allowed during trading windows.', {
    symbol: z.string(),
    quantity: z.number().int().min(1),
    note: z.string().optional(),
  }, async ({ symbol, quantity, note }) => {
    if (!isWithinTradingWindow()) {
      const err = { error: 'Trading not allowed outside configured windows' };
      logEvent('tool.sellShares.denied', { args: { symbol, quantity, note }, result: err });
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
    }
    const order = await placeOrder(getAlpaca(), { symbol, qty: quantity, side: 'sell' });
    const result = { order };
    logEvent('tool.sellShares', { args: { symbol, quantity, note }, result });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('viewAccountBalance', 'View account equity and cash balance', async () => {
    const a = await getAccount(getAlpaca());
    logEvent('tool.viewAccountBalance', { result: a });
    return { content: [{ type: 'text', text: JSON.stringify(a) }] };
  });

  // Scratchpad tools for messaging across windows
  const SCRATCH_FILE = path.join(DATA_DIR, 'scratchpad.jsonl');
  function appendJsonl(file, obj) { try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); } catch {} }
  function readJsonl(limit = 500) {
    if (!fs.existsSync(SCRATCH_FILE)) return [];
    const lines = fs.readFileSync(SCRATCH_FILE, 'utf8').trim().split('\n');
    const slice = lines.slice(Math.max(0, lines.length - limit));
    return slice.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  server.tool('addScratchpad', 'Leave a scratchpad note for the next window', {
    message: z.string(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),
  }, async ({ message, tags, author }) => {
    const entry = { ts: new Date().toISOString(), author: author || 'agent', message, tags: tags || [] };
    appendJsonl(SCRATCH_FILE, entry);
    logEvent('scratchpad.added', { entry });
    return { content: [{ type: 'text', text: JSON.stringify(entry) }] };
  });

  server.tool('getScratchpad', 'View recent scratchpad notes', { limit: z.number().int().min(1).max(2000).optional() }, async ({ limit }) => {
    const items = readJsonl(limit || 200);
    return { content: [{ type: 'text', text: JSON.stringify(items) }] };
  });

  await server.connect(transport);
}

module.exports = { startMcpServer };
