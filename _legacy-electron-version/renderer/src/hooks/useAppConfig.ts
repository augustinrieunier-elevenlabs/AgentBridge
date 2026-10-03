import { useCallback, useEffect, useState } from "react";
import type { Account, AppConfig } from "../../../shared/types";

const FALLBACK_CONFIG: AppConfig = {
  agents: [],
  scenarios: [],
  presets: [],
  settings: { frameSizeMs: 100, asrComparisonEnabled: false, voiceTable: {} },
};

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cfg, accs] = await Promise.all([window.bridgeApi.config.load(), window.bridgeApi.accounts.list()]);
      if (cancelled) return;
      setConfig(cfg);
      setAccounts(accs);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateConfig = useCallback((updater: (prev: AppConfig) => AppConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      window.bridgeApi.config.save(next).catch((err) => console.error("Failed to save config", err));
      return next;
    });
  }, []);

  const refreshAccounts = useCallback(async () => {
    setAccounts(await window.bridgeApi.accounts.list());
  }, []);

  return { config, updateConfig, accounts, refreshAccounts, loading };
}
