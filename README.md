# Trader Bench

AI model trading benchmark with:
- MCP server exposing tools: viewPortfolio, checkPrice, buyShares, sellShares, viewAccountBalance
- Paper trading via Alpaca
- Daily trading windows with strict enforcement
- Baseline against S&P 500 (SPY proxy)
- Backend with metrics, logging, and Server-Sent Events (SSE)
- React + Tailwind dashboard for charts, logs, portfolio, and metrics

## Quick Start

1) Prereqs: Node 18+, npm, Alpaca API keys (paper trading)

2) Setup env:
- Copy `.env.example` to `server/.env` and fill in keys

3) Install deps:
- `npm install` (installs server and web workspaces)

4) Start backend (+ MCP on stdio) and web:
- Backend: `npm run mcp` (serves HTTP API on port 8787)
- Web: `npm run web` (port 5173)

If you change the backend port, update `web/vite.config.js` proxy target to match.

Note: The MCP server runs over stdio. Configure your agent to launch `npm run mcp` in the `server` workspace. The agent will only see the MCP tools; no filesystem or other project structure is exposed.

## Trading Windows
- Defaults (US/Eastern): 08:00, 09:31, 12:00, 15:55;
- Each window lasts `WINDOW_DURATION_MINUTES` (default 4);
- Trades are only allowed inside windows; attempts outside are rejected;
- Configure via `TIMEZONE`, `TRADING_WINDOWS`, `WINDOW_DURATION_MINUTES` in `server/.env`.

## Metrics
- Portfolio vs SPY cumulative return
- Max drawdown
- Sharpe estimate
- Logs of tool calls (actions) + optional notes captured and displayed

## Frontend
- Dashboard shows: equity vs SPY chart, summary stats, open positions, live action log
- Streams real-time events via SSE from `GET /api/events`

## Backend API
- `GET /api/account` – account summary
- `GET /api/positions` – current positions
- `GET /api/equity` – equity time series
- `GET /api/benchmark` – SPY time series
- `GET /api/metrics` – ROI, drawdown, Sharpe
- `GET /api/logs` – recent action log
- `GET /api/events` – SSE stream (live events)

## MCP Tools
- viewPortfolio(symbol?)
- checkPrice(symbol)
- buyShares(symbol, quantity, note?)
- sellShares(symbol, quantity, note?)
- viewAccountBalance()

Notes:
- Only runs on Alpaca paper trading (`paper: true`). No options trading.
- Tool calls are logged (with args) to JSONL in `server/data/` and streamed to UI.
- You can pass an optional `note` for buy/sell to surface “thoughts” in the logs.

## Inspiration
Inspired by vendingBench concepts for constrained, fair, comparable benchmarking. We enforce timed windows and consistent baseline comparison.

## Scripts
- `npm run backend` – start API + MCP (stdio) in one process (no stdout noise)
- `npm run mcp` – MCP only mode (stdio) with API enabled in-process
- `npm run web` – dev server for frontend (Vite)
- `npm run build` – build both server and web
- `npm run agent:gemini` – launch Gemini CLI headless using the standard prompt

## Data Storage
- Append-only JSONL logs in `server/data/`
- Equity and benchmark series sampled periodically

## Caution
- Do not use real money — this uses Alpaca paper trading only.
- Set your timezone carefully for accurate window enforcement.

## Headless Agent Prompt

A standard, model-agnostic prompt lives at `agent/prompt.md`. Edit this file to adjust behavior and constraints. It’s designed to work with any agent CLI that accepts a prompt string.

Quick start (CLI example):
- Ensure your Gemini CLI is installed and MCP server entry is configured in `~/.gemini/settings.json`.
- From the repo root, run: `npm run agent:gemini`
  - Override model: `AGENT_MODEL=gemini-2.0-pro npm run agent:gemini`
  - Use a different prompt file: `AGENT_PROMPT_FILE=path/to/your.md npm run agent:gemini`

Notes:
- The agent interacts only through MCP tools; it does not rely on project files.
- The MCP server is stdio-based and is spawned by your agent CLI per your configuration.

Other agents
- Use the same prompt file (`agent/prompt.md`) and pass its contents according to your CLI’s convention (e.g., `-p "$(cat agent/prompt.md)"` or piping the file content).
- Set the backend’s “Agent Start Command” to the CLI you prefer; only processes started by the backend stream `agent.stdout` into the UI.
