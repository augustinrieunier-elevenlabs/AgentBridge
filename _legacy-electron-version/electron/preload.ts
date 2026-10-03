/**
 * Minimal, typed IPC surface exposed to the renderer as window.bridgeApi.
 * The renderer never gets access to Node/Electron APIs directly
 * (contextIsolation + sandbox), only to these whitelisted calls.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, BridgeApi } from "../shared/types";

const bridgeApi: BridgeApi = {
  accounts: {
    list: () => ipcRenderer.invoke("accounts:list"),
    test: (accountId: string) => ipcRenderer.invoke("accounts:test", accountId),
  },
  agents: {
    listRemote: (accountId: string) => ipcRenderer.invoke("agents:listRemote", accountId),
    inspect: (accountId: string, agentId: string) => ipcRenderer.invoke("agents:inspect", accountId, agentId),
  },
  session: {
    getSignedUrl: (accountId: string, agentId: string) =>
      ipcRenderer.invoke("session:getSignedUrl", accountId, agentId),
    fetchFinalTranscript: (accountId: string, conversationId: string) =>
      ipcRenderer.invoke("session:fetchFinalTranscript", accountId, conversationId),
  },
  config: {
    load: () => ipcRenderer.invoke("config:load"),
    save: (cfg: AppConfig) => ipcRenderer.invoke("config:save", cfg),
  },
  exports: {
    save: (name: string, json: unknown) => ipcRenderer.invoke("exports:save", name, json),
    list: () => ipcRenderer.invoke("exports:list"),
    read: (path: string) => ipcRenderer.invoke("exports:read", path),
  },
};

contextBridge.exposeInMainWorld("bridgeApi", bridgeApi);
