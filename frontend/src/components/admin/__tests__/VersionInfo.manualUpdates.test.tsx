import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }),
}));

vi.mock('../../../config/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { backend: '1.0.2', frontend: '1.0.2', build: '1.0.2', node: 'v22', environment: 'production' } }) },
}));

import { api } from '../../../config/api';
import { VersionInfo } from '../VersionInfo';

describe('VersionInfo manual update policy', () => {
  it('shows installed versions without querying upstream update availability', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><VersionInfo /></QueryClientProvider>);

    await waitFor(() => expect(screen.getAllByText((_, element) => element?.textContent === 'Picflow v1.0.2').length).toBeGreaterThan(0));

    expect(api.get).toHaveBeenCalledWith('/admin/system/version');
    expect(api.get).not.toHaveBeenCalledWith('/admin/system/updates');
    expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
  });
});
