/**
 * Orchestrates a Benchmark run (see ui/settings/BenchmarksPanel.jsx and model/factory.js
 * emptyBenchmark): snapshot the callee's current TTS/LLM config, then for every selected
 * TTS × LLM combination (cross product -- confirmed with the user 2026-10-02), apply it to the
 * live callee agent, run every selected scenario once against it, fetch each
 * run's conversation record back from the callee's own account (that's the side carrying the
 * timing data) and aggregate LLM/TTS/RAG latency per node (`perNode`, by workflow_node_id -- see
 * summarizeNodeStats). An "all nodes combined" global view is NOT stored separately -- it's derived
 * from `perNode` at display time (see combineNodeStats) so it's always correct, including for a run
 * saved before that view existed. Restores the callee's original config in a `finally`, even if a
 * run fails partway through.
 *
 * Every scenario run's full Bridge debug log and per-second metrics (queue depths, pacer underrun
 * counts, websocket close/error events) are posted to the backend (api.debugLogs.save) the moment
 * that run ends, success or not -- see runOneScenario/runBenchmark below. This exists because this
 * data otherwise only ever lives in the browser's memory for the duration of the run: once a
 * benchmark moves on to the next variant (or the tab is closed), there is nothing left to diagnose
 * a mid-call cutoff with. Added 2026-10-04 after exactly that: audio benchmark calls cutting off
 * mid-conversation with no trace anywhere of why.
 *

 * Metric field mapping, confirmed against real conversation_turn_metrics from this session's
 * cached conversations (2026-10-02):
 *   - ASR time (global, not per-node, per spec): conversation_turn_metrics.metrics
 *     .convai_asr_trailing_service_latency.elapsed_time, found on role:"user" transcript items
 *     (= the caller's turns, as seen from the callee's own conversation record).
 *   - LLM time per node: ...metrics.convai_llm_service_ttfb.elapsed_time, on role:"agent" items,
 *     grouped by agent_metadata.workflow_node_id.
 *   - TTS time per node: ...metrics.convai_tts_service_ttfb.elapsed_time, same grouping.
 *   - RAG time per node: rag_retrieval_info.rag_latency_secs, same grouping -- only present on
 *     turns that actually triggered a knowledge-base lookup, so it's sparse/absent for callees
 *     with no knowledge base (reported as null, not 0).
 *
 * `textOnly` normally defaults to false: ASR/TTS timing only exists when real audio actually ran
 * the ASR/TTS pipeline, so a benchmark comparing TTS model families always needs it. The one
 * exception is a benchmark that only varies the LLM (no TTS variant selected) -- there, audio adds
 * cost and time without adding signal, so BenchmarkSession.jsx offers a "Text only" toggle that
 * passes textOnly: true through to every run. ASR/TTS simply come back empty/"n/a" in that mode
 * (no audio pipeline ran, so those metrics were never produced) while LLM/RAG are unaffected --
 * handled by the existing null-stat rendering, no special-casing needed here.
 */
(function () {
  // A scenario run's endReason that means "the conversation ran its course and both sides hung up
  // normally" -- anything else (deadlock_timeout, max_duration_reached, a start_failed:... string)
  // means it was cut short by something other than the scenario script finishing. Shared by
  // ui/BenchmarkAnalyticsViews.jsx's NodeCoverageMatrix ("thin" node detection) and
  // session/GlobalAnalytics.js's computeRecommendations (success-rate scoring) -- single source of
  // truth so "what counts as a successful run" can't drift between the two.
  const NORMAL_END_REASONS = new Set(["caller_websocket_closed", "callee_websocket_closed"]);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Cross product of the benchmark's selected TTS ids and LLM names. An empty axis means "leave
   * the callee's current value alone" -- see the long comment in runBenchmark about why this never
   * carries over a previous variant's mutation when an axis is untouched for the whole run. */
  function buildVariantMatrix(benchmark) {
    const ttsIds = benchmark.ttsVariantIds.length ? benchmark.ttsVariantIds : [null];
    const llms = benchmark.llmVariantIds.length ? benchmark.llmVariantIds : [null];
    const variants = [];
    for (const ttsModelId of ttsIds) {
      for (const llm of llms) {
        if (ttsModelId === null && llm === null) continue; // nothing selected on either axis
        const ttsLabel = ttsModelId ? ((window.AB.model.TTS_MODEL_VARIANTS.find((v) => v.id === ttsModelId) || {}).label || ttsModelId) : null;
        variants.push({
          id: `v${variants.length}`,
          ttsModelId,
          llm,
          label: [ttsLabel, llm].filter(Boolean).join(" + "),
        });
      }
    }
    return variants;
  }

  /** Runs one scenario to completion and resolves with its two conversation ids. `textOnly` is
   * normally false (ASR/TTS timing needs real audio) -- the one exception is a benchmark that
   * varies only the LLM (no TTS variant selected), where audio brings no extra signal and
   * text-only is strictly faster/cheaper. See BenchmarkSession.jsx, which is the only caller that
   * ever passes textOnly: true, and only once it has confirmed the benchmark isn't testing TTS. */
  function runOneScenario({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables, onStatus, textOnly }) {
    return new Promise((resolve) => {
      let callerConversationId = null;
      let calleeConversationId = null;
      // Collected verbatim and handed back to the caller regardless of outcome -- the ONLY record
      // of a mid-call cutoff once this bridge is torn down, since Bridge's debug log/metrics
      // otherwise only ever live in this closure's memory. See runBenchmark, which posts this to
      // the backend (api.debugLogs.save) right after this promise resolves.
      const debugLog = [];
      const metricsLog = [];
      const startedAt = new Date().toISOString();
      const bridge = new window.AB.session.Bridge({
        onStatusChange: (s) => onStatus && onStatus(s),
        onTranscriptUpdate: () => {},
        onDebugLog: (entry) => debugLog.push(entry),
        onMetrics: (m) => metricsLog.push({ at: Date.now(), ...m }),
        // The interactive Session screen only ever SURFACES a deadlock (silence past
        // Bridge.js's DEADLOCK_SILENCE_MS) as a banner for a human to act on with a manual
        // nudge/hangup -- correct there, but a benchmark run is unattended, so the same signal
        // must instead end the run outright. Confirmed via both sides' own conversation records
        // (2026-10-03): a run can stall with the CALLEE's own workflow never producing another
        // turn after a tool call (independent of anything the bridge relayed to it) and just sit
        // there for the scenario's full max_duration_seconds -- which, run sequentially across
        // every variant in a benchmark, can block the whole thing for minutes and previously
        // required navigating away from the app to recover. Ending here bounds that to roughly
        // DEADLOCK_SILENCE_MS instead, and the scenarioRuns record keeps "deadlock_timeout" as
        // this run's endReason so it's visible in the saved results, not silently indistinguishable
        // from a clean end.
        onDeadlock: () => bridge.end("deadlock_timeout"),
        onVadScore: () => {},
        onConversationIds: (callerId, calleeId) => {
          callerConversationId = callerId;
          calleeConversationId = calleeId;
        },
        onEnded: (reason) =>
          resolve({ scenario, callerConversationId, calleeConversationId, endReason: reason, debugLog, metricsLog, startedAt, endedAt: new Date().toISOString() }),
      });
      bridge
        .start({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables, textOnly: Boolean(textOnly) })
        .catch((err) =>
          resolve({
            scenario,
            callerConversationId,
            calleeConversationId,
            endReason: `start_failed: ${err.message}`,
            debugLog,
            metricsLog,
            startedAt,
            endedAt: new Date().toISOString(),
          }),
        );
    });
  }

  /** The platform finalizes conversation_turn_metrics shortly after a call ends, not instantly --
   * poll a few times before giving up and aggregating whatever came back (partial data beats none). */
  async function fetchConversationWithMetrics(api, accountId, conversationId, { retries = 5, delayMs = 2000 } = {}) {
    if (!conversationId) return null;
    let raw = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      const result = await api.session.fetchFinalTranscript(accountId, conversationId);
      raw = result.raw || {};
      const hasMetrics = (raw.transcript || []).some((t) => t.conversation_turn_metrics);
      if (hasMetrics) return raw;
      if (attempt < retries - 1) await sleep(delayMs);
    }
    return raw;
  }

  function extractMetricsFromConversation(raw) {
    const asrTimes = [];
    const perNode = {};

    for (const item of raw.transcript || []) {
      const metrics = (item.conversation_turn_metrics && item.conversation_turn_metrics.metrics) || {};

      if (item.role === "user") {
        const asr = metrics.convai_asr_trailing_service_latency;
        if (asr && typeof asr.elapsed_time === "number") asrTimes.push(asr.elapsed_time);
        continue;
      }

      if (item.role !== "agent") continue;
      const nodeId = item.agent_metadata && item.agent_metadata.workflow_node_id;
      if (!nodeId) continue;
      if (!perNode[nodeId]) perNode[nodeId] = { turnCount: 0, llmTtfb: [], ttsTtfb: [], ragLatency: [] };
      // Counts every agent turn attributed to this node, independent of whether any metric below
      // actually has a value -- this is what lets the UI tell "this variant never routed here" (no
      // entry at all for this node) apart from "it did route here, but no timing landed on these
      // turns" (an entry with turnCount > 0 and a null stat -- see ui/BenchmarkSession.jsx StatCell).
      perNode[nodeId].turnCount += 1;

      const llm = metrics.convai_llm_service_ttfb;
      if (llm && typeof llm.elapsed_time === "number") perNode[nodeId].llmTtfb.push(llm.elapsed_time);

      const tts = metrics.convai_tts_service_ttfb;
      if (tts && typeof tts.elapsed_time === "number") perNode[nodeId].ttsTtfb.push(tts.elapsed_time);

      const rag = item.rag_retrieval_info;
      if (rag && typeof rag.rag_latency_secs === "number") perNode[nodeId].ragLatency.push(rag.rag_latency_secs);
    }

    return { asrTimes, perNode };
  }

  /** Combines the per-scenario extracts of one variant into one set of samples per node --
   * running N scenarios against the same variant gives more samples per node than a single pass,
   * even though the spec only asks for one pass per scenario per variant. */
  function mergeExtracts(extracts) {
    const asrTimes = [];
    const perNode = {};
    for (const e of extracts) {
      asrTimes.push(...e.asrTimes);
      for (const [nodeId, stats] of Object.entries(e.perNode)) {
        if (!perNode[nodeId]) perNode[nodeId] = { turnCount: 0, llmTtfb: [], ttsTtfb: [], ragLatency: [] };
        perNode[nodeId].turnCount += stats.turnCount;
        perNode[nodeId].llmTtfb.push(...stats.llmTtfb);
        perNode[nodeId].ttsTtfb.push(...stats.ttsTtfb);
        perNode[nodeId].ragLatency.push(...stats.ragLatency);
      }
    }
    return { asrTimes, perNode };
  }

  function computeMinMaxAvg(values) {
    if (!values || values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { min, max, avg, n: values.length };
  }

  function summarizeNodeStats(perNode) {
    const summary = {};
    for (const [nodeId, stats] of Object.entries(perNode)) {
      summary[nodeId] = {
        turnCount: stats.turnCount,
        llm: computeMinMaxAvg(stats.llmTtfb),
        tts: computeMinMaxAvg(stats.ttsTtfb),
        rag: computeMinMaxAvg(stats.ragLatency),
      };
    }
    return summary;
  }

  /**
   * The "all nodes combined" global view of one metric (llm/tts/rag) for a variant, derived from
   * its already-computed PER-NODE `{min, max, avg, n}` -- not from raw samples. This is exact, not
   * an approximation: avg_i * n_i recovers that node's sum exactly, so summing those and dividing
   * by the total n is the same number pooling every raw sample directly would give; the global min
   * is the min of the per-node mins, the global max is the max of the per-node maxes. A node a
   * variant never visited simply has no entry in `perNode` and contributes nothing -- exactly
   * right, since it was never sampled.
   *
   * Computing this at display time off `perNode` (ui/BenchmarkSession.jsx GlobalStatsTable /
   * StackedLatencyChart), rather than storing a separate precomputed field, is a deliberate fix: a
   * stored field was only ever correct as of whichever run/refresh computed it, so a benchmark run
   * saved before this existed showed "n/a" here forever until manually refreshed -- a bug, since
   * `perNode` already had everything needed to answer it correctly the whole time.
   */
  function combineNodeStats(perNode, metric) {
    let n = 0;
    let weightedSum = 0;
    let min = null;
    let max = null;
    for (const nodeStats of Object.values(perNode || {})) {
      const s = nodeStats && nodeStats[metric];
      if (!s) continue;
      n += s.n;
      weightedSum += s.avg * s.n;
      min = min === null ? s.min : Math.min(min, s.min);
      max = max === null ? s.max : Math.max(max, s.max);
    }
    return n === 0 ? null : { min, max, avg: weightedSum / n, n };
  }

  /**
   * Runs the whole benchmark: snapshot -> for each variant (sequential, since they all mutate the
   * same live callee agent) apply it, run every scenario in parallel, collect + aggregate -> restore
   * the snapshot. `onProgress({ phase, variant, variants })` fires at each step for the UI
   * (phase: "applying" | "running" | "collecting" | "restoring"). `textOnly` defaults to falsy
   * (real audio) -- BenchmarkSession.jsx only ever passes true once it has confirmed the benchmark
   * isn't testing TTS (see the top-of-file note on textOnly).
   */
  async function runBenchmark({ api, accounts, callerAgent, calleeAgent, scenarios, resolveCalleeDynamicVariables, benchmark, onProgress, textOnly }) {
    const variants = buildVariantMatrix(benchmark);
    if (variants.length === 0) throw new Error("Select at least one TTS or LLM variant to benchmark.");
    if (scenarios.length === 0) throw new Error("Select at least one scenario to benchmark.");

    const [snapshot, nodeNames] = await Promise.all([
      api.agents.getModelConfig(calleeAgent.accountId, calleeAgent.agentId),
      // Workflow node id -> {label, type}, saved alongside this run (see BenchmarkSession.jsx's
      // save call) so NodeCoverageMatrix/ResultsTables can show readable node names without ever
      // needing a live API call for a run saved after this existed -- see GlobalAnalytics.js
      // resolveNodeNames for how an OLDER run/export without this gets backfilled on first view.
      api.agents.getWorkflowNodes(calleeAgent.accountId, calleeAgent.agentId).catch((err) => {
        console.error("Could not fetch workflow node names for this benchmark run", err);
        return null;
      }),
    ]);
    // Durably records "this callee agent needs restoring to `snapshot`" BEFORE anything below
    // mutates it -- not just an in-memory variable here. If this run is interrupted (the page
    // navigated away, a crash) before the `finally` below runs, this record survives independently
    // and is the only thing that can tell a LATER run (or a human) what the agent's config was
    // before this run touched it. Without this (confirmed 2026-10-03 on a real agent): an
    // interrupted run leaves the agent on whatever variant was active, the NEXT run's own snapshot
    // silently captures that already-broken state as if it were correct, and the corruption
    // propagates forward through every run's restore from then on -- nothing short of manually
    // querying the agent's live config and every past run's recorded snapshot ever reveals it. See
    // BenchmarkSession.jsx's startup check, which looks for exactly this record. `kind:
    // "model-config"` lets session/PendingRestore.js tell this apart from a
    // RecommendationTest.js Workflow snapshot -- same per-agent record, two possible shapes.
    await api.agents.savePendingRestore(calleeAgent.accountId, calleeAgent.agentId, { ...snapshot, kind: "model-config" });
    const variantResults = [];

    try {
      for (const variant of variants) {
        if (onProgress) onProgress({ phase: "applying", variant, variants });
        await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, {
          tts_model_id: variant.ttsModelId || undefined,
          llm: variant.llm || undefined,
        });
        await sleep(1500); // let the new config settle before dialing

        if (onProgress) onProgress({ phase: "running", variant, variants });
        const runs = await Promise.all(
          scenarios.map((scenario) =>
            runOneScenario({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables: resolveCalleeDynamicVariables(scenario), textOnly }),
          ),
        );

        // Persist full debug telemetry for EVERY run in this variant, regardless of outcome, before
        // doing anything else with the results -- the only way to diagnose a mid-call cutoff after
        // the fact (2026-10-04 incident: audio benchmark calls cutting off mid-conversation with
        // nothing anywhere to explain why). Best-effort: a failed save here must never abort the
        // benchmark itself, the run's actual results matter more than its own debug trail.
        await Promise.all(
          runs.map((r) =>
            api.debugLogs
              .save({
                benchmarkId: benchmark.id,
                benchmarkName: benchmark.name,
                variantId: variant.id,
                variantLabel: variant.label,
                scenarioId: r.scenario.id,
                scenarioName: r.scenario.name,
                textOnly: Boolean(textOnly),
                callerAccountId: callerAgent.accountId,
                callerAgentId: callerAgent.agentId,
                calleeAccountId: calleeAgent.accountId,
                calleeAgentId: calleeAgent.agentId,
                callerConversationId: r.callerConversationId,
                calleeConversationId: r.calleeConversationId,
                endReason: r.endReason,
                startedAt: r.startedAt,
                endedAt: r.endedAt,
                debugLog: r.debugLog,
                metricsLog: r.metricsLog,
              })
              .catch((err) => console.error("Failed to save debug log for scenario run", r.scenario.name, err)),
          ),
        );

        if (onProgress) onProgress({ phase: "collecting", variant, variants });
        const extracts = await Promise.all(
          runs.map(async (run) => {
            if (!run.calleeConversationId) return { asrTimes: [], perNode: {} };
            const raw = await fetchConversationWithMetrics(api, calleeAgent.accountId, run.calleeConversationId);
            return extractMetricsFromConversation(raw || {});
          }),
        );
        const merged = mergeExtracts(extracts);

        variantResults.push({
          variantId: variant.id,
          ttsModelId: variant.ttsModelId,
          llm: variant.llm,
          label: variant.label || "default",
          asr: computeMinMaxAvg(merged.asrTimes),
          perNode: summarizeNodeStats(merged.perNode),
          scenarioRuns: runs.map((r) => ({
            scenarioId: r.scenario.id,
            scenarioName: r.scenario.name,
            callerConversationId: r.callerConversationId,
            calleeConversationId: r.calleeConversationId,
            endReason: r.endReason,
          })),
        });
      }
    } finally {
      if (onProgress) onProgress({ phase: "restoring", variants });
      await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, snapshot);
      // Only clear the pending-restore record once the restore above has actually succeeded (if
      // setModelConfig throws, this line never runs, and the record correctly survives for later
      // recovery) -- never clear it speculatively just because this function is wrapping up.
      await api.agents.clearPendingRestore(calleeAgent.accountId, calleeAgent.agentId);
    }

    return { snapshot, variants: variantResults, nodeNames };
  }

  /**
   * Re-fetches and re-aggregates the conversations of an already-saved run, without re-running any
   * calls. The platform doesn't always finish finalizing conversation_turn_metrics within the short
   * retry window runBenchmark's own live collection step uses, so a saved run can have thin or
   * missing stats for a node even though the data exists now -- this lets the "Refresh stats"
   * button in BenchmarkSession.jsx pull it in later, as many times as needed. Every variant's
   * scenarioRuns already recorded the callee conversation ids (see runBenchmark) -- that's all this
   * needs; no live agent/scenario config is touched.
   */
  async function refreshRunStats({ api, calleeAgent, run }) {
    return Promise.all(
      (run.variants || []).map(async (variant) => {
        const extracts = await Promise.all(
          (variant.scenarioRuns || []).map(async (scenarioRun) => {
            if (!scenarioRun.calleeConversationId) return { asrTimes: [], perNode: {} };
            const raw = await fetchConversationWithMetrics(api, calleeAgent.accountId, scenarioRun.calleeConversationId, { retries: 2, delayMs: 1500 });
            return extractMetricsFromConversation(raw || {});
          }),
        );
        const merged = mergeExtracts(extracts);
        return { ...variant, asr: computeMinMaxAvg(merged.asrTimes), perNode: summarizeNodeStats(merged.perNode) };
      }),
    );
  }

  window.AB.session.BenchmarkRunner = {
    buildVariantMatrix,
    runBenchmark,
    refreshRunStats,
    computeMinMaxAvg,
    combineNodeStats,
    NORMAL_END_REASONS,
    // Exported for session/GlobalAnalytics.js, which reuses the exact same extraction/aggregation
    // pipeline to harmonize session/batch/benchmark history by (llm, tts) config instead of by
    // benchmark-defined variant -- see that file for why it always re-extracts from the raw
    // conversation rather than trusting any run's pre-stored perNode/asr.
    fetchConversationWithMetrics,
    extractMetricsFromConversation,
    mergeExtracts,
    summarizeNodeStats,
    // Exported for session/RecommendationTest.js, which runs a preset's scenarios once in
    // text-only mode the same way a benchmark variant does, just without the TTS/LLM sweep around
    // it.
    runOneScenario,
  };
})();
