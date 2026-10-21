import json
import uuid
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import select
from urllib.parse import unquote_plus

from pixcake_bridge.app import create_app, delivery_scope_for
from pixcake_bridge.config import ProjectConfig
from pixcake_bridge.models import Delivery, Photo, Project, SyncRun
from test_engine import setup


def test_delivery_scope_flattens_raw_hierarchy_to_project_folder():
    assert delivery_scope_for(Path("RAW/26-10-04")) == Path("26-10-04")
    assert delivery_scope_for(Path("2026/26-10-04/01_RAW")) == Path("26-10-04")
    assert delivery_scope_for(Path("RAW"), "客户项目") == Path("客户项目")


def test_internal_bridge_actions_need_no_second_login_and_keep_csrf_checks(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.raw_root = tmp_path / "camera"
    cfg.delivery_root = tmp_path / "delivery"
    cfg.projects_file = tmp_path / "projects.json"
    cfg.delivery_host_root = "/nas/Projects"
    raw_job = cfg.raw_root / "2026" / "portrait"
    raw_job.mkdir(parents=True)
    cfg.delivery_root.mkdir()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.get("/health").status_code == 200
        dashboard = client.get("/")
        assert dashboard.status_code == 200
        assert "www-authenticate" not in dashboard.headers
        assert "精修同步工作台" in dashboard.text
        assert client.get("/api/projects").json()[0]["stage"] == "SELECTING"
        assert sum(1 for route in client.app.routes if getattr(route, "path", None) == "/api/projects/{event_id}/detail") == 1
        detail = client.get("/api/projects/7/detail").json()
        assert detail["event_id"] == 7
        assert detail["delivery_path"] == f"/nas/Projects/{tmp_path.name}"
        assert client.post("/api/projects/7/stage", json={"stage": "EDITING"}).json() == {"success": True, "stage": "EDITING"}
        client.post("/api/projects/7/stage", json={"stage": "ARCHIVED"})
        assert client.post("/api/projects/7/restore").json() == {"success": True, "stage": "EDITING"}
        assert client.post("/api/projects/7/stage", json={"stage": "UNKNOWN"}).status_code == 400
        assert client.post("/api/projects/7/sync").status_code == 200
        assert client.post("/api/projects/999/sync").status_code == 404
        assert client.post("/projects/7/stage", data={"stage": "EDITING"}, headers={"Origin": "http://evil.example"}).status_code == 403
        assert client.post("/projects/7/stage", data={"stage": "EDITING"}).status_code == 200
        assert client.post("/projects/7/stage", data={"stage": "SELECTING"}).status_code == 200
        assert client.post("/projects/7/retry").status_code == 400
        assert client.post("/projects/7/sync").status_code == 200
        assert client.post("/projects/999/sync").status_code == 404
        assert client.post("/projects/7/unknown").status_code == 400
        assert "摄影师怎么接手客户选片" in client.get("/").text
        response = client.post("/projects", data={
            "name": "新项目",
            "event_id": "9",
            "raw_subdir": "2026/portrait",
        }, follow_redirects=False)
        assert response.status_code == 303
        created = next(p for p in cfg.projects if p.event_id == 9)
        assert created.raw == raw_job
        assert created.selected.is_dir() and created.final.is_dir() and created.history.is_dir()
        assert '"event_id": 9' in cfg.projects_file.read_text()
        assert client.post("/projects", data={
            "name": "路径越界",
            "event_id": "10",
            "raw_subdir": "../../etc",
        }, follow_redirects=False).status_code == 303
        outside = tmp_path / "outside"
        outside.mkdir()
        (cfg.raw_root / "linked-escape").symlink_to(outside, target_is_directory=True)
        assert client.post("/projects", data={
            "name": "符号链接越界",
            "event_id": "11",
            "raw_subdir": "linked-escape",
        }, follow_redirects=False).status_code == 303
        (cfg.delivery_root / "event-12-链接目录").symlink_to(outside, target_is_directory=True)
        assert client.post("/projects", data={
            "name": "链接目录",
            "event_id": "12",
            "raw_subdir": "2026/portrait",
        }, follow_redirects=False).status_code == 303
    db.dispose()


def test_workflow_counts_are_exclusive_for_delivered_new_and_cancelled_photos(tmp_path):
    engine, remote, cfg, db = setup(tmp_path, 1)
    await_sync = __import__("asyncio").run(engine.sync())
    assert await_sync["success"] is True
    with engine.sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == 7))
        delivered = session.scalar(select(Photo).where(Photo.project_id == project.id, Photo.photo_id == 1))
        delivered.delivery_hash = "delivered-hash"
        active = Photo(
            project_id=project.id, photo_id=2, source_filename="DSC00002.JPG",
            selected=True, source_kind="RAW", raw_path=str(cfg.projects[0].raw / "DSC00002.ARW"),
            selected_path=str(cfg.projects[0].selected / "DSC00002.ARW"), materialized_hash="raw-hash",
        )
        cancelled = Photo(
            project_id=project.id, photo_id=3, source_filename="DSC00003.JPG",
            selected=False, cancelled=True, delivery_hash="cancelled-delivery-hash",
        )
        session.add_all([active, cancelled])
        session.flush()
        session.add_all([
            Delivery(photo_pk=delivered.id, sha256="delivered-hash", marker="DSC00001.JPG", snapshot="/history/1.jpg", state="SUCCESS"),
            Delivery(photo_pk=cancelled.id, sha256="cancelled-delivery-hash", marker="DSC00003.JPG", snapshot="/history/3.jpg", state="SUCCESS"),
        ])
        session.commit()

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        summary = client.get("/api/projects").json()[0]["summary"]
        assert summary["客户已选"] == 1
        assert summary["已精修"] == 1
        assert summary["已同步"] == 1
        detail = client.get("/api/projects/7/detail").json()
        by_id = {photo["photo_id"]: photo for photo in detail["photos"]}
        assert by_id[1]["selected"] is False
        assert by_id[2]["selected"] is True
        assert by_id[3]["selected"] is False
        assert by_id[3]["delivered"] is False
    db.dispose()


def test_successful_additional_delivery_returns_photo_to_delivered_state(tmp_path):
    engine, _remote, cfg, db = setup(tmp_path, 1)
    __import__("asyncio").run(engine.sync())
    with engine.sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == 7))
        photo = session.scalar(select(Photo).where(Photo.project_id == project.id, Photo.photo_id == 1))
        photo.selected = True
        photo.added_during_editing = True
        delivery = Delivery(
            photo_pk=photo.id,
            sha256="f" * 64,
            marker="DSC00001.__bridge_" + "f" * 64 + ".jpg",
            snapshot=str(cfg.projects[0].history / "new.jpg"),
            state="UPLOADING",
        )
        session.add(delivery)
        session.flush()
        engine.success(session, cfg.projects[0], photo, delivery, complete_task=True)
        assert photo.delivery_hash == "f" * 64
        assert photo.added_during_editing is False
    db.dispose()


def test_first_sync_status_is_not_reported_as_a_connection_failure(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.get("/api/projects").json()[0]["connection_state"] == "not_synced"
        with engine.sessions() as session:
            project = session.scalar(select(Project).where(Project.event_id == 7))
            session.add(SyncRun(project_id=project.id))
            session.commit()
        assert client.get("/api/projects").json()[0]["connection_state"] == "syncing"
        with engine.sessions() as session:
            project = session.scalar(select(Project).where(Project.event_id == 7))
            project.connected = True
            session.commit()
        assert client.get("/api/projects").json()[0]["connection_state"] == "connected"
        with engine.sessions() as session:
            project = session.scalar(select(Project).where(Project.event_id == 7))
            project.connected = False
            project.last_sync = project.last_sync or __import__("datetime").datetime.now()
            session.commit()
        assert client.get("/api/projects").json()[0]["connection_state"] == "disconnected"
    db.dispose()


def test_archived_stage_can_be_rolled_back_in_api_and_dashboard(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.post('/api/projects/7/stage', json={'stage': 'EDITING'}).status_code == 200
        assert client.post('/api/projects/7/stage', json={'stage': 'ARCHIVED'}).status_code == 200

        dashboard = client.get('/').text
        assert '<select name="stage">' in dashboard
        assert client.post('/api/projects/7/stage', json={'stage': 'SELECTING'}).status_code == 200
        with engine.sessions() as session:
            archived = session.scalar(select(Project).where(Project.event_id == 7))
            assert archived.stage == 'SELECTING'
            assert archived.previous_stage is None

        assert client.post('/projects/7/restore', follow_redirects=False).status_code == 303
        with engine.sessions() as session:
            restored = session.scalar(select(Project).where(Project.event_id == 7))
            assert restored.stage == 'SELECTING'
            assert restored.previous_stage is None
    db.dispose()


def test_project_summary_counts_only_active_existing_source_references(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    selected_dir = cfg.projects[0].selected
    active_upload = selected_dir / "UPLOAD_ACTIVE.JPG"
    active_upload.write_bytes(b"active upload")
    stale_upload = selected_dir / "UPLOAD_CANCELLED.JPG"
    stale_upload.write_bytes(b"cancelled upload")
    stale_raw = cfg.projects[0].raw / "RAW_CANCELLED.ARW"
    stale_raw.write_bytes(b"cancelled raw")
    with engine.sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == 7))
        session.add_all([
            Photo(project_id=project.id, photo_id=101, source_filename="UPLOAD_ACTIVE.JPG",
                  source_kind="UPLOAD", selected=True, selected_path=str(active_upload)),
            Photo(project_id=project.id, photo_id=102, source_filename="UPLOAD_CANCELLED.JPG",
                  source_kind="UPLOAD", selected=False, cancelled=True, selected_path=str(stale_upload)),
            Photo(project_id=project.id, photo_id=103, source_filename="UPLOAD_DELETED.JPG",
                  source_kind="UPLOAD", selected=True, selected_path=str(selected_dir / "missing.JPG"), remote_present=False),
            Photo(project_id=project.id, photo_id=104, source_filename="RAW_CANCELLED.JPG",
                  source_kind="RAW", selected=False, cancelled=True, raw_path=str(stale_raw)),
            Photo(project_id=project.id, photo_id=105, source_filename="SELECTED_CANCELLED.JPG",
                  source_kind="RAW", selected=True, cancelled=True, raw_path=str(stale_raw)),
        ])
        session.commit()

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        summary = client.get("/api/projects").json()[0]["summary"]
        assert summary["客户已选"] == 1
        assert summary["用户上传原图"] == 1
        assert summary["RAW已匹配"] == 0
        assert summary["待精修"] == 1
        details = {item["photo_id"]: item for item in client.get("/api/projects/7/detail").json()["photos"]}
        assert details[101]["source_referenced"] is True
        assert details[102]["source_referenced"] is False
        assert details[103]["source_referenced"] is False
        assert details[103]["remote_present"] is False
    db.dispose()


def test_retry_requires_confirmation_for_unknown_upload(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    with engine.sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == 7))
        photo = Photo(project_id=project.id, photo_id=999, source_filename="unknown.jpg", selected=True)
        session.add(photo)
        session.flush()
        session.add(Delivery(
            photo_pk=photo.id,
            sha256="a" * 64,
            marker="unknown.__bridge_" + "a" * 64 + ".jpg",
            snapshot=str(tmp_path / "snapshot.jpg"),
            state="UNKNOWN",
        ))
        session.commit()

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        blocked = client.post("/api/projects/7/retry", json={"confirm_unknown": False})
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["code"] == "UNKNOWN_CONFIRMATION_REQUIRED"
        assert blocked.json()["detail"]["count"] == 1
        confirmed = client.post("/api/projects/7/retry", json={"confirm_unknown": True})
        assert confirmed.status_code == 200
        assert confirmed.json()["total_requeued"] == 1
        assert confirmed.json()["deliveries_requeued"] == 1
        with engine.sessions() as session:
            delivery = session.scalar(select(Delivery))
            assert delivery.state == "PENDING"
    db.dispose()


def test_prepare_version_folder_and_reject_stale_version(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    with engine.sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == 7))
        session.add(Photo(project_id=project.id, photo_id=1, source_filename="DSC00001.JPG", selected=True))
        session.commit()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        prepared = client.post("/api/projects/7/photos/1/version-folder", json={"expected_current_version": 0})
        assert prepared.status_code == 200
        assert prepared.json() == {"version": 1, "folder": str(cfg.projects[0].final / "V1")}
        stale = client.post("/api/projects/7/photos/1/version-folder", json={"expected_current_version": 1})
        assert stale.status_code == 409
    db.dispose()


def test_auto_mount_creates_workspace_only_in_project_scoped_delivery_mount(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.raw_host_root = tmp_path / "nas" / "Camera"
    cfg.raw_root = tmp_path / "camera"
    raw_job = cfg.raw_root / "2026-10-04"
    raw_job.mkdir(parents=True)
    cfg.delivery_root = tmp_path / "delivery"
    cfg.delivery_root.mkdir()
    scoped_host = cfg.raw_host_root / "2026-10-04" / "PixCakeDelivery"
    scoped_container = tmp_path / "delivery-event-9"
    scoped_host.mkdir(parents=True)
    scoped_container.mkdir()
    cfg.delivery_host_root = str(tmp_path / "nas" / "Camera" / "2026-10-04" / "PixCakeDelivery")
    cfg.project_delivery_mounts = {
        9: {"container": str(scoped_container), "host": str(scoped_host)},
    }
    cfg.projects_file = tmp_path / "projects.json"
    db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.get("/api/projects/9/mount-status?raw_subdir=2026-10-04").json() == {"writable_mount_ready": True}
        response = client.post("/projects", data={
            "name": "2026-10-04",
            "event_id": "9",
            "raw_subdir": "2026-10-04",
            "auto_mount": "true",
        }, follow_redirects=False)
        assert response.status_code == 303
        created = next(project for project in cfg.projects if project.event_id == 9)
        assert created.raw == raw_job
        assert created.selected == scoped_container / "03_SELECTED_RAW"
        assert created.selected.is_dir() and created.final.is_dir() and created.history.is_dir()

        cfg.project_delivery_mounts[10] = {
            "container": str(scoped_container),
            "host": str(tmp_path / "nas" / "PixCakeDelivery"),
        }
        assert client.get("/api/projects/10/mount-status?raw_subdir=2026-10-04").json() == {"writable_mount_ready": False}
        response = client.post("/projects", data={
            "name": "权限范围不匹配",
            "event_id": "10",
            "raw_subdir": "2026-10-04",
            "auto_mount": "true",
        }, follow_redirects=False)
        assert response.status_code == 303
        assert not any(project.event_id == 10 for project in cfg.projects)
        assert "挂载路径与 Camera 项目目录不一致" in unquote_plus(response.headers["location"])
    db.dispose()


def test_auto_mount_scopes_projects_under_one_writable_delivery_root_and_keeps_raw_unchanged(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.raw_host_root = tmp_path / "nas" / "Home" / "Camera"
    cfg.raw_root = tmp_path / "camera"
    raw_job = cfg.raw_root / "2026" / "26-10-04"
    raw_job.mkdir(parents=True)
    raw_file = raw_job / "DSC00125.ARW"
    raw_file.write_bytes(b"immutable raw data")
    raw_before = raw_file.read_bytes()
    cfg.delivery_root = tmp_path / "delivery"
    cfg.delivery_root.mkdir()
    cfg.delivery_host_root = str(tmp_path / "nas" / "Home" / "PixCakeDelivery")
    cfg.project_delivery_mounts = {}
    cfg.projects_file = tmp_path / "projects.json"
    db.dispose()

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.get("/api/projects/9/mount-status?raw_subdir=2026%2F26-10-04").json() == {"writable_mount_ready": True}
        response = client.post("/projects", data={
            "name": "2026-10-04",
            "event_id": "9",
            "raw_subdir": "2026/26-10-04",
            "auto_mount": "true",
        }, follow_redirects=False)
        assert response.status_code == 303
        created = next(project for project in cfg.projects if project.event_id == 9)
        expected_root = cfg.delivery_root / "26-10-04"
        assert created.selected == expected_root / "03_SELECTED_RAW"
        assert created.selected.is_dir() and created.final.is_dir() and created.history.is_dir()
        detail = client.get("/api/projects/9/detail").json()
        assert detail["delivery_path"] == str(Path(cfg.delivery_host_root) / "26-10-04")
        assert raw_file.read_bytes() == raw_before

        # A second project can be added without editing Compose, and receives
        # an independent project folder, without mirroring the RAW hierarchy.
        second_raw = cfg.raw_root / "2026" / "26-10-05" / "01_RAW"
        second_raw.mkdir(parents=True)
        second = client.post("/projects", data={
            "name": "2026-10-05",
            "event_id": "10",
            "raw_subdir": "2026/26-10-05/01_RAW",
            "auto_mount": "true",
        }, follow_redirects=False)
        assert second.status_code == 303
        second_project = next(project for project in cfg.projects if project.event_id == 10)
        assert second_project.selected == cfg.delivery_root / "26-10-05" / "03_SELECTED_RAW"

        outside = tmp_path / "outside"
        outside.mkdir()
        (cfg.delivery_root / "linked").symlink_to(outside, target_is_directory=True)
        assert client.get("/api/projects/11/mount-status?raw_subdir=2026%2Flinked").json() == {"writable_mount_ready": False}
    db.dispose()


def test_legacy_project_folder_is_moved_to_scoped_mount_without_overwrite(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    mount = tmp_path / "PixCakeDelivery"
    legacy = mount / "event-7-测试项目"
    for name in ("03_SELECTED_RAW", "04_FINAL", "05_HISTORY"):
        (legacy / name).mkdir(parents=True)
    raw = cfg.projects[0].raw
    (legacy / "03_SELECTED_RAW" / "DSC00001.ARW").write_bytes(b"raw-copy")
    (legacy / "04_FINAL" / "V1").mkdir()
    (legacy / "04_FINAL" / "V1" / "DSC00001.JPG").write_bytes(b"final")
    cfg.delivery_root = mount
    cfg.projects_file = tmp_path / "projects.json"
    cfg.projects[0] = ProjectConfig(
        "测试项目", 7, raw,
        legacy / "03_SELECTED_RAW", legacy / "04_FINAL", legacy / "05_HISTORY",
    )
    cfg.migrate_legacy_delivery_layout()
    assert cfg.projects[0].selected == mount / "03_SELECTED_RAW"
    assert (mount / "03_SELECTED_RAW" / "DSC00001.ARW").read_bytes() == b"raw-copy"
    assert (mount / "04_FINAL" / "V1" / "DSC00001.JPG").read_bytes() == b"final"
    assert str(mount / "04_FINAL") in cfg.projects_file.read_text()
    assert not legacy.exists()
    db.dispose()


def test_raw_delivery_wrapper_is_removed_without_touching_source_raw(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    delivery_root = tmp_path / "PixCakeDelivery"
    old_project_root = delivery_root / "RAW" / "26-10-04"
    for name in ("03_SELECTED_RAW", "04_FINAL", "05_HISTORY"):
        (old_project_root / name).mkdir(parents=True)
    raw_file = cfg.projects[0].raw / "DSC00001.ARW"
    raw_before = raw_file.read_bytes()
    selected_raw = old_project_root / "03_SELECTED_RAW" / "DSC00001.ARW"
    selected_raw.write_bytes(b"selected copy")
    final_file = old_project_root / "04_FINAL" / "V1" / "DSC00001.JPG"
    final_file.parent.mkdir()
    final_file.write_bytes(b"final")
    cfg.delivery_root = delivery_root
    cfg.projects_file = tmp_path / "projects.json"
    cfg.projects[0] = ProjectConfig(
        "26-10-04", 7, cfg.projects[0].raw,
        old_project_root / "03_SELECTED_RAW",
        old_project_root / "04_FINAL",
        old_project_root / "05_HISTORY",
    )
    cfg.projects_file.write_text("[]", encoding="utf-8")

    cfg.migrate_legacy_delivery_layout()

    new_project_root = delivery_root / "26-10-04"
    assert cfg.projects[0].selected == new_project_root / "03_SELECTED_RAW"
    assert (new_project_root / "03_SELECTED_RAW" / "DSC00001.ARW").read_bytes() == b"selected copy"
    assert (new_project_root / "04_FINAL" / "V1" / "DSC00001.JPG").read_bytes() == b"final"
    assert not old_project_root.exists()
    assert not (delivery_root / "RAW").exists()
    assert raw_file.read_bytes() == raw_before
    assert json.loads(cfg.projects_file.read_text())[0]["selected"] == str(new_project_root / "03_SELECTED_RAW")
    assert json.loads((tmp_path / "layout-migrations.json").read_text())[0]["new"] == str(new_project_root)
    db.dispose()


def test_unbind_is_idempotent_and_preserves_camera_and_delivery_files(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    original = cfg.projects[0].raw / 'DSC00001.ARW'
    final = cfg.projects[0].final / 'DSC00001.JPG'
    final.write_bytes(b'final')
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.delete('/api/projects/7').status_code == 200
        assert client.delete('/api/projects/7').status_code == 200
        assert client.get('/api/projects').json() == []
        assert cfg.projects_file.read_text() == '[]'
        assert original.read_bytes() == b'RAW-1'
        assert final.read_bytes() == b'final'
    db.dispose()


def test_archive_delete_removes_only_project_delivery_and_keeps_raw_source(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.delivery_root = tmp_path
    cfg.projects_file = tmp_path / 'projects.json'
    raw = cfg.projects[0].raw / 'DSC00001.ARW'
    selected = cfg.projects[0].selected / 'DSC00001.ARW'
    final = cfg.projects[0].final / 'DSC00001.JPG'
    history = cfg.projects[0].history / 'V1' / 'DSC00001.JPG'
    selected.parent.mkdir(parents=True, exist_ok=True)
    final.parent.mkdir(parents=True, exist_ok=True)
    history.parent.mkdir(parents=True, exist_ok=True)
    try:
        selected.hardlink_to(raw)
    except OSError:
        selected.write_bytes(raw.read_bytes())
    final.write_bytes(b'FINAL')
    history.write_bytes(b'OLD FINAL')
    with engine.sessions() as session:
        indexed_project = session.scalar(select(Project).where(Project.event_id == 7))
        session.add(Photo(project_id=indexed_project.id, photo_id=1, source_filename='DSC00001.JPG'))
        session.commit()

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        response = client.delete('/api/projects/7?delete_delivery=true')

        assert response.status_code == 200
        assert client.get('/api/projects').json() == []
        assert raw.read_bytes() == b'RAW-1'
        assert not selected.parent.exists()
        assert not final.parent.exists()
        assert not history.parents[1].exists()
        with engine.sessions() as session:
            assert session.scalar(select(Project).where(Project.event_id == 7)) is None
            assert session.query(Photo).count() == 0
    db.dispose()


def test_archive_delete_cleans_project_folder_under_shared_delivery_root(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.delivery_root = tmp_path / 'PixCakeDelivery'
    cfg.delivery_root.mkdir()
    cfg.projects_file = tmp_path / 'projects.json'
    raw_root = cfg.projects[0].raw
    raw_before = (raw_root / 'DSC00001.ARW').read_bytes()
    project_root = cfg.delivery_root / '26-09-18'
    project = cfg.projects[0]
    project.selected = project_root / '03_SELECTED_RAW'
    project.final = project_root / '04_FINAL'
    project.history = project_root / '05_HISTORY'
    for directory in (project.selected, project.final, project.history):
        directory.mkdir(parents=True)
    (project.selected / 'DSC00001.ARW').write_bytes(b'selected copy')
    (project.final / 'DSC00001.JPG').write_bytes(b'final')
    (project.history / 'V1').mkdir()
    (project.history / 'V1' / 'DSC00001.JPG').write_bytes(b'old final')

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        response = client.delete('/api/projects/7?delete_delivery=true')
        assert response.status_code == 200
        assert not project_root.exists()
        assert (raw_root / 'DSC00001.ARW').read_bytes() == raw_before
    db.dispose()


def test_archive_delete_refuses_symlinked_delivery_and_leaves_project_bound(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.delivery_root = tmp_path
    cfg.projects_file = tmp_path / 'projects.json'
    project = cfg.projects[0]
    raw = project.raw / 'DSC00001.ARW'
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'keep.JPG').write_bytes(b'outside')
    project.final.rmdir()
    project.final.symlink_to(outside, target_is_directory=True)

    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        response = client.delete('/api/projects/7?delete_delivery=true')

        assert response.status_code == 409
        assert client.get('/api/projects').json()[0]['event_id'] == 7
        assert raw.read_bytes() == b'RAW-1'
        assert (outside / 'keep.JPG').read_bytes() == b'outside'
        assert project.selected.is_dir()
    db.dispose()


async def test_retry_rechecks_unknown_after_waiting_for_sync_lock(tmp_path):
    import asyncio
    import httpx
    engine, remote, cfg, db = setup(tmp_path)
    await engine.sync()
    with engine.sessions() as s:
        photo = s.scalar(select(Photo))
        s.add(Delivery(photo_pk=photo.id, sha256='a'*64, marker='m', snapshot=str(tmp_path/'snapshot.jpg'), state='UPLOADING'))
        s.commit()
    app = create_app(cfg, remote, start_workers=False)
    app.state.engine, app.state.config = engine, cfg
    async def no_sync(*args):
        pass
    engine.sync = no_sync
    await engine.lock.acquire()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        pending = asyncio.create_task(client.post('/api/projects/7/retry', json={'confirm_unknown': False}))
        await asyncio.sleep(.02)
        assert not pending.done()
        with engine.sessions() as s:
            s.scalar(select(Delivery)).state = 'UNKNOWN'
            s.commit()
        engine.lock.release()
        response = await pending
        assert response.status_code == 409
    with engine.sessions() as s:
        assert s.scalar(select(Delivery)).state == 'UNKNOWN'
    db.dispose()


def test_checkpoint_pauses_sync_and_restores_state_without_bridge_login(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.post('/api/state/checkpoint', json={}).status_code == 400
        saved = client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).json()
        assert client.post('/api/state/activate', json={'token': saved['token']}).status_code == 200
        assert saved['state']['version'] == 1
        assert client.post('/api/projects/7/stage', json={'stage':'EDITING'}).status_code == 503
        assert client.post('/api/state/restore', json={'token':'wrong', 'state':saved['state']}).status_code == 409
        assert client.post('/api/state/restore', json=saved).status_code == 200
        assert client.post('/api/state/release', json={'token':saved['token']}).status_code == 200
        assert client.post('/api/projects/7/stage', json={'stage':'EDITING'}).status_code == 200
    db.dispose()


def test_failed_restore_pause_survives_restart_and_can_be_released_in_process(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        checkpoint = client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).json()
        assert client.post('/api/state/activate', json={'token': checkpoint['token']}).status_code == 200
        assert client.post('/api/state/block', json={'token': 'wrong'}).status_code == 409
        assert client.post('/api/state/block', json={'token': checkpoint['token'], 'reason': '恢复失败'}).status_code == 200
        assert client.post('/api/state/renew', json={'token': checkpoint['token']}).status_code == 200
        assert client.app.state.engine.maintenance_until == float('inf')
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.get('/api/state/status').status_code == 200
        assert client.get('/api/state/status').json() == {'blocked': True, 'reason': '恢复失败', 'token': checkpoint['token']}
        assert '精修同步已暂停' in client.get('/').text
        assert any(error['message'] == '恢复失败' for error in client.get('/api/projects/7/detail').json()['errors'])
        assert client.post('/api/projects/7/sync', json={}).status_code == 503
        assert client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).status_code == 409
        assert client.post('/api/state/release', json={'token': 'wrong'}).status_code == 409
        assert (tmp_path / 'restore-block.json').exists()
        assert client.post('/api/state/release', json={'token': checkpoint['token']}).status_code == 200
        assert not (tmp_path / 'restore-block.json').exists()
        assert client.post('/api/projects/7/sync', json={}).status_code == 200
    db.dispose()


def test_checkpoint_repairs_interrupted_unbind_and_restart_cleans_orphans(tmp_path, monkeypatch):
    from pixcake_bridge import project_state
    engine, remote, cfg, db = setup(tmp_path)
    cfg.projects_file = tmp_path / 'projects.json'
    db.dispose()
    with TestClient(create_app(cfg, remote, start_workers=False), raise_server_exceptions=False) as client:
        assert client.post('/api/projects/7/sync', json={}).status_code == 200
        with monkeypatch.context() as patch:
            patch.setattr(project_state, 'delete_project_rows', lambda *args: (_ for _ in ()).throw(RuntimeError('commit failed')))
            assert client.delete('/api/projects/7').status_code == 500
        assert (tmp_path / 'unbind-state.json').exists()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert not (tmp_path / 'unbind-state.json').exists()
        saved = client.post('/api/state/checkpoint', json={'token': str(uuid.uuid4()), 'purpose': 'restore'}).json()
        assert client.post('/api/state/activate', json={'token': saved['token']}).status_code == 200
        assert saved['state']['projects'] == []
        assert saved['state']['tables']['projects'] == []
        assert client.post('/api/state/restore', json=saved).status_code == 200
        assert client.post('/api/state/release', json={'token': saved['token']}).status_code == 200
    assert (tmp_path / '01_RAW' / 'DSC00001.ARW').exists()
