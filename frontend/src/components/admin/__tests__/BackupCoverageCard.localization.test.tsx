import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { getBackupCoverage } = vi.hoisted(() => ({ getBackupCoverage: vi.fn() }));

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string, fallback?: unknown) => {
      const localized: Record<string, string> = {
        'backup.coverage.paths.flags.backup_include_archived': '包含已归档项目',
        'backup.coverage.paths.flags.enabled': '已启用',
        'backup.coverage.paths.flags.none': '无',
        'backup.coverage.paths.labels.archivedEvents': '已归档项目照片',
      };
      if (localized[key]) return localized[key];
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
        return String((fallback as { defaultValue: unknown }).defaultValue);
      }
      return typeof fallback === 'string' ? fallback : key;
    },
  }),
}));
vi.mock('../../../hooks/useLocalizedDate', () => ({
  useLocalizedDate: () => ({ formatDateTime: () => '2026-10-13 10:00' }),
}));
vi.mock('../../../services/admin.service', () => ({
  adminService: { getBackupCoverage },
}));

import { BackupCoverageCard } from '../BackupCoverageCard';

describe('BackupCoverageCard localization', () => {
  it('shows localized path descriptions and feature state instead of raw backend text and keys', async () => {
    getBackupCoverage.mockResolvedValue({
      generatedAt: '2026-10-13T02:00:00.000Z',
      database: {
        mode: 'inline', inlineDumpExplicitlyDisabled: false, lastDumpAt: null,
        lastDumpType: null, lastDumpSizeBytes: 0, lastDumpFilePath: null,
        lastDumpAgeMs: null, lastDumpStale: null, ok: true,
      },
      paths: [{
        path: 'events/archived', includeInDefault: true,
        featureFlag: 'backup_include_archived', featureFlagValue: true,
        displayOrder: 20,
        description: 'Archived gallery photo originals (gated by backup_include_archived)',
        existsOnDisk: true, coverage: 'will-scan',
      }],
      drift: { unconfiguredOnDisk: [], expectedNonBackupDirs: [] },
      summary: {
        configuredCount: 1, willScanCount: 1, skippedByToggleCount: 0,
        skippedByFeatureFlagCount: 0, skippedBySettingCount: 0, missingOnDiskCount: 0,
        driftCount: 0, tableMissingFallbackInUse: false, databaseOk: true, overallOk: true,
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><BackupCoverageCard /></QueryClientProvider>);

    expect(await screen.findByText('已归档项目照片')).toBeInTheDocument();
    expect(screen.getByText('包含已归档项目：已启用')).toBeInTheDocument();
    expect(screen.queryByText(/Archived gallery photo originals/)).not.toBeInTheDocument();
    expect(screen.queryByText('backup_include_archived = true')).not.toBeInTheDocument();
  });
});
