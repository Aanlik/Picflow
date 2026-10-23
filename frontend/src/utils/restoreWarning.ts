type Translate = (key: string, options?: Record<string, unknown>) => string;
export function restoreWarning(warning: string, t: Translate): string {
  let match = /^Backup is (\d+) days old$/.exec(warning);
  if (match) return t('backup.restore.riskWarnings.oldBackup', { days: Number(match[1]) });
  match = /^Version mismatch: backup from (v\S+), current (v\S+)$/.exec(warning);
  if (match) return t('backup.restore.riskWarnings.versionMismatch', { backup: match[1], current: match[2] });
  match = /^Database contains (\d+) existing events that will be overwritten$/.exec(warning);
  if (match) return t('backup.restore.riskWarnings.overwriteProjects', { count: Number(match[1]) });
  match = /^There are (\d+) active admin users$/.exec(warning);
  if (match) return t('backup.restore.riskWarnings.activeAdmins', { count: Number(match[1]) });
  return warning;
}
