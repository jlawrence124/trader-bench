function createClient() {
  const keyId = process.env.ALPACA_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) {
    throw new Error('Missing ALPACA_KEY_ID/ALPACA_SECRET_KEY');
  }
  const base = 'https://paper-api.alpaca.markets';
  const dataBase = 'https://data.alpaca.markets';
  const feed = (process.env.ALPACA_DATA_FEED || 'iex').toLowerCase();
  const baseHeaders = {
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secretKey,
  };
  return { base, dataBase, headers: baseHeaders, feed };
}

async function doJson(method, url, headers, body) {
  const reqHeaders = {
    ...headers,
    'Accept': 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    'User-Agent': 'trader-bench/0.1'
  };
  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Alpaca ${method} ${url} failed: ${res.status} ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return await res.json();
}

const https = require('node:https');

function httpsJson(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: headers || {},
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)); }
        } else {
          const err = new Error(`Alpaca ${method} ${urlStr} failed: ${res.statusCode} ${data}`);
          err.status = res.statusCode;
          err.body = data;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getAccount(client) {
  const account = await httpsJson('GET', `${client.base}/v2/account`, client.headers);
  return {
    id: account.id,
    status: account.status,
    cash: Number(account.cash),
    equity: Number(account.equity),
    buyingPower: Number(account.buying_power || account.buyingPower || 0),
    portfolioValue: Number(account.portfolio_value || account.portfolioValue || account.equity),
  };
}

async function getPositions(client) {
  const positions = await httpsJson('GET', `${client.base}/v2/positions`, client.headers);
  return positions.map(p => ({
    symbol: p.symbol,
    qty: Number(p.qty),
    avgEntryPrice: Number(p.avg_entry_price || p.avgEntryPrice || 0),
    marketPrice: Number(p.current_price || p.currentPrice || 0),
    unrealizedPL: Number(p.unrealized_pl || p.unrealizedPL || 0),
    side: p.side,
  }));
}

async function placeOrder(client, { symbol, qty, side }) {
  const body = { symbol, qty: String(qty), side, type: 'market', time_in_force: 'day' };
  const order = await doJson('POST', `${client.base}/v2/orders`, client.headers, body);
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    qty: Number(order.qty),
    status: order.status,
    submittedAt: order.submitted_at || order.submittedAt,
  };
}

async function fetchYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'trader-bench/0.1' } });
  if (!res.ok) throw new Error(`Yahoo quote failed: ${res.status}`);
  const json = await res.json();
  const r = json?.quoteResponse?.result?.[0];
  const price = r?.regularMarketPrice ?? r?.postMarketPrice ?? r?.preMarketPrice ?? null;
  return { symbol, price, raw: r };
}

async function fetchYahooChartPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const res = await fetch(url, { headers: { 'User-Agent': 'trader-bench/0.1' } });
  if (!res.ok) throw new Error(`Yahoo chart failed: ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  let price = null;
  if (Array.isArray(closes)) {
    for (let i = closes.length - 1; i >= 0; i--) {
      if (typeof closes[i] === 'number') { price = closes[i]; break; }
    }
  }
  return { symbol, price, raw: result };
}

async function getLatestPrice(client, symbol) {
  const base = `${client.dataBase}/v2/stocks/${encodeURIComponent(symbol)}`;
  const attempts = [];
  const tryEndpoint = async (path, pick, sourceLabel) => {
    try {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${base}${path}${sep}feed=${encodeURIComponent(client.feed)}`;
      const json = await doJson('GET', url, client.headers);
      const price = pick(json);
      if (typeof price === 'number' && isFinite(price)) {
        return { symbol, price, source: sourceLabel, raw: json };
      }
      attempts.push(`${sourceLabel}:no-price`);
      return null;
    } catch (e) {
      attempts.push(`${sourceLabel}:${e.status||'err'}`);
      return null;
    }
  };

  // Prefer endpoints commonly available on free/IEX data
  const r1 = await tryEndpoint('/trades/latest', j => j?.trade?.p, 'alpaca-trade-latest');
  if (r1) return r1;
  const r2 = await tryEndpoint('/quotes/latest', j => j?.quote?.ap ?? (j?.quote?.bp && j?.quote?.ap ? (j.quote.bp + j.quote.ap)/2 : null), 'alpaca-quote-latest');
  if (r2) return r2;
  const r3 = await tryEndpoint('/bars/latest', j => j?.bar?.c, 'alpaca-bar-latest');
  if (r3) return r3;
  const r4 = await tryEndpoint('/snapshot', j => j?.latestTrade?.p ?? j?.latestQuote?.ap ?? j?.minuteBar?.c ?? null, 'alpaca-snapshot');
  if (r4) return r4;

  // Yahoo fallbacks
  try {
    const y = await fetchYahooPrice(symbol);
    if (typeof y.price === 'number' && isFinite(y.price)) return { ...y, source: 'yahoo-quote' };
  } catch (e) {
    attempts.push(`yahoo-quote:${e.status||'err'}`);
  }
  try {
    const y2 = await fetchYahooChartPrice(symbol);
    if (typeof y2.price === 'number' && isFinite(y2.price)) return { ...y2, source: 'yahoo-chart' };
  } catch (e) {
    attempts.push(`yahoo-chart:${e.status||'err'}`);
  }

  throw new Error(`Price lookup failed for ${symbol}. Attempts: ${attempts.join(', ')}`);
}

module.exports = { createClient, getAccount, getPositions, placeOrder, getLatestPrice };
