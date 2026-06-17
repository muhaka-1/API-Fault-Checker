// src/alerts.js — Alert dispatcher (Slack, PagerDuty, Email)

const axios   = require('axios');
const logger  = require('./logger');

// ─── Cooldown tracker ─────────────────────────────────────────────────────────
const lastAlertFired = {};

function isCoolingDown(key, cooldownMs) {
  const last = lastAlertFired[key] || 0;
  return (Date.now() - last) < cooldownMs;
}

function markAlerted(key) {
  lastAlertFired[key] = Date.now();
}

// ─── Slack ────────────────────────────────────────────────────────────────────
async function sendSlack(result, severity, config) {
  if (!config.SLACK_WEBHOOK_URL || config.SLACK_WEBHOOK_URL.includes('YOUR/WEBHOOK')) {
    logger.warn('Slack: no webhook configured, skipping.');
    return false;
  }

  const mention = (severity === 'P0' && config.SLACK_MENTION_ON_P0)
    ? `${config.SLACK_MENTION_ON_P0} ` : '';

  const color = severity === 'P0' ? '#E24B4A'
              : severity === 'P1' ? '#EF9F27'
              : '#BA7517';

  const statusText = result.error
    ? `Error: ${result.error}`
    : `HTTP ${result.status}`;

  const payload = {
    channel: config.SLACK_CHANNEL || '#incidents',
    text:    `${mention}*${severity} ALERT* — ${result.provider} ${result.name} is degraded`,
    attachments: [{
      color,
      fields: [
        { title: 'Provider',  value: result.provider,          short: true },
        { title: 'Service',   value: result.name,              short: true },
        { title: 'Status',    value: statusText,               short: true },
        { title: 'Latency',   value: `${result.latency}ms`,   short: true },
        { title: 'Endpoint',  value: result.url,               short: false },
        { title: 'Severity',  value: severity,                 short: true },
        { title: 'Time',      value: result.timestamp,         short: true },
      ],
      footer: 'API Fault Checker',
      ts:     Math.floor(Date.now() / 1000),
    }],
  };

  try {
    await axios.post(config.SLACK_WEBHOOK_URL, payload);
    logger.info(`Slack alert sent: ${result.provider} ${result.name} [${severity}]`);
    return true;
  } catch (err) {
    logger.error(`Slack alert failed: ${err.message}`);
    return false;
  }
}

// ─── PagerDuty ────────────────────────────────────────────────────────────────
async function sendPagerDuty(result, severity, config, action = 'trigger') {
  if (!config.PAGERDUTY_INTEGRATION_KEY || config.PAGERDUTY_INTEGRATION_KEY.includes('your_')) {
    logger.warn('PagerDuty: no integration key configured, skipping.');
    return false;
  }

  if (!['P0', 'P1'].includes(severity) && action === 'trigger') {
    logger.info(`PagerDuty: skipping ${severity} — only P0/P1 create incidents.`);
    return false;
  }

  const pdSeverity = severity === 'P0' ? 'critical' : 'warning';

  const payload = {
    routing_key:  config.PAGERDUTY_INTEGRATION_KEY,
    event_action: action,
    dedup_key:    `api-fault-${result.id}`,
    payload: {
      summary:  `${result.provider} ${result.name} fault — ${result.status || result.error} @ ${result.latency}ms`,
      severity: pdSeverity,
      source:   'api-fault-checker',
      component: result.name,
      group:     result.provider,
      class:     'API availability',
      custom_details: {
        url:      result.url,
        status:   result.status,
        latency:  `${result.latency}ms`,
        error:    result.error || null,
        severity,
      },
    },
  };

  try {
    await axios.post('https://events.pagerduty.com/v2/enqueue', payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    logger.info(`PagerDuty event [${action}] sent: ${result.provider} ${result.name}`);
    return true;
  } catch (err) {
    logger.error(`PagerDuty failed: ${err.message}`);
    return false;
  }
}

// ─── Recovery alert ───────────────────────────────────────────────────────────
async function sendRecovery(result, config) {
  logger.info(`Recovery: ${result.provider} ${result.name} is back up.`);

  const promises = [];

  if (config.SLACK_WEBHOOK_URL && !config.SLACK_WEBHOOK_URL.includes('YOUR/WEBHOOK')) {
    promises.push(axios.post(config.SLACK_WEBHOOK_URL, {
      text: `:white_check_mark: *RESOLVED* — ${result.provider} ${result.name} is back up (${result.latency}ms)`,
    }).catch(e => logger.error(`Slack recovery failed: ${e.message}`)));
  }

  // PagerDuty auto-resolve
  promises.push(sendPagerDuty(result, 'P1', config, 'resolve'));

  await Promise.allSettled(promises);
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────
async function dispatchAlerts(results, severityFn, config, previousResults = {}) {
  const cooldownMs = (config.ALERT_COOLDOWN_MINUTES || 10) * 60 * 1000;
  const dispatched = [];

  for (const result of results) {
    const severity = severityFn(result, config);
    const key      = result.id;
    const prevOk   = previousResults[key]?.ok;

    if (severity !== 'ok') {
      if (isCoolingDown(key, cooldownMs)) {
        logger.debug(`${result.provider} ${result.name}: alert on cooldown, skipping.`);
        continue;
      }

      markAlerted(key);
      const sent = { id: key, severity, time: new Date().toISOString(), channels: [] };

      if (config.SLACK_WEBHOOK_URL)          { await sendSlack(result, severity, config);     sent.channels.push('Slack');      }
      if (config.PAGERDUTY_INTEGRATION_KEY)  { await sendPagerDuty(result, severity, config); sent.channels.push('PagerDuty'); }

      dispatched.push(sent);

    } else if (prevOk === false && config.AUTO_RESOLVE !== 'false') {
      // Service just recovered
      await sendRecovery(result, config);
    }
  }

  return dispatched;
}

module.exports = { dispatchAlerts, sendSlack, sendPagerDuty, sendRecovery };
