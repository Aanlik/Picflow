"""Explicit, operator-confirmed repairs. Never deletes or renames source files."""
import json
from pathlib import Path
from sqlalchemy import select
from .files import RAW_EXTENSIONS, FINAL_EXTENSIONS, index_files, safe_file, safe_name, stem_key
from .models import Project, Photo, Delivery, Withdrawal, Error
from .filenames import normalize_filename


def relative_file(root, value, extensions):
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('请选择目录内的文件')
    path = Path(value)
    if path.is_absolute() or '..' in path.parts or path.suffix.lower() not in extensions:
        raise ValueError('文件路径或格式无效')
    safe_file(root / path, root)
    return path.as_posix()


async def recover(engine, event_id, photo_id, payload=None):
    engine.require_writable()
    cfg = next((c for c in engine.config.projects if c.event_id == event_id), None)
    if cfg is None:
        raise LookupError('项目不存在')
    remote = await engine.client.photos(event_id)  # no mutation on a failed/partial fetch
    current = next((p for p in remote if p['id'] == photo_id), None)
    with engine.sessions() as s:
        project = s.scalar(select(Project).where(Project.event_id == event_id))
        if project is None or project.stage == 'ARCHIVED':
            raise ValueError('项目不存在或已归档')
        photo = s.scalar(select(Photo).where(Photo.project_id == project.id, Photo.photo_id == photo_id))
        if photo is None:
            raise LookupError('照片索引不存在')
        source = normalize_filename((current or {}).get('source_filename') or photo.source_filename)
        safe_name(source)
        version = engine.current_version(s, photo) + 1
        if payload is None:
            # Missing-photo cleanup only needs the authoritative remote list,
            # not readable camera/final mounts or a full directory scan.
            raw_index = index_files(cfg.raw, RAW_EXTENSIONS, {'PixCakeDelivery'}) if current else {}
            final_index = index_files(cfg.final, FINAL_EXTENSIONS) if current else {}
            return {'remote_present': current is not None, 'source_filename': source,
                    'previous_source': normalize_filename(photo.source_filename), 'next_version': version,
                    'raw_candidates': sorted(str(p.relative_to(cfg.raw)) for p in raw_index.get(stem_key(source), [])),
                    'final_candidates': sorted(str(p.relative_to(cfg.final)) for p in final_index.get(stem_key(photo.work_filename or source), [])
                                               if p.parent == cfg.final or p.parent == cfg.final / f'V{version}'),
                    'raw_override': photo.raw_override, 'work_filename': photo.work_filename,
                    'requires_raw': not bool(photo.upload_source_key or photo.upload_snapshot_path),
                    'final_override': json.loads(photo.final_overrides or '{}').get(str(version))}
        if payload.get('confirm') is not True:
            raise ValueError('请确认修复操作及其影响')
        if any(d.state in {'PENDING','UPLOADING','UNKNOWN'} for d in s.scalars(select(Delivery).where(Delivery.photo_pk == photo.id))):
            raise ValueError('请先处理该照片尚未确定结果的交付任务')
        if s.scalar(select(Withdrawal).where(Withdrawal.photo_pk == photo.id, Withdrawal.state != 'SUCCESS')):
            raise ValueError('请先处理该照片尚未完成的撤回任务')
        if payload.get('action') == 'forget_missing':
            if current is not None:
                raise FileExistsError('照片仍存在于Picflow，不能清理其索引')
            for cls in (Delivery, Withdrawal):
                for row in s.scalars(select(cls).where(cls.photo_pk == photo.id)):
                    s.delete(row)
            s.flush()
            s.delete(photo)
            message = f'照片 {photo_id}: 已清理失效索引；RAW、工作副本及历史文件均保留'
        elif payload.get('action') == 'rebind':
            if current is None or payload.get('confirm') is not True:
                raise ValueError('需要确认当前照片及关联文件')
            source = current.get('source_filename')
            safe_name(source)
            is_upload = bool(photo.upload_source_key or photo.upload_snapshot_path)
            if is_upload:
                if payload.get('raw_relative'):
                    raise ValueError('用户上传源文件不适用RAW重新关联')
                if normalize_filename(photo.source_filename) != normalize_filename(source):
                    raise ValueError('用户上传源文件已变化，请先核对上传源文件')
            else:
                raw = relative_file(cfg.raw, payload.get('raw_relative'), RAW_EXTENSIONS)
                other = s.scalar(select(Photo).where(Photo.project_id == project.id, Photo.id != photo.id, Photo.raw_override == raw))
                if other or any(row.raw_path and Path(row.raw_path).resolve() == (cfg.raw / raw).resolve() for row in s.scalars(select(Photo).where(Photo.project_id == project.id, Photo.id != photo.id))):
                    raise ValueError('这个RAW已关联到其他照片')
                changed = photo.raw_path and Path(photo.raw_path) != cfg.raw / raw
                if changed or normalize_filename(photo.source_filename) != normalize_filename(source):
                    # Keep old work files and history; normal materialization
                    # allocates a collision-free name for the new source.
                    photo.selected_path = None
                    photo.work_filename = None
                    photo.raw_path = None
                    photo.raw_hash = None
                    photo.materialized_hash = None
                photo.source_filename = source
                photo.raw_override, photo.mapped_source = raw, source
            if payload.get('final_relative'):
                final = relative_file(cfg.final, payload['final_relative'], FINAL_EXTENSIONS)
                if Path(final).parent not in {Path('.'), Path(f'V{version}')}:
                    raise ValueError('请选择下一版本目录中的成片')
                overrides = json.loads(photo.final_overrides or '{}')
                overrides[str(version)] = final
                photo.final_overrides = json.dumps(overrides)
            elif 'final_relative' in payload:
                overrides = json.loads(photo.final_overrides or '{}')
                overrides.pop(str(version), None)
                photo.final_overrides = json.dumps(overrides)
            photo.error = None
            message = f'照片 {photo_id}: 人工映射已保存，原文件和历史版本保留'
        else:
            raise ValueError('无效的修复操作')
        for err in s.scalars(select(Error).where(Error.project_id == project.id, Error.resolved == False)):
            if err.message.startswith(f'照片 {photo_id}:'):
                err.resolved = True
        s.add(Error(project_id=project.id, message=message, resolved=True))
        s.commit()
    engine.wake.set()
    return {'success': True, 'message': message}
