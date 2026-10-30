const { Transform } = require('stream');

// One reservation clock for all background streams, so the limit is aggregate.
class SharedUploadLimiter {
  constructor() { this.bytesPerSecond = 0; this.nextAt = 0; this.samples = new Map(); }
  setBytesPerSecond(value) {
    if (value !== this.bytesPerSecond) { this.bytesPerSecond = value; this.nextAt = 0; }
  }
  reserve(bytes, now = Date.now()) {
    if (!this.bytesPerSecond) return 0;
    this.nextAt = Math.max(this.nextAt, now) + (bytes * 1000 / this.bytesPerSecond);
    return Math.max(0, Math.ceil(this.nextAt - now));
  }
  record(eventId, bytes, now = Date.now()) {
    if (!eventId) return;
    const second = Math.floor(now / 1000);
    if (this.lastSweep !== second) {
      this.lastSweep = second;
      for (const [id, entries] of this.samples) {
        const recent = entries.filter((entry) => second - entry.second < 10);
        if (recent.length) this.samples.set(id, recent); else this.samples.delete(id);
      }
    }
    const entries = this.samples.get(eventId) || [];
    const current = entries[entries.length - 1];
    if (current?.second === second) current.bytes += bytes;
    else entries.push({ second, bytes });
    this.samples.set(eventId, entries);
  }
  recentBytesPerSecond(eventId, now = Date.now()) {
    const second = Math.floor(now / 1000);
    return Math.round((this.samples.get(eventId) || []).filter((entry) => second - entry.second < 10).reduce((sum, entry) => sum + entry.bytes, 0) / 10);
  }
  wrap(source, eventId) {
    const limiter = this;
    let timer;
    const output = new Transform({
      transform(chunk, _encoding, callback) {
        const delay = limiter.reserve(chunk.length);
        if (!delay) { limiter.record(eventId, chunk.length); return callback(null, chunk); }
        timer = setTimeout(() => { timer = null; limiter.record(eventId, chunk.length); callback(null, chunk); }, delay);
      },
      destroy(error, callback) {
        if (timer) clearTimeout(timer);
        source.destroy();
        callback(error);
      },
    });
    source.on('error', (error) => output.destroy(error));
    return source.pipe(output);
  }
}
module.exports = { SharedUploadLimiter };
