import { describe, it, expect } from 'vitest';
import { passwordPolicyMessage } from '../passwordPolicyMessage';
const t = ((key: string, options?: {count?: number}) => `${key}${options?.count ? `:${options.count}` : ''}`) as any;
describe('password policy errors', () => {
  it('does not misreport uppercase or strength as six characters', () => {
    expect(passwordPolicyMessage(['Password must contain at least one uppercase letter'], t)).toBe('events.passwordReset.policy.uppercase');
    expect(passwordPolicyMessage(['Password is too weak. Please choose a stronger password'], t)).toBe('events.passwordReset.policy.weak');
  });
  it('uses the server configured minimum', () => {
    expect(passwordPolicyMessage(['Password must be at least 12 characters long'], t)).toBe('events.passwordReset.policy.length:12');
  });
});
