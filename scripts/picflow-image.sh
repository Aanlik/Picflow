#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
version=$(sed -n 's/^[[:space:]]*image:[[:space:]]*picflow:\([^[:space:]]*\).*$/\1/p' "$repo_root/compose.yaml" | head -n 1)
if [ -z "$version" ]; then
  echo "Could not read the Picflow image version from compose.yaml" >&2
  exit 1
fi
printf 'picflow:%s\n' "$version"
