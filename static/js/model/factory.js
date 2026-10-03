(function () {
  function makeId(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  function emptyAgentRef(role) {
    return {
      id: makeId("agent"),
      label: "",
      role: role || "both",
      accountId: "",
      agentId: "",
      // Only meaningful when role is "caller"/"both": which caller architecture this agent_id
      // is built for. "deterministic" = the scripted Caller Simulator (workflow, ordered
      // questions, caller_agent/). "prompt_override" = a free-form agent whose entire system
      // prompt is replaced per-session from a Scenario.promptOverride; it has no end_call tool,
      // so only the callee under test can hang up (see caller_agent_prompt_override/). A preset's
      // scenario picklist is restricted to scenarios of this same kind -- see
      // ui/settings/PresetsPanel.jsx.
      callerKind: "deterministic",
      // Hard values for this agent's own dynamic variables (role callee/both),
      // sent on every session unless a preset overrides them -- see
      // ui/settings/AgentsPanel.jsx and session/Bridge.js.
      dynamicVariables: {},
    };
  }

  /** Back-compat migration: agents saved before the prompt-override change (2026-10-02) have no
   * `callerKind`. Defaults to "deterministic", the only kind that existed before. */
  function normalizeAgentRef(agent) {
    return agent.callerKind ? agent : { ...agent, callerKind: "deterministic" };
  }

  function emptyScenario() {
    return {
      id: makeId("scenario"),
      kind: "deterministic",
      name: "New scenario",
      language: "en",
      languageName: "English",
      languageStyle: "neutral",
      personaName: "",
      personaDescription: "",
      callerMood: "calm",
      verbosity: "natural",
      calleeBusiness: "",
      context: "",
      callGoal: "",
      questions: [{ text: "", language: "en" }],
      personalDetails: "",
      behaviors: [],
      endGoal: "when all questions are answered",
      maxDurationSec: 180,
      firstSpeaker: "callee",
      asrKeywords: [],
    };
  }

  /**
   * A free-form scenario for a "prompt_override" caller: the entire system prompt is
   * `promptOverride`, written by hand or imported from an existing ElevenLabs test (see
   * ui/settings/ScenariosPanel.jsx "Import from ElevenLabs"). No persona/questions/behaviors --
   * that structure doesn't apply here, the prompt text carries everything. `successConditions`
   * is display-only (shown next to the transcript for a human to check -- there is no automated
   * judge in this app).
   */
  function emptyPromptOverrideScenario() {
    return {
      id: makeId("scenario"),
      kind: "prompt_override",
      name: "New prompt-override scenario",
      language: "en",
      languageName: "English",
      promptOverride: "",
      successConditions: [],
      maxDurationSec: 180,
      firstSpeaker: "callee",
      openingLine: "",
      asrKeywords: [],
    };
  }

  /**
   * Back-compat migration: scenarios saved before 2026-10-01 store `questions` as plain strings,
   * and scenarios saved before the prompt-override change (2026-10-02) have no `kind`. Normalizes
   * both to the current shape. The `questions` migration only applies to deterministic scenarios.
   */
  function normalizeScenario(scenario) {
    const kind = scenario.kind || "deterministic";
    if (kind !== "deterministic") return { ...scenario, kind };
    return {
      ...scenario,
      kind,
      questions: (scenario.questions || []).map((q) => (typeof q === "string" ? { text: q, language: scenario.language } : q)),
    };
  }

  /** Deep-copies a scenario under a fresh id, so editing the clone never mutates the original's
   * nested arrays/lists (questions, behaviors, asrKeywords, successConditions). */
  function cloneScenario(scenario) {
    const clone = { ...scenario, id: makeId("scenario"), name: `${scenario.name} (copy)` };
    if (clone.questions) clone.questions = clone.questions.map((q) => ({ ...q }));
    if (clone.behaviors) clone.behaviors = [...clone.behaviors];
    if (clone.asrKeywords) clone.asrKeywords = [...clone.asrKeywords];
    if (clone.successConditions) clone.successConditions = [...clone.successConditions];
    return clone;
  }

  function emptyPreset() {
    return {
      id: makeId("preset"),
      name: "New preset",
      callerAgentRefId: "",
      calleeAgentRefId: "",
      // One caller/callee pair, N scenarios to run against it. A single scenario behaves exactly
      // like the old one-scenario preset; more than one makes this a batch preset (see
      // ui/BatchSession.jsx) -- all runs share this same agent pair.
      scenarioIds: [],
      // Per-preset DEFAULT overrides of the callee agent's dynamic variables -- used for any
      // scenario in this preset that doesn't have its own entry below. Takes precedence over
      // AgentRef.dynamicVariables; see resolveCalleeDynamicVariables.
      calleeDynamicVariableOverrides: {},
      // Per-scenario overrides, keyed by scenario id: { [scenarioId]: { [varName]: value } }.
      // Highest precedence -- lets a batch preset send a different value (e.g. a different
      // customer record id) to the callee for each scenario it runs.
      calleeDynamicVariableOverridesByScenario: {},
    };
  }

  /** Back-compat migration: presets saved before the batch-preset change (2026-10-02) store a
   * single `scenarioId` and have no per-scenario override map. Normalizes both to the current
   * shape. */
  function normalizePreset(preset) {
    const scenarioIds = Array.isArray(preset.scenarioIds) ? preset.scenarioIds : preset.scenarioId ? [preset.scenarioId] : [];
    const { scenarioId, ...rest } = preset;
    return {
      ...rest,
      scenarioIds,
      calleeDynamicVariableOverridesByScenario: preset.calleeDynamicVariableOverridesByScenario || {},
    };
  }

  /** Deep-copies a preset under a fresh id, so editing the clone never mutates the original's
   * nested arrays/maps (scenarioIds, the two dynamic-variable-override maps -- including each
   * per-scenario override object, not just the outer map). */
  function clonePreset(preset) {
    const clone = { ...preset, id: makeId("preset"), name: `${preset.name} (copy)` };
    clone.scenarioIds = [...(preset.scenarioIds || [])];
    clone.calleeDynamicVariableOverrides = { ...(preset.calleeDynamicVariableOverrides || {}) };
    clone.calleeDynamicVariableOverridesByScenario = Object.fromEntries(
      Object.entries(preset.calleeDynamicVariableOverridesByScenario || {}).map(([scenarioId, overrides]) => [scenarioId, { ...overrides }]),
    );
    return clone;
  }

  /**
   * Resolves the callee dynamic variables actually sent for one scenario run of a preset, in
   * increasing order of precedence: the callee AgentRef's own hard-coded values, then the
   * preset's default override, then that scenario's own override within the preset.
   */
  function resolveCalleeDynamicVariables(calleeAgent, preset, scenarioId) {
    return {
      ...((calleeAgent && calleeAgent.dynamicVariables) || {}),
      ...((preset && preset.calleeDynamicVariableOverrides) || {}),
      ...((preset && preset.calleeDynamicVariableOverridesByScenario && preset.calleeDynamicVariableOverridesByScenario[scenarioId]) || {}),
    };
  }

  /**
   * The 4 TTS model families the Benchmark feature can vary, with their real
   * conversation_config.tts.model_id (confirmed via GET /v1/models on the sandbox account,
   * 2026-10-02). LLM choices aren't a fixed list like this one -- they're fetched live from
   * GET /v1/convai/llm/list (api.agents.listLlms) since the catalog changes over time.
   */
  const TTS_MODEL_VARIANTS = [
    { id: "eleven_v4_turbo", label: "V4 Turbo" },
    { id: "eleven_v4", label: "V4" },
    { id: "eleven_v3_conversational", label: "V3 Conversational" },
    { id: "eleven_flash_v2_5", label: "Flash" },
  ];

  /**
   * A Benchmark compares the callee agent's latency across TTS/LLM config variants (spec: see
   * README discussion 2026-10-02). Shares its caller/callee/scenario shape with Preset (same
   * kind-based scenario restriction applies, via callerAgent.callerKind) and adds the two variant
   * axes: every selected TTS id × every selected LLM name is one configuration to test (cross
   * product, confirmed with the user) -- if one axis is empty, the callee's current value for
   * that axis is kept fixed instead of being varied. Actually running a benchmark and its results
   * are handled by session/BenchmarkRunner.js and persisted server-side (benchmark_runs.json),
   * never in this config object.
   *
   * calleeDynamicVariableOverrides(ByScenario) mirror Preset's fields of the same name exactly
   * (same shape, same precedence in resolveCalleeDynamicVariables) -- a benchmark run needs its own
   * copy because a scenario that requires a specific callee dynamic variable (e.g. an authenticated
   * customer_name/salesforce_record_id) would otherwise only get it when launched from a Preset,
   * never from a Benchmark. Missing this was a real bug (found 2026-10-02): a benchmark run on the
   * "Get Account Details" scenario sent none of its required variables, breaking that conversation.
   */
  function emptyBenchmark() {
    return {
      id: makeId("benchmark"),
      name: "New benchmark",
      callerAgentRefId: "",
      calleeAgentRefId: "",
      scenarioIds: [],
      ttsVariantIds: [],
      llmVariantIds: [],
      calleeDynamicVariableOverrides: {},
      calleeDynamicVariableOverridesByScenario: {},
    };
  }

  function cloneBenchmark(benchmark) {
    const clone = { ...benchmark, id: makeId("benchmark"), name: `${benchmark.name} (copy)` };
    clone.scenarioIds = [...(benchmark.scenarioIds || [])];
    clone.ttsVariantIds = [...(benchmark.ttsVariantIds || [])];
    clone.llmVariantIds = [...(benchmark.llmVariantIds || [])];
    clone.calleeDynamicVariableOverrides = { ...(benchmark.calleeDynamicVariableOverrides || {}) };
    clone.calleeDynamicVariableOverridesByScenario = Object.fromEntries(
      Object.entries(benchmark.calleeDynamicVariableOverridesByScenario || {}).map(([scenarioId, overrides]) => [scenarioId, { ...overrides }]),
    );
    return clone;
  }

  /** Defensive normalization for a benchmark loaded from an older/partial config.json -- also
   * backfills calleeDynamicVariableOverrides(ByScenario) for benchmarks saved before 2026-10-02,
   * which predate that fix (see emptyBenchmark). */
  function normalizeBenchmark(benchmark) {
    return {
      ...benchmark,
      scenarioIds: benchmark.scenarioIds || [],
      ttsVariantIds: benchmark.ttsVariantIds || [],
      llmVariantIds: benchmark.llmVariantIds || [],
      calleeDynamicVariableOverrides: benchmark.calleeDynamicVariableOverrides || {},
      calleeDynamicVariableOverridesByScenario: benchmark.calleeDynamicVariableOverridesByScenario || {},
    };
  }

  window.AB.model.makeId = makeId;
  window.AB.model.emptyAgentRef = emptyAgentRef;
  window.AB.model.normalizeAgentRef = normalizeAgentRef;
  window.AB.model.emptyScenario = emptyScenario;
  window.AB.model.emptyPromptOverrideScenario = emptyPromptOverrideScenario;
  window.AB.model.normalizeScenario = normalizeScenario;
  window.AB.model.cloneScenario = cloneScenario;
  window.AB.model.emptyPreset = emptyPreset;
  window.AB.model.clonePreset = clonePreset;
  window.AB.model.normalizePreset = normalizePreset;
  window.AB.model.resolveCalleeDynamicVariables = resolveCalleeDynamicVariables;
  window.AB.model.TTS_MODEL_VARIANTS = TTS_MODEL_VARIANTS;
  window.AB.model.emptyBenchmark = emptyBenchmark;
  window.AB.model.cloneBenchmark = cloneBenchmark;
  window.AB.model.normalizeBenchmark = normalizeBenchmark;
})();
