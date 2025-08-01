
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const alpacaService = require('./src/alpacaService');
const { appendRun } = require('./lib/runLogger');

const tradingTimes = [
    '30 8 * * 1-5',  // 8:30 AM on weekdays (pre-market)
    '30 9 * * 1-5',  // 9:30 AM on weekdays (open)
    '0 12 * * 1-5',  // 12:00 PM on weekdays (midday)
    '55 15 * * 1-5'  // 3:55 PM on weekdays (five minutes before close)
];

const tradingWindowMinutes = 2;
const startupDelaySeconds = parseInt(process.env.AGENT_STARTUP_DELAY || '0', 10);

function startTradingWindow() {
    console.log(`
    =================================================
    Trading window now OPEN for ${tradingWindowMinutes} minutes.
    =================================================
    `);

    const startTime = new Date();
    const modelName = process.env.MODEL_NAME || 'default_agent';
    const runId = `${modelName}_${startTime.toISOString()}`;

    const agentCmd = process.env.AGENT_CMD || `node ${path.join(__dirname, 'trading_agent', 'agent.js')}`;
    const [cmd, ...args] = agentCmd.split(' ');
    const mcpUrl = process.env.MCP_SERVER_URL || `http://localhost:${process.env.MCP_PORT || 4000}/rpc`;
    const agent = spawn(cmd, args, {
        stdio: 'inherit',
        env: { ...process.env, MCP_SERVER_URL: mcpUrl, RUN_ID: runId },
    });

    agent.on('close', async () => {
        if (countdownInterval) clearInterval(countdownInterval);
        const end = new Date();
        try {
            const comparison = await alpacaService.compareWithSP500(
                startTime.toISOString().split('T')[0],
                end.toISOString().split('T')[0]
            );
            const history = await alpacaService.getPortfolioHistory(
                startTime.toISOString(),
                end.toISOString(),
                '1Min'
            );
            const spyBars = await alpacaService.getHistoricalBars(
                'SPY',
                '1Min',
                startTime.toISOString(),
                end.toISOString()
            );
            const bars = spyBars.bars || spyBars;
            const spyHistory = Array.isArray(bars)
                ? bars.map(b => parseFloat(b.c ?? b.close ?? b.o))
                : [];
            appendRun({
                model: modelName,
                runId,
                startDate: startTime.toISOString(),
                endDate: end.toISOString(),
                spyGain: comparison.spyGain,
                portfolioGain: comparison.accountGain,
                equityHistory: history.equity || history,
                spyHistory,
            });
        } catch (err) {
            console.error('Failed to record run results:', err);
        }
    });

    let countdownInterval;
    const startCountdown = () => {
        let countdown = tradingWindowMinutes * 60;
        countdownInterval = setInterval(() => {
            countdown--;
            process.stdout.write(`Time remaining: ${Math.floor(countdown / 60)}m ${countdown % 60}s   \r`);

            if (countdown <= 0) {
                clearInterval(countdownInterval);
                agent.kill();
                console.log(`
    =================================================
    Trading window CLOSED.
    =================================================
                `);
            }
        }, 1000);
    };

    if (startupDelaySeconds > 0) {
        console.log(`Waiting ${startupDelaySeconds} seconds for agent startup...`);
        setTimeout(startCountdown, startupDelaySeconds * 1000);
    } else {
        startCountdown();
    }
}

console.log('Scheduler started. Waiting for the next trading window.');

tradingTimes.forEach(time => {
    cron.schedule(time, startTradingWindow, {
        timezone: "America/New_York"
    });
});
