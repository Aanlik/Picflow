import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../config/api', () => ({ api: { get, patch: vi.fn() } }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, string>, maybeOptions?: Record<string, string>) => {
      const options = maybeOptions ?? (typeof fallbackOrOptions === 'object' ? fallbackOrOptions : undefined);
      if (key === 'settings.downloads.inheritWith') return `Inherit (${options?.value})`;
      if (key === 'common.on') return 'On';
      if (key === 'common.off') return 'Off';
      if (key === 'settings.downloads.pickerOn') return 'Guests may choose another size';
      return key;
    },
  }),
}));

import { DownloadResolutionCard } from '../DownloadResolutionCard';

describe('DownloadResolutionCard SQLite booleans', () => {
  it('treats SQLite "0" settings as disabled in both the inherit option and effective summary', async () => {
    get.mockResolvedValueOnce({
      data: {
        overrides: {
          download_standard_resolution: null,
          download_resolution_picker_enabled: null,
          download_allow_original: null,
        },
        globals: {
          standard_resolution: 'original',
          picker_enabled: '0',
          allow_original: '0',
          resolutions: [],
        },
        effective: {
          standard: 'original',
          picker_enabled: '0',
          allow_original: '0',
          choices: [],
        },
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><DownloadResolutionCard eventId={3} /></QueryClientProvider>);

    await screen.findByText('settings.downloads.effective');
    const picker = container.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(picker.value).toBe('__inherit__');
    expect(screen.getAllByRole('option', { name: 'Inherit (Off)' })).toHaveLength(2);
    expect(container.querySelectorAll('select')[2]).toHaveValue('__inherit__');
    expect(screen.queryByText('Guests may choose another size')).not.toBeInTheDocument();
  });
});
