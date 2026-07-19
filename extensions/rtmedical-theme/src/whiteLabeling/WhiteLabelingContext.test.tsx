import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';

import { WhiteLabelingProvider, useWhiteLabeling } from './WhiteLabelingContext';
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
    expect(window.localStorage.getItem('rt.whitelabel.branding.hospital-a')).not.toBeNull();
  });
});
