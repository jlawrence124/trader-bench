# AGENTS

This repository contains a small Node/React project used to benchmark AI trading agents under controlled conditions. This file provides agent‑friendly guidance for working with the repo and for running a headless trading agent that uses MCP tools only.

## MCP Server
- Transport: stdio only
- Name (advertised): `trader-bench`
- Tools exposed:
  - `viewAccountBalance()` – equity, cash, buying power, status
  - `viewPortfolio()` – open positions (equities + options)
  - `checkPrice(symbol)` – current price for a ticker
  - `buyShares(symbol, quantity, note?)` – market buy (integer shares)
  - `sellShares(symbol, quantity, note?)` – market sell (integer shares)
  - `buildOptionContract(underlying, expiration, strike, right)` – build OCC symbol like `AAPL240920C00190000`
  - `checkOptionPrice(contract)` – latest option price per contract
  - `buyOptions(contract, contracts, note?)` – market buy (integer contracts)
  - `sellOptions(contract, contracts, note?)` – market sell (integer contracts)
  - `viewOptionsPortfolio()` – list open option positions
  - `getScratchpad(limit?)` – recent notes across windows
  - `addScratchpad(message, tags?, author?)` – append a note
  - `getWindowStatus()` – current/next trading window and timezone
  - `getMetrics()` – equityReturn, benchReturn, alpha (excess return vs SPY), maxDrawdown, sharpe

Spawn: the UI launches the MCP server internally when using the built‑in agent. If launching manually, prefer stdio:
- command: `node`
- args: `["server/src/index.js", "--mcp"]`
- cwd: repo root
- env: `{ ENABLE_MCP: "true", PORT: "0" }`

## Headless Trading Agent

- Canonical prompt: `agent/prompt.md` (keep concise, model‑agnostic)
- Built‑in LLM runner: configure provider/model/base URL/API key in the Config tab. Enable auto‑start to run during trading windows. Output appears in the Agent Output panel.

Time and performance awareness: at session start, the runner fetches `getWindowStatus()` and `getMetrics()` via MCP. If the optional Time MCP server is available (e.g., `uvx mcp-server-time` or `python -m mcp_server_time`), it also fetches the current time for the configured timezone and includes all three in a short context message (including current excess return vs SPY).

Note on “alpha”: In this project, the `alpha` field is a simple excess return vs SPY (`equityReturn - benchReturn`), not CAPM or multi-factor alpha.

Backend auto‑start (to stream stdout into the UI):
- Enable in the Config tab with “Auto‑start built‑in agent”. You can also set `AGENT_AUTO_START=true` in `server/.env`.

## Trading Agent Instructions (source of truth: `agent/prompt.md`)

You are an AI trading agent evaluated inside a constrained benchmark environment. You interact exclusively via MCP tools exposed by the `trader` server. Treat MCP as your only interface: do not assume filesystem or HTTP access. All actions must go through MCP tools.

Goal
- During short, timed trading windows or regular market hours, evaluate the account and open positions, check prices, and place at most a small number of risk‑aware market orders when conviction is high. When uncertain, make no trade and leave clear notes for the next window.

Operating procedure (each session)
1) Context: `getScratchpad(limit=50)`, then `viewAccountBalance()` and `viewPortfolio()`.
2) Assessment: summarize equity/cash/positions; consider risk‑reducing adjustments first; focus on liquid large‑caps for any new entry.
3) Price checks: before any equity order call `checkPrice(symbol)`. For options, call `checkOptionPrice(contract)`; if price is missing/uncertain, do not trade.
4) Sizing:
   - Shares: `qty = floor((equity * 0.10) / price)`.
   - Options: `contracts = floor((equity * 0.10) / (price * 100))` (100x multiplier).
   If result < 1, skip the trade.
5) Decisions: max one or two trades per session; total new exposure ≤ 25% equity per session. Include a concise rationale in the `note` field (≤ 200 chars). If uncertain, don’t trade.
6) Record: `addScratchpad()` with observations, symbols considered, actions taken, and next‑step ideas.

Constraints and notes
- Trades may occur during configured trading windows or regular market hours; orders outside both are rejected.
- Market orders only; integer shares/contracts only; paper trading only.
- Options use OCC contract symbols (e.g., `AAPL240920C00190000`) and a 100x multiplier.
- If any tool call fails or data is missing, avoid trading and leave a note.
- Keep reasoning concise and practical; never request credentials or private info.

## Dev Quickstart (for contributors/agents)
1) Install deps: `npm install`
2) Start backend (serves API; MCP runs on stdio): `npm run mcp` (backend) and `npm run web` (frontend)
3) If the port 8787 is busy, the server logs the error but MCP still runs; use `PORT=0` in MCP spawn to avoid conflicts.
