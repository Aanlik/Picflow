import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Clock3, Layers3, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../config/api';
import { Card } from '../../components/common';

type WorkflowProjectSummary = {
  event_id: number;
  name: string;
  stage: 'SELECTING' | 'EDITING' | 'DELIVERED' | 'ARCHIVED';
  connected: boolean;
  summary?: Record<string, number>;
};

type WorkflowSummaryResponse = {
  configured: boolean;
  projects: WorkflowProjectSummary[];
};

const STAGES = ['SELECTING', 'EDITING', 'DELIVERED', 'ARCHIVED'] as const;

export function DashboardWorkflowProgressCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-photography-workflow-summary'],
    queryFn: async () => (await api.get<WorkflowSummaryResponse>('/admin/photography-workflow/summary')).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const projects = data?.projects ?? [];
  const stageCounts = STAGES.map((stage) => ({
    stage,
    count: projects.filter((project) => project.stage === stage).length,
  }));

  return (
    <Card padding="md">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          <Layers3 className="h-5 w-5 text-accent" />
          {t('admin.dashboardProjectProgress')}
        </h2>
        {!isLoading && !isError && data?.configured && (
          <span className="text-xs text-neutral-500">{t('admin.dashboardLinkedProjects', { count: projects.length })}</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('admin.loadingDashboard')}
        </div>
      ) : isError || !data?.configured ? (
        <p role="status" className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t('admin.dashboardWorkflowUnavailable')}
        </p>
      ) : projects.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t('admin.dashboardNoLinkedProjects')}
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stageCounts.map(({ stage, count }) => (
              <div key={stage} className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">{t(`admin.dashboardWorkflowStages.${stage}`)}</span>
                <strong className="mt-1 block text-xl text-neutral-900 dark:text-neutral-100">{count}</strong>
              </div>
            ))}
          </div>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {projects.slice(0, 6).map((project) => {
              const summary = project.summary ?? {};
              const connected = Boolean(project.connected);
              return (
                <li key={project.event_id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 py-3 text-left first:pt-0 last:pb-0"
                    onClick={() => navigate(`/admin/events/${project.event_id}`)}
                  >
                    {connected
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label={t('admin.dashboardWorkflowConnected')} />
                      : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label={t('admin.dashboardWorkflowDisconnected')} />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{project.name}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                          {t(`admin.dashboardWorkflowStages.${project.stage}`)}
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                        <span>{t('admin.dashboardSelectedPhotos', { count: summary['客户已选'] || 0 })}</span>
                        <span>{t('admin.dashboardReadyPhotos', { count: summary['待精修'] || 0 })}</span>
                        <span>{t('admin.dashboardDeliveredPhotos', { count: summary['已同步'] || 0 })}</span>
                        {(summary['异常'] || 0) > 0 && <span className="text-red-600 dark:text-red-300">{t('admin.dashboardWorkflowErrors', { count: summary['异常'] })}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
