async function inspectRawMounts(eventId, rawSubdirectories, bridgeRequest) {
  const rawSubdirs = [...new Set((Array.isArray(rawSubdirectories) ? rawSubdirectories : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
  const checks = await Promise.all(rawSubdirs.map(async (rawSubdir) => {
    const result = await bridgeRequest(
      `/api/projects/${Number(eventId)}/mount-status?raw_subdir=${encodeURIComponent(rawSubdir)}`,
    );
    return {
      raw_subdir: rawSubdir,
      ready: result?.status === 200 && result.data?.writable_mount_ready === true,
    };
  }));
  const readySubdirs = checks.filter((check) => check.ready).map((check) => check.raw_subdir);
  return {
    raw_subdirs: rawSubdirs,
    ready_subdirs: readySubdirs,
    suggested_raw_subdir: readySubdirs[0] || rawSubdirs[0] || null,
    available: readySubdirs.length > 0,
  };
}

module.exports = { inspectRawMounts };
