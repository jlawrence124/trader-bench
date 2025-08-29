import React, { useMemo } from 'react'
import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function EquityChart({ equity, spyUSD }) {
  const fmt = (ms) => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
  const fmtMoneyShort = (v) => {
    if (typeof v !== 'number' || !isFinite(v)) return ''
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `$${(v/1_000_000).toFixed(0)}m`
    if (abs >= 1_000) return `$${(v/1_000).toFixed(0)}k`
    return `$${Math.round(v)}`
  }
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

  // Build a stable Y-axis domain with a small dynamic pad and a formatter
  const { yDomain, fmtAxis } = useMemo(() => {
    const values = []
    for (const r of data || []) {
      if (typeof r.equity === 'number') values.push(r.equity)
      if (typeof r.spyUSD === 'number') values.push(r.spyUSD)
    }
    if (!values.length) return { yDomain: ['auto','auto'], fmtAxis: (v) => String(v) }
    const min = Math.min(...values)
    const max = Math.max(...values)
    let span = Math.max(1, max - min)
    // Keep a tight domain so subtle changes are visible; small absolute pad
    const pad = Math.max(span * 0.02, 5)
    const dom = [min - pad, max + pad]
    const fmtAxis = (v) => {
      if (!isFinite(v)) return ''
      if (span < 20000) return `$${Math.round(v).toLocaleString()}`
      if (span < 1_000_000) return `$${Math.round(v/1000).toLocaleString()}k`
      return `$${(v/1_000_000).toFixed(1)}m`
    }
    return { yDomain: dom, fmtAxis }
  }, [data])

  if ((eqCount + spyCount) === 0) {
    return (
      <div className="card h-80 flex items-center justify-center">
        <div className="muted text-sm">Waiting for first samples…</div>
      </div>
    )
  }

  return (
    <div className="card h-80">
      <div className="text-sm muted">Portfolio Value vs. SPY (USD equivalent)</div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-color, rgba(148,163,184,0.2))" />
          <XAxis
            dataKey="tsNum"
            type="number"
            scale="time"
            domain={domain || ['auto','auto']}
            tickFormatter={fmt}
            minTickGap={40}
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={fmtAxis}
            tick={{ fontSize: 12 }}
            tickMargin={10}
            width={72}
            axisLine={false}
            tickLine={false}
            tickCount={5}
          />
          <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} formatter={(value, name) => [fmtMoneyShort(value), name]} />
          {/* Equity as filled area with themed line */}
          <Area
            type="monotone"
            dataKey="equity"
            name="Equity"
            stroke="#3b82f6"
            strokeWidth={2.25}
            fill="url(#equityFill)"
            dot={eqCount < 2 ? { r: 3 } : false}
            activeDot={{ r: 4 }}
            connectNulls
          />
          {/* SPY baseline as subtle dashed line */}
          <Line
            type="monotone"
            dataKey="spyUSD"
            name="SPY (USD equiv.)"
            stroke="#94a3b8"
            strokeDasharray="5 5"
            opacity={0.8}
            dot={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
