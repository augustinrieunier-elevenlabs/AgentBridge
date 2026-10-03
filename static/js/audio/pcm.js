/** PCM16 <-> base64 conversion helpers shared by the pacer, player and mic worklet glue. */
(function () {
  function base64ToInt16Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }

  function int16ArrayToBase64(samples) {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function silenceFrame(sampleCount) {
    return new Int16Array(sampleCount);
  }

  function isSilentFrame(samples, thresholdAbs) {
    thresholdAbs = thresholdAbs === undefined ? 50 : thresholdAbs;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > thresholdAbs) return false;
    }
    return true;
  }

  function int16ToFloat32(samples) {
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
    return out;
  }

  window.AB.audio.base64ToInt16Array = base64ToInt16Array;
  window.AB.audio.int16ArrayToBase64 = int16ArrayToBase64;
  window.AB.audio.silenceFrame = silenceFrame;
  window.AB.audio.isSilentFrame = isSilentFrame;
  window.AB.audio.int16ToFloat32 = int16ToFloat32;
})();
