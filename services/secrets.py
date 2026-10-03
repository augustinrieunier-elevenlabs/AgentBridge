"""
Account/secret loading from environment variables.

Accounts are declared entirely in `.env` (never through the UI) as numbered
blocks:

    ELEVENLABS_ACCOUNT_1_LABEL=Demo FR
    ELEVENLABS_ACCOUNT_1_API_KEY=sk_...
    ELEVENLABS_ACCOUNT_1_BASE_URL=https://api.elevenlabs.io   (optional)

This keeps the API key out of the browser entirely: the Flask backend
resolves an account's key on demand, uses it for one REST call or signed-URL
request, and never sends it to the frontend. Accounts with no API key are
"public agent only" accounts (see spec-agent-bridge-demo.md section 4.3).
"""
import os
import re
import unicodedata

DEFAULT_BASE_URL = "https://api.elevenlabs.io"
MAX_ACCOUNT_SLOTS = 50

_accounts_cache = None


def _slugify(label):
    """Converts an account label into a stable, URL-safe id."""
    normalized = unicodedata.normalize("NFKD", label.lower())
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    return slug


def load_accounts(env=None):
    """
    Returns the full list of configured accounts, each a dict with:
    id, label, region, base_url, has_key, api_key (private -- never sent to the client).
    Cached in-process; call reset_accounts_cache() in tests that need a fresh read.
    """
    global _accounts_cache
    if _accounts_cache is not None:
        return _accounts_cache

    env = env or os.environ
    accounts = []
    seen_ids = set()

    for n in range(1, MAX_ACCOUNT_SLOTS + 1):
        label = env.get(f"ELEVENLABS_ACCOUNT_{n}_LABEL")
        if not label:
            continue  # sparse slots are allowed -- keep scanning

        api_key = env.get(f"ELEVENLABS_ACCOUNT_{n}_API_KEY") or ""
        api_key = api_key.strip() or None
        base_url = (env.get(f"ELEVENLABS_ACCOUNT_{n}_BASE_URL") or "").strip() or DEFAULT_BASE_URL

        account_id = _slugify(label) or f"account-{n}"
        while account_id in seen_ids:
            account_id = f"{account_id}-{n}"
        seen_ids.add(account_id)

        accounts.append(
            {
                "id": account_id,
                "label": label,
                "region": "default",
                "base_url": base_url,
                "has_key": api_key is not None,
                "api_key": api_key,
            }
        )

    _accounts_cache = accounts
    return accounts


def list_accounts_public():
    """Secret-free view of configured accounts -- safe to send to the browser."""
    return [{k: v for k, v in account.items() if k != "api_key"} for account in load_accounts()]


def get_account(account_id):
    return next((a for a in load_accounts() if a["id"] == account_id), None)


def resolve_api_key(account_id):
    account = get_account(account_id)
    if account is None:
        raise ValueError(f"Unknown account: {account_id}")
    return account["api_key"]


def reset_accounts_cache():
    global _accounts_cache
    _accounts_cache = None
