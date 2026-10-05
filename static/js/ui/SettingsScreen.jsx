(function () {
  const { useState } = React;
  const Tabs = window.AB.ui.Tabs;
  const AccountsPanel = window.AB.ui.settings.AccountsPanel;
  const AgentsPanel = window.AB.ui.settings.AgentsPanel;
  const NoiseProfilesPanel = window.AB.ui.settings.NoiseProfilesPanel;
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
            { value: "noise", label: "Noise" },
            { value: "audio", label: "Audio" },
          ]}
        />
        {sub === "accounts" && <AccountsPanel accounts={accounts} onRefresh={refreshAccounts} />}
        {sub === "agents" && <AgentsPanel config={config} accounts={accounts} updateConfig={updateConfig} />}
        {sub === "noise" && <NoiseProfilesPanel config={config} updateConfig={updateConfig} />}
        {sub === "audio" && <AudioPanel config={config} updateConfig={updateConfig} />}
      </div>
    );
  }

  window.AB.ui.SettingsScreen = SettingsScreen;
})();
