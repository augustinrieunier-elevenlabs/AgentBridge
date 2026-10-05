(function () {
  const { useState } = React;
  const useAppConfig = window.AB.useAppConfig;
  const SessionScreen = window.AB.ui.SessionScreen;
  const TestDefinitionScreen = window.AB.ui.TestDefinitionScreen;
  const SettingsScreen = window.AB.ui.SettingsScreen;
  const AnalyticsPanel = window.AB.ui.AnalyticsPanel;
  const HistoryPanel = window.AB.ui.HistoryPanel;

  const NAV_ITEMS = [
    { value: "session", label: "Session" },
    { value: "tests", label: "Test Definition" },
    { value: "settings", label: "Settings" },
    { value: "analytics", label: "Analytics" },
    { value: "history", label: "History" },
  ];

  function App() {
    const { config, updateConfig, accounts, refreshAccounts, loading } = useAppConfig();
    const [tab, setTab] = useState("session");

    if (loading) return <div className="app-loading">Loading…</div>;

    return (
      <div className="app">
        <div className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">AB</div>
            <div>
              <div className="sidebar-brand-name">Agent Bridge</div>
              <div className="sidebar-brand-tag">internal demo tool</div>
            </div>
          </div>

          <nav className="sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.value}
                className={`sidebar-nav-item ${item.value === tab ? "sidebar-nav-item-active" : ""}`}
                onClick={() => setTab(item.value)}
              >
                <span className="sidebar-nav-dot" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            {/* Accounts live only in .env and are read-only from this UI (see README's security
                notes) -- no Add/Remove/Purge action exists to back a "Purge all secrets" button,
                unlike the original mockup, so this just states the real, verifiable fact instead. */}
            <span>
              {accounts.length} account{accounts.length === 1 ? "" : "s"} connected · 0 keys exposed to UI
            </span>
          </div>
        </div>

        <main className="app-main">
          {tab === "session" && <SessionScreen config={config} accounts={accounts} />}
          {tab === "tests" && <TestDefinitionScreen config={config} updateConfig={updateConfig} />}
          {tab === "settings" && <SettingsScreen config={config} updateConfig={updateConfig} accounts={accounts} refreshAccounts={refreshAccounts} />}
          {tab === "analytics" && <AnalyticsPanel config={config} accounts={accounts} />}
          {tab === "history" && <HistoryPanel />}
        </main>
      </div>
    );
  }

  window.AB.ui.App = App;
})();
