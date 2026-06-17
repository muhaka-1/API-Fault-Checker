// src/logger.js — Structured logger with file + console output

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs   = require('fs');

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    // Console — colorized human-readable
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      ),
    }),
    // File — structured JSON (rotated daily by filename)
    new transports.File({
      filename: path.join(logsDir, `fault-checker-${new Date().toISOString().slice(0,10)}.log`),
      maxsize:  10 * 1024 * 1024, // 10 MB
      maxFiles: 7,
    }),
    // Errors only
    new transports.File({
      filename: path.join(logsDir, 'errors.log'),
      level:    'error',
    }),
  ],
});

module.exports = logger;
