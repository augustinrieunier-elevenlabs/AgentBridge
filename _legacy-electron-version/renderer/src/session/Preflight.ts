/**
 * Pre-flight checks before "Launch" (spec-agent-bridge-demo.md section 5).
 * Takes the BridgeApi as a dependency so it can be unit-tested with a mock
 * (spec-agent-bridge-demo.md section 13, "Preflight, avec des mocks REST").
 */
import type { Account, AgentCachedMeta, AgentRef, BridgeApi, Scenario } from "../../../shared/types";

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckResult = { id: string; label: string; status: CheckStatus; detail?: string };

export type PreflightInput = {
  api: Pick<BridgeApi, "accounts" | "agents">;
  accounts: Account[];
  callerAgent: AgentRef;
  calleeAgent: AgentRef;
  scenario: Scenario;
};

export type PreflightResult = {
  checks: CheckResult[];
  blocked: boolean;
  callerMeta?: AgentCachedMeta;
  calleeMeta?: AgentCachedMeta;
};

function accountOf(accounts: Account[], id: string): Account | undefined {
  return accounts.find((a) => a.id === id);
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const { api, accounts, callerAgent, calleeAgent, scenario } = input;
  const checks: CheckResult[] = [];

  const callerAccount = accountOf(accounts, callerAgent.accountId);
  const calleeAccount = accountOf(accounts, calleeAgent.accountId);

  // 1. Both accounts respond (key valid)
  for (const [role, account] of [["caller", callerAccount] as const, ["callee", calleeAccount] as const]) {
    if (!account) {
      checks.push({ id: `account-${role}`, label: `${role} account exists`, status: "fail", detail: "Account not found -- check .env" });
      continue;
    }
    if (!account.hasKey) {
      checks.push({ id: `account-${role}`, label: `${role} account (${account.label})`, status: "pass", detail: "No API key configured -- public agent only" });
      continue;
    }
    const result = await api.accounts.test(account.id);
    checks.push({
      id: `account-${role}`,
      label: `${role} account (${account.label}) responds`,
      status: result.ok ? "pass" : "fail",
      detail: result.ok ? undefined : `${result.error ?? "unknown error"}${result.statusCode ? ` (HTTP ${result.statusCode})` : ""}`,
    });
  }

  // 2. Both agent_id exist on their account
  let callerMeta: AgentCachedMeta | undefined;
  let calleeMeta: AgentCachedMeta | undefined;
  if (callerAccount) {
    try {
      callerMeta = await api.agents.inspect(callerAccount.id, callerAgent.agentId);
      checks.push({ id: "agent-caller", label: `Caller agent "${callerAgent.label}" exists on ${callerAccount.label}`, status: "pass" });
    } catch (err) {
      checks.push({ id: "agent-caller", label: `Caller agent "${callerAgent.label}" exists on ${callerAccount.label}`, status: "fail", detail: String((err as Error).message) });
    }
  }
  if (calleeAccount) {
    try {
      calleeMeta = await api.agents.inspect(calleeAccount.id, calleeAgent.agentId);
      checks.push({ id: "agent-callee", label: `Callee agent "${calleeAgent.label}" exists on ${calleeAccount.label}`, status: "pass" });
    } catch (err) {
      checks.push({ id: "agent-callee", label: `Callee agent "${calleeAgent.label}" exists on ${calleeAccount.label}`, status: "fail", detail: String((err as Error).message) });
    }
  }

  // 3. Audio formats compatible (recommended pcm_16000 everywhere)
  if (callerMeta && calleeMeta) {
    const callerOutMatchesCalleeIn = callerMeta.outputFormat === calleeMeta.inputFormat;
    const calleeOutMatchesCallerIn = calleeMeta.outputFormat === callerMeta.inputFormat;
    checks.push({
      id: "audio-formats",
      label: "Audio formats compatible between caller and callee",
      status: callerOutMatchesCalleeIn && calleeOutMatchesCallerIn ? "pass" : "fail",
      detail:
        callerOutMatchesCalleeIn && calleeOutMatchesCallerIn
          ? `${callerMeta.outputFormat} <-> ${calleeMeta.outputFormat}`
          : `Caller out=${callerMeta.outputFormat} / Callee in=${calleeMeta.inputFormat} ; Callee out=${calleeMeta.outputFormat} / Caller in=${callerMeta.inputFormat}. Set both agents' audio format to pcm_16000 in their dashboard.`,
    });
  }

  // 4. Overrides required by the scenario are enabled on the caller
  if (callerMeta) {
    const needsLanguage = true; // the app always forces the caller's language
    const needsFirstMessage = scenario.firstSpeaker === "caller";
    const needsVoice = Boolean(scenario.voiceId);
    const needsAsrKeywords = scenario.asrKeywords.length > 0;
    const needsMaxDuration = true;
    const needsPrompt = Boolean(scenario.expertMode);

    const overrideChecks: Array<[boolean, boolean, string]> = [
      [needsLanguage, callerMeta.overridesEnabled.agentLanguage, "agent.language override must be enabled on the caller agent (Security tab)"],
      [needsFirstMessage, callerMeta.overridesEnabled.agentFirstMessage, "agent.first_message override must be enabled on the caller agent (Security tab)"],
      [needsVoice, callerMeta.overridesEnabled.ttsVoiceId, "tts.voice_id override must be enabled on the caller agent (Security tab)"],
      [needsAsrKeywords, callerMeta.overridesEnabled.asrKeywords, "asr.keywords override must be enabled on the caller agent (Security tab)"],
      [needsMaxDuration, callerMeta.overridesEnabled.conversationMaxDuration, "conversation.max_duration_seconds override must be enabled on the caller agent (Security tab)"],
      [needsPrompt, callerMeta.overridesEnabled.agentPrompt, "agent.prompt.prompt override must be enabled on the caller agent for expert mode (Security tab)"],
    ];
    for (const [needed, enabled, detail] of overrideChecks) {
      if (!needed) continue;
      checks.push({ id: `override-${detail.slice(0, 20)}`, label: detail, status: enabled ? "pass" : "fail", detail: enabled ? undefined : "Not enabled on the agent" });
    }

    checks.push({
      id: "caller-language-enabled",
      label: `Scenario language (${scenario.languageName}) enabled on caller agent`,
      status: callerMeta.language === scenario.language || (callerMeta.additionalLanguages ?? []).includes(scenario.language) ? "pass" : "warn",
      detail: "Add this language under the caller agent's Language settings if the call sounds wrong.",
    });

    checks.push({
      id: "caller-end-call",
      label: "end_call tool present on caller agent",
      status: callerMeta.hasEndCallTool === true ? "pass" : "warn",
      detail: callerMeta.hasEndCallTool === "unknown" ? "Could not verify from the API response -- check manually." : "Enable the end_call system tool so the caller hangs up cleanly.",
    });
  }

  // 5. Callee language override, only if the scenario requests one
  if (calleeMeta && scenario.calleeLanguageOverride) {
    checks.push({
      id: "override-callee-language",
      label: "agent.language override must be enabled on the callee agent",
      status: calleeMeta.overridesEnabled.agentLanguage ? "pass" : "fail",
      detail: calleeMeta.overridesEnabled.agentLanguage ? undefined : "Not enabled on the agent (Security tab)",
    });
  }

  const blocked = checks.some((c) => c.status === "fail");
  return { checks, blocked, callerMeta, calleeMeta };
}
