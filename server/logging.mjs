/**
 * Structured logging.
 *
 * Moved out of server.mjs unchanged in shape: human-readable coloured lines in
 * development, one JSON object per line in production.
 *
 * The redaction helper is new. The blueprint requires that source, stdin, stdout
 * and tokens are not logged by default (section 17.8), and the pre-refactor code
 * came close to breaking that in two places - `security_block` logged the
 * matched source fragment, and the C# warm-up logged 500 characters of build
 * stderr. Those are useful for diagnosis but must be explicitly opted into
 * rather than accidentally included, so `redact()` exists to make the intent
 * visible at the call site.
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

/**
 * Bound and mark a value that came from user code or user input.
 *
 * Returns a short, length-capped excerpt plus the original length, so a log line
 * stays diagnosable without becoming a copy of the student's program - or a place
 * where a secret pasted into an editor ends up persisted.
 *
 * @param {unknown} value
 * @param {number} [maxChars]
 */
export function redact(value, maxChars = 120) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.length <= maxChars) return { excerpt: text, length: text.length };
  return { excerpt: `${text.slice(0, maxChars)}…`, length: text.length, truncated: true };
}

export default log;
