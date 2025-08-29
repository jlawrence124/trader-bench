import React from 'react'

export default function SummaryCards({ metrics, account }) {
  const fmtPct = (x) => {
    if (x == null || Number.isNaN(x)) return '—'
    const pct = x * 100
    const abs = Math.abs(pct)
    // Avoid displaying "-0.00%"
    if (abs < 0.005) return '0.00%'
    const decimals = abs >= 0.1 ? 2 : abs >= 0.01 ? 3 : 4
    return `${pct.toFixed(decimals)}%`
  }
  const fmtUsd = (x) => (x == null ? '—' : `$${Number(x).toLocaleString(undefined, {maximumFractionDigits: 2})}`)
  const items = [
    { label: 'Equity Return', value: metrics ? fmtPct(metrics.equityReturn) : '—' },
    { label: 'Alpha', value: metrics ? fmtPct(metrics.alpha) : '—' },
    { label: 'Max Drawdown', value: metrics ? fmtPct(metrics.maxDrawdown) : '—' },
    { label: 'Account Equity', value: account ? fmtUsd(account.equity) : '—' },
    { label: 'Cash', value: account ? fmtUsd(account.cash) : '—' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((it) => (
        <div key={it.label} className="card">
          <div className="text-xs uppercase tracking-wide muted">{it.label}</div>
          <div className="text-xl font-semibold mt-1 title">{it.value}</div>
        </div>
      ))}
    </div>
  )
}
