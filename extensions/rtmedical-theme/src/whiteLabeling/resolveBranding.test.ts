import { resolveBranding } from './resolveBranding';
import { defaultBranding } from './defaultBranding';
import type { WhiteLabelingConfig } from './types';

describe('resolveBranding', () => {
  const config: WhiteLabelingConfig = {
    defaultTenant: 'rtmedical',
    tenants: {
      'hospital-a': {
        productName: 'Hospital A',
        theme: { primary: '#ff6600' },
      },
    },
    matchers: [{ tenantId: 'hospital-a', hostnames: ['a.rtmedical.ai'] }],
  };

  it('returns RT Medical defaults when no config is provided', () => {
    const { tenantId, branding } = resolveBranding(undefined, {});
    expect(tenantId).toBeNull();
    expect(branding).toEqual(defaultBranding);
  });

  it('resolves a tenant by hostname and merges its static override', () => {
    const { tenantId, branding } = resolveBranding(config, { hostname: 'a.rtmedical.ai' });
    expect(tenantId).toBe('hospital-a');
    expect(branding.productName).toBe('Hospital A');
    // theme override is deep-merged, keeping default tokens.
    expect(branding.theme?.primary).toBe('#ff6600');
    expect(branding.theme?.foreground).toBe(defaultBranding.theme?.foreground);
  });

  it('falls back to the default tenant (no static override) for unknown hosts', () => {
    const { tenantId, branding } = resolveBranding(config, { hostname: 'unknown.com' });
    expect(tenantId).toBe('rtmedical');
    expect(branding.productName).toBe(defaultBranding.productName);
  });

  it('honors an explicit tenantId even without a static override entry', () => {
    const { tenantId, branding } = resolveBranding(config, { tenantId: 'api-only' });
    expect(tenantId).toBe('api-only');
    expect(branding).toEqual(defaultBranding);
  });
});
