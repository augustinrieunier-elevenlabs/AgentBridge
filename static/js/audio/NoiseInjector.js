/**
 * Mixes synthesized background noise into outgoing PCM16 frames -- lets a demo simulate a bad
 * phone line or a noisy environment on one direction of the bridge (see Bridge.js
 * _onCallerToCalleeTick, the caller->callee leg) without needing a real audio sample file.
 *
 * Two noise "colors", picked by ear rather than any real telephony spec:
 *   - "static": white noise, flat across all frequencies -- reads as line hiss/static.
 *   - "ambient": pink noise (1/f -- more energy at low frequencies, same reason real-world noise
 *     sources sound "warmer" than flat static), via Paul Kellet's refined filter -- reads as
 *     room/background tone.
 *
 * Mixed into EVERY outgoing frame, including the silence Pacer.js pads a tick with when nothing is
 * queued -- a real line/room's noise floor doesn't stop between utterances, so this shouldn't either.
 * `level` 0 (the default) is a true no-op: zero extra work per sample when disabled.
 */
(function () {
  const MAX_AMPLITUDE = 6000; // ~ -15 dBFS at level 100 -- clearly audible, short of drowning out speech

  class NoiseInjector {
    constructor() {
      this.type = "ambient"; // "ambient" | "static"
      this.level = 0; // 0-100, 0 = disabled
      // Pink filter state (persists across frames/ticks so the noise is one continuous signal,
      // not independently re-filtered white noise every 100ms).
      this._b0 = 0;
      this._b1 = 0;
      this._b2 = 0;
      this._b3 = 0;
      this._b4 = 0;
      this._b5 = 0;
      this._b6 = 0;
    }

    setType(type) {
      this.type = type;
    }

    setLevel(level) {
      this.level = Math.max(0, Math.min(100, level));
    }

    _nextWhite() {
      return Math.random() * 2 - 1;
    }

    _nextPink() {
      const white = this._nextWhite();
      this._b0 = 0.99886 * this._b0 + white * 0.0555179;
      this._b1 = 0.99332 * this._b1 + white * 0.0750759;
      this._b2 = 0.969 * this._b2 + white * 0.153852;
      this._b3 = 0.8665 * this._b3 + white * 0.3104856;
      this._b4 = 0.55 * this._b4 + white * 0.5329522;
      this._b5 = -0.7616 * this._b5 - white * 0.016898;
      const pink = this._b0 + this._b1 + this._b2 + this._b3 + this._b4 + this._b5 + this._b6 + white * 0.5362;
      this._b6 = white * 0.115926;
      return pink * 0.11; // empirical scale -- keeps pink noise in roughly the same range as white
    }

    /** Mixes noise into `frame` (an Int16Array) in place, clamped to int16 range, and returns it. */
    apply(frame) {
      if (this.level <= 0) return frame;
      const amplitude = (this.level / 100) * MAX_AMPLITUDE;
      const nextSample = this.type === "static" ? () => this._nextWhite() : () => this._nextPink();
      for (let i = 0; i < frame.length; i++) {
        const mixed = frame[i] + nextSample() * amplitude;
        frame[i] = mixed > 32767 ? 32767 : mixed < -32768 ? -32768 : mixed;
      }
      return frame;
    }
  }

  window.AB.audio.NoiseInjector = NoiseInjector;
})();
