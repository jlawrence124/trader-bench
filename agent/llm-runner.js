#!/usr/bin/env node
// Built-in LLM agent runner that connects to the local MCP server via stdio
// and drives trading actions strictly through MCP tools.

const fs = require('node:fs');
const path = require('node:path');

async function main() {
    // Read config from env
    const provider = String(process.env.LLM_PROVIDER || 'openai').toLowerCase();
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';
    let baseUrl = (process.env.LLM_BASE_URL || '').trim();
    // Sensible defaults by provider when base URL is omitted
    if (!baseUrl) {
        const defaults = {
            openai: 'https://api.openai.com/v1',
            'openai-compatible': 'https://api.openai.com/v1',
            mistral: 'https://api.mistral.ai/v1',
            deepseek: 'https://api.deepseek.com/v1',
            grok: 'https://api.x.ai/v1', // xAI Grok
            xai: 'https://api.x.ai/v1',
            anthropic: 'https://api.anthropic.com',
            gemini: 'https://generativelanguage.googleapis.com/v1beta',
            // Use DashScope Intl OpenAI-compatible endpoint by default
            qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', // OpenAI-compatible
        };
        baseUrl = defaults[provider] || 'https://api.openai.com/v1';
    }
    const apiKey = process.env.LLM_API_KEY || '';
    const streaming = String(process.env.LLM_STREAMING || 'false') === 'true';
    if (!apiKey) {
        console.error('LLM: missing API key; exiting');
        process.exit(1);
    }

    // Prepare MCP stdio transport (spawn server/src/index.js --mcp)
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

    const serverPath = path.join(__dirname, '..', 'server', 'src', 'index.js');
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath, '--mcp'],
        // Inherit parent env so Alpaca/other credentials flow into the MCP server
        env: { ...process.env, ENABLE_MCP: 'true', PORT: '0' },
        stderr: 'pipe',
    });

    const client = new Client(
        { name: 'trader-bench-llm', version: '0.1.0' },
        { capabilities: { tools: {} } },
    );
    await client.connect(transport);

    // Try to get trading window status via MCP and current time via the Time MCP server
    async function getWindowStatusViaMcp() {
        try {
            const info = await client.callTool({ name: 'getWindowStatus', arguments: {} });
            const parts = Array.isArray(info?.content) ? info.content : [];
            const text = parts.find((p) => p && p.type === 'text' && typeof p.text === 'string')?.text || '';
            return JSON.parse(text || '{}');
        } catch {
            return null;
        }
    }

    async function getMetricsViaMcp() {
        try {
            const info = await client.callTool({ name: 'getMetrics', arguments: {} });
            const parts = Array.isArray(info?.content) ? info.content : [];
            const text = parts.find((p) => p && p.type === 'text' && typeof p.text === 'string')?.text || '';
            return JSON.parse(text || '{}');
        } catch {
            return null;
        }
    }

    async function getTimeFromTimeServer(timezone) {
        // Attempts: uvx mcp-server-time -> python -m mcp_server_time
        const attempts = [
            { command: 'uvx', args: ['mcp-server-time'] },
            { command: 'python', args: ['-m', 'mcp_server_time'] },
        ];
        for (const a of attempts) {
            try {
                const tTransport = new StdioClientTransport({ command: a.command, args: a.args, env: { ...process.env } });
                const tClient = new Client({ name: 'time-client', version: '0.1.0' }, { capabilities: { tools: {} } });
                await tClient.connect(tTransport);
                try {
                    const res = await tClient.callTool({ name: 'get_current_time', arguments: { timezone: timezone || 'UTC' } });
                    const parts = Array.isArray(res?.content) ? res.content : [];
                    const text = parts.find((p) => p && p.type === 'text' && typeof p.text === 'string')?.text || '';
                    const obj = JSON.parse(text || '{}');
                    try { await tTransport.close(); } catch {}
                    return obj && obj.datetime ? obj : null;
                } catch (e) {
                    try { await tTransport.close(); } catch {}
                }
            } catch {}
        }
        return null;
    }

    // Read prompt file
    const promptFile = path.join(__dirname, 'prompt.md');
    const fallbackPromptFile = path.join(__dirname, '..', 'agent', 'prompt.md');
    let systemPrompt = '';
    try {
        if (fs.existsSync(fallbackPromptFile)) {
            systemPrompt = fs.readFileSync(fallbackPromptFile, 'utf8');
        }
    } catch {}
    if (!systemPrompt) systemPrompt = 'You are an AI trading agent. Use MCP tools only.';

    // List available tools from MCP and map to OpenAI tool definitions
    const { tools } = await client.listTools();
    const toolMap = new Map();
    const openaiTools = tools.map((t) => {
        toolMap.set(t.name, t);
        // If tool has inputSchema, pass it through; otherwise provide empty object
        const parameters =
            t.inputSchema && typeof t.inputSchema === 'object'
                ? t.inputSchema
                : { type: 'object', properties: {} };
        return {
            type: 'function',
            function: {
                name: t.name,
                description: t.description || '',
                parameters,
            },
        };
    });

    // Helper to call MCP tool and return a stringified result for chat
    async function callMcpTool(name, args) {
        try {
            const result = await client.callTool({ name, arguments: args || {} });
            // Prefer structuredContent if present; else fallback to content array text
            if (result.structuredContent) return JSON.stringify(result.structuredContent);
            const parts = Array.isArray(result.content) ? result.content : [];
            const texts = parts
                .map((p) => {
                    if (
                        p &&
                        typeof p === 'object' &&
                        p.type === 'text' &&
                        typeof p.text === 'string'
                    )
                        return p.text;
                    try {
                        return JSON.stringify(p);
                    } catch {
                        return String(p);
                    }
                })
                .filter(Boolean);
            return texts.join('\n');
        } catch (e) {
            return JSON.stringify({ error: String(e && (e.message || e)) });
        }
    }

    function log(line) {
        try {
            if (line && String(line).trim()) console.log(String(line));
        } catch {}
    }

    // Gather contextual awareness before starting the session
    const windowStatus = await getWindowStatusViaMcp();
    const metrics = await getMetricsViaMcp();
    const tz = windowStatus?.tz || process.env.TIMEZONE || 'America/New_York';
    const timeInfo = await getTimeFromTimeServer(tz);
    // Log a concise preamble to stdout for the UI
    try {
        log('### Window Context');
        if (windowStatus && windowStatus.active && windowStatus.current) {
            log(`- Active window: ${windowStatus.current.id} (${windowStatus.current.start} → ${windowStatus.current.end})`);
        } else if (windowStatus && windowStatus.next) {
            log(`- Not in predefined window. Next: ${windowStatus.next.id} at ${windowStatus.next.start}`);
        } else {
            log('- Window status unavailable');
        }
        if (timeInfo && timeInfo.datetime) log(`- Current time (${tz}): ${timeInfo.datetime}`);
        else log(`- Current time (${tz}): ${new Date().toISOString()} (fallback)`);
        // Performance vs SPY
        const pct = (v) => (typeof v === 'number' && isFinite(v) ? `${(v*100).toFixed(2)}%` : 'n/a');
        if (metrics && (typeof metrics.alpha === 'number')) {
            log(`- Performance: Alpha vs SPY ${pct(metrics.alpha)} (Equity ${pct(metrics.equityReturn)}, SPY ${pct(metrics.benchReturn)})`);
        }
    } catch {}

    // Prepare initial conversation (include awareness snippet for the agent)
    const awarenessLines = [];
    if (windowStatus && windowStatus.active && windowStatus.current) {
        awarenessLines.push(`Active window: ${windowStatus.current.id} (${windowStatus.current.start} to ${windowStatus.current.end})`);
    } else if (windowStatus && windowStatus.next) {
        awarenessLines.push(`No active predefined window. Next: ${windowStatus.next.id} at ${windowStatus.next.start}`);
    }
    if (timeInfo && timeInfo.datetime) awarenessLines.push(`Current time [${tz}]: ${timeInfo.datetime}`);
    if (metrics && (typeof metrics.alpha === 'number')) {
        const pct = (v) => (typeof v === 'number' && isFinite(v) ? `${(v*100).toFixed(2)}%` : 'n/a');
        awarenessLines.push(`Alpha vs SPY: ${pct(metrics.alpha)} (Eq ${pct(metrics.equityReturn)}, SPY ${pct(metrics.benchReturn)})`);
    }
    const awareness = awarenessLines.length ? awarenessLines.join(' | ') : '';

    const messages = [
        { role: 'system', content: systemPrompt },
        ...(awareness ? [{ role: 'user', content: `Session context: ${awareness}` }] : []),
        {
            role: 'user',
            content:
                'Start a trading session. You may place orders during configured windows OR regular market hours. Follow the operating procedure. Use only the provided tools.',
        },
    ];

    // Build provider-specific tool descriptors
    const anthropicTools = openaiTools.map((t) => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object' },
    }));
    // Gemini does not accept some JSON Schema keys (e.g., $schema, additionalProperties)
    function sanitizeForGemini(schema) {
        if (schema == null) return schema;
        if (Array.isArray(schema)) return schema.map(sanitizeForGemini);
        if (typeof schema === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(schema)) {
                if (k === '$schema' || k === 'additionalProperties' || k === 'unevaluatedProperties') continue;
                out[k] = sanitizeForGemini(v);
            }
            return out;
        }
        return schema;
    }
    const geminiToolDecl = [{
        functionDeclarations: openaiTools.map((t) => ({
            name: t.function.name,
            description: t.function.description || '',
            parameters: sanitizeForGemini(
                t.function.parameters || { type: 'object', properties: {} }
            ),
        })),
    }];

    // Utility: convert OpenAI-style message array into Anthropic format
    function toAnthropic(messages, system) {
        const out = [];
        for (const m of messages) {
            if (m.role === 'system') continue; // handled separately
            if (m.role === 'user') {
                out.push({ role: 'user', content: [{ type: 'text', text: String(m.content || '') }] });
                continue;
            }
            if (m.role === 'assistant') {
                const parts = [];
                if (m.content && String(m.content).trim()) parts.push({ type: 'text', text: String(m.content) });
                const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
                for (const tc of tcs) {
                    let args = {};
                    try { args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
                    parts.push({ type: 'tool_use', id: tc.id || `call_${Math.random().toString(36).slice(2)}`, name: tc?.function?.name, input: args });
                }
                if (!parts.length) parts.push({ type: 'text', text: '' });
                out.push({ role: 'assistant', content: parts });
                continue;
            }
            if (m.role === 'tool') {
                out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content || '') }] });
                continue;
            }
        }
        return { system, messages: out };
    }

    // Utility: convert OpenAI-style messages into Gemini contents
    function toGemini(messages, system) {
        const contents = [];
        const idToName = new Map();
        // pass system as top-level systemInstruction
        for (const m of messages) {
            if (m.role === 'system') continue;
            if (m.role === 'user') {
                contents.push({ role: 'user', parts: [{ text: String(m.content || '') }] });
                continue;
            }
            if (m.role === 'assistant') {
                const parts = [];
                if (m.content && String(m.content).trim()) parts.push({ text: String(m.content) });
                const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
                for (const tc of tcs) {
                    let argsObj = {};
                    try { argsObj = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
                    const id = tc.id || `call_${Math.random().toString(36).slice(2)}`;
                    idToName.set(id, tc?.function?.name);
                    parts.push({ functionCall: { name: tc?.function?.name, args: argsObj } });
                }
                contents.push({ role: 'model', parts });
                continue;
            }
            if (m.role === 'tool') {
                const name = idToName.get(m.tool_call_id) || 'unknown_tool';
                contents.push({ role: 'user', parts: [{ functionResponse: { name, response: { content: String(m.content || '') } } }] });
                continue;
            }
        }
        return { systemInstruction: { parts: [{ text: String(system || '') }] }, contents };
    }

    // Adapter for providers: implement multi-provider chat
    async function chatOnce() {
        if (
            provider === 'openai' ||
            provider === 'openai-compatible' ||
            provider === 'mistral' ||
            provider === 'deepseek' ||
            provider === 'grok' ||
            provider === 'xai' ||
            provider === 'qwen'
        ) {
            const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
            const body = {
                model,
                messages,
                tools: openaiTools,
                tool_choice: 'auto',
                stream: false,
            };
            // For OpenAI gpt-5 family, omit temperature (must use default 1)
            if (!(provider === 'openai' && /^gpt-5/i.test(model))) {
                body.temperature = 0.3;
            }
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(`LLM error ${res.status}: ${t}`);
            }
            const json = await res.json();
            return json;
        }
        if (provider === 'anthropic') {
            const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
            const conv = toAnthropic(messages, systemPrompt);
            const body = {
                model,
                system: conv.system,
                messages: conv.messages,
                tools: anthropicTools,
                temperature: 0.3,
            };
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(`LLM error ${res.status}: ${t}`);
            }
            const j = await res.json();
            // Normalize to OpenAI-shaped response
            const parts = Array.isArray(j?.content) ? j.content : [];
            const text = parts
                .filter((p) => p.type === 'text' && p.text)
                .map((p) => p.text)
                .join('\n');
            const tool_calls = parts
                .filter((p) => p.type === 'tool_use')
                .map((p) => ({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input || {}) } }));
            return { choices: [{ message: { content: text, tool_calls } }] };
        }
        if (provider === 'gemini') {
            const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const payload = toGemini(messages, systemPrompt);
            const body = { ...payload, tools: geminiToolDecl, generationConfig: { temperature: 0.3 } };
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(`LLM error ${res.status}: ${t}`);
            }
            const j = await res.json();
            const c0 = j?.candidates?.[0];
            const parts = Array.isArray(c0?.content?.parts) ? c0.content.parts : [];
            const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
            const tool_calls = parts
                .filter((p) => p.functionCall && p.functionCall.name)
                .map((p) => ({
                    id: `call_${Math.random().toString(36).slice(2)}`,
                    type: 'function',
                    function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
                }));
            return { choices: [{ message: { content: text, tool_calls } }] };
        }
        throw new Error(`Unsupported provider: ${provider}`);
    }

    // Main tool-use loop
    const maxSteps = 16;
    let placedTrade = false;
    let wroteScratchpad = false;
    let nudges = 0;
    const maxNudges = 2; // allow a couple of gentle reminders before stopping
    for (let step = 1; step <= maxSteps; step++) {
        // Descriptor-added heading for clarity in Agent Output
        log(`### Step ${step} — model decision`);
        let resp;
        try {
            resp = await chatOnce();
        } catch (e) {
            log(`[error] ${String(e && (e.message || e))}`);
            break;
        }

        const choice = resp?.choices?.[0];
        const msg = choice?.message || {};
        const text = msg?.content || '';
        const toolCalls = msg?.tool_calls || [];

        if (Array.isArray(toolCalls) && toolCalls.length) {
            const names = toolCalls.map((tc) => tc?.function?.name).filter(Boolean);
            if (names.length) log(`- Tools requested: ${names.join(', ')}`);
            for (const tc of toolCalls) {
                const name = tc?.function?.name;
                let args = {};
                try {
                    args = tc?.function?.arguments
                        ? JSON.parse(tc.function.arguments)
                        : {};
                } catch {}
                log(`call: ${name} ${JSON.stringify(args)}`);
                const out = await callMcpTool(name, args);
                // Provide tool result back to the model
                messages.push({
                    role: 'assistant',
                    content: text || '',
                    tool_calls: [tc],
                });
                messages.push({ role: 'tool', tool_call_id: tc.id, content: out });

                // Track whether meaningful actions happened
                if (name === 'buyShares' || name === 'sellShares') placedTrade = true;
                if (name === 'addScratchpad') wroteScratchpad = true;
            }
            const actions = [];
            if (names.includes('buyShares')) actions.push('trade: buy');
            if (names.includes('sellShares')) actions.push('trade: sell');
            if (names.includes('addScratchpad')) actions.push('note recorded');
            if (actions.length) log(`- Actions this step: ${actions.join(', ')}`);
            continue; // let model observe tool results next iteration
        }

        // If we got only text (no tool calls), log it and gently nudge the model
        if (text && String(text).trim()) {
            log(`- Text response (no tools)`);
            log(text);
            if (placedTrade || wroteScratchpad) break; // already did something meaningful

            if (nudges < maxNudges) {
                nudges++;
                messages.push({
                    role: 'user',
                    content:
                        'Reminder: Use MCP tools only. If you intend to trade, call buyShares/sellShares now with integer qty and a short note. If not trading, call addScratchpad with observations and next steps. Do not end with text-only.',
                });
                continue;
            }
            break;
        }

        // If no content and no tool calls, stop
        log('No content or tool calls; stopping');
        break;
    }

    try {
        await transport.close();
    } catch {}
}

main().catch((e) => {
    try {
        console.error(String(e && (e.stack || e.message || e)));
    } catch {}
    process.exit(1);
});
