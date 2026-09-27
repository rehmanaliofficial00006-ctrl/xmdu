const logger = require('./logger');

let socketRef = null;
let memCheckTimer = null;
let cpuCheckTimer = null;

let opts = {
  memThresholdMB: 10 * 1024,   // RAM: restart kalau RSS > 10GB
  cpuThresholdPercent: 90,     // CPU: restart kalau pemakaian > 90%
  memCheckIntervalMs: 30_000,  // cek RAM tiap 30 detik
  cpuCheckIntervalMs: 10_000,  // sampling CPU tiap 10 detik
  cpuSustainedChecks: 3,       // CPU harus tinggi 3x berturut2 (≈30 detik) baru restart
};

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = process.hrtime.bigint();
let cpuOverCount = 0;

function setSocket(sock) { socketRef = sock; }

function install(customOpts = {}) {
  opts = { ...opts, ...customOpts };

  process.on('uncaughtException', (err) => {
    logger.error('🛑 uncaughtException:', err);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('🛑 unhandledRejection:', reason);
  });

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  memCheckTimer = setInterval(memoryCheck, opts.memCheckIntervalMs);
  memCheckTimer.unref();

  cpuCheckTimer = setInterval(cpuCheck, opts.cpuCheckIntervalMs);
  cpuCheckTimer.unref();

  logger.ok(`[process-guard] installed (RAM > ${(opts.memThresholdMB / 1024).toFixed(1)}GB, CPU > ${opts.cpuThresholdPercent}%)`);
}

// ── RAM watcher ─────────────────────────────────────────────
function memoryCheck() {
  const rssMB = process.memoryUsage().rss / 1024 / 1024;
  if (rssMB > opts.memThresholdMB) {
    logger.warn(`[memwatch] RSS ${(rssMB / 1024).toFixed(2)}GB > ${(opts.memThresholdMB / 1024).toFixed(2)}GB`);
    if (global.gc) {
      try { global.gc(); logger.info('[memwatch] manual GC done'); } catch {}
    }
    // Kasih kesempatan GC bekerja dulu, baru restart kalau masih tinggi
    setTimeout(() => {
      const after = process.memoryUsage().rss / 1024 / 1024;
      if (after > opts.memThresholdMB * 1.05) {
        logger.error(`[memwatch] restart triggered (RSS=${(after / 1024).toFixed(2)}GB)`);
        shutdown('MEMORY_HIGH');
      }
    }, 2000);
  }
}

// ── CPU watcher ─────────────────────────────────────────────
function cpuCheck() {
  const currentUsage = process.cpuUsage();
  const currentTime = process.hrtime.bigint();

  const userDiffMicros = currentUsage.user - lastCpuUsage.user;
  const sysDiffMicros = currentUsage.system - lastCpuUsage.system;
  const cpuMicros = userDiffMicros + sysDiffMicros;

  const elapsedMicros = Number(currentTime - lastCpuTime) / 1000;
  const cpuPercent = elapsedMicros > 0 ? (cpuMicros / elapsedMicros) * 100 : 0;

  lastCpuUsage = currentUsage;
  lastCpuTime = currentTime;

  if (cpuPercent > opts.cpuThresholdPercent) {
    cpuOverCount++;
    logger.warn(`[cpuwatch] CPU ${cpuPercent.toFixed(1)}% > ${opts.cpuThresholdPercent}% (${cpuOverCount}/${opts.cpuSustainedChecks})`);
    if (cpuOverCount >= opts.cpuSustainedChecks) {
      logger.error(`[cpuwatch] restart triggered (CPU tinggi terus-menerus)`);
      shutdown('CPU_HIGH');
    }
  } else {
    cpuOverCount = 0; // reset kalau sudah normal lagi
  }
}

let shuttingDown = false;
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn(`[process-guard] shutting down (${reason})`);
  try {
    const { flushAll } = require('./cache-store');
    await flushAll();
  } catch {/* ignore */}
  try {
    if (socketRef?.end) socketRef.end();
  } catch {/* ignore */}
  setTimeout(() => process.exit(reason === 'SIGINT' ? 0 : 1), 800);
}

module.exports = { install, setSocket };
