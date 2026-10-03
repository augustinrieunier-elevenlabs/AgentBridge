(function () {
  const ICON = { pass: "✅", warn: "⚠️", fail: "❌" };

  /** Same shape as PreflightChecklist, but grouped per scenario for a batch preset
   * (see session/Preflight.js runBatchPreflight and ui/BatchSession.jsx). */
  function BatchPreflightChecklist({ results, onClose, onLaunchAnyway, blocked }) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h2>Pre-flight checks -- {results.length} scenarios</h2>
          {results.map(({ scenario, checks, blocked: scenarioBlocked }) => (
            <div key={scenario.id} className="card">
              <strong>
                {scenarioBlocked ? "❌" : "✅"} {scenario.name}
              </strong>
              <ul className="checklist">
                {checks.map((c) => (
                  <li key={c.id} className={`check-${c.status}`}>
                    <span className="check-icon">{ICON[c.status]}</span>
                    <div>
                      <div>{c.label}</div>
                      {c.detail && <div className="muted small">{c.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="modal-actions">
            <button onClick={onClose}>Close</button>
            <button className="primary" onClick={onLaunchAnyway} disabled={blocked} title={blocked ? "Fix the failed checks above first" : undefined}>
              Launch all {results.length}
            </button>
          </div>
        </div>
      </div>
    );
  }

  window.AB.ui.BatchPreflightChecklist = BatchPreflightChecklist;
})();
