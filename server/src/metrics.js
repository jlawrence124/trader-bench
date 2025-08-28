function seriesToReturns(series) {
  // series: [{ts, value}]
  const ret = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i-1].value;
    const cur = series[i].value;
    if (prev > 0) ret.push((cur - prev) / prev);
  }
  return ret;
}

function cumulativeReturn(series) {
  if (!series.length) return 0;
  const start = series[0].value;
  const end = series[series.length - 1].value;
  if (start === 0) return 0;
  return (end - start) / start;
}

function maxDrawdown(series) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const p of series) {
    if (p.value > peak) peak = p.value;
    if (peak > 0) {
      const dd = (peak - p.value) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = mean(arr.map(x => (x - m) * (x - m)));
  return Math.sqrt(v);
}

function sharpe(series, riskFreeRate = 0) {
  // naive Sharpe using sample returns; assumes returns are per-sample
  const rets = seriesToReturns(series);
  if (!rets.length) return 0;
  const excess = rets.map(r => r - riskFreeRate);
  const s = std(excess);
  if (s === 0) return 0;
  return mean(excess) / s;
}

module.exports = {
  cumulativeReturn,
  maxDrawdown,
  sharpe,
};
