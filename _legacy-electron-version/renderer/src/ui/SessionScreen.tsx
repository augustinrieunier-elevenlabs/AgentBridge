import React, { useEffect, useRef, useState } from "react";
import type { Account, AppConfig, Turn } from "../../../shared/types";
import { Bridge, type DebugLogEntry } from "../session/Bridge";
import { runPreflight, type CheckResult } from "../session/Preflight";
import { AgentColumn } from "./AgentColumn";
import { CenterTranscript } from "./CenterTranscript";
import { Timeline } from "./Timeline";
import { DebugPanel } from "./DebugPanel";
import { PreflightChecklist } from "./PreflightChecklist";
import { formatElapsed } from "../metrics";

type SessionStatus = "idle" | "preflight" | "connecting" | "live" | "ended";

export function SessionScreen({ config, accounts }: { config: AppConfig; accounts: Account[] }) {
  const callerCandidates = config.agents.filter((a) => a.role === "caller" || a.role === "both");
  const calleeCandidates = config.agents.filter((a) => a.role === "callee" || a.role === "both");

  const [callerAgentId, setCallerAgentId] = useState<string>("");
  const [calleeAgentId, setCalleeAgentId] = useState<string>("");
  const [scenarioId, setScenarioId] = useState<string>("");
  const [presetId, setPresetId] = useState<string>("");

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [showPreflight, setShowPreflight] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [vad, setVad] = useState<{ caller: number; callee: number }>({ caller: 0, callee: 0 });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [latency, setLatency] = useState<{ avgMs?: number; maxMs?: number }>({});
  const [queueDepths, setQueueDepths] = useState({ callerQueueMs: 0, calleeQueueMs: 0 });
  const [conversationIds, setConversationIds] = useState<{ caller: string | null; callee: string | null }>({ caller: null, callee: null });
  const [formats, setFormats] = useState<{ caller?: string; callee?: string }>({});
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
  const [endReason, setEndReason] = useState<string | null>(null);

  const bridgeRef = useRef<Bridge | null>(null);

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = config.presets.find((p) => p.id === id);
    if (!preset) return;
    setCallerAgentId(preset.callerAgentRefId);
    setCalleeAgentId(preset.calleeAgentRefId);
    setScenarioId(preset.scenarioId);
  }

  const callerAgent = config.agents.find((a) => a.id === callerAgentId) ?? null;
  const calleeAgent = config.agents.find((a) => a.id === calleeAgentId) ?? null;
  const scenario = config.scenarios.find((s) => s.id === scenarioId) ?? null;
  const callerAccount = accounts.find((a) => a.id === callerAgent?.accountId);
  const calleeAccount = accounts.find((a) => a.id === calleeAgent?.accountId);

  async function openPreflight() {
    if (!callerAgent || !calleeAgent || !scenario) {
      alert("Select a caller agent, a callee agent and a scenario first.");
      return;
    }
    setStatus("preflight");
    const result = await runPreflight({ api: window.bridgeApi, accounts, callerAgent, calleeAgent, scenario });
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
      await bridge.start({ api: window.bridgeApi, accounts, callerAgent, calleeAgent, scenario });
      setFormats({ caller: callerAgent.cachedMeta?.outputFormat, callee: calleeAgent.cachedMeta?.outputFormat });
    } catch (err) {
      alert(`Could not start the session: ${(err as Error).message}`);
      setStatus("idle");
    }
  }

  function hangUp() {
    bridgeRef.current?.end("operator_hangup");
  }

  useEffect(() => {
    return () => bridgeRef.current?.end("unmount");
  }, []);

  // Push-to-talk on spacebar, ignored while typing in a form field.
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || status !== "live" || isTypingTarget(e.target) || pttHeld) return;
      e.preventDefault();
      setPttHeld(true);
      bridgeRef.current?.startPushToTalk().catch((err) => alert(`Microphone error: ${(err as Error).message}`));
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setPttHeld(false);
      bridgeRef.current?.stopPushToTalk();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [status, pttHeld]);

  async function toggleTakeover() {
    const next = !takeover;
    setTakeover(next);
    try {
      await bridgeRef.current?.setTakeover(next);
    } catch (err) {
      setTakeover(false);
      alert(`Microphone error: ${(err as Error).message}`);
    }
  }

  function togglePause() {
    const next = !paused;
    setPaused(next);
    bridgeRef.current?.setBridgePaused(next);
  }

  function sendNudge(text: string) {
    if (!text.trim()) return;
    bridgeRef.current?.sendContextualNudge(text.trim());
    setNudgeText("");
  }

  async function exportSession(format: "json" | "markdown") {
    const payload = {
      scenario,
      agents: {
        caller: callerAgent ? { agentId: callerAgent.agentId, label: callerAgent.label, accountLabel: callerAccount?.label } : null,
        callee: calleeAgent ? { agentId: calleeAgent.agentId, label: calleeAgent.label, accountLabel: calleeAccount?.label } : null,
      },
      turns,
      metrics: { elapsedMs, latency },
      conversationIds,
      endReason,
      exportedAt: new Date().toISOString(),
    };
    if (format === "json") {
      await window.bridgeApi.exports.save(scenario?.name ?? "session", payload);
      alert("Exported as JSON to the app's export folder (see History tab).");
    } else {
      const md = [
        `# Agent Bridge session — ${scenario?.name ?? ""}`,
        `Exported ${payload.exportedAt}`,
        "",
        ...turns.map((t) => `**${t.speaker}** (${formatElapsed(t.startedAt)}): ${t.text}`),
      ].join("\n\n");
      await navigator.clipboard.writeText(md);
      alert("Markdown copied to clipboard.");
    }
  }

  async function fetchOfficialTranscript() {
    if (!calleeAccount?.hasKey || !conversationIds.callee) {
      alert("No API key on the callee account, or no conversation id yet -- keeping the real-time transcript.");
      return;
    }
    const result = await window.bridgeApi.session.fetchFinalTranscript(calleeAccount.id, conversationIds.callee);
    console.log("Official transcript", result);
    alert(`Fetched ${result.transcript.length} official turns (see DevTools console). Comparison UI is left as a follow-up.`);
  }

  const isLive = status === "live";
  const isEnded = status === "ended";

  return (
    <div className="session-screen">
      {deadlockWarning && (
        <div className="banner banner-warn">
          Both sides have been silent for a while. <button onClick={() => { sendNudge("Wrap up the call now."); setDeadlockWarning(false); }}>Nudge the caller to wrap up</button>
          <button onClick={() => setDeadlockWarning(false)}>Dismiss</button>
        </div>
      )}

      <div className="session-toolbar">
        <select value={presetId} onChange={(e) => applyPreset(e.target.value)} disabled={isLive}>
          <option value="">Select a preset…</option>
          {config.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
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
        <span className="timer mono">{formatElapsed(elapsedMs)}</span>
        <span className={`status-pill status-pill-${status}`}>{status}</span>
        {!isLive && status !== "connecting" && <button className="primary" onClick={openPreflight}>Launch</button>}
        {(isLive || status === "connecting") && <button className="danger" onClick={hangUp}>Hang up</button>}
      </div>

      <div className="session-body">
        <AgentColumn
          side="caller"
          agent={callerAgent}
          accountLabel={callerAccount?.label ?? ""}
          vadScore={vad.caller}
          status={status}
          volume={callerVolume}
          muted={callerMuted}
          onVolumeChange={(v) => {
            setCallerVolume(v);
            bridgeRef.current?.setCallerVolume(v);
          }}
          onMuteToggle={() => {
            const next = !callerMuted;
            setCallerMuted(next);
            bridgeRef.current?.setCallerMuted(next);
          }}
        />
        <CenterTranscript turns={turns} asrComparisonEnabled={config.settings.asrComparisonEnabled} expanded={expanded} onToggleExpanded={() => setExpanded((v) => !v)} />
        <AgentColumn
          side="callee"
          agent={calleeAgent}
          accountLabel={calleeAccount?.label ?? ""}
          vadScore={vad.callee}
          status={status}
          volume={calleeVolume}
          muted={calleeMuted}
          onVolumeChange={(v) => {
            setCalleeVolume(v);
            bridgeRef.current?.setCalleeVolume(v);
          }}
          onMuteToggle={() => {
            const next = !calleeMuted;
            setCalleeMuted(next);
            bridgeRef.current?.setCalleeMuted(next);
          }}
          latencyAvgMs={latency.avgMs}
          latencyMaxMs={latency.maxMs}
        />
      </div>

      <Timeline turns={turns} elapsedMs={elapsedMs} />

      <div className="session-operator-bar">
        <button className={pttHeld ? "active" : ""} onMouseDown={() => bridgeRef.current?.startPushToTalk()} onMouseUp={() => bridgeRef.current?.stopPushToTalk()} disabled={!isLive}>
          Push-to-talk (hold or Space)
        </button>
        <button className={takeover ? "active" : ""} onClick={toggleTakeover} disabled={!isLive}>
          Takeover
        </button>
        <button className={paused ? "active" : ""} onClick={togglePause} disabled={!isLive}>
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
          <span>Session ended ({endReason}).</span>
          <button onClick={() => exportSession("json")}>Export JSON</button>
          <button onClick={() => exportSession("markdown")}>Copy Markdown</button>
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

      {showPreflight && (
        <PreflightChecklist
          checks={checks}
          blocked={checks.some((c) => c.status === "fail")}
          onClose={() => setShowPreflight(false)}
          onLaunchAnyway={launch}
        />
      )}
    </div>
  );
}
