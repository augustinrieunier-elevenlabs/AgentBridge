/**
 * Orchestrates "test this recommendation" (see ui/RecommendationPanel.jsx): lets the user try the
 * per-node LLM picks from computeRecommendations against a real preset, before actually adopting
 * them on the agent for good. Exact sequence confirmed with the user 2026-10-05:
 *   1. Back up the callee's current Workflow.
 *   2. Run the given preset once, text-only (baseline -- today's actual config).
 *   3. Apply the chosen LLM to each selected override_agent node.
 *   4. Run the SAME preset again, text-only (test -- the recommended per-node config).
 *   5. Restore the callee's Workflow to what it was at step 1, regardless of what happened above.
 * Mirrors BenchmarkRunner.js runBenchmark's snapshot -> mutate -> run -> restore shape and reuses
 * its pending-restore safety net (same per-agent hazard as an interrupted benchmark -- see
 * session/PendingRestore.js) and its run/extract pipeline (runOneScenario,
 * fetchConversationWithMetrics, mergeExtracts, summarizeNodeStats) -- just driving a Workflow PATCH
 * instead of the 2-scalar-field one.
 *
 * Always text-only: this tests LLM/RAG routing and latency, which don't need real audio -- see
 * BenchmarkRunner.js's own top-of-file note on why text-only is strictly faster/cheaper whenever
 * TTS isn't the thing being varied.
 */
(function () {
  const { runOneScenario, fetchConversationWithMetrics, extractMetricsFromConversation, mergeExtracts, computeMinMaxAvg, summarizeNodeStats } = window.AB.session.BenchmarkRunner;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Runs every scenario in `scenarios` once, text-only, and aggregates the result into the same
   * { asr, perNode, scenarioRuns } shape a Benchmark variant carries -- so the comparison view can
   * reuse GlobalStatsTable/NodeCoverageMatrix/StackedLatencyChart unchanged. */
  async function runPresetOnce({ api, accounts, callerAgent, calleeAgent, scenarios, resolveCalleeDynamicVariables }) {
    const runs = await Promise.all(
      scenarios.map((scenario) =>
        runOneScenario({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables: resolveCalleeDynamicVariables(scenario), textOnly: true }),
      ),
    );
    const extracts = await Promise.all(
      runs.map(async (run) => {
        if (!run.calleeConversationId) return { asrTimes: [], perNode: {} };
        const raw = await fetchConversationWithMetrics(api, calleeAgent.accountId, run.calleeConversationId);
        return extractMetricsFromConversation(raw || {});
      }),
    );
    const merged = mergeExtracts(extracts);
    return {
      asr: computeMinMaxAvg(merged.asrTimes),
      perNode: summarizeNodeStats(merged.perNode),
      scenarioRuns: runs.map((r) => ({
        scenarioId: r.scenario.id,
        scenarioName: r.scenario.name,
        callerConversationId: r.callerConversationId,
        calleeConversationId: r.calleeConversationId,
        endReason: r.endReason,
      })),
    };
  }

  /**
   * `llmByNodeId`: { [nodeId]: llmName } -- every node the user confirmed in the per-node LLM form
   * (see ui/RecommendationPanel.jsx), already restricted to override_agent nodes there. `globalLlm`
   * (optional): a new value for the agent's own top-level conversation_config.agent.prompt.llm --
   * what the `start` node and every other node with no override actually runs on, distinct from any
   * override_agent node's own LLM. Added 2026-10-05 after the user noticed the per-node form had no
   * way to see or change this -- it's the one LLM slot every workflow has that ISN'T a node at all.
   * `onProgress({ phase })` fires at each step ("backing-up" | "baseline" | "applying" | "testing" |
   * "restoring"), mirroring BenchmarkRunner.js runBenchmark's onProgress shape.
   */
  async function runRecommendationTest({ api, accounts, callerAgent, calleeAgent, scenarios, resolveCalleeDynamicVariables, llmByNodeId, globalLlm, onProgress }) {
    if (onProgress) onProgress({ phase: "backing-up" });
    const [workflow, modelConfig] = await Promise.all([
      api.agents.getWorkflow(calleeAgent.accountId, calleeAgent.agentId),
      api.agents.getModelConfig(calleeAgent.accountId, calleeAgent.agentId),
    ]);
    // Same durability guarantee as runBenchmark's pending-restore: written BEFORE anything below
    // mutates the live agent, so an interrupted run still leaves a recoverable trail (see
    // session/PendingRestore.js -- kind: "workflow" is how BenchmarkSession.jsx/RecommendationPanel.jsx
    // tell this apart from a model-config snapshot left by an interrupted benchmark). modelConfig is
    // always captured, even if `globalLlm` isn't provided this run -- cheap, and keeps the restore
    // path identical regardless of what this particular run actually touches.
    await api.agents.savePendingRestore(calleeAgent.accountId, calleeAgent.agentId, { kind: "workflow", workflow, modelConfig });

    try {
      if (onProgress) onProgress({ phase: "baseline" });
      const baseline = await runPresetOnce({ api, accounts, callerAgent, calleeAgent, scenarios, resolveCalleeDynamicVariables });

      if (onProgress) onProgress({ phase: "applying" });
      await api.agents.setWorkflowNodeLlms(calleeAgent.accountId, calleeAgent.agentId, llmByNodeId);
      if (globalLlm) {
        await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, { llm: globalLlm });
      }
      await sleep(1500); // let the new config settle before dialing -- same pattern as runBenchmark

      if (onProgress) onProgress({ phase: "testing" });
      const tested = await runPresetOnce({ api, accounts, callerAgent, calleeAgent, scenarios, resolveCalleeDynamicVariables });

      return { baseline, tested };
    } finally {
      if (onProgress) onProgress({ phase: "restoring" });
      await api.agents.setWorkflow(calleeAgent.accountId, calleeAgent.agentId, workflow);
      await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, { llm: modelConfig.llm });
      // Only clear once both restores above actually succeeded -- if either throws, this line never
      // runs and the record correctly survives for later recovery (same rule as runBenchmark).
      await api.agents.clearPendingRestore(calleeAgent.accountId, calleeAgent.agentId);
    }
  }

  window.AB.session.RecommendationTest = { runRecommendationTest };
})();
