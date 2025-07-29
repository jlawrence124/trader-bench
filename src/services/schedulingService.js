const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const { parse } = require('shell-quote');
const logger = require('../../lib/logger');
const benchmarkService = require('./benchmarkService');

class SchedulingService {
    constructor() {
        this.activeJobs = new Set();
        this.activeAgents = new Map();
        this.isShuttingDown = false;
        this.config = {
            tradingWindowMinutes: 2,
            startupDelaySeconds: parseInt(process.env.AGENT_STARTUP_DELAY || '0', 10),
            tradingTimes: [
                '30 8 * * 1-5',  // 8:30 AM on weekdays (pre-market)
                '30 9 * * 1-5',  // 9:30 AM on weekdays (open)
                '0 12 * * 1-5',  // 12:00 PM on weekdays (midday)
                '55 15 * * 1-5'  // 3:55 PM on weekdays (five minutes before close)
            ]
        };
    }

    initialize() {
        logger.info('Initializing scheduling service');
        
        this.config.tradingTimes.forEach(time => {
            const job = cron.schedule(time, () => this.startTradingWindow(), {
                timezone: "America/New_York",
                scheduled: true
            });
            this.activeJobs.add(job);
        });

        this.setupSignalHandlers();
        logger.info('Scheduling service initialized');
    }

    startTradingWindow() {
        if (this.isShuttingDown) {
            logger.warn('Scheduler is shutting down, skipping trading window');
            return;
        }

        logger.info(`Trading window now OPEN for ${this.config.tradingWindowMinutes} minutes`);

        const startTime = new Date();
        const modelName = process.env.MODEL_NAME || 'default_agent';
        const runId = `${modelName}_${startTime.toISOString()}`;

        this.spawnAgent(runId, startTime);
    }

    spawnAgent(runId, startTime) {
        const agentCmd = process.env.AGENT_CMD || `node ${path.join(__dirname, '../../trading_agent', 'agent.js')}`;
        const parts = parse(agentCmd);
        const cmd = parts[0];
        const args = parts.slice(1);
        const mcpUrl = process.env.MCP_SERVER_URL || `http://localhost:${process.env.MCP_PORT || 4000}/rpc`;
        
        try {
            const agent = spawn(cmd, args, {
                stdio: 'inherit',
                env: { ...process.env, MCP_SERVER_URL: mcpUrl, RUN_ID: runId },
                detached: false
            });

            // Track active agent
            this.activeAgents.set(runId, {
                agent,
                startTime,
                timeout: null,
                countdownInterval: null
            });

            this.setupAgentHandlers(runId);
            this.startCountdown(runId);

        } catch (error) {
            logger.error('Failed to spawn agent', { runId, error: error.message });
        }
    }

    setupAgentHandlers(runId) {
        const agentInfo = this.activeAgents.get(runId);
        if (!agentInfo) return;

        const { agent } = agentInfo;

        // Set hard timeout for agent cleanup
        const hardTimeout = setTimeout(() => {
            logger.warn(`Agent ${runId} exceeded maximum runtime, forcing kill`);
            this.cleanupAgent(runId, true);
        }, (this.config.tradingWindowMinutes + 2) * 60 * 1000);

        agentInfo.timeout = hardTimeout;

        agent.on('error', (error) => {
            logger.error(`Agent ${runId} error`, { error: error.message });
            this.cleanupAgent(runId);
        });

        agent.on('close', async (code, signal) => {
            logger.info(`Agent ${runId} closed`, { code, signal });
            
            const info = this.activeAgents.get(runId);
            if (!info) return;
            
            const endTime = new Date();
            
            try {
                // Only record results if not killed due to timeout
                if (!signal || signal !== 'SIGKILL') {
                    await benchmarkService.recordRunResults({
                        modelName: process.env.MODEL_NAME || 'default_agent',
                        runId,
                        startTime: info.startTime,
                        endTime
                    });
                }
            } catch (err) {
                logger.error('Failed to record run results', { runId, error: err.message });
            } finally {
                this.cleanupAgent(runId);
            }
        });
    }

    startCountdown(runId) {
        const agentInfo = this.activeAgents.get(runId);
        if (!agentInfo) return;

        const startCountdownFn = () => {
            let countdown = this.config.tradingWindowMinutes * 60;
            const countdownInterval = setInterval(() => {
                if (this.isShuttingDown) {
                    clearInterval(countdownInterval);
                    return;
                }
                
                countdown--;
                process.stdout.write(`Time remaining: ${Math.floor(countdown / 60)}m ${countdown % 60}s   \r`);

                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                    logger.info('Trading window CLOSED');
                    this.cleanupAgent(runId);
                }
            }, 1000);
            
            agentInfo.countdownInterval = countdownInterval;
        };

        if (this.config.startupDelaySeconds > 0) {
            logger.info(`Waiting ${this.config.startupDelaySeconds} seconds for agent startup`);
            const delayTimeout = setTimeout(startCountdownFn, this.config.startupDelaySeconds * 1000);
            agentInfo.delayTimeout = delayTimeout;
        } else {
            startCountdownFn();
        }
    }

    cleanupAgent(runId, force = false) {
        const agentInfo = this.activeAgents.get(runId);
        if (!agentInfo) return;
        
        const { agent, timeout, countdownInterval, delayTimeout } = agentInfo;
        
        // Clear all timers
        if (timeout) clearTimeout(timeout);
        if (countdownInterval) clearInterval(countdownInterval);
        if (delayTimeout) clearTimeout(delayTimeout);
        
        // Kill agent if still running
        if (agent && !agent.killed) {
            try {
                if (force) {
                    agent.kill('SIGKILL');
                } else {
                    agent.kill('SIGTERM');
                    // If SIGTERM doesn't work, use SIGKILL after 5 seconds
                    setTimeout(() => {
                        if (!agent.killed) {
                            agent.kill('SIGKILL');
                        }
                    }, 5000);
                }
            } catch (error) {
                logger.error(`Error killing agent ${runId}`, { error: error.message });
            }
        }
        
        // Remove from tracking
        this.activeAgents.delete(runId);
        logger.info(`Cleaned up agent ${runId}`);
    }

    async cleanup() {
        logger.info('Cleaning up scheduling service resources');
        this.isShuttingDown = true;
        
        // Stop all scheduled jobs
        this.activeJobs.forEach(job => {
            try {
                job.stop();
            } catch (error) {
                logger.error('Error stopping job', { error: error.message });
            }
        });
        this.activeJobs.clear();
        
        // Clean up all active agents
        const agentPromises = Array.from(this.activeAgents.keys()).map(runId => {
            return new Promise((resolve) => {
                const agentInfo = this.activeAgents.get(runId);
                if (agentInfo?.agent) {
                    agentInfo.agent.on('close', resolve);
                    this.cleanupAgent(runId, true);
                } else {
                    resolve();
                }
            });
        });
        
        await Promise.all(agentPromises);
        logger.info('Scheduling service cleanup complete');
    }

    setupSignalHandlers() {
        const gracefulShutdown = async (signal) => {
            logger.info(`Received ${signal}, shutting down gracefully`);
            await this.cleanup();
            process.exit(0);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        process.on('uncaughtException', async (error) => {
            logger.error('Uncaught exception', { error: error.message, stack: error.stack });
            await this.cleanup();
            process.exit(1);
        });

        process.on('unhandledRejection', async (reason, promise) => {
            logger.error('Unhandled rejection', { reason, promise });
            await this.cleanup();
            process.exit(1);
        });
    }

    getStatus() {
        return {
            isShuttingDown: this.isShuttingDown,
            activeAgents: this.activeAgents.size,
            activeJobs: this.activeJobs.size,
            uptime: process.uptime(),
            memory: process.memoryUsage()
        };
    }
}

module.exports = new SchedulingService();