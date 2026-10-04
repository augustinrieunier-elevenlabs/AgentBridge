"""
Loads and saves the secret-free app configuration (agents, scenarios,
presets, settings) to <instance>/config.json, and session exports to
<instance>/exports/. Account secrets are never part of these files -- see
secrets.py.
"""
import json
import os
import re
import time

DEFAULT_CONFIG = {
    "agents": [],
    "scenarios": [],
    "presets": [],
    "benchmarks": [],
    "noiseProfiles": [],
    "settings": {"frame_size_ms": 100, "asr_comparison_enabled": False, "voice_table": {}},
}

_SECRET_LIKE = re.compile(r"^(sk_|wss://.*token=)", re.IGNORECASE)


def _strip_secret_like(value):
    """Defensive: recursively drop any string that looks like a key or a signed URL."""
    if isinstance(value, dict):
        return {k: _strip_secret_like(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_secret_like(v) for v in value]
    if isinstance(value, str) and _SECRET_LIKE.match(value):
        return None
    return value


def _config_path(instance_path):
    return os.path.join(instance_path, "config.json")


def _exports_dir(instance_path):
    return os.path.join(instance_path, "exports")


def load_config(instance_path):
    path = _config_path(instance_path)
    try:
        with open(path, "r", encoding="utf-8") as f:
            parsed = json.load(f)
    except FileNotFoundError:
        return dict(DEFAULT_CONFIG)

    settings = {**DEFAULT_CONFIG["settings"], **parsed.get("settings", {})}
    return {
        "agents": parsed.get("agents", []),
        "scenarios": parsed.get("scenarios", []),
        "presets": parsed.get("presets", []),
        "benchmarks": parsed.get("benchmarks", []),
        "noiseProfiles": parsed.get("noiseProfiles", []),
        "settings": settings,
    }


def save_config(instance_path, config):
    os.makedirs(instance_path, exist_ok=True)
    safe_config = _strip_secret_like(config)
    with open(_config_path(instance_path), "w", encoding="utf-8") as f:
        json.dump(safe_config, f, indent=2, ensure_ascii=False)


def save_export(instance_path, name, data):
    exports_dir = _exports_dir(instance_path)
    os.makedirs(exports_dir, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", name)[:80] or "session"
    file_name = f"{int(time.time() * 1000)}-{safe_name}.json"
    file_path = os.path.join(exports_dir, file_name)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return file_path


def list_exports(instance_path):
    """Lists every saved export with a lightweight summary -- `run_type`/`title`/
    `conversation_count`/`callee`/`callee_config`, read from each file's own top-level fields -- so
    the History UI can show what kind of run it is (session/batch/benchmark), and the global
    Analytics view can filter history down to one callee agent's runs, without a second round-trip
    to open every single export. Older exports saved before this (manual "Export JSON" only, no
    `runType`/`title`/`calleeConfig`) just come back with those fields missing; the History list
    falls back to the raw file name, and Analytics puts them in its "unknown config" bucket."""
    exports_dir = _exports_dir(instance_path)
    try:
        entries = []
        for name in os.listdir(exports_dir):
            if not name.endswith(".json"):
                continue
            full_path = os.path.join(exports_dir, name)
            entry = {"name": name, "path": full_path, "saved_at": os.path.getmtime(full_path)}
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    entry["run_type"] = data.get("runType")
                    entry["title"] = data.get("title")
                    entry["conversation_count"] = len(data.get("conversations") or [])
                    entry["callee"] = data.get("callee")
                    entry["callee_config"] = data.get("calleeConfig")
            except (json.JSONDecodeError, OSError):
                pass
            entries.append(entry)
        return sorted(entries, key=lambda e: e["saved_at"], reverse=True)
    except FileNotFoundError:
        return []


def read_export(instance_path, file_path):
    exports_dir = os.path.realpath(_exports_dir(instance_path))
    resolved = os.path.realpath(file_path)
    if not resolved.startswith(exports_dir):
        raise ValueError("Refusing to read a file outside the exports directory")
    with open(resolved, "r", encoding="utf-8") as f:
        return json.load(f)


def update_export(instance_path, file_path, patch):
    """Merges `patch` into an existing export file's top level. Used to backfill `nodeNames`
    (workflow node id -> {label, type}) into an export saved before that lookup existed, the first
    time the Analytics view needs it for this callee agent's history -- so the live API call it
    took to resolve them isn't repeated on every later analytics pass (see
    session/GlobalAnalytics.js resolveNodeNames). Shallow merge only: every patch this is called
    with is a brand new top-level key, never a nested field that needs merging into existing data."""
    exports_dir = os.path.realpath(_exports_dir(instance_path))
    resolved = os.path.realpath(file_path)
    if not resolved.startswith(exports_dir):
        raise ValueError("Refusing to write a file outside the exports directory")
    with open(resolved, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.update(_strip_secret_like(patch))
    with open(resolved, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return data


def clear_exports(instance_path):
    """Deletes every saved export (session/batch run history) -- used by History's "Clear history"
    button. Irreversible; the UI is expected to confirm before calling this. A no-op, not an error,
    when the exports directory doesn't exist yet."""
    exports_dir = _exports_dir(instance_path)
    try:
        for name in os.listdir(exports_dir):
            if name.endswith(".json"):
                os.remove(os.path.join(exports_dir, name))
    except FileNotFoundError:
        pass
