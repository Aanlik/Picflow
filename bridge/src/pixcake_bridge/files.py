import errno
import hashlib
import os
import shutil
import subprocess
import time
import unicodedata
from pathlib import Path

RAW_EXTENSIONS = {".arw", ".cr3", ".cr2", ".nef", ".raf", ".dng", ".orf", ".rw2"}
FINAL_EXTENSIONS = {".jpg", ".jpeg", ".png"}
NON_RAW_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff"}


def safe_name(name: str):
    if not name or name in {".", ".."} or len(name.encode()) > 240 or any(c in name for c in '/\\\0:') or any(ord(c) < 32 for c in name):
        raise ValueError("非法文件名")
    return name


def stem_key(name: str):
    return unicodedata.normalize("NFC", Path(safe_name(name)).stem).casefold()


def safe_file(path: Path, root: Path):
    if path.is_symlink() or not path.is_file() or root.resolve() not in path.resolve().parents:
        raise ValueError("文件越界、符号链接或不是普通文件")
    return path


def _raw_override_candidates(raw_root: Path, raw_dirs: list[Path], legacy_raw: Path | None, value: str):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("RAW 人工映射路径无效")
    relative = Path(value)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("RAW 人工映射路径越界")
    roots = list(dict.fromkeys(Path(root).resolve() for root in raw_dirs))
    bases = [Path(raw_root)]
    # Older database rows stored this path relative to the first RAW folder.
    if legacy_raw is not None:
        bases.append(Path(legacy_raw))
    resolved_candidates = []
    for base in bases:
        candidate = base / relative
        resolved = candidate.resolve(strict=False)
        if any(resolved == root or root in resolved.parents for root in roots):
            current = base
            has_symlink = False
            for part in relative.parts:
                current = current / part
                if current.is_symlink():
                    has_symlink = True
                    break
            if not has_symlink and resolved not in resolved_candidates:
                resolved_candidates.append(resolved)
    return roots, resolved_candidates


def resolve_raw_override(raw_root: Path, raw_dirs: list[Path], legacy_raw: Path | None, value: str):
    """Resolve a RAW override from any configured source directory.

    New overrides are relative to the Camera root. Existing rows relative to
    the project's legacy first RAW directory remain readable. Ambiguous paths
    fail closed rather than choosing one candidate silently.
    """
    roots, candidates = _raw_override_candidates(raw_root, raw_dirs, legacy_raw, value)
    matches = []
    for candidate in candidates:
        if candidate.is_symlink() or not candidate.is_file() or candidate.suffix.lower() not in RAW_EXTENSIONS:
            continue
        matching_root = next((root for root in roots if candidate == root or root in candidate.parents), None)
        if matching_root is None:
            continue
        try:
            safe_file(candidate, matching_root)
        except ValueError:
            continue
        if candidate not in matches:
            matches.append(candidate)
    if not matches:
        raise ValueError("RAW 人工映射文件不在当前配置的素材目录内或已不可用")
    if len(matches) > 1:
        raise ValueError("RAW 人工映射路径有多个匹配结果，请选择明确的来源路径")
    return matches[0]


def raw_override_is_configured(raw_root: Path, raw_dirs: list[Path], legacy_raw: Path | None, value: str):
    """Validate an override path against configured roots without requiring
    the source file to be mounted during a backup restore.
    """
    roots, candidates = _raw_override_candidates(raw_root, raw_dirs, legacy_raw, value)
    return bool(candidates) and all(any(root == candidate or root in candidate.parents for root in roots) for candidate in candidates)


def index_files(root: Path, extensions: set[str], exclude_dirs: set[str] | None = None):
    result: dict[str, list[Path]] = {}
    excluded = {name.casefold() for name in (exclude_dirs or set())}
    for p in root.rglob("*"):
        relative = p.relative_to(root)
        if any(part.casefold() in excluded for part in relative.parts[:-1]):
            continue
        if p.suffix.lower() in extensions and p.is_file():
            safe_file(p, root)
            result.setdefault(stem_key(p.name), []).append(p)
    return result


def match_raw(source: str, index: dict[str, list[Path]], root: Path | None = None):
    candidates = index.get(stem_key(source), [])
    if len(candidates) != 1:
        if not candidates:
            raise ValueError("RAW 未找到")
        locations = [str(p.relative_to(root)) if root else p.name for p in candidates]
        raise ValueError(f"RAW 文件名冲突（{Path(source).stem}）：" + "、".join(locations))
    return candidates[0]


def resolve_uploaded_source(key: str, root: Path):
    """Resolve a trusted Picflow storage key without following symlinks."""
    if not isinstance(key, str) or not key or "\\" in key or "\0" in key:
        raise ValueError("用户上传源文件路径无效")
    relative = Path(key)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("用户上传源文件路径越界")
    if len(relative.parts) < 4 or relative.parts[:2] != ("events", "active"):
        raise ValueError("用户上传源文件路径不属于 Picflow 照片存储区")
    if relative.suffix.lower() in RAW_EXTENSIONS or relative.suffix.lower() not in NON_RAW_IMAGE_EXTENSIONS:
        raise ValueError("只支持将非 RAW 图片上传源文件加入待精修目录")
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Picflow 本地照片存储目录不可用")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("用户上传源文件路径包含符号链接")
    return safe_file(current, root)


def sha256(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def materialize(source: Path, dest: Path, mode="auto"):
    """Never chmod or otherwise mutate source, including through a hardlink."""
    if dest.exists() or dest.is_symlink():
        raise FileExistsError("待精修目录已有同名文件，拒绝覆盖")
    tmp = dest.with_name(dest.name + ".bridge-tmp")
    if tmp.exists() or tmp.is_symlink():
        raise FileExistsError("临时文件已存在，请检查后清理")
    method = "copy"
    try:
        if mode == "auto":
            # A writable inode is unsafe to hardlink. Do not chmod through a
            # link: that would modify the original's permissions as well.
            if source.stat().st_mode & 0o222 == 0:
                try:
                    os.link(source, tmp, follow_symlinks=False)
                    method = "hardlink"
                except OSError as exc:
                    if exc.errno not in {errno.EXDEV, errno.EPERM, errno.EACCES, errno.ENOTSUP, errno.EMLINK}:
                        raise
            if not tmp.exists():
                try:
                    subprocess.run(["cp", "--reflink=always", "--", str(source), str(tmp)], check=True, capture_output=True)
                    method = "reflink"
                except (OSError, subprocess.CalledProcessError):
                    if tmp.exists():
                        tmp.unlink()
        if not tmp.exists():
            shutil.copyfile(source, tmp)
        if method != "hardlink":
            tmp.chmod(0o444)
        if sha256(source) != sha256(tmp):
            raise ValueError("RAW 副本校验失败")
        # Exclusive link publishes atomically without ever overwriting.
        os.link(tmp, dest, follow_symlinks=False)
        return method
    finally:
        if tmp.exists():
            tmp.unlink()


class Stability:
    def __init__(self, seconds: float):
        self.seconds = seconds
        self.seen = {}

    def ready(self, path: Path, clock=None):
        clock = time.monotonic() if clock is None else clock
        st = path.stat()
        fingerprint = (st.st_size, st.st_mtime_ns, st.st_ino)
        before = self.seen.get(str(path))
        if not before or before[0] != fingerprint:
            self.seen[str(path)] = (fingerprint, clock)
            return False
        return st.st_size > 0 and clock - before[1] >= self.seconds


def snapshot(source: Path, dest: Path, max_bytes: int):
    before = source.stat()
    if not 0 < before.st_size <= max_bytes:
        raise ValueError("FINAL 为空或超过上传大小限制")
    created = False
    # Bounded copy also handles a file that starts growing during the copy.
    try:
        with source.open("rb") as src, dest.open("xb") as out:
            created = True
            total = 0
            for chunk in iter(lambda: src.read(1024 * 1024), b""):
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError("FINAL 超过上传大小限制")
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        after = source.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise ValueError("FINAL 正在写入，稍后重试")
        dest.chmod(0o444)
        return sha256(dest)
    except Exception:
        if created:
            dest.unlink(missing_ok=True)
        raise
