import React, { useState } from "react";
import type { Account } from "../../../../shared/types";

/**
 * Accounts are entirely read-only here: they come from .env (see secrets.ts)
 * and are never pasted into the UI (spec-agent-bridge-demo.md section 4, adapted
 * to a .env-based secret store instead of the OS keychain -- see README "Security notes").
 */
export function AccountsPanel({ accounts, onRefresh }: { accounts: Account[]; onRefresh: () => void }) {
  const [testing, setTesting] = useState<Record<string, string>>({});

  async function test(accountId: string) {
    setTesting((s) => ({ ...s, [accountId]: "testing" }));
    const result = await window.bridgeApi.accounts.test(accountId);
    setTesting((s) => ({ ...s, [accountId]: result.ok ? "ok" : `error:${result.error ?? "unknown"}` }));
    onRefresh();
  }

  return (
    <div className="panel">
      <p className="panel-help">
        Accounts are declared in your <code>.env</code> file (never in this UI) as <code>ELEVENLABS_ACCOUNT_&lt;n&gt;_LABEL</code> /{" "}
        <code>ELEVENLABS_ACCOUNT_&lt;n&gt;_API_KEY</code>. Edit <code>.env</code> and restart the app to add or change an account. Keys are
        never shown here and never leave the main process.
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
              <td>{a.hasKey ? "API key" : "No key (public agents only)"}</td>
              <td className="mono">{a.baseUrl}</td>
              <td>
                {testing[a.id] === "testing" && "Testing…"}
                {testing[a.id] === "ok" && <span className="badge badge-ok">OK</span>}
                {testing[a.id]?.startsWith("error:") && <span className="badge badge-fail">{testing[a.id]!.slice(6)}</span>}
                {!testing[a.id] && a.lastCheck && (a.lastCheck.ok ? <span className="badge badge-ok">OK</span> : <span className="badge badge-fail">{a.lastCheck.error}</span>)}
              </td>
              <td>
                <button onClick={() => test(a.id)} disabled={!a.hasKey}>
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
