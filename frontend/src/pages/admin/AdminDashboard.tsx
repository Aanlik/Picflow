import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/common';
import { DashboardNotificationsCard } from './DashboardNotificationsCard';
import { DashboardWorkflowProgressCard } from './DashboardWorkflowProgressCard';

export const AdminDashboard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('navigation.dashboard')}</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">{t('admin.dashboardSubtitle')}</p>
        </div>
        <Button variant="primary" leftIcon={<Plus className="w-5 h-5" />} onClick={() => navigate('/admin/events/new')}>
          {t('events.createEvent')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DashboardWorkflowProgressCard />
        <DashboardNotificationsCard />
      </div>
    </div>
  );
};

AdminDashboard.displayName = 'AdminDashboard';
