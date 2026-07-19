import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

import { WhiteLabelingProvider, useWhiteLabeling } from './WhiteLabelingContext';
import { readBrandingCache, writeBrandingCache } from './brandingCache';
import { defaultBranding } from './defaultBranding';
import type { WhiteLabelingConfig } from './types';

function wrapperFor(config?: WhiteLabelingConfig, context?: Record<string, unknown>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <WhiteLabelingProvider
        config={config}
        context={context}
      >
        {children}
      </WhiteLabelingProvider>
    );
  };
}

describe('useWhiteLabeling / WhiteLabelingProvider', () => {
  afterEach(() => {
    window.localStorage.clear();
    delete (global as { fetch?: unknown }).fetch;
  });

  it('returns RT Medical defaults outside any provider', () => {
    const { result } = renderHook(() => useWhiteLabeling());
    expect(result.current.tenantId).toBeNull();
    expect(result.current.branding.productName).toBe(defaultBranding.productName);
    expect(result.current.loading).toBe(false);
  });

  it('resolves a tenant and merges its static branding', () => {
    const config: WhiteLabelingConfig = {
      tenants: { 'hospital-a': { productName: 'Hospital A' } },
    };
    const { result } = renderHook(() => useWhiteLabeling(), {
      wrapper: wrapperFor(config, { tenantId: 'hospital-a' }),
    });
    expect(result.current.tenantId).toBe('hospital-a');
    expect(result.current.branding.productName).toBe('Hospital A');
  });

  it('fetches remote branding from the Connect API and layers it on', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ productName: 'Remote A', theme: { primary: '#abcdef' } }),
    });
    const config: WhiteLabelingConfig = {
      apiEndpoint: 'https://connect/api/branding/{tenantId}',
      tenants: { 'hospital-a': { productName: 'Static A' } },
    };
    const { result } = renderHook(() => useWhiteLabeling(), {
      wrapper: wrapperFor(config, { tenantId: 'hospital-a' }),
    });

    // Static branding is available synchronously, before the fetch resolves.
    expect(result.current.branding.productName).toBe('Static A');

    // Once the Connect-API branding resolves, it overrides the static value.
    await waitFor(() => expect(result.current.branding.productName).toBe('Remote A'));
    expect(result.current.branding.theme?.primary).toBe('#abcdef');
    expect(result.current.loading).toBe(false);

    // And it is persisted to the local cache for offline use.
    expect(
      readBrandingCache('hospital-a', Date.now(), 'https://connect/api/branding/{tenantId}')
        ?.productName
    ).toBe('Remote A');
  });

  it('never exposes tenant A remote branding after switching to tenant B', async () => {
    let resolveTenantA!: (value: unknown) => void;
    const tenantAResponse = new Promise(resolve => {
      resolveTenantA = resolve;
    });
    const tenantBResponse = new Promise(() => {});

    (global as { fetch?: unknown }).fetch = jest.fn((url: string) =>
      url.endsWith('/tenant-a') ? tenantAResponse : tenantBResponse
    );

    const config: WhiteLabelingConfig = {
      apiEndpoint: 'https://connect/api/branding/{tenantId}',
      tenants: {
        'tenant-a': { productName: 'Static A' },
        'tenant-b': { productName: 'Static B' },
      },
    };

    function Probe() {
      const value = useWhiteLabeling();
      return <span data-testid="branding-name">{value.branding.productName}</span>;
    }

    const view = render(
      <WhiteLabelingProvider
        config={config}
        context={{ tenantId: 'tenant-a' }}
      >
        <Probe />
      </WhiteLabelingProvider>
    );

    await act(async () => {
      resolveTenantA({
        ok: true,
        json: () => Promise.resolve({ productName: 'Remote A' }),
      });
    });
    await waitFor(() => expect(screen.getByTestId('branding-name').textContent).toBe('Remote A'));

    view.rerender(
      <WhiteLabelingProvider
        config={config}
        context={{ tenantId: 'tenant-b' }}
      >
        <Probe />
      </WhiteLabelingProvider>
    );

    expect(screen.getByTestId('branding-name').textContent).toBe('Static B');
  });

  it('does not apply cached remote branding after the API endpoint is removed', () => {
    writeBrandingCache('clinic', { productName: 'Revoked Remote' });
    const { result } = renderHook(() => useWhiteLabeling(), {
      wrapper: wrapperFor(
        { tenants: { clinic: { productName: 'Static Clinic' } } },
        { tenantId: 'clinic' }
      ),
    });

    expect(result.current.branding.productName).toBe('Static Clinic');
  });

  it('does not reuse cached branding from a different API endpoint', () => {
    writeBrandingCache(
      'clinic',
      { productName: 'Old Endpoint' },
      60_000,
      Date.now(),
      'https://old-connect.example/branding/{tenantId}'
    );
    (global as { fetch?: unknown }).fetch = jest.fn(() => new Promise(() => {}));

    const { result } = renderHook(() => useWhiteLabeling(), {
      wrapper: wrapperFor(
        {
          apiEndpoint: 'https://new-connect.example/branding/{tenantId}',
          tenants: { clinic: { productName: 'Static Clinic' } },
        },
        { tenantId: 'clinic' }
      ),
    });

    expect(result.current.branding.productName).toBe('Static Clinic');
  });
});
