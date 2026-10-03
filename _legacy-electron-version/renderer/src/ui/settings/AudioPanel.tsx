import React, { useEffect, useState } from "react";
import type { AppConfig, AudioFrameSizeMs } from "../../../../shared/types";

const LANGUAGES = ["ja", "zh", "es", "ar", "en", "de", "ko", "hi", "pt"];

export function AudioPanel({ config, updateConfig }: { config: AppConfig; updateConfig: (fn: (prev: AppConfig) => AppConfig) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

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
          value={config.settings.frameSizeMs}
          onChange={(e) => updateConfig((prev) => ({ ...prev, settings: { ...prev.settings, frameSizeMs: Number(e.target.value) as AudioFrameSizeMs } }))}
        >
          <option value={20}>20 ms</option>
          <option value={50}>50 ms</option>
          <option value={100}>100 ms</option>
        </select>
      </div>

      <div className="card">
        <h3>Output device</h3>
        <select
          value={config.settings.outputDeviceId ?? ""}
          onChange={(e) => updateConfig((prev) => ({ ...prev, settings: { ...prev.settings, outputDeviceId: e.target.value || undefined } }))}
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
            checked={config.settings.asrComparisonEnabled}
            onChange={(e) => updateConfig((prev) => ({ ...prev, settings: { ...prev.settings, asrComparisonEnabled: e.target.checked } }))}
          />
          Show the caller's own intended text under each caller bubble (spec-agent-bridge-demo.md section 8.2)
        </label>
      </div>

      <div className="card">
        <h3>Voice table (language → voice_id)</h3>
        <p className="panel-help">Used to auto-fill a scenario's voice override. Find voice IDs in your ElevenLabs dashboard.</p>
        {LANGUAGES.map((lang) => (
          <div className="card-row" key={lang}>
            <label>{lang}</label>
            <input
              value={config.settings.voiceTable[lang] ?? ""}
              onChange={(e) =>
                updateConfig((prev) => ({ ...prev, settings: { ...prev.settings, voiceTable: { ...prev.settings.voiceTable, [lang]: e.target.value } } }))
              }
              placeholder="voice_id"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
