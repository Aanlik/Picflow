#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
image=${PICFLOW_IMAGE:-${PHOFLOW_IMAGE:-$("$repo_root/scripts/picflow-image.sh")}}
picflow_version=${image##*:}
docker build --platform "${PLATFORM:-linux/amd64}" \
  --build-arg "PICFLOW_VERSION=$picflow_version" \
  -f "$repo_root/Dockerfile" -t "$image" "$repo_root"
