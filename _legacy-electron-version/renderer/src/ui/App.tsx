import React, { useState } from "react";
import { useAppConfig } from "../hooks/useAppConfig";
import { Tabs } from "./Tabs";
import { SessionScreen } from "./SessionScreen";
import { SettingsScreen } from "./SettingsScreen";
import { HistoryPanel } from "./HistoryPanel";

type TopTab = "session" | "settings" | "history";

export function App() {
  const { config, updateConfig, accounts, refreshAccounts, loading } = useAppConfig();
  const [tab, setTab] = useState<TopTab>("session");

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
            { value: "history", label: "History" },
          ]}
        />
      </header>
      <main className="app-main">
        {tab === "session" && <SessionScreen config={config} accounts={accounts} />}
        {tab === "settings" && <SettingsScreen config={config} updateConfig={updateConfig} accounts={accounts} refreshAccounts={refreshAccounts} />}
        {tab === "history" && <HistoryPanel />}
      </main>
    </div>
  );
}
