(function () {
  const { useState } = React;
  const emptyScenario = window.AB.model.emptyScenario;
  const emptyPromptOverrideScenario = window.AB.model.emptyPromptOverrideScenario;
  const cloneScenario = window.AB.model.cloneScenario;
  const buildExamplePresets = window.AB.scenario.buildExamplePresets;
  const ScenarioEditor = window.AB.ui.settings.ScenarioEditor;

  function ScenariosPanel({ config, updateConfig }) {
    const [selectedId, setSelectedId] = useState(config.scenarios[0] ? config.scenarios[0].id : null);

    function addScenario(initial) {
      initial = initial || emptyScenario();
      updateConfig((prev) => ({ ...prev, scenarios: [...prev.scenarios, initial] }));
      setSelectedId(initial.id);
    }

    function loadExamples() {
      const examples = buildExamplePresets();
      updateConfig((prev) => ({ ...prev, scenarios: [...prev.scenarios, ...examples] }));
      setSelectedId(examples[0].id);
    }

    function duplicateScenario(id) {
      const original = config.scenarios.find((s) => s.id === id);
      if (!original) return;
      const clone = cloneScenario(original);
      updateConfig((prev) => ({ ...prev, scenarios: [...prev.scenarios, clone] }));
      setSelectedId(clone.id);
    }

    function removeScenario(id) {
      updateConfig((prev) => ({ ...prev, scenarios: prev.scenarios.filter((s) => s.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    }

    const selected = config.scenarios.find((s) => s.id === selectedId) || null;

    return (
      <div className="panel panel-split">
        <div className="panel-list">
          <div className="panel-toolbar">
            <button onClick={() => addScenario()}>+ New scenario</button>
            <button onClick={() => addScenario(emptyPromptOverrideScenario())}>+ New prompt-override scenario</button>
            <button onClick={loadExamples}>Load 3 examples</button>
          </div>
          <ul className="list">
            {config.scenarios.map((s) => (
              <li key={s.id} className={s.id === selectedId ? "list-item-active" : ""}>
                <button className="list-item-btn" onClick={() => setSelectedId(s.id)}>
                  {s.name}
                  {s.kind === "prompt_override" && <span className="badge"> override</span>}
                </button>
                <button className="small" title="Duplicate" onClick={() => duplicateScenario(s.id)}>
                  ⧉
                </button>
                <button className="danger small" onClick={() => removeScenario(s.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel-detail">
          {selected ? (
            <ScenarioEditor
              scenario={selected}
              onChange={(next) => updateConfig((prev) => ({ ...prev, scenarios: prev.scenarios.map((s) => (s.id === next.id ? next : s)) }))}
            />
          ) : (
            <p className="empty-state">Select or create a scenario.</p>
          )}
        </div>
      </div>
    );
  }

  window.AB.ui.settings.ScenariosPanel = ScenariosPanel;
})();
