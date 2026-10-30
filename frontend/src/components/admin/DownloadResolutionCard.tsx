/**
 * <DownloadResolutionCard>
 *
 * Per-event override for the download-resolution settings (#858). The globals
 * live in Settings → Download resolutions; this card lets one gallery differ.
 *
 * Every field is tri-state — "Inherit" writes NULL and the gallery follows the
 * global, matching the show_watermark / show_qr convention. The card shows the
 * inherited value inline so an admin can see what "Inherit" currently means
 * without leaving the page.
 *
 * Reads GET /api/admin/events/:id/download-resolutions (which returns the raw
 * overrides, the globals, and the resolved effective policy) and saves through
 * PATCH on the same path.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { Card, Loading } from '../common';
import { api } from '../../config/api';
import type { DownloadResolutionChoice } from '../../types';
import { downloadResolutionLabel } from '../../utils/downloadResolutionLabel';
import { parseBooleanInput } from '../../utils/parsers';

const INHERIT = '__inherit__';
const ORIGINAL = 'original';

interface Payload {
  overrides: {
    download_standard_resolution: string | null;
    download_resolution_picker_enabled: boolean | null;
    download_allow_original: boolean | null;
  };
  globals: {
    standard_resolution: string;
    picker_enabled: boolean | number | string;
    allow_original: boolean | number | string;
    resolutions: DownloadResolutionChoice[];
  };
  effective: {
    standard: string;
    picker_enabled: boolean | number | string;
    allow_original: boolean | number | string;
    choices: DownloadResolutionChoice[];
  };
}

export interface DownloadResolutionCardProps {
  eventId: number;
  isEditing: boolean;
  onChanged?: () => void;
}

export interface DownloadResolutionEditorHandle {
  save: () => Promise<void>;
  isDirty: () => boolean;
  reset: () => void;
  isSaving: () => boolean;
}

interface Draft {
  standard: string;
  picker: string;
  allowOriginal: string;
}

/** null → "Inherit"; true/false → explicit. */
const triToSelect = (v: boolean | number | string | null | undefined) => {
  if (v === null || v === undefined || v === '') return INHERIT;
  if (v === true || v === 1 || v === '1' || v === 'true') return 'true';
  if (v === false || v === 0 || v === '0' || v === 'false') return 'false';
  return INHERIT;
};
const selectToTri = (v: string) => (v === INHERIT ? null : v === 'true');

export const DownloadResolutionCard = forwardRef<DownloadResolutionEditorHandle, DownloadResolutionCardProps>(
  ({ eventId, isEditing, onChanged }, ref) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>({ standard: INHERIT, picker: INHERIT, allowOriginal: INHERIT });
  const [saved, setSaved] = useState<Draft>({ standard: INHERIT, picker: INHERIT, allowOriginal: INHERIT });
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery<Payload>({
    queryKey: ['event-download-resolutions', eventId],
    queryFn: async () => (await api.get(`/admin/events/${eventId}/download-resolutions`)).data,
  });

  useEffect(() => {
    if (!data || isEditing) return;
    const next = {
      standard: data.overrides.download_standard_resolution ?? INHERIT,
      picker: triToSelect(data.overrides.download_resolution_picker_enabled),
      allowOriginal: triToSelect(data.overrides.download_allow_original),
    };
    setDraft(next);
    setSaved(next);
  }, [data, isEditing]);

  const isDirty = useCallback(() => draft.standard !== saved.standard
    || draft.picker !== saved.picker
    || draft.allowOriginal !== saved.allowOriginal, [draft, saved]);

  const reset = useCallback(() => {
    if (!data) return;
    const next = {
      standard: data.overrides.download_standard_resolution ?? INHERIT,
      picker: triToSelect(data.overrides.download_resolution_picker_enabled),
      allowOriginal: triToSelect(data.overrides.download_allow_original),
    };
    setDraft(next);
    setSaved(next);
  }, [data]);

  const save = useCallback(async () => {
    if (!isDirty()) return;
    setSaving(true);
    try {
      await api.patch(`/admin/events/${eventId}/download-resolutions`, {
        download_standard_resolution: draft.standard === INHERIT ? null : draft.standard,
        download_resolution_picker_enabled: selectToTri(draft.picker),
        download_allow_original: selectToTri(draft.allowOriginal),
      });
      setSaved(draft);
      await refetch();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }, [draft, eventId, isDirty, onChanged, refetch]);

  useImperativeHandle(ref, () => ({ save, isDirty, reset, isSaving: () => saving }), [isDirty, reset, save, saving]);

  if (isLoading || !data) {
    return <Card><Loading /></Card>;
  }

  const globalStandardLabel = data.globals.standard_resolution === ORIGINAL
    ? t('settings.downloads.original', 'Original (full size)')
    : downloadResolutionLabel(
      data.globals.resolutions.find((resolution) => resolution.id === data.globals.standard_resolution)?.label || data.globals.standard_resolution,
      t,
    );
  const effectiveStandardLabel = data.effective.standard === ORIGINAL
    ? t('settings.downloads.original', 'Original (full size)')
    : downloadResolutionLabel(
      data.effective.choices.find((choice) => choice.id === data.effective.standard)?.label || data.effective.standard,
      t,
    );

  // Same input styling as the other admin cards (SlideshowStyleFields) —
  // notably the explicit text colour, without which the select renders
  // muted and reads as disabled.
  const selectClass = 'w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100 rounded-lg text-sm';

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Download className="w-5 h-5 text-neutral-500" />
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t('settings.downloads.eventTitle', 'Download resolution')}
        </h3>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
        {t('settings.downloads.eventIntro',
          'Override the site-wide download settings for this gallery only. "Inherit" follows Settings → Download resolutions.')}
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-neutral-800 dark:text-neutral-200">
            {t('settings.downloads.standard', 'Standard resolution')}
          </label>
          <select className={selectClass} disabled={!isEditing || saving} value={draft.standard} onChange={(e) => setDraft((current) => ({ ...current, standard: e.target.value }))}>
            <option value={INHERIT}>
              {t('settings.downloads.inheritWith', 'Inherit ({{value}})', { value: globalStandardLabel })}
            </option>
            <option value={ORIGINAL}>{t('settings.downloads.original', 'Original (full size)')}</option>
            {data.globals.resolutions.map((r) => (
              <option key={r.id} value={r.id}>{downloadResolutionLabel(r.label, t)} — {r.width} × {r.height}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-neutral-800 dark:text-neutral-200">
            {t('settings.downloads.picker', 'Let guests choose a download size')}
          </label>
          <select className={selectClass} disabled={!isEditing || saving} value={draft.picker} onChange={(e) => setDraft((current) => ({ ...current, picker: e.target.value }))}>
            <option value={INHERIT}>
              {t('settings.downloads.inheritWith', 'Inherit ({{value}})', {
                value: parseBooleanInput(data.globals.picker_enabled, false) ? t('common.on', 'on') : t('common.off', 'off'),
              })}
            </option>
            <option value="true">{t('common.on', 'on')}</option>
            <option value="false">{t('common.off', 'off')}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-neutral-800 dark:text-neutral-200">
            {t('settings.downloads.allowOriginal', 'Offer "Original" in the picker')}
          </label>
          <select
            className={selectClass}
            disabled={!isEditing || saving}
            value={draft.allowOriginal}
            onChange={(e) => setDraft((current) => ({ ...current, allowOriginal: e.target.value }))}
          >
            <option value={INHERIT}>
              {t('settings.downloads.inheritWith', 'Inherit ({{value}})', {
                value: parseBooleanInput(data.globals.allow_original, false) ? t('common.on', 'on') : t('common.off', 'off'),
              })}
            </option>
            <option value="true">{t('common.on', 'on')}</option>
            <option value="false">{t('common.off', 'off')}</option>
          </select>
        </div>
      </div>

      {/* What the gallery actually does right now, after the cascade. */}
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-4">
        {t('settings.downloads.effective', 'Currently hands out: {{standard}}', {
          standard: effectiveStandardLabel,
        })}
        {parseBooleanInput(data.effective.picker_enabled, false)
          ? ` · ${t('settings.downloads.pickerOn', 'guests may choose another size')}`
          : ''}
      </p>

      {isEditing && isDirty() && (
        <p className="mt-4 text-right text-xs text-amber-700 dark:text-amber-300">
          {t('common.unsavedChanges', '有未保存的更改；请使用页面顶部的“保存更改”。')}
        </p>
      )}
    </Card>
  );
  },
);

DownloadResolutionCard.displayName = 'DownloadResolutionCard';
