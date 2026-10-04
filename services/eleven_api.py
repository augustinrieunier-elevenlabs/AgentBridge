"""
Thin REST client for the ElevenLabs Conversational AI (ElevenAgents) API.
Only ever called from Flask routes -- never exposed directly to the browser.

Endpoints verified against https://elevenlabs.io/docs/eleven-agents/api-reference
and https://elevenlabs.io/docs/api-reference/agents/{list,get} on 2026-10-01:
    GET  /v1/convai/agents                              (list)
    GET  /v1/convai/agents/{agent_id}                    (get)
    GET  /v1/convai/conversation/get-signed-url          (signed url, ?agent_id=)
    GET  /v1/convai/conversations/{conversation_id}      (final transcript)

Added for the Benchmark feature (2026-10-02), verified against the `elevenlabs` CLI's embedded
OpenAPI spec and a live sandbox agent:
    GET   /v1/convai/llm/list                            (catalog of selectable LLMs)
    PATCH /v1/convai/agents/{agent_id}                    (partial update -- merges, doesn't
                                                            require resending the full config;
                                                            used here for conversation_config.tts.model_id
                                                            and conversation_config.agent.prompt.llm only)

Added for Workflow node-name resolution (2026-10-05), verified against the live ElevenLabs docs:
    GET /v1/convai/agents/{agent_id}'s top-level `workflow.nodes` (dict keyed by node id, each
    carrying a human-readable `label` and a `type`) -- see get_agent_workflow_nodes.

Added for the "test a per-node LLM recommendation" feature (2026-10-05), verified empirically
against a real sandbox agent (not just docs -- the docs don't spell out PATCH's merge semantics
for `workflow`):
    PATCH /v1/convai/agents/{agent_id} with a `workflow` key replaces the ENTIRE workflow, no
    partial/deep-merge -- see update_agent_workflow / set_workflow_node_llms.
"""
from urllib.parse import urlparse

import requests

from services.secrets import get_account

ALLOWED_HOST_SUFFIX = ".elevenlabs.io"
REQUEST_TIMEOUT_SECONDS = 15


class ElevenApiError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


def _assert_allowed_host(base_url):
    hostname = urlparse(base_url).hostname or ""
    if hostname != "elevenlabs.io" and not hostname.endswith(ALLOWED_HOST_SUFFIX):
        raise ElevenApiError(f"Refusing to call non-ElevenLabs host: {hostname}")


def _request(account_id, path, method="GET", query=None, body=None):
    account = get_account(account_id)
    if account is None:
        raise ElevenApiError(f"Unknown account: {account_id}")

    _assert_allowed_host(account["base_url"])
    url = account["base_url"].rstrip("/") + path
    headers = {}
    if account["api_key"]:
        headers["xi-api-key"] = account["api_key"]

    try:
        response = requests.request(
            method,
            url,
            headers=headers,
            params={k: v for k, v in (query or {}).items() if v is not None},
            json=body,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise ElevenApiError(f"Network error calling {path}: {exc}") from exc

    if not response.ok:
        raise ElevenApiError(f"ElevenLabs API error {response.status_code} on {path}: {response.text[:300]}", response.status_code)
    return response.json()


def test_account(account_id):
    try:
        _request(account_id, "/v1/convai/agents", query={"page_size": "1"})
        return {"ok": True}
    except ElevenApiError as exc:
        return {"ok": False, "error": str(exc), "status_code": exc.status_code}


def list_agents(account_id):
    out = []
    cursor = None
    while True:
        page = _request(account_id, "/v1/convai/agents", query={"page_size": "100", "cursor": cursor})
        out.extend({"agent_id": a["agent_id"], "name": a["name"]} for a in page.get("agents", []))
        if page.get("has_more"):
            cursor = page.get("next_cursor")
        else:
            break
    return out


def _read_override_flag(section, field):
    if not isinstance(section, dict):
        return False
    return section.get(field) is True


def get_agent(account_id, agent_id):
    agent = _request(account_id, f"/v1/convai/agents/{agent_id}")
    conversation_config = agent.get("conversation_config") or {}
    override_cfg = ((agent.get("platform_settings") or {}).get("overrides") or {}).get("conversation_config_override") or {}

    has_end_call_tool = "unknown"
    try:
        built_in_tools = conversation_config.get("agent", {}).get("prompt", {}).get("built_in_tools")
        if isinstance(built_in_tools, dict):
            has_end_call_tool = bool(built_in_tools.get("end_call"))
    except AttributeError:
        has_end_call_tool = "unknown"

    language_presets = conversation_config.get("language_presets") or {}

    # Variables declared in the dashboard's "Dynamic Variables" panel, with
    # the placeholder/default value used when a session doesn't supply one.
    # Verified field path: conversation_config.agent.dynamic_variables.dynamic_variable_placeholders
    # (https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables, 2026-10-01).
    dynamic_variable_placeholders = (conversation_config.get("agent", {}).get("dynamic_variables") or {}).get(
        "dynamic_variable_placeholders"
    ) or {}

    return {
        "name": agent.get("name", agent_id),
        "input_format": conversation_config.get("asr", {}).get("user_input_audio_format", "unknown"),
        "output_format": conversation_config.get("tts", {}).get("agent_output_audio_format", "unknown"),
        "language": conversation_config.get("agent", {}).get("language"),
        "additional_languages": list(language_presets.keys()),
        "dynamic_variable_placeholders": dynamic_variable_placeholders,
        "overrides_enabled": {
            # Note the extra nesting here only: conversation_config_override.agent.prompt is
            # itself an object ({"prompt": bool, "llm": bool, ...}), not a bare boolean like
            # every other field in this override tree -- drill one level deeper than
            # _read_override_flag's usual single-level lookup, or this always reads as a dict
            # and silently never passes `is True`.
            "agent_prompt": _read_override_flag((override_cfg.get("agent") or {}).get("prompt"), "prompt"),
            "agent_first_message": _read_override_flag(override_cfg.get("agent"), "first_message"),
            "agent_language": _read_override_flag(override_cfg.get("agent"), "language"),
            "tts_voice_id": _read_override_flag(override_cfg.get("tts"), "voice_id"),
            "tts_speed": _read_override_flag(override_cfg.get("tts"), "speed"),
            "asr_keywords": _read_override_flag(override_cfg.get("asr"), "keywords"),
            "conversation_max_duration": _read_override_flag(override_cfg.get("conversation"), "max_duration_seconds"),
        },
        "has_end_call_tool": has_end_call_tool,
    }


def get_signed_url(account_id, agent_id):
    data = _request(account_id, "/v1/convai/conversation/get-signed-url", query={"agent_id": agent_id})
    signed_url = data.get("signed_url")
    if not signed_url:
        raise ElevenApiError("ElevenLabs API did not return a signed_url")
    return signed_url


def get_public_agent_url(account_id, agent_id):
    """Direct (unsigned) connection URL for a public agent that needs no API key."""
    account = get_account(account_id)
    if account is None:
        raise ElevenApiError(f"Unknown account: {account_id}")
    _assert_allowed_host(account["base_url"])
    hostname = urlparse(account["base_url"]).hostname
    return f"wss://{hostname}/v1/convai/conversation?agent_id={agent_id}"


def get_conversation(account_id, conversation_id):
    return _request(account_id, f"/v1/convai/conversations/{conversation_id}")


def get_llm_list(account_id):
    """Every LLM selectable in conversation_config.agent.prompt.llm, for the Benchmark feature's
    model picker. Includes checkpoint/dated variants and deprecation info as returned by the
    API -- left to the UI to group/filter, not trimmed here."""
    data = _request(account_id, "/v1/convai/llm/list")
    return [
        {
            "llm": l.get("llm"),
            "is_checkpoint": l.get("is_checkpoint", False),
            "deprecated": bool((l.get("deprecation_info") or {}).get("is_deprecated")),
        }
        for l in data.get("llms", [])
    ]


def get_agent_workflow_nodes(account_id, agent_id):
    """Maps every Workflow node id to its human-readable `label` (and `type`), straight from the
    agent's own Workflow definition -- the ONLY place that mapping exists. A conversation's turn
    metrics only ever carry the raw node id (`agent_metadata.workflow_node_id`, see
    static/js/session/BenchmarkRunner.js), which is unreadable for any node nobody renamed in the
    dashboard (it keeps the platform's auto-generated default, e.g. "node_01ky2spx1hf69ad74gshkjapa6").
    Verified field shape -- GET /v1/convai/agents/{agent_id} response has a top-level `workflow`
    field, `workflow.nodes` a dict keyed by node id, each node carrying `label`/`type` among other
    builder-only fields (position, edges) this app has no use for (2026-10-05)."""
    agent = _request(account_id, f"/v1/convai/agents/{agent_id}")
    nodes = (agent.get("workflow") or {}).get("nodes") or {}
    return {node_id: {"label": (node or {}).get("label") or node_id, "type": (node or {}).get("type")} for node_id, node in nodes.items()}


def get_agent_workflow(account_id, agent_id):
    """The agent's ENTIRE raw `workflow` object (nodes, edges, subgraphs, prevent_subagent_loops),
    completely unprocessed -- used to snapshot it before a per-node LLM test (see
    set_workflow_node_llms) mutates it, so update_agent_workflow can restore it byte-for-byte
    afterwards. Never trim/reshape this -- see update_agent_workflow's docstring for why."""
    agent = _request(account_id, f"/v1/convai/agents/{agent_id}")
    return agent.get("workflow") or {}


def update_agent_workflow(account_id, agent_id, workflow):
    """Replaces the agent's entire Workflow with `workflow`. Confirmed empirically against a real
    sandbox agent (2026-10-05): PATCH /v1/convai/agents/{agent_id} does NOT deep-merge `workflow` --
    a partial `workflow.nodes.<id>` object fails ("Unable to extract tag using discriminator
    'type'"), and a `nodes` map missing other nodes is rejected too ("Workflow must contain a start
    node") or, worse, would silently drop whatever wasn't included. `workflow` here must always be a
    complete object -- in practice, always one read via get_agent_workflow (this run's own snapshot,
    or the live current one for set_workflow_node_llms below) with only specific leaf fields changed,
    never constructed from scratch."""
    _request(account_id, f"/v1/convai/agents/{agent_id}", method="PATCH", body={"workflow": workflow})
    return {"ok": True}


def set_workflow_node_llms(account_id, agent_id, llm_by_node_id):
    """Sets conversation_config.agent.prompt.llm on each named node, read-modify-write against the
    agent's CURRENT live workflow (not a stale snapshot the caller might be holding), leaving every
    other node and field untouched -- see update_agent_workflow's docstring for why a full
    read-modify-write is required here, not a partial PATCH. Only a node whose `type` is
    "override_agent" carries this field at all (confirmed against a real agent's workflow,
    2026-10-05) -- a `start`/`end`/`tool`/`phone_number`/`standalone_agent` node has nothing to
    override an LLM onto, so targeting one is a caller error, not something to silently ignore."""
    workflow = get_agent_workflow(account_id, agent_id)
    nodes = workflow.get("nodes") or {}
    for node_id, llm in llm_by_node_id.items():
        node = nodes.get(node_id)
        if node is None:
            raise ElevenApiError(f"Unknown workflow node: {node_id}")
        if node.get("type") != "override_agent":
            raise ElevenApiError(f"Node '{node_id}' is a '{node.get('type')}' node -- only an override_agent node carries a per-node LLM")
        node.setdefault("conversation_config", {}).setdefault("agent", {}).setdefault("prompt", {})["llm"] = llm
    return update_agent_workflow(account_id, agent_id, workflow)


def get_agent_model_config(account_id, agent_id):
    """Snapshots the two fields the Benchmark feature varies, so a run can restore the callee
    agent to exactly this afterwards."""
    agent = _request(account_id, f"/v1/convai/agents/{agent_id}")
    conversation_config = agent.get("conversation_config") or {}
    return {
        "tts_model_id": (conversation_config.get("tts") or {}).get("model_id"),
        "llm": (conversation_config.get("agent") or {}).get("prompt", {}).get("llm"),
    }


def update_agent_model_config(account_id, agent_id, tts_model_id=None, llm=None):
    """Partially updates an agent's TTS model and/or LLM. Used both to apply a Benchmark variant
    and to restore the agent's original config (the snapshot taken via get_agent_model_config) once
    the run is done -- same function either way. Omits a field entirely (rather than sending None)
    when not provided, since the API endpoint merges per-field."""
    conversation_config = {}
    if tts_model_id is not None:
        conversation_config["tts"] = {"model_id": tts_model_id}
    if llm is not None:
        conversation_config["agent"] = {"prompt": {"llm": llm}}
    if not conversation_config:
        return {"ok": True}
    _request(account_id, f"/v1/convai/agents/{agent_id}", method="PATCH", body={"conversation_config": conversation_config})
    return {"ok": True}
