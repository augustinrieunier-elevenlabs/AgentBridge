from services import secrets


def test_loads_accounts_from_sparse_numbered_env_vars(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_LABEL", "Demo FR")
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_API_KEY", "sk_abc")
    monkeypatch.delenv("ELEVENLABS_ACCOUNT_2_LABEL", raising=False)
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_5_LABEL", "Prospect sandbox")
    monkeypatch.delenv("ELEVENLABS_ACCOUNT_5_API_KEY", raising=False)
    secrets.reset_accounts_cache()

    accounts = secrets.load_accounts()

    assert [a["label"] for a in accounts] == ["Demo FR", "Prospect sandbox"]
    assert accounts[0]["has_key"] is True
    assert accounts[1]["has_key"] is False


def test_account_id_is_a_stable_slug_of_the_label(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_LABEL", "Compte démo FR!")
    monkeypatch.delenv("ELEVENLABS_ACCOUNT_1_API_KEY", raising=False)
    secrets.reset_accounts_cache()

    accounts = secrets.load_accounts()
    assert accounts[0]["id"] == "compte-demo-fr"


def test_list_accounts_public_never_includes_the_api_key(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_LABEL", "Demo FR")
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_API_KEY", "sk_should_not_leak")
    secrets.reset_accounts_cache()

    public_accounts = secrets.list_accounts_public()
    assert all("api_key" not in a for a in public_accounts)
    import json

    assert "sk_should_not_leak" not in json.dumps(public_accounts)


def test_resolve_api_key_raises_for_unknown_account(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_ACCOUNT_1_LABEL", raising=False)
    secrets.reset_accounts_cache()

    try:
        secrets.resolve_api_key("does-not-exist")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_default_base_url_when_not_set(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_LABEL", "Demo FR")
    monkeypatch.delenv("ELEVENLABS_ACCOUNT_1_BASE_URL", raising=False)
    secrets.reset_accounts_cache()

    assert secrets.load_accounts()[0]["base_url"] == "https://api.elevenlabs.io"
