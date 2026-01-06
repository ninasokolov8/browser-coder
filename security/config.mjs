/**
 * Security Module Configuration
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CONFIG = {
  serverUrl: process.env.API_URL || process.argv.find(a => a.startsWith('--server='))?.split('=')[1] || 'http://api:3001',
  timeout: 15000,
  reportDir: path.join(__dirname, 'reports'),
};

// ANSI colors for terminal output
export const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

export function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}
