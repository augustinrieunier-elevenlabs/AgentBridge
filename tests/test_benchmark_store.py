from services import benchmark_store


def test_list_runs_returns_empty_when_file_is_missing(tmp_path):
    assert benchmark_store.list_runs(str(tmp_path)) == []


def test_save_then_list_round_trips(tmp_path):
    saved = benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})
    assert saved["benchmarkId"] == "bm-1"
    assert "id" in saved and "finishedAt" in saved

    runs = benchmark_store.list_runs(str(tmp_path))
    assert len(runs) == 1
    assert runs[0]["id"] == saved["id"]


def test_list_runs_filters_by_benchmark_id(tmp_path):
    benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})
    benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-2", "variants": []})

    runs = benchmark_store.list_runs(str(tmp_path), benchmark_id="bm-2")
    assert len(runs) == 1
    assert runs[0]["benchmarkId"] == "bm-2"


def test_update_run_merges_the_patch_into_the_existing_run(tmp_path):
    saved = benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": [{"variantId": "v0", "asr": None}]})

    updated = benchmark_store.update_run(str(tmp_path), saved["id"], {"variants": [{"variantId": "v0", "asr": {"min": 1, "max": 2, "avg": 1.5, "n": 4}}]})

    assert updated["variants"][0]["asr"] == {"min": 1, "max": 2, "avg": 1.5, "n": 4}
    assert updated["benchmarkId"] == "bm-1"  # untouched fields survive the merge

    reloaded = benchmark_store.list_runs(str(tmp_path))
    assert reloaded[0]["variants"][0]["asr"]["n"] == 4


def test_update_run_returns_none_for_an_unknown_run_id(tmp_path):
    benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})
    assert benchmark_store.update_run(str(tmp_path), "run-does-not-exist", {"variants": []}) is None


def test_update_run_strips_anything_that_looks_like_a_secret(tmp_path):
    saved = benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})
    benchmark_store.update_run(str(tmp_path), saved["id"], {"leaked": "sk_live_should_never_be_here"})

    raw = (tmp_path / "benchmark_runs.json").read_text()
    assert "sk_live_should_never_be_here" not in raw


def test_clear_runs_removes_every_saved_run(tmp_path):
    benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})
    benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-2", "variants": []})
    assert len(benchmark_store.list_runs(str(tmp_path))) == 2

    benchmark_store.clear_runs(str(tmp_path))

    assert benchmark_store.list_runs(str(tmp_path)) == []


def test_clear_runs_does_not_touch_pending_restores(tmp_path):
    benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})
    benchmark_store.save_pending_restore(str(tmp_path), "acct", "agent_1", {"llm": "claude-sonnet-4-6"})

    benchmark_store.clear_runs(str(tmp_path))

    assert benchmark_store.list_runs(str(tmp_path)) == []
    assert benchmark_store.get_pending_restore(str(tmp_path), "acct", "agent_1")["llm"] == "claude-sonnet-4-6"


def test_delete_run_removes_only_the_matching_run(tmp_path):
    a = benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})
    b = benchmark_store.save_run(str(tmp_path), {"benchmarkId": "bm-1", "variants": []})

    benchmark_store.delete_run(str(tmp_path), a["id"])

    remaining = benchmark_store.list_runs(str(tmp_path))
    assert [r["id"] for r in remaining] == [b["id"]]


def test_get_pending_restore_returns_none_when_nothing_is_recorded(tmp_path):
    assert benchmark_store.get_pending_restore(str(tmp_path), "acct", "agent_1") is None


def test_save_then_get_pending_restore_round_trips(tmp_path):
    benchmark_store.save_pending_restore(str(tmp_path), "acct", "agent_1", {"llm": "claude-sonnet-4-6", "tts_model_id": "eleven_v4_turbo"})

    restore = benchmark_store.get_pending_restore(str(tmp_path), "acct", "agent_1")

    assert restore["llm"] == "claude-sonnet-4-6"
    assert restore["tts_model_id"] == "eleven_v4_turbo"
    assert "recordedAt" in restore


def test_pending_restore_is_scoped_per_account_and_agent(tmp_path):
    benchmark_store.save_pending_restore(str(tmp_path), "acct-a", "agent_1", {"llm": "model-a"})
    benchmark_store.save_pending_restore(str(tmp_path), "acct-b", "agent_1", {"llm": "model-b"})

    assert benchmark_store.get_pending_restore(str(tmp_path), "acct-a", "agent_1")["llm"] == "model-a"
    assert benchmark_store.get_pending_restore(str(tmp_path), "acct-b", "agent_1")["llm"] == "model-b"


def test_a_second_save_overwrites_the_first_pending_restore_for_the_same_agent(tmp_path):
    # Only one in-flight benchmark per callee agent is expected at a time -- a second save
    # (e.g. a retried run) should replace the stale record, not stack another one.
    benchmark_store.save_pending_restore(str(tmp_path), "acct", "agent_1", {"llm": "first"})
    benchmark_store.save_pending_restore(str(tmp_path), "acct", "agent_1", {"llm": "second"})

    assert benchmark_store.get_pending_restore(str(tmp_path), "acct", "agent_1")["llm"] == "second"


def test_clear_pending_restore_removes_the_record(tmp_path):
    benchmark_store.save_pending_restore(str(tmp_path), "acct", "agent_1", {"llm": "claude-sonnet-4-6"})
    benchmark_store.clear_pending_restore(str(tmp_path), "acct", "agent_1")

    assert benchmark_store.get_pending_restore(str(tmp_path), "acct", "agent_1") is None


def test_clear_pending_restore_is_a_no_op_when_nothing_is_recorded(tmp_path):
    benchmark_store.clear_pending_restore(str(tmp_path), "acct", "agent_1")  # must not raise
    assert benchmark_store.get_pending_restore(str(tmp_path), "acct", "agent_1") is None
