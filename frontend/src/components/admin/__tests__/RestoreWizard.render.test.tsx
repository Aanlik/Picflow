import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
}));
vi.mock('../../../hooks/useLocalizedDate', () => ({
  useLocalizedDate: () => ({ format: () => '', formatTime: () => '', formatDateTime: () => '' }),
}));
vi.mock('../PicpeakBackupCard', () => ({ PicpeakRestoreCard: () => null }));

import { RestoreWizard } from '../RestoreWizard';

describe('RestoreWizard initial step', () => {
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
});
