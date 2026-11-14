"""Names for the NAS delivery workspace and its project folders."""

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
