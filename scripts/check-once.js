#!/usr/bin/env node
// scripts/check-once.js — Run a single check and print results, no alerts fired

require('dotenv').config();
const { runAllChecks, getSeverity } = require('../src/checker');
const endpoints = require('../config/endpoints');

const config = {
  LATENCY_WARN_MS: parseInt(process.env.LATENCY_WARN_MS) || 300,
  LATENCY_CRIT_MS: parseInt(process.env.LATENCY_CRIT_MS) || 1000,
  TIMEOUT_MS:      parseInt(process.env.TIMEOUT_MS)      || 10000,
};

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

(async () => {
  console.log(`\n${BOLD}${CYAN}API Fault Checker — Single Run${RESET}`);
  console.log(`${DIM}Checking ${endpoints.length} endpoints…${RESET}\n`);

  const results = await runAllChecks(endpoints, config);

  let ok = 0, warn = 0, crit = 0;

  console.log(`${'Provider'.padEnd(10)} ${'Service'.padEnd(18)} ${'Status'.padEnd(7)} ${'Latency'.padEnd(10)} Severity`);
  console.log('─'.repeat(65));

  results.forEach(r => {
    const sev = getSeverity(r, config);
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const latColor = sev === 'P0' || sev === 'P1' ? RED : sev === 'P2' ? YELLOW : GREEN;
    const sevColor = sev === 'P0' ? RED : sev === 'P1' ? RED : sev === 'P2' ? YELLOW : GREEN;

    console.log(
      `${icon} ${r.provider.padEnd(10)} ${r.name.padEnd(18)} ` +
      `${String(r.status || r.error || 'ERR').padEnd(7)} ` +
      `${latColor}${String(r.latency + 'ms').padEnd(10)}${RESET} ` +
      `${sevColor}${sev}${RESET}`
    );

    if (sev === 'ok') ok++;
    else if (sev === 'P2') warn++;
    else crit++;
  });

  console.log('─'.repeat(65));
  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  ${GREEN}OK:${RESET}       ${ok}`);
  console.log(`  ${YELLOW}Degraded:${RESET} ${warn}`);
  console.log(`  ${RED}Critical:${RESET} ${crit}`);
  console.log();

  if (crit > 0) process.exit(1); // non-zero exit for CI/CD integration
})();
