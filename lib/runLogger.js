const fs = require('fs');
const path = require('path');

const runsFile = path.join(__dirname, '..', 'data', 'runs.json');

function readRuns() {
    try {
        const data = fs.readFileSync(runsFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

function writeRuns(runs) {
    fs.writeFileSync(runsFile, JSON.stringify(runs, null, 2));
}

function appendRun(runData) {
    const runs = readRuns();
    runs.push(runData);
    writeRuns(runs);
}

module.exports = {
    appendRun,
};
