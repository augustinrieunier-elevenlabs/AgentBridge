/**
 * Account/secret loading from environment variables.
 *
 * Accounts are declared entirely in `.env` (never through the UI) as numbered
 * blocks:
 *
 *   ELEVENLABS_ACCOUNT_1_LABEL=Demo FR
 *   ELEVENLABS_ACCOUNT_1_API_KEY=sk_...
 *   ELEVENLABS_ACCOUNT_1_BASE_URL=https://api.elevenlabs.io   (optional)
 *
 * This keeps the API key out of the renderer and out of config.json entirely:
 * the main process resolves an account's key on demand, uses it for one REST
 * call or signed-URL request, and never passes it anywhere else. Accounts
 * with no API key are "public agent only" accounts (see spec-agent-bridge-demo.md 4.3).
 */
import type { Account } from "../shared/types";

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

type LoadedAccount = Account & { apiKey?: string };

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let cachedAccounts: LoadedAccount[] | null = null;

export function loadAccountsFromEnv(env: NodeJS.ProcessEnv = process.env): LoadedAccount[] {
  if (cachedAccounts) return cachedAccounts;

  const accounts: LoadedAccount[] = [];
  const seenIds = new Set<string>();

  for (let n = 1; n <= 50; n++) {
    const label = env[`ELEVENLABS_ACCOUNT_${n}_LABEL`];
    const apiKey = env[`ELEVENLABS_ACCOUNT_${n}_API_KEY`];
    const baseUrlRaw = env[`ELEVENLABS_ACCOUNT_${n}_BASE_URL`];
    if (!label) continue; // this slot is not used; keep scanning, blocks can be sparse

    let id = slugify(label) || `account-${n}`;
    // Guard against two accounts slugifying to the same id (e.g. same label twice)
    while (seenIds.has(id)) id = `${id}-${n}`;
    seenIds.add(id);

    accounts.push({
      id,
      label,
      region: "default",
      baseUrl: (baseUrlRaw && baseUrlRaw.trim()) || DEFAULT_BASE_URL,
      hasKey: Boolean(apiKey && apiKey.trim().length > 0),
      apiKey: apiKey && apiKey.trim().length > 0 ? apiKey.trim() : undefined,
    });
  }

  cachedAccounts = accounts;
  return accounts;
}

/** Public, secret-free view of configured accounts -- safe to send to the renderer. */
export function listAccountsPublic(): Account[] {
  return loadAccountsFromEnv().map(({ apiKey, ...rest }) => rest);
}

export function getAccountById(accountId: string): LoadedAccount | undefined {
  return loadAccountsFromEnv().find((a) => a.id === accountId);
}

/** Resolves the API key for an account. Throws if the account is unknown. Never log the result. */
export function resolveApiKey(accountId: string): string | undefined {
  const account = getAccountById(accountId);
  if (!account) throw new Error(`Unknown account: ${accountId}`);
  return account.apiKey;
}

export function resetAccountsCacheForTests(): void {
  cachedAccounts = null;
}
