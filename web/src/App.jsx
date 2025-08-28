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
      if (res[5].status === 'fulfilled') setAgent(res[5].value?.agent || ''); else console.warn('config load failed', res[5].reason)
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
      try { const c = await fetchJson('/api/debug/config'); setAgent(c?.agent || '') } catch {}
    }, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const sse = new EventSource('/api/events')
    sse.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data)
        setLogs(prev => [...prev, e])
      } catch {}
    }
    return () => sse.close()
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
          <div className="muted">AI Trading Benchmark • Paper • MCP</div>
        </div>
        <div className="flex items-center gap-4">
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
