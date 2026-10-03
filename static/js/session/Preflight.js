/**
 * Pre-flight checks before "Launch" (spec-agent-bridge-demo.md section 5).
 * Takes the api client as a parameter (defaults to window.AB.api) so it stays
 * easy to call with a stub from the browser console while testing manually.
 *
 * CheckResult shape: { id, label, status: "pass"|"warn"|"fail", detail? }
 */
(function () {
  function accountOf(accounts, id) {
    return accounts.find((a) => a.id === id);
  }

  async function runPreflight({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables }) {
    api = api || window.AB.api;
    const checks = [];

    const callerAccount = accountOf(accounts, callerAgent.accountId);
    const calleeAccount = accountOf(accounts, calleeAgent.accountId);

    // 1. Both accounts respond (key valid)
    for (const [role, account] of [["caller", callerAccount], ["callee", calleeAccount]]) {
      if (!account) {
        checks.push({ id: `account-${role}`, label: `${role} account exists`, status: "fail", detail: "Account not found -- check .env" });
        continue;
      }
      if (!account.has_key) {
        checks.push({ id: `account-${role}`, label: `${role} account (${account.label})`, status: "pass", detail: "No API key configured -- public agent only" });
        continue;
      }
      const result = await api.accounts.test(account.id);
      checks.push({
        id: `account-${role}`,
        label: `${role} account (${account.label}) responds`,
        status: result.ok ? "pass" : "fail",
        detail: result.ok ? undefined : `${result.error || "unknown error"}${result.status_code ? ` (HTTP ${result.status_code})` : ""}`,
      });
    }

    // 2. Both agent_id exist on their account
    let callerMeta, calleeMeta;
    if (callerAccount) {
      try {
        callerMeta = await api.agents.inspect(callerAccount.id, callerAgent.agentId);
        checks.push({ id: "agent-caller", label: `Caller agent "${callerAgent.label}" exists on ${callerAccount.label}`, status: "pass" });
      } catch (err) {
        checks.push({ id: "agent-caller", label: `Caller agent "${callerAgent.label}" exists on ${callerAccount.label}`, status: "fail", detail: String(err.message) });
      }
    }
    if (calleeAccount) {
      try {
        calleeMeta = await api.agents.inspect(calleeAccount.id, calleeAgent.agentId);
        checks.push({ id: "agent-callee", label: `Callee agent "${calleeAgent.label}" exists on ${calleeAccount.label}`, status: "pass" });
      } catch (err) {
        checks.push({ id: "agent-callee", label: `Callee agent "${calleeAgent.label}" exists on ${calleeAccount.label}`, status: "fail", detail: String(err.message) });
      }
    }

    // 3. Audio formats compatible (recommended pcm_16000 everywhere)
    if (callerMeta && calleeMeta) {
      const callerOutMatchesCalleeIn = callerMeta.output_format === calleeMeta.input_format;
      const calleeOutMatchesCallerIn = calleeMeta.output_format === callerMeta.input_format;
      checks.push({
        id: "audio-formats",
        label: "Audio formats compatible between caller and callee",
        status: callerOutMatchesCalleeIn && calleeOutMatchesCallerIn ? "pass" : "fail",
        detail:
          callerOutMatchesCalleeIn && calleeOutMatchesCallerIn
            ? `${callerMeta.output_format} <-> ${calleeMeta.output_format}`
            : `Caller out=${callerMeta.output_format} / Callee in=${calleeMeta.input_format} ; Callee out=${calleeMeta.output_format} / Caller in=${callerMeta.input_format}. Set both agents' audio format to pcm_16000 in their dashboard.`,
      });
    }

    // 4. Overrides required by the scenario are enabled on the caller
    if (callerMeta) {
      const needsLanguage = true; // the app always forces the caller's language
      const needsFirstMessage = scenario.firstSpeaker === "caller";
      const needsVoice = Boolean(scenario.voiceId);
      const needsAsrKeywords = scenario.asrKeywords.length > 0;
      const needsMaxDuration = true;
      // A prompt_override scenario always overrides the full prompt -- there is no per-scenario
      // toggle for it the way a deterministic scenario's "expert mode" is optional.
      const needsPrompt = scenario.kind === "prompt_override" || Boolean(scenario.expertMode);

      const overrideChecks = [
        [needsLanguage, callerMeta.overrides_enabled.agent_language, "agent.language override must be enabled on the caller agent (Security tab)"],
        [needsFirstMessage, callerMeta.overrides_enabled.agent_first_message, "agent.first_message override must be enabled on the caller agent (Security tab)"],
        [needsVoice, callerMeta.overrides_enabled.tts_voice_id, "tts.voice_id override must be enabled on the caller agent (Security tab)"],
        [needsAsrKeywords, callerMeta.overrides_enabled.asr_keywords, "asr.keywords override must be enabled on the caller agent (Security tab)"],
        [needsMaxDuration, callerMeta.overrides_enabled.conversation_max_duration, "conversation.max_duration_seconds override must be enabled on the caller agent (Security tab)"],
        [needsPrompt, callerMeta.overrides_enabled.agent_prompt, "agent.prompt.prompt override must be enabled on the caller agent for expert mode (Security tab)"],
      ];
      for (const [needed, enabled, detail] of overrideChecks) {
        if (!needed) continue;
        checks.push({ id: `override-${detail.slice(0, 20)}`, label: detail, status: enabled ? "pass" : "fail", detail: enabled ? undefined : "Not enabled on the agent" });
      }

      checks.push({
        id: "caller-language-enabled",
        label: `Scenario language (${scenario.languageName}) enabled on caller agent`,
        status: callerMeta.language === scenario.language || (callerMeta.additional_languages || []).includes(scenario.language) ? "pass" : "warn",
        detail: "Add this language under the caller agent's Language settings if the call sounds wrong.",
      });

      // Both caller kinds are expected to hang up themselves: the deterministic caller once its
      // script is done, and a prompt_override caller once both sides have said goodbye (see
      // promptBuilder.js buildPromptOverrideText).
      checks.push({
        id: "caller-end-call",
        label: "end_call tool present on caller agent",
        status: callerMeta.has_end_call_tool === true ? "pass" : "warn",
        detail: callerMeta.has_end_call_tool === "unknown" ? "Could not verify from the API response -- check manually." : "Enable the end_call system tool so the caller hangs up cleanly.",
      });
    }

    // 5. Callee language override, only if the scenario requests one
    if (calleeMeta && scenario.calleeLanguageOverride) {
      checks.push({
        id: "override-callee-language",
        label: "agent.language override must be enabled on the callee agent",
        status: calleeMeta.overrides_enabled.agent_language ? "pass" : "fail",
        detail: calleeMeta.overrides_enabled.agent_language ? undefined : "Not enabled on the agent (Security tab)",
      });
    }

    // 6. Callee dynamic variables: every {{variable}} the agent declares must
    // resolve to a non-empty value from either the dashboard's own default,
    // the agent's hard-coded value, or this preset's override -- otherwise
    // the callee's prompt sees a literally empty/unsubstituted placeholder.
    if (calleeMeta) {
      const placeholders = calleeMeta.dynamic_variable_placeholders || {};
      const resolved = calleeDynamicVariables || {};
      const missing = Object.keys(placeholders).filter((name) => !placeholders[name] && !resolved[name]);
      const declaredCount = Object.keys(placeholders).length;
      if (missing.length > 0) {
        checks.push({
          id: "callee-dynamic-variables",
          label: `Callee agent dynamic variables: ${missing.length} required value${missing.length > 1 ? "s" : ""} missing`,
          status: "fail",
          detail: `No dashboard default and no value set for: ${missing.map((n) => `{{${n}}}`).join(", ")}. Set it on the agent (Settings → Agents) or override it on this preset (Settings → Presets).`,
        });
      } else if (declaredCount > 0) {
        checks.push({
          id: "callee-dynamic-variables",
          label: `Callee agent dynamic variables: all ${declaredCount} resolved`,
          status: "pass",
        });
      }
    }

    const blocked = checks.some((c) => c.status === "fail");
    return { checks, blocked, callerMeta, calleeMeta };
  }

  /**
   * Runs runPreflight for every scenario in a batch preset (same caller/callee pair, see
   * BatchSession.jsx). `resolveCalleeDynamicVariables(scenario)` lets each scenario in the batch
   * resolve its own callee dynamic variables (per-scenario override, falling back to the
   * preset's default -- see model/factory.js resolveCalleeDynamicVariables). Re-fetches agent
   * metadata once per scenario -- simple and correct, a bit redundant on a large batch, but
   * batches are expected to be a handful of scenarios.
   */
  async function runBatchPreflight({ api, accounts, callerAgent, calleeAgent, scenarios, resolveCalleeDynamicVariables }) {
    const results = await Promise.all(
      scenarios.map(async (scenario) => {
        const calleeDynamicVariables = resolveCalleeDynamicVariables(scenario);
        const result = await runPreflight({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables });
        return { scenario, ...result };
      }),
    );
    return { results, blocked: results.some((r) => r.blocked) };
  }

  window.AB.session.runPreflight = runPreflight;
  window.AB.session.runBatchPreflight = runBatchPreflight;
})();
