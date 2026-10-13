import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version?: number }) => key === 'photographyWorkflow.retainedDeliveredVersion'
      ? `Retouched version ${options?.version} kept`
      : key === 'photographyWorkflow.clientState.proof' ? '待选片' : key,
  }),
}));

import { WorkflowStatusBadge } from '../WorkflowStatusBadge';

describe('WorkflowStatusBadge', () => {
  it('shows the retained delivered version while the photo returns to the proof queue', () => {
    render(<WorkflowStatusBadge photo={{
      id: 9,
      filename: 'DSC00009.jpg',
      type: 'individual',
      retouch_workflow_enabled: true,
      retouch_state: 'proof',
      retouch_version: 2,
      retouch_delivered_retained: true,
    } as any} />);

    expect(screen.getByText('待选片 · Retouched version 2 kept')).toBeInTheDocument();
  });
});
