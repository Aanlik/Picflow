#!/bin/sh
set -eu
# PicPeak reads the owner-only Camera bind mount as nodejs. Match its numeric
# identity to the NAS folder owner without changing photo ownership or mode.
picpeak_uid=${PICPEAK_UID:-1001}
picpeak_gid=${PICPEAK_GID:-1001}
case "$picpeak_uid:$picpeak_gid" in
  *[!0-9:]*|:*|*:) echo "PICPEAK_UID and PICPEAK_GID must be positive integers" >&2; exit 1 ;;
esac
[ "$picpeak_uid" -gt 0 ] && [ "$picpeak_gid" -gt 0 ] || {
  echo "PICPEAK_UID and PICPEAK_GID must be greater than zero" >&2
  exit 1
}
if [ "$picpeak_uid" != 1001 ] || [ "$picpeak_gid" != 1001 ]; then
  # Alpine creates nodejs with the `nogroup` GID, so replace either primary
  # numeric field rather than assuming the image's initial group is 1001.
  sed -i "s/^nodejs:x:1001:[0-9]*:/nodejs:x:${picpeak_uid}:${picpeak_gid}:/" /etc/passwd
  sed -i "s/^nodejs:x:1001:/nodejs:x:${picpeak_gid}:/" /etc/group
fi
# Adopt only Bridge state, never customer photograph directories.
mkdir -p /bridge-data
[ -e /bridge-data/projects.json ] || cp /config/projects.json /bridge-data/projects.json
chown -R "${BRIDGE_UID:-1001}:${BRIDGE_GID:-1001}" /bridge-data
exec supervisord -c /opt/integrated/supervisord.conf
