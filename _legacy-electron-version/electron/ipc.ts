/**
 * ipcMain handlers backing window.bridgeApi (see preload.ts and shared/types.ts).
 * Every handler validates its inputs before touching the network or disk --
 * in particular, agentRef/accountId values are checked against known config
 * so the renderer can never make us call an arbitrary host or leak a key.
 */
import { ipcMain } from "electron";
import { listAccountsPublic, getAccountById } from "./secrets";
import * as elevenApi from "./elevenApi";
import { loadConfig, saveConfig, saveExport, listExports, readExport } from "./config";
import type { AppConfig } from "../shared/types";

function requireKnownAccount(accountId: string): void {
  if (!getAccountById(accountId)) {
    throw new Error(`Unknown account id: ${accountId}`);
  }
}

function requireSafeAgentId(agentId: string): void {
  // ElevenLabs agent ids are short alphanumeric tokens; this blocks anything
  // that could be a path/query injection attempt via a malformed renderer call.
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(agentId)) {
    throw new Error("Invalid agent id");
  }
}

// Never log full signed URLs or keys: mask the token query param.
function maskSignedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("token")) u.searchParams.set("token", "***");
    return u.toString();
  } catch {
    return "***";
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle("accounts:list", async () => listAccountsPublic());

  ipcMain.handle("accounts:test", async (_evt, accountId: string) => {
    requireKnownAccount(accountId);
    return elevenApi.testAccount(accountId);
  });

  ipcMain.handle("agents:listRemote", async (_evt, accountId: string) => {
    requireKnownAccount(accountId);
    return elevenApi.listAgents(accountId);
  });

  ipcMain.handle("agents:inspect", async (_evt, accountId: string, agentId: string) => {
    requireKnownAccount(accountId);
    requireSafeAgentId(agentId);
    return elevenApi.getAgent(accountId, agentId);
  });

  ipcMain.handle("session:getSignedUrl", async (_evt, accountId: string, agentId: string) => {
    requireKnownAccount(accountId);
    requireSafeAgentId(agentId);
    const account = getAccountById(accountId)!;
    const url = account.hasKey
      ? await elevenApi.getSignedUrl(accountId, agentId)
      : elevenApi.getPublicAgentUrl(accountId, agentId);
    console.log(`[session] signed url ready for account=${accountId} agent=${agentId}: ${maskSignedUrl(url)}`);
    return { url };
  });

  ipcMain.handle("session:fetchFinalTranscript", async (_evt, accountId: string, conversationId: string) => {
    requireKnownAccount(accountId);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(conversationId)) throw new Error("Invalid conversation id");
    const raw: any = await elevenApi.getConversation(accountId, conversationId);
    const transcript = Array.isArray(raw?.transcript)
      ? raw.transcript.map((t: any) => ({ role: t.role, message: t.message, timeInCallSecs: t.time_in_call_secs }))
      : [];
    return { conversationId, transcript, raw };
  });

  ipcMain.handle("config:load", async () => loadConfig());
  ipcMain.handle("config:save", async (_evt, cfg: AppConfig) => saveConfig(cfg));

  ipcMain.handle("exports:save", async (_evt, name: string, json: unknown) => {
    const savedPath = await saveExport(name, json);
    return { path: savedPath };
  });
  ipcMain.handle("exports:list", async () => listExports());
  ipcMain.handle("exports:read", async (_evt, filePath: string) => readExport(filePath));
}
