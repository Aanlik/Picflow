#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
image=${PICFLOW_IMAGE:-${PHOFLOW_IMAGE:-$("$repo_root/scripts/picflow-image.sh")}}
picflow_version=${image##*:}
picflow_revision=${PICFLOW_REVISION:-$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf 'unknown')}
if [ -z "${PICFLOW_REVISION:-}" ] && [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal 2>/dev/null || true)" ]; then
  picflow_revision="${picflow_revision}-dirty"
fi
docker build --platform "${PLATFORM:-linux/amd64}" \
  --build-arg "PICFLOW_VERSION=$picflow_version" \
  --build-arg "PICFLOW_REVISION=$picflow_revision" \
  -f "$repo_root/Dockerfile" -t "$image" "$repo_root"
