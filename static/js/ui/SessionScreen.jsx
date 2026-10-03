(function () {
  const { useEffect, useRef, useState } = React;
  const Bridge = window.AB.session.Bridge;
  const runPreflight = window.AB.session.runPreflight;
  const AgentColumn = window.AB.ui.AgentColumn;
  const CenterTranscript = window.AB.ui.CenterTranscript;
  const Timeline = window.AB.ui.Timeline;
  const DebugPanel = window.AB.ui.DebugPanel;
  const PreflightChecklist = window.AB.ui.PreflightChecklist;
  const BatchSession = window.AB.ui.BatchSession;
  const BenchmarkSession = window.AB.ui.BenchmarkSession;
  const formatElapsed = window.AB.formatElapsed;

  function SessionScreen({ config, accounts }) {
    const callerCandidates = config.agents.filter((a) => a.role === "caller" || a.role === "both");
    const calleeCandidates = config.agents.filter((a) => a.role === "callee" || a.role === "both");

    const [callerAgentId, setCallerAgentId] = useState("");
    const [calleeAgentId, setCalleeAgentId] = useState("");
    const [scenarioId, setScenarioId] = useState("");
    const [presetId, setPresetId] = useState("");
    const [benchmarkId, setBenchmarkId] = useState("");
    const [textOnly, setTextOnly] = useState(false);

    const [status, setStatus] = useState("idle");
    const [checks, setChecks] = useState([]);
    const [showPreflight, setShowPreflight] = useState(false);
    const [turns, setTurns] = useState([]);
    const [debugLog, setDebugLog] = useState([]);
    const [vad, setVad] = useState({ caller: 0, callee: 0 });
    const [elapsedMs, setElapsedMs] = useState(0);
    const [latency, setLatency] = useState({});
    const [queueDepths, setQueueDepths] = useState({ callerQueueMs: 0, calleeQueueMs: 0 });
    const [conversationIds, setConversationIds] = useState({ caller: null, callee: null });
    const [formats, setFormats] = useState({});
    const [expanded, setExpanded] = useState(false);
    const [debugOpen, setDebugOpen] = useState(false);
    const [pttHeld, setPttHeld] = useState(false);
    const [takeover, setTakeover] = useState(false);
    const [paused, setPaused] = useState(false);
    const [callerMuted, setCallerMuted] = useState(false);
    const [calleeMuted, setCalleeMuted] = useState(false);
    const [callerVolume, setCallerVolume] = useState(1);
    const [calleeVolume, setCalleeVolume] = useState(1);
    const [deadlockWarning, setDeadlockWarning] = useState(false);
    const [nudgeText, setNudgeText] = useState("");
    const [endReason, setEndReason] = useState(null);

    const bridgeRef = useRef(null);
    const historySavedRef = useRef(false);

    function applyPreset(id) {
      setBenchmarkId(""); // mutually exclusive -- a benchmark drives its own caller/callee/scenarios
      setPresetId(id);
      const preset = config.presets.find((p) => p.id === id);
      if (!preset) return;
      setCallerAgentId(preset.callerAgentRefId);
      setCalleeAgentId(preset.calleeAgentRefId);
      // A batch preset (>1 scenario) is driven entirely by BatchSession below instead of the
      // single-call scenario select.
      setScenarioId(preset.scenarioIds.length === 1 ? preset.scenarioIds[0] : "");
    }

    function selectBenchmark(id) {
      setPresetId(""); // mutually exclusive -- see applyPreset
      setCallerAgentId("");
      setCalleeAgentId("");
      setScenarioId("");
      setBenchmarkId(id);
    }

    const callerAgent = config.agents.find((a) => a.id === callerAgentId) || null;
    const calleeAgent = config.agents.find((a) => a.id === calleeAgentId) || null;
    const scenario = config.scenarios.find((s) => s.id === scenarioId) || null;
    const callerAccount = accounts.find((a) => a.id === (callerAgent && callerAgent.accountId));
    const calleeAccount = accounts.find((a) => a.id === (calleeAgent && calleeAgent.accountId));

    // The callee's own hard-coded dynamic variables, overridden per-preset
    // when the currently selected preset provides one (Settings → Agents /
    // Settings → Presets; see also Preflight check "callee-dynamic-variables").
    const activePreset = config.presets.find((p) => p.id === presetId) || null;
    const isBatchPreset = Boolean(activePreset && activePreset.scenarioIds.length > 1);
    const activeBenchmark = config.benchmarks.find((b) => b.id === benchmarkId) || null;
    const isBenchmarkMode = Boolean(activeBenchmark);
    const calleeDynamicVariables = window.AB.model.resolveCalleeDynamicVariables(calleeAgent, activePreset, scenarioId);

    async function openPreflight() {
      if (!callerAgent || !calleeAgent || !scenario) {
        alert("Select a caller agent, a callee agent and a scenario first.");
        return;
      }
      setStatus("preflight");
      const result = await runPreflight({ api: window.AB.api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables });
      setChecks(result.checks);
      setShowPreflight(true);
      setStatus("idle");
    }

    async function launch() {
      if (!callerAgent || !calleeAgent || !scenario) return;
      setShowPreflight(false);
      setStatus("connecting");
      setTurns([]);
      setDebugLog([]);
      setEndReason(null);

      const bridge = new Bridge({
        onStatusChange: (s) => setStatus(s === "live" ? "live" : s === "ended" ? "ended" : "connecting"),
        onTranscriptUpdate: setTurns,
        onDebugLog: (entry) => setDebugLog((prev) => [...prev.slice(-500), entry]),
        onMetrics: (m) => {
          setElapsedMs(m.elapsedSec * 1000);
          setLatency({ avgMs: m.calleeLatencyAvgMs, maxMs: m.calleeLatencyMaxMs });
          setQueueDepths({ callerQueueMs: m.callerQueueMs, calleeQueueMs: m.calleeQueueMs });
        },
        onEnded: (reason) => {
          setEndReason(reason);
          setStatus("ended");
        },
        onDeadlock: () => setDeadlockWarning(true),
        onConversationIds: (callerId, calleeId) => setConversationIds({ caller: callerId, callee: calleeId }),
        onVadScore: (agent, score) => setVad((prev) => ({ ...prev, [agent]: score })),
      });
      bridgeRef.current = bridge;

      try {
        await bridge.start({ api: window.AB.api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables, textOnly });
        setFormats({ caller: callerAgent.cachedMeta && callerAgent.cachedMeta.output_format, callee: calleeAgent.cachedMeta && calleeAgent.cachedMeta.output_format });
      } catch (err) {
        alert(`Could not start the session: ${err.message}`);
        setStatus("idle");
      }
    }

    function hangUp() {
      if (bridgeRef.current) bridgeRef.current.end("operator_hangup");
    }

    useEffect(() => {
      return () => {
        if (bridgeRef.current) bridgeRef.current.end("unmount");
      };
    }, []);

    // Auto-save every single-call session to History the instant it ends -- no manual export
    // needed (see session/RunHistory.js). Guarded by a ref, not just `status`, so a re-render
    // while still "ended" doesn't save twice; the ref resets the moment a new launch moves off
    // "ended", so a second session run in the same screen still gets its own history entry.
    useEffect(() => {
      if (status !== "ended") {
        historySavedRef.current = false;
        return;
      }
      if (historySavedRef.current || !scenario) return;
      historySavedRef.current = true;
      window.AB.session.RunHistory.saveRunHistory({
        runType: "session",
        title: scenario.name,
        callerAgent,
        calleeAgent,
        conversations: [
          window.AB.session.RunHistory.conversationEntry({
            scenario,
            callerConversationId: conversationIds.caller,
            calleeConversationId: conversationIds.callee,
            endReason,
          }),
        ],
        extra: { turns, metrics: { elapsedMs, latency } },
      });
    }, [status]);

    // Push-to-talk on spacebar, ignored while typing in a form field.
    useEffect(() => {
      function isTypingTarget(target) {
        return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      }
      function onKeyDown(e) {
        if (e.code !== "Space" || status !== "live" || textOnly || isTypingTarget(e.target) || pttHeld) return;
        e.preventDefault();
        setPttHeld(true);
        bridgeRef.current.startPushToTalk().catch((err) => alert(`Microphone error: ${err.message}`));
      }
      function onKeyUp(e) {
        if (e.code !== "Space") return;
        setPttHeld(false);
        if (bridgeRef.current) bridgeRef.current.stopPushToTalk();
      }
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      };
    }, [status, pttHeld, textOnly]);

    async function toggleTakeover() {
      const next = !takeover;
      setTakeover(next);
      try {
        await bridgeRef.current.setTakeover(next);
      } catch (err) {
        setTakeover(false);
        alert(`Microphone error: ${err.message}`);
      }
    }

    function togglePause() {
      const next = !paused;
      setPaused(next);
      bridgeRef.current.setBridgePaused(next);
    }

    function sendNudge(text) {
      if (!text.trim()) return;
      bridgeRef.current.sendContextualNudge(text.trim());
      setNudgeText("");
    }

    // JSON is auto-saved to History the instant the session ends (see the useEffect above) --
    // this is just the clipboard convenience, unrelated to persistence.
    async function copyMarkdown() {
      const exportedAt = new Date().toISOString();
      const md = [`# Agent Bridge session — ${scenario ? scenario.name : ""}`, `Exported ${exportedAt}`, "", ...turns.map((t) => `**${t.speaker}** (${formatElapsed(t.startedAt)}): ${t.text}`)].join("\n\n");
      await navigator.clipboard.writeText(md);
      alert("Markdown copied to clipboard.");
    }

    async function fetchOfficialTranscript() {
      if (!calleeAccount || !calleeAccount.has_key || !conversationIds.callee) {
        alert("No API key on the callee account, or no conversation id yet -- keeping the real-time transcript.");
        return;
      }
      const result = await window.AB.api.session.fetchFinalTranscript(calleeAccount.id, conversationIds.callee);
      console.log("Official transcript", result);
      alert(`Fetched ${result.transcript.length} official turns (see DevTools console). Comparison UI is left as a follow-up.`);
    }

    const isLive = status === "live";
    const isEnded = status === "ended";

    return (
      <div className="session-screen">
        {deadlockWarning && (
          <div className="banner banner-warn">
            Both sides have been silent for a while.{" "}
            <button
              onClick={() => {
                sendNudge("Wrap up the call now.");
                setDeadlockWarning(false);
              }}
            >
              Nudge the caller to wrap up
            </button>
            <button onClick={() => setDeadlockWarning(false)}>Dismiss</button>
          </div>
        )}

        <div className="session-toolbar">
          <select value={presetId} onChange={(e) => applyPreset(e.target.value)} disabled={isLive || isBenchmarkMode}>
            <option value="">Select a preset…</option>
            {config.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.scenarioIds.length > 1 ? ` (batch, ${p.scenarioIds.length})` : ""}
              </option>
            ))}
          </select>
          <select value={benchmarkId} onChange={(e) => selectBenchmark(e.target.value)} disabled={isLive}>
            <option value="">Select a benchmark…</option>
            {config.benchmarks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {!isBenchmarkMode && !isBatchPreset && (
            <>
              <select value={callerAgentId} onChange={(e) => setCallerAgentId(e.target.value)} disabled={isLive}>
                <option value="">Caller agent…</option>
                {callerCandidates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select value={calleeAgentId} onChange={(e) => setCalleeAgentId(e.target.value)} disabled={isLive}>
                <option value="">Callee agent…</option>
                {calleeCandidates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} disabled={isLive}>
                <option value="">Scenario…</option>
                {config.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <label className="checkbox-row" title="No audio: agent_response text is relayed directly, much faster to iterate.">
                <input type="checkbox" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} disabled={isLive} />
                Text only
              </label>
              <span className="timer mono">{formatElapsed(elapsedMs)}</span>
              <span className={`status-pill status-pill-${status}`}>{status}</span>
              {!isLive && status !== "connecting" && (
                <button className="primary" onClick={openPreflight}>
                  Launch
                </button>
              )}
              {(isLive || status === "connecting") && (
                <button className="danger" onClick={hangUp}>
                  Hang up
                </button>
              )}
            </>
          )}
        </div>

        {isBenchmarkMode && <BenchmarkSession config={config} accounts={accounts} benchmark={activeBenchmark} />}

        {!isBenchmarkMode && isBatchPreset && <BatchSession config={config} accounts={accounts} preset={activePreset} callerAgent={callerAgent} calleeAgent={calleeAgent} />}

        {!isBenchmarkMode && !isBatchPreset && (
          <>
        <div className="session-body">
          <AgentColumn
            side="caller"
            agent={callerAgent}
            accountLabel={(callerAccount && callerAccount.label) || ""}
            vadScore={vad.caller}
            status={status}
            textOnly={textOnly}
            volume={callerVolume}
            muted={callerMuted}
            onVolumeChange={(v) => {
              setCallerVolume(v);
              bridgeRef.current.setCallerVolume(v);
            }}
            onMuteToggle={() => {
              const next = !callerMuted;
              setCallerMuted(next);
              bridgeRef.current.setCallerMuted(next);
            }}
          />
          <CenterTranscript turns={turns} asrComparisonEnabled={config.settings.asr_comparison_enabled} expanded={expanded} onToggleExpanded={() => setExpanded((v) => !v)} />
          <AgentColumn
            side="callee"
            agent={calleeAgent}
            accountLabel={(calleeAccount && calleeAccount.label) || ""}
            vadScore={vad.callee}
            status={status}
            textOnly={textOnly}
            volume={calleeVolume}
            muted={calleeMuted}
            onVolumeChange={(v) => {
              setCalleeVolume(v);
              bridgeRef.current.setCalleeVolume(v);
            }}
            onMuteToggle={() => {
              const next = !calleeMuted;
              setCalleeMuted(next);
              bridgeRef.current.setCalleeMuted(next);
            }}
            latencyAvgMs={latency.avgMs}
            latencyMaxMs={latency.maxMs}
          />
        </div>

        <Timeline turns={turns} elapsedMs={elapsedMs} />

        <div className="session-operator-bar">
          <button
            className={pttHeld ? "active" : ""}
            onMouseDown={() => bridgeRef.current.startPushToTalk()}
            onMouseUp={() => bridgeRef.current.stopPushToTalk()}
            disabled={!isLive || textOnly}
            title={textOnly ? "Not available in text-only mode (no mic/audio)" : ""}
          >
            Push-to-talk (hold or Space)
          </button>
          <button className={takeover ? "active" : ""} onClick={toggleTakeover} disabled={!isLive || textOnly} title={textOnly ? "Not available in text-only mode (no mic/audio)" : ""}>
            Takeover
          </button>
          <button className={paused ? "active" : ""} onClick={togglePause} disabled={!isLive || textOnly} title={textOnly ? "Not available in text-only mode (no audio to mute)" : ""}>
            Pause bridge
          </button>
          <input placeholder="Souffler une consigne…" value={nudgeText} onChange={(e) => setNudgeText(e.target.value)} disabled={!isLive} />
          <button onClick={() => sendNudge(nudgeText)} disabled={!isLive}>
            Send
          </button>
          <button onClick={() => sendNudge("Ask about the next question now.")} disabled={!isLive}>
            Next question
          </button>
          <button onClick={() => sendNudge("Wrap up the call now.")} disabled={!isLive}>
            Wrap up
          </button>
          <button onClick={() => sendNudge("Be more in a hurry from now on.")} disabled={!isLive}>
            Be more in a hurry
          </button>
        </div>

        {isEnded && (
          <div className="session-end-bar">
            <span>Session ended ({endReason}) -- saved to History.</span>
            <button onClick={copyMarkdown}>Copy Markdown</button>
            <button onClick={fetchOfficialTranscript}>Fetch official transcript</button>
          </div>
        )}

        <DebugPanel
          open={debugOpen}
          onToggle={() => setDebugOpen((v) => !v)}
          log={debugLog}
          callerConversationId={conversationIds.caller}
          calleeConversationId={conversationIds.callee}
          queueDepths={queueDepths}
          negotiatedFormats={formats}
        />

        {showPreflight && <PreflightChecklist checks={checks} blocked={checks.some((c) => c.status === "fail")} onClose={() => setShowPreflight(false)} onLaunchAnyway={launch} />}
          </>
        )}
      </div>
    );
  }

  window.AB.ui.SessionScreen = SessionScreen;
})();
