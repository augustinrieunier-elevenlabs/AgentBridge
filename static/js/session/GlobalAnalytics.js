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
  const { fetchConversationWithMetrics, extractMetricsFromConversation, mergeExtracts, summarizeNodeStats, computeMinMaxAvg, combineNodeStats, NORMAL_END_REASONS } =
    window.AB.session.BenchmarkRunner;

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
   * no filter, keep every scenario). Also returns the raw matching export/benchmark records
   * themselves (not just the entries bucketed out of them) -- resolveNodeNames needs those to read
   * and backfill their `nodeNames` field, which lives at the whole-record level, not per entry. */
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
    const exportRecords = relevantExports.map((e, i) => ({ path: e.path, record: fullExports[i] }));
    for (const { record: exp } of exportRecords) {
      const cfg = exp.calleeConfig || null;
      for (const entry of exp.conversations || []) {
        if (!matchesScenario(entry)) continue;
        bucketed.push({ key: configKey(cfg), label: configLabel(cfg), cfg, entry });
      }
    }

    // Benchmarks: each VARIANT carries its own config, independent of the run's other variants --
    // bucket per variant, not per whole run. Falls back to label matching for a run saved before
    // calleeAccountId/calleeAgentId existed on the record.
    const allBenchmarkRuns = await api.benchmarkRuns.list();
    const benchmarkRecords = allBenchmarkRuns.filter((run) => {
      const runAgent = run.calleeAccountId ? { accountId: run.calleeAccountId, agentId: run.calleeAgentId } : null;
      return runAgent ? sameAgent(runAgent, calleeAgent) : run.calleeAgentLabel === calleeAgent.label;
    });
    for (const run of benchmarkRecords) {
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

    return { bucketed, exportRecords, benchmarkRecords };
  }

  /**
   * Resolves the Workflow node id -> {label, type} map for this callee agent, reusing whatever's
   * already cached on ANY of its gathered session/batch/benchmark records before ever calling the
   * live API -- a run saved after this feature shipped already carries its own `nodeNames` (see
   * RunHistory.js / BenchmarkRunner.js runBenchmark). Only calls GET .../workflow-nodes when NONE of
   * them have it yet (the first time this agent's EXISTING history is analyzed after this feature
   * shipped), and when it does, writes the result back into every record that was missing it, via
   * PATCH, so that live call never has to happen again for this agent's history. Confirmed with the
   * user 2026-10-05: "si il n'y a rien dans les fichiers ... tu fais un call aux api ... puis tu
   * modifie tous les fichier concernés pour ne pas avoir à refaire cet appel la prochaine fois".
   */
  async function resolveNodeNames({ api, calleeAgent, exportRecords, benchmarkRecords }) {
    let nodeNames = null;
    for (const { record } of exportRecords) {
      if (record.nodeNames) {
        nodeNames = record.nodeNames;
        break;
      }
    }
    if (!nodeNames) {
      for (const run of benchmarkRecords) {
        if (run.nodeNames) {
          nodeNames = run.nodeNames;
          break;
        }
      }
    }

    if (!nodeNames) {
      try {
        nodeNames = await api.agents.getWorkflowNodes(calleeAgent.accountId, calleeAgent.agentId);
      } catch (err) {
        console.error("Could not resolve workflow node names for global analytics", err);
        return {};
      }
    }

    const backfills = [];
    for (const { path, record } of exportRecords) {
      if (!record.nodeNames) backfills.push(api.exports.update(path, { nodeNames }).catch((err) => console.error("Could not backfill node names into export", path, err)));
    }
    for (const run of benchmarkRecords) {
      if (!run.nodeNames) backfills.push(api.benchmarkRuns.update(run.id, { nodeNames }).catch((err) => console.error("Could not backfill node names into benchmark run", run.id, err)));
    }
    await Promise.all(backfills);

    return nodeNames;
  }

  /**
   * Computes the harmonized result. `onProgress(done, total)` fires as each conversation is
   * fetched+extracted (there can be many, one live API call each).
   */
  async function computeGlobalAnalytics({ api, calleeAgent, scenarioIds, onProgress }) {
    const { bucketed, exportRecords, benchmarkRecords } = await gatherEntries({ api, calleeAgent, scenarioIds });
    if (bucketed.length === 0) return { variants: [], nodeNames: {} };

    const nodeNames = await resolveNodeNames({ api, calleeAgent, exportRecords, benchmarkRecords });

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

    return { variants, nodeNames };
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

  function groupBy(list, keyFn) {
    const map = new Map();
    for (const item of list) {
      const key = keyFn(item);
      if (key == null) continue; // no real (non-default) value to group under -- nothing to recommend
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  /** Fraction of scenario runs that ended via a normal websocket close, not a stall/timeout/failed
   * start -- a "the call didn't crash" signal, nothing more. Deliberately NOT called "success rate"
   * anywhere in this module or the UI: a run can hang up perfectly cleanly after visiting only HALF
   * the agent's workflow (e.g. none of the tested scenarios ever asked a question routing through
   * some node), which the person using this app rightly flagged as misleading when hangupRate alone
   * was labeled "success rate" right next to a node-coverage table showing exactly that gap
   * (confirmed with the user 2026-10-05: the two numbers "se contredisent"). See reliabilityOf,
   * which folds this together with coverage so neither number is presented as "success" alone. */
  function hangupRate(scenarioRuns) {
    const total = scenarioRuns.length;
    const normal = scenarioRuns.filter((r) => NORMAL_END_REASONS.has(r.endReason)).length;
    return total > 0 ? normal / total : null;
  }

  /** Fraction of `allNodeIds` actually present in `perNode` -- the exact same definition
   * ui/BenchmarkAnalyticsViews.jsx's NodeCoverageMatrix uses for its Total row (visitedCount /
   * allNodeIds.length), so a candidate's coverage number here always matches what that table would
   * show for the same set of variants -- no more disagreeing with the matrix above it on the page. */
  function coverageOf(perNode, allNodeIds) {
    if (allNodeIds.length === 0) return null;
    return allNodeIds.filter((id) => perNode[id]).length / allNodeIds.length;
  }

  /** The actual reliability score every ranking below sorts on: clean-hangup rate × node coverage.
   * Multiplicative on purpose -- a candidate that never crashes but only ever reaches half the
   * workflow should NOT outrank one that's slightly less clean but actually does the whole job, and
   * a simple average would let a high hangup rate paper over near-zero coverage. Either component
   * missing (no samples at all) makes the whole score unknown rather than silently treating the
   * missing half as perfect. */
  function reliabilityOf(hangup, coverage) {
    if (hangup == null || coverage == null) return null;
    return hangup * coverage;
  }

  /** Ranks candidates by reliability first (higher is better), latency second (lower is better) --
   * the rule the user asked for verbatim for both the TTS and the LLM recommendation: "le plus
   * stable / rapide" / "le taux de succès le plus important ... et la latence la plus faible",
   * "stable"/"succès" now meaning reliabilityOf (hangup × coverage), not hangup rate alone. A
   * candidate with no reliability (no samples) or no latency (metric never recorded) sorts last on
   * that axis rather than crashing the comparison. */
  function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
      if (a.reliability !== b.reliability) {
        if (a.reliability == null) return 1;
        if (b.reliability == null) return -1;
        return b.reliability - a.reliability;
      }
      const aAvg = a.latency ? a.latency.avg : Infinity;
      const bAvg = b.latency ? b.latency.avg : Infinity;
      return aAvg - bAvg;
    });
  }

  /**
   * Proposes the best callee configuration from a computeGlobalAnalytics result's full (llm, tts)
   * breakdown (always the raw breakdown, independent of AnalyticsPanel's "Breakdown by TTS" display
   * toggle -- that toggle only affects what's SHOWN, this needs every axis attributed separately to
   * tell a TTS effect apart from an LLM effect). Confirmed with the user 2026-10-05:
   *   1. Best TTS -- grouped by TTS model (pooling every LLM it was run with), ranked by reliability
   *      (hangup rate × node coverage, see reliabilityOf) then pooled TTS latency: "le plus stable /
   *      rapide sur tous les tests concernés".
   *   2. Best LLM -- same rule, grouped by LLM (pooling every TTS it was run with), pooled LLM
   *      latency: "le taux de succès le plus important ... et la latence la plus faible".
   *   3. Per-node LLM pick -- for each workflow node, combines that SAME per-LLM hangup rate from #2
   *      (a global signal; there's no per-node hangup signal to rank on, since endReason only
   *      describes the whole run, not where in the workflow it happened) with a NODE-SPECIFIC
   *      coverage figure instead of the global one -- the fraction of this LLM's own variant-groups
   *      that reached THIS node at all -- paired with that LLM's latency AT THIS node. Lets two
   *      different nodes end up recommending two different LLMs when both are equally clean overall
   *      but one actually reaches (and is faster at) a particular node more reliably than the other
   *      -- "proposer une version de cet agent qui se base sur plusieurs LLMs pour optimiser la
   *      perf".
   * Node coverage (global or per-node) is always computed against `allNodeIds` -- every node any
   * variant in this result ever visited -- the same denominator NodeCoverageMatrix's Total row uses.
   * Excludes the "unknown config" bucket and a genuinely untouched (null) axis from every ranking --
   * there's nothing concrete to recommend for "unspecified".
   */
  function computeRecommendations(result) {
    const variants = (result.variants || []).filter((v) => v.variantId !== "unknown");
    const allNodeIds = Array.from(new Set(variants.flatMap((v) => Object.keys(v.perNode)))).sort();

    const byTts = groupBy(variants, (v) => v.ttsModelId || null);
    const ttsRanking = rankCandidates(
      Array.from(byTts.entries()).map(([ttsModelId, vs]) => {
        const perNode = mergePerNode(vs.map((v) => v.perNode));
        const hangup = hangupRate(vs.flatMap((v) => v.scenarioRuns || []));
        const coverage = coverageOf(perNode, allNodeIds);
        return { id: ttsModelId, hangupRate: hangup, coverage, reliability: reliabilityOf(hangup, coverage), latency: combineNodeStats(perNode, "tts"), sampleCount: vs.length };
      }),
    );

    const byLlm = groupBy(variants, (v) => v.llm || null);
    const llmRanking = rankCandidates(
      Array.from(byLlm.entries()).map(([llm, vs]) => {
        const perNode = mergePerNode(vs.map((v) => v.perNode));
        const hangup = hangupRate(vs.flatMap((v) => v.scenarioRuns || []));
        const coverage = coverageOf(perNode, allNodeIds);
        return { id: llm, hangupRate: hangup, coverage, reliability: reliabilityOf(hangup, coverage), latency: combineNodeStats(perNode, "llm"), sampleCount: vs.length };
      }),
    );
    const llmHangupRate = new Map(llmRanking.map((c) => [c.id, c.hangupRate]));

    const perNode = allNodeIds.map((nodeId) => ({
      nodeId,
      ranking: rankCandidates(
        Array.from(byLlm.entries())
          .map(([llm, vs]) => {
            const withNode = vs.filter((v) => v.perNode[nodeId]);
            if (withNode.length === 0) return null; // this LLM never routed through this node at all
            const nodeLatency = withNode.map((v) => v.perNode[nodeId].llm).reduce((acc, s) => mergeStat(acc, s), null);
            const hangup = llmHangupRate.get(llm);
            const nodeReach = withNode.length / vs.length; // this node's coverage, for just this LLM's own variant-groups
            return { id: llm, hangupRate: hangup, coverage: nodeReach, reliability: reliabilityOf(hangup, nodeReach), latency: nodeLatency, sampleCount: withNode.length };
          })
          .filter(Boolean),
      ),
    }));

    return { ttsRanking, llmRanking, perNode };
  }

  window.AB.session.GlobalAnalytics = { computeGlobalAnalytics, groupVariantsByLlm, computeRecommendations };
})();
