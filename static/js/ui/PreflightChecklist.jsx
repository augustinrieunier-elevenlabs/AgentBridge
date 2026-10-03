(function () {
  const ICON = { pass: "✅", warn: "⚠️", fail: "❌" };

  function PreflightChecklist({ checks, onClose, onLaunchAnyway, blocked }) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h2>Pre-flight checks</h2>
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
          <div className="modal-actions">
            <button onClick={onClose}>Close</button>
            <button className="primary" onClick={onLaunchAnyway} disabled={blocked} title={blocked ? "Fix the failed checks above first" : undefined}>
              Launch
            </button>
          </div>
        </div>
      </div>
    );
  }

  window.AB.ui.PreflightChecklist = PreflightChecklist;
})();
