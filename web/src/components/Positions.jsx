import React from 'react'

export default function Positions({ positions }) {
  return (
    <div className="card">
      <div className="text-sm muted mb-2">Open Positions</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm title">
          <thead>
            <tr className="text-left muted">
              <th className="py-2 pr-4">Symbol</th>
              <th className="py-2 pr-4">Qty</th>
              <th className="py-2 pr-4">Avg Price</th>
              <th className="py-2 pr-4">Market</th>
              <th className="py-2 pr-4">Unrealized P/L</th>
              <th className="py-2 pr-4">Side</th>
            </tr>
          </thead>
          <tbody>
            {positions?.length ? positions.map((p) => (
              <tr key={p.symbol} className="border-t border-slate-100 dark:border-slate-700">
                <td className="py-2 pr-4 font-semibold">{p.symbol}</td>
                <td className="py-2 pr-4">{p.qty}</td>
                <td className="py-2 pr-4">{p.avgEntryPrice?.toFixed(2)}</td>
                <td className="py-2 pr-4">{p.marketPrice?.toFixed(2)}</td>
                <td className="py-2 pr-4">{p.unrealizedPL?.toFixed(2)}</td>
                <td className="py-2 pr-4">{p.side}</td>
              </tr>
            )) : (
              <tr><td className="py-3 muted" colSpan={6}>No open positions</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
