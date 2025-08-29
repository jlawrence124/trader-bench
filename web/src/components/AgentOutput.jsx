import React, { useEffect, useMemo, useRef, useState } from 'react';

function simplifyStderr(line) {
    const s = String(line || '');
    if (!s.trim()) return null;
    const lower = s.toLowerCase();
    // Hide stack frames and noisy module paths
    if (/^\s*at\s+/.test(s)) return null;
    if (lower.includes('node_modules') && lower.includes(' at ')) return null;
    if (lower.includes('diagnostics_channel')) return null;
    // Gemini CLI rate-limit noise
    if (
        /status[:\s]*429/.test(lower) ||
        lower.includes('resource_exhausted') ||
        lower.includes('too many requests')
    ) {
        return 'Rate limited (429). Retrying...';
    }
    // Drop stray JSON brace lines
    if (s.trim() === '}' || s.trim() === '{') return null;
    // MCP JSON parse noise (e.g., npm wrapper output)
    if (s.includes('MCP ERROR') && s.includes('Unexpected token')) {
        return 'MCP stdio parse error — ensure the MCP command runs via node, not npm.';
    }
    return s;
}

function formatEvent(e) {
    const t = new Date(e.ts).toLocaleTimeString();
    const ok = (text, level = 'info') => ({ text: `${t} • ${text}`, level });
    // Exclude window lifecycle and server noise from Agent Output
    if (e.type === 'window.open' || e.type === 'window.close') return null;
    if (e.type && String(e.type).startsWith('server.')) return null;
    if (e.type?.startsWith('tool.')) {
        const name = e.type.replace('tool.', '');
        const args = e.args ? JSON.stringify(e.args) : '';
        let result = '';
        if (e.result?.order) result = ` -> ${e.result.order.status || 'submitted'}`;
        else if (e.result?.price) result = ` -> $${e.result.price}`;
        else if (e.result) result = ` -> ok`;
        return ok(`${name} ${args}${result}`);
    }
    // Hide preamble entries from Agent Output
    if (e.type === 'agent.preamble') return null;
    if (e.type === 'agent.start.suggested') {
        return ok(`Start agent: ${e.agent || ''} ${e.command ? `→ ${e.command}` : ''}`);
    }
    if (e.type === 'agent.started') return ok(`Agent started (pid ${e.pid})`);
    if (e.type === 'agent.stopping') return ok(`Agent stopping (pid ${e.pid})`);
    if (e.type === 'agent.exited')
        return ok(`Agent exited (code ${e.code ?? '—'}, signal ${e.signal ?? '—'})`);
    if (e.type === 'agent.stdout') {
        const line = String(e.line || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!line) return null;
        // Preserve headings/bullets a bit cleaner
        return ok(line);
    }
    if (e.type === 'agent.stderr') {
        const simp = simplifyStderr(e.line);
        if (!simp) return null;
        // Tag as error but keep concise
        return ok(`[stderr] ${simp}`, 'error');
    }
    if (e.type === 'debug.note') return ok(`Note: ${e.message}`);
    if (e.type === 'scratchpad.added') return ok(`Scratch: ${e.entry?.message}`);
    if (e.type?.endsWith('.error')) return ok(`Error: ${e.error}`, 'error');
    return ok(e.type);
}

export default function AgentOutput({ logs, agent }) {
    // Session-only clear support via sessionStorage cutoff timestamp
    const [cutoff, setCutoff] = useState(() => {
        try {
            const s = sessionStorage.getItem('agentOutputCutoffTs');
            return s ? Number(s) : 0;
        } catch {
            return 0;
        }
    });
    const clearSession = () => {
        const ts = Date.now();
        try {
            sessionStorage.setItem('agentOutputCutoffTs', String(ts));
        } catch {}
        setCutoff(ts);
    };
    const filtered = useMemo(() => {
        const arr = Array.isArray(logs) ? logs : [];
        if (!cutoff) return arr;
        return arr.filter((e) => {
            const t = new Date(e.ts).getTime();
            return !Number.isFinite(cutoff) || (Number.isFinite(t) ? t >= cutoff : true);
        });
    }, [logs, cutoff]);
    const list = useMemo(() => {
        const recent = filtered.slice(-200);
        const items = [];

        // Helper: push deduped item (merge repeated identical errors like rate limits)
        const pushItem = (obj) => {
            const last = items[items.length - 1];
            if (last && last.text === obj.text && last.level === obj.level) {
                last.count = (last.count || 1) + 1;
                if (last.count > 1) last.text = `${obj.text} ×${last.count}`;
                return;
            }
            items.push(obj);
        };

        // Reflow a set of stdout lines into neat paragraphs
        const reflowLines = (lines) => {
            const out = [];
            let buf = '';
            const shouldBreakBefore = (s) =>
                /^\s*(###|\*\s|\d+\.\s|\-\s|\*\*|Scratch:|call:)/.test(s);
            for (const raw of lines) {
                const s = String(raw || '')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (!s) continue;
                if (!buf) {
                    buf = s;
                    continue;
                }
                if (shouldBreakBefore(s) || /[.!?:)]$/.test(buf) || buf.endsWith(':')) {
                    out.push(buf);
                    buf = s;
                } else {
                    buf += ' ' + s;
                }
            }
            if (buf) out.push(buf);
            return out.join('\n');
        };

        let stdoutBuf = [];
        let stdoutLastTs = null;
        const flushStdout = () => {
            if (!stdoutBuf.length) return;
            const text = reflowLines(stdoutBuf);
            const t = stdoutLastTs
                ? new Date(stdoutLastTs).toLocaleTimeString() + ' • '
                : '';
            pushItem({
                id: items.length,
                text: t + text,
                level: 'info',
                collapsible: false,
            });
            stdoutBuf = [];
            stdoutLastTs = null;
        };

        for (let i = 0; i < recent.length; i++) {
            const e = recent[i];
            if (e.type === 'agent.stdout') {
                const line = String(e.line || '');
                const trimmed = line.trim();
                // Drop noisy tool wrappers from some CLIs
                if (/^call:/.test(trimmed)) continue;
                if (/^response\b/i.test(trimmed)) continue;
                if (/^<ctrl\d+>$/i.test(trimmed)) continue;
                stdoutBuf.push(line);
                stdoutLastTs = e.ts || stdoutLastTs;
                continue;
            }
            // Non-stdout event breaks the block
            flushStdout();
            const f = formatEvent(e);
            if (!f) continue;
            pushItem({ id: items.length, ...f, raw: e });
        }
        flushStdout();
        return items;
    }, [filtered]);
    // Scroll only the card content, never the page
    const containerRef = useRef(null);
    const [copied, setCopied] = useState(false);
    const copyAll = async () => {
        try {
            const text = list.map((i) => i.text).join('\n');
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {}
    };
    useEffect(() => {
        const c = containerRef.current;
        if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
    }, [list]);
    return (
        <div className="card">
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm muted">Agent Output</div>
                <div className="flex items-center gap-2">
                    {agent && (
                        <div className="text-xs muted">
                            Agent: <span className="title">{agent}</span>
                        </div>
                    )}
                    <button
                        className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
                        onClick={copyAll}
                        title="Copy visible output"
                    >
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                        className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 title hover:bg-slate-100 dark:hover:bg-slate-700"
                        onClick={clearSession}
                        title="Clear output for this browser session"
                    >
                        Clear
                    </button>
                </div>
            </div>
            <div ref={containerRef} className="text-xs space-y-2 max-h-56 overflow-auto">
                {list.map((item) =>
                    item.collapsible === false ? (
                        <RichLine key={item.id} item={item} />
                    ) : (
                        <CollapsibleItem key={item.id} item={item} />
                    ),
                )}
            </div>
        </div>
    );
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineRich(s) {
    // minimal bold support: **text**
    const safe = escapeHtml(s);
    return safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function parseBlocks(text) {
    const lines = String(text || '').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) {
            i++;
            continue;
        }
        // Heading style (###)
        if (/^###\s+/.test(line)) {
            blocks.push({ type: 'h3', text: line.replace(/^###\s+/, '') });
            i++;
            continue;
        }
        // Ordered list
        if (/^\d+\.\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
                i++;
            }
            blocks.push({ type: 'ol', items });
            continue;
        }
        // Unordered list
        if (/^[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
                i++;
            }
            blocks.push({ type: 'ul', items });
            continue;
        }
        // Paragraph
        blocks.push({ type: 'p', text: lines[i] });
        i++;
    }
    return blocks;
}

function RichLine({ item, text }) {
    const cls = item.level === 'error' ? 'text-red-400' : 'title';
    const src = typeof text === 'string' ? text : item.text;
    const blocks = parseBlocks(src);
    return (
        <div className={`${cls} leading-relaxed`}>
            {blocks.map((b, idx) => {
                if (b.type === 'h3')
                    return (
                        <div
                            key={idx}
                            className="font-semibold mb-1"
                            dangerouslySetInnerHTML={{ __html: inlineRich(b.text) }}
                        />
                    );
                if (b.type === 'ol')
                    return (
                        <ol key={idx} className="list-decimal pl-5 space-y-0.5">
                            {b.items.map((it, i) => (
                                <li
                                    key={i}
                                    dangerouslySetInnerHTML={{ __html: inlineRich(it) }}
                                />
                            ))}
                        </ol>
                    );
                if (b.type === 'ul')
                    return (
                        <ul key={idx} className="list-disc pl-5 space-y-0.5">
                            {b.items.map((it, i) => (
                                <li
                                    key={i}
                                    dangerouslySetInnerHTML={{ __html: inlineRich(it) }}
                                />
                            ))}
                        </ul>
                    );
                return (
                    <div
                        key={idx}
                        className="whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ __html: inlineRich(b.text) }}
                    />
                );
            })}
        </div>
    );
}

function CollapsibleItem({ item }) {
    const all = String(item.text || '');
    const lines = all.split('\n');
    const firstLine = lines[0];
    const body = lines.slice(1).join('\n').trim();
    const summary = firstLine.length > 160 ? firstLine.slice(0, 160) + '…' : firstLine;
    const color = item.level === 'error' ? 'text-red-400' : 'title';
    // If there is no additional body, render as a simple one-liner (no duplication)
    if (!body) {
        return <RichLine item={item} />;
    }
    return (
        <details className="group border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900">
            <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                <span className={`${color} truncate`}>{summary}</span>
                <span className="ml-1 text-slate-400 group-open:rotate-90 transition-transform">
                    ▶
                </span>
            </summary>
            <div className="px-3 pb-3">
                <RichLine item={item} text={body} />
            </div>
        </details>
    );
}
