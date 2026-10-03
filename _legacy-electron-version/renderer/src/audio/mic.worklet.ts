/**
 * AudioWorkletProcessor that converts the mic's Float32 render quanta into
 * PCM16 and posts them back to the main thread for push-to-talk / takeover
 * (spec-agent-bridge-demo.md section 7.4). Must be loaded with
 * audioContext.audioWorklet.addModule(...) -- see mic.ts.
 */
class MicCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    const pcm16 = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
