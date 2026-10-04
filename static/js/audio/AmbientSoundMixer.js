/**
 * Decodes uploaded MP3 ambient-sound files, resampled to this app's fixed 16kHz mono PCM (same
 * rate as every other frame in the bridge -- see audio/pcm.js), loops them, and mixes them into
 * outgoing PCM16 frames on top of NoiseInjector's synthesized noise. See Bridge.js
 * _onCallerToCalleeTick for where this sits in the mix order (skipped entirely on a dropped tick,
 * same as NoiseInjector -- a lost packet carries no signal at all, not even ambient background).
 *
 * Decoding goes through a throwaway OfflineAudioContext at sampleRate 16000: decodeAudioData
 * always resamples its output to the calling context's sample rate, regardless of whether that
 * context ever actually renders a graph -- the standard way to decode+resample audio without a
 * real-time AudioContext or a hand-written resampler. numberOfChannels/length on that constructor
 * are irrelevant here since startRendering() is never called; only sampleRate matters.
 */
(function () {
  const SAMPLE_RATE = 16000;
  // Level 100 -- loud but short of full scale, leaves headroom so the mix doesn't clip once
  // NoiseInjector's own noise (and the real speech it's layered under) is added on top.
  const MAX_AMPLITUDE_FRACTION = 0.9;

  class AmbientSoundMixer {
    constructor() {
      this.level = 0; // 0-100
      this._buffersByPath = new Map(); // path -> Int16Array (decoded, mono, 16kHz)
      this._active = []; // [{ samples, pos }] -- one independent looping cursor per selected sound
    }

    setLevel(level) {
      this.level = Math.max(0, Math.min(100, level));
    }

    /** Decodes (and caches) every path in `paths` not already loaded, then makes exactly those
     * paths the active/looping set -- call BEFORE a call starts so the mix is active from the
     * first tick (see Bridge.js start()). A single failed fetch/decode is logged and that one
     * sound is simply left out, not fatal to the rest. */
    async load(paths) {
      await Promise.all(
        paths.map(async (path) => {
          if (this._buffersByPath.has(path)) return;
          try {
            this._buffersByPath.set(path, await this._decode(path));
          } catch (err) {
            console.error("Could not decode ambient sound", path, err);
          }
        }),
      );
      this._active = paths
        .map((path) => this._buffersByPath.get(path))
        .filter((samples) => samples && samples.length > 0)
        .map((samples) => ({ samples, pos: 0 }));
    }

    async _decode(path) {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Could not fetch ${path}: HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const float32 = audioBuffer.getChannelData(0); // first channel only -- mono mix either way
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const clamped = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      }
      return int16;
    }

    /** Mixes every active sound's next `frame.length` samples (looping each independently) into
     * `frame` in place, scaled by `level` and divided down by the number of active sounds so
     * playing several at once doesn't just get louder/clip. No-op when level is 0 or nothing is
     * active yet (e.g. still loading). */
    apply(frame) {
      if (this.level <= 0 || this._active.length === 0) return frame;
      const amplitude = (this.level / 100) * MAX_AMPLITUDE_FRACTION * 32767;
      const perSound = amplitude / this._active.length;
      for (let i = 0; i < frame.length; i++) {
        let mixed = frame[i];
        for (const track of this._active) {
          mixed += (track.samples[track.pos] / 32768) * perSound;
          track.pos = (track.pos + 1) % track.samples.length;
        }
        frame[i] = mixed > 32767 ? 32767 : mixed < -32768 ? -32768 : mixed;
      }
      return frame;
    }
  }

  window.AB.audio.AmbientSoundMixer = AmbientSoundMixer;
})();
