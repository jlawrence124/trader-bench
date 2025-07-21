
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

const tradingTimes = [
    '30 8 * * 1-5',  // 8:30 AM on weekdays
    '30 9 * * 1-5',  // 9:30 AM on weekdays
    '0 12 * * 1-5', // 12:00 PM on weekdays
    '0 16 * * 1-5'  // 4:00 PM on weekdays
];

const tradingWindowMinutes = 2;

function startTradingWindow() {
    console.log(`
    =================================================
    Trading window now OPEN for ${tradingWindowMinutes} minutes.
    =================================================
    `);

    const agentCmd = process.env.AGENT_CMD || `node ${path.join(__dirname, 'trading_agent', 'agent.js')}`;
    const [cmd, ...args] = agentCmd.split(' ');
    const mcpUrl = process.env.MCP_SERVER_URL || `http://localhost:${process.env.MCP_PORT || 4000}/rpc`;
    const agent = spawn(cmd, args, {
        stdio: 'inherit',
        env: { ...process.env, MCP_SERVER_URL: mcpUrl },
    });

    let countdown = tradingWindowMinutes * 60;
    const interval = setInterval(() => {
        countdown--;
        process.stdout.write(`Time remaining: ${Math.floor(countdown / 60)}m ${countdown % 60}s   \r`);

        if (countdown <= 0) {
            clearInterval(interval);
            agent.kill();
            console.log(`
    =================================================
    Trading window CLOSED.
    =================================================
            `);
        }
    }, 1000);
}

console.log('Scheduler started. Waiting for the next trading window.');

tradingTimes.forEach(time => {
    cron.schedule(time, startTradingWindow, {
        timezone: "America/New_York"
    });
});
