#!/usr/bin/env node
// scripts/test-alerts.js — Send test alerts to Slack and PagerDuty

require('dotenv').config();
const { sendSlack, sendPagerDuty } = require('../src/alerts');

const config = {
  SLACK_WEBHOOK_URL:         process.env.SLACK_WEBHOOK_URL,
  SLACK_CHANNEL:             process.env.SLACK_CHANNEL || '#incidents',
  SLACK_MENTION_ON_P0:       process.env.SLACK_MENTION_ON_P0 || '@oncall',
  PAGERDUTY_INTEGRATION_KEY: process.env.PAGERDUTY_INTEGRATION_KEY,
};

const testResult = {
  id:        'test-service',
  provider:  'Test',
  name:      'Test Service',
  url:       'https://example.com/api',
  status:    503,
  latency:   1450,
  ok:        false,
  error:     null,
  timestamp: new Date().toISOString(),
};

(async () => {
  console.log('\n🧪 Sending test alerts…\n');

  console.log('→ Slack…');
  const slackOk = await sendSlack(testResult, 'P0', config);
  console.log(slackOk ? '  ✓ Slack sent' : '  ✗ Slack skipped (check .env)');

  console.log('→ PagerDuty…');
  const pdOk = await sendPagerDuty(testResult, 'P0', config);
  console.log(pdOk ? '  ✓ PagerDuty sent' : '  ✗ PagerDuty skipped (check .env)');

  console.log('\nDone.\n');
})();
