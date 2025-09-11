const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { createClient, getAccount, getPositions, placeOrder, getLatestPrice, getOpenOrders } = require('./alpaca');
const { isWithinTradingWindow, isWithinMarketHours, getWindowStatus } = require('./scheduler');
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

  server.tool('buyShares', 'Place a market buy order (paper trading only). Allowed during trading windows or regular market hours.', {
    symbol: z.string(),
    quantity: z.number().int().min(1),
    note: z.string().optional(),
  }, async ({ symbol, quantity, note }) => {
    if (!(isWithinTradingWindow() || isWithinMarketHours())) {
      const err = { error: 'Trading not allowed outside configured windows or market hours' };
      logEvent('tool.buyShares.denied', { args: { symbol, quantity, note }, result: err });
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
    }
    const order = await placeOrder(getAlpaca(), { symbol, qty: quantity, side: 'buy' });
    const result = { order };
    logEvent('tool.buyShares', { args: { symbol, quantity, note }, result });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('sellShares', 'Place a market sell order (paper trading only). Allowed during trading windows or regular market hours.', {
    symbol: z.string(),
    quantity: z.number().int().min(1),
    note: z.string().optional(),
  }, async ({ symbol, quantity, note }) => {
    if (!(isWithinTradingWindow() || isWithinMarketHours())) {
      const err = { error: 'Trading not allowed outside configured windows or market hours' };
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

  server.tool('viewOpenOrders', 'List currently open/pending orders', async () => {
    const orders = await getOpenOrders(getAlpaca());
    logEvent('tool.viewOpenOrders', { result: orders });
    return { content: [{ type: 'text', text: JSON.stringify(orders) }] };
  });

  // Trading window awareness for agents
  server.tool(
    'getWindowStatus',
    'Get current trading window status (active window and next scheduled window).',
    async () => {
      const status = getWindowStatus();
      logEvent('tool.getWindowStatus', { result: status });
      return { content: [{ type: 'text', text: JSON.stringify(status) }] };
    }
  );

  // --- Web search (best-effort) -------------------------------------------------------------
  // Provider selection via env or secrets file. Defaults to DuckDuckGo Instant Answer API
  // with no key. If a provider/key is configured, uses Tavily/SerpAPI/Brave accordingly.
  function readSecrets() {
    try {
      const f = path.join(DATA_DIR, 'secrets.json');
      if (!fs.existsSync(f)) return {};
      return JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    } catch { return {}; }
  }

  async function performSearch(query, limit) {
    const provider = String(process.env.SEARCH_PROVIDER || 'brave').toLowerCase();
    const secrets = readSecrets();
    const key = process.env.SEARCH_API_KEY || secrets.searchApiKey || '';
    const n = Math.max(1, Math.min(10, Number(limit || 5)));
    try {
      if (provider === 'tavily' && key) {
        const url = (process.env.SEARCH_BASE_URL || 'https://api.tavily.com/search');
        const body = { api_key: key, query, search_depth: 'basic', max_results: n };
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(()=>({}));
        const results = Array.isArray(j?.results) ? j.results.slice(0,n).map(it => ({ title: it.title, url: it.url, snippet: it.content })) : [];
        return { provider: 'tavily', results };
      }
      if (provider === 'serpapi' && key) {
        const params = new URLSearchParams({ engine: 'google', q: query, num: String(n), api_key: key });
        const url = (process.env.SEARCH_BASE_URL || 'https://serpapi.com/search.json') + '?' + params.toString();
        const j = await (await fetch(url)).json().catch(()=>({}));
        const results = Array.isArray(j?.organic_results) ? j.organic_results.slice(0,n).map(it => ({ title: it.title, url: it.link, snippet: it.snippet })) : [];
        return { provider: 'serpapi', results };
      }
      if (provider === 'brave' && key) {
        const u = new URL(process.env.SEARCH_BASE_URL || 'https://api.search.brave.com/res/v1/web/search');
        u.searchParams.set('q', query);
        u.searchParams.set('count', String(n));
        const j = await (await fetch(u, { headers: { 'X-Subscription-Token': key } })).json().catch(()=>({}));
        const results = Array.isArray(j?.web?.results) ? j.web.results.slice(0,n).map(it => ({ title: it.title, url: it.url, snippet: it.description })) : [];
        return { provider: 'brave', results };
      }
      // Default: DuckDuckGo Instant Answer (no key). If empty results, fallback to HTML + Google News RSS.
      const u = new URL(process.env.SEARCH_BASE_URL || 'https://api.duckduckgo.com/');
      u.searchParams.set('q', query);
      u.searchParams.set('format', 'json');
      u.searchParams.set('no_redirect', '1');
      u.searchParams.set('no_html', '1');
      const j = await (await fetch(u)).json().catch(()=>({}));
      let collect = [];
      if (Array.isArray(j?.Results)) {
        for (const r of j.Results) collect.push({ title: r.Text || r.Result || r.FirstURL, url: r.FirstURL, snippet: r.Text || '' });
      }
      if (Array.isArray(j?.RelatedTopics)) {
        for (const rt of j.RelatedTopics) {
          if (rt && typeof rt === 'object' && rt.Text && rt.FirstURL) collect.push({ title: rt.Text, url: rt.FirstURL, snippet: rt.Text });
          if (Array.isArray(rt?.Topics)) {
            for (const t of rt.Topics) {
              if (t && t.Text && t.FirstURL) collect.push({ title: t.Text, url: t.FirstURL, snippet: t.Text });
            }
          }
        }
      }
      // Fallback 1: DuckDuckGo HTML lite page parsing
      if (collect.length === 0) {
        try {
          const lite = new URL('https://duckduckgo.com/html/');
          lite.searchParams.set('q', query);
          const html = await (await fetch(lite)).text();
          const items = [];
          const re = /<a[^>]+class=\"[^\"]*(result__a|result__title|result-link)[^\"]*\"[^>]+href=\"([^\"]+)\"[^>]*>(.*?)<\/a>/g;
          let m;
          while ((m = re.exec(html)) && items.length < n * 2) {
            let href = m[2];
            try {
              // DDG often redirects via /l/?uddg=URL
              const u2 = new URL(href, 'https://duckduckgo.com');
              const real = u2.searchParams.get('uddg');
              if (real) href = decodeURIComponent(real);
            } catch {}
            const title = m[3].replace(/<[^>]+>/g, '').trim();
            if (href && title) items.push({ title, url: href, snippet: '' });
          }
          collect = items;
          if (collect.length) return { provider: 'duckduckgo-html', results: collect.slice(0, n) };
        } catch {}
      }
      // Fallback 2: Google News RSS (topical news)
      if (collect.length === 0) {
        try {
          const rss = new URL('https://news.google.com/rss/search');
          rss.searchParams.set('q', query);
          rss.searchParams.set('hl', 'en-US');
          rss.searchParams.set('gl', 'US');
          rss.searchParams.set('ceid', 'US:en');
          const xml = await (await fetch(rss)).text();
          const items = [];
          const itemRe = /<item>([\s\S]*?)<\/item>/g;
          let m;
          while ((m = itemRe.exec(xml)) && items.length < n) {
            const block = m[1];
            const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1];
            const link = (block.match(/<link>(.*?)<\/link>/) || [])[1];
            if (title && link) items.push({ title: title.trim(), url: link.trim(), snippet: '' });
          }
          if (items.length) return { provider: 'google-news-rss', results: items.slice(0, n) };
        } catch {}
      }
      const results = collect.slice(0, n);
      return { provider: 'duckduckgo', results };
    } catch (e) {
      return { provider, error: String(e && (e.message || e)), results: [] };
    }
  }

  server.tool(
    'webSearch',
    'Search the web and return top links and snippets (best-effort; provider configurable by env).',
    { query: z.string(), limit: z.number().int().min(1).max(10).optional() },
    async ({ query, limit }) => {
      const result = await performSearch(query, limit);
      logEvent('tool.webSearch', { args: { query, limit }, result });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

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
