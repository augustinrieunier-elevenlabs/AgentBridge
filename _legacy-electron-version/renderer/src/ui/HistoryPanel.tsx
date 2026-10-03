import React, { useEffect, useState } from "react";

type ExportEntry = { name: string; path: string; savedAt: string };

export function HistoryPanel() {
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [selected, setSelected] = useState<unknown>(null);

  async function refresh() {
    setExports(await window.bridgeApi.exports.list());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function open(path: string) {
    setSelected(await window.bridgeApi.exports.read(path));
  }

  return (
    <div className="panel panel-split">
      <div className="panel-list">
        <div className="panel-toolbar">
          <button onClick={refresh}>Refresh</button>
        </div>
        <ul className="list">
          {exports.map((e) => (
            <li key={e.path}>
              <button className="list-item-btn" onClick={() => open(e.path)}>
                {e.name}
                <span className="muted"> — {new Date(e.savedAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
        {exports.length === 0 && <p className="empty-state">No exported session yet. Export one from the end of a Session.</p>}
      </div>
      <div className="panel-detail">{selected ? <pre className="prompt-preview">{JSON.stringify(selected, null, 2)}</pre> : <p className="empty-state">Select an export to inspect it.</p>}</div>
    </div>
  );
}
