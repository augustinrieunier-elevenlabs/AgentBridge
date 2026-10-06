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
  function runOneScenario({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables, onStatus, textOnly, noiseProfile, onBridgeCreated, voiceTable }) {
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
      // Handed out before .start() so the caller (BenchmarkSession.jsx's mute toggle) can apply an
      // already-muted state immediately -- a benchmark runs every scenario unattended and in
      // parallel, so there's no moment where muting a freshly created bridge "late" would be safe.
      if (onBridgeCreated) onBridgeCreated(bridge);
      bridge
        .start({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables, textOnly: Boolean(textOnly), noiseProfile, voiceTable })
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

  /** Sums every model's committed (not retried/discarded) token usage for the whole conversation,
   * straight from the platform's own billing aggregate (metadata.charging.llm_usage) -- not
   * recomputed by summing each turn's own llm_usage, which would double as much code for the same
   * number the platform already computed once, authoritatively. `irreversible_generation` (not
   * `initiated_generation`) specifically to count tokens that were actually kept, not ones a retried
   * generation discarded -- the honest "what did this conversation actually cost" figure. Null (not
   * 0) when the conversation never recorded this at all, so it reads as "unknown" rather than "zero
   * tokens used" in computeMinMaxAvg/StatCell. */
  function sumConversationTokens(raw) {
    const modelUsage = raw.metadata && raw.metadata.charging && raw.metadata.charging.llm_usage && raw.metadata.charging.llm_usage.irreversible_generation
      && raw.metadata.charging.llm_usage.irreversible_generation.model_usage;
    if (!modelUsage) return null;
    let total = 0;
    for (const usage of Object.values(modelUsage)) {
      total += (usage.input && usage.input.tokens) || 0;
      total += (usage.input_cache_read && usage.input_cache_read.tokens) || 0;
      total += (usage.input_cache_write && usage.input_cache_write.tokens) || 0;
      total += (usage.output_total && usage.output_total.tokens) || 0;
    }
    return total;
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

    // Conversation-level (not per-node) signals of a model's efficiency/verbosity, confirmed with
    // the user 2026-10-06: a model that needs more back-and-forth or more tokens to get through the
    // same scenario is a real finding, independent of (and often a leading indicator for) its raw
    // latency numbers above. turnCount counts "agent" role turns the same way perNode does, just
    // without grouping by node -- the whole conversation's total, not per-node.
    const turnCount = (raw.transcript || []).filter((t) => t.role === "agent").length;
    const durationSecs = raw.metadata && typeof raw.metadata.call_duration_secs === "number" ? raw.metadata.call_duration_secs : null;
    const totalTokens = raw.metadata ? sumConversationTokens(raw) : null;

    return { asrTimes, perNode, turnCount, durationSecs, totalTokens };
  }

  /** Combines the per-scenario extracts of one variant into one set of samples per node --
   * running N scenarios against the same variant gives more samples per node than a single pass,
   * even though the spec only asks for one pass per scenario per variant. turnCounts/durationsSecs/
   * totalTokensList are one entry per CONVERSATION (not per-turn, unlike asrTimes) -- exactly what
   * computeMinMaxAvg expects to turn into a {min,max,avg,n} stat at the call site. */
  function mergeExtracts(extracts) {
    const asrTimes = [];
    const perNode = {};
    const turnCounts = [];
    const durationsSecs = [];
    const totalTokensList = [];
    for (const e of extracts) {
      asrTimes.push(...e.asrTimes);
      for (const [nodeId, stats] of Object.entries(e.perNode)) {
        if (!perNode[nodeId]) perNode[nodeId] = { turnCount: 0, llmTtfb: [], ttsTtfb: [], ragLatency: [] };
        perNode[nodeId].turnCount += stats.turnCount;
        perNode[nodeId].llmTtfb.push(...stats.llmTtfb);
        perNode[nodeId].ttsTtfb.push(...stats.ttsTtfb);
        perNode[nodeId].ragLatency.push(...stats.ragLatency);
      }
      if (typeof e.turnCount === "number") turnCounts.push(e.turnCount);
      if (typeof e.durationSecs === "number") durationsSecs.push(e.durationSecs);
      if (typeof e.totalTokens === "number") totalTokensList.push(e.totalTokens);
    }
    return { asrTimes, perNode, turnCounts, durationsSecs, totalTokensList };
  }

  /** {turnCount, durationSecs, totalTokens} each as a computeMinMaxAvg {min,max,avg,n} stat (or null
   * if nothing was recorded) -- the conversation-level counterpart to summarizeNodeStats, built the
   * same way at every call site that builds a variant result (runBenchmark, refreshRunStats,
   * GlobalAnalytics.computeGlobalAnalytics), so all three stay in sync by construction. */
  function summarizeConversationStats(merged) {
    return {
      turnCount: computeMinMaxAvg(merged.turnCounts),
      durationSecs: computeMinMaxAvg(merged.durationsSecs),
      totalTokens: computeMinMaxAvg(merged.totalTokensList),
    };
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
   * Runs the whole benchmark: snapshot -> validate every distinct llm against the agent -> for each
   * RUNNABLE variant (sequential, since they all mutate the same live callee agent) apply it, run
   * every scenario in parallel, collect + aggregate -> restore the snapshot.
   * `onProgress({ phase, variant, variants })` fires at each step for the UI (phase: "validating" |
   * "applying" | "running" | "collecting" | "restoring"). `textOnly` defaults to falsy (real audio)
   * -- BenchmarkSession.jsx only ever passes true once it has confirmed the benchmark isn't testing
   * TTS (see the top-of-file note on textOnly).
   *
   * `runsPerScenario` (default 1, BenchmarkSession.jsx's "Run" dropdown) replays each selected
   * scenario that many times WITHIN the same variant pass, all run in parallel alongside each
   * other -- same concurrency model as running several different scenarios at once, just with
   * duplicates of the same one. This is purely about collecting more samples per node before
   * moving on to the next variant (a single noisy/short call shouldn't carry a whole variant's
   * stats) -- `perNode`'s merge already treats multiple runs of one scenario exactly like runs of
   * different scenarios (see mergeExtracts), so no aggregation changes were needed for this.
   *
   * The resolved result carries two failure lists, both non-fatal to the rest of the run:
   * `invalidLlms` ({llm, error}[]) for an llm the pre-run validation rejected (its variants never
   * ran at all), and `failedVariants` ({variantId, label, error}[]) for a variant that passed
   * validation but still failed once the sweep reached it. Either one failing no longer discards
   * variants that already succeeded -- only throws (aborting the whole run) when EVERY variant
   * turns out unrunnable.
   *
   * `skipVariantIds` (BenchmarkSession.jsx's "Continue" button on an interrupted past run) excludes
   * already-completed variant ids from this sweep entirely -- not re-validated, not re-applied, not
   * re-dialed. `onVariantDone({variants, failedVariants, invalidLlms, nodeNames})` fires after EVERY
   * variant this call does run (success or failure), each time with the FULL cumulative state so
   * far (not just that one variant) -- BenchmarkSession.jsx uses it to persist progress to the
   * backend incrementally, so a browser crash or an interruption mid-sweep loses at most the ONE
   * variant that was in flight, not everything collected before it.
   */
  async function runBenchmark({
    api,
    accounts,
    callerAgent,
    calleeAgent,
    scenarios,
    resolveCalleeDynamicVariables,
    benchmark,
    onProgress,
    textOnly,
    noiseProfile,
    onBridgeCreated,
    voiceTable,
    runsPerScenario,
    skipVariantIds,
    onVariantDone,
  }) {
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

    // Every DISTINCT llm this run would apply is validated against the callee agent BEFORE dialing
    // any real calls, by making the exact same setModelConfig call the sweep below makes for it.
    // Settings → Benchmarks' model picker only filters by the platform's general catalog
    // (services/eleven_api.py get_llm_list) -- a model listed there as selectable can still be
    // rejected by THIS agent/workflow at apply time (seen 2026-10-06: a 400 "<model> is not yet
    // supported" for agent.prompt.llm). Checked once per distinct llm, not once per variant, since
    // several variants can share one crossed with different TTS ids. A variant whose llm fails this
    // check is dropped from the sweep entirely -- surfaced back as `invalidLlms` so the UI can tell
    // the user what got skipped and why, instead of the whole run aborting (and, before this
    // existed, silently discarding every variant already completed) the moment the sweep itself
    // first reached that llm.
    const skipIds = new Set(skipVariantIds || []);
    const toValidate = variants.filter((v) => !skipIds.has(v.id));
    const distinctLlms = [...new Set(toValidate.map((v) => v.llm).filter(Boolean))];
    const invalidLlms = [];
    if (distinctLlms.length > 0) {
      if (onProgress) onProgress({ phase: "validating", variants: toValidate });
      for (const llm of distinctLlms) {
        try {
          await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, { llm });
        } catch (err) {
          invalidLlms.push({ llm, error: err.message });
        }
      }
    }
    const invalidLlmNames = new Set(invalidLlms.map((e) => e.llm));
    const runnableVariants = toValidate.filter((v) => !v.llm || !invalidLlmNames.has(v.llm));
    if (runnableVariants.length === 0) {
      await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, snapshot);
      await api.agents.clearPendingRestore(calleeAgent.accountId, calleeAgent.agentId);
      if (toValidate.length === 0) {
        // Every variant was already completed in a previous attempt (resumed via skipVariantIds) --
        // nothing left to do, not a failure.
        return { snapshot, variants: [], nodeNames, invalidLlms, failedVariants: [] };
      }
      throw new Error(`None of the selected LLM variant(s) are valid for this agent: ${invalidLlms.map((e) => `${e.llm} (${e.error})`).join("; ")}`);
    }

    const variantResults = [];
    const failedVariants = [];

    try {
      for (const variant of runnableVariants) {
        // A variant that fails AFTER passing the validation above (a transient error, or the
        // agent's state changing between validation and here) is recorded and skipped, not left to
        // abort the whole run -- every other variant's already-collected results must survive it.
        try {
          if (onProgress) onProgress({ phase: "applying", variant, variants: runnableVariants });
          await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, {
            tts_model_id: variant.ttsModelId || undefined,
            llm: variant.llm || undefined,
          });
          await sleep(1500); // let the new config settle before dialing

          if (onProgress) onProgress({ phase: "running", variant, variants: runnableVariants });
          const repeats = Math.max(1, runsPerScenario || 1);
          const runs = await Promise.all(
            scenarios.flatMap((scenario) =>
              Array.from({ length: repeats }, () =>
                runOneScenario({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables: resolveCalleeDynamicVariables(scenario), textOnly, noiseProfile, onBridgeCreated, voiceTable }),
              ),
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

          if (onProgress) onProgress({ phase: "collecting", variant, variants: runnableVariants });
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
            conversationStats: summarizeConversationStats(merged),
            scenarioRuns: runs.map((r) => ({
              scenarioId: r.scenario.id,
              scenarioName: r.scenario.name,
              callerConversationId: r.callerConversationId,
              calleeConversationId: r.calleeConversationId,
              endReason: r.endReason,
            })),
          });
        } catch (err) {
          failedVariants.push({ variantId: variant.id, label: variant.label, error: err.message });
        }
        if (onVariantDone) {
          try {
            await onVariantDone({ variants: [...variantResults], failedVariants: [...failedVariants], invalidLlms, nodeNames });
          } catch (err) {
            // Best-effort, same as the debugLogs.save above -- an incremental-persistence failure
            // must never abort the sweep itself, the run's actual results matter more.
            console.error("onVariantDone callback failed (benchmark continues)", err);
          }
        }
      }
    } finally {
      if (onProgress) onProgress({ phase: "restoring", variants: runnableVariants });
      await api.agents.setModelConfig(calleeAgent.accountId, calleeAgent.agentId, snapshot);
      // Only clear the pending-restore record once the restore above has actually succeeded (if
      // setModelConfig throws, this line never runs, and the record correctly survives for later
      // recovery) -- never clear it speculatively just because this function is wrapping up.
      await api.agents.clearPendingRestore(calleeAgent.accountId, calleeAgent.agentId);
    }

    return { snapshot, variants: variantResults, nodeNames, invalidLlms, failedVariants };
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
        return { ...variant, asr: computeMinMaxAvg(merged.asrTimes), perNode: summarizeNodeStats(merged.perNode), conversationStats: summarizeConversationStats(merged) };
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
    summarizeConversationStats,
    // Exported for session/RecommendationTest.js, which runs a preset's scenarios once in
    // text-only mode the same way a benchmark variant does, just without the TTS/LLM sweep around
    // it.
    runOneScenario,
  };
})();
