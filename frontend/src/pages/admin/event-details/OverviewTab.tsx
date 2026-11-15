import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PhotographyWorkflowCard } from '../../../components/admin/PhotographyWorkflowCard';
import { PHOTO_WORKFLOW_MODE } from '../../../config/photography';
import type { Event } from '../../../types';
import { PermissionGate } from '../../../components/admin/PermissionGate';
import { SlideshowSettingsCard } from '../../../components/admin/SlideshowSettingsCard';
import { DownloadResolutionCard, type DownloadResolutionEditorHandle } from '../../../components/admin/DownloadResolutionCard';
import { ShortUrlsCard } from '../../../components/admin/ShortUrlsCard';
import { useFeatureFlags } from '../../../contexts/FeatureFlagsContext';
import type { AdminPhoto } from '../../../services/photos.service';
import type { FeedbackSettings as FeedbackSettingsType } from '../../../services/feedback.service';
import type { EnabledTemplate } from '../../../services/cssTemplates.service';
import { ThemeConfig } from '../../../types/theme.types';
import type { EditFormState } from './types';
import { EventInformationCard } from './EventInformationCard';
import { ShareLinkCard } from './ShareLinkCard';
import { ClientAccessCard } from './ClientAccessCard';
import { EventActionsCard } from './EventActionsCard';
import { EventThemeSection } from './EventThemeSection';
import { ArchiveStatusCard } from './ArchiveStatusCard';
import { ObjectDeliveryCard } from '../../../components/admin/ObjectDeliveryCard';
import { DownloadSourceReview } from './DownloadSourceReview';
import { DeliveryPortalManager } from '../../../components/admin/DeliveryPortalManager';

interface OverviewTabProps {
  event: Event;
  id: string | undefined;
  passwordVersion?: number;
  isEditing: boolean;
  editForm: EditFormState;
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  showNewPassword: boolean;
  setShowNewPassword: (show: boolean) => void;
  feedbackSettings: FeedbackSettingsType;
  setFeedbackSettings: React.Dispatch<React.SetStateAction<FeedbackSettingsType>>;
  categories: Array<{ id: number; name: string; slug: string; is_folder?: boolean }>;
  photos: AdminPhoto[];
  phoneFieldEnabled: boolean;
  daysUntilExpiration: number | null;
  onRevealNow?: () => void;
  refetchEvent: () => void;
  downloadResolutionRef: React.Ref<DownloadResolutionEditorHandle>;
  setShowPasswordReset: (show: boolean) => void;
  setShowPublishDialog: (show: boolean) => void;
  setShowDuplicateDialog: (show: boolean) => void;
  onArchive: () => void;
  isArchiving: boolean;
  isPublishing: boolean;
  isDuplicating: boolean;
  currentTheme: ThemeConfig | null;
  setCurrentTheme: (theme: ThemeConfig | null) => void;
  currentPresetName: string;
  setCurrentPresetName: (name: string) => void;
  setThemeChanged: (changed: boolean) => void;
  cssTemplates: EnabledTemplate[];
}

interface OverviewSectionProps {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Keep the overview scannable and avoid loading hidden panels until needed. */
const OverviewSection: React.FC<OverviewSectionProps> = ({ title, description, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <h2>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-neutral-800 sm:px-5"
        >
          <span className="min-w-0">
            <span className="block text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</span>
            <span className="mt-0.5 block text-sm text-neutral-500 dark:text-neutral-400">{description}</span>
          </span>
          <ChevronDown className={`h-5 w-5 shrink-0 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </h2>
      <div id={contentId} hidden={!isOpen} className="border-t border-neutral-200 p-4 dark:border-neutral-700 sm:p-5">
        {isOpen ? children : null}
      </div>
    </section>
  );
};

export const OverviewTab: React.FC<OverviewTabProps> = ({
  event,
  id,
  passwordVersion,
  isEditing,
  editForm,
  setEditForm,
  showNewPassword,
  setShowNewPassword,
  feedbackSettings,
  setFeedbackSettings,
  categories,
  photos,
  phoneFieldEnabled,
  daysUntilExpiration,
  onRevealNow,
  refetchEvent,
  downloadResolutionRef,
  setShowPasswordReset,
  setShowPublishDialog,
  setShowDuplicateDialog,
  onArchive,
  isArchiving,
  isPublishing,
  isDuplicating,
  currentTheme,
  setCurrentTheme,
  currentPresetName,
  setCurrentPresetName,
  setThemeChanged,
  cssTemplates
}) => {
  const { flags } = useFeatureFlags();
  const { t } = useTranslation();

  const downloadResolution = (
    <DownloadResolutionCard
      ref={downloadResolutionRef}
      eventId={event.id}
      isEditing={isEditing}
      compact={isEditing}
      onChanged={() => refetchEvent()}
    />
  );

  const eventInformation = (
    <EventInformationCard
      event={event}
      id={id}
      isEditing={isEditing}
      editForm={editForm}
      setEditForm={setEditForm}
      showNewPassword={showNewPassword}
      setShowNewPassword={setShowNewPassword}
      feedbackSettings={feedbackSettings}
      setFeedbackSettings={setFeedbackSettings}
      categories={categories}
      photos={photos}
      phoneFieldEnabled={phoneFieldEnabled}
      daysUntilExpiration={daysUntilExpiration}
      onRevealNow={onRevealNow}
      downloadResolution={isEditing ? downloadResolution : undefined}
    />
  );

  const theme = (
    <EventThemeSection
      event={event}
      isEditing={isEditing}
      editForm={editForm}
      setEditForm={setEditForm}
      currentTheme={currentTheme}
      setCurrentTheme={setCurrentTheme}
      currentPresetName={currentPresetName}
      setCurrentPresetName={setCurrentPresetName}
      setThemeChanged={setThemeChanged}
      cssTemplates={cssTemplates}
    />
  );

  if (isEditing) {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        {eventInformation}
        {theme}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PhotographyWorkflowCard eventId={event.id} isArchived={event.is_archived} />

      <OverviewSection
        title={t('events.overviewSections.accessTitle')}
        description={t('events.overviewSections.accessDescription')}
      >
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <ShareLinkCard event={event} setShowPasswordReset={setShowPasswordReset} passwordVersion={passwordVersion} />
          <ClientAccessCard event={event} refetchEvent={refetchEvent} />
          <PermissionGate permission="events.view">
            <DeliveryPortalManager eventId={event.id} isArchived={event.is_archived} isShareable={event.is_active} />
          </PermissionGate>
          {!PHOTO_WORKFLOW_MODE && <ShortUrlsCard eventId={event.id} />}
        </div>
      </OverviewSection>

      <OverviewSection
        title={t('events.overviewSections.deliveryTitle')}
        description={t('events.overviewSections.deliveryDescription')}
      >
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <PermissionGate permission="photos.view"><DownloadSourceReview eventId={event.id} /></PermissionGate>
          {downloadResolution}
          <ObjectDeliveryCard eventId={event.id} isArchived={event.is_archived} />
        </div>
      </OverviewSection>

      <OverviewSection
        title={t('events.overviewSections.presentationTitle')}
        description={t('events.overviewSections.presentationDescription')}
      >
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          {eventInformation}
          {theme}
          {flags.slideshow && (
            <SlideshowSettingsCard
              eventId={event.id}
              slug={event.slug}
              isArchived={event.is_archived}
              initial={{
                show_share_token: event.show_share_token,
                show_interval_ms: event.show_interval_ms,
                show_transition: event.show_transition,
                show_transition_ms: event.show_transition_ms,
                show_watermark: event.show_watermark,
                show_qr: event.show_qr,
                show_colorfilter: event.show_colorfilter,
                show_order: event.show_order,
                show_category_id: event.show_category_id,
              }}
              onChanged={() => refetchEvent()}
            />
          )}
        </div>
      </OverviewSection>

      <OverviewSection
        title={t('events.overviewSections.managementTitle')}
        description={t('events.overviewSections.managementDescription')}
      >
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          {!event.is_archived && (
            <PermissionGate permissions={['events.edit', 'events.archive', 'events.create']}>
              <EventActionsCard
                event={event}
                onArchive={onArchive}
                isArchiving={isArchiving}
                setShowPublishDialog={setShowPublishDialog}
                isPublishing={isPublishing}
                setShowDuplicateDialog={setShowDuplicateDialog}
                isDuplicating={isDuplicating}
              />
            </PermissionGate>
          )}
          {event.is_archived ? <ArchiveStatusCard event={event} id={id} /> : null}
        </div>
      </OverviewSection>
    </div>
  );
};
