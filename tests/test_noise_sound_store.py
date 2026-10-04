from pathlib import Path

import pytest

from services import noise_sound_store


def test_list_sounds_returns_empty_when_the_directory_does_not_exist(tmp_path):
    assert noise_sound_store.list_sounds(str(tmp_path)) == []


def test_save_then_list_round_trips(tmp_path):
    path = noise_sound_store.save_sound(str(tmp_path), "Cafe Ambience.mp3", b"fake-mp3-bytes")

    sounds = noise_sound_store.list_sounds(str(tmp_path))
    assert len(sounds) == 1
    assert sounds[0]["path"] == path
    assert sounds[0]["name"].endswith("-Cafe-Ambience.mp3")
    assert sounds[0]["size"] == len(b"fake-mp3-bytes")

    resolved = noise_sound_store.resolve_sound_path(str(tmp_path), path)
    with open(resolved, "rb") as f:
        assert f.read() == b"fake-mp3-bytes"


def test_save_sound_rejects_a_non_mp3_extension(tmp_path):
    with pytest.raises(ValueError):
        noise_sound_store.save_sound(str(tmp_path), "not-audio.txt", b"data")


def test_resolve_sound_path_rejects_a_path_outside_the_sounds_directory(tmp_path):
    outside = tmp_path.parent / "outside.mp3"
    outside.write_bytes(b"data")
    with pytest.raises(ValueError):
        noise_sound_store.resolve_sound_path(str(tmp_path), str(outside))


def test_resolve_sound_path_raises_when_the_file_does_not_exist(tmp_path):
    path = noise_sound_store.save_sound(str(tmp_path), "ambient.mp3", b"data")
    missing = str(Path(path).parent / "does-not-exist.mp3")
    with pytest.raises(FileNotFoundError):
        noise_sound_store.resolve_sound_path(str(tmp_path), missing)


def test_delete_sound_removes_the_file(tmp_path):
    path = noise_sound_store.save_sound(str(tmp_path), "ambient.mp3", b"data")
    noise_sound_store.delete_sound(str(tmp_path), path)
    assert noise_sound_store.list_sounds(str(tmp_path)) == []
