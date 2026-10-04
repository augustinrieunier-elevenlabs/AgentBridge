(function () {
  const { useState } = React;
  const emptyBenchmark = window.AB.model.emptyBenchmark;
  const cloneBenchmark = window.AB.model.cloneBenchmark;
  const TTS_MODEL_VARIANTS = window.AB.model.TTS_MODEL_VARIANTS;
  const DynamicVariablesEditor = window.AB.ui.settings.DynamicVariablesEditor;

  function BenchmarksPanel({ config, updateConfig }) {
    const [selectedId, setSelectedId] = useState(config.benchmarks[0] ? config.benchmarks[0].id : null);
    const [llmCatalog, setLlmCatalog] = useState({}); // accountId -> [{llm, is_checkpoint, deprecated}]
    const [llmFilter, setLlmFilter] = useState({}); // benchmarkId -> filter text
    const [loadingLlms, setLoadingLlms] = useState(null);

    function addBenchmark() {
      const next = emptyBenchmark();
      updateConfig((prev) => ({ ...prev, benchmarks: [...prev.benchmarks, next] }));
      setSelectedId(next.id);
    }
    function updateBenchmark(id, patch) {
      updateConfig((prev) => ({ ...prev, benchmarks: prev.benchmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    }
    function duplicateBenchmark(id) {
      const original = config.benchmarks.find((b) => b.id === id);
      if (!original) return;
      const clone = cloneBenchmark(original);
      updateConfig((prev) => ({ ...prev, benchmarks: [...prev.benchmarks, clone] }));
      setSelectedId(clone.id);
    }
    function removeBenchmark(id) {
      updateConfig((prev) => ({ ...prev, benchmarks: prev.benchmarks.filter((b) => b.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    }
    function setCallerAgent(benchmark, callerAgentRefId) {
      const callerAgent = config.agents.find((a) => a.id === callerAgentRefId);
      if (!callerAgent) {
        updateBenchmark(benchmark.id, { callerAgentRefId });
        return;
      }
      const kept = [];
      const dropped = [];
      for (const id of benchmark.scenarioIds) {
        const scenario = config.scenarios.find((s) => s.id === id);
        if (scenario && scenario.kind !== callerAgent.callerKind) dropped.push(scenario.name);
        else kept.push(id);
      }
      if (dropped.length > 0) {
        alert(`Removed from this benchmark: ${dropped.join(", ")} -- wrong scenario type for a "${callerAgent.callerKind}" caller agent.`);
      }
      updateBenchmark(benchmark.id, { callerAgentRefId, scenarioIds: kept });
    }
    function toggleScenario(benchmark, scenarioId) {
      const has = benchmark.scenarioIds.includes(scenarioId);
      updateBenchmark(benchmark.id, { scenarioIds: has ? benchmark.scenarioIds.filter((id) => id !== scenarioId) : [...benchmark.scenarioIds, scenarioId] });
    }
    function toggleTtsVariant(benchmark, ttsId) {
      const has = benchmark.ttsVariantIds.includes(ttsId);
      updateBenchmark(benchmark.id, { ttsVariantIds: has ? benchmark.ttsVariantIds.filter((id) => id !== ttsId) : [...benchmark.ttsVariantIds, ttsId] });
    }
    function toggleLlmVariant(benchmark, llmName) {
      const has = benchmark.llmVariantIds.includes(llmName);
      updateBenchmark(benchmark.id, { llmVariantIds: has ? benchmark.llmVariantIds.filter((id) => id !== llmName) : [...benchmark.llmVariantIds, llmName] });
    }
    function setScenarioOverride(benchmark, scenarioId, next) {
      updateBenchmark(benchmark.id, {
        calleeDynamicVariableOverridesByScenario: { ...benchmark.calleeDynamicVariableOverridesByScenario, [scenarioId]: next },
      });
    }

    async function loadLlms(calleeAgent) {
      if (!calleeAgent || !calleeAgent.accountId) return;
      setLoadingLlms(calleeAgent.accountId);
      try {
        const list = await window.AB.api.agents.listLlms(calleeAgent.accountId);
        setLlmCatalog((prev) => ({ ...prev, [calleeAgent.accountId]: list }));
      } catch (err) {
        alert(`Could not load the LLM catalog: ${err.message}`);
      } finally {
        setLoadingLlms(null);
      }
    }

    const callerAgents = config.agents.filter((a) => a.role === "caller" || a.role === "both");
    const calleeAgents = config.agents.filter((a) => a.role === "callee" || a.role === "both");
    const selected = config.benchmarks.find((b) => b.id === selectedId) || null;

    return (
      <div className="panel panel-split">
        <div className="panel-list">
          <div className="panel-toolbar">
            <button onClick={addBenchmark}>+ New benchmark</button>
          </div>
          <ul className="list">
            {config.benchmarks.map((b) => (
              <li key={b.id} className={b.id === selectedId ? "list-item-active" : ""}>
                <button className="list-item-btn" onClick={() => setSelectedId(b.id)}>
                  {b.name || "Untitled benchmark"}
                </button>
                <button className="small" title="Clone this benchmark, including its scenario/variant selections" onClick={() => duplicateBenchmark(b.id)}>
                  ⧉
                </button>
                <button className="danger small" onClick={() => removeBenchmark(b.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          {config.benchmarks.length === 0 && <p className="panel-help">No benchmark yet.</p>}
        </div>
        <div className="panel-detail">
          {selected ? (
            <BenchmarkEditor
              benchmark={selected}
              config={config}
              callerAgents={callerAgents}
              calleeAgents={calleeAgents}
              llmCatalog={llmCatalog}
              llmFilter={llmFilter}
              setLlmFilter={setLlmFilter}
              loadingLlms={loadingLlms}
              loadLlms={loadLlms}
              updateBenchmark={updateBenchmark}
              setCallerAgent={setCallerAgent}
              toggleScenario={toggleScenario}
              toggleTtsVariant={toggleTtsVariant}
              toggleLlmVariant={toggleLlmVariant}
              setScenarioOverride={setScenarioOverride}
            />
          ) : (
            <p className="empty-state">
              Select or create a benchmark. A benchmark compares the callee agent's latency across TTS/LLM configuration variants -- launch it from the Session tab.
            </p>
          )}
        </div>
      </div>
    );
  }

  function BenchmarkEditor({
    benchmark: b,
    config,
    callerAgents,
    calleeAgents,
    llmCatalog,
    llmFilter,
    setLlmFilter,
    loadingLlms,
    loadLlms,
    updateBenchmark,
    setCallerAgent,
    toggleScenario,
    toggleTtsVariant,
    toggleLlmVariant,
    setScenarioOverride,
  }) {
    const callerAgent = config.agents.find((a) => a.id === b.callerAgentRefId);
    const calleeAgent = config.agents.find((a) => a.id === b.calleeAgentRefId);
    const assignableScenarios = callerAgent ? config.scenarios.filter((s) => s.kind === callerAgent.callerKind) : config.scenarios;
    const llms = (calleeAgent && llmCatalog[calleeAgent.accountId]) || [];
    const filterText = (llmFilter[b.id] || "").toLowerCase();
    const filteredLlms = filterText ? llms.filter((l) => l.llm.toLowerCase().includes(filterText)) : llms;
    const bothAxesEmpty = b.ttsVariantIds.length === 0 && b.llmVariantIds.length === 0;
    const variantCount = bothAxesEmpty ? 0 : (b.ttsVariantIds.length || 1) * (b.llmVariantIds.length || 1);

    return (
      <div className="card">
        <div className="card-row">
          <label className="grow">
            Name
            <input value={b.name} onChange={(e) => updateBenchmark(b.id, { name: e.target.value })} />
          </label>
        </div>
        <div className="card-row">
          <label>
            Caller agent
            <select value={b.callerAgentRefId} onChange={(e) => setCallerAgent(b, e.target.value)}>
              <option value="">Select…</option>
              {callerAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.callerKind === "prompt_override" ? "prompt override" : "deterministic"})
                </option>
              ))}
            </select>
          </label>
          <label>
            Callee agent (benchmarked)
            <select value={b.calleeAgentRefId} onChange={(e) => updateBenchmark(b.id, { calleeAgentRefId: e.target.value })}>
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
            <select value={b.noiseProfileRefId} onChange={(e) => updateBenchmark(b.id, { noiseProfileRefId: e.target.value })}>
              <option value="">None</option>
              {config.noiseProfiles.map((np) => (
                <option key={np.id} value={np.id}>
                  {np.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {b.noiseProfileRefId && (
          <p className="panel-help">Simulates a bad connection from the start of every run, in audio mode (ignored in text-only) -- see Settings → Noise.</p>
        )}

        {calleeAgent && calleeAgent.cachedMeta && (
          <DynamicVariablesEditor
            title="Callee dynamic variables -- default for this benchmark"
            helpText={`Used for any selected scenario below that doesn't set its own value. Leave a field empty to fall back to ${
              calleeAgent.label || "the callee agent"
            }'s own default (set in Settings → Agents).`}
            placeholders={calleeAgent.cachedMeta.dynamic_variable_placeholders}
            values={b.calleeDynamicVariableOverrides}
            inheritedValues={calleeAgent.dynamicVariables}
            onChange={(next) => updateBenchmark(b.id, { calleeDynamicVariableOverrides: next })}
          />
        )}
        {calleeAgent && !calleeAgent.cachedMeta && (
          <p className="panel-help">Run "Verify agent" on {calleeAgent.label || "this callee"} in Settings → Agents to see and override its dynamic variables here.</p>
        )}

        <fieldset>
          <legend>Scenarios ({b.scenarioIds.length} selected -- one pass each, per variant)</legend>
          {!callerAgent && <p className="panel-help">Pick a caller agent above to see only the scenarios it can run.</p>}
          {callerAgent && assignableScenarios.length === 0 && <p className="panel-help">No "{callerAgent.callerKind}" scenarios yet -- create one in Settings → Scenarios first.</p>}
          {assignableScenarios.map((s) => {
            const isSelected = b.scenarioIds.includes(s.id);
            const hasVariables = calleeAgent && calleeAgent.cachedMeta && Object.keys(calleeAgent.cachedMeta.dynamic_variable_placeholders || {}).length > 0;
            const benchmarkDefault = { ...(calleeAgent && calleeAgent.dynamicVariables), ...b.calleeDynamicVariableOverrides };
            return (
              <div key={s.id}>
                <label className="checkbox-row">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleScenario(b, s.id)} />
                  {s.name}
                </label>
                {isSelected && hasVariables && (
                  <div className="scenario-override">
                    <DynamicVariablesEditor
                      title={`Callee dynamic variables -- override for "${s.name}"`}
                      helpText="Takes precedence over the benchmark default above, for this scenario only. Leave empty to just use the default."
                      placeholders={calleeAgent.cachedMeta.dynamic_variable_placeholders}
                      values={b.calleeDynamicVariableOverridesByScenario[s.id] || {}}
                      inheritedValues={benchmarkDefault}
                      onChange={(next) => setScenarioOverride(b, s.id, next)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>

        <fieldset>
          <legend>TTS model family variants ({b.ttsVariantIds.length} selected -- leave empty to keep the callee's current TTS fixed)</legend>
          {TTS_MODEL_VARIANTS.map((v) => (
            <label key={v.id} className="checkbox-row">
              <input type="checkbox" checked={b.ttsVariantIds.includes(v.id)} onChange={() => toggleTtsVariant(b, v.id)} />
              {v.label}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>LLM variants ({b.llmVariantIds.length} selected -- leave empty to keep the callee's current LLM fixed)</legend>
          {!calleeAgent && <p className="panel-help">Pick a callee agent above first.</p>}
          {calleeAgent && (
            <>
              <div className="card-row">
                <button onClick={() => loadLlms(calleeAgent)} disabled={loadingLlms === calleeAgent.accountId}>
                  {loadingLlms === calleeAgent.accountId ? "Loading…" : llms.length ? "Reload LLM list" : "Load LLM list"}
                </button>
                {llms.length > 0 && (
                  <input
                    className="voice-table-filter"
                    placeholder="Filter…"
                    value={llmFilter[b.id] || ""}
                    onChange={(e) => setLlmFilter((prev) => ({ ...prev, [b.id]: e.target.value }))}
                  />
                )}
              </div>
              {llms.length === 0 && <p className="panel-help">Load this callee account's LLM catalog to pick variants.</p>}
              {llms.length > 0 && (
                <div className="llm-variant-list">
                  {filteredLlms.map((l) => (
                    <label key={l.llm} className="checkbox-row" title={l.deprecated ? "Deprecated by the provider" : ""}>
                      <input type="checkbox" checked={b.llmVariantIds.includes(l.llm)} onChange={() => toggleLlmVariant(b, l.llm)} />
                      {l.llm}
                      {l.deprecated ? " (deprecated)" : ""}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </fieldset>

        <p className="panel-help">
          {variantCount > 0
            ? `${variantCount} configuration${variantCount > 1 ? "s" : ""} will be tested (cross product of the TTS × LLM selections above), ${b.scenarioIds.length} scenario pass${
                b.scenarioIds.length === 1 ? "" : "es"
              } each${
                b.ttsVariantIds.length > 0 ? ", always with real audio (this benchmark varies TTS, which needs it)." : " -- not varying TTS, so a \"Text only\" option is offered when launching it from Session."
              }`
            : "Select at least one TTS or LLM variant to benchmark."}
        </p>
      </div>
    );
  }

  window.AB.ui.settings.BenchmarksPanel = BenchmarksPanel;
})();
