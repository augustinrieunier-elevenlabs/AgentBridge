/**
 * Session-side entry point for a Benchmark (see ui/settings/BenchmarksPanel.jsx for the config
 * CRUD and session/BenchmarkRunner.js for the actual run orchestration). Launches a run, shows
 * live progress through the variant/scenario sweep, then a per-node min/max/avg results table --
 * plus every past run of this benchmark, persisted server-side, for comparison across sessions.
 */
(function () {
  const { useEffect, useRef, useState } = React;
  const { GlobalStatsTable, NodeCoverageMatrix, StackedLatencyChart, ResultsTables, ModelEfficiencyScatter } = window.AB.ui.benchmarkViews;

  function BenchmarkSession({ config, accounts, benchmark }) {
    const callerAgent = config.agents.find((a) => a.id === benchmark.callerAgentRefId) || null;
    const calleeAgent = config.agents.find((a) => a.id === benchmark.calleeAgentRefId) || null;
    const scenarios = benchmark.scenarioIds.map((id) => config.scenarios.find((s) => s.id === id)).filter(Boolean);
    // `benchmark` carries the same calleeDynamicVariableOverrides(ByScenario) fields as a Preset,
    // so it can be passed directly in the "preset" slot here (see model/factory.js emptyBenchmark).
    const resolveCalleeDynamicVariables = (scenario) => window.AB.model.resolveCalleeDynamicVariables(calleeAgent, benchmark, scenario.id);
    const variants = window.AB.session.BenchmarkRunner.buildVariantMatrix(benchmark);
    const noiseProfile = config.noiseProfiles.find((p) => p.id === benchmark.noiseProfileRefId) || null;

    const [phase, setPhase] = useState("idle"); // idle | running | done | error
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [pastRuns, setPastRuns] = useState([]);
    const [selectedPastRunId, setSelectedPastRunId] = useState(null);
    const [refreshingRunId, setRefreshingRunId] = useState(null);
    const [textOnly, setTextOnly] = useState(false);
    const [runsPerScenario, setRunsPerScenario] = useState(1);
    const [deadlockCount, setDeadlockCount] = useState(0);
    const [invalidLlms, setInvalidLlms] = useState([]); // [{llm, error}] -- rejected by the agent before any call was dialed
    const [failedVariants, setFailedVariants] = useState([]); // [{variantId, label, error}] -- failed mid-sweep, after validation passed
    const [pendingRestore, setPendingRestore] = useState(null);
    const [restoring, setRestoring] = useState(false);
    const [nodeNames, setNodeNames] = useState({});
    const [muted, setMuted] = useState(false);
    // Mirrors `muted` so onBridgeCreated (called from deep inside BenchmarkRunner.js, well after
    // this render's closure was captured) always applies the CURRENT toggle state, not whatever it
    // was when the run started -- a benchmark runs every scenario unattended across several
    // variants, so the user can easily toggle mute mid-run. The bridges themselves aren't kept in
    // React state: a benchmark runs every selected scenario in parallel per variant and moves on to
    // a fresh batch of bridges per variant, so there's nothing here worth re-rendering on.
    const mutedRef = useRef(false);
    // Cleared at the start of every variant (see the onProgress wrapper in launch()), not just once
    // for the whole run -- every bridge referenced here is kept alive in memory (WebSocket, debug
    // log, metrics log) for as long as this ref holds it, and by the time a new variant starts
    // applying, every bridge from the PREVIOUS variant has already ended (runBenchmark awaits the
    // whole batch before moving on). Left unbounded before this fix, a multi-variant benchmark
    // retained every bridge it ever created for the entire run -- worse the more variants and the
    // higher "Run" (runsPerScenario) were set, since each adds a full extra batch of bridges that
    // never got released until the whole benchmark finished.
    const liveBridgesRef = useRef([]);

    function toggleMuted() {
      const next = !mutedRef.current;
      mutedRef.current = next;
      setMuted(next);
      liveBridgesRef.current.forEach((b) => {
        b.setCallerMuted(next);
        b.setCalleeMuted(next);
      });
    }

    function handleBridgeCreated(bridge) {
      liveBridgesRef.current.push(bridge);
      bridge.setCallerMuted(mutedRef.current);
      bridge.setCalleeMuted(mutedRef.current);
    }

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

    function dedupeLlmErrors(list) {
      const byLlm = new Map();
      for (const e of list) byLlm.set(e.llm, e);
      return [...byLlm.values()];
    }

    /** `resumeRun`, when given (the "Continue" button on an interrupted past run below), reuses its
     * id and skips every variant it already has instead of starting over -- a variant already
     * collected isn't re-validated, re-applied or re-dialed (real calls that already cost real
     * credits). Every variant this attempt DOES run is persisted to that same run record the moment
     * it finishes (BenchmarkRunner.js's onVariantDone), not just once at the very end -- so a crash
     * or interruption partway through loses at most the one variant in flight, never everything
     * collected before it (2026-10-06 incident: one unsupported LLM aborted the whole sweep and
     * discarded every variant that had already succeeded). */
    async function launch(resumeRun) {
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
      liveBridgesRef.current = [];

      const priorVariants = (resumeRun && resumeRun.variants) || [];
      const priorFailed = (resumeRun && resumeRun.failedVariants) || [];
      const priorInvalid = (resumeRun && resumeRun.invalidLlms) || [];
      const skipVariantIds = priorVariants.map((v) => v.variantId);
      setInvalidLlms(priorInvalid);
      setFailedVariants(priorFailed);

      try {
        let runId;
        if (resumeRun) {
          runId = resumeRun.id;
        } else {
          // Created empty, right away -- before any call is dialed -- purely so there's a backend
          // record for onVariantDone to patch incrementally. Not shown as "the" result yet (setResult
          // still only happens once the whole attempt finishes), but it does show up in the Runs
          // list below immediately, marked "incomplete", which is exactly right while it's running.
          const placeholder = await window.AB.api.benchmarkRuns.save({
            benchmarkId: benchmark.id,
            benchmarkName: benchmark.name,
            calleeAgentLabel: calleeAgent.label,
            calleeAccountId: calleeAgent.accountId,
            calleeAgentId: calleeAgent.agentId,
            textOnly: effectiveTextOnly,
            variants: [],
            failedVariants: [],
            invalidLlms: [],
            incomplete: true,
          });
          runId = placeholder.id;
          setPastRuns((prev) => [placeholder, ...prev]);
        }

        const outcome = await window.AB.session.BenchmarkRunner.runBenchmark({
          api: window.AB.api,
          accounts,
          callerAgent,
          calleeAgent,
          scenarios,
          resolveCalleeDynamicVariables,
          benchmark,
          onProgress: (p) => {
            // "applying" fires right before the NEXT variant's config is pushed live, i.e. strictly
            // after every bridge from the variant that just finished has already ended -- the safe
            // moment to drop them and let GC reclaim their sockets/logs instead of holding the whole
            // run's worth of bridges in memory (see liveBridgesRef's own comment).
            if (p.phase === "applying") liveBridgesRef.current = [];
            setProgress(p);
          },
          textOnly: effectiveTextOnly,
          noiseProfile, // Bridge.js itself no-ops this in text-only mode, no need to gate it here too
          onBridgeCreated: handleBridgeCreated,
          voiceTable: config.settings.voice_table,
          runsPerScenario,
          skipVariantIds,
          onVariantDone: async (p) => {
            const mergedVariants = [...priorVariants, ...p.variants];
            const mergedFailed = [...priorFailed, ...p.failedVariants];
            const mergedInvalid = dedupeLlmErrors([...priorInvalid, ...p.invalidLlms]);
            setInvalidLlms(mergedInvalid);
            setFailedVariants(mergedFailed);
            try {
              await window.AB.api.benchmarkRuns.update(runId, {
                variants: mergedVariants,
                failedVariants: mergedFailed,
                invalidLlms: mergedInvalid,
                nodeNames: p.nodeNames,
              });
            } catch (err) {
              console.error("Could not persist incremental benchmark progress", err);
            }
          },
        });

        const allVariants = [...priorVariants, ...outcome.variants];
        const allFailed = [...priorFailed, ...outcome.failedVariants];
        const allInvalid = dedupeLlmErrors([...priorInvalid, ...outcome.invalidLlms]);
        setInvalidLlms(allInvalid);
        setFailedVariants(allFailed);

        if (allVariants.length === 0) {
          // Every llm passed the up-front validation, but every variant still failed once the
          // sweep actually reached it -- nothing worth presenting as a result (see the banners
          // above for why each one failed). The backend record stays "incomplete" (empty) so
          // "Continue" would just re-attempt the same thing -- fine, since nothing succeeded to lose.
          setPhase("error");
          setError(`Every variant failed during the run: ${allFailed.map((f) => `${f.label} (${f.error})`).join("; ")}`);
          return;
        }

        setPhase("done");
        const saved = await window.AB.api.benchmarkRuns.update(runId, {
          variants: allVariants,
          nodeNames: outcome.nodeNames,
          invalidLlms: allInvalid,
          failedVariants: allFailed,
          incomplete: false,
          finishedAt: Date.now() / 1000, // when the run actually finished, not when the placeholder was first created
        });
        setResult(saved); // same shape as a pastRuns entry (has an id) -- see refreshRun
        setPastRuns((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
        // A deadlocked scenario (the callee's own workflow stalled mid-turn, not something the
        // bridge can fix) gets auto-ended after ~15s of silence instead of blocking the rest of
        // the benchmark -- see BenchmarkRunner.js runOneScenario's onDeadlock handler. Surfacing it
        // here so a thin-looking result row is understood as "this call got cut short", not a
        // silent data gap.
        const deadlocked = allVariants.flatMap((v) => v.scenarioRuns.filter((r) => r.endReason === "deadlock_timeout"));
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
            {runsPerScenario > 1 ? ` × ${runsPerScenario} run${runsPerScenario === 1 ? "" : "s"} each` : ""}
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
          <button
            className={muted ? "active" : ""}
            onClick={toggleMuted}
            disabled={effectiveTextOnly}
            title={effectiveTextOnly ? "Not available in text-only mode (no audio to mute)" : "Mute every scenario's audio -- a benchmark variant dials every selected scenario in parallel, which otherwise mixes into a confusing jumble."}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <label
            className="checkbox-row"
            title="Replays each selected scenario this many times within the same variant, all in parallel, before moving on to the next variant -- more samples per node instead of one call deciding the whole thing."
          >
            Run
            <select value={runsPerScenario} onChange={(e) => setRunsPerScenario(Number(e.target.value))} disabled={phase === "running"}>
              {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => launch()} disabled={phase === "running"}>
            {phase === "running" ? "Running…" : "Run benchmark"}
          </button>
        </div>

        {effectiveTextOnly && <p className="panel-help">Running text only -- ASR and TTS stats will show "n/a" below (no audio pipeline ran); LLM and RAG timing are unaffected.</p>}

        {incomplete && <div className="banner banner-warn">This benchmark is incomplete -- check its caller/callee/scenarios/variants in Settings → Benchmarks.</div>}

        {phase === "running" && (
          <div className="banner banner-warn">
            Running {effectiveTextOnly ? "text only" : "with real audio"} -- each variant dials every selected scenario{runsPerScenario > 1 ? `, ${runsPerScenario}× each,` : ""} then moves to the next.{" "}
            {progress && (
              <>
                {progress.phase === "validating" && "Checking every selected LLM against this agent before dialing any calls…"}
                {progress.phase === "applying" && `Applying variant "${progress.variant.label}"…`}
                {progress.phase === "running" &&
                  `Running ${scenarios.length} scenario(s)${runsPerScenario > 1 ? ` (${runsPerScenario}× each)` : ""} against "${progress.variant.label}"…`}
                {progress.phase === "collecting" && `Collecting results for "${progress.variant.label}"…`}
                {progress.phase === "restoring" && "Restoring the callee's original configuration…"}
                {progress.variant && ` (variant ${variants.findIndex((v) => v.id === progress.variant.id) + 1}/${variants.length})`}
              </>
            )}
          </div>
        )}

        {invalidLlms.length > 0 && (
          <div className="banner banner-warn">
            Skipped {invalidLlms.length} LLM{invalidLlms.length === 1 ? "" : "s"} rejected by this agent before any call was dialed:{" "}
            {invalidLlms.map((e, i) => (
              <span key={e.llm}>
                {i > 0 ? "; " : ""}
                <strong>{e.llm}</strong> ({e.error})
              </span>
            ))}
          </div>
        )}

        {failedVariants.length > 0 && (
          <div className="banner banner-warn">
            {failedVariants.length} variant{failedVariants.length === 1 ? "" : "s"} failed mid-run and {failedVariants.length === 1 ? "was" : "were"} skipped (every other variant's results are still kept):{" "}
            {failedVariants.map((f, i) => (
              <span key={f.variantId}>
                {i > 0 ? "; " : ""}
                <strong>{f.label}</strong> ({f.error})
              </span>
            ))}
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
                    {r.incomplete && <span className="badge badge-warn"> incomplete</span>}
                  </button>
                  {r.incomplete && (
                    <button
                      onClick={() => launch(r)}
                      disabled={phase === "running"}
                      title="Picks up where this run stopped -- already-completed variants are kept as-is, not re-dialed."
                    >
                      Continue
                    </button>
                  )}
                  <button
                    onClick={() => refreshRun(r)}
                    disabled={refreshingRunId === r.id || phase === "running"}
                    title={phase === "running" ? "Not available while a run is in progress -- this run's own local copy here could be stale and overwrite what's actually been saved." : undefined}
                  >
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
            {/* computeRecommendations works on ANY {variants} result, not just the harmonized
                cross-feature one (see GlobalAnalytics.js) -- here it's scoped to just THIS
                benchmark's own variants, so reliability/turns/duration/tokens reflect only this
                run's history, not the agent's full history. */}
            <ModelEfficiencyScatter candidates={window.AB.session.GlobalAnalytics.computeRecommendations(shownResult).llmRanking} />
            <ResultsTables result={shownResult} nodeNames={nodeNames} />
          </>
        )}
      </div>
    );
  }

  window.AB.ui.BenchmarkSession = BenchmarkSession;
})();
