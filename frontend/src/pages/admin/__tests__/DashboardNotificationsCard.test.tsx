import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../i18n/locales/en.json';
import zh from '../../../i18n/locales/zh-CN.json';
import { DashboardNotificationsCard } from '../DashboardNotificationsCard';

vi.mock('../../../hooks/useAdminNotifications', () => ({
  useAdminNotifications: () => ({
    data: { unreadCount: '6', notifications: [] },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../hooks/useLocalizedDate', () => ({
  useLocalizedDate: () => ({ format: vi.fn() }),
}));

describe('DashboardNotificationsCard', () => {
  let i18n: ReturnType<typeof createInstance>;

  beforeEach(async () => {
    i18n = createInstance();
    await i18n.init({
      lng: 'zh-CN',
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'zh-CN': { translation: zh } },
    });
  });

  it('converts database count strings before selecting the translated plural', () => {
    render(<I18nextProvider i18n={i18n}><DashboardNotificationsCard /></I18nextProvider>);

    expect(screen.getByText('6 条未读')).toBeInTheDocument();
    expect(screen.queryByText('admin.unreadNotifications')).not.toBeInTheDocument();
  });
});
