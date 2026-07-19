import React from 'react';
import { render, screen } from '@testing-library/react';

import { renderLogo } from './Logo';
import type { BrandingConfig } from './types';

describe('renderLogo URL defenses', () => {
  const runtimeWindow = window as typeof window & { PUBLIC_URL?: string };
  const originalPublicUrl = runtimeWindow.PUBLIC_URL;

  afterEach(() => {
    if (originalPublicUrl === undefined) {
      delete runtimeWindow.PUBLIC_URL;
    } else {
      runtimeWindow.PUBLIC_URL = originalPublicUrl;
    }
  });

  it('falls back to a safe local link and text when remote URLs are executable', () => {
    runtimeWindow.PUBLIC_URL = '/viewer/';
    const branding = {
      productName: 'Clinic Viewer',
      logoHref: 'javascript:window.pwned=true',
      logoDarkUrl: 'javascript:window.pwned=true',
    } as BrandingConfig;

    render(renderLogo(branding, { dark: true }));

    expect(screen.getByRole('link').getAttribute('href')).toBe('/viewer/');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Clinic Viewer')).toBeTruthy();
  });

  it('renders accepted navigation and image URLs unchanged', () => {
    const branding: BrandingConfig = {
      productName: 'Clinic Viewer',
      logoAlt: 'Clinic',
      logoHref: 'https://clinic.example',
      logoDarkUrl: '/assets/clinic.png',
      faviconUrl: '/assets/clinic-icon.png',
    };

    const { container } = render(renderLogo(branding, { dark: true }));

    expect(screen.getByRole('link').getAttribute('href')).toBe('https://clinic.example');
    expect(screen.getByRole('img').getAttribute('src')).toBe('/assets/clinic.png');
    expect(container.querySelector('source')?.getAttribute('media')).toBe('(max-width: 639px)');
    expect(container.querySelector('source')?.getAttribute('srcset')).toBe(
      '/assets/clinic-icon.png'
    );
  });

  it('uses the local route pathname when assets are served from a CDN', () => {
    runtimeWindow.PUBLIC_URL = 'https://cdn.example/viewer/';

    render(renderLogo({ productName: 'Clinic Viewer' }, { dark: true }));

    expect(screen.getByRole('link').getAttribute('href')).toBe('/viewer/');
  });
});
