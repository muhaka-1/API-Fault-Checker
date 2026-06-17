// src/index.js — Main entry point

require('dotenv').config();
const cron      = require('node-cron');
const logger    = require('./logger');
const { runAllChecks, getSeverity } = require('./checker');
const { dispatchAlerts }            = require('./alerts');
const endpoints = require('../config/endpoints');

// ─── Config from .env ─────────────────────────────────────────────────────────
const config = {
  SLACK_WEBHOOK_URL:         process.env.SLACK_WEBHOOK_URL,
  SLACK_CHANNEL:             process.env.SLACK_CHANNEL             || '#incidents',
  SLACK_MENTION_ON_P0:       process.env.SLACK_MENTION_ON_P0       || '@oncall',
  PAGERDUTY_INTEGRATION_KEY: process.env.PAGERDUTY_INTEGRATION_KEY,
  LATENCY_WARN_MS:    parseInt(process.env.LATENCY_WARN_MS)          || 300,
  LATENCY_CRIT_MS:    parseInt(process.env.LATENCY_CRIT_MS)          || 1000,
  ALERT_COOLDOWN_MINUTES: parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 10,
  TIMEOUT_MS:         parseInt(process.env.TIMEOUT_MS)              || 10000,
  POLL_CRON:                 process.env.POLL_CRON                  || '*/1 * * * *',
  DASHBOARD_PORT:     parseInt(process.env.DASHBOARD_PORT)          || 3000,
  DASHBOARD_ENABLED:         process.env.DASHBOARD_ENABLED          !== 'false',
};

// ─── State ────────────────────────────────────────────────────────────────────
let previousResults = {};
let latestResults   = [];
let pollCount       = 0;

// ─── Poll function ────────────────────────────────────────────────────────────
async function poll() {
  pollCount++;
  logger.info(`─── Poll #${pollCount} starting ───`);

  try {
    const results = await runAllChecks(endpoints, config);
    latestResults  = results;

    const summary = { ok: 0, P0: 0, P1: 0, P2: 0 };

    results.forEach(r => {
      const sev = getSeverity(r, config);
      summary[sev] = (summary[sev] || 0) + 1;

      const icon = r.ok ? '✓' : '✗';
      const line = `${icon} [${r.provider}] ${r.name.padEnd(16)} ${String(r.status || 'ERR').padEnd(5)} ${r.latency}ms`;
      if (!r.ok) {
        logger.warn(line + ` [${sev}]`);
      } else {
        logger.info(line);
      }
    });

    logger.info(`Summary: ${summary.ok} OK | ${summary.P2} P2 | ${summary.P1} P1 | ${summary.P0} P0`);

    // Dispatch alerts
    const alerts = await dispatchAlerts(results, getSeverity, config, previousResults);
    if (alerts.length) logger.warn(`${alerts.length} alert(s) fired this poll.`);

    // Update previous state
    results.forEach(r => { previousResults[r.id] = r; });

    // Broadcast to dashboard if running
    if (global.io) global.io.emit('results', { results, pollCount, timestamp: new Date().toISOString() });

  } catch (err) {
    logger.error(`Poll #${pollCount} crashed: ${err.message}`, { stack: err.stack });
  }
}

// ─── Dashboard server ─────────────────────────────────────────────────────────
function startDashboard() {
  if (!config.DASHBOARD_ENABLED) return;

  const express  = require('express');
  const { Server } = require('socket.io');
  const http     = require('http');
  const path     = require('path');

  const app    = express();
  const server = http.createServer(app);
  global.io    = new Server(server);

  app.use(express.static(path.join(__dirname, '../dashboard/public')));

  app.get('/api/status', (_req, res) => {
    res.json({ results: latestResults, pollCount, config: {
      latWarn: config.LATENCY_WARN_MS,
      latCrit: config.LATENCY_CRIT_MS,
      pollCron: config.POLL_CRON,
    }});
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  global.io.on('connection', socket => {
    logger.info('Dashboard client connected');
    // Send latest data immediately on connect
    socket.emit('results', { results: latestResults, pollCount, timestamp: new Date().toISOString() });
    socket.on('disconnect', () => logger.info('Dashboard client disconnected'));
  });

  server.listen(config.DASHBOARD_PORT, () => {
    logger.info(`Dashboard running at http://localhost:${config.DASHBOARD_PORT}`);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
logger.info('═══════════════════════════════════════════');
logger.info('  API Fault Checker starting up…');
logger.info(`  Monitoring ${endpoints.length} endpoints`);
logger.info(`  Poll schedule: ${config.POLL_CRON}`);
logger.info(`  Latency thresholds: warn=${config.LATENCY_WARN_MS}ms crit=${config.LATENCY_CRIT_MS}ms`);
logger.info('═══════════════════════════════════════════');

startDashboard();

// Run immediately on startup
poll();

// Schedule recurring polls
cron.schedule(config.POLL_CRON, poll, { timezone: 'UTC' });

// Graceful shutdown
process.on('SIGTERM', () => { logger.info('SIGTERM received, shutting down.'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('SIGINT received, shutting down.');  process.exit(0); });

module.exports = { getLatestResults: () => latestResults };
