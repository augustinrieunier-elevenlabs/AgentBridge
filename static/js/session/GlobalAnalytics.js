/**
 * Builds a Benchmark-shaped { variants: [...] } result from the ENTIRE app's stored history --
 * every session, batch preset, and benchmark run -- harmonized by (llm, tts) config instead of by
 * benchmark-defined variant, so ui/BenchmarkAnalyticsViews.jsx's tables/chart render identically for
 * this cross-feature view (ui/AnalyticsPanel.jsx) as they do for a single benchmark run.
 *
 * Scoped to ONE callee agent at a time (node ids are agent-specific; mixing two different agents'
 * workflows would make the coverage matrix meaningless -- no cross-agent comparison for now, by
 * design, confirmed with the user 2026-10-03) and optionally to a set of scenario ids.
 *
 * Deliberately RE-EXTRACTS per-node metrics fresh from each conversation on demand, even for
 * benchmark-sourced runs whose perNode/asr are already pre-computed and stored -- never reusing
 * those pre-stored aggregates here. Two reasons:
 *   1. Consistency: every source needs to be scoped to the scenario filter identically, and a
 *      benchmark variant's stored aggregate can't be un-merged back down to "just this scenario"
 *      after the fact -- only a per-node SUMMARY was kept, not a per-node-per-scenario one.
 *   2. True harmonization: conversations from different runs that happen to share a config should
 *      pool into one real set of samples (min of mins, true weighted avg), not an average-of-
 *      per-run-averages across sources.
 * Confirmed with the user as "on demand" (not pre-computed/cached) -- acceptable cost for a
 * demo-scale history; worth revisiting (persist once per conversation) only if this gets slow.
 */
(function () {
  const { fetchConversationWithMetrics, extractMetricsFromConversation, mergeExtracts, summarizeNodeStats, computeMinMaxAvg } = window.AB.session.BenchmarkRunner;

  function configKey(cfg) {
    if (!cfg) return "unknown";
    return `llm=${cfg.llm || "(default)"}|tts=${cfg.tts_model_id || "(default)"}`;
  }

  function configLabel(cfg) {
    if (!cfg) return "Unknown config";
    const parts = [];
    if (cfg.llm) parts.push(cfg.llm);
    if (cfg.tts_model_id) parts.push(cfg.tts_model_id);
    return parts.length ? parts.join(" + ") : "Default config";
  }

  function sameAgent(a, b) {
    return Boolean(a && b && a.accountId === b.accountId && a.agentId === b.agentId);
  }

  /** Gathers every (conversation entry, config) pair across exports (sessions/batches) and
   * benchmark runs that belong to `calleeAgent`, already filtered by `scenarioIds` (empty/omitted =
   * no filter, keep every scenario). */
  async function gatherEntries({ api, calleeAgent, scenarioIds }) {
    const scenarioFilter = scenarioIds && scenarioIds.length > 0 ? new Set(scenarioIds) : null;
    const matchesScenario = (entry) => !scenarioFilter || scenarioFilter.has(entry.scenarioId);

    const bucketed = []; // { key, label, cfg, entry }

    // Sessions + batches: list_exports already surfaces callee/calleeConfig, so filter down BEFORE
    // reading every export's full conversations list -- avoids a read for every export ever saved,
    // only the ones that could possibly belong to this agent.
    const exportSummaries = await api.exports.list();
    const relevantExports = exportSummaries.filter((e) => sameAgent(e.callee, calleeAgent));
    const fullExports = await Promise.all(relevantExports.map((e) => api.exports.read(e.path)));
    for (const exp of fullExports) {
      const cfg = exp.calleeConfig || null;
      for (const entry of exp.conversations || []) {
        if (!matchesScenario(entry)) continue;
        bucketed.push({ key: configKey(cfg), label: configLabel(cfg), cfg, entry });
      }
    }

    // Benchmarks: each VARIANT carries its own config, independent of the run's other variants --
    // bucket per variant, not per whole run. Falls back to label matching for a run saved before
    // calleeAccountId/calleeAgentId existed on the record.
    const benchmarkRuns = await api.benchmarkRuns.list();
    for (const run of benchmarkRuns) {
      const runAgent = run.calleeAccountId ? { accountId: run.calleeAccountId, agentId: run.calleeAgentId } : null;
      const matchesRun = runAgent ? sameAgent(runAgent, calleeAgent) : run.calleeAgentLabel === calleeAgent.label;
      if (!matchesRun) continue;
      const snapshot = run.snapshot || {};
      for (const variant of run.variants || []) {
        // A benchmark that only varies ONE axis deliberately leaves the other null on its variants
        // (buildVariantMatrix's "leave it as whatever it already was" semantics -- correct for
        // RUNNING the benchmark). For harmonization that's wrong: the untouched axis still had one
        // real, known value the whole time -- the run's own pre-mutation `snapshot` -- so leaving it
        // null here would fragment e.g. a TTS-only benchmark's "eleven_v4_turbo" variant into its
        // own bucket instead of correctly merging it with every other run that used the SAME
        // (actual LLM at the time) + eleven_v4_turbo combination. Backfilling from the snapshot
        // keeps every source attributed to its real, full config.
        const cfg = {
          llm: variant.llm || snapshot.llm || null,
          tts_model_id: variant.ttsModelId || snapshot.tts_model_id || null,
        };
        for (const entry of variant.scenarioRuns || []) {
          if (!matchesScenario(entry)) continue;
          bucketed.push({ key: configKey(cfg), label: configLabel(cfg), cfg, entry });
        }
      }
    }

    return bucketed;
  }

  /**
   * Computes the harmonized result. `onProgress(done, total)` fires as each conversation is
   * fetched+extracted (there can be many, one live API call each).
   */
  async function computeGlobalAnalytics({ api, calleeAgent, scenarioIds, onProgress }) {
    const bucketed = await gatherEntries({ api, calleeAgent, scenarioIds });
    if (bucketed.length === 0) return { variants: [] };

    const byConfig = new Map(); // key -> { label, cfg, entries: [] }
    for (const b of bucketed) {
      if (!byConfig.has(b.key)) byConfig.set(b.key, { label: b.label, cfg: b.cfg, entries: [] });
      byConfig.get(b.key).entries.push(b.entry);
    }

    let done = 0;
    const total = bucketed.length;
    const variants = [];
    for (const [key, group] of byConfig.entries()) {
      const extracts = await Promise.all(
        group.entries.map(async (entry) => {
          let extract = { asrTimes: [], perNode: {} };
          if (entry.calleeConversationId) {
            try {
              // Historical conversations are long finished -- no need for the multi-retry wait
              // BenchmarkRunner's live collection step uses right after a call ends; one fetch is
              // enough (metrics are either already finalized by now, or never will be).
              const raw = await fetchConversationWithMetrics(api, calleeAgent.accountId, entry.calleeConversationId, { retries: 1 });
              extract = extractMetricsFromConversation(raw || {});
            } catch (err) {
              console.error("Could not fetch/extract a conversation for global analytics", entry.calleeConversationId, err);
            }
          }
          done += 1;
          if (onProgress) onProgress(done, total);
          return extract;
        }),
      );
      const merged = mergeExtracts(extracts);
      variants.push({
        variantId: key,
        label: group.label,
        llm: group.cfg ? group.cfg.llm || null : null,
        ttsModelId: group.cfg ? group.cfg.tts_model_id || null : null,
        asr: computeMinMaxAvg(merged.asrTimes),
        perNode: summarizeNodeStats(merged.perNode),
        scenarioRuns: group.entries,
      });
    }

    // "Unknown config" last, so the attributable/comparable configs lead the table.
    variants.sort((a, b) => (a.variantId === "unknown" ? 1 : b.variantId === "unknown" ? -1 : a.label.localeCompare(b.label)));

    return { variants };
  }

  /** Pools a {min,max,avg,n} summary pair into one -- avg*n recovers each side's sum exactly, so
   * this is an exact merge of the underlying samples, not an average-of-averages. Mirrors
   * BenchmarkRunner.js's combineNodeStats, which does the same pooling across NODES of one variant;
   * this does it across VARIANTS for one node/metric. */
  function mergeStat(a, b) {
    if (!a) return b;
    if (!b) return a;
    const n = a.n + b.n;
    return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max), avg: (a.avg * a.n + b.avg * b.n) / n, n };
  }

  function mergePerNode(perNodeList) {
    const merged = {};
    for (const perNode of perNodeList) {
      for (const [nodeId, stats] of Object.entries(perNode)) {
        if (!merged[nodeId]) merged[nodeId] = { turnCount: 0, llm: null, tts: null, rag: null };
        merged[nodeId].turnCount += stats.turnCount;
        merged[nodeId].llm = mergeStat(merged[nodeId].llm, stats.llm);
        merged[nodeId].tts = mergeStat(merged[nodeId].tts, stats.tts);
        merged[nodeId].rag = mergeStat(merged[nodeId].rag, stats.rag);
      }
    }
    return merged;
  }

  /**
   * Collapses a computeGlobalAnalytics result's (llm, tts) breakdown down to one row per LLM,
   * pooling every TTS variant's samples together -- for the "pure LLM performance" view where the
   * TTS backend is noise, not a dimension worth splitting on (confirmed with the user 2026-10-03:
   * too many (llm, tts) columns to scan when all that's wanted is "which LLMs are fast and cover the
   * workflow"). Pure display-time transform over the already-fetched result -- no re-fetch needed,
   * so toggling this is instant.
   *
   * The "unknown config" bucket (no snapshot at all, not a real captured default) is passed through
   * unmerged: it has no attributable LLM to group by, and merging it into some LLM's bucket would
   * misattribute history that was never actually confirmed to belong to that LLM.
   */
  function groupVariantsByLlm(result) {
    const byLlm = new Map(); // llm (or "(default)") -> { label, variants: [] }
    const passthrough = [];
    for (const v of result.variants) {
      if (v.variantId === "unknown") {
        passthrough.push(v);
        continue;
      }
      const llmKey = v.llm || "(default)";
      if (!byLlm.has(llmKey)) byLlm.set(llmKey, { label: v.llm || "Default LLM", variants: [] });
      byLlm.get(llmKey).variants.push(v);
    }

    const grouped = Array.from(byLlm.entries()).map(([llmKey, group]) => ({
      variantId: `llm=${llmKey}`,
      label: group.label,
      asr: group.variants.map((v) => v.asr).reduce((acc, s) => mergeStat(acc, s), null),
      perNode: mergePerNode(group.variants.map((v) => v.perNode)),
      scenarioRuns: group.variants.flatMap((v) => v.scenarioRuns),
    }));
    grouped.sort((a, b) => a.label.localeCompare(b.label));

    return { variants: [...grouped, ...passthrough] };
  }

  window.AB.session.GlobalAnalytics = { computeGlobalAnalytics, groupVariantsByLlm };
})();
