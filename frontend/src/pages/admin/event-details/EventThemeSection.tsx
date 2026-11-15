import React from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import type { Event } from '../../../types';
import { Card } from '../../../components/common';
import { ThemeCustomizerEnhanced } from '../../../components/admin/ThemeCustomizerEnhanced';
import { ThemeDisplay } from '../../../components/admin/ThemeDisplay';
import { usePublicSettings } from '../../../hooks/usePublicSettings';
import type { EnabledTemplate } from '../../../services/cssTemplates.service';
import { ThemeConfig, GALLERY_THEME_PRESETS } from '../../../types/theme.types';
import type { EditFormState } from './types';

interface EventThemeSectionProps {
  event: Event;
  isEditing: boolean;
  editForm: EditFormState;
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  currentTheme: ThemeConfig | null;
  setCurrentTheme: (theme: ThemeConfig | null) => void;
  currentPresetName: string;
  setCurrentPresetName: (name: string) => void;
  setThemeChanged: (changed: boolean) => void;
  cssTemplates: EnabledTemplate[];
}

export const EventThemeSection: React.FC<EventThemeSectionProps> = ({
  event,
  isEditing,
  editForm,
  setEditForm,
  currentTheme,
  setCurrentTheme,
  currentPresetName,
  setCurrentPresetName,
  setThemeChanged,
  cssTemplates
}) => {
  const { t } = useTranslation();
  const { data: publicSettings } = usePublicSettings();

  return (
    <>
      {/* Theme & Style */}
      {isEditing && !event.is_archived && (
        <Card padding="md">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 py-1 text-lg font-semibold text-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-100 [&::-webkit-details-marker]:hidden">
              <span>{t('branding.themeAndStyle')}</span>
              <span aria-hidden="true" className="text-sm font-normal text-neutral-500 group-open:hidden">{t('events.editSections.open', '展开')}</span>
              <span aria-hidden="true" className="hidden text-sm font-normal text-neutral-500 group-open:inline">{t('events.editSections.close', '收起')}</span>
            </summary>
            <div className="mt-4">
              <ThemeCustomizerEnhanced
                value={currentTheme || GALLERY_THEME_PRESETS.default.config}
                forceColorMode={publicSettings?.branding_force_color_mode ?? null}
                onChange={(theme) => {
                  setCurrentTheme(theme);
                  setEditForm(prev => ({ ...prev, color_theme: JSON.stringify(theme) }));
                  setThemeChanged(true);
                }}
                presetName={currentPresetName}
                onPresetChange={(presetName) => {
                  setCurrentPresetName(presetName);
                  setThemeChanged(true);
                  if (presetName !== 'custom') {
                    const preset = GALLERY_THEME_PRESETS[presetName];
                    if (preset) {
                      setCurrentTheme(preset.config);
                      setEditForm(prev => ({ ...prev, color_theme: presetName }));
                    }
                  }
                }}
                onSyncFromBranding={() => {
                  // Reset only the 8 colour tokens to the site Branding —
                  // layout, header, typography all stay so the admin doesn't
                  // lose tweaks made for this specific event.
                  const branding = publicSettings?.theme_config as ThemeConfig | undefined;
                  if (!branding) {
                    toast.error(t('toast.brandingThemeMissing', 'No branding theme has been saved yet.'));
                    return;
                  }
                  const base = currentTheme || GALLERY_THEME_PRESETS.default.config;
                  const merged: ThemeConfig = {
                    ...base,
                    primaryColor: branding.primaryColor,
                    accentColor: branding.accentColor,
                    accentDarkColor: branding.accentDarkColor,
                    backgroundColor: branding.backgroundColor,
                    surfaceColor: branding.surfaceColor,
                    elevatedColor: branding.elevatedColor,
                    surfaceBorderColor: branding.surfaceBorderColor,
                    textColor: branding.textColor,
                    mutedTextColor: branding.mutedTextColor,
                    colorMode: branding.colorMode ?? base.colorMode,
                  };
                  setCurrentTheme(merged);
                  setCurrentPresetName('custom');
                  setEditForm(prev => ({ ...prev, color_theme: JSON.stringify(merged) }));
                  setThemeChanged(true);
                  toast.success(t('toast.brandingPaletteSynced', 'Palette synced from Branding.'));
                }}
                showGalleryLayouts={true}
                hideActions={true}
                cssTemplates={cssTemplates}
                cssTemplateId={editForm.css_template_id}
                onCssTemplateChange={(templateId) => setEditForm(prev => ({ ...prev, css_template_id: templateId }))}
              />
            </div>
          </details>
        </Card>
      )}

      {/* Theme Display (when not editing) */}
      {!isEditing && !event.is_archived && (
        <Card padding="md">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t('events.galleryTheme')}</h2>
          <ThemeDisplay
            theme={event.color_theme || GALLERY_THEME_PRESETS.default.config}
            presetName={event.color_theme && !event.color_theme.startsWith('{') ? event.color_theme : undefined}
            showDetails={true}
          />
        </Card>
      )}
    </>
  );
};
