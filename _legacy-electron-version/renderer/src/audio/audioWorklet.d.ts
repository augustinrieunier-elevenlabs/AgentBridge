/**
 * lib.dom.d.ts does not include the AudioWorkletGlobalScope types (they're a
 * separate, non-Window global scope). Minimal ambient declarations so
 * mic.worklet.ts type-checks; this file is never imported, only ambient.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new (options?: unknown) => AudioWorkletProcessor): void;
