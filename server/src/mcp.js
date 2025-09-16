const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const {
    createClient,
    getAccount,
    getPositions,
    placeOrder,
    getLatestPrice,
    getOpenOrders,
    // options
    getOptionPositions,
    placeOptionOrder,
    getOpenOptionOrders,
    getLatestOptionPrice,
} = require('./alpaca');
const {
    isWithinTradingWindow,
    isWithinMarketHours,
    getWindowStatus,
} = require('./scheduler');
const { logEvent, DATA_DIR } = require('./log');
const { cumulativeReturn, maxDrawdown, sharpe } = require('./metrics');
const path = require('path');
const fs = require('fs');

async function startMcpServer({ name, description }) {
    const transport = new StdioServerTransport();
    const server = new McpServer(
        { name, version: '0.1.0' },
        { capabilities: { tools: {} } },
    );

    // lazily init Alpaca
    let alpaca;
    function getAlpaca() {
        if (!alpaca) alpaca = createClient();
        return alpaca;
    }

    server.tool(
        'viewPortfolio',
        'View open positions and basic account summary',
        async () => {
            const a = await getAccount(getAlpaca());
            let equities = [];
            let options = [];
            try { equities = await getPositions(getAlpaca()); } catch {}
            try { options = await getOptionPositions(getAlpaca()); } catch {}
            const p = [...equities, ...options];
            const result = { account: a, positions: p };
            logEvent('tool.viewPortfolio', { result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'checkPrice',
        'Get latest price/quote for a symbol',
        { symbol: z.string() },
        async ({ symbol }) => {
            const { price, raw, source } = await getLatestPrice(getAlpaca(), symbol);
            const result = { symbol, price, source, raw };
            logEvent('tool.checkPrice', { args: { symbol }, result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'buyShares',
        'Place a market buy order (paper trading only). Allowed during trading windows or regular market hours.',
        {
            symbol: z.string(),
            quantity: z.number().int().min(1),
            note: z.string().optional(),
        },
        async ({ symbol, quantity, note }) => {
            if (!(isWithinTradingWindow() || isWithinMarketHours())) {
                const err = {
                    error: 'Trading not allowed outside configured windows or market hours',
                };
                logEvent('tool.buyShares.denied', {
                    args: { symbol, quantity, note },
                    result: err,
                });
                return {
                    isError: true,
                    content: [{ type: 'text', text: JSON.stringify(err) }],
                };
            }
            const order = await placeOrder(getAlpaca(), {
                symbol,
                qty: quantity,
                side: 'buy',
            });
            const result = { order };
            logEvent('tool.buyShares', { args: { symbol, quantity, note }, result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'sellShares',
        'Place a market sell order (paper trading only). Allowed during trading windows or regular market hours.',
        {
            symbol: z.string(),
            quantity: z.number().int().min(1),
            note: z.string().optional(),
        },
        async ({ symbol, quantity, note }) => {
            if (!(isWithinTradingWindow() || isWithinMarketHours())) {
                const err = {
                    error: 'Trading not allowed outside configured windows or market hours',
                };
                logEvent('tool.sellShares.denied', {
                    args: { symbol, quantity, note },
                    result: err,
                });
                return {
                    isError: true,
                    content: [{ type: 'text', text: JSON.stringify(err) }],
                };
            }
            const order = await placeOrder(getAlpaca(), {
                symbol,
                qty: quantity,
                side: 'sell',
            });
            const result = { order };
            logEvent('tool.sellShares', { args: { symbol, quantity, note }, result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'viewAccountBalance',
        'View account equity and cash balance',
        async () => {
            const a = await getAccount(getAlpaca());
            logEvent('tool.viewAccountBalance', { result: a });
            return { content: [{ type: 'text', text: JSON.stringify(a) }] };
        },
    );

    server.tool('viewOpenOrders', 'List currently open/pending orders', async () => {
        let eq = [];
        let opt = [];
        try { eq = await getOpenOrders(getAlpaca()); } catch {}
        try { opt = await getOpenOptionOrders(getAlpaca()); } catch {}
        const orders = [...eq, ...opt];
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
        },
    );

    // Performance metrics vs benchmark (SPY by default)
  server.tool(
    'getMetrics',
    'Get current performance metrics: equityReturn, benchReturn, alpha (excess return vs SPY), maxDrawdown, sharpe.',
    async () => {
            const path = require('path');
            const fs = require('fs');
            function readSeries(file) {
                if (!fs.existsSync(file)) return [];
                const raw = fs.readFileSync(file, 'utf8').trim();
                if (!raw) return [];
                return raw
                    .split('\n')
                    .map((l) => {
                        try {
                            return JSON.parse(l);
                        } catch {
                            return null;
                        }
                    })
                    .filter(Boolean);
            }
            const EQUITY_FILE = path.join(DATA_DIR, 'equity.jsonl');
            const BENCH_FILE = path.join(DATA_DIR, 'benchmark.jsonl');
            const equity = readSeries(EQUITY_FILE);
            const bench = readSeries(BENCH_FILE);
            let equityRet = 0,
                benchRet = 0;
            if (equity.length >= 2) equityRet = cumulativeReturn(equity);
            if (bench.length >= 2) benchRet = cumulativeReturn(bench);
            const result = {
                equityReturn: equityRet,
                benchReturn: benchRet,
                alpha: equityRet - benchRet,
                maxDrawdown: maxDrawdown(equity),
                sharpe: sharpe(equity),
            };
            logEvent('tool.getMetrics', { result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    // --- Web search (best-effort) -------------------------------------------------------------
    // Provider selection via env or secrets file. Defaults to DuckDuckGo Instant Answer API
    // with no key. If a provider/key is configured, uses Tavily/SerpAPI/Brave accordingly.
    function readSecrets() {
        try {
            const f = path.join(DATA_DIR, 'secrets.json');
            if (!fs.existsSync(f)) return {};
            return JSON.parse(fs.readFileSync(f, 'utf8')) || {};
        } catch {
            return {};
        }
    }

    async function performSearch(query, limit) {
        const provider = String(process.env.SEARCH_PROVIDER || 'brave').toLowerCase();
        const secrets = readSecrets();
        const key = process.env.SEARCH_API_KEY || secrets.searchApiKey || '';
        const n = Math.max(1, Math.min(10, Number(limit || 5)));
        try {
            if (provider === 'tavily' && key) {
                const url =
                    process.env.SEARCH_BASE_URL || 'https://api.tavily.com/search';
                const body = {
                    api_key: key,
                    query,
                    search_depth: 'basic',
                    max_results: n,
                };
                const r = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const j = await r.json().catch(() => ({}));
                const results = Array.isArray(j?.results)
                    ? j.results.slice(0, n).map((it) => ({
                          title: it.title,
                          url: it.url,
                          snippet: it.content,
                      }))
                    : [];
                return { provider: 'tavily', results };
            }
            if (provider === 'serpapi' && key) {
                const params = new URLSearchParams({
                    engine: 'google',
                    q: query,
                    num: String(n),
                    api_key: key,
                });
                const url =
                    (process.env.SEARCH_BASE_URL || 'https://serpapi.com/search.json') +
                    '?' +
                    params.toString();
                const j = await (await fetch(url)).json().catch(() => ({}));
                const results = Array.isArray(j?.organic_results)
                    ? j.organic_results.slice(0, n).map((it) => ({
                          title: it.title,
                          url: it.link,
                          snippet: it.snippet,
                      }))
                    : [];
                return { provider: 'serpapi', results };
            }
            if (provider === 'brave' && key) {
                const u = new URL(
                    process.env.SEARCH_BASE_URL ||
                        'https://api.search.brave.com/res/v1/web/search',
                );
                u.searchParams.set('q', query);
                u.searchParams.set('count', String(n));
                const j = await (
                    await fetch(u, { headers: { 'X-Subscription-Token': key } })
                )
                    .json()
                    .catch(() => ({}));
                const results = Array.isArray(j?.web?.results)
                    ? j.web.results.slice(0, n).map((it) => ({
                          title: it.title,
                          url: it.url,
                          snippet: it.description,
                      }))
                    : [];
                return { provider: 'brave', results };
            }
            // Default: DuckDuckGo Instant Answer (no key). If empty results, fallback to HTML + Google News RSS.
            const u = new URL(
                process.env.SEARCH_BASE_URL || 'https://api.duckduckgo.com/',
            );
            u.searchParams.set('q', query);
            u.searchParams.set('format', 'json');
            u.searchParams.set('no_redirect', '1');
            u.searchParams.set('no_html', '1');
            const j = await (await fetch(u)).json().catch(() => ({}));
            let collect = [];
            if (Array.isArray(j?.Results)) {
                for (const r of j.Results)
                    collect.push({
                        title: r.Text || r.Result || r.FirstURL,
                        url: r.FirstURL,
                        snippet: r.Text || '',
                    });
            }
            if (Array.isArray(j?.RelatedTopics)) {
                for (const rt of j.RelatedTopics) {
                    if (rt && typeof rt === 'object' && rt.Text && rt.FirstURL)
                        collect.push({
                            title: rt.Text,
                            url: rt.FirstURL,
                            snippet: rt.Text,
                        });
                    if (Array.isArray(rt?.Topics)) {
                        for (const t of rt.Topics) {
                            if (t && t.Text && t.FirstURL)
                                collect.push({
                                    title: t.Text,
                                    url: t.FirstURL,
                                    snippet: t.Text,
                                });
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
                    const re =
                        /<a[^>]+class=\"[^\"]*(result__a|result__title|result-link)[^\"]*\"[^>]+href=\"([^\"]+)\"[^>]*>(.*?)<\/a>/g;
                    let m;
                    while ((m = re.exec(html)) && items.length < n * 2) {
                        let href = m[2];
                        try {
                            // DDG often redirects via /l/?uddg=URL
                            const u2 = new URL(href, 'https://duckduckgo.com');
                            const real = u2.searchParams.get('uddg');
                            try {
                                if (real) href = decodeURIComponent(real);
                            } catch {}
                        } catch {}
                        const title = m[3].replace(/<[^>]+>/g, '').trim();
                        if (href && title) items.push({ title, url: href, snippet: '' });
                    }
                    collect = items;
                    if (collect.length)
                        return {
                            provider: 'duckduckgo-html',
                            results: collect.slice(0, n),
                        };
                } catch {
                    console.error('DuckDuckGo HTML parsing fallback failed');
                }
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
                        const title = (block.match(
                            /<title><!\[CDATA\[(.*?)\]\]><\/title>/,
                        ) ||
                            block.match(/<title>(.*?)<\/title>/) ||
                            [])[1];
                        const link = (block.match(/<link>(.*?)<\/link>/) || [])[1];
                        if (title && link)
                            items.push({
                                title: title.trim(),
                                url: link.trim(),
                                snippet: '',
                            });
                    }
                    if (items.length)
                        return {
                            provider: 'google-news-rss',
                            results: items.slice(0, n),
                        };
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
        },
    );

    // ---------------- Options tools ----------------
    function buildOccSymbol(underlying, expiration, strike, right) {
        const root = String(underlying || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
        const d = new Date(expiration);
        if (isNaN(d.getTime())) throw new Error('Invalid expiration date');
        const yy = String(d.getUTCFullYear()).slice(-2);
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const cp = String(right || '').toUpperCase().startsWith('P') ? 'P' : 'C';
        const k = Math.round(Number(strike) * 1000);
        const kStr = String(k).padStart(8, '0');
        return `${root}${yy}${mm}${dd}${cp}${kStr}`;
    }

    server.tool(
        'buildOptionContract',
        'Build OCC option contract symbol (e.g., AAPL240920C00190000) from components.',
        { underlying: z.string(), expiration: z.string(), strike: z.number(), right: z.enum(['C', 'P']) },
        async ({ underlying, expiration, strike, right }) => {
            try {
                const symbol = buildOccSymbol(underlying, expiration, strike, right);
                return { content: [{ type: 'text', text: JSON.stringify({ symbol }) }] };
            } catch (e) {
                const err = { error: String(e.message || e) };
                return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
            }
        },
    );

    server.tool(
        'checkOptionPrice',
        'Get latest option price (per contract) for an OCC contract symbol.',
        { contract: z.string() },
        async ({ contract }) => {
            const { price, source, raw } = await getLatestOptionPrice(getAlpaca(), contract);
            const result = { contract, price, source, raw };
            logEvent('tool.checkOptionPrice', { args: { contract }, result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'buyOptions',
        'Place a market buy for option contracts (paper only). Allowed during trading windows or market hours.',
        { contract: z.string(), contracts: z.number().int().min(1), note: z.string().optional() },
        async ({ contract, contracts, note }) => {
            if (!(isWithinTradingWindow() || isWithinMarketHours())) {
                const err = { error: 'Trading not allowed outside configured windows or market hours' };
                logEvent('tool.buyOptions.denied', { args: { contract, contracts, note }, result: err });
                return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
            }
            const order = await placeOptionOrder(getAlpaca(), { contract, qty: contracts, side: 'buy' });
            const result = { order };
            logEvent('tool.buyOptions', { args: { contract, contracts, note }, result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'sellOptions',
        'Place a market sell for option contracts (paper only). Allowed during trading windows or market hours.',
        { contract: z.string(), contracts: z.number().int().min(1), note: z.string().optional() },
        async ({ contract, contracts, note }) => {
            if (!(isWithinTradingWindow() || isWithinMarketHours())) {
                const err = { error: 'Trading not allowed outside configured windows or market hours' };
                logEvent('tool.sellOptions.denied', { args: { contract, contracts, note }, result: err });
                return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
            }
            const order = await placeOptionOrder(getAlpaca(), { contract, qty: contracts, side: 'sell' });
            const result = { order };
            logEvent('tool.sellOptions', { args: { contract, contracts, note }, result });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'viewOptionsPortfolio',
        'List open option positions (contracts)',
        async () => {
            const p = await getOptionPositions(getAlpaca());
            logEvent('tool.viewOptionsPortfolio', { result: p });
            return { content: [{ type: 'text', text: JSON.stringify(p) }] };
        },
    );

    // Scratchpad tools for messaging across windows
    const SCRATCH_FILE = path.join(DATA_DIR, 'scratchpad.jsonl');
    function appendJsonl(file, obj) {
        try {
            fs.appendFileSync(file, JSON.stringify(obj) + '\n');
        } catch {}
    }
    function readJsonl(limit = 500) {
        if (!fs.existsSync(SCRATCH_FILE)) return [];
        const lines = fs.readFileSync(SCRATCH_FILE, 'utf8').trim().split('\n');
        const slice = lines.slice(Math.max(0, lines.length - limit));
        return slice
            .map((l) => {
                try {
                    return JSON.parse(l);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    }

    server.tool(
        'addScratchpad',
        'Leave a scratchpad note for the next window',
        {
            message: z.string(),
            tags: z.array(z.string()).optional(),
            author: z.string().optional(),
        },
        async ({ message, tags, author }) => {
            const entry = {
                ts: new Date().toISOString(),
                author: author || 'agent',
                message,
                tags: tags || [],
            };
            appendJsonl(SCRATCH_FILE, entry);
            logEvent('scratchpad.added', { entry });
            return { content: [{ type: 'text', text: JSON.stringify(entry) }] };
        },
    );

    server.tool(
        'getScratchpad',
        'View recent scratchpad notes',
        { limit: z.number().int().min(1).max(2000).optional() },
        async ({ limit }) => {
            const items = readJsonl(limit || 200);
            return { content: [{ type: 'text', text: JSON.stringify(items) }] };
        },
    );

    await server.connect(transport);
}

module.exports = { startMcpServer };
