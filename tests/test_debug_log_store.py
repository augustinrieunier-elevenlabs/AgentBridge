import pytest

from services import debug_log_store


def test_list_debug_logs_returns_empty_when_the_directory_does_not_exist(tmp_path):
    assert debug_log_store.list_debug_logs(str(tmp_path)) == []


def test_save_then_list_round_trips(tmp_path):
    path = debug_log_store.save_debug_log(str(tmp_path), {
        "benchmarkName": "LLMS only",
        "variantLabel": "claude-sonnet-5-5",
        "scenarioName": "Get Account Details",
        "endReason": "deadlock_timeout",
        "debugLog": [{"at": 0, "agent": "callee", "summary": "agent_response"}, {"at": 1, "agent": "caller", "summary": "websocket closed (code=1005)"}],
        "metricsLog": [{"at": 1000, "calleeQueueMs": 2205, "calleeUnderruns": 3}],
    })

    logs = debug_log_store.list_debug_logs(str(tmp_path))
    assert len(logs) == 1
    assert logs[0]["path"] == path
    assert logs[0]["benchmark_name"] == "LLMS only"
    assert logs[0]["variant_label"] == "claude-sonnet-5-5"
    assert logs[0]["scenario_name"] == "Get Account Details"
    assert logs[0]["end_reason"] == "deadlock_timeout"
    assert logs[0]["event_count"] == 2

    data = debug_log_store.read_debug_log(str(tmp_path), path)
    assert data["metricsLog"][0]["calleeQueueMs"] == 2205
    assert len(data["debugLog"]) == 2


def test_save_debug_log_strips_anything_that_looks_like_a_secret(tmp_path):
    path = debug_log_store.save_debug_log(str(tmp_path), {
        "scenarioName": "test",
        "leaked": "sk_live_should_never_be_here",
        "debugLog": [],
    })
    raw = open(path, encoding="utf-8").read()
    assert "sk_live_should_never_be_here" not in raw


def test_read_debug_log_rejects_a_path_outside_the_debug_logs_directory(tmp_path):
    outside = tmp_path.parent / "outside.json"
    outside.write_text("{}")
    with pytest.raises(ValueError):
        debug_log_store.read_debug_log(str(tmp_path), str(outside))
