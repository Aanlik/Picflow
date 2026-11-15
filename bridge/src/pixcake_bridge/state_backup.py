"""Versioned workflow checkpoint, without credentials or camera file contents."""
import json
import os
import tempfile
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from sqlalchemy import DateTime, select
from .config import ProjectConfig
from .files import raw_override_is_configured
from .models import Base


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as file:
        json.dump(value, file, ensure_ascii=False)
        file.flush()
        os.fsync(file.fileno())
        temporary = Path(file.name)
    temporary.replace(path)
    # Acknowledging a durable checkpoint requires the rename itself to persist.
    directory = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def export_state(config, sessions):
    with sessions() as session:
        tables = {}
        for table in Base.metadata.sorted_tables:
            tables[table.name] = [{key: value.isoformat() if isinstance(value, datetime) else value
                                  for key, value in dict(row).items()}
                                 for row in session.execute(select(table)).mappings()]
    if {row['event_id'] for row in tables['projects']} != {p.event_id for p in config.projects}:
        raise ValueError('项目配置与数据库不一致，不能生成精修状态备份')
    return {'version': 1, 'projects': [{key: ([str(item) for item in p.raw_dirs] if key == 'raw_dirs' else str(getattr(p, key)) if key in {'raw', 'selected', 'final', 'history'} else getattr(p, key))
                                     for key in ('name', 'event_id', 'raw', 'raw_dirs', 'selected', 'final', 'history')} for p in config.projects],
            'tables': tables}


def restore_state(payload, config, sessions, *, journal=True):
    if not isinstance(payload, dict) or payload.get('version') != 1:
        raise ValueError('不支持的精修状态备份版本')
    tables = {table.name: table for table in Base.metadata.sorted_tables}
    if set(payload.get('tables', {})) != set(tables):
        raise ValueError('精修状态备份缺少数据表')
    # Reconcile an older checkpoint with the currently configured workspace.
    # A Picflow rename moves the NAS directory; restoring a checkpoint created
    # before that rename must not point the Bridge database back at the now
    # missing old path or create a misleading empty workspace there.
    payload = deepcopy(payload)
    backup_projects = {}
    for value in payload.get('projects', []):
        backup_projects[int(value['event_id'])] = ProjectConfig(**{
            key: [Path(path) for path in item] if key == 'raw_dirs'
            else Path(item) if key in {'raw', 'selected', 'final', 'history'}
            else item for key, item in value.items()
        })
    backup_workspace_paths = {
        event_id: (project.selected, project.history)
        for event_id, project in backup_projects.items()
    }
    current_projects = {project.event_id: project for project in config.projects}
    projects = []
    for value in payload.get('projects', []):
        project = backup_projects[int(value['event_id'])]
        old = current_projects.get(project.event_id)
        if old is not None:
            project.name = old.name
            project.selected, project.final, project.history = old.selected, old.final, old.history
        raw_roots = [config.raw_root] + ([old.raw] if old else [])
        if not all(any(raw.resolve().is_relative_to(root.resolve()) for root in raw_roots) for raw in project.raw_dirs):
            raise ValueError('备份 RAW 路径不在已授权挂载内')
        writable = config.delivery_root_for(project.event_id).resolve()
        for key in ('selected', 'final', 'history'):
            target = getattr(project, key)
            old_root = getattr(old, key).resolve() if old else writable
            if not (target.resolve().is_relative_to(writable) or target.resolve() == old_root):
                raise ValueError('备份交付路径不在已授权挂载内')
        project.validate()
        projects.append(project)
    outputs = [getattr(p, key).resolve() for p in projects for key in ('selected', 'final', 'history')]
    for index, root in enumerate(outputs):
        if any(root == other or root in other.parents or other in root.parents for other in outputs[index + 1:]):
            raise ValueError('备份项目的交付目录重叠')
    if len({p.event_id for p in projects}) != len(projects):
        raise ValueError('备份包含重复项目')
    project_ids = {row['id']: row['event_id'] for row in payload['tables']['projects']}
    configured = {p.event_id: p for p in projects}
    if set(project_ids.values()) != set(configured):
        raise ValueError('备份项目配置与数据库不一致')
    for row in payload['tables']['projects']:
        row['name'] = configured[row['event_id']].name

    photo_events = {}
    for photo in payload['tables']['photos']:
        event_id = project_ids[photo['project_id']]
        photo_events[photo['id']] = event_id
        current = current_projects.get(event_id)
        if current is None:
            continue
        backup_selected, backup_history = backup_workspace_paths[event_id]
        for key, source_root, target_root in (
            ('selected_path', backup_selected, current.selected),
            ('upload_snapshot_path', backup_history, current.history),
        ):
            value = photo.get(key)
            if value:
                try:
                    photo[key] = str(target_root / Path(value).relative_to(source_root))
                except ValueError:
                    pass

    for name in ('deliveries', 'withdrawals'):
        for row in payload['tables'][name]:
            value = row.get('snapshot')
            event_id = photo_events.get(row['photo_pk'])
            current = current_projects.get(event_id) if event_id is not None else None
            if value and current is not None:
                _, backup_history = backup_workspace_paths[event_id]
                try:
                    row['snapshot'] = str(current.history / Path(value).relative_to(backup_history))
                except ValueError:
                    pass

    photo_roots = {}
    for photo in payload['tables']['photos']:
        cfg = configured[project_ids[photo['project_id']]]
        photo_roots[photo['id']] = cfg
        if photo.get('raw_path') and not any(
            Path(photo['raw_path']).resolve().is_relative_to(root.resolve())
            for root in list(cfg.raw_dirs) + [cfg.raw]
        ):
            raise ValueError('备份照片路径越界')
        if photo.get('selected_path') and not Path(photo['selected_path']).resolve().is_relative_to(cfg.selected.resolve()):
            raise ValueError('备份照片路径越界')
        if photo.get('upload_snapshot_path') and not Path(photo['upload_snapshot_path']).resolve().is_relative_to(cfg.history.resolve()):
            raise ValueError('备份用户上传原图路径越界')
        raw_override = photo.get('raw_override')
        if raw_override:
            # A snapshot may outlive a temporarily missing or deactivated
            # source folder. Confine it to the authorized Camera mount here;
            # runtime matching still requires a currently configured source.
            if not raw_override_is_configured(config.raw_root, [config.raw_root], cfg.raw, raw_override):
                raise ValueError('备份RAW人工映射路径越界')
        if photo.get('final_overrides'):
            overrides = json.loads(photo['final_overrides'])
            if not isinstance(overrides, dict):
                raise ValueError('备份成片人工映射无效')
            for version, value in overrides.items():
                if not str(version).isdigit() or not isinstance(value, str):
                    raise ValueError('备份成片人工映射无效')
                relative = Path(value)
                if relative.is_absolute() or '..' in relative.parts or '\\' in value or not (cfg.final / relative).resolve().is_relative_to(cfg.final.resolve()):
                    raise ValueError('备份成片人工映射路径越界')
        key = photo.get('upload_source_key')
        if key:
            source_key = Path(key)
            if (source_key.is_absolute() or '\\' in key or
                    any(part in {'', '.', '..'} for part in source_key.parts) or
                    source_key.parts[:2] != ('events', 'active')):
                raise ValueError('备份用户上传源文件键无效')
    for name in ('deliveries', 'withdrawals'):
        for row in payload['tables'][name]:
            if row.get('snapshot') and not Path(row['snapshot']).resolve().is_relative_to(photo_roots[row['photo_pk']].history.resolve()):
                raise ValueError('备份历史路径越界')
    converted = {}
    for name, table in tables.items():
        converted[name] = []
        for row in payload['tables'][name]:
            expected = {column.name for column in table.columns}
            values = dict(row)
            if name == 'photos':
                # These fields were added after checkpoint version 1 shipped;
                # older backups remain restorable with empty upload metadata.
                for optional in ('upload_source_key', 'upload_snapshot_path', 'upload_snapshot_hash', 'work_filename', 'source_kind', 'raw_override', 'mapped_source', 'final_overrides'):
                    if optional not in values and optional in expected:
                        values[optional] = None
            if set(values) != expected:
                raise ValueError('备份字段不完整或已过期')
            converted[name].append({key: datetime.fromisoformat(value) if value and isinstance(table.c[key].type, DateTime) else value for key, value in values.items()})
    journal_path = config.projects_file.parent / 'restore-state.json'
    with sessions() as session:
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(table.delete())
        for table in Base.metadata.sorted_tables:
            if converted[table.name]:
                session.execute(table.insert(), converted[table.name])
        if journal:
            atomic_json(journal_path, payload)
        session.commit()
    payload['projects'] = [{
        'name': project.name,
        'event_id': project.event_id,
        'raw': str(project.raw),
        'raw_dirs': [str(raw) for raw in project.raw_dirs],
        'selected': str(project.selected),
        'final': str(project.final),
        'history': str(project.history),
    } for project in projects]
    atomic_json(config.projects_file, payload['projects'])
    config.projects = projects
    journal_path.unlink(missing_ok=True)
