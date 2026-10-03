/**
 * Microphone capture for push-to-talk / takeover (spec-agent-bridge-demo.md section 7.4).
 * No microphone is opened by default -- call start() only when the operator
 * engages push-to-talk or takeover, and stop() as soon as they release it.
 */
(function () {
  class MicCapture {
    constructor(context, onChunk) {
      this.context = context;
      this.onChunk = onChunk;
      this.stream = null;
      this.workletNode = null;
      this.source = null;
    }

    async start() {
      if (this.stream) return;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      await this.context.audioWorklet.addModule("/static/js/audio/mic.worklet.js");
      this.source = this.context.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.context, "mic-capture-processor");
      this.workletNode.port.onmessage = (event) => {
        this.onChunk(new Int16Array(event.data));
      };
      this.source.connect(this.workletNode);
      // The worklet output is not routed to the destination: we only read it, never play it back locally.
    }

    stop() {
      if (this.workletNode) {
        this.workletNode.port.close();
        this.workletNode.disconnect();
      }
      if (this.source) this.source.disconnect();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.workletNode = null;
      this.source = null;
      this.stream = null;
    }

    get isActive() {
      return this.stream !== null;
    }
  }

  window.AB.audio.MicCapture = MicCapture;
})();
