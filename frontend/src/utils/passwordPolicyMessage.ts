import type { TFunction } from 'i18next';

// The server returns an errors array, not feedback.join(). Keep policy failures
// distinct from a too-short password rather than claiming every failure is six characters.
export function passwordPolicyMessage(details: unknown, t: TFunction): string {
  if (!Array.isArray(details)) return t('events.passwordReset.policy.general');
  const rules: Record<string, string> = {
    'Password must contain at least one uppercase letter': 'uppercase',
    'Password must contain at least one lowercase letter': 'lowercase',
    'Password must contain at least one number': 'number',
    'Password must contain at least one special character': 'special',
    'This password is too common. Please choose a more unique password': 'common',
    'Password is too weak. Please choose a stronger password': 'weak',
  };
  const messages = details.filter((value): value is string => typeof value === 'string').map(value => {
    const length = /^Password must be at least (\d+) characters long$/.exec(value);
    if (length) return t('events.passwordReset.policy.length', { count: Number(length[1]) });
    return rules[value] ? t(`events.passwordReset.policy.${rules[value]}`) : t('events.passwordReset.policy.general');
  });
  return [...new Set(messages)].join(' ');
}
