import React, { useEffect, useRef, useState } from 'react'
import JsonTree from './JsonTree.jsx'

export default function Logs({ logs }) {
  const containerRef = useRef(null)
  const [copied, setCopied] = useState(null)
  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1200)
    } catch {
      // noop
    }
  }
  // Keep the log card scrolled internally without moving the page
  useEffect(() => {
    const c = containerRef.current
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [logs])
  return (
    <div ref={containerRef} className="card h-80 overflow-auto">
      <div className="text-sm muted mb-2">Live Logs</div>
      <ul className="space-y-2">
        {logs.map((e, idx) => (
          <li key={idx}>
            <details className="group text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded">
              <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                <span className="muted truncate">{new Date(e.ts).toLocaleString()} • {e.type}</span>
                <div className="flex items-center gap-2">
                  <button
                    className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
                    onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); copy(JSON.stringify(e, null, 2), `entry-${idx}`) }}
                    title="Copy full event JSON"
                  >{copied === `entry-${idx}` ? 'Copied' : 'Copy'}</button>
                  <span className="ml-1 text-slate-400 group-open:rotate-90 transition-transform">▶</span>
                </div>
              </summary>
              <div className="px-3 pb-3 space-y-2 overflow-x-auto">
                {e.args && (
                  <details className="group border border-slate-200 dark:border-slate-700 rounded">
                    <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                      <span className="muted">args</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
                          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); copy(JSON.stringify(e.args, null, 2), `args-${idx}`) }}
                          title="Copy args"
                        >{copied === `args-${idx}` ? 'Copied' : 'Copy'}</button>
                        <span className="ml-1 text-slate-400 group-open:rotate-90 transition-transform">▶</span>
                      </div>
                    </summary>
                    <div className="px-3 pb-3">
                      <JsonTree data={e.args} />
                    </div>
                  </details>
                )}
                {e.result && (
                  <details className="group border border-slate-200 dark:border-slate-700 rounded">
                    <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                      <span className="muted">result</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
                          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); copy(JSON.stringify(e.result, null, 2), `result-${idx}`) }}
                          title="Copy result"
                        >{copied === `result-${idx}` ? 'Copied' : 'Copy'}</button>
                        <span className="ml-1 text-slate-400 group-open:rotate-90 transition-transform">▶</span>
                      </div>
                    </summary>
                    <div className="px-3 pb-3">
                      <JsonTree data={e.result} />
                    </div>
                  </details>
                )}
                {e.window && (
                  <details className="group border border-slate-200 dark:border-slate-700 rounded">
                    <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                      <span className="muted">window</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
                          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); copy(JSON.stringify(e.window, null, 2), `window-${idx}`) }}
                          title="Copy window"
                        >{copied === `window-${idx}` ? 'Copied' : 'Copy'}</button>
                        <span className="ml-1 text-slate-400 group-open:rotate-90 transition-transform">▶</span>
                      </div>
                    </summary>
                    <div className="px-3 pb-3">
                      <JsonTree data={e.window} />
                    </div>
                  </details>
                )}
                {typeof e.message !== 'undefined' && (
                  <details className="group border border-slate-200 dark:border-slate-700 rounded">
                    <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                      <span className="muted">message</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
                          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); copy(JSON.stringify(e.message, null, 2), `message-${idx}`) }}
                          title="Copy message"
                        >{copied === `message-${idx}` ? 'Copied' : 'Copy'}</button>
                        <span className="ml-1 text-slate-400 group-open:rotate-90 transition-transform">▶</span>
                      </div>
                    </summary>
                    <div className="px-3 pb-3">
                      <JsonTree data={e.message} />
                    </div>
                  </details>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {/* sentinel removed; container scrolls directly */}
    </div>
  )
}
