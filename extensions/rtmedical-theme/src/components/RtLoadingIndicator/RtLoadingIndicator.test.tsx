import React from 'react';
import { render, screen } from '@testing-library/react';

import RtLoadingIndicator from './RtLoadingIndicator';

describe('RtLoadingIndicator (RTV-212)', () => {
  it('centers the spinner with inset-0 (never top-left collapsed)', () => {
    const { container } = render(<RtLoadingIndicator />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('inset-0');
    expect(root.className).toContain('absolute');
    expect(root.querySelector('.rt-loading-center')).toBeTruthy();
    expect(root.querySelector('.rt-loading-spinner')).toBeTruthy();
  });

  it('renders a shell skeleton hidden from assistive tech', () => {
    const { container } = render(<RtLoadingIndicator />);
    const skeleton = container.querySelector('[data-cy="rt-loading-skeleton"]') as HTMLElement;
    expect(skeleton).toBeTruthy();
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    // left rail + 2×2 viewport grid + right rail
    expect(skeleton.querySelectorAll('.rt-skeleton-rail').length).toBe(2);
    expect(skeleton.querySelectorAll('.rt-skeleton-grid .rt-skeleton-block').length).toBe(4);
  });

  it('is indeterminate without progress and sized with it', () => {
    const { container, rerender } = render(<RtLoadingIndicator />);
    const bar = () => container.querySelector('.rt-loading-bar') as HTMLElement;
    expect(bar().getAttribute('data-indeterminate')).toBe('true');
    rerender(<RtLoadingIndicator progress={42} />);
    expect(bar().getAttribute('data-indeterminate')).toBe('false');
    expect(bar().style.width).toBe('42%');
    // out-of-range values are clamped
    rerender(<RtLoadingIndicator progress={250} />);
    expect(bar().style.width).toBe('100%');
  });

  it('renders the optional textBlock and keeps the stock className contract', () => {
    render(
      <RtLoadingIndicator
        className="h-full w-full"
        textBlock={<span>Carregando estudo…</span>}
      />
    );
    expect(screen.getByText('Carregando estudo…')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
