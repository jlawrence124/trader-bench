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
      const body = {
        agent: cfg.agent,
        agentStartCommand: cfg.agentStartCommand || '',
        agentAutoStart: !!cfg.agentAutoStart,
        alpacaKeyId: cfg.alpacaKeyId || '',
        alpacaDataFeed: cfg.alpacaDataFeed || 'iex',
      }
      if (cfg.alpacaSecretKey && cfg.alpacaSecretKey !== '********') body.alpacaSecretKey = cfg.alpacaSecretKey
      const updated = await fetchJson('/api/debug/config', { method: 'PUT', body: JSON.stringify(body) })
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
          <label className="flex items-center gap-2 md:col-span-3">
            <input type="checkbox" checked={!!cfg.agentAutoStart} onChange={e=>setCfg({...cfg, agentAutoStart: e.target.checked})} />
            <span className="muted text-sm">Auto-start agent process on window open and stop on close</span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button disabled={saving} onClick={onSave} className="px-4 py-2 rounded bg-brand-600 text-white">{saving?'Saving…':'Save'}</button>
          {savedAt && <div className="muted text-xs">Saved {savedAt.toLocaleTimeString()}</div>}
        </div>
      </div>

      <div className="card">
        <div className="text-sm muted mb-3">Alpaca Paper Trading</div>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="block">
            <div className="muted text-xs mb-1">API Key ID</div>
            <input
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              value={cfg.alpacaKeyId || ''}
              onChange={e=>setCfg({...cfg, alpacaKeyId: e.target.value})}
            />
          </label>
          <label className="block">
            <div className="muted text-xs mb-1">API Secret Key</div>
            <input
              type="password"
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              placeholder={cfg.alpacaSecretSet ? '********' : ''}
              value={cfg.alpacaSecretKey || ''}
              onChange={e=>setCfg({...cfg, alpacaSecretKey: e.target.value})}
            />
          </label>
          <label className="block">
            <div className="muted text-xs mb-1">Market Data Feed</div>
            <select
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              value={cfg.alpacaDataFeed || 'iex'}
              onChange={e=>setCfg({...cfg, alpacaDataFeed: e.target.value})}
            >
              <option value="iex">IEX (free)</option>
              <option value="sip">SIP (paid)</option>
            </select>
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
