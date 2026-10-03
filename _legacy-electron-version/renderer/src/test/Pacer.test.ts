import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Pacer } from "../audio/Pacer";

describe("Pacer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits frames of the configured sample count", () => {
    const pacer = new Pacer(100); // 100ms @ 16kHz = 1600 samples
    expect(pacer.frameSampleCount).toBe(1600);

    const frames: Int16Array[] = [];
    pacer.push(new Int16Array(1600).fill(42));
    pacer.start((frame) => frames.push(frame));

    vi.advanceTimersByTime(100);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(1600);
    expect(frames[0][0]).toBe(42);
    pacer.stop();
  });

  it("emits silence when the queue is empty", () => {
    const pacer = new Pacer(100);
    const frames: { frame: Int16Array; wasSilence: boolean }[] = [];
    pacer.start((frame, wasSilence) => frames.push({ frame, wasSilence }));

    vi.advanceTimersByTime(100);

    expect(frames).toHaveLength(1);
    expect(frames[0].wasSilence).toBe(true);
    expect(frames[0].frame.every((v) => v === 0)).toBe(true);
    pacer.stop();
  });

  it("supports a smaller debug frame size", () => {
    const pacer = new Pacer(20); // 20ms @ 16kHz = 320 samples
    expect(pacer.frameSampleCount).toBe(320);
  });

  it("flush() discards queued samples so the next frame is silence", () => {
    const pacer = new Pacer(100);
    pacer.push(new Int16Array(1600).fill(7));
    pacer.flush();

    const frames: Int16Array[] = [];
    pacer.start((frame) => frames.push(frame));
    vi.advanceTimersByTime(100);

    expect(frames[0].every((v) => v === 0)).toBe(true);
    pacer.stop();
  });
});
