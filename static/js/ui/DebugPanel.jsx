(function () {
  const { useState } = React;

  function DebugPanel({ open, onToggle, log, callerConversationId, calleeConversationId, queueDepths, negotiatedFormats }) {
    const [filter, setFilter] = useState("all");
    const filtered = log.filter((e) => filter === "all" || e.agent === filter);

    return (
      <div className={`debug-panel ${open ? "debug-panel-open" : ""}`}>
        <button className="debug-toggle" onClick={onToggle}>
          ▸ Debug {open ? "▾" : "▸"}
        </button>
        {open && (
          <div className="debug-panel-body">
            <div className="debug-panel-summary">
              <div>
                Caller conversation: <span className="mono">{callerConversationId || "—"}</span>
              </div>
              <div>
                Callee conversation: <span className="mono">{calleeConversationId || "—"}</span>
              </div>
              <div>Negotiated formats: caller {negotiatedFormats.caller || "?"}, callee {negotiatedFormats.callee || "?"}</div>
              <div>
                Queue depth: caller→callee {Math.round(queueDepths.callerQueueMs)} ms, callee→caller {Math.round(queueDepths.calleeQueueMs)} ms
              </div>
            </div>
            <div className="debug-panel-filter">
              <button onClick={() => setFilter("all")}>All</button>
              <button onClick={() => setFilter("caller")}>Caller</button>
              <button onClick={() => setFilter("callee")}>Callee</button>
            </div>
            <div className="debug-panel-log">
              {filtered.map((e, i) => (
                <div key={i} className="debug-log-line">
                  <span className="mono small">{(e.at / 1000).toFixed(1)}s</span> <span className={`tag tag-${e.agent}`}>{e.agent}</span> {e.summary}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  window.AB.ui.DebugPanel = DebugPanel;
})();
