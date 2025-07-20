const { spawn } = require('child_process');
const path = require('path');

function startProcess(script) {
    const proc = spawn('node', [path.join(__dirname, script)], { stdio: 'inherit' });
    proc.on('close', (code) => {
        console.log(`${script} exited with code ${code}`);
    });
    return proc;
}

const server = startProcess('mcpServer.js');
const scheduler = startProcess('scheduler.js');

function shutdown() {
    console.log('Shutting down child processes...');
    server.kill();
    scheduler.kill();
    process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
