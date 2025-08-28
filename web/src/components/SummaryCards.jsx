import React from 'react'

export default function SummaryCards({ metrics, account }) {
  const fmtPct = (x) => `${(x * 100).toFixed(2)}%`
  const fmtUsd = (x) => (x == null ? '—' : `$${Number(x).toLocaleString(undefined, {maximumFractionDigits: 2})}`)
  const items = [
    { label: 'Equity Return', value: metrics ? fmtPct(metrics.equityReturn) : '—' },
    { label: 'SPY Return', value: metrics ? fmtPct(metrics.benchReturn) : '—' },
    { label: 'Alpha', value: metrics ? fmtPct(metrics.alpha) : '—' },
    { label: 'Max Drawdown', value: metrics ? fmtPct(metrics.maxDrawdown) : '—' },
    { label: 'Sharpe (est.)', value: metrics ? metrics.sharpe.toFixed(2) : '—' },
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
