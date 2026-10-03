/**
 * Auto-persists every session/batch-preset run to the exports store the instant it ends, so the
 * History tab always has it -- no manual "Export" click needed. Benchmark runs are already
 * auto-saved by BenchmarkRunner.js/BenchmarkSession.jsx to their own store (benchmark_runs.json,
 * which also carries per-node latency stats and supports "Refresh stats") -- HistoryPanel.jsx
 * merges both stores for display rather than duplicating that data here.
 *
 * Every record shares the same top-level shape regardless of `runType` ("session" | "batch"), so
 * services/config_store.py's list_exports can read `runType`/`title`/`conversations` generically
 * for the History list, and a future analytics pass has one consistent place to pull conversation
 * ids from instead of a different shape per run type.
 */
(function () {
  function agentSummary(agent) {
    return agent ? { label: agent.label, accountId: agent.accountId, agentId: agent.agentId } : null;
  }

  /** One scenario's pair of conversation ids within a run -- the unit a future analytics pass
   * would fetch official transcripts/metrics for, via account id + conversation id. */
  function conversationEntry({ scenario, callerConversationId, calleeConversationId, endReason }) {
    return {
      scenarioId: scenario ? scenario.id : null,
      scenarioName: scenario ? scenario.name : null,
      callerConversationId: callerConversationId || null,
      calleeConversationId: calleeConversationId || null,
      endReason: endReason || null,
    };
  }

  async function saveRunHistory({ runType, title, presetId, presetName, callerAgent, calleeAgent, conversations, extra }) {
    // Best-effort snapshot of the callee's live LLM/TTS at the moment this run happened -- the same
    // shape a Benchmark variant carries (llm/tts_model_id), so a later global analytics pass can
    // group a session or batch run by config exactly like it already groups benchmark variants,
    // instead of every non-benchmark run being permanently unattributable to any config. Never
    // blocks the save: a run with no calleeConfig just lands in that view's "unknown config" bucket.
    let calleeConfig = null;
    if (calleeAgent) {
      try {
        calleeConfig = await window.AB.api.agents.getModelConfig(calleeAgent.accountId, calleeAgent.agentId);
      } catch (err) {
        console.error("Could not snapshot callee model config for history", err);
      }
    }

    const payload = {
      runType,
      title: title || runType,
      savedAt: new Date().toISOString(),
      presetId: presetId || null,
      presetName: presetName || null,
      caller: agentSummary(callerAgent),
      callee: agentSummary(calleeAgent),
      calleeConfig,
      conversations: conversations || [],
      ...(extra || {}),
    };
    try {
      await window.AB.api.exports.save(title || runType, payload);
    } catch (err) {
      // Never blocks the UI on a failed auto-save -- the live session already ended successfully;
      // losing the history record is a logged inconvenience, not a reason to show an error to the
      // operator mid/post-call.
      console.error(`Failed to auto-save ${runType} run to History`, err);
    }
  }

  window.AB.session.RunHistory = { conversationEntry, saveRunHistory };
})();
