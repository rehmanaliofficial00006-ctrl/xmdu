const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const stores = new Map();

class JsonStore {
  constructor(filePath, defaultValue = {}) {
    this.file = path.resolve(filePath);
    this.default = defaultValue;
    this.data = this._loadSyncInit();
    this._dirty = false;
    this._writeTimer = null;
    this._watch();
  }

  _loadSyncInit() {
    try {
      if (!fs.existsSync(this.file)) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.default, null, 2));
        return JSON.parse(JSON.stringify(this.default));
      }
      const raw = fs.readFileSync(this.file, 'utf8');
      return raw.trim() ? JSON.parse(raw) : JSON.parse(JSON.stringify(this.default));
    } catch (e) {
      console.error(`[JsonStore] init failed ${this.file}:`, e.message);
      return JSON.parse(JSON.stringify(this.default));
    }
  }

  _watch() {
    try {
      fs.watch(this.file, { persistent: false }, () => {
        // ada perubahan dari luar — reload async
        fsp.readFile(this.file, 'utf8')
          .then(raw => { if (raw.trim()) this.data = JSON.parse(raw); })
          .catch(() => {});
      });
    } catch {/* file mungkin belum ada, abaikan */}
  }

  get() { return this.data; }

  set(newData) {
    this.data = newData;
    this._scheduleWrite();
  }

  update(key, value) {
    this.data[key] = value;
    this._scheduleWrite();
  }

  delete(key) {
    delete this.data[key];
    this._scheduleWrite();
  }

  _scheduleWrite() {
    this._dirty = true;
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => this._flush(), 300);
  }

  async _flush() {
    this._writeTimer = null;
    if (!this._dirty) return;
    this._dirty = false;
    const tmp = this.file + '.tmp';
    try {
      await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2));
      await fsp.rename(tmp, this.file); // atomic
    } catch (e) {
      console.error(`[JsonStore] flush failed ${this.file}:`, e.message);
      this._dirty = true; // retry next round
    }
  }

  // Force flush (panggil saat graceful shutdown)
  async flushNow() {
    if (this._writeTimer) clearTimeout(this._writeTimer);
    this._writeTimer = null;
    if (this._dirty) await this._flush();
  }
}

function getStore(filePath, defaultValue) {
  const key = path.resolve(filePath);
  if (!stores.has(key)) stores.set(key, new JsonStore(filePath, defaultValue));
  return stores.get(key);
}

// Convenience: flush semua saat exit
async function flushAll() {
  for (const s of stores.values()) await s.flushNow();
}
process.on('beforeExit', flushAll);

module.exports = { getStore, flushAll };
