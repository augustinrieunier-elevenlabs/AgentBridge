/** Loads/saves the app config (agents, scenarios, presets, settings) and the account list. */
(function () {
  const { useCallback, useEffect, useState } = React;

  const FALLBACK_CONFIG = {
    agents: [],
    scenarios: [],
    presets: [],
    benchmarks: [],
    settings: { frame_size_ms: 100, asr_comparison_enabled: false, voice_table: {} },
  };

  function useAppConfig() {
    const [config, setConfig] = useState(FALLBACK_CONFIG);
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        const [cfg, accs] = await Promise.all([window.AB.api.config.load(), window.AB.api.accounts.list()]);
        if (cancelled) return;
        // Migrate anything saved before the per-question language change (2026-10-01), the
        // batch-preset change, or the prompt-override caller change (2026-10-02).
        setConfig({
          ...cfg,
          agents: (cfg.agents || []).map(window.AB.model.normalizeAgentRef),
          scenarios: (cfg.scenarios || []).map(window.AB.model.normalizeScenario),
          presets: (cfg.presets || []).map(window.AB.model.normalizePreset),
          benchmarks: (cfg.benchmarks || []).map(window.AB.model.normalizeBenchmark),
        });
        setAccounts(accs);
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, []);

    const updateConfig = useCallback((updater) => {
      setConfig((prev) => {
        const next = updater(prev);
        window.AB.api.config.save(next).catch((err) => console.error("Failed to save config", err));
        return next;
      });
    }, []);

    const refreshAccounts = useCallback(async () => {
      setAccounts(await window.AB.api.accounts.list());
    }, []);

    return { config, updateConfig, accounts, refreshAccounts, loading };
  }

  window.AB.useAppConfig = useAppConfig;
})();
