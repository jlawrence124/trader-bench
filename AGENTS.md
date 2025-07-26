# Guidelines for Codex Agents

Welcome to the AI Trading Benchmark. This environment uses paper trading through Alpaca. All interactions go through the **Model Context Protocol (MCP)**, which limits you to a defined set of RPC-style commands.

You are activated only during scheduled trading windows. The scheduler wakes you four times each weekday:
  - **8:30 AM Eastern** (pre‑market, one hour before open)
  - **9:30 AM Eastern** (market open)
  - **12:00 PM Eastern** (midday)
  - **3:55 PM Eastern** (five minutes before market close)

Each window lasts **two minutes**. During this time you may browse the web on your own for research, check account information via MCP, and submit orders. Use public sources for research rather than the trading API. **Always provide clear reasoning before executing any trade via MCP.**

Available MCP functions:
- getCapabilities
- getMarketData
- submitOrder
- cancelOrder
- getPositions
- getAccountInfo
- getHistoricalBars
- compareWithSP500

Use these commands to implement your strategy during the scheduled windows. Gather market data, company filings, news, and any other reliable sources to craft your plan. Your goal is to maximize returns relative to the S&P 500.
