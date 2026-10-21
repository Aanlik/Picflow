import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminDashboard } from '../AdminDashboard';

vi.mock('../DashboardNotificationsCard', () => ({ DashboardNotificationsCard: () => <div>RECENT_SYSTEM_NOTIFICATIONS</div> }));
vi.mock('../DashboardWorkflowProgressCard', () => ({ DashboardWorkflowProgressCard: () => <div>OVERALL_PROJECT_PROGRESS</div> }));
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../contexts/PermissionsContext', () => ({ usePermissions: () => ({ isSuperAdmin: false, hasPermission: () => false }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('admin dashboard', () => {
  it('shows overall project progress and the notification module on the home dashboard', () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

    expect(screen.getByText('OVERALL_PROJECT_PROGRESS')).toBeTruthy();
    expect(screen.getByText('RECENT_SYSTEM_NOTIFICATIONS')).toBeTruthy();
    expect(screen.queryByText('admin.eventsExpiringSoon')).toBeNull();
    expect(screen.queryByText('events.createEvent')).toBeNull();
  });
});
