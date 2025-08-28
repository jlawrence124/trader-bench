import React, { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function EquityChart({ equity, spyUSD }) {
  const fmt = (ms) => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
  const { data, eqCount, spyCount, domain } = useMemo(() => {
    // Merge by timestamp
    const map = new Map()
    for (const p of equity || []) {
      map.set(p.ts, { ts: p.ts, equity: p.value })
    }
    for (const p of spyUSD || []) {
      const row = map.get(p.ts) || { ts: p.ts }
      row.spyUSD = p.value
      map.set(p.ts, row)
    }
    const arr = Array.from(map.values()).sort((a,b)=>new Date(a.ts)-new Date(b.ts))
    for (const r of arr) r.tsNum = new Date(r.ts).getTime()
    const eqCount = arr.filter(r => typeof r.equity === 'number').length
    const spyCount = arr.filter(r => typeof r.spyUSD === 'number').length
    let domain = undefined
    if (arr.length) {
      const minTs = arr[0].tsNum
      const maxTs = arr[arr.length - 1].tsNum
      const span = Math.max(0, maxTs - minTs)
      const minWindow = 10 * 60 * 1000 // show at least 10 minutes
      const win = Math.max(span, minWindow)
      domain = [maxTs - win, maxTs]
    }
    return { data: arr, eqCount, spyCount, domain }
  }, [equity, spyUSD])

  if ((eqCount + spyCount) === 0) {
    return (
      <div className="card h-85 flex items-center justify-center">
        <div className="muted text-sm">Waiting for first samples…</div>
      </div>
    )
  }

  return (
    <div className="card h-85">
      <div className="text-sm muted">Portfolio Value vs. SPY (USD equivalent)</div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis
            dataKey="tsNum"
            type="number"
            scale="time"
            domain={domain || ['auto','auto']}
            tickFormatter={fmt}
            minTickGap={40}
          />
          <YAxis domain={['auto', 'auto']} />
          <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} />
          <Legend />
          <Line
            type="monotone"
            dataKey="equity"
            stroke="#2563eb"
            name="Equity"
            dot={eqCount < 2 ? { r: 3 } : false}
            connectNulls
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="spyUSD"
            stroke="#16a34a"
            name="SPY (USD equiv.)"
            dot={spyCount < 2 ? { r: 3 } : false}
            connectNulls
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
