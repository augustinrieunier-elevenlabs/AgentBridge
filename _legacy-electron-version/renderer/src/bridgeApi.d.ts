import type { BridgeApi } from "../../shared/types";

declare global {
  interface Window {
    bridgeApi: BridgeApi;
  }
}

export {};
