import React, { useEffect, useState } from 'react'

async function fetchJson(url, opts) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error(await r.text())
  return await r.json()
}

const AGENTS = ['CodexCLI', 'Claude Code', 'OpenCode', 'GeminiCLI']

export default function ConfigPanel() {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => { (async ()=>{ try { setCfg(await fetchJson('/api/debug/config')) } catch {} })() }, [])

  const onSave = async () => {
    setSaving(true)
    try {
      const updated = await fetchJson('/api/debug/config', { method: 'PUT', body: JSON.stringify({ agent: cfg.agent, agentStartCommand: cfg.agentStartCommand || '' }) })
      setCfg(updated)
      setSavedAt(new Date())
    } catch (e) {
      console.error(e)
    } finally { setSaving(false) }
  }

  if (!cfg) return <div className="muted">Loading config…</div>

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="text-sm muted mb-3">Trading Agent</div>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="block md:col-span-2">
            <div className="muted text-xs mb-1">Agent Implementation</div>
            <select
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              value={cfg.agent}
              onChange={e=>setCfg({...cfg, agent: e.target.value})}
            >
              {AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="block md:col-span-3">
            <div className="muted text-xs mb-1">Agent Start Command (optional)</div>
            <input
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              placeholder="e.g., codex mcp --connect ./server"
              value={cfg.agentStartCommand || ''}
              onChange={e=>setCfg({...cfg, agentStartCommand: e.target.value})}
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button disabled={saving} onClick={onSave} className="px-4 py-2 rounded bg-brand-600 text-white">{saving?'Saving…':'Save'}</button>
          {savedAt && <div className="muted text-xs">Saved {savedAt.toLocaleTimeString()}</div>}
        </div>
      </div>

      <div className="card">
        <div className="text-sm muted mb-2">Instructions</div>
        <ul className="list-disc pl-6 text-sm muted space-y-1">
          <li>The selected agent is stored server-side and can be used by your orchestration to pick which MCP client to launch.</li>
          <li>All agents interact exclusively through the MCP tools provided by this server.</li>
          <li>Use the Debug tab to open a one-off window or leave a scratchpad note for the next scheduled window.</li>
        </ul>
      </div>
    </div>
  )
}
