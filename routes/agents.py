import re

from flask import Blueprint, current_app, jsonify, request

from services import benchmark_store, eleven_api, secrets
from services.eleven_api import ElevenApiError

bp = Blueprint("agents", __name__, url_prefix="/api/agents")

_SAFE_AGENT_ID = re.compile(r"^[a-zA-Z0-9_-]{1,100}$")


def _require_known_account(account_id):
    if secrets.get_account(account_id) is None:
        raise ValueError("Unknown account id")


def _require_safe_agent_id(agent_id):
    # ElevenLabs agent ids are short alphanumeric tokens; this blocks anything
    # that could be a path/query injection attempt via a malformed client call.
    if not _SAFE_AGENT_ID.match(agent_id):
        raise ValueError("Invalid agent id")


@bp.get("/<account_id>/remote")
def list_remote_agents(account_id):
    try:
        _require_known_account(account_id)
        return jsonify(eleven_api.list_agents(account_id))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except ElevenApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 502


@bp.get("/<account_id>/<agent_id>/inspect")
def inspect_agent(account_id, agent_id):
    try:
        _require_known_account(account_id)
        _require_safe_agent_id(agent_id)
        return jsonify(eleven_api.get_agent(account_id, agent_id))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except ElevenApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 502


@bp.get("/<account_id>/llms")
def list_llms(account_id):
    try:
        _require_known_account(account_id)
        return jsonify(eleven_api.get_llm_list(account_id))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except ElevenApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 502


@bp.get("/<account_id>/<agent_id>/model-config")
def get_model_config(account_id, agent_id):
    try:
        _require_known_account(account_id)
        _require_safe_agent_id(agent_id)
        return jsonify(eleven_api.get_agent_model_config(account_id, agent_id))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except ElevenApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 502


@bp.post("/<account_id>/<agent_id>/model-config")
def set_model_config(account_id, agent_id):
    try:
        _require_known_account(account_id)
        _require_safe_agent_id(agent_id)
        body = request.get_json(silent=True) or {}
        eleven_api.update_agent_model_config(account_id, agent_id, tts_model_id=body.get("tts_model_id"), llm=body.get("llm"))
        return jsonify({"ok": True})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except ElevenApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 502


@bp.get("/<account_id>/<agent_id>/pending-restore")
def get_pending_restore(account_id, agent_id):
    try:
        _require_known_account(account_id)
        _require_safe_agent_id(agent_id)
        return jsonify(benchmark_store.get_pending_restore(current_app.instance_path, account_id, agent_id))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@bp.post("/<account_id>/<agent_id>/pending-restore")
def save_pending_restore(account_id, agent_id):
    try:
        _require_known_account(account_id)
        _require_safe_agent_id(agent_id)
        body = request.get_json(silent=True) or {}
        benchmark_store.save_pending_restore(current_app.instance_path, account_id, agent_id, body)
        return jsonify({"ok": True})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@bp.delete("/<account_id>/<agent_id>/pending-restore")
def clear_pending_restore(account_id, agent_id):
    try:
        _require_known_account(account_id)
        _require_safe_agent_id(agent_id)
        benchmark_store.clear_pending_restore(current_app.instance_path, account_id, agent_id)
        return jsonify({"ok": True})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
