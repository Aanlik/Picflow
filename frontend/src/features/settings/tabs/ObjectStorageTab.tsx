import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, Save, ShieldCheck, UploadCloud } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../config/api';
import { Button, Card, Loading } from '../../../components/common';
import { useMutationWithToast } from '../../../hooks';
import { usePermissions } from '../../../contexts/PermissionsContext';

type Config = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  galleryUploadConcurrency: number;
  backgroundUploadLimitKiB: number;
  accessKeyMasked: string;
  hasSecret: boolean;
  configured: boolean;
  defaultCloudSyncEnabled: boolean;
  defaultCloudThumbnailSyncEnabled: boolean;
  defaultCloudPreviewSyncEnabled: boolean;
  defaultForceCloudDownloads: boolean;
};

type FormState = Omit<Config, 'accessKeyMasked' | 'hasSecret' | 'configured'> & {
  accessKeyId: string;
  secretAccessKey: string;
};

function objectStorageErrorText(error: unknown, fallback: string, t: (key: string, defaultValue: string) => string) {
  const response = error as { response?: { data?: { error?: string; code?: string } } };
  const code = response.response?.data?.code;
  if (code === 'S3_TLS_CERTIFICATE_MISMATCH') {
    return t('settings.objectStorage.errors.certificateMismatch', '对象存储证书域名与 Endpoint 不匹配。请检查 Endpoint 主机名和存储桶地域。');
  }
  if (code === 'S3_TLS_CERTIFICATE_INVALID') {
    return t('settings.objectStorage.errors.certificateInvalid', '对象存储 TLS 证书校验失败。请检查证书有效期、证书链和 Endpoint。');
  }
  const message = response.response?.data?.error;
  if (typeof message !== 'string' || !message.trim()) return fallback;
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact;
}

const emptyForm: FormState = {
  enabled: false,
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  prefix: '',
  forcePathStyle: false,
  galleryUploadConcurrency: 4,
  backgroundUploadLimitKiB: 0,
  defaultCloudSyncEnabled: false,
  defaultCloudThumbnailSyncEnabled: false,
  defaultCloudPreviewSyncEnabled: false,
  defaultForceCloudDownloads: false,
  accessKeyId: '',
  secretAccessKey: '',
};

function toForm(config?: Config): FormState {
  return config ? {
    enabled: config.enabled,
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: config.prefix,
    forcePathStyle: config.forcePathStyle,
    galleryUploadConcurrency: config.galleryUploadConcurrency ?? 4,
    backgroundUploadLimitKiB: config.backgroundUploadLimitKiB ?? 0,
    defaultCloudSyncEnabled: config.defaultCloudSyncEnabled === true,
    defaultCloudThumbnailSyncEnabled: config.defaultCloudThumbnailSyncEnabled === true,
    defaultCloudPreviewSyncEnabled: config.defaultCloudPreviewSyncEnabled === true,
    defaultForceCloudDownloads: config.defaultForceCloudDownloads === true,
    accessKeyId: '',
    secretAccessKey: '',
  } : emptyForm;
}

export const ObjectStorageTab: React.FC = () => {
  const { t } = useTranslation();
  const { hasAnyPermission } = usePermissions();
  const canEdit = hasAnyPermission(['settings.edit', 'backup.create']);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [actionError, setActionError] = useState('');
  const [testSuccess, setTestSuccess] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<Config>({
    queryKey: ['object-storage-config'],
    queryFn: async () => (await api.get('/admin/object-storage')).data,
  });

  useEffect(() => {
    if (!data) return;
    setForm(toForm(data));
    setHasStoredSecret(data.hasSecret);
  }, [data]);

  const saveMutation = useMutationWithToast({
    mutationFn: async () => {
      const payload = { ...form } as Record<string, unknown>;
      if (!form.accessKeyId) delete payload.accessKeyId;
      if (!form.secretAccessKey) delete payload.secretAccessKey;
      return (await api.put('/admin/object-storage', payload)).data;
    },
    successMessage: t('settings.objectStorage.saved', '对象存储配置已保存'),
    errorMessage: (error: unknown) => objectStorageErrorText(error, t('settings.objectStorage.saveFailed', '保存失败，请检查配置后重试'), t),
    invalidateKeys: [['object-storage-config'], ['object-storage-create-defaults']],
    onMutate: () => { setActionError(''); setTestSuccess(false); },
  });

  const testMutation = useMutationWithToast({
    mutationFn: async () => {
      const payload = { ...form } as Record<string, unknown>;
      if (!form.accessKeyId) delete payload.accessKeyId;
      if (!form.secretAccessKey) delete payload.secretAccessKey;
      return (await api.post('/admin/object-storage/test', payload)).data;
    },
    successMessage: t('settings.objectStorage.testPassed', '连接、写入和清理测试均已通过'),
    errorMessage: (error: unknown) => objectStorageErrorText(error, t('settings.objectStorage.testFailed', '连接测试失败'), t),
    onMutate: () => { setActionError(''); setTestSuccess(false); },
    onSuccess: () => setTestSuccess(true),
  });

  const change = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setActionError('');
    setTestSuccess(false);
  };

  const changeCloudDefault = (key: 'defaultCloudSyncEnabled' | 'defaultCloudThumbnailSyncEnabled' | 'defaultCloudPreviewSyncEnabled' | 'defaultForceCloudDownloads', value: boolean) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'defaultForceCloudDownloads' && value) next.defaultCloudSyncEnabled = true;
      if (key === 'defaultCloudSyncEnabled' && !value) next.defaultForceCloudDownloads = false;
      return next;
    });
    setActionError('');
    setTestSuccess(false);
  };

  if (isLoading) return <div className="p-6"><Loading /></div>;
  if (isError || !data) {
    return (
      <Card className="max-w-3xl p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{t('settings.objectStorage.loadFailed', '无法读取对象存储配置')}</h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{t('settings.objectStorage.loadHelp', '请重试；配置读取失败时不会显示或覆盖已保存的密钥。')}</p>
            <Button className="mt-4" variant="outline" onClick={() => void refetch()}>{t('common.retry', '重试')}</Button>
          </div>
        </div>
      </Card>
    );
  }

  const field = (label: string, key: keyof FormState, options: { type?: string; placeholder?: string; hint?: string } = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-800 dark:text-neutral-200">{label}</span>
      <input
        type={options.type || 'text'}
        value={String(form[key])}
        placeholder={options.placeholder}
        disabled={!canEdit || saveMutation.isPending}
        onChange={(event) => change(key, event.target.value as FormState[typeof key])}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:disabled:bg-neutral-800"
      />
      {options.hint && <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">{options.hint}</span>}
    </label>
  );

  return (
    <div className="max-w-4xl space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-lg bg-sky-50 p-2.5 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"><Cloud className="h-5 w-5" /></div>
          <div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('settings.objectStorage.destinationTitle', '云端照片存储目标')}</h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{t('settings.objectStorage.destinationHelp', '配置 AWS S3 或兼容对象存储。此目标用于项目精修成片同步与客户下载；不会更改当前 NAS/本地原图存储。')}</p>
          </div>
        </div>

        <div className="mb-5 flex items-start justify-between gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
          <div className="flex gap-3">
            <UploadCloud className="mt-0.5 h-5 w-5 text-neutral-500" />
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('settings.objectStorage.enabledLabel', '启用对象存储交付')}</p>
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{t('settings.objectStorage.enabledHelp', '关闭时保留配置和云端文件，但暂停新的同步与云端下载。开启“强制云端下载”的项目在重新启用前会暂停客户下载。')}</p>
            </div>
          </div>
          <input aria-label={t('settings.objectStorage.enabledLabel', '启用对象存储交付')} type="checkbox" checked={form.enabled} disabled={!canEdit} onChange={(event) => change('enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-primary-600" />
        </div>

        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700" aria-labelledby="object-storage-project-defaults">
          <div className="mb-3">
            <h4 id="object-storage-project-defaults" className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('settings.objectStorage.projectDefaultsTitle', '新建项目的对象存储默认值')}</h4>
            <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('settings.objectStorage.projectDefaultsHelp', '仅作为新建项目的初始值；现有项目不受影响。每个项目仍可单独调整。强制云端下载会同时开启精修成片自动同步。')}</p>
          </div>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {([
              ['defaultCloudSyncEnabled', 'settings.objectStorage.defaultCloudSyncLabel', '新项目默认精修成片自动同步', 'settings.objectStorage.defaultCloudSyncHelp', '开启后，精修成片会在后台同步到对象存储。'],
              ['defaultForceCloudDownloads', 'settings.objectStorage.defaultForceCloudLabel', '新项目默认强制精修成片下载走云端', 'objectDelivery.forceCloudHelp', '只约束已交付的精修成片；云端副本未就绪时暂停这类下载，不回退到 NAS。原片仍从 NAS 下载。'],
              ['defaultCloudThumbnailSyncEnabled', 'settings.objectStorage.defaultThumbnailLabel', '新项目默认同步缩略图到云端', 'objectDelivery.syncThumbnailsHelp', '同步图库缩略图与视频封面。'],
              ['defaultCloudPreviewSyncEnabled', 'settings.objectStorage.defaultPreviewLabel', '新项目默认同步预览图到云端', 'objectDelivery.syncPreviewsHelp', '同步图库预览图和项目封面，不上传原片。'],
            ] as const).map(([key, labelKey, labelFallback, helpKey, helpFallback]) => (
              <label key={key} className="flex items-start justify-between gap-4 py-3 first:pt-1 last:pb-1">
                <span className="flex gap-3">
                  <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  <span>
                    <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(labelKey, labelFallback)}</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t(helpKey, helpFallback)}</span>
                  </span>
                </span>
                <input
                  aria-label={t(labelKey, labelFallback)}
                  type="checkbox"
                  checked={form[key]}
                  disabled={!canEdit || saveMutation.isPending}
                  onChange={(event) => changeCloudDefault(key, event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary-600"
                />
              </label>
            ))}
          </div>
        </section>

        <label className="mt-5 block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-800 dark:text-neutral-200">{t('settings.objectStorage.galleryConcurrency', '图库图片上传并发数')}</span>
          <input type="number" min={1} max={8} step={1} value={form.galleryUploadConcurrency}
            disabled={!canEdit || saveMutation.isPending}
            onChange={(event) => change('galleryUploadConcurrency', Number(event.target.value))}
            className="w-28 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100" />
          <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">{t('settings.objectStorage.galleryConcurrencyHelp', '同时处理 1–8 张缩略图或预览图，默认 4；图片生成最多同时 2 项。')}</span>
        </label>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-800 dark:text-neutral-200">{t('settings.objectStorage.backgroundLimit', '后台同步速率上限（KiB/s）')}</span>
          <input type="number" min={0} max={1048576} step={1} value={form.backgroundUploadLimitKiB}
            disabled={!canEdit || saveMutation.isPending}
            onChange={(event) => change('backgroundUploadLimitKiB', Number(event.target.value))}
            className="w-36 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100" />
          <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">{t('settings.objectStorage.backgroundLimitHelp', '0 表示不限速；其他值须至少为 64。此上限由后台图库图片与精修成片同步共享，不限制客户临时下载。')}</span>
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field(t('settings.objectStorage.endpoint', 'Endpoint'), 'endpoint', { placeholder: 'https://cos.ap-guangzhou.myqcloud.com', hint: t('settings.objectStorage.endpointHelp', '腾讯云 COS 填 https://cos.<地域>.myqcloud.com；AWS S3 留空。') })}
          {field(t('settings.objectStorage.region', 'Region'), 'region', { placeholder: 'ap-guangzhou' })}
          {field(t('settings.objectStorage.bucket', 'Bucket'), 'bucket', { placeholder: 'examplebucket-1250000000' })}
          {field(t('settings.objectStorage.prefix', '对象前缀'), 'prefix', { placeholder: 'picpeak-delivery' })}
          {field(t('settings.objectStorage.accessKey', 'SecretId / Access Key ID'), 'accessKeyId', { placeholder: data.accessKeyMasked ? t('settings.objectStorage.keepAccessKey', '已配置，留空保持不变') : '' })}
          {field(t('settings.objectStorage.secretKey', 'SecretKey / Secret Access Key'), 'secretAccessKey', { type: 'password', placeholder: hasStoredSecret ? t('settings.objectStorage.keepSecret', '已加密保存，留空保持不变') : '' })}
        </div>
        <p className="mt-4 rounded-md bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          {t('settings.objectStorage.directDownloadCorsHelp', '客户云端下载、缩略图和预览图会由浏览器直接读取对象存储。请在存储桶 CORS 中允许客户站点域名、GET/HEAD 和 Range 请求，并暴露 ETag、Content-Range、Content-Length、Content-Type；对象存储 Endpoint 也必须能从客户设备访问。')}
        </p>

        <label className="mt-5 flex items-start gap-3 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900/60">
          <input type="checkbox" checked={form.forcePathStyle} disabled={!canEdit} onChange={(event) => change('forcePathStyle', event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary-600" />
          <span>
            <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('settings.objectStorage.pathStyle', '使用 Path-style 请求')}</span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">{t('settings.objectStorage.pathStyleHelp', '腾讯云 COS 新建桶必须使用 Virtual-hosted style，请保持关闭；只有 MinIO 等明确要求时才勾选。')}</span>
          </span>
        </label>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700 dark:text-emerald-400" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('settings.objectStorage.securityTitle', '密钥保护与连接检查')}</h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{t('settings.objectStorage.securityHelp', '密钥以 AES-256-GCM 加密后保存在数据库，读取时不返回明文。测试会在目标前缀写入并删除一个临时对象。')}</p>
            {hasStoredSecret && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{t('settings.objectStorage.secretSaved', 'Secret Access Key 已加密保存')}</p>}
          </div>
        </div>
        {testSuccess && <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />{t('settings.objectStorage.testPassed', '连接、写入和清理测试均已通过')}</div>}
        {actionError && <div role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-700 dark:text-red-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{actionError}</div>}
        {!canEdit && <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">{t('settings.objectStorage.readOnly', '当前账号只能查看配置；需要设置编辑或备份创建权限才能修改。')}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="outline" disabled={!canEdit || testMutation.isPending || saveMutation.isPending} isLoading={testMutation.isPending} onClick={() => { setActionError(''); testMutation.mutate(); }}>
            {t('settings.objectStorage.testConnection', '测试连接与写入')}
          </Button>
          <Button disabled={!canEdit || saveMutation.isPending || testMutation.isPending} isLoading={saveMutation.isPending} leftIcon={<Save className="h-4 w-4" />} onClick={() => { setActionError(''); saveMutation.mutate(); }}>
            {t('common.save', '保存配置')}
          </Button>
        </div>
      </Card>
    </div>
  );
};
