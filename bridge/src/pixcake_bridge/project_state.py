"""Replayable project detachment with a separate archive-delete cleanup path."""
import json
import shutil
from pathlib import Path
from sqlalchemy import select
from .models import Delivery, Error, Photo, Project, SyncRun, Withdrawal
from .state_backup import atomic_json


def delete_project_rows(sessions, event_id):
    with sessions() as session:
        project = session.scalar(select(Project).where(Project.event_id == event_id))
        if project:
            ids = select(Photo.id).where(Photo.project_id == project.id)
            session.query(Delivery).filter(Delivery.photo_pk.in_(ids)).delete(synchronize_session=False)
            session.query(Withdrawal).filter(Withdrawal.photo_pk.in_(ids)).delete(synchronize_session=False)
            session.query(Photo).filter(Photo.project_id == project.id).delete(synchronize_session=False)
            session.query(Error).filter(Error.project_id == project.id).delete(synchronize_session=False)
            session.query(SyncRun).filter(SyncRun.project_id == project.id).delete(synchronize_session=False)
            session.delete(project)
        session.commit()


def delete_project_delivery(config, project):
    """Remove only the project's generated PixCake folders, never source RAW."""
    root = config.delivery_root_for(project.event_id)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("NAS 交付目录未挂载或不能是符号链接，未删除项目文件")
    root = root.resolve(strict=True)

    expected = (
        (Path(project.selected), "03_SELECTED_RAW"),
        (Path(project.final), "04_FINAL"),
        (Path(project.history), "05_HISTORY"),
    )
    targets = []
    scope = None
    for target, expected_name in expected:
        if target.name != expected_name:
            raise ValueError("项目交付目录结构不符合预期，未删除项目文件")
        if scope is None:
            scope = target.parent
        elif target.parent != scope:
            raise ValueError("项目交付目录不在同一项目文件夹中，未删除项目文件")
        try:
            relative = target.relative_to(root)
        except ValueError as error:
            raise ValueError("项目交付目录越出了 NAS PixCakeDelivery 根目录，未删除项目文件") from error
        if not relative.parts or any(part in {".", ".."} for part in relative.parts):
            raise ValueError("项目交付目录路径无效，未删除项目文件")

        current = root
        for part in relative.parts[:-1]:
            current = current / part
            if current.is_symlink() or (current.exists() and not current.is_dir()):
                raise ValueError("项目交付路径包含符号链接或非文件夹，未删除项目文件")
        if target.is_symlink() or (target.exists() and not target.is_dir()):
            raise ValueError("项目交付目录包含符号链接或非文件夹，未删除项目文件")
        targets.append(target)

    raw_roots = [Path(value).resolve(strict=False) for value in list(project.raw_dirs) + [project.raw]]
    for target in targets:
        resolved_target = target.resolve(strict=False)
        if any(raw == resolved_target or raw in resolved_target.parents or resolved_target in raw.parents for raw in raw_roots):
            raise ValueError("RAW 源目录与待删除交付目录重叠，已保护 RAW 源文件")

    # rmtree unlinks hardlinks in 03_SELECTED_RAW; the original inode remains
    # present in the separately mounted, read-only source directory.
    for target in targets:
        if target.exists():
            shutil.rmtree(target)

    # Remove the project's mirrored scope only when it is now empty. Do not
    # prune higher shared date/year directories that may contain other work.
    if scope is not None and scope != root and scope.exists() and not scope.is_symlink():
        try:
            scope.rmdir()
        except OSError:
            pass


def detach_project(config, sessions, event_id):
    journal = config.projects_file.parent / 'unbind-state.json'
    pending = json.loads(journal.read_text()) if journal.exists() else []
    if event_id not in pending:
        pending.append(event_id)
        atomic_json(journal, pending)
    current = [p for p in config.projects if p.event_id != event_id]
    payload = [{key: ([str(item) for item in p.raw_dirs] if key == 'raw_dirs' else str(getattr(p, key)) if key in {'raw', 'selected', 'final', 'history'} else getattr(p, key))
                for key in ('name', 'event_id', 'raw', 'raw_dirs', 'selected', 'final', 'history')} for p in current]
    atomic_json(config.projects_file, payload)
    config.projects = current
    delete_project_rows(sessions, event_id)
    pending.remove(event_id)
    if pending:
        atomic_json(journal, pending)
    else:
        journal.unlink(missing_ok=True)


def recover_detachments(config, sessions):
    journal = config.projects_file.parent / 'unbind-state.json'
    if journal.exists():
        for event_id in json.loads(journal.read_text()):
            if not isinstance(event_id, int) or event_id < 1:
                raise ValueError('解绑恢复日志包含无效项目')
            detach_project(config, sessions, event_id)
