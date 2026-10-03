/**
 * Local audio output for one agent column (spec-agent-bridge-demo.md section 7.3):
 * - single shared AudioContext at 16 kHz
 * - each agent gets its own GainNode (volume/mute) -> StereoPannerNode (caller left, callee right) -> destination
 * - frames are scheduled back-to-back so playback stays in sync with the relay cadence
 * - output device selectable via setSinkId when the browser/Electron build supports it
 */
import { int16ToFloat32 } from "./pcm";

const SAMPLE_RATE = 16000;

export class AudioBus {
  readonly context: AudioContext;
  private destinationGain: GainNode;

  constructor() {
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.destinationGain = this.context.createGain();
    this.destinationGain.connect(this.context.destination);
  }

  async resume(): Promise<void> {
    if (this.context.state === "suspended") await this.context.resume();
  }

  async setOutputDevice(deviceId: string | undefined): Promise<void> {
    const ctxWithSink = this.context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (deviceId && typeof ctxWithSink.setSinkId === "function") {
      await ctxWithSink.setSinkId(deviceId);
    }
  }

  createChannel(pan: number): AudioChannel {
    return new AudioChannel(this.context, this.destinationGain, pan);
  }
}

export class AudioChannel {
  private gain: GainNode;
  private panner: StereoPannerNode;
  private nextPlayTime = 0;
  private muted = false;

  constructor(private context: AudioContext, destination: AudioNode, pan: number) {
    this.gain = context.createGain();
    this.panner = context.createStereoPanner();
    this.panner.pan.value = pan;
    this.gain.connect(this.panner);
    this.panner.connect(destination);
  }

  setVolume(volume: number): void {
    this.gain.gain.value = this.muted ? 0 : volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.gain.gain.value = muted ? 0 : this.gain.gain.value || 1;
  }

  /** Schedules one frame immediately after the previously scheduled one, to stay gap-free. */
  playFrame(samples: Int16Array): void {
    const floatData = int16ToFloat32(samples);
    const buffer = this.context.createBuffer(1, floatData.length, SAMPLE_RATE);
    // TS5.5's lib.dom.d.ts generic-typed ArrayBuffer views don't structurally match
    // our plain Float32Array here; the runtime buffer is a real ArrayBuffer, so this is safe.
    buffer.copyToChannel(floatData as Float32Array<ArrayBuffer>, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    const now = this.context.currentTime;
    const startAt = Math.max(now, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
  }
}
