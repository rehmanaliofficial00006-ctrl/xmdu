const queues = new Map();           // userId -> { running: bool, tasks: [] }
const DEFAULT_TIMEOUT = 60_000;     // 60 detik per task

function enqueue(userId, taskFn, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
  if (!queues.has(userId)) queues.set(userId, { running: false, tasks: [] });
  const q = queues.get(userId);

  return new Promise((resolve, reject) => {
    q.tasks.push({ taskFn, resolve, reject, timeoutMs });
    if (!q.running) drain(userId);
  });
}

async function drain(userId) {
  const q = queues.get(userId);
  if (!q || q.running) return;
  q.running = true;

  while (q.tasks.length) {
    const { taskFn, resolve, reject, timeoutMs } = q.tasks.shift();
    try {
      const result = await Promise.race([
        Promise.resolve().then(taskFn),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('Task timeout')), timeoutMs)
        ),
      ]);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  q.running = false;
  // GC empty queue
  if (!q.tasks.length) queues.delete(userId);
}

function stats() {
  return {
    activeUsers: queues.size,
    totalQueued: [...queues.values()].reduce((a, q) => a + q.tasks.length, 0),
  };
}

module.exports = { enqueue, stats };
