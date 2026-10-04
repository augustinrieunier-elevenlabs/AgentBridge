from flask import Blueprint, current_app, jsonify, request

from services import config_store

bp = Blueprint("exports", __name__, url_prefix="/api/exports")


@bp.get("")
def list_exports():
    return jsonify(config_store.list_exports(current_app.instance_path))


@bp.post("")
def save_export():
    body = request.get_json(silent=True) or {}
    name = body.get("name") or "session"
    data = body.get("data")
    if data is None:
        return jsonify({"error": "Missing 'data'"}), 400
    path = config_store.save_export(current_app.instance_path, name, data)
    return jsonify({"path": path})


@bp.get("/read")
def read_export():
    path = request.args.get("path", "")
    try:
        return jsonify(config_store.read_export(current_app.instance_path, path))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError:
        return jsonify({"error": "Export not found"}), 404


@bp.patch("")
def update_export():
    path = request.args.get("path", "")
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    try:
        return jsonify(config_store.update_export(current_app.instance_path, path, body))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError:
        return jsonify({"error": "Export not found"}), 404


@bp.delete("")
def clear_exports():
    config_store.clear_exports(current_app.instance_path)
    return jsonify({"ok": True})
