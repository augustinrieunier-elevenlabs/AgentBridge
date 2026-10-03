/**
 * Cadences PCM16 audio for one direction (caller->callee or callee->caller),
 * per spec-agent-bridge-demo.md section 7.2:
 * - decode each chunk into Int16Array, push into a FIFO
 * - emit one frame every frameSizeMs, with drift correction via performance.now()
 * - emit silence when the FIFO is empty, so turn-taking detection keeps working on the receiving agent
 */
(function () {
  const SAMPLE_RATE = 16000;

  class SampleQueue {
    constructor() {
      this.chunks = [];
      this.offset = 0; // read offset into chunks[0]
    }

    get length() {
      let total = -this.offset;
      for (const c of this.chunks) total += c.length;
      return Math.max(0, total);
    }

    push(samples) {
      if (samples.length > 0) this.chunks.push(samples);
    }

    /** Pops exactly `count` samples, zero-padding with silence if not enough are queued. */
    pop(count) {
      const out = new Int16Array(count);
      let written = 0;
      while (written < count && this.chunks.length > 0) {
        const head = this.chunks[0];
        const available = head.length - this.offset;
        const toCopy = Math.min(available, count - written);
        out.set(head.subarray(this.offset, this.offset + toCopy), written);
        written += toCopy;
        this.offset += toCopy;
        if (this.offset >= head.length) {
          this.chunks.shift();
          this.offset = 0;
        }
      }
      return out; // remaining bytes stay zeroed (silence)
    }

    clear() {
      this.chunks = [];
      this.offset = 0;
    }
  }

  class Pacer {
    constructor(frameSizeMs) {
      this.queue = new SampleQueue();
      this.frameSizeMs = frameSizeMs || 100;
      this.timer = null;
      this.nextTickAt = 0;
      this.onFrame = null;
      // Counts every tick where the queue didn't have a full frame ready (padded with silence
      // instead) -- a rising count mid-call is a direct sign the sender's audio isn't keeping up
      // with real-time playback, a plausible cause of a conversation reading as "cut off" from the
      // receiving side even though the sender kept talking. Surfaced in Bridge.js's periodic
      // metrics so a saved debug log shows the trend over time, not just a final snapshot.
      this.underrunCount = 0;
    }

    get frameSampleCount() {
      return Math.round((SAMPLE_RATE * this.frameSizeMs) / 1000);
    }

    setFrameSizeMs(ms) {
      this.frameSizeMs = ms;
    }

    push(samples) {
      this.queue.push(samples);
    }

    get queuedSampleCount() {
      return this.queue.length;
    }

    /** Discards everything queued -- used on an `interruption` event for this direction. */
    flush() {
      this.queue.clear();
    }

    start(onFrame) {
      this.onFrame = onFrame;
      this.nextTickAt = performance.now() + this.frameSizeMs;
      this._scheduleNext();
    }

    stop() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.onFrame = null;
    }

    _scheduleNext() {
      const delay = Math.max(0, this.nextTickAt - performance.now());
      this.timer = setTimeout(() => this._tick(), delay);
    }

    _tick() {
      if (!this.onFrame) return;
      const count = this.frameSampleCount;
      const hadEnough = this.queue.length >= count;
      if (!hadEnough) this.underrunCount += 1;
      const frame = this.queue.pop(count);
      this.onFrame(frame, !hadEnough && this.queue.length === 0);

      // Drift correction: advance by the nominal frame duration from the
      // previous scheduled tick, not from "now", so small timer jitter doesn't accumulate.
      this.nextTickAt += this.frameSizeMs;
      const now = performance.now();
      if (this.nextTickAt < now) this.nextTickAt = now + this.frameSizeMs; // fell far behind (e.g. tab backgrounded); resync
      this._scheduleNext();
    }
  }

  window.AB.audio.Pacer = Pacer;
})();
