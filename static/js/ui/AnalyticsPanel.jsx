/**
 * Global analytics: the same latency/node-coverage views a single Benchmark run gets, built instead
 * from EVERY stored session, batch, and benchmark run against one callee agent -- harmonized by
 * (llm, tts) config (see session/GlobalAnalytics.js) rather than by benchmark-defined variant, so
 * e.g. two unrelated sessions run weeks apart on the same LLM pool into one row here. Computed on
 * demand when "Run analysis" is clicked, not pre-computed/cached -- see GlobalAnalytics.js's header
 * comment for why.
 */
(function () {
  const { useState } = React;
  const { GlobalStatsTable, NodeCoverageMatrix, StackedLatencyChart } = window.AB.ui.benchmarkViews;

  function AnalyticsPanel({ config }) {
    const calleeAgents = config.agents.filter((a) => a.role === "callee" || a.role === "both");
    const [calleeAgentId, setCalleeAgentId] = useState(calleeAgents[0] ? calleeAgents[0].id : "");
    const [scenarioIds, setScenarioIds] = useState([]); // empty = no filter, every scenario included
    const [phase, setPhase] = useState("idle"); // idle | running | done | error
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null); // always the full (llm, tts) breakdown
    const [error, setError] = useState(null);
    // Off = pure-LLM view: TTS collapsed out of the grouping, ASR hidden -- a display-time transform
    // of `result`, not a refetch, so toggling this is instant (see GlobalAnalytics.groupVariantsByLlm).
    const [breakdownByTts, setBreakdownByTts] = useState(true);

    const displayResult = result && !breakdownByTts ? window.AB.session.GlobalAnalytics.groupVariantsByLlm(result) : result;

    const calleeAgent = config.agents.find((a) => a.id === calleeAgentId) || null;

    function selectCalleeAgent(id) {
      setCalleeAgentId(id);
      setResult(null);
      setError(null);
      setPhase("idle");
    }

    function toggleScenario(id) {
      setScenarioIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }

    async function runAnalysis() {
      if (!calleeAgent) {
        alert("Select a callee agent first.");
        return;
      }
      setPhase("running");
      setError(null);
      setResult(null);
      setProgress(null);
      try {
        const outcome = await window.AB.session.GlobalAnalytics.computeGlobalAnalytics({
          api: window.AB.api,
          calleeAgent,
          scenarioIds,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        setResult(outcome);
        setPhase("done");
      } catch (err) {
        setError(err.message);
        setPhase("error");
      }
    }

    return (
      <div className="panel">
        <div className="card">
          <div className="card-row">
            <label>
              Callee agent
              <select value={calleeAgentId} onChange={(e) => selectCalleeAgent(e.target.value)}>
                <option value="">Select…</option>
                {calleeAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={runAnalysis} disabled={!calleeAgent || phase === "running"}>
              {phase === "running" ? "Analyzing…" : "Run analysis"}
            </button>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={breakdownByTts} onChange={(e) => setBreakdownByTts(e.target.checked)} />
            Breakdown by TTS model
          </label>
          <p className="panel-help">
            {breakdownByTts
              ? "Each row is one (LLM, TTS) combination actually run together."
              : "Rows are grouped by LLM only, pooling every TTS model run with it -- ASR hidden, for a pure LLM performance + node coverage view."}
          </p>
          <fieldset>
            <legend>Scenarios ({scenarioIds.length === 0 ? "all" : scenarioIds.length} selected)</legend>
            <p className="panel-help">Leave none checked to include every scenario found in this agent's history.</p>
            {config.scenarios.map((s) => (
              <label key={s.id} className="checkbox-row">
                <input type="checkbox" checked={scenarioIds.includes(s.id)} onChange={() => toggleScenario(s.id)} />
                {s.name}
              </label>
            ))}
            {config.scenarios.length === 0 && <p className="panel-help">No scenarios configured yet.</p>}
          </fieldset>
        </div>

        {phase === "running" && (
          <p className="panel-help">
            Fetching and aggregating conversations from every session, batch, and benchmark run against this agent…{progress ? ` (${progress.done}/${progress.total})` : ""}
          </p>
        )}

        {error && <div className="banner banner-warn">Analysis failed: {error}</div>}

        {phase === "idle" && !result && (
          <p className="empty-state">
            Pick a callee agent and click "Run analysis" to harmonize every stored session, batch, and benchmark run against it by TTS/LLM config -- no cross-agent comparison yet, one agent at a
            time.
          </p>
        )}

        {result && result.variants.length === 0 && <p className="empty-state">No stored runs found for this callee agent{scenarioIds.length > 0 ? " with the selected scenario filter" : ""}.</p>}

        {result && result.variants.some((v) => v.variantId === "unknown") && (
          <p className="panel-help">"Unknown config" groups runs saved before this agent's TTS/LLM was snapshotted per-run -- re-run them to get them attributed to a real config.</p>
        )}

        {displayResult && displayResult.variants.length > 0 && (
          <>
            <GlobalStatsTable result={displayResult} showAsr={breakdownByTts} />
            <NodeCoverageMatrix result={displayResult} />
            <StackedLatencyChart result={displayResult} showAsr={breakdownByTts} />
          </>
        )}
      </div>
    );
  }

  window.AB.ui.AnalyticsPanel = AnalyticsPanel;
})();
