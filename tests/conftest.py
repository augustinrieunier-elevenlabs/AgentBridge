import pytest

from services import secrets


@pytest.fixture
def two_accounts_env(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_LABEL", "Demo A")
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_API_KEY", "sk_test_a")
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_2_LABEL", "Demo B (public)")
    monkeypatch.delenv("ELEVENLABS_ACCOUNT_2_API_KEY", raising=False)
    secrets.reset_accounts_cache()
    yield
    secrets.reset_accounts_cache()


@pytest.fixture
def app(tmp_path, two_accounts_env):
    from app import create_app

    flask_app = create_app(instance_path=str(tmp_path))
    flask_app.config.update(TESTING=True)
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()
