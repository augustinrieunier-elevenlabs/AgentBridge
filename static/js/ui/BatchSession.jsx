/**
 * Runs every scenario of a batch preset (scenarioIds.length > 1, see model/factory.js) in
 * parallel, each as its own independent Bridge/session, and lets the operator click into any
 * run's live transcript from a list -- the "threads séparés" the batch-preset feature asked for.
 *
 * One caller/callee agent pair is shared across the whole batch (fixed per preset); only the
 * scenario differs per run.
 */
(function () {
  const { useEffect, useRef, useState } = React;
  const Bridge = window.AB.session.Bridge;
  const runBatchPreflight = window.AB.session.runBatchPreflight;
  const BatchPreflightChecklist = window.AB.ui.BatchPreflightChecklist;
  const AgentColumn = window.AB.ui.AgentColumn;
  const CenterTranscript = window.AB.ui.CenterTranscript;
  const Timeline = window.AB.ui.Timeline;
  const formatElapsed = window.AB.formatElapsed;

  function makeRun(scenario) {
    return {
      id: `run-${scenario.id}-${Math.random().toString(36).slice(2, 8)}`,
      scenario,
      bridge: null,
      status: "idle",
      turns: [],
      elapsedMs: 0,
      latency: {},
      conversationIds: { caller: null, callee: null },
      endReason: null,
      callerMuted: false,
      calleeMuted: false,
      callerVolume: 1,
      calleeVolume: 1,
    };
  }

  function BatchSession({ config, accounts, preset, callerAgent, calleeAgent }) {
    const scenarios = preset.scenarioIds.map((id) => config.scenarios.find((s) => s.id === id)).filter(Boolean);
    const resolveCalleeDynamicVariables = (scenario) => window.AB.model.resolveCalleeDynamicVariables(calleeAgent, preset, scenario.id);
    const noiseProfile = config.noiseProfiles.find((p) => p.id === preset.noiseProfileRefId) || null;

    const [textOnly, setTextOnly] = useState(false);
    const [phase, setPhase] = useState("idle"); // idle | checking | preflight | running
    const [preflightResults, setPreflightResults] = useState([]);
    const [runs, setRuns] = useState([]);
    const [selectedRunId, setSelectedRunId] = useState(null);

    const runsRef = useRef(runs);
    runsRef.current = runs;
    const historySavedRef = useRef(false);

    useEffect(() => {
      // Reset the whole batch when the preset's scenario set changes under us.
      setRuns([]);
      setSelectedRunId(null);
      setPhase("idle");
    }, [preset.id, preset.scenarioIds.join(",")]);

    useEffect(() => {
      return () => {
        for (const r of runsRef.current) if (r.bridge) r.bridge.end("unmount");
      };
    }, []);

    function updateRun(id, patch) {
      setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)));
    }

    async function openBatchPreflight() {
      if (!callerAgent || !calleeAgent || scenarios.length === 0) {
        alert("Select a caller agent, a callee agent, and at least one scenario in this preset first.");
        return;
      }
      setPhase("checking");
      const { results } = await runBatchPreflight({ api: window.AB.api, accounts, callerAgent, calleeAgent, scenarios, resolveCalleeDynamicVariables });
      setPreflightResults(results);
      setPhase("preflight");
    }

    function launchAll() {
      const newRuns = scenarios.map(makeRun);
      setRuns(newRuns);
      setSelectedRunId(newRuns[0] ? newRuns[0].id : null);
      setPhase("running");

      for (const run of newRuns) {
        const bridge = new Bridge({
          onStatusChange: (s) => updateRun(run.id, { status: s === "live" ? "live" : s === "ended" ? "ended" : "connecting" }),
          onTranscriptUpdate: (turns) => updateRun(run.id, { turns }),
          onMetrics: (m) => updateRun(run.id, { elapsedMs: m.elapsedSec * 1000, latency: { avgMs: m.calleeLatencyAvgMs, maxMs: m.calleeLatencyMaxMs } }),
          onEnded: (reason) => updateRun(run.id, { endReason: reason, status: "ended" }),
          onConversationIds: (callerId, calleeId) => updateRun(run.id, { conversationIds: { caller: callerId, callee: calleeId } }),
          onDeadlock: () => {},
          onVadScore: () => {},
          onDebugLog: () => {},
        });
        updateRun(run.id, { bridge });
        bridge
          .start({
            api: window.AB.api,
            accounts,
            callerAgent,
            calleeAgent,
            scenario: run.scenario,
            calleeDynamicVariables: resolveCalleeDynamicVariables(run.scenario),
            textOnly,
            noiseProfile,
            voiceTable: config.settings.voice_table,
          })
          .catch((err) => updateRun(run.id, { status: "ended", endReason: `start_failed: ${err.message}` }));
      }
    }

    function hangUpAll() {
      for (const r of runs) if (r.bridge) r.bridge.end("operator_hangup");
    }

    function setAllMuted(muted) {
      for (const r of runs) {
        if (r.bridge) {
          r.bridge.setCallerMuted(muted);
          r.bridge.setCalleeMuted(muted);
        }
        updateRun(r.id, { callerMuted: muted, calleeMuted: muted });
      }
    }

    const selectedRun = runs.find((r) => r.id === selectedRunId) || null;
    const allEnded = runs.length > 0 && runs.every((r) => r.status === "ended");
    const allMuted = runs.length > 0 && runs.every((r) => r.callerMuted && r.calleeMuted);

    // Auto-save the whole batch to History as ONE run the instant every scenario in it has ended --
    // same discipline as SessionScreen.jsx's single-call save, just with one conversation entry per
    // scenario instead of one. Guarded by a ref so a re-render while still allEnded doesn't re-save,
    // and reset the moment "launch all" starts a fresh batch (allEnded goes back to false).
    useEffect(() => {
      if (!allEnded) {
        historySavedRef.current = false;
        return;
      }
      if (historySavedRef.current) return;
      historySavedRef.current = true;
      window.AB.session.RunHistory.saveRunHistory({
        runType: "batch",
        title: preset.name,
        presetId: preset.id,
        presetName: preset.name,
        callerAgent,
        calleeAgent,
        conversations: runs.map((r) =>
          window.AB.session.RunHistory.conversationEntry({
            scenario: r.scenario,
            callerConversationId: r.conversationIds.caller,
            calleeConversationId: r.conversationIds.callee,
            endReason: r.endReason,
          }),
        ),
        extra: { runsCount: runs.length },
      });
    }, [allEnded]);

    return (
      <div className="batch-session">
        <div className="session-toolbar">
          <span>
            Batch "{preset.name}" -- {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"}
          </span>
          <label className="checkbox-row" title="Recommended for a batch: N simultaneous audio streams in one tab mix into a confusing jumble.">
            <input type="checkbox" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} disabled={phase === "running"} />
            Text only
          </label>
          {phase !== "running" && (
            <button className="primary" onClick={openBatchPreflight} disabled={phase === "checking"}>
              {phase === "checking" ? "Checking…" : "Check & launch batch"}
            </button>
          )}
          {phase === "running" && !textOnly && (
            <button className={allMuted ? "active" : ""} onClick={() => setAllMuted(!allMuted)} title="Mute every run's audio -- a batch of parallel audio calls mixes into a confusing jumble otherwise.">
              {allMuted ? "Unmute all" : "Mute all"}
            </button>
          )}
          {phase === "running" && (
            <button className="danger" onClick={hangUpAll} disabled={allEnded}>
              Hang up all
            </button>
          )}
        </div>

        {!textOnly && scenarios.length > 1 && (
          <div className="banner banner-warn">Running {scenarios.length} scenarios with audio in parallel in one tab will mix their sound together. Consider "Text only" for a clean batch run.</div>
        )}

        {runs.length === 0 ? (
          <p className="empty-state">Click "Check & launch batch" to preflight and start all {scenarios.length} scenarios in parallel.</p>
        ) : (
          <div className="panel-split">
            <div className="panel-list">
              <ul className="list">
                {runs.map((r) => (
                  <li key={r.id} className={r.id === selectedRunId ? "list-item-active" : ""}>
                    <button className="list-item-btn" onClick={() => setSelectedRunId(r.id)}>
                      <span className={`status-pill status-pill-${r.status}`}>{r.status}</span> {r.scenario.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel-detail">
              {selectedRun ? (
                <RunDetail run={selectedRun} textOnly={textOnly} config={config} callerAgent={callerAgent} calleeAgent={calleeAgent} onUpdate={(patch) => updateRun(selectedRun.id, patch)} />
              ) : (
                <p className="empty-state">Select a run.</p>
              )}
            </div>
          </div>
        )}

        {phase === "preflight" && (
          <BatchPreflightChecklist results={preflightResults} blocked={preflightResults.some((r) => r.blocked)} onClose={() => setPhase("idle")} onLaunchAnyway={launchAll} />
        )}
      </div>
    );
  }

  /** One run's live view: the same agent columns + transcript + timeline as a single call, plus
   * a minimal per-run operator bar (nudge, hang up). No push-to-talk/takeover here -- a batch run
   * is meant to play out unattended, not be hand-operated. */
  function RunDetail({ run, textOnly, callerAgent, calleeAgent, onUpdate }) {
    const [nudgeText, setNudgeText] = useState("");
    const isLive = run.status === "live";

    function sendNudge(text) {
      if (!text.trim() || !run.bridge) return;
      run.bridge.sendContextualNudge(text.trim());
      setNudgeText("");
    }

    return (
      <div className="run-detail">
        <div className="session-toolbar">
          <strong>{run.scenario.name}</strong>
          <span className="timer mono">{formatElapsed(run.elapsedMs)}</span>
          <span className={`status-pill status-pill-${run.status}`}>{run.status}</span>
          {run.endReason && <span className="muted small">({run.endReason})</span>}
        </div>
        <div className="session-body">
          <AgentColumn
            side="caller"
            agent={callerAgent}
            status={run.status}
            textOnly={textOnly}
            volume={run.callerVolume}
            muted={run.callerMuted}
            onVolumeChange={(v) => onUpdate({ callerVolume: v })}
            onMuteToggle={() => onUpdate({ callerMuted: !run.callerMuted })}
          />
          <CenterTranscript turns={run.turns} asrComparisonEnabled={false} expanded={false} onToggleExpanded={() => {}} />
          <AgentColumn
            side="callee"
            agent={calleeAgent}
            status={run.status}
            textOnly={textOnly}
            volume={run.calleeVolume}
            muted={run.calleeMuted}
            onVolumeChange={(v) => onUpdate({ calleeVolume: v })}
            onMuteToggle={() => onUpdate({ calleeMuted: !run.calleeMuted })}
            latencyAvgMs={run.latency.avgMs}
            latencyMaxMs={run.latency.maxMs}
          />
        </div>
        <Timeline turns={run.turns} elapsedMs={run.elapsedMs} />
        <div className="session-operator-bar">
          <input placeholder="Souffler une consigne…" value={nudgeText} onChange={(e) => setNudgeText(e.target.value)} disabled={!isLive} />
          <button onClick={() => sendNudge(nudgeText)} disabled={!isLive}>
            Send
          </button>
          <button onClick={() => sendNudge("Wrap up the call now.")} disabled={!isLive}>
            Wrap up
          </button>
          <button className="danger" onClick={() => run.bridge && run.bridge.end("operator_hangup")} disabled={!isLive}>
            Hang up this run
          </button>
        </div>
      </div>
    );
  }

  window.AB.ui.BatchSession = BatchSession;
})();
