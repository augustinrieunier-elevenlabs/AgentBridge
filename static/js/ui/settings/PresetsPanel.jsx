(function () {
  const { useState } = React;
  const emptyPreset = window.AB.model.emptyPreset;
  const clonePreset = window.AB.model.clonePreset;
  const DynamicVariablesEditor = window.AB.ui.settings.DynamicVariablesEditor;

  function PresetsPanel({ config, updateConfig }) {
    const [selectedId, setSelectedId] = useState(config.presets[0] ? config.presets[0].id : null);

    function addPreset() {
      const next = emptyPreset();
      updateConfig((prev) => ({ ...prev, presets: [...prev.presets, next] }));
      setSelectedId(next.id);
    }
    function updatePreset(id, patch) {
      updateConfig((prev) => ({ ...prev, presets: prev.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    }
    function duplicatePreset(id) {
      const original = config.presets.find((p) => p.id === id);
      if (!original) return;
      const clone = clonePreset(original);
      updateConfig((prev) => ({ ...prev, presets: [...prev.presets, clone] }));
      setSelectedId(clone.id);
    }
    function removePreset(id) {
      updateConfig((prev) => ({ ...prev, presets: prev.presets.filter((p) => p.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    }
    function setCallerAgent(preset, callerAgentRefId) {
      const callerAgent = config.agents.find((a) => a.id === callerAgentRefId);
      if (!callerAgent) {
        updatePreset(preset.id, { callerAgentRefId });
        return;
      }
      const kept = [];
      const dropped = [];
      for (const id of preset.scenarioIds) {
        const scenario = config.scenarios.find((s) => s.id === id);
        if (scenario && scenario.kind !== callerAgent.callerKind) dropped.push(scenario.name);
        else kept.push(id);
      }
      if (dropped.length > 0) {
        alert(`Removed from this preset: ${dropped.join(", ")} -- wrong scenario type for a "${callerAgent.callerKind}" caller agent.`);
      }
      updatePreset(preset.id, { callerAgentRefId, scenarioIds: kept });
    }
    function toggleScenario(preset, scenarioId) {
      const has = preset.scenarioIds.includes(scenarioId);
      updatePreset(preset.id, {
        scenarioIds: has ? preset.scenarioIds.filter((id) => id !== scenarioId) : [...preset.scenarioIds, scenarioId],
      });
    }
    function setScenarioOverride(preset, scenarioId, next) {
      updatePreset(preset.id, {
        calleeDynamicVariableOverridesByScenario: { ...preset.calleeDynamicVariableOverridesByScenario, [scenarioId]: next },
      });
    }

    const callerAgents = config.agents.filter((a) => a.role === "caller" || a.role === "both");
    const calleeAgents = config.agents.filter((a) => a.role === "callee" || a.role === "both");
    const selected = config.presets.find((p) => p.id === selectedId) || null;

    return (
      <div className="panel panel-split">
        <div className="panel-list">
          <div className="panel-toolbar">
            <button onClick={addPreset}>+ New preset</button>
          </div>
          <ul className="list">
            {config.presets.map((p) => (
              <li key={p.id} className={p.id === selectedId ? "list-item-active" : ""}>
                <button className="list-item-btn" onClick={() => setSelectedId(p.id)}>
                  {p.name || "Untitled preset"}
                </button>
                <button className="small" title="Clone this preset, including its dynamic-variable overrides" onClick={() => duplicatePreset(p.id)}>
                  ⧉
                </button>
                <button className="danger small" onClick={() => removePreset(p.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          {config.presets.length === 0 && <p className="panel-help">No preset yet.</p>}
        </div>
        <div className="panel-detail">
          {selected ? (
            <PresetEditor
              preset={selected}
              config={config}
              callerAgents={callerAgents}
              calleeAgents={calleeAgents}
              updatePreset={updatePreset}
              setCallerAgent={setCallerAgent}
              toggleScenario={toggleScenario}
              setScenarioOverride={setScenarioOverride}
            />
          ) : (
            <p className="empty-state">Select or create a preset. A preset bundles a caller, a callee and a scenario so you can launch a demo in one click from the Session tab.</p>
          )}
        </div>
      </div>
    );
  }

  function PresetEditor({ preset: p, config, callerAgents, calleeAgents, updatePreset, setCallerAgent, toggleScenario, setScenarioOverride }) {
    const calleeAgent = config.agents.find((a) => a.id === p.calleeAgentRefId);
    const callerAgent = config.agents.find((a) => a.id === p.callerAgentRefId);
    const assignableScenarios = callerAgent ? config.scenarios.filter((s) => s.kind === callerAgent.callerKind) : config.scenarios;

    return (
      <div className="card">
        <div className="card-row">
          <label className="grow">
            Name
            <input value={p.name} onChange={(e) => updatePreset(p.id, { name: e.target.value })} />
          </label>
        </div>
        <div className="card-row">
          <label>
            Caller agent
            <select value={p.callerAgentRefId} onChange={(e) => setCallerAgent(p, e.target.value)}>
              <option value="">Select…</option>
              {callerAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.callerKind === "prompt_override" ? "prompt override" : "deterministic"})
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
            Noise profile
            <select value={p.noiseProfileRefId} onChange={(e) => updatePreset(p.id, { noiseProfileRefId: e.target.value })}>
              <option value="">None</option>
              {config.noiseProfiles.map((np) => (
                <option key={np.id} value={np.id}>
                  {np.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {p.noiseProfileRefId && (
          <p className="panel-help">Simulates a bad connection from the start of the call, in audio mode (ignored in text-only) -- see Settings → Noise. Still overridable live once a call is running.</p>
        )}
        {calleeAgent && calleeAgent.cachedMeta && (
          <DynamicVariablesEditor
            title="Callee dynamic variables -- default for this preset"
            helpText={`Used for any selected scenario below that doesn't set its own value. Leave a field empty to fall back to ${
              calleeAgent.label || "the callee agent"
            }'s own default (set in Settings → Agents, or the dashboard default shown as placeholder).`}
            placeholders={calleeAgent.cachedMeta.dynamic_variable_placeholders}
            values={p.calleeDynamicVariableOverrides}
            inheritedValues={calleeAgent.dynamicVariables}
            onChange={(next) => updatePreset(p.id, { calleeDynamicVariableOverrides: next })}
          />
        )}
        {calleeAgent && !calleeAgent.cachedMeta && (
          <p className="panel-help">Run "Verify agent" on {calleeAgent.label || "this callee"} in Settings → Agents to see and override its dynamic variables here.</p>
        )}

        <fieldset>
          <legend>
            Scenarios ({p.scenarioIds.length} selected{p.scenarioIds.length > 1 ? " -- batch preset, runs in parallel from Session" : ""})
          </legend>
          {!callerAgent && <p className="panel-help">Pick a caller agent above to see only the scenarios it can run (deterministic vs prompt override).</p>}
          {assignableScenarios.length === 0 && (
            <p className="panel-help">No {callerAgent ? `"${callerAgent.callerKind}"` : ""} scenarios yet -- create one in Settings → Scenarios first.</p>
          )}
          {assignableScenarios.map((s) => {
            const isSelected = p.scenarioIds.includes(s.id);
            const hasVariables = calleeAgent && calleeAgent.cachedMeta && Object.keys(calleeAgent.cachedMeta.dynamic_variable_placeholders || {}).length > 0;
            const presetDefault = { ...(calleeAgent && calleeAgent.dynamicVariables), ...p.calleeDynamicVariableOverrides };
            return (
              <div key={s.id}>
                <label className="checkbox-row">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleScenario(p, s.id)} />
                  {s.name}
                </label>
                {isSelected && hasVariables && (
                  <div className="scenario-override">
                    <DynamicVariablesEditor
                      title={`Callee dynamic variables -- override for "${s.name}"`}
                      helpText="Takes precedence over the preset default above, for this scenario only. Leave empty to just use the default."
                      placeholders={calleeAgent.cachedMeta.dynamic_variable_placeholders}
                      values={p.calleeDynamicVariableOverridesByScenario[s.id] || {}}
                      inheritedValues={presetDefault}
                      onChange={(next) => setScenarioOverride(p, s.id, next)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      </div>
    );
  }

  window.AB.ui.settings.PresetsPanel = PresetsPanel;
})();
