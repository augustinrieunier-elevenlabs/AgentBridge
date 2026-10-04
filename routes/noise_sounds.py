import os

from flask import Blueprint, current_app, jsonify, request, send_file

from services import noise_sound_store

bp = Blueprint("noise_sounds", __name__, url_prefix="/api/noise-sounds")


@bp.get("")
def list_sounds():
    return jsonify(noise_sound_store.list_sounds(current_app.instance_path))


@bp.post("")
def upload_sound():
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"error": "Missing 'file'"}), 400
    try:
        path = noise_sound_store.save_sound(current_app.instance_path, file.filename, file.read())
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"path": path, "name": os.path.basename(path)})


@bp.get("/file")
def get_sound_file():
    path = request.args.get("path", "")
    try:
        resolved = noise_sound_store.resolve_sound_path(current_app.instance_path, path)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError:
        return jsonify({"error": "Sound not found"}), 404
    return send_file(resolved, mimetype="audio/mpeg")


@bp.delete("")
def delete_sound():
    path = request.args.get("path", "")
    try:
        noise_sound_store.delete_sound(current_app.instance_path, path)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError:
        pass  # already gone -- deleting twice is a no-op, not an error
    return jsonify({"ok": True})
