(function () {
  const { useState } = React;
  const emptyScenario = window.AB.model.emptyScenario;
  const emptyPromptOverrideScenario = window.AB.model.emptyPromptOverrideScenario;
  const scenarioFromElevenLabsTest = window.AB.model.scenarioFromElevenLabsTest;
  const cloneScenario = window.AB.model.cloneScenario;
  const buildExamplePresets = window.AB.scenario.buildExamplePresets;
  const LANGUAGE_CATALOG = window.AB.scenario.LANGUAGE_CATALOG;
  const ScenarioEditor = window.AB.ui.settings.ScenarioEditor;

  /** Parses one uploaded file's text as either a single ElevenLabs Test object or an array of them
   * (the dashboard's per-test export vs. an "export all" bundle both show up in the wild -- see
   * Inputs/TestV3/*.json vs. _all_tests.json) -- always returns an array, so the caller never has
   * to branch on which shape a given file turned out to be. Returns [] (not a throw) for a file
   * that isn't valid JSON at all, since ScenariosPanel imports several files in one go and one bad
   * file shouldn't abort the rest. */
  async function parseTestFile(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      console.error(`Could not parse ${file.name} as JSON`, err);
      return [];
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  function ScenariosPanel({ config, updateConfig }) {
    const [selectedId, setSelectedId] = useState(config.scenarios[0] ? config.scenarios[0].id : null);
    const [importLanguage, setImportLanguage] = useState("en");
    const [importing, setImporting] = useState(false);

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

    /** One or more ElevenLabs Test export files (the dashboard's "Export" on a test, or an
     * "export all" bundle -- see parseTestFile), each mapped through scenarioFromElevenLabsTest at
     * the language picked above. Only `type: "simulation"` tests map to anything -- an `llm`/`tool`
     * test replays a fixed chat history and grades one response, there's no live call for this
     * app's formalism to represent, so those are silently skipped and counted for the summary. */
    async function handleImportFiles(fileList) {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;
      setImporting(true);
      try {
        const testBatches = await Promise.all(files.map(parseTestFile));
        const tests = testBatches.flat();
        const imported = tests.map((t) => scenarioFromElevenLabsTest(t, importLanguage)).filter(Boolean);
        const skipped = tests.length - imported.length;
        if (imported.length > 0) {
          updateConfig((prev) => ({ ...prev, scenarios: [...prev.scenarios, ...imported] }));
          setSelectedId(imported[0].id);
        }
        alert(
          `Imported ${imported.length} scenario${imported.length === 1 ? "" : "s"}` +
            (skipped > 0 ? ` -- skipped ${skipped} test${skipped === 1 ? "" : "s"} that ${skipped === 1 ? "isn't" : "aren't"} type "simulation" (an llm/tool test has no live call to represent).` : "."),
        );
      } finally {
        setImporting(false);
      }
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
          <div className="panel-toolbar" title="Each imported test becomes one prompt-override scenario: simulation_scenario -> promptOverride, success_conditions shown next to the transcript.">
            <select value={importLanguage} onChange={(e) => setImportLanguage(e.target.value)} disabled={importing}>
              {LANGUAGE_CATALOG.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code})
                </option>
              ))}
            </select>
            <input
              type="file"
              id="import-elevenlabs-tests"
              accept=".json"
              multiple
              onChange={(e) => {
                handleImportFiles(e.target.files);
                e.target.value = ""; // lets the same file(s) be re-selected later
              }}
              disabled={importing}
              style={{ display: "none" }}
            />
            <button onClick={() => document.getElementById("import-elevenlabs-tests").click()} disabled={importing}>
              {importing ? "Importing…" : "Import ElevenLabs test(s)…"}
            </button>
          </div>
          <ul className="list">
            {config.scenarios.map((s) => (
              <li key={s.id} className={s.id === selectedId ? "list-item-active" : ""}>
                <button
                  className={`list-item-btn ${s.kind === "prompt_override" ? "list-item-btn-override" : ""}`}
                  onClick={() => setSelectedId(s.id)}
                >
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
