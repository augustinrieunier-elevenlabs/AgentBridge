"""
Stores uploaded MP3 ambient-sound files at <instance>/noise_sounds/*.mp3, for a NoiseProfile (see
model/factory.js emptyNoiseProfile) to reference and mix into the caller->callee audio leg (see
static/js/audio/AmbientSoundMixer.js). Mirrors services/config_store.py's exports store exactly:
the file's own path IS its id, used directly by the frontend for read/delete -- no separate id
scheme, no metadata sidecar file.
"""
import os
import re
import time

_MAX_NAME_LEN = 80
_ALLOWED_EXTENSIONS = {".mp3"}


def _sounds_dir(instance_path):
    return os.path.join(instance_path, "noise_sounds")


def save_sound(instance_path, filename, file_bytes):
    """Saves one uploaded file under a sanitized, timestamp-prefixed name (so two uploads named
    "ambient.mp3" never collide) -- same scheme as config_store.save_export. Rejects anything
    whose extension isn't .mp3; this app only ever decodes MP3 (see AmbientSoundMixer.js)."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise ValueError("Only .mp3 files are supported")
    sounds_dir = _sounds_dir(instance_path)
    os.makedirs(sounds_dir, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", os.path.splitext(filename)[0])[:_MAX_NAME_LEN] or "sound"
    file_name = f"{int(time.time() * 1000)}-{safe_name}{ext}"
    file_path = os.path.join(sounds_dir, file_name)
    with open(file_path, "wb") as f:
        f.write(file_bytes)
    return file_path


def list_sounds(instance_path):
    sounds_dir = _sounds_dir(instance_path)
    try:
        entries = []
        for name in os.listdir(sounds_dir):
            if not name.lower().endswith(".mp3"):
                continue
            full_path = os.path.join(sounds_dir, name)
            entries.append({"name": name, "path": full_path, "saved_at": os.path.getmtime(full_path), "size": os.path.getsize(full_path)})
        return sorted(entries, key=lambda e: e["saved_at"], reverse=True)
    except FileNotFoundError:
        return []


def resolve_sound_path(instance_path, file_path):
    """Validates `file_path` actually resolves to somewhere inside this instance's sounds
    directory (same path-traversal guard as config_store.read_export) and returns the resolved
    path to serve or delete -- never trust a path handed in by the browser without this check."""
    sounds_dir = os.path.realpath(_sounds_dir(instance_path))
    resolved = os.path.realpath(file_path)
    if not resolved.startswith(sounds_dir):
        raise ValueError("Refusing to access a file outside the noise sounds directory")
    if not os.path.isfile(resolved):
        raise FileNotFoundError(resolved)
    return resolved


def delete_sound(instance_path, file_path):
    resolved = resolve_sound_path(instance_path, file_path)
    os.remove(resolved)
