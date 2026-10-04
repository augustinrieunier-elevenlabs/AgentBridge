import pytest

from services import config_store


def test_load_config_returns_defaults_when_file_is_missing(tmp_path):
    cfg = config_store.load_config(str(tmp_path))
    assert cfg == config_store.DEFAULT_CONFIG


def test_save_then_load_roundtrips(tmp_path):
    cfg = {
        "agents": [{"id": "a1", "label": "Caller"}],
        "scenarios": [],
        "presets": [],
        "benchmarks": [],
        "noiseProfiles": [],
        "settings": {"frame_size_ms": 50, "asr_comparison_enabled": True, "voice_table": {"ja": "voice_123"}},
    }
    config_store.save_config(str(tmp_path), cfg)
    loaded = config_store.load_config(str(tmp_path))
    assert loaded == cfg


def test_save_config_strips_anything_that_looks_like_a_secret(tmp_path):
    cfg = {
        "agents": [{"id": "a1", "leaked_key": "sk_live_should_never_be_here"}],
        "scenarios": [],
        "presets": [],
        "benchmarks": [],
        "settings": {"frame_size_ms": 100, "asr_comparison_enabled": False, "voice_table": {}},
    }
    config_store.save_config(str(tmp_path), cfg)

    raw = (tmp_path / "config.json").read_text()
    assert "sk_live_should_never_be_here" not in raw


def test_export_roundtrip_and_listing(tmp_path):
    path = config_store.save_export(str(tmp_path), "My Scenario!", {"turns": []})
    exports = config_store.list_exports(str(tmp_path))
    assert len(exports) == 1
    assert exports[0]["path"] == path

    data = config_store.read_export(str(tmp_path), path)
    assert data == {"turns": []}


def test_list_exports_surfaces_run_type_and_title_for_the_history_ui(tmp_path):
    config_store.save_export(str(tmp_path), "Get Account Details", {
        "runType": "session", "title": "Get Account Details",
        "conversations": [{"scenarioId": "s1"}],
    })
    exports = config_store.list_exports(str(tmp_path))
    assert exports[0]["run_type"] == "session"
    assert exports[0]["title"] == "Get Account Details"
    assert exports[0]["conversation_count"] == 1


def test_list_exports_surfaces_callee_and_callee_config_for_the_analytics_view(tmp_path):
    config_store.save_export(str(tmp_path), "Get Account Details", {
        "runType": "session",
        "callee": {"label": "Elize Brew", "accountId": "sandbox-demo-account", "agentId": "agent_1"},
        "calleeConfig": {"llm": "claude-sonnet-4-6", "tts_model_id": "eleven_v4_turbo"},
        "conversations": [],
    })
    exports = config_store.list_exports(str(tmp_path))
    assert exports[0]["callee"]["agentId"] == "agent_1"
    assert exports[0]["callee_config"]["llm"] == "claude-sonnet-4-6"


def test_list_exports_degrades_gracefully_for_a_pre_existing_export_without_run_type(tmp_path):
    config_store.save_export(str(tmp_path), "Old Export", {"turns": []})
    exports = config_store.list_exports(str(tmp_path))
    assert exports[0].get("run_type") is None
    assert exports[0]["name"]  # still listable by its raw file name


def test_clear_exports_removes_every_saved_export(tmp_path):
    config_store.save_export(str(tmp_path), "First", {"turns": []})
    config_store.save_export(str(tmp_path), "Second", {"turns": []})
    assert len(config_store.list_exports(str(tmp_path))) == 2

    config_store.clear_exports(str(tmp_path))

    assert config_store.list_exports(str(tmp_path)) == []


def test_clear_exports_is_a_no_op_when_the_directory_does_not_exist(tmp_path):
    config_store.clear_exports(str(tmp_path))  # must not raise
    assert config_store.list_exports(str(tmp_path)) == []


def test_read_export_rejects_path_outside_exports_dir(tmp_path):
    outside = tmp_path.parent / "outside.json"
    outside.write_text("{}")
    with pytest.raises(ValueError):
        config_store.read_export(str(tmp_path), str(outside))


def test_update_export_merges_a_patch_into_the_existing_file(tmp_path):
    path = config_store.save_export(str(tmp_path), "Get Account Details", {"runType": "session", "conversations": []})

    updated = config_store.update_export(str(tmp_path), path, {"nodeNames": {"start_node": {"label": "start_node", "type": "start"}}})

    assert updated["nodeNames"] == {"start_node": {"label": "start_node", "type": "start"}}
    assert updated["runType"] == "session"  # existing fields untouched
    assert config_store.read_export(str(tmp_path), path)["nodeNames"] == {"start_node": {"label": "start_node", "type": "start"}}


def test_update_export_strips_anything_that_looks_like_a_secret(tmp_path):
    path = config_store.save_export(str(tmp_path), "Get Account Details", {"conversations": []})

    updated = config_store.update_export(str(tmp_path), path, {"leaked": "sk_live_should_never_be_here"})

    assert updated["leaked"] is None


def test_update_export_rejects_path_outside_exports_dir(tmp_path):
    outside = tmp_path.parent / "outside.json"
    outside.write_text("{}")
    with pytest.raises(ValueError):
        config_store.update_export(str(tmp_path), str(outside), {"nodeNames": {}})
