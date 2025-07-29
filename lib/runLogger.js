const fs = require('fs').promises;
const path = require('path');
const database = require('../src/database/database');
const logger = require('./logger');

const runsFile = path.join(__dirname, '..', 'data', 'runs.json');
let writeQueue = [];
let isWriting = false;
let useDatabase = false;

// Initialize database connection
database.initialize().then(() => {
    useDatabase = true;
    logger.info('RunLogger using database storage');
}).catch(error => {
    logger.warn('RunLogger falling back to file storage', { error: error.message });
    useDatabase = false;
});

async function readRuns() {
    if (useDatabase) {
        try {
            return await database.getRuns();
        } catch (error) {
            logger.error('Failed to read runs from database, falling back to file', { error: error.message });
        }
    }
    
    // Fallback to file-based storage
    try {
        const data = await fs.readFile(runsFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

async function writeRuns(runs) {
    await fs.mkdir(path.dirname(runsFile), { recursive: true });
    await fs.writeFile(runsFile, JSON.stringify(runs, null, 2));
}

async function processWriteQueue() {
    if (isWriting || writeQueue.length === 0) return;
    
    isWriting = true;
    while (writeQueue.length > 0) {
        const runData = writeQueue.shift();
        try {
            if (useDatabase) {
                await database.saveRun(runData);
            } else {
                // Fallback to file storage
                const runs = await readRuns();
                runs.push(runData);
                await writeRuns(runs);
            }
        } catch (error) {
            logger.error('Failed to write run data', { runData, error: error.message });
        }
    }
    isWriting = false;
}

function appendRun(runData) {
    writeQueue.push(runData);
    setImmediate(() => processWriteQueue());
}

module.exports = {
    appendRun,
    readRuns,
    writeRuns,
    database, // Export database instance for advanced queries
};
