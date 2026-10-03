(function () {
  const { useState } = React;
  const emptyAgentRef = window.AB.model.emptyAgentRef;
  const DynamicVariablesEditor = window.AB.ui.settings.DynamicVariablesEditor;

  function AgentsPanel({ config, accounts, updateConfig }) {
    const [remoteAgents, setRemoteAgents] = useState({});
    const [inspecting, setInspecting] = useState(null);

    function addAgent() {
      updateConfig((prev) => ({ ...prev, agents: [...prev.agents, emptyAgentRef()] }));
    }

    function updateAgent(id, patch) {
      updateConfig((prev) => ({ ...prev, agents: prev.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    }

    function removeAgent(id) {
      updateConfig((prev) => ({ ...prev, agents: prev.agents.filter((a) => a.id !== id) }));
    }

    async function loadRemote(accountId) {
      const list = await window.AB.api.agents.listRemote(accountId);
      setRemoteAgents((s) => ({ ...s, [accountId]: list }));
    }

    async function inspect(agent) {
      if (!agent.accountId || !agent.agentId) return;
      setInspecting(agent.id);
      try {
        const meta = await window.AB.api.agents.inspect(agent.accountId, agent.agentId);
        updateAgent(agent.id, { cachedMeta: meta });
      } catch (err) {
        alert(`Could not inspect agent: ${err.message}`);
      } finally {
        setInspecting(null);
      }
    }

    return (
      <div className="panel">
        <div className="panel-toolbar">
          <button onClick={addAgent}>+ Add agent</button>
        </div>
        {config.agents.map((agent) => (
          <div className="card" key={agent.id}>
            <div className="card-row">
              <label>
                Label
                <input value={agent.label} onChange={(e) => updateAgent(agent.id, { label: e.target.value })} placeholder="e.g. Hotel receptionist v3" />
              </label>
              <label>
                Role
                <select value={agent.role} onChange={(e) => updateAgent(agent.id, { role: e.target.value })}>
                  <option value="caller">Caller</option>
                  <option value="callee">Callee</option>
                  <option value="both">Both</option>
                </select>
              </label>
              {(agent.role === "caller" || agent.role === "both") && (
                <label title="Which caller architecture this agent_id is built for -- restricts which scenarios can be assigned to it in a preset.">
                  Caller type
                  <select value={agent.callerKind} onChange={(e) => updateAgent(agent.id, { callerKind: e.target.value })}>
                    <option value="deterministic">Deterministic (scripted questions)</option>
                    <option value="prompt_override">Prompt override (free-form)</option>
                  </select>
                </label>
              )}
              <button className="danger" onClick={() => removeAgent(agent.id)}>
                Remove
              </button>
            </div>
            <div className="card-row">
              <label>
                Account
                <select value={agent.accountId} onChange={(e) => updateAgent(agent.id, { accountId: e.target.value })}>
                  <option value="">Select an account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Agent ID
                <input value={agent.agentId} onChange={(e) => updateAgent(agent.id, { agentId: e.target.value })} placeholder="paste an agent_id" list={`remote-${agent.id}`} />
                <datalist id={`remote-${agent.id}`}>
                  {(remoteAgents[agent.accountId] || []).map((r) => (
                    <option key={r.agent_id} value={r.agent_id}>
                      {r.name}
                    </option>
                  ))}
                </datalist>
              </label>
              <button onClick={() => loadRemote(agent.accountId)} disabled={!agent.accountId}>
                List agents on this account
              </button>
              <button onClick={() => inspect(agent)} disabled={!agent.accountId || !agent.agentId || inspecting === agent.id}>
                {inspecting === agent.id ? "Checking…" : "Verify agent"}
              </button>
            </div>
            {agent.cachedMeta && (
              <div className="meta-box">
                <strong>{agent.cachedMeta.name}</strong> — in: {agent.cachedMeta.input_format}, out: {agent.cachedMeta.output_format}, language: {agent.cachedMeta.language || "?"}
                <br />
                Overrides enabled: {Object.entries(agent.cachedMeta.overrides_enabled).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}
              </div>
            )}
            {agent.cachedMeta && (agent.role === "callee" || agent.role === "both") && (
              <DynamicVariablesEditor
                title="Dynamic variables (sent on every session with this agent)"
                helpText="Introspected from the agent's dashboard. A variable marked 'required' has no default there, so the agent's prompt would see it empty unless you set a value here or override it per preset."
                placeholders={agent.cachedMeta.dynamic_variable_placeholders}
                values={agent.dynamicVariables}
                onChange={(next) => updateAgent(agent.id, { dynamicVariables: next })}
              />
            )}
          </div>
        ))}
        {config.agents.length === 0 && <p className="empty-state">No agent configured yet. Add one, then link it to an account and an agent_id.</p>}
      </div>
    );
  }

  window.AB.ui.settings.AgentsPanel = AgentsPanel;
})();
