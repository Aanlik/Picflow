import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockQueryState = vi.hoisted(() => ({ backups: undefined as any, validationResult: undefined as any }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => ({
    data: options.queryKey?.[0] === 'available-backups' ? mockQueryState.backups : undefined,
    isLoading: false,
  }),
  useMutation: (options: any) => ({
    mutate: () => options.onSuccess?.(mockQueryState.validationResult),
    isLoading: false,
  }),
}));
vi.mock('../../../hooks/useLocalizedDate', () => ({
  useLocalizedDate: () => ({ format: () => '', formatTime: () => '', formatDateTime: (value: string) => value === 'invalid' ? '' : '2026-10-20 00:13' }),
}));
vi.mock('../PicpeakBackupCard', () => ({ PicpeakRestoreCard: () => null }));

import { RestoreWizard } from '../RestoreWizard';

describe('RestoreWizard initial step', () => {
  it('shows an unambiguous localized restore-point date and file count when selecting a backup', () => {
    mockQueryState.backups = [{
      id: null,
      type: 'local',
      path: '/backups/manifests/backup-manifest-abc.json',
      manifest_path: '/backups/manifests/backup-manifest-abc.json',
      created_at: '2026-10-20T00:13:00.000Z',
      backup_type: 'full',
      total_size: 4_659_023_626,
      filesCount: 899,
      database_included: true,
      status: 'completed',
    }];
    render(<RestoreWizard />);

    fireEvent.click(screen.getByText('backup.restore.source.local.name'));
    fireEvent.click(screen.getByRole('button', { name: 'backup.restore.actions.next' }));

    expect(screen.getByText('2026-10-20 00:13')).toBeInTheDocument();
    expect(screen.getByText(/backup\.restore\.backup\.fileCount/)).toBeInTheDocument();
  });

  it('uses the unavailable-date label instead of leaving an invalid restore timestamp blank', () => {
    mockQueryState.backups = [{
      id: null,
      type: 'local',
      path: '/backups/manifests/backup-manifest-invalid.json',
      manifest_path: '/backups/manifests/backup-manifest-invalid.json',
      created_at: 'invalid',
      backup_type: 'full',
      total_size: 1024,
      filesCount: null,
      status: 'completed',
    }];
    render(<RestoreWizard />);

    fireEvent.click(screen.getByText('backup.restore.source.local.name'));
    fireEvent.click(screen.getByRole('button', { name: 'backup.restore.actions.next' }));

    expect(screen.getByText('backup.restore.backup.unknownDate')).toBeInTheDocument();
    expect(document.body.textContent).toContain('backup.restore.backup.fileCountUnknown');
  });

  it('localizes restore preflight failures without displaying NAS paths', () => {
    mockQueryState.backups = [{
      id: 7,
      type: 'local',
      path: '/backups/manifests/backup-manifest-abc.json',
      manifest_path: '/backups/manifests/backup-manifest-abc.json',
      created_at: '2026-10-20T00:13:00.000Z',
      backup_type: 'full',
      total_size: 1024,
      filesCount: 1,
      database_included: true,
      status: 'completed',
    }];
    mockQueryState.validationResult = {
      validation: {
        isValid: false,
        errorCode: 'BACKUP_DATA_MISSING',
        errors: ['ENOENT: no such file or directory, open /vol1/private/backup.sql'],
      },
      spaceCheck: null,
    };
    render(<RestoreWizard />);

    fireEvent.click(screen.getByText('backup.restore.source.local.name'));
    fireEvent.click(screen.getByRole('button', { name: 'backup.restore.actions.next' }));
    fireEvent.click(screen.getByText('2026-10-20 00:13'));
    fireEvent.click(screen.getByRole('button', { name: 'backup.restore.actions.next' }));
    fireEvent.click(screen.getByRole('button', { name: 'backup.restore.actions.next' }));

    expect(screen.getByText('backup.restore.errors.dataMissing')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('/vol1/private/backup.sql');
  });

  it('renders all supported restore source options', () => {
    render(<RestoreWizard />);

    expect(screen.getByText('backup.restore.source.local.name')).toBeInTheDocument();
    expect(screen.getByText('backup.restore.source.s3.name')).toBeInTheDocument();
    expect(screen.getByText('backup.restore.source.upload.name')).toBeInTheDocument();
  });

  it('routes uploaded portable backups through the dedicated restore flow', () => {
    render(<RestoreWizard />);
    fireEvent.click(screen.getByText('backup.restore.source.upload.name'));

    expect(screen.getByText('backup.restore.source.upload.directRestore')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backup\.restore\.actions\.next/i })).toBeDisabled();
  });

  afterEach(() => {
    mockQueryState.backups = undefined;
    mockQueryState.validationResult = undefined;
  });
});
