from flask import Blueprint, current_app, jsonify, request

from services import config_store

bp = Blueprint("config", __name__, url_prefix="/api/config")


@bp.get("")
def load_config():
    return jsonify(config_store.load_config(current_app.instance_path))


@bp.post("")
def save_config():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    config_store.save_config(current_app.instance_path, body)
    return jsonify({"ok": True})
