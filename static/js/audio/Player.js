/**
 * Local audio output for one agent column (spec-agent-bridge-demo.md section 7.3):
 * - single shared AudioContext at 16 kHz
 * - each agent gets its own GainNode (volume/mute) -> StereoPannerNode (caller left, callee right) -> destination
 * - frames are scheduled back-to-back so playback stays in sync with the relay cadence
 * - output device selectable via setSinkId when the browser supports it
 */
(function () {
  const SAMPLE_RATE = 16000;
  const int16ToFloat32 = window.AB.audio.int16ToFloat32;

  class AudioChannel {
    constructor(context, destination, pan) {
      this.context = context;
      this.gain = context.createGain();
      this.panner = context.createStereoPanner();
      this.panner.pan.value = pan;
      this.gain.connect(this.panner);
      this.panner.connect(destination);
      this.nextPlayTime = 0;
      this.muted = false;
    }

    setVolume(volume) {
      this.gain.gain.value = this.muted ? 0 : volume;
    }

    setMuted(muted) {
      this.muted = muted;
      this.gain.gain.value = muted ? 0 : this.gain.gain.value || 1;
    }

    /** Schedules one frame immediately after the previously scheduled one, to stay gap-free. */
    playFrame(samples) {
      const floatData = int16ToFloat32(samples);
      const buffer = this.context.createBuffer(1, floatData.length, SAMPLE_RATE);
      buffer.copyToChannel(floatData, 0);

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);

      const now = this.context.currentTime;
      const startAt = Math.max(now, this.nextPlayTime);
      source.start(startAt);
      this.nextPlayTime = startAt + buffer.duration;
    }
  }

  class AudioBus {
    constructor() {
      this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.destinationGain = this.context.createGain();
      this.destinationGain.connect(this.context.destination);
    }

    async resume() {
      if (this.context.state === "suspended") await this.context.resume();
    }

    async setOutputDevice(deviceId) {
      if (deviceId && typeof this.context.setSinkId === "function") {
        await this.context.setSinkId(deviceId);
      }
    }

    createChannel(pan) {
      return new AudioChannel(this.context, this.destinationGain, pan);
    }
  }

  window.AB.audio.AudioBus = AudioBus;
  window.AB.audio.AudioChannel = AudioChannel;
})();
