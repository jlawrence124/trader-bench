const fs = require('fs');
const path = require('path');

// Resolve DATA_DIR robustly: if env provides a relative path, resolve it
// relative to the server root (one level up from this file). Defaults to
// `<repo>/server/data` when unset.
const SERVER_ROOT = path.join(__dirname, '..');
const ENV_DATA_DIR = process.env.DATA_DIR;
const DATA_DIR = ENV_DATA_DIR
  ? (path.isAbsolute(ENV_DATA_DIR) ? ENV_DATA_DIR : path.resolve(SERVER_ROOT, ENV_DATA_DIR))
  : path.join(SERVER_ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(DATA_DIR, 'event-log.jsonl');

const sseClients = new Set();

function addSseClient(res) {
  sseClients.add(res);
  res.on('close', () => {
    sseClients.delete(res);
  });
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function logEvent(type, payload) {
  const event = {
    ts: new Date().toISOString(),
    type,
    ...payload,
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(event) + '\n');
  } catch (e) {
    // avoid stdout noise; no-op
  }
  broadcast(event);
  return event;
}

function readRecentLogs(limit = 500) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  const slice = lines.slice(Math.max(0, lines.length - limit));
  return slice.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

module.exports = {
  addSseClient,
  logEvent,
  readRecentLogs,
  DATA_DIR,
};
