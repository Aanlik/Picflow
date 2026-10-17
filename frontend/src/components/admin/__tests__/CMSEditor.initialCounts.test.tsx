import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string, options?: { count?: number }) =>
        (fallback || key).replace('{{count}}', String(options?.count ?? 0)),
    }),
  };
});

import { CMSEditor } from '../CMSEditor';

describe('CMSEditor initial content counts', () => {
  it('refreshes word and character counts when CMS content loads after the editor mounts', async () => {
    const { rerender } = render(
      <CMSEditor content="" onChange={vi.fn()} onSave={vi.fn()} isSaving={false} />,
    );

    await waitFor(() => expect(screen.getByText('0 words')).toBeTruthy());
    rerender(
      <CMSEditor content="<p>hello world</p>" onChange={vi.fn()} onSave={vi.fn()} isSaving={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('2 words')).toBeTruthy();
      expect(screen.getByText('11 characters')).toBeTruthy();
    });
  });
});
