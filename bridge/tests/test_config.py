import json
import pytest

from pixcake_bridge.config import Config


def test_first_run_starts_without_api_token(tmp_path, monkeypatch):
    projects_file = tmp_path / "projects.json"
    projects_file.write_text("[]", encoding="utf-8")
    monkeypatch.setenv("PROJECTS_FILE", str(projects_file))
    monkeypatch.delenv("RAW_ROOT", raising=False)

    config = Config.load()

    assert config.integrated is True
    assert config.projects == []
    assert str(config.raw_root) == "/external-media/Camera"


def test_config_does_not_require_a_bridge_password(tmp_path, monkeypatch):
    projects_file = tmp_path / "projects.json"
    projects_file.write_text("[]", encoding="utf-8")
    monkeypatch.setenv("PROJECTS_FILE", str(projects_file))
    monkeypatch.delenv("BRIDGE_ADMIN_PASSWORD", raising=False)

    config = Config.load()

    assert config.integrated is True


def test_integrated_mode_allows_bound_project_without_manual_token(tmp_path, monkeypatch):
    raw = tmp_path / "Camera" / "RAW"
    raw.mkdir(parents=True)
    projects_file = tmp_path / "projects.json"
    projects_file.write_text(json.dumps([{
        "name": "项目",
        "event_id": 1,
        "raw": str(raw),
        "selected": str(tmp_path / "delivery" / "03_SELECTED_RAW"),
        "final": str(tmp_path / "delivery" / "04_FINAL"),
        "history": str(tmp_path / "delivery" / "05_HISTORY"),
    }]), encoding="utf-8")
    monkeypatch.setenv("PROJECTS_FILE", str(projects_file))

    config = Config.load()

    assert config.integrated is True
    assert config.projects[0].event_id == 1


def test_integrated_mode_refuses_non_loopback_picpeak_url(tmp_path, monkeypatch):
    projects_file = tmp_path / "projects.json"
    projects_file.write_text("[]", encoding="utf-8")
    monkeypatch.setenv("PROJECTS_FILE", str(projects_file))
    monkeypatch.setenv("PICPEAK_INTEGRATED_BRIDGE", "true")
    monkeypatch.setenv("PICPEAK_URL", "http://picpeak:3000")

    with pytest.raises(ValueError, match="容器回环地址"):
        Config.load()
