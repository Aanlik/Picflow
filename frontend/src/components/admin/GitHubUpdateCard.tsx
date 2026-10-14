import React from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../config/api';
import { Button, Card } from '../common';

type UpdateCheck = {
  status: 'no_release' | 'update_available' | 'up_to_date' | 'current_ahead' | 'rate_limited';
  currentVersion: string;
  latestVersion: string | null;
  repositoryUrl: string;
  releaseUrl: string;
  releaseName?: string;
  releaseNotes?: string;
  checkedAt: string;
};

async function checkUpdates(): Promise<UpdateCheck> {
  const response = await api.get<UpdateCheck>('/admin/system/updates');
  return response.data;
}

export function getGitHubUpdateDiagnostic(error: unknown): { key: string; values?: { status: string } } {
  const data = (error as any)?.response?.data;
  switch (data?.code) {
    case 'GITHUB_CONFIG_ERROR': return { key: 'settings.systemStatus.configError' };
    case 'GITHUB_TIMEOUT_ERROR': return { key: 'settings.systemStatus.timeoutError' };
    case 'GITHUB_DNS_ERROR': return { key: 'settings.systemStatus.dnsError' };
    case 'GITHUB_TLS_ERROR': return { key: 'settings.systemStatus.tlsError' };
    case 'GITHUB_HTTP_ERROR': return { key: 'settings.systemStatus.httpError', values: { status: String(data.upstream_status || '?') } };
    case 'GITHUB_NETWORK_ERROR': return { key: 'settings.systemStatus.networkError' };
    default: return { key: 'settings.systemStatus.checkFailed' };
  }
}

export const GitHubUpdateCard: React.FC = () => {
  const { t } = useTranslation();
  const mutation = useMutation({ mutationFn: checkUpdates });
  const result = mutation.data;
  const updateError = getGitHubUpdateDiagnostic(mutation.error);
  const updateErrorMessage = updateError.values
    ? t(updateError.key, updateError.values)
    : updateError.key === 'settings.systemStatus.checkFailed'
      ? t(updateError.key, '连接 GitHub 失败，请稍后重试。')
      : t(updateError.key);
  const statusText = result?.status === 'update_available'
    ? t('settings.systemStatus.updateAvailable', '发现新版本')
    : result?.status === 'up_to_date'
      ? t('settings.systemStatus.upToDate', '当前已是最新版本')
      : result?.status === 'current_ahead'
        ? t('settings.systemStatus.currentAhead', '当前构建版本高于最新正式发布版本。')
      : result?.status === 'no_release'
        ? t('settings.systemStatus.noRelease', 'GitHub 仓库尚未发布版本')
        : result?.status === 'rate_limited'
          ? t('settings.systemStatus.rateLimited', 'GitHub 公共接口请求次数已达上限，请稍后再试。')
        : null;

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {t('settings.systemStatus.updateCheckerTitle', '检查 Picflow 更新')}
          </h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {t('settings.systemStatus.updateCheckerDescription', '手动检查 GitHub 上的正式版本；不会自动下载或安装。')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => mutation.mutate()}
          isLoading={mutation.isPending}
          leftIcon={<RefreshCw className="h-4 w-4" />}
        >
          {mutation.isPending
            ? t('settings.systemStatus.checkingForUpdates', '正在检查…')
            : t('settings.systemStatus.checkForUpdates', '检查更新')}
        </Button>
      </div>

      {result && (
        <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-800">
          <p className="font-medium text-neutral-900 dark:text-neutral-100">
            {statusText} · {t('settings.systemStatus.currentVersion', '当前版本')} {result.currentVersion}
            {result.latestVersion && ` · ${t('settings.systemStatus.latestVersion', '最新版本')} ${result.latestVersion}`}
          </p>
          {result.releaseNotes && result.status === 'update_available' && (
            <div className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
              {result.releaseNotes}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
            <a className="inline-flex items-center gap-1 text-primary-700 hover:underline dark:text-primary-300" href={result.releaseUrl} target="_blank" rel="noreferrer">
              {t('settings.systemStatus.viewRelease', '查看版本发布页')} <ExternalLink className="h-3 w-3" />
            </a>
            <a className="inline-flex items-center gap-1 text-primary-700 hover:underline dark:text-primary-300" href={result.repositoryUrl} target="_blank" rel="noreferrer">
              {t('settings.systemStatus.viewRepository', '打开 GitHub 仓库')} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
      {mutation.isError && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {updateErrorMessage}
        </p>
      )}
    </Card>
  );
};
