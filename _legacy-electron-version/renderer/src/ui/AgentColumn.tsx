import React from "react";
import type { AgentRef } from "../../../shared/types";

export function AgentColumn({
  side,
  agent,
  accountLabel,
  vadScore,
  status,
  volume,
  muted,
  onVolumeChange,
  onMuteToggle,
  latencyAvgMs,
  latencyMaxMs,
  detectedLanguage,
}: {
  side: "caller" | "callee";
  agent: AgentRef | null;
  accountLabel: string;
  vadScore: number;
  status: string;
  volume: number;
  muted: boolean;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  latencyAvgMs?: number;
  latencyMaxMs?: number;
  detectedLanguage?: string;
}) {
  return (
    <div className={`agent-column agent-column-${side}`}>
      <div className="agent-column-header">
        <strong>{agent?.label || (side === "caller" ? "Caller" : "Callee")}</strong>
        <span className="muted small">{accountLabel}</span>
      </div>
      <div className="vu-meter">
        <div className="vu-meter-fill" style={{ width: `${Math.round(Math.min(1, vadScore) * 100)}%` }} />
      </div>
      <div className="small muted">{status}</div>
      {side === "callee" && (
        <div className="small">
          {detectedLanguage && <div>Detected language: {detectedLanguage}</div>}
          {typeof latencyAvgMs === "number" && (
            <div>
              Latency avg {Math.round(latencyAvgMs)} ms / max {Math.round(latencyMaxMs ?? 0)} ms
            </div>
          )}
        </div>
      )}
      <div className="agent-column-controls">
        <label className="checkbox-row">
          <input type="checkbox" checked={muted} onChange={onMuteToggle} />
          Mute
        </label>
        <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => onVolumeChange(Number(e.target.value))} disabled={muted} />
      </div>
    </div>
  );
}
