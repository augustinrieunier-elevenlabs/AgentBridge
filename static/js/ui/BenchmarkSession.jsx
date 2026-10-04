/**
 * Session-side entry point for a Benchmark (see ui/settings/BenchmarksPanel.jsx for the config
 * CRUD and session/BenchmarkRunner.js for the actual run orchestration). Launches a run, shows
 * live progress through the variant/scenario sweep, then a per-node min/max/avg results table --
 * plus every past run of this benchmark, persisted server-side, for comparison across sessions.
 */
(function () {
  const { useEffect, useState } = React;
  const { GlobalStatsTable, NodeCoverageMatrix, StackedLatencyChart, ResultsTables } = window.AB.ui.benchmarkViews;

  function BenchmarkSession({ config, accounts, benchmark }) {
    const callerAgent = config.agents.find((a) => a.id === benchmark.callerAgentRefId) || null;
    const calleeAgent = config.agents.find((a) => a.id === benchmark.calleeAgentRefId) || null;
    const scenarios = benchmark.scenarioIds.map((id) => config.scenarios.find((s) => s.id === id)).filter(Boolean);
    // `benchmark` carries the same calleeDynamicVariableOverrides(ByScenario) fields as a Preset,
    // so it can be passed directly in the "preset" slot here (see model/factory.js emptyBenchmark).
    const resolveCalleeDynamicVariables = (scenario) => window.AB.model.resolveCalleeDynamicVariables(calleeAgent, benchmark, scenario.id);
    const variants = window.AB.session.BenchmarkRunner.buildVariantMatrix(benchmark);

    const [phase, setPhase] = useState("idle"); // idle | running | done | error
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [pastRuns, setPastRuns] = useState([]);
    const [selectedPastRunId, setSelectedPastRunId] = useState(null);
    const [refreshingRunId, setRefreshingRunId] = useState(null);
    const [textOnly, setTextOnly] = useState(false);
    const [deadlockCount, setDeadlockCount] = useState(0);
    const [pendingRestore, setPendingRestore] = useState(null);
    const [restoring, setRestoring] = useState(false);
    const [nodeNames, setNodeNames] = useState({});

    // ASR/TTS timing only exists when real audio actually ran that pipeline, so a benchmark that
    // varies TTS always needs it -- text-only is only offered (and only ever actually used) when
    // the benchmark doesn't test TTS at all, where audio adds cost/time without adding signal.
    const testsTts = benchmark.ttsVariantIds.length > 0;
    const effectiveTextOnly = !testsTts && textOnly;

    useEffect(() => {
      setPhase("idle");
      setProgress(null);
      setResult(null);
      setError(null);
      setSelectedPastRunId(null);
      window.AB.api.benchmarkRuns
        .list(benchmark.id)
        .then(setPastRuns)
        .catch(() => setPastRuns([]));
    }, [benchmark.id]);

    // A benchmark that gets interrupted before its own restore step (crash, navigating away
    // mid-run) leaves the callee agent stuck on whatever variant was last applied -- silently, with
    // nothing on screen to show it, until someone notices a model is behaving oddly days later (see
    // BenchmarkRunner.js runBenchmark's pending-restore comment for the full incident). Check for a
    // leftover record every time the selected callee agent changes, so it surfaces here before
    // anyone runs another benchmark against an agent that's already in a broken state.
    useEffect(() => {
      setPendingRestore(null);
      if (!calleeAgent) return;
      window.AB.api.agents
        .getPendingRestore(calleeAgent.accountId, calleeAgent.agentId)
        .then(setPendingRestore)
        .catch(() => {});
    }, [calleeAgent && calleeAgent.accountId, calleeAgent && calleeAgent.agentId]);

    async function restoreNow() {
      if (!calleeAgent || !pendingRestore) return;
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

    const incomplete = !callerAgent || !calleeAgent || scenarios.length === 0 || variants.length === 0;

    async function launch() {
      if (incomplete) {
        alert("This benchmark needs a caller agent, a callee agent, at least one scenario and at least one TTS/LLM variant -- check Settings → Benchmarks.");
        return;
      }
      if (pendingRestore) {
        alert('This callee agent has an unresolved config from a previous interrupted run -- click "Restore now" below before launching another one.');
        return;
      }
      setPhase("running");
      setError(null);
      setResult(null);
      setSelectedPastRunId(null);
      setDeadlockCount(0);
      try {
        const outcome = await window.AB.session.BenchmarkRunner.runBenchmark({
          api: window.AB.api,
          accounts,
          callerAgent,
          calleeAgent,
          scenarios,
          resolveCalleeDynamicVariables,
          benchmark,
          onProgress: setProgress,
          textOnly: effectiveTextOnly,
        });
        setPhase("done");
        const saved = await window.AB.api.benchmarkRuns.save({
          benchmarkId: benchmark.id,
          benchmarkName: benchmark.name,
          calleeAgentLabel: calleeAgent.label,
          // accountId/agentId, not just the label -- the global Analytics view (History →
          // Analytics) filters history down to one callee agent and needs a reliable match, not a
          // label string that could collide or get renamed. A run saved before this existed just
          // falls back to label matching there.
          calleeAccountId: calleeAgent.accountId,
          calleeAgentId: calleeAgent.agentId,
          textOnly: effectiveTextOnly,
          snapshot: outcome.snapshot,
          variants: outcome.variants,
          nodeNames: outcome.nodeNames,
        });
        setResult(saved); // same shape as a pastRuns entry (has an id) -- see refreshRun
        setPastRuns((prev) => [saved, ...prev]);
        // A deadlocked scenario (the callee's own workflow stalled mid-turn, not something the
        // bridge can fix) gets auto-ended after ~15s of silence instead of blocking the rest of
        // the benchmark -- see BenchmarkRunner.js runOneScenario's onDeadlock handler. Surfacing it
        // here so a thin-looking result row is understood as "this call got cut short", not a
        // silent data gap.
        const deadlocked = outcome.variants.flatMap((v) => v.scenarioRuns.filter((r) => r.endReason === "deadlock_timeout"));
        if (deadlocked.length > 0) {
          setDeadlockCount(deadlocked.length);
        }
      } catch (err) {
        setError(err.message);
        setPhase("error");
      }
    }

    async function refreshRun(run) {
      if (!calleeAgent) {
        alert("This benchmark's callee agent isn't set -- check Settings → Benchmarks before refreshing stats.");
        return;
      }
      setRefreshingRunId(run.id);
      try {
        const refreshedVariants = await window.AB.session.BenchmarkRunner.refreshRunStats({ api: window.AB.api, calleeAgent, run });
        const updated = await window.AB.api.benchmarkRuns.update(run.id, { variants: refreshedVariants });
        setPastRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        if (result && result.id === updated.id) setResult(updated);
      } catch (err) {
        alert(`Could not refresh stats: ${err.message}`);
      } finally {
        setRefreshingRunId(null);
      }
    }

    const selectedPastRun = pastRuns.find((r) => r.id === selectedPastRunId) || null;
    const shownResult = selectedPastRun || result;

    // Workflow node id -> {label, type}, for NodeCoverageMatrix/ResultsTables to show readable node
    // names instead of the platform's raw id. A run saved after this feature shipped already
    // carries its own `nodeNames` (see the save call above / RunHistory.js) -- no API call needed.
    // An OLDER run predates that: fetch it once here and patch it onto the stored run, so the next
    // time this exact run is viewed (even after a reload) it's already there -- see
    // GlobalAnalytics.js's resolveNodeNames for the equivalent backfill on the cross-feature
    // Analytics view.
    useEffect(() => {
      if (!shownResult) {
        setNodeNames({});
        return;
      }
      if (shownResult.nodeNames) {
        setNodeNames(shownResult.nodeNames);
        return;
      }
      if (!calleeAgent) return;
      let cancelled = false;
      window.AB.api.agents
        .getWorkflowNodes(calleeAgent.accountId, calleeAgent.agentId)
        .then((names) => {
          if (cancelled) return;
          setNodeNames(names);
          window.AB.api.benchmarkRuns.update(shownResult.id, { nodeNames: names }).catch((err) => console.error("Could not backfill node names into benchmark run", shownResult.id, err));
        })
        .catch((err) => console.error("Could not resolve workflow node names", err));
      return () => {
        cancelled = true;
      };
    }, [shownResult && shownResult.id, shownResult && shownResult.nodeNames, calleeAgent && calleeAgent.accountId, calleeAgent && calleeAgent.agentId]);

    return (
      <div className="benchmark-session">
        {pendingRestore && (
          <div className="banner banner-warn">
            This callee agent is still on config from a run that never finished cleanly: {window.AB.session.PendingRestore.describePendingRestore(pendingRestore)} -- recorded{" "}
            {new Date(pendingRestore.recordedAt * 1000).toLocaleString()}. Every call against this agent right now uses that config, not its real default.{" "}
            <button onClick={restoreNow} disabled={restoring}>
              {restoring ? "Restoring…" : "Restore now"}
            </button>
          </div>
        )}

        <div className="session-toolbar">
          <span>
            Benchmark "{benchmark.name}" -- {variants.length} configuration{variants.length === 1 ? "" : "s"} × {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"}
          </span>
          <label
            className="checkbox-row"
            title={
              testsTts
                ? "Not available -- this benchmark varies TTS, which needs real audio to measure ASR/TTS timing at all."
                : "This benchmark doesn't vary TTS, so audio adds cost/time without adding signal -- text only still measures LLM/RAG timing correctly."
            }
          >
            <input type="checkbox" checked={effectiveTextOnly} onChange={(e) => setTextOnly(e.target.checked)} disabled={testsTts || phase === "running"} />
            Text only
          </label>
          <button className="primary" onClick={launch} disabled={phase === "running"}>
            {phase === "running" ? "Running…" : "Run benchmark"}
          </button>
        </div>

        {effectiveTextOnly && <p className="panel-help">Running text only -- ASR and TTS stats will show "n/a" below (no audio pipeline ran); LLM and RAG timing are unaffected.</p>}

        {incomplete && <div className="banner banner-warn">This benchmark is incomplete -- check its caller/callee/scenarios/variants in Settings → Benchmarks.</div>}

        {phase === "running" && (
          <div className="banner banner-warn">
            Running {effectiveTextOnly ? "text only" : "with real audio"} -- each variant dials every selected scenario, one pass each, then moves to the next.{" "}
            {progress && (
              <>
                {progress.phase === "applying" && `Applying variant "${progress.variant.label}"…`}
                {progress.phase === "running" && `Running ${scenarios.length} scenario(s) against "${progress.variant.label}"…`}
                {progress.phase === "collecting" && `Collecting results for "${progress.variant.label}"…`}
                {progress.phase === "restoring" && "Restoring the callee's original configuration…"}
                {progress.variant && ` (variant ${variants.findIndex((v) => v.id === progress.variant.id) + 1}/${variants.length})`}
              </>
            )}
          </div>
        )}

        {error && <div className="banner banner-warn">Benchmark failed: {error}. The callee's original configuration has still been restored.</div>}

        {deadlockCount > 0 && (
          <div className="banner banner-warn">
            {deadlockCount} scenario run{deadlockCount === 1 ? "" : "s"} went silent and {deadlockCount === 1 ? "was" : "were"} auto-ended after ~15s instead of running to the full scenario
            timeout -- the callee's own workflow stalled mid-turn (not something a retry here would fix). Check "Runs" below for which variant/scenario had "deadlock_timeout" as its end reason.
          </div>
        )}

        {pastRuns.length > 0 && (
          <div className="card">
            <strong>Runs</strong>
            <p className="panel-help">
              Conversation stats aren't always fully finalized by the platform right after a call ends -- use "Refresh stats" on a run to re-pull and re-aggregate them later.
            </p>
            <ul className="list">
              {result && (
                <li className="card-row">
                  <button className={`list-item-btn${!selectedPastRunId ? " list-item-active" : ""}`} onClick={() => setSelectedPastRunId(null)}>
                    Latest run (just now)
                  </button>
                  <button onClick={() => refreshRun(result)} disabled={refreshingRunId === result.id}>
                    {refreshingRunId === result.id ? "Refreshing…" : "Refresh stats"}
                  </button>
                </li>
              )}
              {pastRuns.map((r) => (
                <li key={r.id} className="card-row">
                  <button className={`list-item-btn${selectedPastRunId === r.id ? " list-item-active" : ""}`} onClick={() => setSelectedPastRunId(r.id)}>
                    {new Date((r.finishedAt || 0) * 1000).toLocaleString()} -- {r.variants.length} variant{r.variants.length === 1 ? "" : "s"}
                  </button>
                  <button onClick={() => refreshRun(r)} disabled={refreshingRunId === r.id}>
                    {refreshingRunId === r.id ? "Refreshing…" : "Refresh stats"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!shownResult && pastRuns.length === 0 && phase === "idle" && <p className="empty-state">Click "Run benchmark" to sweep every selected configuration and collect latency stats.</p>}

        {shownResult && (
          <>
            <GlobalStatsTable result={shownResult} />
            <NodeCoverageMatrix result={shownResult} nodeNames={nodeNames} />
            <StackedLatencyChart result={shownResult} />
            <ResultsTables result={shownResult} nodeNames={nodeNames} />
          </>
        )}
      </div>
    );
  }

  window.AB.ui.BenchmarkSession = BenchmarkSession;
})();
