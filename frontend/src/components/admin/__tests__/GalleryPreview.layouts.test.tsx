import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => ({
    'ui.today': '今天',
    'ui.yesterday': '昨天',
    'ui.sampleCeremony': '仪式',
    'ui.sampleEvent': '示例项目',
    'ui.layoutSuffix': '布局',
    'ui.galleryPreview': '相册预览',
  }[key] || key) }),
}));

import { GalleryPreview } from '../GalleryPreview';

describe('GalleryPreview supported theme layouts', () => {
  it.each(['gallery-premium', 'gallery-story'] as const)('%s renders sample photos', (layoutType) => {
    const { container } = render(<GalleryPreview theme={{} as any} layoutType={layoutType} />);
    expect(container.textContent).toContain('photo-1.jpg');
    expect(container.querySelector('.bg-gradient-to-br')).not.toBeNull();
  });

  it('localizes timeline date headings', () => {
    render(<GalleryPreview theme={{} as any} layoutType="timeline" />);
    expect(screen.getByText('今天')).toBeTruthy();
    expect(screen.getByText('昨天')).toBeTruthy();
  });
});
