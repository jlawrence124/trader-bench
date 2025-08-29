import React, { useEffect, useMemo, useState } from 'react'
import SummaryCards from './components/SummaryCards.jsx'
import EquityChart from './components/EquityChart.jsx'
import Positions from './components/Positions.jsx'
import Logs from './components/Logs.jsx'
import DebugPanel from './components/DebugPanel.jsx'
import ConfigPanel from './components/ConfigPanel.jsx'
import AgentOutput from './components/AgentOutput.jsx'

async function fetchJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('Network error')
  return await r.json()
}

export default function App() {
  const [metrics, setMetrics] = useState(null)
  const [equity, setEquity] = useState([])
  const [spyUSD, setSpyUSD] = useState([])
  const [positions, setPositions] = useState([])
  const [logs, setLogs] = useState([])
  const [account, setAccount] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  const [agent, setAgent] = useState('')
  const [winActive, setWinActive] = useState(false)
  const [winEnd, setWinEnd] = useState(null)
  const [nowTs, setNowTs] = useState(Date.now())
  const [nextLabel, setNextLabel] = useState('')
  const [cfgTz, setCfgTz] = useState('America/New_York')
  const [cfgWindowsCsv, setCfgWindowsCsv] = useState('08:00,09:31,12:00,15:55')
  const [cfgDurMin, setCfgDurMin] = useState(4)
  const [nextStart, setNextStart] = useState(null)
  const [statusTz, setStatusTz] = useState('')

  useEffect(() => {
    const load = async () => {
      const res = await Promise.allSettled([
        fetchJson('/api/metrics'),
        fetchJson('/api/series'),
        fetchJson('/api/positions'),
        fetchJson('/api/logs'),
        fetchJson('/api/account'),
        fetchJson('/api/debug/config')
      ])
      if (res[0].status === 'fulfilled') setMetrics(res[0].value); else console.warn('metrics load failed', res[0].reason)
      if (res[1].status === 'fulfilled') { setEquity(res[1].value.equity || []); setSpyUSD(res[1].value.spyUSD || []) } else console.warn('series load failed', res[1].reason)
      if (res[2].status === 'fulfilled') setPositions(res[2].value); else console.warn('positions load failed', res[2].reason)
      if (res[3].status === 'fulfilled') setLogs(res[3].value); else console.warn('logs load failed', res[3].reason)
      if (res[4].status === 'fulfilled') setAccount(res[4].value); else console.warn('account load failed', res[4].reason)
      if (res[5].status === 'fulfilled') {
        const c = res[5].value
        setAgent(c?.agent || '')
        if (c?.timezone) setCfgTz(c.timezone)
        if (c?.tradingWindows) setCfgWindowsCsv(c.tradingWindows)
        if (typeof c?.windowDurationMinutes === 'number') setCfgDurMin(c.windowDurationMinutes)
      } else console.warn('config load failed', res[5].reason)
    }
    load()
  }, [])

  // No page-level scrolling; components manage their own scroll

  // Periodically refresh core data while dashboard open
  useEffect(() => {
    const id = setInterval(async () => {
      try { setMetrics(await fetchJson('/api/metrics')) } catch {}
      try { const s = await fetchJson('/api/series'); setEquity(s.equity||[]); setSpyUSD(s.spyUSD||[]) } catch {}
      try { setPositions(await fetchJson('/api/positions')) } catch {}
      try { setAccount(await fetchJson('/api/account')) } catch {}
      try { const c = await fetchJson('/api/debug/config'); setAgent(c?.agent || ''); if (c?.timezone) setCfgTz(c.timezone); if (c?.tradingWindows) setCfgWindowsCsv(c.tradingWindows); if (typeof c?.windowDurationMinutes==='number') setCfgDurMin(c.windowDurationMinutes) } catch {}
    }, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const sse = new EventSource('/api/events')
    sse.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data)
        setLogs(prev => {
          if (e?.type === 'logs.cleared') return [e]
          return [...prev, e]
        })
        if (e?.type === 'window.open') {
          setWinActive(true)
          if (e.window?.end) setWinEnd(e.window.end)
          setTab('dashboard')
        } else if (e?.type === 'window.close') {
          setWinActive(false)
          setWinEnd(null)
        }
      } catch {}
    }
    return () => sse.close()
  }, [])

  // Ticker for countdown display while window is active
  useEffect(() => {
    if (!winActive) return
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [winActive])

  // Poll window status for next start countdown (with client-side fallback) and keep a 1s tick
  useEffect(() => {
    let cancelled = false
    const computeFallback = () => {
      try {
        const tz = cfgTz || 'America/New_York'
        const csv = (cfgWindowsCsv || '').split(',').map(s=>s.trim()).filter(Boolean)
        const dur = Number(cfgDurMin || 4)
        const now = new Date()
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' }).formatToParts(now)
        const get = t=>Number((parts.find(p=>p.type===t)||{}).value||'0')
        const hh = get('hour'), mm = get('minute'), ss = get('second')
        const nowMin = hh*60 + mm
        const wins = csv.map(t=>{ const [H,M]=t.split(':').map(Number); return H*60+M }).sort((a,b)=>a-b)
        // Active?
        for (const w of wins) {
          if (nowMin >= w && nowMin < w + dur) {
            const endDeltaSec = (w + dur)*60 - (nowMin*60 + ss)
            setWinActive(true)
            setWinEnd(new Date(Date.now()+Math.max(0,endDeltaSec*1000)).toISOString())
            setNextStart(null)
            setNextLabel('')
            return
          }
        }
        // Next
        let nextMin = null
        for (const w of wins) { if (w > nowMin) { nextMin = w; break } }
        if (nextMin == null && wins.length) nextMin = wins[0] + 1440
        if (nextMin != null) {
          const deltaSec = nextMin*60 - (nowMin*60 + ss)
          setNextStart(new Date(Date.now()+Math.max(0,deltaSec*1000)).toISOString())
          const H = String(Math.floor((nextMin % 1440)/60)).padStart(2,'0')
          const M = String((nextMin % 60)).padStart(2,'0')
          setNextLabel(`${H}:${M}:00`)
          setWinActive(false)
        }
      } catch {}
    }
    const load = async () => {
      try {
        const s = await fetchJson('/api/window/status')
        if (cancelled) return
        if (s?.current?.end) { setWinActive(true); setWinEnd(s.current.end) } else { setWinActive(false) }
        if (s?.next?.start) { setNextStart(s.next.start); setNextLabel('') } else { computeFallback() }
      } catch { computeFallback() }
    }
    load()
    const t1 = setInterval(load, 30000)
    const t2 = setInterval(() => setNowTs(Date.now()), 1000)
    return () => { cancelled = true; clearInterval(t1); clearInterval(t2) }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  const header = useMemo(() => (
    <div className="px-5 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold title">Trader Bench</div>
          <div className="muted">AI Trading Benchmark</div>
        </div>
        <div className="flex items-center gap-4">
          {/* Next window countdown pill (top-right) */}
          <div className="hidden md:flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs title">
            {winActive ? (
              <>
                <span className="text-emerald-500">Open</span>
                <span>Ends {winEnd ? new Date(winEnd).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '—'}</span>
                {winEnd && (() => { const ms = Math.max(0, new Date(winEnd).getTime() - nowTs); const m = Math.floor(ms/60000); const s = Math.floor((ms%60000)/1000); return <span className="muted">• {String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}</span> })()}
              </>
            ) : (
              <>
                <span className="muted">Next</span>
                <span>{nextStart ? new Date(nextStart).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '—'}</span>
                {nextStart && (() => { const ms = Math.max(0, new Date(nextStart).getTime() - nowTs); const h = Math.floor(ms/3600000); const m = Math.floor((ms%3600000)/60000); const s = Math.floor((ms%60000)/1000); return <span className="muted">• {h>0?`${String(h).padStart(2,'0')}:`:''}{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}</span> })()}
              </>
            )}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
            <button onClick={() => setTab('dashboard')} className={`px-3 py-1 text-sm ${tab==='dashboard' ? 'bg-brand-500 text-white' : 'muted bg-white dark:bg-slate-800'}`}>Dashboard</button>
            <button onClick={() => setTab('debug')} className={`px-3 py-1 text-sm ${tab==='debug' ? 'bg-brand-500 text-white' : 'muted bg-white dark:bg-slate-800'}`}>Debug</button>
            <button onClick={() => setTab('config')} className={`px-3 py-1 text-sm ${tab==='config' ? 'bg-brand-500 text-white' : 'muted bg-white dark:bg-slate-800'}`}>Config</button>
          </div>
          <button onClick={() => setTheme(theme==='dark'?'light':'dark')} className="px-3 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 title">
            {theme==='dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>
    </div>
  ), [tab, theme])

  return (
    <div className="app-bg">
      {header}
      {winActive && (
        <div className="max-w-7xl mx-auto px-5">
          <div className="mt-4 mb-0 rounded-lg border border-amber-300 bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700 px-3 py-2 text-sm flex items-center justify-between">
            <div className="font-semibold">Trading Window Open</div>
            <div className="muted">
              Ends at {winEnd ? new Date(winEnd).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '—'}
              {winEnd && (() => { const ms = Math.max(0, new Date(winEnd).getTime() - nowTs); const m = Math.floor(ms/60000); const s = Math.floor((ms%60000)/1000); return ` • ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} remaining` })()}
            </div>
          </div>
        </div>
      )}
      {tab === 'dashboard' ? (
        <div className="max-w-7xl mx-auto px-5 py-6 space-y-6">
          <SummaryCards metrics={metrics} account={account} />
          <AgentOutput logs={logs} agent={agent} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <EquityChart equity={equity} spyUSD={spyUSD} />
            </div>
            <div>
              <Positions positions={positions} />
            </div>
          </div>
          <Logs logs={logs} />
        </div>
      ) : tab === 'debug' ? (
        <div className="max-w-7xl mx-auto px-5 py-6">
          <DebugPanel onEvent={(e)=>setLogs(prev=>[...prev, e])} />
        </div>
      ) : (
        <div className="max-w-4xl mx-auto px-5 py-6">
          <ConfigPanel />
        </div>
      )}
    </div>
  )
}
