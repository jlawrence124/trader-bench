const { DateTime, Interval } = require('luxon');

let overrides = null; // { tz, tradingWindowsCsv, durationMin }
let adhoc = null; // { start: DateTime, end: DateTime }

function setOverrides(o) { overrides = o; }
function clearOverrides() { overrides = null; }

function parseWindowsFromEnv() {
  const tz = (overrides?.tz) || process.env.TIMEZONE || 'America/New_York';
  const csvRaw = (overrides?.tradingWindowsCsv) || process.env.TRADING_WINDOWS || '08:00,09:31,12:00,15:55';
  const csv = csvRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const durationMin = overrides?.durationMin ?? parseInt(process.env.WINDOW_DURATION_MINUTES || '4', 10);
  const now = DateTime.now().setZone(tz);
  const windows = csv.map((hhmm, idx) => {
    const [h, m] = hhmm.split(':').map(Number);
    const start = DateTime.fromObject({ year: now.year, month: now.month, day: now.day, hour: h, minute: m }, { zone: tz });
    const end = start.plus({ minutes: durationMin });
    return { id: `w${idx+1}`, start, end };
  });
  // Include adhoc window if active
  if (adhoc) {
    windows.push({ id: 'adhoc', start: adhoc.start, end: adhoc.end });
  }
  return { tz, windows, durationMin };
}

function buildWindowsForDay(day) {
  const tz = (overrides?.tz) || process.env.TIMEZONE || 'America/New_York';
  const csvRaw = (overrides?.tradingWindowsCsv) || process.env.TRADING_WINDOWS || '08:00,09:31,12:00,15:55';
  const csv = csvRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const durationMin = overrides?.durationMin ?? parseInt(process.env.WINDOW_DURATION_MINUTES || '4', 10);
  const d = day.setZone(tz);
  const windows = csv.map((hhmm, idx) => {
    const [h, m] = hhmm.split(':').map(Number);
    const start = DateTime.fromObject({ year: d.year, month: d.month, day: d.day, hour: h, minute: m }, { zone: tz });
    const end = start.plus({ minutes: durationMin });
    return { id: `w${idx+1}`, start, end };
  });
  return { tz, windows, durationMin };
}

function isWeekend(dt) {
  const wk = dt.weekday; // 1=Mon..7=Sun
  return wk === 6 || wk === 7;
}

function isWithinTradingWindow(dt = DateTime.now().setZone(process.env.TIMEZONE || 'America/New_York')) {
  const { windows } = parseWindowsFromEnv();
  if (isWeekend(dt)) return false;
  return windows.some(w => Interval.fromDateTimes(w.start, w.end).contains(dt));
}

// Basic US market hours check (09:30–16:00 in configured TIMEZONE; holidays not considered)
function isWithinMarketHours(dt = DateTime.now().setZone(process.env.TIMEZONE || 'America/New_York')) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const now = DateTime.fromISO(dt.toISO(), { zone: tz });
  if (isWeekend(now)) return false;
  const open = DateTime.fromObject({ year: now.year, month: now.month, day: now.day, hour: 9, minute: 30 }, { zone: tz });
  const close = DateTime.fromObject({ year: now.year, month: now.month, day: now.day, hour: 16, minute: 0 }, { zone: tz });
  return Interval.fromDateTimes(open, close).contains(now);
}

function scheduleToday(onOpen, onClose) {
  const { tz, windows } = parseWindowsFromEnv();
  const now = DateTime.now().setZone(tz);
  if (isWeekend(now)) return [];
  const timers = [];
  for (const w of windows) {
    if (w.end <= now) continue;
    const openDelay = Math.max(0, w.start.toMillis() - now.toMillis());
    const closeDelay = Math.max(0, w.end.toMillis() - now.toMillis());
    timers.push(setTimeout(() => onOpen && onOpen({ id: w.id, start: w.start.toISO(), end: w.end.toISO() }), openDelay));
    timers.push(setTimeout(() => onClose && onClose({ id: w.id, start: w.start.toISO(), end: w.end.toISO() }), closeDelay));
  }
  return timers;
}

function openAdhocWindow(durationMin = 4, tz = process.env.TIMEZONE || 'America/New_York') {
  const start = DateTime.now().setZone(tz).startOf('minute');
  const end = start.plus({ minutes: durationMin });
  adhoc = { start, end };
  return { start: start.toISO(), end: end.toISO() };
}

function clearAdhocWindow() { adhoc = null; }

function getWindowStatus() {
  const { tz } = parseWindowsFromEnv();
  let now = DateTime.now().setZone(tz);
  const today = buildWindowsForDay(now);
  // Include adhoc if active (parseWindowsFromEnv already folds it into today)
  const withAdhoc = parseWindowsFromEnv();
  const windowsToday = withAdhoc.windows
    .filter(w => w.start.hasSame(now, 'day'))
    .sort((a,b) => a.start.toMillis() - b.start.toMillis());
  let current = null;
  for (const w of withAdhoc.windows) {
    if (Interval.fromDateTimes(w.start, w.end).contains(now)) {
      current = { id: w.id, start: w.start.toISO(), end: w.end.toISO() };
      break;
    }
  }
  // Next window start (today or following days up to 7 ahead)
  let next = null;
  const findNextIn = (arr) => {
    let best = null;
    for (const w of arr) {
      if (w.start.toMillis() > now.toMillis()) {
        if (!best || w.start.toMillis() < best.start.toMillis()) best = w;
      }
    }
    return best;
  };
  const todayNext = findNextIn(windowsToday);
  if (todayNext) next = todayNext;
  else {
    // search ahead up to 7 days
    for (let i = 1; i <= 7 && !next; i++) {
      const day = now.plus({ days: i });
      if (isWeekend(day)) continue;
      const d = buildWindowsForDay(day);
      const n = d.windows.sort((a,b)=>a.start.toMillis()-b.start.toMillis())[0] || null;
      if (n) next = n;
    }
  }
  const res = {
    tz,
    now: now.toISO(),
    active: !!current,
    current,
    next: next ? { id: next.id, start: next.start.toISO(), end: next.end.toISO() } : null,
  };
  return res;
}

module.exports = {
  parseWindowsFromEnv,
  isWithinTradingWindow,
  isWithinMarketHours,
  scheduleToday,
  setOverrides,
  clearOverrides,
  openAdhocWindow,
  clearAdhocWindow,
  getWindowStatus,
  buildWindowsForDay,
};
