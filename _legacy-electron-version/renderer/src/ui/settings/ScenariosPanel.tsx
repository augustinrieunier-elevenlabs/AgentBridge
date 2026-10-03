import React, { useState } from "react";
import type { AppConfig } from "../../../../shared/types";
import { emptyScenario } from "../../model/factory";
import { buildExamplePresets } from "../../scenario/examplePresets";
import { ScenarioEditor } from "./ScenarioEditor";

export function ScenariosPanel({ config, updateConfig }: { config: AppConfig; updateConfig: (fn: (prev: AppConfig) => AppConfig) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(config.scenarios[0]?.id ?? null);

  function addScenario(initial = emptyScenario()) {
    updateConfig((prev) => ({ ...prev, scenarios: [...prev.scenarios, initial] }));
    setSelectedId(initial.id);
  }

  function loadExamples() {
    const examples = buildExamplePresets();
    updateConfig((prev) => ({ ...prev, scenarios: [...prev.scenarios, ...examples] }));
    setSelectedId(examples[0].id);
  }

  function removeScenario(id: string) {
    updateConfig((prev) => ({ ...prev, scenarios: prev.scenarios.filter((s) => s.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  const selected = config.scenarios.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="panel panel-split">
      <div className="panel-list">
        <div className="panel-toolbar">
          <button onClick={() => addScenario()}>+ New scenario</button>
          <button onClick={loadExamples}>Load 3 examples</button>
        </div>
        <ul className="list">
          {config.scenarios.map((s) => (
            <li key={s.id} className={s.id === selectedId ? "list-item-active" : ""}>
              <button className="list-item-btn" onClick={() => setSelectedId(s.id)}>
                {s.name}
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
