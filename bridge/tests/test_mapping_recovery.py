import asyncio
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import select
from pixcake_bridge.app import create_app
from pixcake_bridge.models import Photo
from test_engine import setup


def test_missing_index_cleanup_preserves_raw_and_work_files(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    asyncio.run(engine.sync())
    with engine.sessions() as s:
        work = Path(s.scalar(select(Photo)).selected_path)
    from pixcake_bridge.models import Delivery
    with engine.sessions() as s:
        photo = s.scalar(select(Photo))
        s.add(Delivery(photo_pk=photo.id, sha256='prior', marker='prior', snapshot='/history/file', state='SUCCESS'))
        s.commit()
    remote.rows.clear()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        response = client.post('/api/projects/7/photos/1/recovery', json={'action': 'forget_missing', 'confirm': True})
        assert response.status_code == 200
        with engine.sessions() as s:
            assert s.scalar(select(Photo)) is None
    assert work.exists()
    assert (cfg.projects[0].raw / 'DSC00001.ARW').exists()
    db.dispose()


def test_recovery_requires_current_remote_and_explicit_safe_raw(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    asyncio.run(engine.sync())
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        assert client.post('/api/projects/7/photos/1/recovery', json={'action':'forget_missing','confirm':True}).status_code == 409
        assert client.post('/api/projects/7/photos/1/recovery', json={'action':'rebind','raw_relative':'../bad.ARW','confirm':True}).status_code == 400
        result = client.post('/api/projects/7/photos/1/recovery', json={'action':'rebind','raw_relative':'DSC00001.ARW','confirm':True})
        assert result.status_code == 200
    db.dispose()


def test_duplicate_proofs_can_map_distinct_raws_and_keep_work_names_unique(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    source = cfg.projects[0].raw / 'DSC00001.ARW'
    (cfg.projects[0].raw / 'second').mkdir()
    other = cfg.projects[0].raw / 'second' / source.name
    other.write_bytes(b'other-raw')
    remote.rows.append({**remote.rows[0], 'id':2})
    asyncio.run(engine.sync())
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        diag = client.get('/api/projects/7/photos/1/recovery').json()
        assert set(diag['raw_candidates']) == {'DSC00001.ARW','second/DSC00001.ARW'}
        for photo_id, path in [(1, 'DSC00001.ARW'), (2, 'second/DSC00001.ARW')]:
            result = client.post(f'/api/projects/7/photos/{photo_id}/recovery', json={'action':'rebind','raw_relative':path,'confirm':True})
            assert result.status_code == 200, result.text
            asyncio.run(engine.sync())
        with engine.sessions() as s:
            photos = list(s.scalars(select(Photo).order_by(Photo.photo_id)))
            assert all(photo.error is None for photo in photos)
            assert len({photo.work_filename for photo in photos}) == 2
            assert {Path(photo.selected_path).read_bytes() for photo in photos} == {source.read_bytes(), b'other-raw'}
    db.dispose()


def test_rebind_preserves_existing_work_and_delivery_history(tmp_path):
    from pixcake_bridge.models import Delivery
    engine, remote, cfg, db = setup(tmp_path)
    asyncio.run(engine.sync())
    replacement = cfg.projects[0].raw / 'renamed.ARW'
    replacement.write_bytes(b'renamed-raw')
    with engine.sessions() as s:
        photo = s.scalar(select(Photo))
        original_work = Path(photo.selected_path)
        photo.delivery_hash = 'old-hash'
        s.add(Delivery(photo_pk=photo.id, sha256='old-hash', marker='old', snapshot='/old-history.jpg', state='SUCCESS'))
        s.commit()
    remote.rows[0]['source_filename'] = 'renamed.JPG'
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        result = client.post('/api/projects/7/photos/1/recovery', json={'action':'rebind','raw_relative':'renamed.ARW','confirm':True})
        assert result.status_code == 200, result.text
        asyncio.run(engine.sync())
        with engine.sessions() as s:
            photo = s.scalar(select(Photo))
            assert photo.error is None
            assert Path(photo.selected_path).read_bytes() == b'renamed-raw'
            assert s.scalar(select(Delivery)).sha256 == 'old-hash'
    assert original_work.exists()
    db.dispose()


def test_explicit_final_choice_resolves_duplicate_exports(tmp_path):
    from pixcake_bridge.files import sha256
    engine, remote, cfg, db = setup(tmp_path)
    asyncio.run(engine.sync())
    final = cfg.projects[0].final
    (final / 'V1').mkdir(exist_ok=True)
    (final / 'DSC00001.JPG').write_bytes(b'legacy-export')
    chosen = final / 'V1' / 'DSC00001.JPG'
    chosen.write_bytes(b'chosen-export')
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        diag = client.get('/api/projects/7/photos/1/recovery').json()
        assert set(diag['final_candidates']) == {'DSC00001.JPG','V1/DSC00001.JPG'}
        response = client.post('/api/projects/7/photos/1/recovery', json={
            'action':'rebind','confirm':True,'raw_relative':'DSC00001.ARW','final_relative':'V1/DSC00001.JPG',
        })
        assert response.status_code == 200, response.text
        asyncio.run(engine.sync())
        asyncio.run(engine.sync())
        assert remote.uploads == [(1, sha256(chosen))]
    assert (final / 'DSC00001.JPG').exists()
    db.dispose()


def test_uploaded_source_final_conflict_can_be_resolved_without_raw(tmp_path):
    engine, remote, cfg, db = setup(tmp_path)
    source = cfg.picpeak_storage_root / 'events/active/gallery/upload.JPG'
    source.parent.mkdir(parents=True)
    source.write_bytes(b'upload-source')
    remote.rows[0].update(source_filename='phone.JPG', original_filename='phone.JPG', upload_source_key='events/active/gallery/upload.JPG')
    asyncio.run(engine.sync())
    final = cfg.projects[0].final
    (final / 'phone.JPG').write_bytes(b'legacy')
    (final / 'V1' / 'phone.JPG').write_bytes(b'preferred')
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        response = client.post('/api/projects/7/photos/1/recovery', json={
            'action':'rebind','confirm':True,'final_relative':'V1/phone.JPG',
        })
        assert response.status_code == 200, response.text
        asyncio.run(engine.sync())
        asyncio.run(engine.sync())
        assert len(remote.uploads) == 1
    db.dispose()


def test_clearing_final_override_restores_automatic_matching(tmp_path):
    import json
    engine, remote, cfg, db = setup(tmp_path)
    asyncio.run(engine.sync())
    with engine.sessions() as s:
        photo = s.scalar(select(Photo))
        photo.final_overrides = json.dumps({'1':'V1/DSC00001.JPG'})
        s.commit()
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        response = client.post('/api/projects/7/photos/1/recovery', json={
            'action':'rebind','confirm':True,'raw_relative':'DSC00001.ARW','final_relative':None,
        })
        assert response.status_code == 200
        with engine.sessions() as s:
            assert '1' not in json.loads(s.scalar(select(Photo)).final_overrides or '{}')
    db.dispose()


def test_missing_index_cleanup_does_not_require_scanning_source_files(tmp_path, monkeypatch):
    engine, remote, cfg, db = setup(tmp_path)
    asyncio.run(engine.sync())
    remote.rows.clear()
    import pixcake_bridge.recovery as recovery
    def no_source_access(*args, **kwargs):
        raise PermissionError('source is temporarily unavailable')
    monkeypatch.setattr(recovery, 'index_files', no_source_access)
    with TestClient(create_app(cfg, remote, start_workers=False)) as client:
        response = client.post('/api/projects/7/photos/1/recovery', json={'action':'forget_missing','confirm':True})
        assert response.status_code == 200, response.text
    db.dispose()
