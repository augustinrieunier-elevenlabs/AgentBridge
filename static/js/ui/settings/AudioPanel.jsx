(function () {
  const { useEffect, useMemo, useState } = React;
  const LANGUAGE_CATALOG = window.AB.scenario.LANGUAGE_CATALOG;

  function AudioPanel({ config, updateConfig }) {
    const [devices, setDevices] = useState([]);
    const [voiceFilter, setVoiceFilter] = useState("");

    const filteredLanguages = useMemo(() => {
      const q = voiceFilter.trim().toLowerCase();
      if (!q) return LANGUAGE_CATALOG;
      return LANGUAGE_CATALOG.filter((lang) => lang.name.toLowerCase().includes(q) || lang.code.toLowerCase().includes(q));
    }, [voiceFilter]);

    useEffect(() => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === "audiooutput")))
        .catch(() => setDevices([]));
    }, []);

    return (
      <div className="panel">
        <div className="card">
          <h3>Pacer frame size</h3>
          <p className="panel-help">Debug only -- 100 ms is the recommended default (spec-agent-bridge-demo.md section 7.2).</p>
          <select
            value={config.settings.frame_size_ms}
            onChange={(e) => updateConfig((prev) => ({ ...prev, settings: { ...prev.settings, frame_size_ms: Number(e.target.value) } }))}
          >
            <option value={20}>20 ms</option>
            <option value={50}>50 ms</option>
            <option value={100}>100 ms</option>
          </select>
        </div>

        <div className="card">
          <h3>Output device</h3>
          <select
            value={config.settings.output_device_id || ""}
            onChange={(e) => updateConfig((prev) => ({ ...prev, settings: { ...prev.settings, output_device_id: e.target.value || undefined } }))}
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3>ASR comparison</h3>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={config.settings.asr_comparison_enabled}
              onChange={(e) => updateConfig((prev) => ({ ...prev, settings: { ...prev.settings, asr_comparison_enabled: e.target.checked } }))}
            />
            Show the caller's own intended text under each caller bubble (spec-agent-bridge-demo.md section 8.2)
          </label>
        </div>

        <div className="card">
          <h3>Voice table (language → voice_id)</h3>
          <p className="panel-help">
            Fallback caller TTS voice, by language -- only applies when a scenario doesn't set its own Voice ID override (Scenarios → that scenario). Find voice IDs in your
            ElevenLabs dashboard.
          </p>
          <input
            className="voice-table-filter"
            value={voiceFilter}
            onChange={(e) => setVoiceFilter(e.target.value)}
            placeholder={`Filter languages... (${LANGUAGE_CATALOG.length} available)`}
          />
          {filteredLanguages.map((lang) => (
            <div className="card-row" key={lang.code}>
              <label>
                {lang.name} ({lang.code})
              </label>
              <input
                value={config.settings.voice_table[lang.code] || ""}
                onChange={(e) =>
                  updateConfig((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, voice_table: { ...prev.settings.voice_table, [lang.code]: e.target.value } },
                  }))
                }
                placeholder="voice_id"
              />
            </div>
          ))}
          {filteredLanguages.length === 0 && <p className="panel-help">No language matches "{voiceFilter}".</p>}
        </div>
      </div>
    );
  }

  window.AB.ui.settings.AudioPanel = AudioPanel;
})();
