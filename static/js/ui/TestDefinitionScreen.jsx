(function () {
  const { useState } = React;
  const Tabs = window.AB.ui.Tabs;
  const ScenariosPanel = window.AB.ui.settings.ScenariosPanel;
  const PresetsPanel = window.AB.ui.settings.PresetsPanel;
  const BenchmarksPanel = window.AB.ui.settings.BenchmarksPanel;

  function TestDefinitionScreen({ config, updateConfig }) {
    const [sub, setSub] = useState("scenarios");

    return (
      <div className="settings-screen">
        <Tabs
          value={sub}
          onChange={setSub}
          options={[
            { value: "scenarios", label: "Scenarios" },
            { value: "presets", label: "Presets" },
            { value: "benchmarks", label: "Benchmarks" },
          ]}
        />
        {sub === "scenarios" && <ScenariosPanel config={config} updateConfig={updateConfig} />}
        {sub === "presets" && <PresetsPanel config={config} updateConfig={updateConfig} />}
        {sub === "benchmarks" && <BenchmarksPanel config={config} updateConfig={updateConfig} />}
      </div>
    );
  }

  window.AB.ui.TestDefinitionScreen = TestDefinitionScreen;
})();
