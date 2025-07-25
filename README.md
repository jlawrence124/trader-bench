# Trader Bench

This project provides a sandboxed environment for testing the performance of AI agents in a simulated stock trading scenario using paper money from [Alpaca](https://alpaca.markets/). It is designed to create a "black box" testing environment where the agent interacts with the market through a clearly defined API, without access to the underlying benchmark infrastructure.

## Architecture

The benchmark is composed of two main components that run independently:

1.  **MCP Server (`mcpHttpServer.js`)**: Exposes an HTTP RPC interface to Alpaca functions. Agents connect to this server using the shared `MCPClient` and no longer need to be spawned as child processes.

2.  **Scheduler (`scheduler.js`)**: This component acts as the "hypervisor" for the trading environment. It runs on a predefined schedule based on US market hours and announces "trading windows" during which the AI agent is expected to perform its tasks. This simulates real-world trading sessions.

3.  **Trading Agent (`trading_agent/`)**: This is the isolated environment where the AI's trading logic resides. The agent uses the shared `mcpClient.js` module to communicate with the MCP Server but has no direct access to any other part of the benchmark's code. This ensures that the agent's performance is evaluated solely on its ability to interact with the provided API.

---
## Benchmark Flow

`startAll.js` acts as the master layer that launches the MCP server, the scheduler, and the web dashboard. The scheduler wakes up four times each weekday and grants the trading agent a **two-minute** window to act. During this window the agent may browse the web for research, check account status via MCP, and submit orders.

Default schedule (Eastern Time):

- **8:30 AM** – pre-market (one hour before open)
- **9:30 AM** – market open
- **12:00 PM** – midday
- **3:55 PM** – five minutes before market close

After each run, the benchmark compares the portfolio gain against the S&P 500 (using the SPY ETF). The difference is saved to `data/runs.json` as that run's score.

## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later recommended)
*   An [Alpaca paper trading account](https://app.alpaca.markets/signup) to get your API keys.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd bench_ai_spy
    ```

2.  **Install Benchmark Dependencies:**
    Install the necessary packages for the server and scheduler.
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the project root by copying the example file.
    ```bash
    cp .env.example .env
    ```
    Open the `.env` file and add your Alpaca API Key ID and Secret Key:
    ```
    APCA_API_KEY=YOUR_API_KEY
    APCA_API_SECRET=YOUR_SECRET_KEY
    ```

4.  **Install Agent Dependencies:**
    Navigate to the agent's directory and install its dependencies.
    ```bash
    cd trading_agent
    npm install
    cd ..
    ```

---

## How to Run the Benchmark

The system traditionally requires two separate terminal sessions to run correctly.

**1. Terminal 1: Start the MCP Server**
This server exposes an HTTP RPC interface for agents.
```bash
npm start
```
You should see a message indicating the server is listening on a port.

**2. Terminal 2: Start the Scheduler**
This will trigger the trading windows at the scheduled times.
```bash
npm run start:scheduler
```
You should see the message: `Scheduler started. Waiting for the next trading window.`

The scheduler now starts the agent process itself. Set `AGENT_CMD` to the CLI command for your model (defaults to the provided Node agent). The scheduler passes `MCP_SERVER_URL` so the agent can connect to the running server. Many CLIs start in interactive mode, so include your prompt in `AGENT_CMD` to run non-interactively. For example:

```bash
export AGENT_CMD="gemini -p trading_agent/prompt.txt"
# or
export AGENT_CMD='codex --full-auto "create the fanciest todo-list app"'
```

When launching from the dashboard, enter a prompt in the **Debug** tab before clicking **Run Agent** and it will be appended to `AGENT_CMD` as a single argument.

**Convenience Command**

If you prefer to launch both processes from a single terminal, use the provided script:

```bash
npm run start:all
```

This starts the HTTP MCP server and scheduler as child processes and forwards their output to the console.

### Web Dashboard

A simple React-based dashboard is available to view recent runs and logs. Start it with:

```bash
npm run start:web
```


### GitHub Codespaces

This repo includes a `.devcontainer` folder so you can spin up a Codespace (or Dev Container) and run the dashboard entirely in the cloud. The container automatically installs dependencies and forwards port 3000. From a browser or mobile device you can start the UI with `npm run start:web`.

---

## API Capabilities

The agent can interact with the MCP server using the following methods:

*   `getCapabilities()`: Returns a list of available functions and any environmental limitations.
    *   **Caveat**: The current environment **does not support options trading**.
*   `getMarketData(symbol)`: Fetches the latest quote for a stock.
*   `submitOrder(orderDetails)`: Submits a new order.
*   `cancelOrder(orderId)`: Cancels an existing order.
*   `getPositions()`: Retrieves a list of current positions.
*   `getAccountInfo()`: Fetches account details.
*   `getHistoricalBars(symbol, timeframe, start, end)`: Gets historical price data.
*   `compareWithSP500(start, end)`: Returns portfolio gains alongside equivalent gains for the S&P 500 (via the SPY ETF) for the given period.

## Developing Your Agent

The logic for your AI agent should be implemented in the `trading_agent/agent.js` file. You can use the provided `MCPClient` to interact with the benchmark server. The `agent.js` file includes a basic example of how to fetch capabilities and market data.

---

## Project Structure

```
.
├── mcpHttpServer.js      # The main benchmark server
├── scheduler.js          # Schedules the trading windows
├── package.json          # Project dependencies and scripts
├── .env.example          # Example environment file for Alpaca keys
├── webServer.js          # Express server for the web dashboard
├── frontend/             # Static files for the dashboard
├── lib/
│   ├── logger.js         # Server-side logging utility
│   └── shared/
│       └── mcpClient.js  # Shared client library for agent-server communication
└── trading_agent/
    ├── agent.js          # The AI agent's trading logic
    ├── package.json      # The agent's own dependencies
    └── lib/
        └── logger.js     # Agent-specific logger factory
```

## Configuration

### Environment Variables

The `.env` file stores your Alpaca credentials. Copy `.env.example` and add your
keys:

```bash
cp .env.example .env
```

```
APCA_API_KEY=YOUR_API_KEY
APCA_API_SECRET=YOUR_SECRET_KEY
# APCA_API_BASE_URL=https://paper-api.alpaca.markets
```

`APCA_API_BASE_URL` is optional if you need to point to a different Alpaca
endpoint. The trading agent also accepts a `MODEL_NAME` variable. When set it is
combined with the current date to create a run ID and all agent logs are written
to `trading_agent/logs/<runId>/agent.log`.

Additional variables:

- `MCP_PORT` sets the port for the HTTP server (default `4000`).
- `MCP_SERVER_URL` defaults to `http://localhost:${MCP_PORT}/rpc` and normally doesn't need to be changed.
- `AGENT_CMD` is the CLI command used to launch your agent (e.g. `gemini`, `codex`, `claude`, or `opencode`).
- `MODEL_NAME` is inferred from `AGENT_CMD` when you save it and tags each run.
- `AGENT_STARTUP_DELAY` waits this many seconds before the countdown begins so heavier agents can finish loading.
- To avoid interactive mode with CLI agents, include your prompt in `AGENT_CMD`.
  For example: `gemini -p trading_agent/prompt.txt` or
  `codex --full-auto "create the fanciest todo-list app"`.

  You can also POST `{ "prompt": "your text" }` to `/api/run-agent` to append the text
  as a single argument when launching from the dashboard.


These variables can be inspected from the dashboard's **Debug** tab, which hides secret values unless you choose to reveal them. When the UI first loads it will prompt for any missing variables and you can continue anyway if you just want to explore.

### Logging Locations

Benchmark logs are written to `logs/trading_YYYY-MM-DD.log` in the project root.
Each agent run writes to its own folder under `trading_agent/logs/`.
The **Benchmark** tab automatically shows the most recent server and agent logs
along with any `model_output.log` generated by the agent. Start a run from the
dashboard to begin streaming these logs.

### Adjusting Trading Windows

Edit `scheduler.js` to change the trading schedule. The `tradingTimes` array
holds cron expressions for window start times and `tradingWindowMinutes`
controls how long each window stays open (default is two minutes).
Set `AGENT_STARTUP_DELAY` if your agent needs extra time to load before the
window timer begins.
