from flask import Blueprint, current_app, jsonify, request

from services import benchmark_store

bp = Blueprint("benchmark_runs", __name__, url_prefix="/api/benchmark-runs")


@bp.get("")
def list_runs():
    benchmark_id = request.args.get("benchmark_id") or None
    return jsonify(benchmark_store.list_runs(current_app.instance_path, benchmark_id))


@bp.post("")
def save_run():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    return jsonify(benchmark_store.save_run(current_app.instance_path, body))


@bp.patch("/<run_id>")
def update_run(run_id):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    updated = benchmark_store.update_run(current_app.instance_path, run_id, body)
    if updated is None:
        return jsonify({"error": "Run not found"}), 404
    return jsonify(updated)


@bp.delete("/<run_id>")
def delete_run(run_id):
    benchmark_store.delete_run(current_app.instance_path, run_id)
    return jsonify({"ok": True})


@bp.delete("")
def clear_runs():
    benchmark_store.clear_runs(current_app.instance_path)
    return jsonify({"ok": True})
