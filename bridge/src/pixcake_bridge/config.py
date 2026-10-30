import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse


@dataclass
class ProjectConfig:
    name: str
    event_id: int
    raw: Path
    selected: Path
    final: Path
    history: Path
    raw_dirs: list[Path] | None = None

    def __post_init__(self):
        self.raw = Path(self.raw)
        self.raw_dirs = list(dict.fromkeys(Path(item) for item in ([self.raw] if self.raw_dirs is None else self.raw_dirs)))

    @property
    def proof_roots(self):
        roots = []
        for raw in self.raw_dirs:
            sibling = raw.parent / '02_PROOF'
            if raw.name == '01_RAW' and (sibling.exists() or sibling.is_symlink()):
                # Keep an invalid sibling in the candidate list so the merged
                # index can record that source as unavailable without making
                # healthy proof folders from other associations unusable.
                roots.append(sibling)
            else:
                roots.append(raw)
        return list(dict.fromkeys(roots))

    @property
    def proof_root(self):
        # Standard project layout keeps camera RAW and client proofs separate.
        # NAS folder references may contain both, in which case raw is also
        # the immutable proof root. Never read a rendered delivery as a proof.
        return self.proof_roots[0]

    def validate(self):
        if self.event_id < 1 or not self.name.strip():
            raise ValueError("项目名称和 event_id 无效")
        raw_dirs = list(dict.fromkeys(Path(p).resolve() for p in self.raw_dirs))
        for raw in self.raw_dirs:
            if raw.is_symlink() or (raw.exists() and not raw.is_dir()):
                raise ValueError(f'RAW 路径不是目录或为符号链接: {raw}')
        delivery_dirs = [p.resolve() for p in (self.selected, self.final, self.history)]
        # Source folders may overlap (for example a Camera root plus one of
        # its project subfolders). The merged index deduplicates physical
        # files, while write directories must stay disjoint from every source.
        paths = raw_dirs + delivery_dirs
        for i, a in enumerate(paths):
            for j, b in enumerate(paths[i + 1:], start=i + 1):
                if i < len(raw_dirs) and j < len(raw_dirs):
                    continue
                if a == b or a in b.parents or b in a.parents:
                    raise ValueError("RAW、待精修、成片、历史目录必须互相独立")
        for p in (self.selected, self.final, self.history):
            if p.is_symlink():
                raise ValueError("不能使用符号链接目录")
            p.mkdir(parents=True, exist_ok=True)


@dataclass
class Config:
    base_url: str = "http://127.0.0.1:3000"
    integrated: bool = True
    database_url: str = "sqlite:////data/bridge.db"
    poll_seconds: float = 30
    stable_seconds: float = 10
    max_bytes: int = 100 * 1024 * 1024
    history_keep: int = 3
    materialize_mode: str = "auto"
    projects: list[ProjectConfig] = field(default_factory=list)
    projects_file: Path = Path("/config/projects.json")
    # Picflow stores material paths relative to the shared, read-only
    # namespace. It contains Camera and any additional explicit Compose mounts.
    raw_root: Path = Path("/external-media")
    raw_host_root: Path | None = None
    picpeak_storage_root: Path = Path("/data/storage")
    delivery_root: Path = Path("/delivery")
    delivery_host_root: str = ""
    project_delivery_mounts: dict[int, dict[str, str]] = field(default_factory=dict)

    def delivery_root_for(self, event_id: int) -> Path:
        mount = self.project_delivery_mounts.get(int(event_id))
        return Path(mount["container"]) if mount else self.delivery_root

    def delivery_host_root_for(self, event_id: int) -> str:
        mount = self.project_delivery_mounts.get(int(event_id))
        return mount["host"] if mount else self.delivery_host_root

    def migrate_legacy_delivery_layout(self):
        """Move old nested project workspaces into the direct project folder.

        Older installs mirrored Camera's ``RAW/Project`` path beneath the
        unified delivery mount. New installs store the work folders directly
        beneath ``PixCakeDelivery/Project``. Also retain the older migration
        for ``event-ID-name`` directories used by per-project mounts.
        """
        changed = False
        for project in self.projects:
            root = self.delivery_root_for(project.event_id)
            legacy = project.selected.parent
            if legacy == root or legacy.is_symlink() or root.is_symlink() or not root.is_dir():
                continue
            try:
                is_event_legacy = (
                    legacy.parent.resolve() == root.resolve() and
                    legacy.name.startswith(f"event-{project.event_id}-")
                )
            except OSError:
                is_event_legacy = False

            target = None
            if is_event_legacy:
                target = root
            else:
                try:
                    relative = legacy.relative_to(root)
                    if (relative.parts and all(part not in {".", ".."} for part in relative.parts)
                            and relative.parts[0].casefold() == "raw" and len(relative.parts) > 1):
                        target = root.joinpath(*relative.parts[1:])
                except ValueError:
                    pass
            if target is None or target == legacy:
                continue
            try:
                resolved_target = target.resolve(strict=False)
                resolved_root = root.resolve(strict=True)
                if resolved_target != resolved_root and resolved_root not in resolved_target.parents:
                    raise ValueError("旧交付目录路径越出 PixCakeDelivery 根目录")
                if any((root / Path(*target.relative_to(root).parts[:index])).is_symlink()
                       for index in range(1, len(target.relative_to(root).parts) + 1)):
                    raise ValueError("旧交付目录路径包含符号链接，已停止自动整理")
                target.mkdir(parents=True, exist_ok=True)
            except OSError as error:
                raise ValueError("无法创建项目交付目录，旧文件保持原位") from error

            names = ("03_SELECTED_RAW", "04_FINAL", "05_HISTORY")
            journal = self.projects_file.with_name("layout-migrations.json")
            records = json.loads(journal.read_text()) if journal.exists() else []
            record = {"event_id": project.event_id, "old": str(legacy), "new": str(target)}
            if record not in records:
                records.append(record)
                journal.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=journal.parent, delete=False) as file:
                    json.dump(records, file)
                    file.flush()
                    os.fsync(file.fileno())
                    temporary = Path(file.name)
                temporary.replace(journal)
            moves = [(legacy / name, target / name) for name in names]
            for source, destination in moves:
                if source.is_symlink() or destination.is_symlink():
                    raise ValueError("旧交付目录中存在符号链接，已停止自动整理")
                if source.exists() and destination.exists():
                    source_has_data = any(source.iterdir()) if source.is_dir() else True
                    destination_has_data = any(destination.iterdir()) if destination.is_dir() else True
                    if source_has_data and destination_has_data:
                        raise ValueError(f"新旧交付目录均有文件，需先人工检查冲突：{source.name}")
            for source, destination in moves:
                if not source.exists():
                    continue
                if destination.exists():
                    if not any(destination.iterdir()):
                        destination.rmdir()
                    else:
                        source.rmdir()
                        continue
                source.rename(destination)
            current = legacy
            while current != root:
                try:
                    current.rmdir()
                except OSError:
                    break
                current = current.parent
            project.selected = target / "03_SELECTED_RAW"
            project.final = target / "04_FINAL"
            project.history = target / "05_HISTORY"
            changed = True

        if changed:
            self.projects_file.parent.mkdir(parents=True, exist_ok=True)
            payload = [
                {"name": p.name, "event_id": p.event_id, "raw": str(p.raw), "raw_dirs": [str(raw) for raw in p.raw_dirs],
                 "selected": str(p.selected), "final": str(p.final), "history": str(p.history)}
                for p in self.projects
            ]
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.projects_file.parent, delete=False) as file:
                json.dump(payload, file, ensure_ascii=False, indent=2)
                file.write("\n")
                temporary = Path(file.name)
            temporary.replace(self.projects_file)

    @classmethod
    def load(cls):
        projects_file = Path(os.getenv("PROJECTS_FILE", "/config/projects.json"))
        projects = json.loads(projects_file.read_text())
        raw_mounts = json.loads(os.getenv("PROJECT_DELIVERY_MOUNTS", "{}") or "{}")
        mounts = {}
        for key, mount in raw_mounts.items():
            event_id = int(key)
            container = str(mount.get("container", ""))
            host = str(mount.get("host", ""))
            if event_id < 1 or not Path(container).is_absolute() or not Path(host).is_absolute():
                raise ValueError("项目交付挂载必须使用正数项目编号和绝对路径")
            mounts[event_id] = {"container": container, "host": host}
        cfg = cls(
            base_url=os.getenv("PICPEAK_URL", "http://127.0.0.1:3000").rstrip("/"),
            integrated=True,
            database_url=os.getenv("DATABASE_URL", "sqlite:////data/bridge.db"),
            poll_seconds=float(os.getenv("POLL_SECONDS", "30")),
            stable_seconds=float(os.getenv("STABLE_SECONDS", "10")),
            max_bytes=int(os.getenv("MAX_FINAL_BYTES", str(100 * 1024 * 1024))),
            history_keep=int(os.getenv("HISTORY_KEEP", "3")),
            materialize_mode=os.getenv("RAW_MATERIALIZE_MODE", "auto"),
            projects=[ProjectConfig(**{
                **p,
                **{k: Path(p[k]) for k in ("raw", "selected", "final", "history")},
                "raw_dirs": [Path(item) for item in p.get("raw_dirs", [p["raw"]])],
            }) for p in projects],
            projects_file=projects_file,
            raw_root=Path(os.getenv("RAW_ROOT", "/external-media")),
            raw_host_root=Path(os.getenv("RAW_HOST_ROOT")) if os.getenv("RAW_HOST_ROOT") else None,
            picpeak_storage_root=Path(os.getenv("PICPEAK_STORAGE_ROOT", os.getenv("STORAGE_PATH", "/data/storage"))),
            delivery_root=Path(os.getenv("DELIVERY_ROOT", "/delivery")),
            delivery_host_root=os.getenv("DELIVERY_HOST_ROOT", ""),
            project_delivery_mounts=mounts,
        )
        cfg.migrate_legacy_delivery_layout()
        url = urlparse(cfg.base_url)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.query or url.fragment:
            raise ValueError("PICPEAK_URL 无效")
        if url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("整合模式只能通过容器回环地址访问 Picflow")
        if cfg.poll_seconds < 1 or cfg.stable_seconds < 1 or cfg.history_keep < 1 or cfg.max_bytes < 1 or cfg.materialize_mode not in {"auto", "copy"}:
            raise ValueError("同步参数无效")
        if len({p.event_id for p in cfg.projects}) != len(cfg.projects):
            raise ValueError("一个 Picflow 画廊只能绑定一个项目")
        for p in cfg.projects:
            try:
                root = cfg.raw_root.resolve(strict=True)
                for raw in p.raw_dirs:
                    try:
                        relative = raw.absolute().relative_to(cfg.raw_root.absolute())
                    except ValueError as error:
                        raise ValueError('RAW 素材目录必须位于只读素材挂载根目录内') from error
                    resolved = raw.resolve(strict=False)
                    if resolved != root and root not in resolved.parents:
                        raise ValueError('RAW 素材目录必须位于只读素材挂载根目录内')
                    current = cfg.raw_root
                    for part in relative.parts:
                        current = current / part
                        if current.is_symlink():
                            raise ValueError('RAW 素材路径不能经过符号链接')
            except OSError as error:
                raise ValueError('RAW 素材路径无效') from error
            p.validate()
        return cfg
