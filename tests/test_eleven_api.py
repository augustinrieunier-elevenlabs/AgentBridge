import pytest

from services import eleven_api, secrets


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, text=""):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._json = json_data or {}
        self.text = text

    def json(self):
        return self._json


@pytest.fixture
def one_account(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_LABEL", "Demo A")
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_API_KEY", "sk_test")
    secrets.reset_accounts_cache()
    yield
    secrets.reset_accounts_cache()


def test_test_account_reports_ok_on_200(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {"agents": []}))
    result = eleven_api.test_account("demo-a")
    assert result == {"ok": True}


def test_test_account_reports_error_with_status_code(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(401, text="invalid key"))
    result = eleven_api.test_account("demo-a")
    assert result["ok"] is False
    assert result["status_code"] == 401
    assert "invalid key" in result["error"]


def test_refuses_to_call_a_non_elevenlabs_host(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_LABEL", "Demo A")
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_API_KEY", "sk_test")
    monkeypatch.setenv("ELEVENLABS_ACCOUNT_1_BASE_URL", "https://evil.example.com")
    secrets.reset_accounts_cache()

    # test_account() wraps ElevenApiError into a {ok: False} result rather
    # than raising, so assert on that -- but the lower-level call still must
    # refuse the host rather than silently hitting it.
    result = eleven_api.test_account("demo-a")
    assert result["ok"] is False
    assert "Refusing" in result["error"]
    secrets.reset_accounts_cache()


def test_get_agent_parses_nested_override_flags_and_formats(one_account, monkeypatch):
    fake_agent = {
        "name": "Caller Simulator",
        "conversation_config": {
            "agent": {
                "language": "ja",
                "dynamic_variables": {"dynamic_variable_placeholders": {"hotel_name": "Hotel Le Marais", "guest_name": ""}},
            },
            "asr": {"user_input_audio_format": "pcm_16000"},
            "tts": {"agent_output_audio_format": "pcm_16000"},
            "language_presets": {"ja": {}},
        },
        "platform_settings": {
            "overrides": {
                "conversation_config_override": {
                    "agent": {"language": True, "first_message": True},
                    "tts": {"voice_id": True},
                    "conversation": {"max_duration_seconds": True},
                }
            }
        },
    }
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, fake_agent))

    meta = eleven_api.get_agent("demo-a", "agent_123")

    assert meta["name"] == "Caller Simulator"
    assert meta["input_format"] == "pcm_16000"
    assert meta["output_format"] == "pcm_16000"
    assert meta["overrides_enabled"]["agent_language"] is True
    assert meta["overrides_enabled"]["agent_prompt"] is False
    assert meta["overrides_enabled"]["conversation_max_duration"] is True
    assert meta["additional_languages"] == ["ja"]
    assert meta["dynamic_variable_placeholders"] == {"hotel_name": "Hotel Le Marais", "guest_name": ""}


def test_get_agent_reads_agent_prompt_override_through_its_extra_nesting(one_account, monkeypatch):
    # Unlike every other field in conversation_config_override, `agent.prompt` is itself an
    # object ({"prompt": bool, "llm": bool, ...}), not a bare boolean -- real shape confirmed via
    # `elevenlabs agents get`. Regression test: a naive single-level read (`override["agent"].get
    # ("prompt")`) returns that dict and `dict is True` is always False, so this flag silently
    # never reported true, even with the toggle genuinely enabled on the agent.
    fake_agent = {
        "name": "Caller Prompt Override",
        "conversation_config": {
            "agent": {"language": "en"},
            "asr": {"user_input_audio_format": "pcm_16000"},
            "tts": {"agent_output_audio_format": "pcm_16000"},
        },
        "platform_settings": {
            "overrides": {
                "conversation_config_override": {
                    "agent": {"language": True, "prompt": {"prompt": True, "llm": False, "knowledge_base": False, "tool_ids": False}},
                }
            }
        },
    }
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, fake_agent))

    meta = eleven_api.get_agent("demo-a", "agent_456")

    assert meta["overrides_enabled"]["agent_prompt"] is True


def test_get_agent_defaults_to_empty_dynamic_variable_placeholders(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {"name": "Bare agent"}))
    meta = eleven_api.get_agent("demo-a", "agent_123")
    assert meta["dynamic_variable_placeholders"] == {}


def test_get_signed_url_raises_when_api_omits_the_field(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {}))
    with pytest.raises(eleven_api.ElevenApiError, match="signed_url"):
        eleven_api.get_signed_url("demo-a", "agent_123")


def test_get_llm_list_flattens_checkpoint_and_deprecation_flags(one_account, monkeypatch):
    fake_response = {
        "llms": [
            {"llm": "claude-sonnet-5-5", "is_checkpoint": False, "deprecation_info": None},
            {"llm": "gpt-4-turbo", "is_checkpoint": False, "deprecation_info": {"is_deprecated": True}},
            {"llm": "claude-sonnet-4@20250514", "is_checkpoint": True, "deprecation_info": None},
        ]
    }
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, fake_response))

    llms = eleven_api.get_llm_list("demo-a")

    assert llms == [
        {"llm": "claude-sonnet-5-5", "is_checkpoint": False, "deprecated": False},
        {"llm": "gpt-4-turbo", "is_checkpoint": False, "deprecated": True},
        {"llm": "claude-sonnet-4@20250514", "is_checkpoint": True, "deprecated": False},
    ]


def test_get_agent_model_config_reads_tts_model_id_and_llm(one_account, monkeypatch):
    fake_agent = {"conversation_config": {"tts": {"model_id": "eleven_v4_turbo"}, "agent": {"prompt": {"llm": "claude-sonnet-4-6"}}}}
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, fake_agent))

    snapshot = eleven_api.get_agent_model_config("demo-a", "agent_123")

    assert snapshot == {"tts_model_id": "eleven_v4_turbo", "llm": "claude-sonnet-4-6"}


def test_update_agent_model_config_sends_patch_with_only_the_fields_given(one_account, monkeypatch):
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs.get("json")))
        return FakeResponse(200, {})

    monkeypatch.setattr(eleven_api.requests, "request", fake_request)

    eleven_api.update_agent_model_config("demo-a", "agent_123", tts_model_id="eleven_flash_v2_5")

    assert len(calls) == 1
    method, url, body = calls[0]
    assert method == "PATCH"
    assert url.endswith("/v1/convai/agents/agent_123")
    assert body == {"conversation_config": {"tts": {"model_id": "eleven_flash_v2_5"}}}


def test_update_agent_model_config_sends_both_fields_when_given(one_account, monkeypatch):
    calls = []
    monkeypatch.setattr(eleven_api.requests, "request", lambda method, url, **kwargs: (calls.append(kwargs.get("json")), FakeResponse(200, {}))[1])

    eleven_api.update_agent_model_config("demo-a", "agent_123", tts_model_id="eleven_v4", llm="gpt-5.5")

    assert calls[0] == {"conversation_config": {"tts": {"model_id": "eleven_v4"}, "agent": {"prompt": {"llm": "gpt-5.5"}}}}


def test_get_agent_workflow_nodes_maps_id_to_label_and_type(one_account, monkeypatch):
    fake_agent = {
        "workflow": {
            "nodes": {
                "start_node": {"label": "start_node", "type": "start", "position": {"x": 0, "y": 0}},
                "node_01ky2spx1hf69ad74gshkjapa6": {"label": "Transfer to human", "type": "standalone_agent", "position": {"x": 1, "y": 1}},
            }
        }
    }
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, fake_agent))

    nodes = eleven_api.get_agent_workflow_nodes("demo-a", "agent_123")

    assert nodes == {
        "start_node": {"label": "start_node", "type": "start"},
        "node_01ky2spx1hf69ad74gshkjapa6": {"label": "Transfer to human", "type": "standalone_agent"},
    }


def test_get_agent_workflow_nodes_falls_back_to_the_id_when_a_node_has_no_label(one_account, monkeypatch):
    fake_agent = {"workflow": {"nodes": {"node_abc": {"type": "tool"}}}}
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, fake_agent))

    nodes = eleven_api.get_agent_workflow_nodes("demo-a", "agent_123")

    assert nodes == {"node_abc": {"label": "node_abc", "type": "tool"}}


def test_get_agent_workflow_nodes_defaults_to_empty_when_agent_has_no_workflow(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {"name": "No workflow"}))

    assert eleven_api.get_agent_workflow_nodes("demo-a", "agent_123") == {}


def test_get_agent_workflow_returns_the_raw_workflow_object(one_account, monkeypatch):
    fake_workflow = {"nodes": {"start_node": {"type": "start"}}, "edges": {}, "subgraphs": {}, "prevent_subagent_loops": True}
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {"workflow": fake_workflow}))

    assert eleven_api.get_agent_workflow("demo-a", "agent_123") == fake_workflow


def test_get_agent_workflow_defaults_to_empty_when_agent_has_no_workflow(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {"name": "No workflow"}))

    assert eleven_api.get_agent_workflow("demo-a", "agent_123") == {}


def test_update_agent_workflow_sends_the_whole_object_as_a_patch(one_account, monkeypatch):
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs.get("json")))
        return FakeResponse(200, {})

    monkeypatch.setattr(eleven_api.requests, "request", fake_request)
    workflow = {"nodes": {"start_node": {"type": "start"}}, "edges": {}}

    eleven_api.update_agent_workflow("demo-a", "agent_123", workflow)

    assert len(calls) == 1
    method, url, body = calls[0]
    assert method == "PATCH"
    assert url.endswith("/v1/convai/agents/agent_123")
    assert body == {"workflow": workflow}


def test_set_workflow_node_llms_reads_then_patches_only_the_targeted_node(one_account, monkeypatch):
    fake_workflow = {
        "nodes": {
            "start_node": {"type": "start"},
            "error_codes": {"type": "override_agent", "label": "Error codes", "conversation_config": {"agent": {"prompt": {"llm": None}}}},
        },
        "edges": {"e1": {}},
    }
    calls = []

    def fake_request(method, url, json=None, **kwargs):
        if method == "GET":
            return FakeResponse(200, {"workflow": fake_workflow})
        calls.append(("PATCH", json))
        return FakeResponse(200, {})

    monkeypatch.setattr(eleven_api.requests, "request", fake_request)

    eleven_api.set_workflow_node_llms("demo-a", "agent_123", {"error_codes": "claude-sonnet-5-5"})

    assert len(calls) == 1
    patched_workflow = calls[0][1]["workflow"]
    assert patched_workflow["nodes"]["error_codes"]["conversation_config"]["agent"]["prompt"]["llm"] == "claude-sonnet-5-5"
    # every other node/field untouched
    assert patched_workflow["nodes"]["start_node"] == {"type": "start"}
    assert patched_workflow["edges"] == {"e1": {}}


def test_set_workflow_node_llms_rejects_an_unknown_node(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {"workflow": {"nodes": {}}}))

    with pytest.raises(eleven_api.ElevenApiError, match="Unknown workflow node"):
        eleven_api.set_workflow_node_llms("demo-a", "agent_123", {"does-not-exist": "claude-sonnet-5-5"})


def test_set_workflow_node_llms_rejects_a_node_that_is_not_an_override_agent(one_account, monkeypatch):
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: FakeResponse(200, {"workflow": {"nodes": {"start_node": {"type": "start"}}}}))

    with pytest.raises(eleven_api.ElevenApiError, match="only an override_agent node"):
        eleven_api.set_workflow_node_llms("demo-a", "agent_123", {"start_node": "claude-sonnet-5-5"})


def test_update_agent_model_config_skips_the_request_when_nothing_is_given(one_account, monkeypatch):
    calls = []
    monkeypatch.setattr(eleven_api.requests, "request", lambda *a, **k: calls.append(1))

    result = eleven_api.update_agent_model_config("demo-a", "agent_123")

    assert calls == []
    assert result == {"ok": True}
