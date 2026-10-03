import { describe, it, expect, vi } from "vitest";
import { runPreflight } from "../session/Preflight";
import { emptyScenario } from "../model/factory";
import type { Account, AgentCachedMeta, AgentRef } from "../../../shared/types";

const accounts: Account[] = [
  { id: "acc-a", label: "Demo A", region: "default", baseUrl: "https://api.elevenlabs.io", hasKey: true },
  { id: "acc-b", label: "Demo B", region: "default", baseUrl: "https://api.elevenlabs.io", hasKey: true },
];

const callerAgent: AgentRef = { id: "ref-caller", label: "Caller Simulator", role: "caller", accountId: "acc-a", agentId: "agent_caller" };
const calleeAgent: AgentRef = { id: "ref-callee", label: "Hotel receptionist", role: "callee", accountId: "acc-b", agentId: "agent_callee" };

function meta(overrides: Partial<AgentCachedMeta> = {}): AgentCachedMeta {
  return {
    name: "Agent",
    inputFormat: "pcm_16000",
    outputFormat: "pcm_16000",
    language: "ja",
    additionalLanguages: ["ja"],
    overridesEnabled: {
      agentPrompt: false,
      agentFirstMessage: true,
      agentLanguage: true,
      ttsVoiceId: true,
      ttsSpeed: false,
      asrKeywords: true,
      conversationMaxDuration: true,
    },
    hasEndCallTool: true,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeApi(callerMeta: AgentCachedMeta, calleeMeta: AgentCachedMeta) {
  return {
    accounts: { test: vi.fn().mockResolvedValue({ ok: true }), list: vi.fn() },
    agents: {
      inspect: vi.fn(async (accountId: string) => (accountId === "acc-a" ? callerMeta : calleeMeta)),
      listRemote: vi.fn(),
    },
  };
}

describe("Preflight", () => {
  it("passes every check for a well-configured, format-matching pair", async () => {
    const api = makeApi(meta(), meta());
    const result = await runPreflight({ api, accounts, callerAgent, calleeAgent, scenario: { ...emptyScenario(), language: "ja" } });
    expect(result.blocked).toBe(false);
    expect(result.checks.every((c) => c.status !== "fail")).toBe(true);
  });

  it("blocks on incompatible audio formats", async () => {
    const api = makeApi(meta({ outputFormat: "pcm_24000" }), meta());
    const result = await runPreflight({ api, accounts, callerAgent, calleeAgent, scenario: emptyScenario() });
    expect(result.blocked).toBe(true);
    expect(result.checks.find((c) => c.id === "audio-formats")?.status).toBe("fail");
  });

  it("blocks when a required override is disabled on the caller agent", async () => {
    const api = makeApi(meta({ overridesEnabled: { ...meta().overridesEnabled, agentLanguage: false } }), meta());
    const result = await runPreflight({ api, accounts, callerAgent, calleeAgent, scenario: emptyScenario() });
    expect(result.blocked).toBe(true);
  });

  it("blocks when the account key test fails", async () => {
    const api = makeApi(meta(), meta());
    api.accounts.test = vi.fn().mockResolvedValue({ ok: false, error: "invalid key", statusCode: 401 });
    const result = await runPreflight({ api, accounts, callerAgent, calleeAgent, scenario: emptyScenario() });
    expect(result.blocked).toBe(true);
    expect(result.checks.find((c) => c.id === "account-caller")?.detail).toContain("invalid key");
  });

  it("only requires the callee language override when the scenario sets one", async () => {
    const api = makeApi(meta(), meta({ overridesEnabled: { ...meta().overridesEnabled, agentLanguage: false } }));
    const withoutOverride = await runPreflight({ api, accounts, callerAgent, calleeAgent, scenario: emptyScenario() });
    expect(withoutOverride.checks.find((c) => c.id === "override-callee-language")).toBeUndefined();

    const withOverride = await runPreflight({ api, accounts, callerAgent, calleeAgent, scenario: { ...emptyScenario(), calleeLanguageOverride: "ja" } });
    expect(withOverride.checks.find((c) => c.id === "override-callee-language")?.status).toBe("fail");
  });
});
