import React, { useEffect, useMemo, useRef } from 'react'

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
  if (e.type === 'debug.note') return `${t} • Note: ${e.message}`
  if (e.type === 'scratchpad.added') return `${t} • Scratch: ${e.entry?.message}`
  if (e.type?.endsWith('.error')) return `${t} • Error: ${e.error}`
  return `${t} • ${e.type}`
}

export default function AgentOutput({ logs, agent }) {
  const list = useMemo(() => {
    return (logs || []).slice(-100).map((e, i) => ({ id: i, text: formatEvent(e), raw: e }))
  }, [logs])
  // Scroll only the card content, never the page
  const containerRef = useRef(null)
  useEffect(() => {
    const c = containerRef.current
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [list])
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm muted">Agent Output</div>
        {agent && <div className="text-xs muted">Agent: <span className="title">{agent}</span></div>}
      </div>
      <div ref={containerRef} className="text-xs space-y-1 max-h-56 overflow-auto">
        {list.map(item => (
          <div key={item.id} className="title">{item.text}</div>
        ))}
      </div>
    </div>
  )
}
