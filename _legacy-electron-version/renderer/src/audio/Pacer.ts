/**
 * Cadences PCM16 audio for one direction (caller->callee or callee->caller),
 * per spec-agent-bridge-demo.md section 7.2:
 * - decode each chunk into Int16Array, push into a FIFO
 * - emit one frame every frameSizeMs, with drift correction via performance.now()
 * - emit silence when the FIFO is empty, so turn-taking detection keeps working on the receiving agent
 */
import type { AudioFrameSizeMs } from "../../../shared/types";

const SAMPLE_RATE = 16000;

class SampleQueue {
  private chunks: Int16Array[] = [];
  private offset = 0; // read offset into chunks[0]

  get length(): number {
    let total = -this.offset;
    for (const c of this.chunks) total += c.length;
    return Math.max(0, total);
  }

  push(samples: Int16Array): void {
    if (samples.length > 0) this.chunks.push(samples);
  }

  /** Pops exactly `count` samples, zero-padding with silence if not enough are queued. */
  pop(count: number): Int16Array {
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

  clear(): void {
    this.chunks = [];
    this.offset = 0;
  }
}

export class Pacer {
  private queue = new SampleQueue();
  private frameSizeMs: AudioFrameSizeMs;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextTickAt = 0;
  private onFrame: ((frame: Int16Array, wasSilence: boolean) => void) | null = null;

  constructor(frameSizeMs: AudioFrameSizeMs = 100) {
    this.frameSizeMs = frameSizeMs;
  }

  get frameSampleCount(): number {
    return Math.round((SAMPLE_RATE * this.frameSizeMs) / 1000);
  }

  setFrameSizeMs(ms: AudioFrameSizeMs): void {
    this.frameSizeMs = ms;
  }

  push(samples: Int16Array): void {
    this.queue.push(samples);
  }

  get queuedSampleCount(): number {
    return this.queue.length;
  }

  /** Discards everything queued -- used on an `interruption` event for this direction. */
  flush(): void {
    this.queue.clear();
  }

  start(onFrame: (frame: Int16Array, wasSilence: boolean) => void): void {
    this.onFrame = onFrame;
    this.nextTickAt = performance.now() + this.frameSizeMs;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.onFrame = null;
  }

  private scheduleNext(): void {
    const delay = Math.max(0, this.nextTickAt - performance.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private tick(): void {
    if (!this.onFrame) return;
    const count = this.frameSampleCount;
    const hadEnough = this.queue.length >= count;
    const frame = this.queue.pop(count);
    this.onFrame(frame, !hadEnough && this.queue.length === 0);

    // Drift correction: advance by the nominal frame duration from the
    // previous scheduled tick, not from "now", so small timer jitter doesn't accumulate.
    this.nextTickAt += this.frameSizeMs;
    const now = performance.now();
    if (this.nextTickAt < now) this.nextTickAt = now + this.frameSizeMs; // we fell far behind (e.g. tab was backgrounded); resync
    this.scheduleNext();
  }
}
