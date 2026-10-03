/** PCM16 <-> base64 conversion helpers shared by the pacer, player and mic worklet glue. */

export function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export function int16ArrayToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function silenceFrame(sampleCount: number): Int16Array {
  return new Int16Array(sampleCount);
}

export function isSilentFrame(samples: Int16Array, thresholdAbs = 50): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > thresholdAbs) return false;
  }
  return true;
}

export function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
  return out;
}
