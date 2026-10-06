/**
 * "What should this callee agent actually be configured with?" -- derived from
 * session/GlobalAnalytics.js's computeRecommendations, which ranks every TTS/LLM this agent's
 * stored history (sessions, batches, benchmarks) has ever run by RELIABILITY (clean-hangup rate ×
 * node coverage, see computeRecommendations/reliabilityOf) then latency.
 *
 * Reliability is two numbers folded into one, shown broken out under the headline percentage in
 * every ranking table below -- a candidate that never crashes but only ever reaches half the
 * workflow should rank below one that's a little less clean but actually does the whole job, and a
 * plain "did the call hang up ok" rate alone can't tell those apart (confirmed with the user
 * 2026-10-05, who caught this table claiming "100% success" for a config whose Node coverage matrix
 * showed it only ever reached 3 of 6 nodes -- two numbers that used to look contradictory because
 * only one of them was being shown here).
 *
 * Always computed from the FULL (llm, tts) breakdown in `result` -- independent of AnalyticsPanel's
 * "Breakdown by TTS" display toggle, which only changes what the Overview tab shows, not what data
 * exists to recommend from.
 */
(function () {
  const { StatCell, CollapsibleCard, nodeLabel, nodeTitle, formatDuration, formatCount, formatTokens, ModelEfficiencyScatter } = window.AB.ui.benchmarkViews;

  function formatRate(rate) {
    return rate == null ? "n/a" : `${Math.round(rate * 100)}%`;
  }

  // Only the podium matters at a glance across a dozen+ of these tables on one page (TTS, LLM, one
  // per node) -- everything past 3rd place is "didn't win" either way, so it stays behind a "Show
  // more" click instead of pushing the page length past a quick scan.
  const TOP_N = 3;

  /** `coverageLabel` names what "coverage" means in THIS table's context -- "workflow coverage"
   * (fraction of every node this result ever saw, same denominator as NodeCoverageMatrix's Total
   * row) for the TTS/LLM tables, vs. "node reach" (fraction of this LLM's own runs that got to THIS
   * one node) for the per-node table -- so the breakdown line is honest about which one it is.
   *
   * `showConversationStats` adds Turns/Duration/Tokens columns -- only meaningful for the LLM
   * ranking (confirmed with the user 2026-10-06): a model needing more back-and-forth or more
   * tokens to get through the same scenario, or simply being more verbose, is a real efficiency
   * signal independent of raw latency. Not shown for TTS (which doesn't affect any of the three) or
   * the per-node table (these three are whole-conversation figures, not meaningful per node). */
  function RankingTable({ rows, idLabel, coverageLabel, showConversationStats = false }) {
    const { useState } = React;
    const [expanded, setExpanded] = useState(false);
    const visibleRows = expanded ? rows : rows.slice(0, TOP_N);
    const hiddenCount = rows.length - TOP_N;

    return (
      <div>
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>{idLabel}</th>
              <th>Reliability</th>
              <th>Latency (avg / min–max)</th>
              {showConversationStats && (
                <>
                  <th title="Number of 'agent' turns per conversation -- more/less efficient at closing the request, or more/less verbose.">Turns (avg / min–max)</th>
                  <th>Duration (avg / min–max)</th>
                  <th title="Total LLM tokens (input + cached + output) actually billed per conversation.">Tokens (avg / min–max)</th>
                </>
              )}
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => (
              <tr key={r.id} className={i === 0 ? "recommendation-top-row" : ""}>
                <td>{i === 0 ? "🏆" : i + 1}</td>
                <td>{r.id}</td>
                <td>
                  {formatRate(r.reliability)}
                  <br />
                  <span className="muted small">
                    hangup {formatRate(r.hangupRate)}, {coverageLabel} {formatRate(r.coverage)}
                  </span>
                </td>
                <td>
                  <StatCell stat={r.latency} />
                </td>
                {showConversationStats && (
                  <>
                    <td>
                      <StatCell stat={r.conversationStats && r.conversationStats.turnCount} format={formatCount} />
                    </td>
                    <td>
                      <StatCell stat={r.conversationStats && r.conversationStats.durationSecs} format={formatDuration} />
                    </td>
                    <td>
                      <StatCell stat={r.conversationStats && r.conversationStats.totalTokens} format={formatTokens} />
                    </td>
                  </>
                )}
                <td className="muted small">
                  {r.sampleCount} run{r.sampleCount === 1 ? "" : "s"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hiddenCount > 0 && (
          <button className="small ranking-table-more" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
    );
  }

  function RecommendationPanel({ result, config, accounts, calleeAgent }) {
    const recs = window.AB.session.GlobalAnalytics.computeRecommendations(result);
    const bestTts = recs.ttsRanking[0] || null;
    const bestLlm = recs.llmRanking[0] || null;
    const perNodePicks = recs.perNode.filter((n) => n.ranking.length > 0);
    const distinctLlmIds = new Set(perNodePicks.map((n) => n.ranking[0].id));
    const mixedModelWorthwhile = distinctLlmIds.size > 1;

    if (!bestTts && !bestLlm) {
      return (
        <p className="empty-state">
          Not enough attributed LLM/TTS history yet to make a recommendation -- run a benchmark, or a few sessions/presets, against this agent first (and give it a moment after each run: a brand
          new session/preset run needs its config snapshot, which Analytics reads from).
        </p>
      );
    }

    return (
      <div>
        <div className="banner banner-ok">
          Recommended config, from every stored run against this agent: TTS = <strong>{bestTts ? bestTts.id : "n/a"}</strong>, LLM = <strong>{bestLlm ? bestLlm.id : "n/a"}</strong>.
          {mixedModelWorthwhile && (
            <>
              {" "}
              A mixed-model setup could do better -- {distinctLlmIds.size} different LLMs come out on top across the {perNodePicks.length} node{perNodePicks.length === 1 ? "" : "s"} seen (see
              "Per-node LLM pick" below).
            </>
          )}
        </div>

        <CollapsibleCard title="Recommended TTS model -- ranked by reliability, then latency">
          <p className="panel-help">
            Grouped by TTS model, pooling every LLM it was ever run with. Reliability = hangup rate (fraction of scenario runs on that TTS that ended via a normal hangup rather than a
            stall/timeout/failed start) × workflow coverage (fraction of every node this agent's history has ever visited that runs on this TTS actually reached -- same number the Node coverage
            matrix above shows for the Total row). Neither half alone proves the TTS itself caused a given failure or routing gap, but multiplying them keeps a 100%-clean-hangup config that only
            ever exercises half the workflow from outranking one that's a little less clean but actually completes it.
          </p>
          {recs.ttsRanking.length === 0 ? (
            <p className="panel-help">No TTS variation found in this agent's history -- every stored run used the same (or an unattributed) TTS model.</p>
          ) : (
            <RankingTable rows={recs.ttsRanking} idLabel="TTS model" coverageLabel="workflow coverage" />
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Recommended LLM -- ranked by reliability, then latency (all nodes combined)">
          <p className="panel-help">Grouped by LLM, pooling every TTS model it was ever run with. Same reliability formula and caveats as above.</p>
          {recs.llmRanking.length === 0 ? (
            <p className="panel-help">No LLM variation found in this agent's history.</p>
          ) : (
            <RankingTable rows={recs.llmRanking} idLabel="LLM" coverageLabel="workflow coverage" showConversationStats />
          )}
        </CollapsibleCard>

        <ModelEfficiencyScatter candidates={recs.llmRanking} />

        <CollapsibleCard title="Per-node LLM pick -- best LLM for each workflow node" defaultOpen={mixedModelWorthwhile}>
          <p className="panel-help">
            Same hangup rate as the global LLM ranking above (there's no way to attribute a run's clean/unclean ending to one specific node), but combined here with a NODE-SPECIFIC coverage: the
            fraction of this LLM's own runs that reached THIS node at all, times that LLM's own latency AT THIS node. A node recommends a different LLM than the global pick above when another,
            equally clean LLM actually reaches (and is faster at) this particular node more reliably -- useful if this agent's workflow could run different nodes on different LLMs.
          </p>
          {recs.perNode.length === 0 && <p className="panel-help">No per-node data found in this agent's history yet.</p>}
          {recs.perNode.map(({ nodeId, ranking }) => (
            <div key={nodeId} className="recommendation-node-block">
              <strong title={nodeTitle(nodeId, result.nodeNames)}>{nodeLabel(nodeId, result.nodeNames)}</strong>
              {ranking.length === 0 ? <p className="panel-help">No LLM reached this node in the stored history.</p> : <RankingTable rows={ranking} idLabel="LLM" coverageLabel="node reach" />}
            </div>
          ))}
        </CollapsibleCard>

        {calleeAgent && <RecommendationTestSection recs={recs} config={config} accounts={accounts} calleeAgent={calleeAgent} />}
      </div>
    );
  }

  /**
   * "Try it before you adopt it": runs the exact 5-step sequence confirmed with the user
   * 2026-10-05 -- backup Workflow, run a chosen preset once text-only (baseline), apply the
   * per-node LLM picks below (pre-filled from `recs.perNode`, editable) to the live agent, run the
   * SAME preset again (tested), restore the Workflow -- then shows both runs side by side through
   * the exact same GlobalStatsTable/NodeCoverageMatrix/StackedLatencyChart this whole app already
   * uses for every other latency comparison. See session/RecommendationTest.js for the orchestration
   * and why it always runs text-only.
   */
  function RecommendationTestSection({ recs, config, accounts, calleeAgent }) {
    const { useEffect, useState } = React;
    const { GlobalStatsTable, NodeCoverageMatrix, StackedLatencyChart } = window.AB.ui.benchmarkViews;

    const presets = config.presets.filter((p) => p.calleeAgentRefId === calleeAgent.id);
    const [presetId, setPresetId] = useState(presets[0] ? presets[0].id : "");
    const [overrideNodes, setOverrideNodes] = useState(null); // null = loading
    const [nodeNames, setNodeNames] = useState({}); // every node (any type) -> {label, type}, for the comparison's NodeCoverageMatrix
    const [llmByNodeId, setLlmByNodeId] = useState({}); // nodeId -> "" (no change) | "null" (inherit) | llmName
    const [currentGlobalLlm, setCurrentGlobalLlm] = useState(null); // null while loading
    const [globalLlm, setGlobalLlm] = useState(""); // "" = no change, else a new top-level LLM
    const [pendingRestore, setPendingRestore] = useState(null);
    const [restoring, setRestoring] = useState(false);
    const [phase, setPhase] = useState("idle"); // idle | backing-up | baseline | applying | testing | restoring | done | error
    const [testResult, setTestResult] = useState(null);
    const [error, setError] = useState(null);

    const preset = config.presets.find((p) => p.id === presetId) || null;
    const callerAgent = preset ? config.agents.find((a) => a.id === preset.callerAgentRefId) || null : null;
    const scenarios = preset ? preset.scenarioIds.map((id) => config.scenarios.find((s) => s.id === id)).filter(Boolean) : [];
    const llmChoices = recs.llmRanking.map((c) => c.id);

    // Every override_agent node on the LIVE agent (not just the ones with recommendation data --
    // "demander pour chaque noeud quel LLM appliquer" means every eligible node, not only the ones
    // this history happens to cover), with its current LLM, fetched once per selected callee agent.
    useEffect(() => {
      setOverrideNodes(null);
      window.AB.api.agents
        .getWorkflow(calleeAgent.accountId, calleeAgent.agentId)
        .then((workflow) => {
          const allNodes = workflow.nodes || {};
          // Every node, any type -- this comparison's own NodeCoverageMatrix shows raw ✗/✓ for
          // nodes well beyond the override_agent-only subset below (e.g. `start`/`router`/`tool`
          // nodes), so it needs the full map or it falls back to showing the platform's raw id for
          // any of those, exactly the unreadable "node_01ky2spx..." id this was built to avoid.
          setNodeNames(Object.fromEntries(Object.entries(allNodes).map(([id, n]) => [id, { label: n.label || id, type: n.type }])));
          const nodes = Object.entries(allNodes)
            .filter(([, n]) => n.type === "override_agent")
            .map(([id, n]) => ({ id, label: n.label || id, currentLlm: (n.conversation_config?.agent?.prompt?.llm) || null }));
          setOverrideNodes(nodes);
          const perNodeRecommended = new Map(recs.perNode.map((n) => [n.nodeId, n.ranking[0] && n.ranking[0].id]));
          const initial = {};
          for (const node of nodes) {
            initial[node.id] = perNodeRecommended.get(node.id) || "";
          }
          setLlmByNodeId(initial);
        })
        .catch((err) => console.error("Could not load this agent's Workflow nodes", err));
    }, [calleeAgent.accountId, calleeAgent.agentId]);

    // The agent's own top-level default LLM -- what the `start` node and every node with no
    // override_agent override actually runs on. Distinct from any per-node override above, and
    // easy to miss entirely since it isn't a node at all (confirmed with the user 2026-10-05, who
    // couldn't find it anywhere in this form before this was added).
    useEffect(() => {
      setCurrentGlobalLlm(null);
      window.AB.api.agents
        .getModelConfig(calleeAgent.accountId, calleeAgent.agentId)
        .then(({ llm }) => {
          setCurrentGlobalLlm(llm || null);
          const bestLlm = recs.llmRanking[0] && recs.llmRanking[0].id;
          setGlobalLlm(bestLlm && bestLlm !== llm ? bestLlm : "");
        })
        .catch((err) => console.error("Could not load this agent's current global LLM", err));
    }, [calleeAgent.accountId, calleeAgent.agentId]);

    // Same per-agent hazard as BenchmarkSession.jsx's check -- an interrupted test here leaves the
    // SAME kind of record (see session/PendingRestore.js), so check for it here too, independent of
    // whether the user ever opens the Benchmark screen for this agent.
    useEffect(() => {
      setPendingRestore(null);
      window.AB.api.agents
        .getPendingRestore(calleeAgent.accountId, calleeAgent.agentId)
        .then(setPendingRestore)
        .catch(() => {});
    }, [calleeAgent.accountId, calleeAgent.agentId]);

    async function restoreNow() {
      setRestoring(true);
      try {
        await window.AB.session.PendingRestore.restorePendingConfig(window.AB.api, calleeAgent, pendingRestore);
        setPendingRestore(null);
      } catch (err) {
        alert(`Could not restore the callee's config: ${err.message}`);
      } finally {
        setRestoring(false);
      }
    }

    const selectedCount = Object.values(llmByNodeId).filter((v) => v !== "").length;
    const changingGlobalLlm = globalLlm !== "";
    const incomplete = !preset || !callerAgent || scenarios.length === 0 || (selectedCount === 0 && !changingGlobalLlm);

    async function runTest() {
      if (incomplete || pendingRestore) return;
      setPhase("backing-up");
      setError(null);
      setTestResult(null);
      const resolveCalleeDynamicVariables = (scenario) => window.AB.model.resolveCalleeDynamicVariables(calleeAgent, preset, scenario.id);
      const llmPayload = {};
      for (const [nodeId, value] of Object.entries(llmByNodeId)) {
        if (value === "") continue; // no change -- leave this node untouched
        llmPayload[nodeId] = value === "null" ? null : value;
      }
      try {
        const outcome = await window.AB.session.RecommendationTest.runRecommendationTest({
          api: window.AB.api,
          accounts,
          callerAgent,
          calleeAgent,
          scenarios,
          resolveCalleeDynamicVariables,
          llmByNodeId: llmPayload,
          globalLlm: changingGlobalLlm ? globalLlm : null,
          onProgress: ({ phase: p }) => setPhase(p),
        });
        setTestResult(outcome);
        setPhase("done");
      } catch (err) {
        setError(err.message);
        setPhase("error");
      }
    }

    const comparisonResult = testResult && {
      variants: [
        { variantId: "baseline", label: "Current config (baseline)", ...testResult.baseline },
        { variantId: "recommended", label: "Recommended per-node LLMs", ...testResult.tested },
      ],
    };

    return (
      <CollapsibleCard title="Test this recommendation on a preset">
        <p className="panel-help">
          Runs the preset below twice, text-only: once with this agent's current config (baseline), once with the per-node LLM choices you pick (pre-filled from the recommendation above),
          restoring the agent's original Workflow afterwards either way. Compares coverage and latency between the two runs below.
        </p>

        {pendingRestore && (
          <div className="banner banner-warn">
            This callee agent is still on config from a run that never finished cleanly: {window.AB.session.PendingRestore.describePendingRestore(pendingRestore)} -- recorded{" "}
            {new Date(pendingRestore.recordedAt * 1000).toLocaleString()}.{" "}
            <button onClick={restoreNow} disabled={restoring}>
              {restoring ? "Restoring…" : "Restore now"}
            </button>
          </div>
        )}

        {presets.length === 0 ? (
          <p className="panel-help">No preset uses this callee agent yet -- create one in Settings → Presets first.</p>
        ) : (
          <div className="card-row">
            <label>
              Preset
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)} disabled={phase !== "idle" && phase !== "done" && phase !== "error"}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={runTest} disabled={incomplete || Boolean(pendingRestore) || (phase !== "idle" && phase !== "done" && phase !== "error")}>
              {phase === "idle" || phase === "done" || phase === "error" ? "Run test" : "Running…"}
            </button>
          </div>
        )}

        {preset && !callerAgent && <p className="panel-help">This preset's caller agent isn't set -- check Settings → Presets.</p>}
        {preset && scenarios.length === 0 && <p className="panel-help">This preset has no scenario -- check Settings → Presets.</p>}

        <fieldset>
          <legend>Global default LLM{changingGlobalLlm ? " (will be changed)" : ""}</legend>
          <p className="panel-help">
            Used by the `start` node and any node with no override above -- not a node itself, so it's easy to miss. This is the same thing "Recommended LLM" above ranks.
          </p>
          <label className="card-row">
            LLM
            <span className="muted small">{currentGlobalLlm === null ? "loading…" : `(currently ${currentGlobalLlm || "the platform default"})`}</span>
            <select value={globalLlm} onChange={(e) => setGlobalLlm(e.target.value)}>
              <option value="">No change</option>
              {llmChoices.map((llm) => (
                <option key={llm} value={llm}>
                  {llm}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        {overrideNodes === null && <p className="panel-help">Loading this agent's Workflow nodes…</p>}
        {overrideNodes && overrideNodes.length === 0 && <p className="panel-help">This agent's Workflow has no override_agent node -- there's nothing to assign a per-node LLM to.</p>}
        {overrideNodes && overrideNodes.length > 0 && (
          <fieldset>
            <legend>Per-node LLM ({selectedCount} of {overrideNodes.length} node{overrideNodes.length === 1 ? "" : "s"} will be changed)</legend>
            <p className="panel-help">"No change" leaves that node exactly as it is today -- only the nodes you pick an LLM for get modified (and restored afterwards).</p>
            {overrideNodes.map((node) => (
              <div className="card-row" key={node.id}>
                <label className="grow">
                  {node.label}
                  <span className="muted small"> (currently {node.currentLlm || "inherits agent default"})</span>
                  <select value={llmByNodeId[node.id] || ""} onChange={(e) => setLlmByNodeId((prev) => ({ ...prev, [node.id]: e.target.value }))}>
                    <option value="">No change</option>
                    <option value="null">Inherit agent default</option>
                    {llmChoices.map((llm) => (
                      <option key={llm} value={llm}>
                        {llm}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </fieldset>
        )}

        {phase !== "idle" && phase !== "done" && phase !== "error" && (
          <div className="banner banner-warn">
            {phase === "backing-up" && "Backing up the callee's current Workflow…"}
            {phase === "baseline" && "Running the baseline pass (current config)…"}
            {phase === "applying" && "Applying the per-node LLM choices…"}
            {phase === "testing" && "Running the test pass (recommended config)…"}
            {phase === "restoring" && "Restoring the callee's original Workflow…"}
          </div>
        )}

        {error && <div className="banner banner-warn">Test failed: {error}. The callee's original Workflow has still been restored.</div>}

        {comparisonResult && (
          <>
            <GlobalStatsTable result={comparisonResult} />
            <NodeCoverageMatrix result={comparisonResult} nodeNames={nodeNames} />
            <StackedLatencyChart result={comparisonResult} />
          </>
        )}
      </CollapsibleCard>
    );
  }

  window.AB.ui.RecommendationPanel = RecommendationPanel;
})();
