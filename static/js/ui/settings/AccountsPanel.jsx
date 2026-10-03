(function () {
  const { useState } = React;

  /**
   * Accounts are entirely read-only here: they come from .env (see
   * services/secrets.py) and are never pasted into the UI (spec-agent-bridge-demo.md
   * section 4, adapted to a .env-based secret store instead of the OS
   * keychain -- see README "Security notes").
   */
  function AccountsPanel({ accounts, onRefresh }) {
    const [testing, setTesting] = useState({});

    async function test(accountId) {
      setTesting((s) => ({ ...s, [accountId]: "testing" }));
      const result = await window.AB.api.accounts.test(accountId);
      setTesting((s) => ({ ...s, [accountId]: result.ok ? "ok" : `error:${result.error || "unknown"}` }));
      onRefresh();
    }

    return (
      <div className="panel">
        <p className="panel-help">
          Accounts are declared in your <code>.env</code> file (never in this UI) as <code>ELEVENLABS_ACCOUNT_&lt;n&gt;_LABEL</code> /{" "}
          <code>ELEVENLABS_ACCOUNT_&lt;n&gt;_API_KEY</code>. Edit <code>.env</code> and restart the app to add or change an account. Keys are
          never shown here and never leave the Flask backend.
        </p>
        {accounts.length === 0 && <p className="empty-state">No account configured yet. Copy .env.example to .env and fill it in, then restart.</p>}
        <table className="table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Mode</th>
              <th>Base URL</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td>{a.has_key ? "API key" : "No key (public agents only)"}</td>
                <td className="mono">{a.base_url}</td>
                <td>
                  {testing[a.id] === "testing" && "Testing…"}
                  {testing[a.id] === "ok" && <span className="badge badge-ok">OK</span>}
                  {testing[a.id] && testing[a.id].startsWith("error:") && <span className="badge badge-fail">{testing[a.id].slice(6)}</span>}
                </td>
                <td>
                  <button onClick={() => test(a.id)} disabled={!a.has_key}>
                    Test
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  window.AB.ui.settings.AccountsPanel = AccountsPanel;
})();
