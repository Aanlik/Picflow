import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageErrorBoundary } from '../ErrorBoundary';

const BrokenPage = () => {
  throw new TypeError('Unexpected page data shape');
};

afterEach(() => vi.restoreAllMocks());

describe('PageErrorBoundary diagnostics', () => {
  it('keeps the visitor-facing error generic and records the render cause locally', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<PageErrorBoundary><BrokenPage /></PageErrorBoundary>);

    expect(await screen.findByText(/something went wrong/i)).toBeTruthy();
    expect(errorLog).toHaveBeenCalledWith(
      '[Picflow] Unhandled page render error',
      expect.objectContaining({
        name: 'TypeError',
        message: 'Unexpected page data shape',
        componentStack: expect.any(String),
      }),
    );
  });
});
