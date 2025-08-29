import React, { useEffect, useState } from 'react';
import JsonTree from './JsonTree.jsx';

async function fetchJson(url, opts) {
    const r = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    if (!r.ok) throw new Error(await r.text());
    return await r.json();
}

export default function DebugPanel({ onEvent }) {
    const [cfg, setCfg] = useState(null);
    const [saving, setSaving] = useState(false);
    const [symbol, setSymbol] = useState('SPY');
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');
    const [result, setResult] = useState('');
    const [resultObj, setResultObj] = useState(null);
    const [scratch, setScratch] = useState([]);
    const [scratchMsg, setScratchMsg] = useState('');
    const [scratchTags, setScratchTags] = useState('');
    const [runOnceDur, setRunOnceDur] = useState(4);
    const [runOnceInfo, setRunOnceInfo] = useState(null);
    const [confirmClearLogs, setConfirmClearLogs] = useState('');
    const [confirmClearScratch, setConfirmClearScratch] = useState('');
    const [confirmClearBoth, setConfirmClearBoth] = useState('');

    useEffect(() => {
        (async () => {
            try {
                setCfg(await fetchJson('/api/debug/config'));
            } catch {}
            try {
                setScratch(await fetchJson('/api/scratchpad'));
            } catch {}
        })();
    }, []);

    useEffect(() => {
        const sse = new EventSource('/api/events');
        sse.onmessage = (ev) => {
            try {
                const e = JSON.parse(ev.data);
                if (e.type === 'scratchpad.added') {
                    setScratch((prev) => [...prev, e.entry]);
                } else if (e.type === 'scratchpad.cleared') {
                    setScratch([]);
                } else if (e.type === 'window.open' && e.window?.id === 'adhoc') {
                    setRunOnceInfo({ start: e.window.start, end: e.window.end });
                } else if (e.type === 'window.close' && e.window?.id === 'adhoc') {
                    setRunOnceInfo(null);
                }
            } catch {}
        };
        return () => sse.close();
    }, []);

    const onSave = async () => {
        setSaving(true);
        try {
            const updated = await fetchJson('/api/debug/config', {
                method: 'PUT',
                body: JSON.stringify(cfg),
            });
            setCfg(updated);
            await fetchJson('/api/debug/reschedule', { method: 'POST' });
            setResult('Config saved and windows rescheduled');
        } catch (e) {
            setResult(String(e));
        } finally {
            setSaving(false);
        }
    };

    const doCheck = async () => {
        try {
            const r = await fetchJson('/api/debug/checkPrice', {
                method: 'POST',
                body: JSON.stringify({ symbol }),
            });
            setResult(JSON.stringify(r, null, 2));
            setResultObj(r);
        } catch (e) {
            setResult(String(e));
        }
    };
    const doPlace = async (side, force = false, dryRun = false) => {
        try {
            const r = await fetchJson('/api/debug/placeOrder', {
                method: 'POST',
                body: JSON.stringify({
                    symbol,
                    side,
                    quantity: Number(qty),
                    note,
                    force,
                    dryRun,
                }),
            });
            setResult(JSON.stringify(r, null, 2));
            setResultObj(r);
        } catch (e) {
            setResult(String(e));
        }
    };
    const doLog = async () => {
        try {
            const r = await fetchJson('/api/debug/log', {
                method: 'POST',
                body: JSON.stringify({ message: note || 'debug message' }),
            });
            setResult('Logged');
            setResultObj(r);
            onEvent?.(r);
        } catch (e) {
            setResult(String(e));
        }
    };

    const doClearLogs = async () => {
        try {
            const r = await fetchJson('/api/debug/clear-logs', {
                method: 'POST',
                body: JSON.stringify({ confirm: confirmClearLogs }),
            });
            setResult(JSON.stringify(r, null, 2));
            setResultObj(r);
            setConfirmClearLogs('');
        } catch (e) {
            setResult(String(e));
        }
    };

    const doClearScratch = async () => {
        try {
            // Gate with local confirm only; server endpoint is ungated
            if (confirmClearScratch.toUpperCase() !== 'CLEAR') {
                setResult('Type CLEAR to confirm');
                return;
            }
            const r = await fetchJson('/api/scratchpad', { method: 'DELETE' });
            setResult(JSON.stringify(r, null, 2));
            setResultObj(r);
            setConfirmClearScratch('');
        } catch (e) {
            setResult(String(e));
        }
    };

    const doClearBoth = async () => {
        try {
            if (confirmClearBoth.toUpperCase() !== 'CLEAR') {
                setResult('Type CLEAR to confirm');
                return;
            }
            const a = await fetchJson('/api/debug/clear-logs', { method: 'POST', body: JSON.stringify({ confirm: 'CLEAR' }) });
            const b = await fetchJson('/api/scratchpad', { method: 'DELETE' });
            const summary = { ok: true, cleared: ['logs', 'scratchpad'], logs: a, scratchpad: b };
            setResult(JSON.stringify(summary, null, 2));
            setResultObj(summary);
            setConfirmClearBoth('');
        } catch (e) {
            setResult(String(e));
        }
    };


    const addScratch = async () => {
        try {
            const body = {
                message: scratchMsg,
                tags: scratchTags
                    ? scratchTags
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                    : [],
            };
            const r = await fetchJson('/api/scratchpad', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            setScratchMsg('');
            setScratchTags('');
            // SSE will append; to be responsive, also update locally
            setScratch((prev) => [...prev, r]);
        } catch (e) {
            setResult(String(e));
        }
    };
    const clearScratch = async () => {
        try {
            await fetchJson('/api/scratchpad', { method: 'DELETE' });
            setScratch([]);
        } catch {}
    };

    const runOnce = async () => {
        try {
            const r = await fetchJson('/api/debug/run-once', {
                method: 'POST',
                body: JSON.stringify({ durationMinutes: Number(runOnceDur) }),
            });
            setRunOnceInfo({ start: r.start, end: r.end });
        } catch (e) {
            setResult(String(e));
        }
    };

    if (!cfg) return <div className="muted">Loading debug config…</div>;

    return (
        <div className="space-y-6">
            <div className="card">
                <div className="text-sm muted mb-3">Agent/Server Settings</div>
                <div className="grid md:grid-cols-3 gap-4">
                    <label className="block">
                        <div className="muted text-xs mb-1">Timezone (IANA)</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={cfg.timezone}
                            onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}
                        />
                    </label>
                    <label className="block">
                        <div className="muted text-xs mb-1">
                            Trading Windows (CSV HH:mm)
                        </div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={cfg.tradingWindows}
                            onChange={(e) =>
                                setCfg({ ...cfg, tradingWindows: e.target.value })
                            }
                        />
                    </label>
                    <label className="block">
                        <div className="muted text-xs mb-1">
                            Window Duration (minutes)
                        </div>
                        <input
                            type="number"
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={cfg.windowDurationMinutes}
                            onChange={(e) =>
                                setCfg({
                                    ...cfg,
                                    windowDurationMinutes: Number(e.target.value),
                                })
                            }
                        />
                    </label>
                    <label className="block">
                        <div className="muted text-xs mb-1">Benchmark Symbol</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={cfg.benchmarkSymbol}
                            onChange={(e) =>
                                setCfg({ ...cfg, benchmarkSymbol: e.target.value })
                            }
                        />
                    </label>
                    <label className="block flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={cfg.tradingEnabled}
                            onChange={(e) =>
                                setCfg({ ...cfg, tradingEnabled: e.target.checked })
                            }
                        />
                        <span className="title">Trading Enabled</span>
                    </label>
                    <label className="block flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={cfg.sandbox}
                            onChange={(e) =>
                                setCfg({ ...cfg, sandbox: e.target.checked })
                            }
                        />
                        <span className="title">Sandbox (no real orders)</span>
                    </label>
                </div>
                <div className="mt-4 flex gap-3">
                    <button
                        disabled={saving}
                        onClick={onSave}
                        className="px-4 py-2 rounded bg-brand-600 text-white"
                    >
                        {saving ? 'Saving…' : 'Save & Reschedule'}
                    </button>
                </div>
            </div>

            <div className="card">
                <div className="text-sm muted mb-3">One-off Testing</div>
                <div className="grid md:grid-cols-4 gap-4 items-end">
                    <label className="block">
                        <div className="muted text-xs mb-1">Symbol</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        />
                    </label>
                    <label className="block">
                        <div className="muted text-xs mb-1">Quantity</div>
                        <input
                            type="number"
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={qty}
                            onChange={(e) => setQty(e.target.value)}
                        />
                    </label>
                    <label className="block md:col-span-2">
                        <div className="muted text-xs mb-1">Note / Thought</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                    <button
                        onClick={doCheck}
                        className="px-3 py-2 rounded bg-slate-200 dark:bg-slate-700 title"
                    >
                        Check Price
                    </button>
                    <button
                        onClick={() => doPlace('buy', false, true)}
                        className="px-3 py-2 rounded bg-slate-200 dark:bg-slate-700 title"
                    >
                        Dry Run Buy
                    </button>
                    <button
                        onClick={() => doPlace('sell', false, true)}
                        className="px-3 py-2 rounded bg-slate-200 dark:bg-slate-700 title"
                    >
                        Dry Run Sell
                    </button>
                    <button
                        onClick={() => doPlace('buy', true, false)}
                        className="px-3 py-2 rounded bg-brand-600 text-white"
                    >
                        Force Buy (outside window)
                    </button>
                    <button
                        onClick={() => doPlace('sell', true, false)}
                        className="px-3 py-2 rounded bg-brand-600 text-white"
                    >
                        Force Sell (outside window)
                    </button>
                    <button
                        onClick={doLog}
                        className="px-3 py-2 rounded bg-slate-200 dark:bg-slate-700 title"
                    >
                        Log Thought
                    </button>
                </div>
                <div className="mt-4">
                    <div className="muted text-xs mb-1">Result</div>
                    {resultObj && typeof resultObj === 'object' ? (
                        <div className="max-h-64 overflow-auto border border-slate-200 dark:border-slate-700 rounded p-2 bg-slate-50 dark:bg-slate-900">
                            <JsonTree data={resultObj} />
                        </div>
                    ) : (
                        <pre className="whitespace-pre-wrap break-all overflow-x-auto max-h-64 overflow-y-auto text-xs title bg-slate-50 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700 font-mono">
                            {result}
                        </pre>
                    )}
                </div>
            </div>

            <div className="card">
                <div className="text-sm muted mb-3">Scratchpad for Next Window</div>
                <div className="grid md:grid-cols-3 gap-4">
                    <label className="block md:col-span-2">
                        <div className="muted text-xs mb-1">Message</div>
                        <textarea
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            rows={3}
                            value={scratchMsg}
                            onChange={(e) => setScratchMsg(e.target.value)}
                        />
                    </label>
                    <label className="block">
                        <div className="muted text-xs mb-1">Tags (comma separated)</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={scratchTags}
                            onChange={(e) => setScratchTags(e.target.value)}
                        />
                    </label>
                </div>
                <div className="mt-3 flex gap-3">
                    <button
                        onClick={addScratch}
                        disabled={!scratchMsg.trim()}
                        className="px-3 py-2 rounded bg-brand-600 text-white"
                    >
                        Add Note
                    </button>
                    <button
                        onClick={clearScratch}
                        className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 title"
                    >
                        Clear All
                    </button>
                </div>
                <div className="mt-4 space-y-2">
                    {scratch.length === 0 ? (
                        <div className="muted text-sm">No scratchpad notes yet.</div>
                    ) : (
                        scratch.map((s, i) => (
                            <details
                                key={i}
                                className="group border border-slate-200 dark:border-slate-700 rounded"
                            >
                                <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                                    <span className="muted truncate">
                                        {new Date(s.ts).toLocaleString()} •{' '}
                                        {s.author || 'agent'}{' '}
                                        {s.tags?.length ? `• ${s.tags.join(', ')}` : ''}
                                    </span>
                                    <span className="ml-1 text-slate-400 group-open:rotate-90 transition-transform">
                                        ▶
                                    </span>
                                </summary>
                                <div className="px-3 pb-3">
                                    <div className="title whitespace-pre-wrap break-all">
                                        {s.message}
                                    </div>
                                </div>
                            </details>
                        ))
                    )}
                </div>
            </div>

            <div className="card">
                <div className="text-sm muted mb-3">
                    One-off Agent Run (Open Window Now)
                </div>
                <div className="grid md:grid-cols-3 gap-4 items-end">
                    <label className="block">
                        <div className="muted text-xs mb-1">Duration (minutes)</div>
                        <input
                            type="number"
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={runOnceDur}
                            onChange={(e) => setRunOnceDur(e.target.value)}
                        />
                    </label>
                    <div className="flex gap-3 md:col-span-2">
                        <button
                            onClick={runOnce}
                            className="px-3 py-2 rounded bg-brand-600 text-white"
                        >
                            Start One-off Window
                        </button>
                        {runOnceInfo && (
                            <div className="muted text-sm flex items-center">
                                Active: {new Date(runOnceInfo.start).toLocaleTimeString()}{' '}
                                → {new Date(runOnceInfo.end).toLocaleTimeString()}
                            </div>
                        )}
                    </div>
                </div>
                <div className="muted text-xs mt-2">
                    This immediately opens a temporary ad-hoc trading window. MCP buy/sell
                    tools will be allowed until it closes.
                </div>
            </div>

            <div className="card">
                <div className="text-sm text-red-700 dark:text-red-400 mb-2">Clear Agent Logs</div>
                <div className="muted text-xs mb-3">Deletes all events from the local log file. This only affects local benchmarking data and does not touch your brokerage account.</div>
                <div className="grid md:grid-cols-3 gap-4 items-end">
                    <label className="block md:col-span-2">
                        <div className="muted text-xs mb-1">Type CLEAR to confirm</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={confirmClearLogs}
                            onChange={(e)=>setConfirmClearLogs(e.target.value)}
                            placeholder="CLEAR"
                        />
                    </label>
                    <div className="flex gap-3">
                        <button
                            onClick={doClearLogs}
                            disabled={confirmClearLogs.toUpperCase() !== 'CLEAR'}
                            className={`px-3 py-2 rounded ${confirmClearLogs.toUpperCase()==='CLEAR' ? 'bg-red-600 text-white' : 'border border-slate-300 dark:border-slate-600 title'}`}
                        >
                            Clear Logs
                        </button>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="text-sm text-red-700 dark:text-red-400 mb-2">Clear Scratchpad</div>
                <div className="muted text-xs mb-3">Deletes all scratchpad notes stored locally for window-to-window handoff.</div>
                <div className="grid md:grid-cols-3 gap-4 items-end">
                    <label className="block md:col-span-2">
                        <div className="muted text-xs mb-1">Type CLEAR to confirm</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={confirmClearScratch}
                            onChange={(e)=>setConfirmClearScratch(e.target.value)}
                            placeholder="CLEAR"
                        />
                    </label>
                    <div className="flex gap-3">
                        <button
                            onClick={doClearScratch}
                            disabled={confirmClearScratch.toUpperCase() !== 'CLEAR'}
                            className={`px-3 py-2 rounded ${confirmClearScratch.toUpperCase()==='CLEAR' ? 'bg-red-600 text-white' : 'border border-slate-300 dark:border-slate-600 title'}`}
                        >
                            Clear Scratchpad
                        </button>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="text-sm text-red-700 dark:text-red-400 mb-2">Clear Logs + Scratchpad</div>
                <div className="muted text-xs mb-3">Deletes both the agent logs and scratchpad notes.</div>
                <div className="grid md:grid-cols-3 gap-4 items-end">
                    <label className="block md:col-span-2">
                        <div className="muted text-xs mb-1">Type CLEAR to confirm</div>
                        <input
                            className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 title"
                            value={confirmClearBoth}
                            onChange={(e)=>setConfirmClearBoth(e.target.value)}
                            placeholder="CLEAR"
                        />
                    </label>
                    <div className="flex gap-3">
                        <button
                            onClick={doClearBoth}
                            disabled={confirmClearBoth.toUpperCase() !== 'CLEAR'}
                            className={`px-3 py-2 rounded ${confirmClearBoth.toUpperCase()==='CLEAR' ? 'bg-red-600 text-white' : 'border border-slate-300 dark:border-slate-600 title'}`}
                        >
                            Clear Both
                        </button>
                    </div>
                </div>
            </div>

            {/* Start Fresh reset removed: full paper account reset is not supported by Alpaca API */}
        </div>
    );
}
