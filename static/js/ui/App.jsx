(function () {
  const { useState } = React;
  const useAppConfig = window.AB.useAppConfig;
  const Tabs = window.AB.ui.Tabs;
  const SessionScreen = window.AB.ui.SessionScreen;
  const SettingsScreen = window.AB.ui.SettingsScreen;
  const AnalyticsPanel = window.AB.ui.AnalyticsPanel;
  const HistoryPanel = window.AB.ui.HistoryPanel;

  function App() {
    const { config, updateConfig, accounts, refreshAccounts, loading } = useAppConfig();
    const [tab, setTab] = useState("session");

    if (loading) return <div className="app-loading">Loading…</div>;

    return (
      <div className="app">
        <header className="app-header">
          <h1>Agent Bridge</h1>
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "session", label: "Session" },
              { value: "settings", label: "Settings" },
              { value: "analytics", label: "Analytics" },
              { value: "history", label: "History" },
            ]}
          />
        </header>
        <main className="app-main">
          {tab === "session" && <SessionScreen config={config} accounts={accounts} />}
          {tab === "settings" && <SettingsScreen config={config} updateConfig={updateConfig} accounts={accounts} refreshAccounts={refreshAccounts} />}
          {tab === "analytics" && <AnalyticsPanel config={config} accounts={accounts} />}
          {tab === "history" && <HistoryPanel />}
        </main>
      </div>
    );
  }

  window.AB.ui.App = App;
})();
