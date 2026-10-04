/**
 * Shared handling for api.agents.*PendingRestore -- the durable "this callee agent still needs
 * restoring to X" record any feature that snapshots-then-mutates a live callee agent writes BEFORE
 * mutating it (see BenchmarkRunner.js runBenchmark's pending-restore comment for the original
 * incident this guards against: an interrupted run leaving the agent stuck on a broken config with
 * nothing on screen to show it).
 *
 * Two features now write this same per-agent record (keyed account:agent, one record win -- the
 * platform only has one live config per agent, so only one mutation can be "pending" at a time):
 *   - BenchmarkRunner.js runBenchmark -- snapshots/restores the two scalar fields
 *     (conversation_config.tts.model_id / agent.prompt.llm), kind: "model-config".
 *   - session/RecommendationTest.js -- snapshots/restores the agent's ENTIRE Workflow (to test a
 *     per-node LLM recommendation, see ui/RecommendationPanel.jsx), kind: "workflow".
 * Both ui/BenchmarkSession.jsx and ui/RecommendationPanel.jsx check for and can resolve EITHER kind
 * left behind by the other feature against the same agent -- there's only one hazard per agent, not
 * one per feature, so whichever screen the user has open next needs to be able to clear it.
 *
 * `kind` defaults to "model-config" for a record saved before this file existed (every benchmark
 * pending-restore from before 2026-10-05) -- preserves their existing restore behavior exactly.
 */
(function () {
  async function restorePendingConfig(api, calleeAgent, pendingRestore) {
    if (pendingRestore.kind === "workflow") {
      await api.agents.setWorkflow(calleeAgent.accountId, calleeAgent.agentId, pendingRestore.workflow);
      // modelConfig may be absent on a record saved before RecommendationTest.js started also
      // snapshotting the agent's top-level LLM (2026-10-05) -- only restore it when present.
      if (pendingRestore.modelConfig) {
        await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, { llm: pendingRestore.modelConfig.llm });
      }
    } else {
      await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, pendingRestore);
    }
    await api.agents.clearPendingRestore(calleeAgent.accountId, calleeAgent.agentId);
  }

  function describePendingRestore(pendingRestore) {
    if (pendingRestore.kind === "workflow") {
      return "its per-node LLM Workflow configuration (and possibly its global default LLM) -- left mid-change by an interrupted recommendation test";
    }
    return `llm=${pendingRestore.llm || "(unchanged)"}${pendingRestore.tts_model_id ? `, tts=${pendingRestore.tts_model_id}` : ""}`;
  }

  window.AB.session.PendingRestore = { restorePendingConfig, describePendingRestore };
})();
