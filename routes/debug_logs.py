from flask import Blueprint, current_app, jsonify, request

from services import debug_log_store

bp = Blueprint("debug_logs", __name__, url_prefix="/api/debug-logs")


@bp.post("")
def save_debug_log():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    path = debug_log_store.save_debug_log(current_app.instance_path, body)
    return jsonify({"path": path})


@bp.get("")
def list_debug_logs():
    return jsonify(debug_log_store.list_debug_logs(current_app.instance_path))


@bp.get("/read")
def read_debug_log():
    path = request.args.get("path", "")
    try:
        return jsonify(debug_log_store.read_debug_log(current_app.instance_path, path))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError:
        return jsonify({"error": "Debug log not found"}), 404
