"""
Persists verbose per-scenario-run debug telemetry from a Benchmark run (Bridge.js's full event log,
per-second pacer/latency metrics, websocket close/error events) to <instance>/debug_logs/ -- one
file per scenario run, regardless of whether that run succeeded. Exists because a mid-call audio
cutoff during a benchmark otherwise leaves no trace anywhere once the browser tab moves on to the
next variant: Bridge's debug log and metrics only ever lived in memory (2026-10-04 incident: audio
benchmark calls cutting off mid-conversation with nothing to diagnose afterward). The frontend posts
this payload right after each scenario run ends (session/BenchmarkRunner.js), so a cutoff can be
analyzed from the saved file instead of needing to reproduce it live with devtools open.
"""
import json
import os
import re
import time

from services.config_store import _strip_secret_like


def _debug_logs_dir(instance_path):
    return os.path.join(instance_path, "debug_logs")


def save_debug_log(instance_path, data):
    debug_dir = _debug_logs_dir(instance_path)
    os.makedirs(debug_dir, exist_ok=True)
    label_source = data.get("scenarioName") or data.get("variantLabel") or "run"
    safe_label = re.sub(r"[^a-zA-Z0-9_-]+", "-", label_source)[:60] or "run"
    file_name = f"{int(time.time() * 1000)}-{safe_label}.json"
    file_path = os.path.join(debug_dir, file_name)
    safe_data = _strip_secret_like(data)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(safe_data, f, indent=2, ensure_ascii=False)
    return file_path


def list_debug_logs(instance_path):
    """Lightweight summary of every saved debug log -- enough to find the right file to read
    without opening each one (a run's debugLog/metricsLog can be long)."""
    debug_dir = _debug_logs_dir(instance_path)
    try:
        entries = []
        for name in os.listdir(debug_dir):
            if not name.endswith(".json"):
                continue
            full_path = os.path.join(debug_dir, name)
            entry = {"name": name, "path": full_path, "saved_at": os.path.getmtime(full_path)}
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    entry["benchmark_name"] = data.get("benchmarkName")
                    entry["variant_label"] = data.get("variantLabel")
                    entry["scenario_name"] = data.get("scenarioName")
                    entry["end_reason"] = data.get("endReason")
                    entry["event_count"] = len(data.get("debugLog") or [])
            except (json.JSONDecodeError, OSError):
                pass
            entries.append(entry)
        return sorted(entries, key=lambda e: e["saved_at"], reverse=True)
    except FileNotFoundError:
        return []


def read_debug_log(instance_path, file_path):
    debug_dir = os.path.realpath(_debug_logs_dir(instance_path))
    resolved = os.path.realpath(file_path)
    if not resolved.startswith(debug_dir):
        raise ValueError("Refusing to read a file outside the debug logs directory")
    with open(resolved, "r", encoding="utf-8") as f:
        return json.load(f)
