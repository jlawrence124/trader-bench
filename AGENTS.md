# AGENTS

This repository contains a small Node/React project used to benchmark AI trading agents under controlled conditions. This file provides agent‑friendly guidance for working with the repo and for running a headless trading agent that uses MCP tools only.

## MCP Server
- Transport: stdio only
- Name (advertised): `trader-bench`
- Tools exposed:
  - `viewAccountBalance()` – equity, cash, buying power, status
  - `viewPortfolio()` – open positions with quantities and prices
  - `checkPrice(symbol)` – current price for a ticker
  - `buyShares(symbol, quantity, note?)` – market buy (integer shares)
  - `sellShares(symbol, quantity, note?)` – market sell (integer shares)
  - `getScratchpad(limit?)` – recent notes across windows
  - `addScratchpad(message, tags?, author?)` – append a note

Spawn command (recommended, no wrapper output):
- command: `/opt/homebrew/bin/node`
- args: `["server/src/index.js", "--mcp"]`
- cwd: `<repo root>`
- env: `{ ENABLE_MCP: "true", PORT: "0" }`  (PORT=0 avoids conflicts; MCP is stdio)

Note: avoid `npm run ...` as it prints banner lines to stdout (e.g., `> node src ...`), which corrupts the stdio JSON‑RPC stream and causes MCP parse errors like “Unexpected token '>'”.

Gemini CLI example (`~/.gemini/settings.json`):
```
{
  "mcpServers": {
    "trader": {
      "transport": "stdio",
      "command": "/opt/homebrew/bin/npm",
      "args": ["run", "mcp"],
      "cwd": "/Users/you/path/trader-bench",
      "env": { "ENABLE_MCP": "true", "PORT": "0" }
    }
  },
  "allowedMcpServerNames": ["trader"]
}
```

## Headless Trading Agent

- Canonical prompt: `agent/prompt.md` (keep this concise and model‑agnostic)
- Quick run (Gemini CLI):
  - `npm run agent:gemini`
  - Override model: `AGENT_MODEL=gemini-2.0-pro npm run agent:gemini`
  - Alternate prompt: `AGENT_PROMPT_FILE=path/to/your.md npm run agent:gemini`
- Other CLIs: pass the contents of `agent/prompt.md` via your tool’s prompt flag (e.g., `-p "$(cat agent/prompt.md)"`).

Backend auto‑start (to stream stdout into the UI):
- The backend can optionally spawn your agent when a trading window opens.
- Set these via the Debug tab or `server/.env`:
  - `AGENT=YourAgentName`
  - `AGENT_START_CMD=/absolute/path/to/your/cli -p "$(cat /abs/path/to/repo/agent/prompt.md)"`
  - `AGENT_AUTO_START=true`

## Trading Agent Instructions (source of truth: `agent/prompt.md`)

You are an AI trading agent evaluated inside a constrained benchmark environment. You interact exclusively via MCP tools exposed by the `trader` server. Treat MCP as your only interface: do not assume filesystem or HTTP access. All actions must go through MCP tools.

Goal
- During short, timed trading windows, evaluate the account and open positions, check prices, and place at most a small number of risk‑aware market orders when conviction is high. When uncertain, make no trade and leave clear notes for the next window.

Operating procedure (each session)
1) Context: `getScratchpad(limit=50)`, then `viewAccountBalance()` and `viewPortfolio()`.
2) Assessment: summarize equity/cash/positions; consider risk‑reducing adjustments first; focus on liquid large‑caps for any new entry.
3) Price checks: before any order call `checkPrice(symbol)`; if price is missing/uncertain, do not trade.
4) Sizing: `qty = floor((equity * 0.10) / price)`. If `qty < 1`, skip the trade.
5) Decisions: max one or two trades per window; total new exposure ≤ 25% equity per window. Include a concise rationale in the `note` field (≤ 200 chars). If uncertain, don’t trade.
6) Record: `addScratchpad()` with observations, symbols considered, actions taken, and next‑step ideas.

Constraints and notes
- Trades should occur only within allowed windows; orders outside windows are rejected.
- Market orders only; integer shares only; paper trading only.
- If any tool call fails or data is missing, avoid trading and leave a note.
- Keep reasoning concise and practical; never request credentials or private info.

## Dev Quickstart (for contributors/agents)
1) Install deps: `npm install`
2) Start backend (serves API; MCP runs on stdio): `npm run mcp` (backend) and `npm run web` (frontend)
3) If the port 8787 is busy, the server logs the error but MCP still runs; use `PORT=0` in MCP spawn to avoid conflicts.
