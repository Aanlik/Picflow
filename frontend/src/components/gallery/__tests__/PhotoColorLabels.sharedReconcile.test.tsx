/**
 * The colour swatch reconciling with the server's answer (#1197).
 *
 * In the per-guest modes the optimistic toggle is always right — only the
 * guest can move their own label. The shared tag belongs to the photo, so
 * another guest can change it between this viewer's last read and their click,
 * and the optimistic branch ("same colour, so clear it") can then disagree
 * with what the server actually did. The response says which happened, so the
 * component follows it rather than its guess.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

import { PhotoColorLabels } from '../PhotoColorLabels';

const submitFeedback = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
      i18n: { language: 'en' }
    })
  };
});

vi.mock('../../../services/feedback.service', async () => {
  const actual = await vi.importActual<any>('../../../services/feedback.service');
  return {
    ...actual,
    feedbackService: { submitFeedback: (...args: any[]) => submitFeedback(...args) }
  };
});

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
  toast: { error: vi.fn(), success: vi.fn() }
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const renderLabels = (myColorLabel: string | null) => {
  const onColorLabelChange = vi.fn();
  render(
    <PhotoColorLabels
      gallerySlug="g"
      photoId="1"
      isEnabled
      myColorLabel={myColorLabel as any}
      onColorLabelChange={onColorLabelChange}
    />,
    { wrapper }
  );
  return { onColorLabelChange };
};

const clickGreen = async () => {
  const green = screen.getAllByRole('button').find((b) => /green/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || ''));
  expect(green).toBeTruthy();
  await userEvent.click(green!);
};

describe('shared colour tag reconciliation', () => {
  beforeEach(() => submitFeedback.mockReset());

  it('keeps green available as a normal color label', () => {
    renderLabels('green');

    expect(screen.getByTitle('green')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('shows Lightroom label number 10 beside the purple swatch without implying a shortcut', () => {
    renderLabels('purple');

    const purpleButton = screen.getByTitle('purple');
    expect(purpleButton).toHaveAttribute('aria-pressed', 'true');
    expect(within(purpleButton).getByText('10')).toBeInTheDocument();
    expect(purpleButton.querySelector('span')).toHaveStyle({ backgroundColor: 'rgb(155, 89, 208)' });
    expect(screen.getByRole('group')).toHaveClass('flex-wrap');
  });

  it('keeps the colour when the server says it was set, not cleared', async () => {
    // The viewer's screen still says green; the tag had already moved on, so
    // the server treats this click as a set rather than a toggle-off.
    submitFeedback.mockResolvedValue({ success: true, updated: true });
    const { onColorLabelChange } = renderLabels('green');

    await clickGreen();

    await waitFor(() => {
      // The optimistic call blanked it; the server's answer puts it back.
      expect(onColorLabelChange).toHaveBeenLastCalledWith('green');
    });
  });

  it('clears the colour when the server says it removed the tag', async () => {
    submitFeedback.mockResolvedValue({ success: true, removed: true });
    const { onColorLabelChange } = renderLabels('green');

    await clickGreen();

    await waitFor(() => {
      expect(onColorLabelChange).toHaveBeenLastCalledWith(null);
    });
  });
});
