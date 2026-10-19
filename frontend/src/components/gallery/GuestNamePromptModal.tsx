import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../common';
import { useGuestIdentity } from '../../contexts/GuestIdentityContext';
import { guestsService } from '../../services/guests.service';

interface GuestNamePromptModalProps {
  allowCancel?: boolean;
  onCancel?: () => void;
}

/**
 * Session-wide prompt shown in guest identity mode when no identity exists
 * yet. Triggered by `ensureIdentity()` on the first interactive feedback
 * attempt, or manually via `openPrompt()`.
 *
 * Includes a link to the recovery flow for users who already registered on
 * another device.
 */
export const GuestNamePromptModal: React.FC<GuestNamePromptModalProps> = ({
  allowCancel = true,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { slug, identityMode, promptOpen, closePrompt, register, savedRoles, identity, switchRole } = useGuestIdentity();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: remoteRoles } = useQuery({
    queryKey: ['guest-roles', slug],
    queryFn: () => guestsService.listGuestRoles(slug),
    enabled: promptOpen && identityMode === 'guest',
    staleTime: 0,
  });

  const roleMap = new Map<number, { guest: { id: number; name: string } }>();
  savedRoles.forEach((role) => roleMap.set(role.guest.id, role));
  (remoteRoles?.guests || []).forEach((guest) => roleMap.set(guest.id, { guest }));
  const availableRoles = [...roleMap.values()];

  if (!promptOpen) return null;

  const handleClose = () => {
    setName('');
    setErrors({});
    setSubmitError(null);
    closePrompt();
    onCancel?.();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = t('gallery.guestPrompt.nameRequired', 'Name is required');
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await register(name.trim());
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } } };
      setSubmitError(error.response?.data?.error || t('gallery.guestPrompt.error', 'Registration failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={allowCancel ? handleClose : undefined} />
      <div className="relative bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
        {allowCancel && (
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-4 right-4 p-1 hover:bg-black/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-theme" />
          </button>
        )}

        <h2 className="text-lg font-semibold text-theme mb-2">
          {t('gallery.guestPrompt.title', "Welcome — what's your name?")}
        </h2>
        <p className="text-sm text-muted-theme mb-4">
          {t(
            'gallery.guestPrompt.description',
            'Your picks will be saved under this name so the photographer knows which photos you love.'
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('gallery.guestPrompt.nameLabel', 'Your name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            placeholder={t('gallery.guestPrompt.namePlaceholder', 'Enter your name')}
            autoFocus
            required
            maxLength={100}
          />


          {availableRoles.length > 0 && (
            <div className="space-y-2 rounded-lg border border-surface p-3">
              <p className="text-sm font-medium text-theme">{t('gallery.guestPrompt.savedRoles', '已有选片人')}</p>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map(({ guest }) => (
                  <Button
                    key={guest.id}
                    type="button"
                    variant={identity?.id === guest.id ? 'primary' : 'outline'}
                    size="sm"
                    disabled={submitting || identity?.id === guest.id}
                    onClick={async () => {
                      setSubmitting(true);
                      setSubmitError(null);
                      try {
                        await switchRole(guest.id);
                      } catch {
                        setSubmitError(t('gallery.guestPrompt.roleSwitchFailed', '无法切换到这位选片人，请重新输入姓名继续。'));
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >{guest.name}{identity?.id === guest.id ? ` · ${t('gallery.guestPrompt.currentRole', '当前')}` : ''}</Button>
                ))}
              </div>
            </div>
          )}

          {submitError && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2">
              {submitError}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1" disabled={submitting}>
              {submitting
                ? t('common.submitting', 'Submitting...')
                : t('gallery.guestPrompt.submit', 'Continue')}
            </Button>
            {allowCancel && (
              <Button type="button" variant="ghost" onClick={handleClose} disabled={submitting}>
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
          </div>

          {/* A returning guest who fills the form in again becomes a second
              guest row, and their earlier likes and favourites stop counting
              as theirs (#1210). Recovery has always been here to prevent that,
              as a small link under the button that people reasonably read as
              fine print and skipped.

              Given its own block and told in terms of what the guest loses by
              missing it, rather than "I've been here before" — which reads as
              a greeting, not a warning. Still a choice and not a check: asking
              the server whether an address is already registered would answer
              "is this person in this gallery" to anyone who asked, which is
              why /guest/recover deliberately cannot be used that way. */}
          {/* Theme tokens, not neutral-* with a dark: variant (#1210 review).
              A dark gallery preset is delivered through CSS variables and does
              NOT add Tailwind's .dark class, so the dark: half never fires and
              this block would render dark grey on a dark surface. The rest of
              the modal uses text-theme / text-muted-theme for exactly this
              reason. */}

        </form>
      </div>
    </div>
  );
};
