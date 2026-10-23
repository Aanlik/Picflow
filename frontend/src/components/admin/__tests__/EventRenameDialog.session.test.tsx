import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventRenameDialog } from '../EventRenameDialog';
const translate = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: translate }) }));
afterEach(cleanup);
it('does not reset the dialog session when the parent refreshes its event name', () => {
  const props = { isOpen: true, eventName: 'Before', eventId: 1, onClose: vi.fn(), onRename: vi.fn(), onValidate: vi.fn() };
  const { rerender } = render(<EventRenameDialog {...props} />);
  expect(screen.getByDisplayValue('Before')).toBeTruthy();
  rerender(<EventRenameDialog {...props} eventName="After" />);
  expect(screen.getByDisplayValue('Before')).toBeTruthy();
  rerender(<EventRenameDialog {...props} isOpen={false} eventName="After" />);
  rerender(<EventRenameDialog {...props} eventName="After" />);
  expect(screen.getByDisplayValue('After')).toBeTruthy();
});

it('keeps the completion screen after the renamed project is refetched', async () => {
  const props = { isOpen: true, eventName: 'Before', eventId: 1, onClose: vi.fn(),
    onRename: vi.fn().mockResolvedValue({ success: true, data: { newSlug: 'after', newShareLink: '/gallery/after', filesRenamed: 0 } }),
    onValidate: vi.fn().mockResolvedValue({ valid: true, newSlug: 'after' }) };
  const { rerender } = render(<EventRenameDialog {...props} />);
  fireEvent.change(screen.getByDisplayValue('Before'), { target: { value: 'After' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'events.rename.confirm' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'events.rename.confirm' }));
  expect(await screen.findByRole('button', { name: 'common.done' })).toBeInTheDocument();
  rerender(<EventRenameDialog {...props} eventName="After" />);
  expect(screen.getByRole('button', { name: 'common.done' })).toBeInTheDocument();
});
