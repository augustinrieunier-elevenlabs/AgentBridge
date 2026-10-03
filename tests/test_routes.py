from services import eleven_api


def test_list_accounts_never_leaks_the_api_key(client):
    res = client.get("/api/accounts")
    assert res.status_code == 200
    body = res.get_json()
    assert len(body) == 2
    assert all("api_key" not in a for a in body)


def test_test_account_rejects_unknown_account(client):
    res = client.post("/api/accounts/does-not-exist/test")
    assert res.status_code == 404


def test_inspect_agent_rejects_unsafe_agent_id(client):
    res = client.get("/api/agents/demo-a/../../etc/passwd/inspect")
    assert res.status_code in (400, 404)  # Flask routing itself may 404 on the path traversal attempt


def test_inspect_agent_rejects_unknown_account(client):
    res = client.get("/api/agents/unknown-account/agent_123/inspect")
    assert res.status_code == 400


def test_signed_url_uses_public_url_when_account_has_no_key(client, monkeypatch):
    monkeypatch.setattr(eleven_api, "get_public_agent_url", lambda account_id, agent_id: "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_123")

    res = client.get("/api/session/signed-url", query_string={"account_id": "demo-b-public", "agent_id": "agent_123"})
    assert res.status_code == 200
    assert res.get_json()["url"].startswith("wss://api.elevenlabs.io")


def test_signed_url_rejects_unsafe_agent_id(client):
    res = client.get("/api/session/signed-url", query_string={"account_id": "demo-a", "agent_id": "../etc/passwd"})
    assert res.status_code == 400


def test_config_round_trips_through_the_api(client):
    cfg = {"agents": [], "scenarios": [], "presets": [], "benchmarks": [], "settings": {"frame_size_ms": 100, "asr_comparison_enabled": False, "voice_table": {}}}
    post_res = client.post("/api/config", json=cfg)
    assert post_res.status_code == 200

    get_res = client.get("/api/config")
    assert get_res.get_json() == cfg


def test_list_llms_rejects_unknown_account(client):
    res = client.get("/api/agents/unknown-account/llms")
    assert res.status_code == 400


def test_get_model_config_rejects_unsafe_agent_id(client):
    res = client.get("/api/agents/demo-a/../../etc/passwd/model-config")
    assert res.status_code in (400, 404)


def test_set_model_config_rejects_unknown_account(client):
    res = client.post("/api/agents/unknown-account/agent_123/model-config", json={"tts_model_id": "eleven_v4"})
    assert res.status_code == 400


def test_set_model_config_calls_eleven_api_with_the_posted_fields(client, monkeypatch):
    calls = []
    monkeypatch.setattr(eleven_api, "update_agent_model_config", lambda account_id, agent_id, tts_model_id=None, llm=None: calls.append((account_id, agent_id, tts_model_id, llm)))

    res = client.post("/api/agents/demo-a/agent_123/model-config", json={"tts_model_id": "eleven_v4_turbo", "llm": "claude-sonnet-5-5"})

    assert res.status_code == 200
    assert calls == [("demo-a", "agent_123", "eleven_v4_turbo", "claude-sonnet-5-5")]


def test_pending_restore_round_trips_through_the_api(client):
    get_res = client.get("/api/agents/demo-a/agent_123/pending-restore")
    assert get_res.status_code == 200
    assert get_res.get_json() is None

    save_res = client.post("/api/agents/demo-a/agent_123/pending-restore", json={"llm": "claude-sonnet-4-6", "tts_model_id": "eleven_v4_turbo"})
    assert save_res.status_code == 200

    get_res = client.get("/api/agents/demo-a/agent_123/pending-restore")
    assert get_res.get_json()["llm"] == "claude-sonnet-4-6"

    del_res = client.delete("/api/agents/demo-a/agent_123/pending-restore")
    assert del_res.status_code == 200
    assert client.get("/api/agents/demo-a/agent_123/pending-restore").get_json() is None


def test_pending_restore_rejects_unknown_account(client):
    res = client.get("/api/agents/unknown-account/agent_123/pending-restore")
    assert res.status_code == 400


def test_benchmark_run_round_trips_through_the_api(client):
    save_res = client.post("/api/benchmark-runs", json={"benchmarkId": "bm-1", "variants": []})
    assert save_res.status_code == 200
    run_id = save_res.get_json()["id"]

    list_res = client.get("/api/benchmark-runs", query_string={"benchmark_id": "bm-1"})
    assert any(r["id"] == run_id for r in list_res.get_json())

    del_res = client.delete(f"/api/benchmark-runs/{run_id}")
    assert del_res.status_code == 200
    assert client.get("/api/benchmark-runs").get_json() == []


def test_benchmark_run_can_be_patched_with_refreshed_stats(client):
    save_res = client.post("/api/benchmark-runs", json={"benchmarkId": "bm-1", "variants": [{"variantId": "v0", "asr": None}]})
    run_id = save_res.get_json()["id"]

    patch_res = client.patch(f"/api/benchmark-runs/{run_id}", json={"variants": [{"variantId": "v0", "asr": {"min": 1, "max": 2, "avg": 1.5, "n": 3}}]})
    assert patch_res.status_code == 200
    assert patch_res.get_json()["variants"][0]["asr"]["n"] == 3

    list_res = client.get("/api/benchmark-runs")
    assert list_res.get_json()[0]["variants"][0]["asr"]["n"] == 3


def test_patching_an_unknown_benchmark_run_returns_404(client):
    res = client.patch("/api/benchmark-runs/run-does-not-exist", json={"variants": []})
    assert res.status_code == 404


def test_clear_benchmark_runs_via_the_api(client):
    client.post("/api/benchmark-runs", json={"benchmarkId": "bm-1", "variants": []})
    client.post("/api/benchmark-runs", json={"benchmarkId": "bm-2", "variants": []})

    del_res = client.delete("/api/benchmark-runs")
    assert del_res.status_code == 200
    assert client.get("/api/benchmark-runs").get_json() == []


def test_export_round_trips_through_the_api(client):
    save_res = client.post("/api/exports", json={"name": "demo", "data": {"turns": []}})
    assert save_res.status_code == 200
    path = save_res.get_json()["path"]

    list_res = client.get("/api/exports")
    assert any(e["path"] == path for e in list_res.get_json())

    read_res = client.get("/api/exports/read", query_string={"path": path})
    assert read_res.get_json() == {"turns": []}


def test_clear_exports_via_the_api(client):
    client.post("/api/exports", json={"name": "demo", "data": {"turns": []}})
    client.post("/api/exports", json={"name": "demo2", "data": {"turns": []}})

    del_res = client.delete("/api/exports")
    assert del_res.status_code == 200
    assert client.get("/api/exports").get_json() == []


def test_debug_log_round_trips_through_the_api(client):
    save_res = client.post("/api/debug-logs", json={"scenarioName": "Get Account Details", "endReason": "deadlock_timeout", "debugLog": [{"at": 0, "agent": "callee", "summary": "x"}]})
    assert save_res.status_code == 200
    path = save_res.get_json()["path"]

    list_res = client.get("/api/debug-logs")
    assert any(e["path"] == path for e in list_res.get_json())

    read_res = client.get("/api/debug-logs/read", query_string={"path": path})
    assert read_res.get_json()["endReason"] == "deadlock_timeout"
