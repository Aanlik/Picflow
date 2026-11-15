"""Names for the NAS delivery workspace and its project folders."""

import re
import unicodedata

DELIVERY_ROOT_DIRECTORY = "项目交付"
SELECTED_DIRECTORY = "已选 Raw 文件"
FINAL_DIRECTORY = "交付文件"
HISTORY_DIRECTORY = "临时文件"

PROJECT_DIRECTORY_RENAMES = (
    ("03_SELECTED_RAW", SELECTED_DIRECTORY),
    ("04_FINAL", FINAL_DIRECTORY),
    ("05_HISTORY", HISTORY_DIRECTORY),
)

# Existing deployments may still expose the former folder name through the
# read-only Camera mount. Excluding both prevents deliveries from being
# imported as source material during an in-place upgrade.
DELIVERY_ROOT_DIRECTORIES = frozenset({"PixCakeDelivery", DELIVERY_ROOT_DIRECTORY})


def project_folder_name(value: str) -> str:
    """Return a safe, readable NAS directory component for a Picflow name."""
    name = unicodedata.normalize("NFC", str(value or "")).strip()
    name = "".join(
        "_" if character in '/\\:*?"<>|' or ord(character) < 32 else character
        for character in name
    )
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = "未命名项目"
    # Leave room for filesystem metadata and avoid a UTF-8 component exceeding
    # common 255-byte name limits when a project title contains CJK characters.
    while len(name.encode("utf-8")) > 180:
        name = name[:-1]
    return name or "未命名项目"
