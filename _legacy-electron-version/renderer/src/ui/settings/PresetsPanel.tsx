import React from "react";
import type { AppConfig } from "../../../../shared/types";
import { emptyPreset } from "../../model/factory";

export function PresetsPanel({ config, updateConfig }: { config: AppConfig; updateConfig: (fn: (prev: AppConfig) => AppConfig) => void }) {
  function addPreset() {
    updateConfig((prev) => ({ ...prev, presets: [...prev.presets, emptyPreset()] }));
  }
  function updatePreset(id: string, patch: Partial<AppConfig["presets"][number]>) {
    updateConfig((prev) => ({ ...prev, presets: prev.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }
  function removePreset(id: string) {
    updateConfig((prev) => ({ ...prev, presets: prev.presets.filter((p) => p.id !== id) }));
  }

  const callerAgents = config.agents.filter((a) => a.role === "caller" || a.role === "both");
  const calleeAgents = config.agents.filter((a) => a.role === "callee" || a.role === "both");

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <button onClick={addPreset}>+ New preset</button>
      </div>
      {config.presets.map((p) => (
        <div className="card" key={p.id}>
          <div className="card-row">
            <label>
              Name
              <input value={p.name} onChange={(e) => updatePreset(p.id, { name: e.target.value })} />
            </label>
            <button className="danger" onClick={() => removePreset(p.id)}>
              Remove
            </button>
          </div>
          <div className="card-row">
            <label>
              Caller agent
              <select value={p.callerAgentRefId} onChange={(e) => updatePreset(p.id, { callerAgentRefId: e.target.value })}>
                <option value="">Select…</option>
                {callerAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Callee agent
              <select value={p.calleeAgentRefId} onChange={(e) => updatePreset(p.id, { calleeAgentRefId: e.target.value })}>
                <option value="">Select…</option>
                {calleeAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scenario
              <select value={p.scenarioId} onChange={(e) => updatePreset(p.id, { scenarioId: e.target.value })}>
                <option value="">Select…</option>
                {config.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ))}
      {config.presets.length === 0 && <p className="empty-state">No preset yet. A preset bundles a caller, a callee and a scenario so you can launch a demo in one click from the Session tab.</p>}
    </div>
  );
}
