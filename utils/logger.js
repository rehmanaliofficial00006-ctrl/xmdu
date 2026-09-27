const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const COLORS = {
  info:  '\x1b[36m', // cyan
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  debug: '\x1b[90m', // gray
  ok:    '\x1b[32m', // green
};
const RESET = '\x1b[0m';

function fileFor(date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${d}.log`);
}

// Single shared write-stream (rotated lazily)
let currentDate = '';
let stream = null;
function getStream() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== currentDate) {
    if (stream) stream.end();
    stream = fs.createWriteStream(fileFor(), { flags: 'a' });
    currentDate = d;
  }
  return stream;
}

function fmt(level, args) {
  const ts = new Date().toISOString();
  const parts = args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  });
  return { ts, level, msg: parts.join(' ') };
}

function write(level, ...args) {
  const { ts, msg } = fmt(level, args);
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  const color = COLORS[level] || '';
  // eslint-disable-next-line no-console
  console.log(color + line + RESET);
  try { getStream().write(line + '\n'); } catch {/* ignore */}
}

module.exports = {
  info:  (...a) => write('info',  ...a),
  warn:  (...a) => write('warn',  ...a),
  error: (...a) => write('error', ...a),
  debug: (...a) => write('debug', ...a),
  ok:    (...a) => write('ok',    ...a),
};
