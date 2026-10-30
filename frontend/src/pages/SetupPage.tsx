import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserRound, Lock, Eye, EyeOff, AlertCircle, ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import { Button, Input, Card, Loading } from '../components/common';
import { useAdminAuth } from '../contexts';
import { setupService } from '../services/setup.service';
import { settingsService } from '../services/settings.service';
import { PicpeakRestoreCard } from '../components/admin/PicpeakBackupCard';
import { SetupConfigStep } from '../components/admin/SetupConfigStep';
import { resolveLoginLogoClasses } from '../utils/loginLogoSize';
import type { AdminUser } from '../types';

// First-run screen. Reached on a fresh instance where no admin account exists
// yet — creates the first (super_admin) account directly in the browser. The
// endpoint self-closes as soon as that account exists.
export const SetupPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAdminAuth();

  const { data: status, isLoading: statusLoading, isError: statusError } = useQuery({
    queryKey: ['setup-status'],
    queryFn: setupService.getSetupStatus,
    retry: false,
    staleTime: Infinity,
  });

  const [step, setStep] = useState<'account' | 'restore' | 'config'>('account');
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (statusLoading) {
    return <Loading fullScreen />;
  }
  // Setup already done, OR the status couldn't be read (e.g. a transient 500) →
  // go to login rather than flashing the create-admin form on a configured
  // instance. Only render the wizard when we know an admin is genuinely missing.
  if (statusError || !status?.needsAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  const setField = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validateAccount = (): boolean => {
    const next: Record<string, string> = {};
    if (!form.username.trim()) next.username = t('setup.usernameRequired');
    else if (!/^[\p{L}\p{N}_-]{3,50}$/u.test(form.username.trim())) next.username = t('setup.usernameInvalid', 'Use 3–50 letters, numbers, underscores or hyphens.');
    if (!form.password) next.password = t('setup.passwordRequired');
    // Mirror the server's rule (validatePassword): >=8 chars with upper, lower
    // and a digit — so the user isn't bounced by the server after a green client.
    else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(form.password)) next.password = t('setup.passwordRequirements');
    if (form.confirm !== form.password) next.confirm = t('setup.passwordMismatch');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    toast.dismiss();
    if (!validateAccount()) return;

    setIsSubmitting(true);
    setErrors({});
    try {
      const { user } = await setupService.createInitialAdmin({
        username: form.username.trim(),
        password: form.password,
      });
      // Cookie is set by the backend; register the session and enter the app.
      const adminUser: AdminUser = {
        id: user.id,
        username: user.username,
        mustChangePassword: false,
        role: { name: user.role.name, displayName: user.role.displayName ?? user.role.name },
      };
      login('', adminUser);
      // Persist the origin the admin is standing on as the public site URL
      // (#705). Doing it HERE, not in the optional config step, means an
      // install that skips the rest of the wizard still has a usable origin
      // for background jobs (QR codes) that have no request
      // to derive one from. Best-effort: never block entering the app, and
      // never overwrite a value the environment already pins.
      try {
        const existing = await settingsService.getSettingsByType('general');
        if (!existing?.general_site_url_env_pinned && !existing?.general_site_url) {
          await settingsService.updateSettings({
            general_site_url: window.location.origin.replace(/\/+$/, ''),
          });
        }
      } catch { /* the config step offers the field again */ }
      toast.success(t('setup.success'));
      // Admin now exists and we're logged in (cookie set). Continue to the
      // optional public URL configuration step.
      setStep('config');
    } catch (error: any) {
      const httpStatus = error.response?.status;
      const data = error.response?.data;
      // Map the server's field back to a translated message instead of
      // rendering its raw English error verbatim.
      const fieldKey: Record<string, string> = {
        username: 'setup.usernameInvalid',
        password: 'setup.passwordRequirements',
      };
      if (httpStatus === 429) {
        toast.error(t('setup.tooManyAttempts'));
      } else if (httpStatus === 409) {
        // Someone else finished setup first — send to login.
        navigate('/admin/login', { replace: true });
      } else if (data?.field && fieldKey[data.field]) {
        setErrors({ [data.field]: t(fieldKey[data.field]) });
      } else if (Array.isArray(data?.errors) && data.errors.length) {
        const p = data.errors[0]?.path || data.errors[0]?.param;
        if (p && fieldKey[p]) {
          setErrors({ [p]: t(fieldKey[p]) });
        } else {
          setErrors({ form: t('setup.genericError') });
        }
      } else {
        setErrors({ form: t('setup.genericError') });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Always visit the config step (#705). It used to be skipped unless a
  // feature the wizard can configure was selected, which
  // meant a gallery-only install never saw the two things EVERY install needs:
  // the public address its client links are built from. This is
  // feature-independent; the invoicing block is still conditional inside the step.
  const stepNumber = step === 'account' ? 1 : 2;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#fafafa' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* On a fresh instance there are no branding settings yet, so use the
              bundled Picflow logo — the same default the login page falls back
              to — on the cream brand plate. Size matches the login default
              (`medium`) so the two screens read identically. */}
          {(() => {
            const cls = resolveLoginLogoClasses(undefined);
            return (
              <div className={`${cls.frameOuter} mx-auto mb-6 rounded-2xl flex items-center justify-center`} style={{ backgroundColor: '#eee6d2' }}>
                <img src="/picflow-icon.png" alt="Picflow" className={`${cls.frameInner} object-contain`} />
              </div>
            );
          })()}
          <h1 className="text-3xl font-bold" style={{ color: '#171717' }}>{t('setup.title')}</h1>
          <p className="mt-2" style={{ color: '#171717', opacity: 0.7 }}>
            {step === 'account'
              ? t('setup.accountStepSubtitle')
              : step === 'restore'
                ? t('setup.restoreStepSubtitle')
                : t('setup.config.subtitle')}
          </p>
          {(step === 'account' || step === 'config') && (
            <p className="mt-3 text-xs font-medium tracking-wide uppercase" style={{ color: '#171717', opacity: 0.5 }}>
              {t('setup.stepOf', { current: stepNumber, total: 2 })}
            </p>
          )}
        </div>

        <Card padding="lg">
          {errors.form && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{errors.form}</p>
            </div>
          )}

          {step === 'account' ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="setup-username" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('setup.usernameLabel')}
                </label>
                <Input
                  id="setup-username"
                  type="text"
                  value={form.username}
                  onChange={setField('username')}
                  error={errors.username}
                  placeholder={t('setup.usernamePlaceholder')}
                  leftIcon={<UserRound className="w-5 h-5 text-neutral-400" />}
                  autoComplete="username"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="setup-password" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('setup.passwordLabel')}
                </label>
                <div className="relative">
                  <Input
                    id="setup-password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={setField('password')}
                    error={errors.password}
                    placeholder={t('setup.passwordPlaceholder')}
                    leftIcon={<Lock className="w-5 h-5 text-neutral-400" />}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="setup-confirm" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('setup.confirmLabel')}
                </label>
                <Input
                  id="setup-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirm}
                  onChange={setField('confirm')}
                  error={errors.confirm}
                  placeholder={t('setup.confirmPlaceholder')}
                  leftIcon={<Lock className="w-5 h-5 text-neutral-400" />}
                  autoComplete="new-password"
                />
              </div>

              <Button type="submit" variant="primary" size="lg" isLoading={isSubmitting} className="w-full">
                {t('setup.submit')}
              </Button>
            </form>
          ) : step === 'restore' ? (
            <div className="space-y-6">
              <p className="text-sm text-neutral-600">{t('setup.restoreIntro')}</p>
              <PicpeakRestoreCard />
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setStep('config')}
                leftIcon={<ArrowLeft className="w-4 h-4" />}
              >
                {t('setup.back')}
              </Button>
            </div>
          ) : step === 'config' ? (
            <SetupConfigStep onDone={() => navigate('/admin/dashboard', { replace: true })} />
          ) : null}
        </Card>
      </div>
    </div>
  );
};

SetupPage.displayName = 'SetupPage';
