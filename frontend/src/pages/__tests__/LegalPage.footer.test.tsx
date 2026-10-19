import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn(), language: 'zh-CN' },
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { title: '测试页面', content: '<p>测试内容</p>' },
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../hooks/usePublicSettings', () => ({
  usePublicSettings: () => ({ data: { default_language: 'zh-CN' } }),
}));
vi.mock('../../services/cms.service', () => ({
  cmsService: { getPublicPage: vi.fn() },
}));

import { LegalPage } from '../public/LegalPage';

function renderSlug(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/${slug}`]}>
      <Routes>
        <Route path="/:slug" element={<LegalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LegalPage footer on missing gallery routes (ACC-190)', () => {
  it.each(['gallery-not-found', 'not-found'])('hides public legal links on /%s', (slug) => {
    renderSlug(slug);

    expect(screen.queryByRole('link', { name: '法律声明' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '隐私政策' })).not.toBeInTheDocument();
    expect(screen.queryByText(/©/)).not.toBeInTheDocument();
  });

  it('keeps legal links on an actual CMS legal page', () => {
    renderSlug('impressum');

    expect(screen.getByRole('link', { name: '法律声明' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '隐私政策' })).toBeInTheDocument();
  });
});
