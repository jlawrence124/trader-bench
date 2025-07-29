# Trader Bench

This project provides a sandboxed environment for testing the performance of AI agents in a simulated stock trading scenario using paper money from [Alpaca](https://alpaca.markets/). It is designed to create a "black box" testing environment where the agent interacts with the market through a clearly defined API via Model Context Protocol, without access to the underlying benchmark infrastructure.

## 🏗️ Architecture

The benchmark uses a modern, enterprise-grade architecture with proper separation of concerns:

### Core Components

1. **MCP Server (`mcpHttpServer.js`)**: Secure HTTP RPC interface to Alpaca functions with rate limiting, circuit breakers, and comprehensive error handling.

2. **Scheduler (`schedulingService.js`)**: Production-ready scheduler with proper resource management, graceful shutdowns, and health monitoring.

3. **Web Dashboard (`webServer.js`)**: Secure Express server with compression, security headers, input validation, and comprehensive API endpoints.

4. **Trading Agent (`trading_agent/`)**: Isolated environment where AI trading logic resides, communicating via the shared `MCPClient`.

### Service Layer Architecture

```
src/
├── services/          # Business logic layer
│   ├── tradingService.js      # Trading operations with caching
│   ├── schedulingService.js   # Agent scheduling and management  
│   └── benchmarkService.js    # Performance analysis and reporting
├── controllers/       # API request handling
│   └── apiController.js       # RESTful API endpoints
├── middleware/        # Cross-cutting concerns
│   └── security.js           # Rate limiting, validation, sanitization
└── database/         # Data persistence
    └── database.js           # SQLite with proper schemas and indexes
```

## 🚀 Benchmark Flow

`startAll.js` launches the MCP server, scheduler, and web dashboard. The scheduler runs four times each weekday, granting the trading agent a **two-minute** window to act. During this window the agent may browse the web for research, check account status via MCP, and submit orders.

**Default Schedule (Eastern Time):**
- **8:30 AM** – Pre-market (one hour before open)
- **9:30 AM** – Market open
- **12:00 PM** – Midday
- **3:55 PM** – Five minutes before market close

After each run, the benchmark compares portfolio performance against the S&P 500 (SPY ETF). Results are stored in a SQLite database with automatic backup to JSON files.

---

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Alpaca paper trading account](https://app.alpaca.markets/signup) for API keys
- 4GB+ RAM recommended for optimal performance

---

## ⚙️ Installation

### 1. Clone and Setup
```bash
git clone <repository-url>
cd bench_ai_spy
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and add your Alpaca credentials:
```bash
APCA_API_KEY=YOUR_API_KEY
APCA_API_SECRET=YOUR_SECRET_KEY
# Optional: APCA_API_BASE_URL=https://paper-api.alpaca.markets
```

### 3. Install Agent Dependencies
```bash
cd trading_agent
npm install
cd ..
```

### 4. Run Tests (Optional)
```bash
npm test  # Verify installation
```

---

## 🎯 Quick Start

### Option 1: All-in-One (Recommended)
```bash
npm run start:all
```
This starts all services with proper process management and logging.

### Option 2: Individual Services
```bash
# Terminal 1: MCP Server
npm start

# Terminal 2: Scheduler  
npm run start:scheduler

# Terminal 3: Web Dashboard
npm run start:web
```

### Option 3: Web Dashboard Only
```bash
npm run start:web
```
Visit http://localhost:3000 to access the dashboard with full manual control.

---

## 🖥️ Web Dashboard Features

The dashboard provides comprehensive control and monitoring:

- **Recent Runs**: Performance analytics with interactive charts
- **Overview**: Real-time account status and position monitoring  
- **Logs**: Live log streaming with search and filtering
- **Benchmark Control**: Start/stop benchmark runs with real-time status
- **Positions**: Portfolio management with profit/loss tracking
- **Orders**: Order history and management
- **Debug**: Environment configuration and manual agent testing

---

## API Capabilities

Enhanced MCP server provides these methods with improved reliability:

### Core Trading Functions
- `getCapabilities()`: Available functions and system limitations
- `getMarketData(symbol)`: Real-time quotes with caching
- `submitOrder(orderDetails)`: Order submission with validation
- `cancelOrder(orderId)`: Individual order cancellation
- `cancelAllOrders()`: Bulk order cancellation
- `closeAllPositions()`: Portfolio liquidation

### Account & Data Functions  
- `getAccountInfo()`: Account details with fallback data
- `getPositions()`: Current positions with P&L
- `getOrders(limit, status)`: Order history with filtering
- `getHistoricalBars(symbol, timeframe, start, end)`: Historical data
- `compareWithSP500(start, end)`: Performance benchmarking

---

## Agent Configuration
Set `AGENT_CMD` for different AI models:
```bash
# Examples
export AGENT_CMD="gemini -p trading_agent/prompt.txt"
export AGENT_CMD="codex --full-auto 'Your trading prompt here'"
export AGENT_CMD="claude -p 'Analyze market and make trades'"
export AGENT_CMD="opencode run -q 'Trade based on market analysis'"
```

---

## Project Structure

```
bench_ai_spy/
├── Core Services
│   ├── mcpHttpServer.js          # Secure MCP server with circuit breakers
│   ├── scheduler.js              # Production scheduler with cleanup
│   ├── webServer.js              # Secure web server with middleware
│   └── startAll.js               # Process orchestration
├── Service Layer  
│   └── src/
│       ├── services/             # Business logic
│       │   ├── tradingService.js     # Trading ops + caching
│       │   ├── schedulingService.js  # Agent management  
│       │   └── benchmarkService.js   # Performance analysis
│       ├── controllers/          # API controllers
│       │   └── apiController.js      # RESTful endpoints
│       ├── middleware/           # Security & validation
│       │   └── security.js           # Rate limiting, sanitization
│       ├── database/             # Data persistence
│       │   └── database.js           # SQLite with schemas
│       └── alpacaService.js      # Enhanced Alpaca integration
├── Data & Logging
│   ├── data/                     # SQLite database + JSON backups
│   ├── logs/                     # Structured application logs
│   └── lib/                      # Shared utilities
│       ├── logger.js                 # Async logging system
│       ├── runLogger.js             # Database-backed run storage
│       └── shared/
│           └── mcpClient.js          # Enhanced MCP client
├── Trading Agent
│   └── trading_agent/
│       ├── agent.js              # Your AI trading logic
│       ├── logs/                 # Per-run agent logs
│       └── lib/
│           └── logger.js             # Agent logging factory
├── Web Interface
│   └── frontend/
│       ├── index.html            # Dashboard UI
│       └── script.js             # React-based interface
└── Testing
    └── __tests__/                # Comprehensive test suite
```

---

## Configuration

### Environment Variables

**Core Configuration:**
```bash
# Alpaca Trading (Required)
APCA_API_KEY=your_api_key
APCA_API_SECRET=your_secret_key
APCA_API_BASE_URL=https://paper-api.alpaca.markets  # Optional

# Server Configuration
MCP_PORT=4000                    # MCP server port
MCP_SERVER_URL=http://localhost:4000/rpc  # Auto-configured
PORT=3000                        # Web dashboard port

# Agent Configuration  
AGENT_CMD=node trading_agent/agent.js    # Agent command
MODEL_NAME=default_agent         # Run identification
AGENT_STARTUP_DELAY=0           # Startup delay in seconds

# Advanced Configuration
SCHEDULER_HEALTH_PORT=3001      # Health check port
NODE_ENV=development            # Environment mode
```

**New Security Settings:**
- Rate limits automatically applied
- Environment access restricted to whitelisted variables
- Input validation on all endpoints
- Comprehensive audit logging enabled

### Database Configuration

The system automatically:
- Creates SQLite database with optimized schema
- Falls back to JSON files if database unavailable  
- Runs maintenance tasks (VACUUM, ANALYZE)
- Provides backup and recovery mechanisms

### Logging System

**Enhanced Logging:**
- **Application**: `logs/trading_YYYY-MM-DD.log` (structured JSON)
- **Agent Runs**: `trading_agent/logs/<runId>/` (per-run isolation)
- **Database**: Run data stored with full audit trail
- **Security**: All security events logged with context

---

## 🔧 Advanced Configuration

### Trading Schedule Customization
Modify `src/services/schedulingService.js`:
```javascript
tradingTimes: [
    '30 8 * * 1-5',  // 8:30 AM EST (pre-market)
    '30 9 * * 1-5',  // 9:30 AM EST (market open)  
    '0 12 * * 1-5',  // 12:00 PM EST (midday)
    '55 15 * * 1-5'  // 3:55 PM EST (near close)
]
```

### Performance Tuning
```bash
# Database optimization
export NODE_OPTIONS="--max-old-space-size=4096"  # Increase memory

# Caching configuration (in tradingService.js)
this.cacheTimeout = 30000;  # Account data cache (30s)
marketDataCache = 5000;     # Market data cache (5s)  
ordersCache = 15000;        # Orders cache (15s)
```

### Security Hardening
Rate limits in `src/middleware/security.js`:
```javascript
apiLimiter: 100 requests / 15 minutes      # General API
tradingLimiter: 10 requests / 1 minute     # Trading operations
envUpdateLimiter: 5 requests / 5 minutes   # Environment updates
```

---

## 🏥 Health & Monitoring

### Health Check Endpoints
```bash
# MCP Server Health
curl http://localhost:4000/health

# Scheduler Health  
curl http://localhost:3001/health

# Web Server Status
curl http://localhost:3000/api/run-status
```

### Performance Monitoring
- Memory usage tracking
- Process uptime monitoring  
- Database query performance
- API response times
- Circuit breaker status

### Log Analysis
```bash
# View recent logs
npm run logs

# Database queries
sqlite3 data/trading.db "SELECT * FROM runs ORDER BY start_date DESC LIMIT 10"

# Performance metrics
curl http://localhost:3000/api/runs/summary
```

---

## 🐛 Troubleshooting

### Common Issues

**Database Connection:**
```bash
# Check database
sqlite3 data/trading.db ".tables"

# Reset database  
rm data/trading.db && npm start
```

**Memory Issues:**
```bash
# Monitor memory
curl http://localhost:3001/health | jq '.memory'

# Increase Node.js memory
export NODE_OPTIONS="--max-old-space-size=4096"
```

**API Rate Limits:**
- Check dashboard Debug tab for rate limit status
- Adjust limits in `src/middleware/security.js`
- Monitor with `curl -I http://localhost:3000/api/account`

**Agent Failures:**
- Check `trading_agent/logs/<runId>/agent.log`
- Verify `AGENT_CMD` configuration
- Test manually: `npm run debug`

### Support

For issues:
1. Check the logs in dashboard **Logs** tab
2. Verify configuration in **Debug** tab  
3. Run health checks on all services
4. Review database integrity with provided tools

---

## Production Deployment

### Recommended Setup
```bash
# Process management
npm install -g pm2
pm2 start ecosystem.config.js

# Nginx reverse proxy (optional)
sudo apt install nginx
# Configure SSL and load balancing

# Database backup
crontab -e  # Add: 0 2 * * * /path/to/backup-script.sh
```
