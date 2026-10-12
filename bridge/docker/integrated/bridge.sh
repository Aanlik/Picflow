#!/bin/sh
set -eu
exec su-exec "${BRIDGE_UID:-1001}:${BRIDGE_GID:-1001}" /opt/bridge/venv/bin/uvicorn pixcake_bridge.app:app --host 127.0.0.1 --port 8080 --workers 1 --no-access-log
