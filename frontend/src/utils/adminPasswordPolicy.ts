export type AdminPasswordErrorKey =
  | 'passwordChange.minLengthError'
  | 'mandatoryPasswordChange.mustContainLowercase'
  | 'mandatoryPasswordChange.mustContainUppercase'
  | 'mandatoryPasswordChange.mustContainNumbersError'
  | 'mandatoryPasswordChange.mustContainSpecialError';

/** Match the backend's administrator-password rules in the regular password dialog. */
export function getAdminPasswordErrorKey(password: string): AdminPasswordErrorKey | null {
  if (password.length < 12) return 'passwordChange.minLengthError';
  if (!/[a-z]/.test(password)) return 'mandatoryPasswordChange.mustContainLowercase';
  if (!/[A-Z]/.test(password)) return 'mandatoryPasswordChange.mustContainUppercase';
  if (!/[0-9]/.test(password)) return 'mandatoryPasswordChange.mustContainNumbersError';
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    return 'mandatoryPasswordChange.mustContainSpecialError';
  }
  return null;
}
