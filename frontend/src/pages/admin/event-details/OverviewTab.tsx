import { PhotographyWorkflowCard } from '../../../components/admin/PhotographyWorkflowCard';
import { PHOTO_WORKFLOW_MODE } from '../../../config/photography';
import React from 'react';
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

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      {/* Keep the workflow visible first, with room for its progress table and requests. */}
      <div className="xl:col-span-2">
        <PhotographyWorkflowCard eventId={event.id} isArchived={event.is_archived} />
      </div>

      {/* Project information and sharing tools. */}
      <div className="space-y-6">
        {/* Event Information */}
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
        />

        <PermissionGate permission="photos.view"><DownloadSourceReview eventId={event.id} /></PermissionGate>

        {/* Share Link */}
        <ShareLinkCard event={event} setShowPasswordReset={setShowPasswordReset} passwordVersion={passwordVersion} />

        {/* Branded short URLs (#699). Sits between the canonical share-link
            card and the Client Access card — same "things you share with
            the customer" cluster. */}
        {!PHOTO_WORKFLOW_MODE && <ShortUrlsCard eventId={event.id} />}

        {/* Actions */}
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
      </div>

      {/* Presentation, client access, and delivery settings keep the second
          column useful instead of leaving it with only the theme card. */}
      <div className="space-y-6">
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

        {/* Client Access (#172) */}
        <ClientAccessCard event={event} refetchEvent={refetchEvent} />

        {/* Per-gallery download resolution override (#858). */}
        <DownloadResolutionCard ref={downloadResolutionRef} eventId={event.id} isEditing={isEditing} onChanged={() => refetchEvent()} />

        <ObjectDeliveryCard eventId={event.id} isArchived={event.is_archived} />

        {/* Optional modules remain grouped with the gallery settings. */}
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

        {/* Archive Status */}
        {event.is_archived ? (
          <ArchiveStatusCard event={event} id={id} />
        ) : null}
      </div>
    </div>
  );
};
