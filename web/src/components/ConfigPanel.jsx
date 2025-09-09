import React, { useEffect, useState } from 'react'

async function fetchJson(url, opts) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error(await r.text())
  return await r.json()
}

// CLI agent options removed; built-in LLM agent only

export default function ConfigPanel() {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => { (async ()=>{ try { setCfg(await fetchJson('/api/debug/config')) } catch {} })() }, [])

  const onSave = async () => {
    setSaving(true)
    try {
      const body = {
        agentAutoStart: !!cfg.agentAutoStart,
        alpacaKeyId: cfg.alpacaKeyId || '',
        alpacaDataFeed: cfg.alpacaDataFeed || 'iex',
        // LLM config
        llmProvider: cfg.llmProvider || 'openai',
        llmModel: cfg.llmModel || 'gpt-4o-mini',
        llmBaseUrl: cfg.llmBaseUrl || '',
        llmStreaming: !!cfg.llmStreaming,
      }
      if (cfg.alpacaSecretKey && cfg.alpacaSecretKey !== '********') body.alpacaSecretKey = cfg.alpacaSecretKey
      if (typeof cfg.llmApiKey === 'string') body.llmApiKey = cfg.llmApiKey
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
        <div className="text-sm muted mb-3">Agent</div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-3 rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200">
            Built-in LLM agent (MCP tools only). Configure API below.
          </div>
          <label className="flex items-center gap-2 md:col-span-3">
            <input type="checkbox" checked={!!cfg.agentAutoStart} onChange={e=>setCfg({...cfg, agentAutoStart: e.target.checked})} />
            <span className="muted text-sm">Auto-start built-in agent on window open; stop on close</span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button disabled={saving} onClick={onSave} className="px-4 py-2 rounded bg-brand-600 text-white">{saving?'Saving…':'Save'}</button>
          {savedAt && <div className="muted text-xs">Saved {savedAt.toLocaleTimeString()}</div>}
        </div>
      </div>

      <div className="card">
        <div className="text-sm muted mb-3">LLM API (Built-in Agent)</div>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="block">
            <div className="muted text-xs mb-1">Provider</div>
            <select
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              value={cfg.llmProvider || 'openai'}
              onChange={e=>setCfg({...cfg, llmProvider: e.target.value})}
            >
              <option value="openai">OpenAI</option>
              <option value="openai-compatible">OpenAI-Compatible</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="gemini">Google Gemini</option>
              <option value="mistral">Mistral</option>
              <option value="deepseek">DeepSeek</option>
              <option value="grok">xAI Grok</option>
              <option value="qwen">Qwen (DashScope compat)</option>
            </select>
          </label>
          <label className="block">
            <div className="muted text-xs mb-1">Model</div>
            <input
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              placeholder="e.g., gpt-4o-mini"
              value={cfg.llmModel || ''}
              onChange={e=>setCfg({...cfg, llmModel: e.target.value})}
            />
          </label>
          <label className="block">
            <div className="muted text-xs mb-1">Base URL (optional)</div>
            <input
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              placeholder="https://api.openai.com/v1"
              value={cfg.llmBaseUrl || ''}
              onChange={e=>setCfg({...cfg, llmBaseUrl: e.target.value})}
            />
          </label>
          <label className="block">
            <div className="muted text-xs mb-1">API Key</div>
            <input
              type="password"
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
              placeholder={cfg.llmApiKeySet ? '********' : ''}
              value={cfg.llmApiKey || ''}
              onChange={e=>setCfg({...cfg, llmApiKey: e.target.value})}
            />
          </label>
          <label className="block flex items-center gap-2">
            <input type="checkbox" checked={!!cfg.llmStreaming} onChange={e=>setCfg({...cfg, llmStreaming: e.target.checked})} />
            <span className="title">Streaming (best-effort)</span>
          </label>
          <div className="flex items-end gap-3">
            <button disabled={saving} onClick={onSave} className="px-4 py-2 rounded bg-brand-600 text-white">{saving?'Saving…':'Save'}</button>
            <button
              onClick={async()=>{
                try {
                  const r = await fetchJson('/api/debug/test-llm', { method: 'POST' })
                  alert(r.ok ? `OK • ${r.model}\n${r.content||''}` : JSON.stringify(r))
                } catch (e) {
                  alert(String(e))
                }
              }}
              className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 title"
            >
              Test LLM
            </button>
          </div>
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
          <li>The built-in agent runs against MCP tools provided by this server.</li>
          <li>Use the Debug tab to open a one-off window or leave a scratchpad note for the next scheduled window.</li>
        </ul>
      </div>
    </div>
  )
}
