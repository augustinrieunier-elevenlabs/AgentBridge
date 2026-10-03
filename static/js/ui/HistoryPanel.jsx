/**
 * Every session, batch-preset, and benchmark run is auto-saved the instant it ends (see
 * session/RunHistory.js for session/batch, BenchmarkSession.jsx for benchmark) -- nothing here is
 * manually triggered. This panel merges the two backing stores for display:
 *   - the generic exports store (session/batch runs, via api.exports.*)
 *   - the benchmark runs store (api.benchmarkRuns.*, which also carries per-node latency stats)
 * into one list sorted by time, tagged with its run type, so every run type is reachable from one
 * place regardless of which store it actually lives in. The detail view is deliberately just the
 * raw JSON for now -- it's the full per-run data (including every conversation id) a future
 * analytics pass would read from, not yet a purpose-built UI for it.
 */
(function () {
  const { useEffect, useState } = React;
  const Tabs = window.AB.ui.Tabs;
  const AnalyticsPanel = window.AB.ui.AnalyticsPanel;

  const TYPE_LABELS = { session: "Session", batch: "Batch preset", benchmark: "Benchmark" };

  function typeLabel(type) {
    return TYPE_LABELS[type] || type || "Unknown";
  }

  function HistoryList() {
    const [entries, setEntries] = useState([]);
    const [selectedKey, setSelectedKey] = useState(null);
    const [selected, setSelected] = useState(null);
    const [clearing, setClearing] = useState(false);

    async function refresh() {
      const [exportsList, benchmarkRuns] = await Promise.all([window.AB.api.exports.list(), window.AB.api.benchmarkRuns.list()]);
      const fromExports = exportsList.map((e) => ({
        key: `export:${e.path}`,
        kind: "export",
        path: e.path,
        type: e.run_type || "session", // pre-existing exports saved before run_type existed
        title: e.title || e.name,
        conversationCount: e.conversation_count,
        at: e.saved_at,
      }));
      const fromBenchmarks = benchmarkRuns.map((r) => ({
        key: `benchmark:${r.id}`,
        kind: "benchmark",
        type: "benchmark",
        title: r.benchmarkName || r.benchmarkId,
        conversationCount: (r.variants || []).reduce((n, v) => n + (v.scenarioRuns || []).length, 0),
        at: r.finishedAt,
        raw: r,
      }));
      setEntries([...fromExports, ...fromBenchmarks].sort((a, b) => (b.at || 0) - (a.at || 0)));
    }

    useEffect(() => {
      refresh();
    }, []);

    async function open(entry) {
      setSelectedKey(entry.key);
      setSelected(entry.kind === "export" ? await window.AB.api.exports.read(entry.path) : entry.raw);
    }

    async function clearHistory() {
      if (entries.length === 0) return;
      const confirmed = window.confirm(
        `Delete all ${entries.length} stored run${entries.length === 1 ? "" : "s"} (sessions, batches, and benchmarks)? This cannot be undone.`,
      );
      if (!confirmed) return;
      setClearing(true);
      try {
        await Promise.all([window.AB.api.exports.clear(), window.AB.api.benchmarkRuns.clear()]);
        setSelectedKey(null);
        setSelected(null);
        await refresh();
      } catch (err) {
        alert(`Could not clear history: ${err.message}`);
      } finally {
        setClearing(false);
      }
    }

    return (
      <div className="panel panel-split">
        <div className="panel-list">
          <div className="panel-toolbar">
            <button onClick={refresh}>Refresh</button>
            <button className="danger" onClick={clearHistory} disabled={clearing || entries.length === 0}>
              {clearing ? "Clearing…" : "Clear history"}
            </button>
          </div>
          <ul className="list">
            {entries.map((e) => (
              <li key={e.key} className={e.key === selectedKey ? "list-item-active" : ""}>
                <button className="list-item-btn" onClick={() => open(e)}>
                  <span className="badge">{typeLabel(e.type)}</span> {e.title}
                  {typeof e.conversationCount === "number" && <span className="muted small"> -- {e.conversationCount} conversation{e.conversationCount === 1 ? "" : "s"}</span>}
                  <br />
                  <span className="muted small">{e.at ? new Date(e.at * 1000).toLocaleString() : "?"}</span>
                </button>
              </li>
            ))}
          </ul>
          {entries.length === 0 && <p className="empty-state">No run yet. Every session, batch preset, and benchmark run is saved here automatically as soon as it ends.</p>}
        </div>
        <div className="panel-detail">{selected ? <pre className="prompt-preview">{JSON.stringify(selected, null, 2)}</pre> : <p className="empty-state">Select a run to inspect it.</p>}</div>
      </div>
    );
  }

  function HistoryPanel({ config }) {
    const [sub, setSub] = useState("list");

    return (
      <div>
        <Tabs
          value={sub}
          onChange={setSub}
          options={[
            { value: "list", label: "List" },
            { value: "analytics", label: "Analytics" },
          ]}
        />
        {sub === "list" && <HistoryList />}
        {sub === "analytics" && <AnalyticsPanel config={config} />}
      </div>
    );
  }

  window.AB.ui.HistoryPanel = HistoryPanel;
})();
