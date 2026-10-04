/**
 * Simulates dropped audio packets on one direction of the bridge: every random interval (default
 * 5-15s, configurable at call time -- see setIntervalRangeS), mutes a short burst of outgoing audio
 * entirely (default ~0.2s, see setDropDurationS) -- true silence, not noise, matching what a
 * receiver actually gets when a real packet never arrives (confirmed with the user 2026-10-05).
 *
 * Counts whole frames rather than wall-clock time, so it stays exact regardless of browser timer
 * jitter -- one call to apply() per outgoing Pacer tick (see Bridge.js, always 100ms here).
 *
 * Combines with NoiseInjector (see Bridge.js _onCallerToCalleeTick): a drop wins over noise for any
 * frame it covers -- a dropped packet carries no signal at all for that instant, not even
 * background line noise, so noise is skipped entirely on a dropped tick rather than layered under
 * silence.
 */
(function () {
  const DEFAULT_MIN_INTERVAL_S = 5;
  const DEFAULT_MAX_INTERVAL_S = 15;
  const DEFAULT_DROP_S = 0.2;

  class PacketLossSimulator {
    constructor(frameSizeMs) {
      this.frameSizeMs = frameSizeMs || 100;
      this.enabled = false;
      this.minIntervalS = DEFAULT_MIN_INTERVAL_S;
      this.maxIntervalS = DEFAULT_MAX_INTERVAL_S;
      this.dropS = DEFAULT_DROP_S;
      this._ticksUntilNextDrop = this._randomIntervalTicks();
      this._dropTicksRemaining = 0;
    }

    /** Changing this only affects the NEXT scheduled drop, not whatever countdown/drop is already
     * in progress -- simplest behavior that still lets an operator dial it in live without the
     * current wait suddenly jumping around mid-countdown. */
    setIntervalRangeS(minS, maxS) {
      this.minIntervalS = Math.max(0.1, Math.min(minS, maxS));
      this.maxIntervalS = Math.max(this.minIntervalS, Math.max(minS, maxS));
    }

    setDropDurationS(seconds) {
      this.dropS = Math.max(0.1, seconds);
    }

    _randomIntervalTicks() {
      const seconds = this.minIntervalS + Math.random() * (this.maxIntervalS - this.minIntervalS);
      return Math.max(1, Math.round((seconds * 1000) / this.frameSizeMs));
    }

    _dropTicks() {
      return Math.max(1, Math.round((this.dropS * 1000) / this.frameSizeMs));
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      // Stops mid-drop immediately if turned off; the countdown to the next drop simply pauses
      // while disabled (not reset) and resumes from where it was if turned back on.
      if (!enabled) this._dropTicksRemaining = 0;
    }

    /** Mutes `frame` (Int16Array) in place when a scheduled drop covers this tick. Returns true if
     * this tick was dropped, so a caller (Bridge.js) can skip layering noise on top of it. */
    apply(frame) {
      if (!this.enabled) return false;

      if (this._dropTicksRemaining <= 0) {
        this._ticksUntilNextDrop -= 1;
        if (this._ticksUntilNextDrop > 0) return false;
        this._dropTicksRemaining = this._dropTicks();
      }

      frame.fill(0);
      this._dropTicksRemaining -= 1;
      if (this._dropTicksRemaining <= 0) this._ticksUntilNextDrop = this._randomIntervalTicks();
      return true;
    }
  }

  window.AB.audio.PacketLossSimulator = PacketLossSimulator;
})();
