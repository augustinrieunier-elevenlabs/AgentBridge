import React, { useState } from "react";
import type { Account, AgentRef, AppConfig } from "../../../../shared/types";
import { emptyAgentRef } from "../../model/factory";

export function AgentsPanel({ config, accounts, updateConfig }: { config: AppConfig; accounts: Account[]; updateConfig: (fn: (prev: AppConfig) => AppConfig) => void }) {
  const [remoteAgents, setRemoteAgents] = useState<Record<string, { agentId: string; name: string }[]>>({});
  const [inspecting, setInspecting] = useState<string | null>(null);

  function addAgent() {
    updateConfig((prev) => ({ ...prev, agents: [...prev.agents, emptyAgentRef()] }));
  }

  function updateAgent(id: string, patch: Partial<AgentRef>) {
    updateConfig((prev) => ({ ...prev, agents: prev.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }

  function removeAgent(id: string) {
    updateConfig((prev) => ({ ...prev, agents: prev.agents.filter((a) => a.id !== id) }));
  }

  async function loadRemote(accountId: string) {
    const list = await window.bridgeApi.agents.listRemote(accountId);
    setRemoteAgents((s) => ({ ...s, [accountId]: list }));
  }

  async function inspect(agent: AgentRef) {
    if (!agent.accountId || !agent.agentId) return;
    setInspecting(agent.id);
    try {
      const meta = await window.bridgeApi.agents.inspect(agent.accountId, agent.agentId);
      updateAgent(agent.id, { cachedMeta: meta });
    } catch (err) {
      alert(`Could not inspect agent: ${(err as Error).message}`);
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
              <select value={agent.role} onChange={(e) => updateAgent(agent.id, { role: e.target.value as AgentRef["role"] })}>
                <option value="caller">Caller</option>
                <option value="callee">Callee</option>
                <option value="both">Both</option>
              </select>
            </label>
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
                {(remoteAgents[agent.accountId] ?? []).map((r) => (
                  <option key={r.agentId} value={r.agentId}>
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
              <strong>{agent.cachedMeta.name}</strong> — in: {agent.cachedMeta.inputFormat}, out: {agent.cachedMeta.outputFormat}, language: {agent.cachedMeta.language ?? "?"}
              <br />
              Overrides enabled: {Object.entries(agent.cachedMeta.overridesEnabled).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}
              <br />
              <span className="muted">Checked {new Date(agent.cachedMeta.fetchedAt).toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      ))}
      {config.agents.length === 0 && <p className="empty-state">No agent configured yet. Add one, then link it to an account and an agent_id.</p>}
    </div>
  );
}
