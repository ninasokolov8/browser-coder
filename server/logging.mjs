/**
 * Structured logging.
 *
 * Moved out of server.mjs unchanged in shape: human-readable coloured lines in
 * development, one JSON object per line in production.
 *
 * Source, stdin, stdout and tokens are deliberately absent from log metadata.
 * Keep that allowlist discipline at every call site rather than retaining a
 * redaction helper that callers could forget to use.
 */

import { CONFIG } from './config.mjs';

const LEVEL_COLOURS = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
};

export function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    pid: process.pid,
    ...meta,
  };

  if (CONFIG.isDev) {
    const colour = LEVEL_COLOURS[level] || '';
    // eslint-disable-next-line no-console
    console.log(
      `${colour}[${level.toUpperCase()}]\x1b[0m ${message}`,
      Object.keys(meta).length ? meta : '',
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
}
