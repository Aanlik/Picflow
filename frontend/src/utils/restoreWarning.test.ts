import { expect, it, vi } from 'vitest';
import { restoreWarning } from './restoreWarning';
it.each([
 ['Backup is 45 days old', 'oldBackup', { days: 45 }],
 ['Version mismatch: backup from v1.0.8, current v1.0.9', 'versionMismatch', { backup: 'v1.0.8', current: 'v1.0.9' }],
 ['Database contains 10 existing events that will be overwritten', 'overwriteProjects', { count: 10 }],
 ['There are 3 active admin users', 'activeAdmins', { count: 3 }],
])('localizes %s without losing risk details', (input, key, values) => {
 const t = vi.fn(() => 'localized');
 expect(restoreWarning(input, t)).toBe('localized');
 expect(t).toHaveBeenCalledWith(`backup.restore.riskWarnings.${key}`, values);
});
it('preserves unknown warnings rather than hiding a restore risk', () => {
 expect(restoreWarning('Unexpected backup warning', () => '')).toBe('Unexpected backup warning');
});
