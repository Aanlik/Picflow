import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../config/api', () => ({ api: { get, post: vi.fn() } }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { LocalUsersPage } from '../LocalUsersPage';

describe('local user page accessibility names', () => {
  it('exposes named tabs and labeled account controls', async () => {
    get.mockResolvedValue({ data: { users: [], roles: [{ id: 1, name: 'admin', display_name: 'Admin' }] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LocalUsersPage /></QueryClientProvider>);

    expect(await screen.findByRole('tab', { name: 'localUsers.accountsTab' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'localUsers.rolesTab' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'localUsers.username' })).toBeInTheDocument();
    expect(screen.getByLabelText('localUsers.initialPassword')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'localUsers.role' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'localUsers.createButton' })).toBeInTheDocument();
  });
});
