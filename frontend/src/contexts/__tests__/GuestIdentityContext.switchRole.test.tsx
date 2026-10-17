import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GuestIdentityProvider, useGuestIdentity } from '../GuestIdentityContext';
import { GuestNamePromptModal } from '../../components/gallery/GuestNamePromptModal';
import {
  __resetStorageResolutionForTests,
  clearGuestIdentity,
  getGuestIdentity,
  getGuestToken,
  storeGuestIdentity,
} from '../../utils/guestIdentityStorage';

const SLUG = 'acceptance-saved-picker';

function token(name: string) {
  const payload = btoa(JSON.stringify({ sub: name, exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.signature`;
}

function tokenSubject(value: string | null) {
  if (!value) return null;
  const payload = value.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
  if (!payload) return null;
  return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).sub;
}

function PendingAction() {
  const { ensureIdentity } = useGuestIdentity();
  const [result, setResult] = useState('');
  return (
    <>
      <button type="button" onClick={() => { void ensureIdentity().then((identity) => setResult(identity.name)); }}>
        Start retouch selection
      </button>
      <output>{result ? `Active picker: ${result}` : ''}</output>
    </>
  );
}

describe('saved guest picker selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    __resetStorageResolutionForTests();
    const first = { id: 11, name: '验收客户A', identifier: 'guest-a' };
    const second = { id: 12, name: '验收客户B', identifier: 'guest-b' };
    storeGuestIdentity(SLUG, first, token('guest-a'));
    storeGuestIdentity(SLUG, second, token('guest-b'));
    clearGuestIdentity(SLUG);
  });

  it('activates a saved picker and resumes the action that opened the prompt', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GuestIdentityProvider slug={SLUG} identityMode="guest">
          <PendingAction />
          <GuestNamePromptModal />
        </GuestIdentityProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start retouch selection' }));
    fireEvent.click(await screen.findByRole('button', { name: '验收客户B' }));

    expect(await screen.findByText('Active picker: 验收客户B')).toBeInTheDocument();
    await waitFor(() => expect(getGuestIdentity(SLUG)).toMatchObject({ id: 12, name: '验收客户B' }));
    expect(tokenSubject(getGuestToken(SLUG))).toBe('guest-b');
  });
});
