import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string | Record<string, unknown>) => typeof fallback === 'string' ? fallback : key }) }));
vi.mock('../../../config/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../common', () => ({
  Button: ({ children, onClick, isLoading, leftIcon }: React.PropsWithChildren<{ onClick: () => void; isLoading?: boolean; leftIcon?: React.ReactNode }>) => (
    <button type="button" onClick={onClick} disabled={isLoading}>{leftIcon}{children}</button>
  ),
  Card: ({ children }: React.PropsWithChildren) => <section>{children}</section>,
}));

import { api } from '../../../config/api';
import { getGitHubUpdateDiagnostic, GitHubUpdateCard } from '../GitHubUpdateCard';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><GitHubUpdateCard /></QueryClientProvider>);
}

describe('GitHubUpdateCard', () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it('checks only after a manual click and shows the published release', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {
      status: 'update_available', currentVersion: '1.0', latestVersion: 'v1.1',
      repositoryUrl: 'https://github.com/Aanlik/Picflow',
      releaseUrl: 'https://github.com/Aanlik/Picflow/releases/tag/v1.1',
      releaseNotes: '修复更新检查', checkedAt: '2026-10-12T00:00:00.000Z',
    } } as never);
    setup();

    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText(/发现新版本/)).toBeInTheDocument());
    expect(screen.getByText('修复更新检查')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/system/updates');
  });

  it('shows no-release state without claiming the installation is current', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {
      status: 'no_release', currentVersion: '1.0', latestVersion: null,
      repositoryUrl: 'https://github.com/Aanlik/Picflow',
      releaseUrl: 'https://github.com/Aanlik/Picflow/releases',
      checkedAt: '2026-10-12T00:00:00.000Z',
    } } as never);
    setup();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText(/尚未发布版本/)).toBeInTheDocument());
    expect(screen.queryByText(/当前已是最新版本/)).not.toBeInTheDocument();
  });

  it('maps safe GitHub diagnostics without exposing raw connection errors', () => {
    expect(getGitHubUpdateDiagnostic({ response: { data: { code: 'GITHUB_DNS_ERROR', error: 'ENOTFOUND api.github.com' } } }))
      .toEqual({ key: 'settings.systemStatus.dnsError' });
    expect(getGitHubUpdateDiagnostic({ response: { data: { code: 'GITHUB_HTTP_ERROR', upstream_status: 429 } } }))
      .toEqual({ key: 'settings.systemStatus.httpError', values: { status: '429' } });
    expect(getGitHubUpdateDiagnostic(new Error('ENOTFOUND api.github.com')))
      .toEqual({ key: 'settings.systemStatus.checkFailed' });
  });
});
