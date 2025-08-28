import React, { useEffect, useMemo, useRef, useState } from 'react'

function formatEvent(e) {
  const t = new Date(e.ts).toLocaleTimeString()
  if (e.type === 'window.open') return `${t} • Window opened (${e.window?.id})`
  if (e.type === 'window.close') return `${t} • Window closed (${e.window?.id})`
  if (e.type?.startsWith('tool.')) {
    const name = e.type.replace('tool.', '')
    const args = e.args ? JSON.stringify(e.args) : ''
    let result = ''
    if (e.result?.order) result = ` -> ${e.result.order.status || 'submitted'}`
    else if (e.result?.price) result = ` -> $${e.result.price}`
    else if (e.result) result = ` -> ok`
    return `${t} • ${name} ${args}${result}`
  }
  if (e.type === 'agent.preamble') {
    const msg = e.message || 'Window preamble'
    return `${t} • Preamble: ${String(msg).slice(0, 140)}`
  }
  if (e.type === 'agent.start.suggested') {
    return `${t} • Start agent: ${e.agent || ''} ${e.command ? `→ ${e.command}` : ''}`
  }
  if (e.type === 'agent.started') return `${t} • Agent started (pid ${e.pid})`
  if (e.type === 'agent.stopping') return `${t} • Agent stopping (pid ${e.pid})`
  if (e.type === 'agent.exited') return `${t} • Agent exited (code ${e.code ?? '—'}, signal ${e.signal ?? '—'})`
  if (e.type === 'agent.stdout') return `${t} • ${e.line}`
  if (e.type === 'agent.stderr') return `${t} • [stderr] ${e.line}`
  if (e.type === 'debug.note') return `${t} • Note: ${e.message}`
  if (e.type === 'scratchpad.added') return `${t} • Scratch: ${e.entry?.message}`
  if (e.type?.endsWith('.error')) return `${t} • Error: ${e.error}`
  return `${t} • ${e.type}`
}

export default function AgentOutput({ logs, agent }) {
  // Session-only clear support via sessionStorage cutoff timestamp
  const [cutoff, setCutoff] = useState(() => {
    try { const s = sessionStorage.getItem('agentOutputCutoffTs'); return s ? Number(s) : 0 } catch { return 0 }
  })
  const clearSession = () => {
    const ts = Date.now()
    try { sessionStorage.setItem('agentOutputCutoffTs', String(ts)) } catch {}
    setCutoff(ts)
  }
  const filtered = useMemo(() => {
    const arr = Array.isArray(logs) ? logs : []
    if (!cutoff) return arr
    return arr.filter(e => {
      const t = new Date(e.ts).getTime()
      return !Number.isFinite(cutoff) || (Number.isFinite(t) ? t >= cutoff : true)
    })
  }, [logs, cutoff])
  const list = useMemo(() => {
    const recent = filtered.slice(-100)
    return recent.map((e, i) => ({ id: i, text: formatEvent(e), raw: e }))
  }, [filtered])
  // Scroll only the card content, never the page
  const containerRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const copyAll = async () => {
    try {
      const text = list.map((i) => i.text).join('\n')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }
  useEffect(() => {
    const c = containerRef.current
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [list])
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm muted">Agent Output</div>
        <div className="flex items-center gap-2">
          {agent && <div className="text-xs muted">Agent: <span className="title">{agent}</span></div>}
          <button
            className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={copyAll}
            title="Copy visible output"
          >{copied ? 'Copied' : 'Copy'}</button>
          <button
            className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={clearSession}
            title="Clear output for this browser session"
          >Clear</button>
        </div>
      </div>
      <div ref={containerRef} className="text-xs space-y-1 max-h-56 overflow-auto">
        {list.map(item => (
          <div key={item.id} className="title">{item.text}</div>
        ))}
      </div>
    </div>
  )
}
