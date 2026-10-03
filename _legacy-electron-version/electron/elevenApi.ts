/**
 * Thin REST client for the ElevenLabs Conversational AI (ElevenAgents) API.
 * Runs only in the main process -- this file must never be imported by the renderer.
 *
 * Endpoints verified against https://elevenlabs.io/docs/eleven-agents/api-reference
 * and https://elevenlabs.io/docs/api-reference/agents/{list,get} on 2026-10-01:
 *   GET  /v1/convai/agents                              (list)
 *   GET  /v1/convai/agents/{agent_id}                    (get)
 *   GET  /v1/convai/conversation/get-signed-url          (signed url, ?agent_id=)
 *   GET  /v1/convai/conversations/{conversation_id}      (final transcript)
 */
import type { AgentCachedMeta, RemoteAgentSummary } from "../shared/types";
import { getAccountById } from "./secrets";

const ALLOWED_HOST_SUFFIX = ".elevenlabs.io";

function assertAllowedHost(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (url.hostname !== "elevenlabs.io" && !url.hostname.endsWith(ALLOWED_HOST_SUFFIX)) {
    throw new Error(`Refusing to call non-ElevenLabs host: ${url.hostname}`);
  }
  return url;
}

class ElevenApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
  }
}

async function request(
  accountId: string,
  path: string,
  options: { method?: string; query?: Record<string, string | undefined>; headers?: Record<string, string> } = {},
): Promise<any> {
  const account = getAccountById(accountId);
  if (!account) throw new ElevenApiError(`Unknown account: ${accountId}`);

  const base = assertAllowedHost(account.baseUrl);
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = { ...options.headers };
  if (account.apiKey) headers["xi-api-key"] = account.apiKey;

  const res = await fetch(url.toString(), { method: options.method ?? "GET", headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ElevenApiError(`ElevenLabs API error ${res.status} on ${path}: ${body.slice(0, 300)}`, res.status);
  }
  return res.json();
}

export async function testAccount(accountId: string): Promise<{ ok: boolean; error?: string; statusCode?: number }> {
  try {
    await request(accountId, "/v1/convai/agents", { query: { page_size: "1" } });
    return { ok: true };
  } catch (err) {
    const e = err as ElevenApiError;
    return { ok: false, error: e.message, statusCode: e.statusCode };
  }
}

export async function listAgents(accountId: string): Promise<RemoteAgentSummary[]> {
  const out: RemoteAgentSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await request(accountId, "/v1/convai/agents", { query: { page_size: "100", cursor } });
    for (const a of page.agents ?? []) out.push({ agentId: a.agent_id, name: a.name });
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

function readOverrideFlag(section: unknown, field: string): boolean {
  if (!section || typeof section !== "object") return false;
  const value = (section as Record<string, unknown>)[field];
  return value === true;
}

export async function getAgent(accountId: string, agentId: string): Promise<AgentCachedMeta> {
  const agent = await request(accountId, `/v1/convai/agents/${encodeURIComponent(agentId)}`);
  const conversationConfig = agent.conversation_config ?? {};
  const overrideCfg = agent.platform_settings?.overrides?.conversation_config_override ?? {};

  let hasEndCallTool: boolean | "unknown" = "unknown";
  try {
    const builtInTools = conversationConfig.agent?.prompt?.built_in_tools;
    if (builtInTools && typeof builtInTools === "object") {
      hasEndCallTool = Boolean(builtInTools.end_call);
    }
  } catch {
    hasEndCallTool = "unknown";
  }

  return {
    name: agent.name ?? agentId,
    inputFormat: conversationConfig.asr?.user_input_audio_format ?? "unknown",
    outputFormat: conversationConfig.tts?.agent_output_audio_format ?? "unknown",
    language: conversationConfig.agent?.language,
    additionalLanguages: conversationConfig.language_presets ? Object.keys(conversationConfig.language_presets) : [],
    overridesEnabled: {
      agentPrompt: readOverrideFlag(overrideCfg.agent, "prompt"),
      agentFirstMessage: readOverrideFlag(overrideCfg.agent, "first_message"),
      agentLanguage: readOverrideFlag(overrideCfg.agent, "language"),
      ttsVoiceId: readOverrideFlag(overrideCfg.tts, "voice_id"),
      ttsSpeed: readOverrideFlag(overrideCfg.tts, "speed"),
      asrKeywords: readOverrideFlag(overrideCfg.asr, "keywords"),
      conversationMaxDuration: readOverrideFlag(overrideCfg.conversation, "max_duration_seconds"),
    },
    hasEndCallTool,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getSignedUrl(accountId: string, agentId: string): Promise<string> {
  const data = await request(accountId, "/v1/convai/conversation/get-signed-url", { query: { agent_id: agentId } });
  if (!data.signed_url) throw new ElevenApiError("ElevenLabs API did not return a signed_url");
  return data.signed_url as string;
}

/** Direct (unsigned) connection URL for a public agent that needs no API key. */
export function getPublicAgentUrl(accountId: string, agentId: string): string {
  const account = getAccountById(accountId);
  if (!account) throw new ElevenApiError(`Unknown account: ${accountId}`);
  const base = assertAllowedHost(account.baseUrl);
  const wsBase = `wss://${base.hostname}`;
  return `${wsBase}/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
}

export async function getConversation(accountId: string, conversationId: string): Promise<unknown> {
  return request(accountId, `/v1/convai/conversations/${encodeURIComponent(conversationId)}`);
}
