/**
 * Microphone capture for push-to-talk / takeover (spec-agent-bridge-demo.md section 7.4).
 * No microphone is opened by default -- call start() only when the operator
 * engages push-to-talk or takeover, and stop() as soon as they release it.
 */

// `?worker&url` makes Vite compile mic.worklet.ts as its own JS entry point
// (stripping TS types, bundling) and hand back the URL to that compiled
// output -- audioWorklet.addModule() needs a real, already-compiled JS file.
// A plain `?url` would copy the raw .ts source untranspiled (and Vite's
// default MIME guess for a bare ".ts" extension is "video/mp2t", not
// JavaScript, which breaks addModule() entirely).
import micWorkletUrl from "./mic.worklet.ts?worker&url";

export class MicCapture {
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(private context: AudioContext, private onChunk: (samples: Int16Array) => void) {}

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    await this.context.audioWorklet.addModule(micWorkletUrl);
    this.source = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.context, "mic-capture-processor");
    this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.onChunk(new Int16Array(event.data));
    };
    this.source.connect(this.workletNode);
    // The worklet output is not routed to the destination: we only read it, never play it back locally.
  }

  stop(): void {
    this.workletNode?.port.close();
    this.workletNode?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.workletNode = null;
    this.source = null;
    this.stream = null;
  }

  get isActive(): boolean {
    return this.stream !== null;
  }
}
