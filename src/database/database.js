const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
const logger = require('../../lib/logger');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '../../data/trading.db');
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // Ensure data directory exists
            await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

            // Connect to database
            this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
            
            // Enable WAL mode for better concurrency
            await this.run('PRAGMA journal_mode = WAL');
            await this.run('PRAGMA synchronous = NORMAL');
            await this.run('PRAGMA cache_size = 1000');
            await this.run('PRAGMA foreign_keys = ON');

            await this.createTables();
            this.isInitialized = true;
            
            logger.info('Database initialized successfully', { path: this.dbPath });
        } catch (error) {
            logger.error('Failed to initialize database', { error: error.message });
            throw error;
        }
    }

    async createTables() {
        const tables = [
            // Runs table
            `CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT UNIQUE NOT NULL,
                model TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                spy_gain REAL DEFAULT 0,
                portfolio_gain REAL DEFAULT 0,
                relative_gain REAL DEFAULT 0,
                equity_history TEXT, -- JSON array
                spy_history TEXT,    -- JSON array
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Trades table (for detailed trade tracking)
            `CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                method TEXT NOT NULL,
                params TEXT, -- JSON
                result TEXT, -- JSON
                error TEXT,
                duration_ms INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (run_id) REFERENCES runs(run_id)
            )`,

            // System logs table
            `CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                data TEXT, -- JSON
                timestamp TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Cache table for frequently accessed data
            `CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL, -- JSON
                expires_at INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const table of tables) {
            await this.run(table);
        }

        // Create indexes for better performance
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model)',
            'CREATE INDEX IF NOT EXISTS idx_runs_start_date ON runs(start_date)',
            'CREATE INDEX IF NOT EXISTS idx_trades_run_id ON trades(run_id)',
            'CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level)',
            'CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at)'
        ];

        for (const index of indexes) {
            await this.run(index);
        }
    }

    // Runs operations
    async saveRun(runData) {
        const {
            runId, model, startDate, endDate,
            spyGain = 0, portfolioGain = 0,
            equityHistory = [], spyHistory = []
        } = runData;

        const relativeGain = portfolioGain - spyGain;

        await this.run(`
            INSERT OR REPLACE INTO runs 
            (run_id, model, start_date, end_date, spy_gain, portfolio_gain, relative_gain, equity_history, spy_history, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            runId, model, startDate, endDate,
            spyGain, portfolioGain, relativeGain,
            JSON.stringify(equityHistory),
            JSON.stringify(spyHistory)
        ]);

        logger.info('Run saved to database', { runId, model });
    }

    async getRuns(limit = 100, offset = 0) {
        const rows = await this.all(`
            SELECT * FROM runs 
            ORDER BY start_date DESC 
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        return rows.map(row => ({
            ...row,
            equityHistory: this.parseJSON(row.equity_history) || [],
            spyHistory: this.parseJSON(row.spy_history) || []
        }));
    }

    async getRunById(runId) {
        const row = await this.get('SELECT * FROM runs WHERE run_id = ?', [runId]);
        if (!row) return null;

        return {
            ...row,
            equityHistory: this.parseJSON(row.equity_history) || [],
            spyHistory: this.parseJSON(row.spy_history) || []
        };
    }

    async getRunsSummary() {
        const stats = await this.get(`
            SELECT 
                COUNT(*) as total_runs,
                COUNT(CASE WHEN portfolio_gain IS NOT NULL THEN 1 END) as successful_runs,
                AVG(portfolio_gain) as average_gain,
                MAX(portfolio_gain) as best_gain,
                MIN(portfolio_gain) as worst_gain
            FROM runs
        `);

        const bestRun = await this.get(`
            SELECT * FROM runs 
            WHERE portfolio_gain = (SELECT MAX(portfolio_gain) FROM runs)
            LIMIT 1
        `);

        const worstRun = await this.get(`
            SELECT * FROM runs 
            WHERE portfolio_gain = (SELECT MIN(portfolio_gain) FROM runs)
            LIMIT 1
        `);

        const lastRun = await this.get(`
            SELECT * FROM runs 
            ORDER BY start_date DESC 
            LIMIT 1
        `);

        return {
            totalRuns: stats.total_runs || 0,
            successfulRuns: stats.successful_runs || 0,
            averageGain: stats.average_gain || 0,
            bestRun: bestRun ? { ...bestRun, equityHistory: this.parseJSON(bestRun.equity_history) || [] } : null,
            worstRun: worstRun ? { ...worstRun, equityHistory: this.parseJSON(worstRun.equity_history) || [] } : null,
            lastRun: lastRun ? { ...lastRun, equityHistory: this.parseJSON(lastRun.equity_history) || [] } : null
        };
    }

    // Trade tracking
    async saveTrade(tradeData) {
        const {
            runId, timestamp, method, params = null,
            result = null, error = null, durationMs = null
        } = tradeData;

        await this.run(`
            INSERT INTO trades (run_id, timestamp, method, params, result, error, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            runId, timestamp, method,
            params ? JSON.stringify(params) : null,
            result ? JSON.stringify(result) : null,
            error, durationMs
        ]);
    }

    async getTradesByRun(runId, limit = 1000) {
        const rows = await this.all(`
            SELECT * FROM trades 
            WHERE run_id = ? 
            ORDER BY timestamp ASC 
            LIMIT ?
        `, [runId, limit]);

        return rows.map(row => ({
            ...row,
            params: this.parseJSON(row.params),
            result: this.parseJSON(row.result)
        }));
    }

    // System logging
    async saveSystemLog(level, message, data = null) {
        await this.run(`
            INSERT INTO system_logs (level, message, data, timestamp)
            VALUES (?, ?, ?, ?)
        `, [level, message, data ? JSON.stringify(data) : null, new Date().toISOString()]);
    }

    async getSystemLogs(level = null, limit = 1000) {
        let query = 'SELECT * FROM system_logs';
        let params = [];

        if (level) {
            query += ' WHERE level = ?';
            params.push(level);
        }

        query += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);

        const rows = await this.all(query, params);
        return rows.map(row => ({
            ...row,
            data: this.parseJSON(row.data)
        }));
    }

    // Cache operations
    async setCache(key, value, ttlSeconds = 300) {
        const expiresAt = Date.now() + (ttlSeconds * 1000);
        await this.run(`
            INSERT OR REPLACE INTO cache (key, value, expires_at)
            VALUES (?, ?, ?)
        `, [key, JSON.stringify(value), expiresAt]);
    }

    async getCache(key) {
        const row = await this.get(`
            SELECT value FROM cache 
            WHERE key = ? AND expires_at > ?
        `, [key, Date.now()]);

        return row ? this.parseJSON(row.value) : null;
    }

    async deleteCache(key) {
        await this.run('DELETE FROM cache WHERE key = ?', [key]);
    }

    async clearExpiredCache() {
        const deleted = await this.run('DELETE FROM cache WHERE expires_at <= ?', [Date.now()]);
        if (deleted.changes > 0) {
            logger.info('Cleared expired cache entries', { count: deleted.changes });
        }
    }

    // Database maintenance
    async vacuum() {
        await this.run('VACUUM');
        logger.info('Database vacuumed');
    }

    async analyze() {
        await this.run('ANALYZE');
        logger.info('Database statistics updated');
    }

    // Utility methods
    parseJSON(jsonString) {
        if (!jsonString) return null;
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            logger.warn('Failed to parse JSON', { jsonString });
            return null;
        }
    }

    // Promise wrappers for sqlite3 methods
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(error) {
                if (error) {
                    logger.error('Database run error', { sql, params, error: error.message });
                    reject(error);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (error, row) => {
                if (error) {
                    logger.error('Database get error', { sql, params, error: error.message });
                    reject(error);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (error, rows) => {
                if (error) {
                    logger.error('Database all error', { sql, params, error: error.message });
                    reject(error);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((error) => {
                    if (error) {
                        logger.error('Error closing database', { error: error.message });
                    } else {
                        logger.info('Database connection closed');
                    }
                    resolve();
                });
            });
        }
    }
}

// Export singleton instance
module.exports = new Database();