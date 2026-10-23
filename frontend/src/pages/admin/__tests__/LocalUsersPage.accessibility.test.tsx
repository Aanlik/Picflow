import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { get, access } = vi.hoisted(() => ({ get: vi.fn(), access: { isSuperAdmin: true, hasPermission: () => true } }));
vi.mock('../../../contexts/PermissionsContext', () => ({ usePermissions: () => access }));
vi.mock('../../../components/admin/RoleManagementTab', () => ({ RoleManagementTab: () => <div>role-management-ready</div> }));

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

  it('does not expose account forms when the accounts route is forbidden', async () => {
    get.mockRejectedValueOnce({ response: { status: 403 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LocalUsersPage /></QueryClientProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('localUsers.loadError');
    expect(screen.queryByRole('textbox', { name: 'localUsers.username' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'localUsers.createButton' })).not.toBeInTheDocument();
  });
});

it('opens independent role management without requesting super-admin accounts', () => {
  get.mockClear();
  access.isSuperAdmin = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LocalUsersPage /></QueryClientProvider>);
  expect(screen.getByText('role-management-ready')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: 'localUsers.username' })).toBeNull();
  access.isSuperAdmin = true;
});
