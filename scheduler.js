
const cron = require('node-cron');


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

    let countdown = tradingWindowMinutes * 60;
    const interval = setInterval(() => {
        countdown--;
        process.stdout.write(`Time remaining: ${Math.floor(countdown / 60)}m ${countdown % 60}s   \r`);

        if (countdown <= 0) {
            clearInterval(interval);
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
