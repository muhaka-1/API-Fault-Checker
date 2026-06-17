// src/checker.js — Core endpoint polling engine

const axios = require('axios');
const logger = require('./logger');

/**
 * Check a single endpoint and return a result object.
 */
async function checkEndpoint(ep, config) {
  const start = Date.now();
  const timeout = config.TIMEOUT_MS || 10000;

  try {
    const response = await axios({
      method:          ep.method || 'HEAD',
      url:             ep.url,
      timeout,
      headers:         ep.headers || {},
      validateStatus:  () => true, // never throw on HTTP error codes
      maxRedirects:    3,
    });

    const latency = Date.now() - start;
    const expectedStatuses = ep.expectedStatus || [200];
    const isUp = expectedStatuses.includes(response.status);

    return {
      ...ep,
      timestamp:  new Date().toISOString(),
      status:     response.status,
      latency,
      ok:         isUp,
      error:      null,
    };

  } catch (err) {
    const latency = Date.now() - start;
    const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');

    return {
      ...ep,
      timestamp: new Date().toISOString(),
      status:    0,
      latency,
      ok:        false,
      error:     isTimeout ? 'TIMEOUT' : (err.message || 'UNKNOWN_ERROR'),
    };
  }
}

/**
 * Run all endpoint checks in parallel and return results.
 */
async function runAllChecks(endpoints, config) {
  logger.info(`Starting poll of ${endpoints.length} endpoints…`);

  const results = await Promise.allSettled(
    endpoints.map(ep => checkEndpoint(ep, config))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // Promise itself rejected (shouldn't happen with our try/catch, but safety net)
    return {
      ...endpoints[i],
      timestamp: new Date().toISOString(),
      status:    0,
      latency:   0,
      ok:        false,
      error:     r.reason?.message || 'INTERNAL_ERROR',
    };
  });
}

/**
 * Determine severity of a result based on thresholds.
 * Returns: 'ok' | 'P2' | 'P1' | 'P0'
 */
function getSeverity(result, config) {
  const { LATENCY_WARN_MS, LATENCY_CRIT_MS } = config;

  if (!result.ok || result.status === 0 || result.status >= 500) return 'P0';
  if (result.error === 'TIMEOUT')                                  return 'P0';
  if (result.latency > LATENCY_CRIT_MS)                           return 'P1';
  if (result.latency > LATENCY_WARN_MS)                           return 'P2';
  return 'ok';
}

module.exports = { checkEndpoint, runAllChecks, getSeverity };
