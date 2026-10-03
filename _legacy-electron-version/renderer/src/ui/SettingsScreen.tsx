import React, { useState } from "react";
import type { Account, AppConfig } from "../../../shared/types";
import { Tabs } from "./Tabs";
import { AccountsPanel } from "./settings/AccountsPanel";
import { AgentsPanel } from "./settings/AgentsPanel";
import { ScenariosPanel } from "./settings/ScenariosPanel";
import { PresetsPanel } from "./settings/PresetsPanel";
import { AudioPanel } from "./settings/AudioPanel";

type SubTab = "accounts" | "agents" | "scenarios" | "presets" | "audio";

export function SettingsScreen({
  config,
  updateConfig,
  accounts,
  refreshAccounts,
}: {
  config: AppConfig;
  updateConfig: (fn: (prev: AppConfig) => AppConfig) => void;
  accounts: Account[];
  refreshAccounts: () => void;
}) {
  const [sub, setSub] = useState<SubTab>("accounts");

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
          { value: "audio", label: "Audio" },
        ]}
      />
      {sub === "accounts" && <AccountsPanel accounts={accounts} onRefresh={refreshAccounts} />}
      {sub === "agents" && <AgentsPanel config={config} accounts={accounts} updateConfig={updateConfig} />}
      {sub === "scenarios" && <ScenariosPanel config={config} updateConfig={updateConfig} />}
      {sub === "presets" && <PresetsPanel config={config} updateConfig={updateConfig} />}
      {sub === "audio" && <AudioPanel config={config} updateConfig={updateConfig} />}
    </div>
  );
}
