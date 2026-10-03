(function () {
  const { useState } = React;
  const Tabs = window.AB.ui.Tabs;
  const AccountsPanel = window.AB.ui.settings.AccountsPanel;
  const AgentsPanel = window.AB.ui.settings.AgentsPanel;
  const ScenariosPanel = window.AB.ui.settings.ScenariosPanel;
  const PresetsPanel = window.AB.ui.settings.PresetsPanel;
  const BenchmarksPanel = window.AB.ui.settings.BenchmarksPanel;
  const AudioPanel = window.AB.ui.settings.AudioPanel;

  function SettingsScreen({ config, updateConfig, accounts, refreshAccounts }) {
    const [sub, setSub] = useState("accounts");

    return (
      <div className="settings-screen">
        <Tabs
          value={sub}
          onChange={setSub}
          options={[
            { value: "accounts", label: "Accounts" },
            { value: "agents", label: "Agents" },
            { value: "scenarios", label: "Scenarios" },
            { value: "presets", label: "Presets" },
            { value: "benchmarks", label: "Benchmarks" },
            { value: "audio", label: "Audio" },
          ]}
        />
        {sub === "accounts" && <AccountsPanel accounts={accounts} onRefresh={refreshAccounts} />}
        {sub === "agents" && <AgentsPanel config={config} accounts={accounts} updateConfig={updateConfig} />}
        {sub === "scenarios" && <ScenariosPanel config={config} updateConfig={updateConfig} />}
        {sub === "presets" && <PresetsPanel config={config} updateConfig={updateConfig} />}
        {sub === "benchmarks" && <BenchmarksPanel config={config} updateConfig={updateConfig} />}
        {sub === "audio" && <AudioPanel config={config} updateConfig={updateConfig} />}
      </div>
    );
  }

  window.AB.ui.SettingsScreen = SettingsScreen;
})();
