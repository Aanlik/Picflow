import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackupDashboard } from '../BackupDashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../../hooks/useLocalizedDate', () => ({
  useLocalizedDate: () => ({
    format: () => '2026-10-14',
    formatTime: () => '10:00',
    formatDateTime: () => '2026-10-14 10:00',
    formatDistanceToNow: () => 'just now',
  }),
}));

describe('BackupDashboard reports only recorded backup coverage', () => {
  it('shows an unconfigured warning and does not invent zero coverage', () => {
    render(
      <BackupDashboard
        status={{ totalBackups: 0, recentBackups: [] }}
        config={{ backup_enabled: false }}
        onRunBackup={vi.fn()}
        isBackupRunning={false}
      />,
    );

    expect(screen.getByText('backup.dashboard.healthMessages.notConfigured')).toBeInTheDocument();
    expect(screen.queryByText('backup.dashboard.healthMessages.noBackups')).toBeNull();
    expect(screen.getAllByText('backup.dashboard.coverage.notRecorded')).toHaveLength(3);
    expect(screen.queryByText(/common\.of/)).toBeNull();
  });

  it('keeps a configured backup with no successful run in the critical state', () => {
    render(
      <BackupDashboard
        status={{ totalBackups: 0, recentBackups: [] }}
        config={{ backup_enabled: true, backup_destination_type: 'local' }}
        onRunBackup={vi.fn()}
        isBackupRunning={false}
      />,
    );

    expect(screen.getByText('backup.dashboard.healthMessages.noBackups')).toBeInTheDocument();
  });
});
