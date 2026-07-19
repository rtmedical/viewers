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
    expect(branding.logoUrl).toBeUndefined();
    expect(branding.logoDarkUrl).toBeUndefined();
    expect(branding.logoHref).toBeUndefined();
    expect(branding.faviconUrl).toBe('');
    expect(branding.supportEmail).toBeUndefined();
  });

  it('starts the default tenant from a neutral identity for unknown hosts', () => {
    const { tenantId, branding } = resolveBranding(config, { hostname: 'unknown.com' });
    expect(tenantId).toBe('rtmedical');
    expect(branding.productName).toBe('rtmedical');
    expect(branding.shortName).toBe('rtmedical');
    expect(branding.logoUrl).toBeUndefined();
    expect(branding.logoDarkUrl).toBeUndefined();
    expect(branding.logoHref).toBeUndefined();
    expect(branding.faviconUrl).toBe('');
    expect(branding.supportEmail).toBeUndefined();
    expect(branding.theme).toEqual(defaultBranding.theme);
  });

  it('honors an explicit tenantId even without a static override entry', () => {
    const { tenantId, branding } = resolveBranding(config, { tenantId: 'api-only' });
    expect(tenantId).toBe('api-only');
    expect(branding.productName).toBe('api-only');
    expect(branding.shortName).toBe('api-only');
    expect(branding.logoUrl).toBeUndefined();
    expect(branding.faviconUrl).toBe('');
    expect(branding.theme).toEqual(defaultBranding.theme);
  });

  it('keeps only identity fields explicitly supplied by a tenant', () => {
    const { branding } = resolveBranding(
      {
        tenants: {
          clinic: {
            productName: 'Clinic Viewer',
            logoDarkUrl: 'https://clinic/logo.png',
            faviconUrl: 'https://clinic/favicon.png',
            supportEmail: 'support@clinic.example',
          },
        },
      },
      { tenantId: 'clinic' }
    );

    expect(branding.logoDarkUrl).toBe('https://clinic/logo.png');
    expect(branding.logoUrl).toBeUndefined();
    expect(branding.faviconUrl).toBe('https://clinic/favicon.png');
    expect(branding.supportEmail).toBe('support@clinic.example');
    expect(branding.websiteUrl).toBeUndefined();
  });

  it('drops empty and invalid static identity fields before merging', () => {
    const { branding } = resolveBranding(
      {
        tenants: {
          clinic: {
            productName: '',
            shortName: '',
            websiteUrl: 'javascript:alert(1)',
            theme: { primary: 'url(https://attacker.example)' },
          },
        },
      },
      { tenantId: 'clinic' }
    );

    expect(branding.productName).toBe('clinic');
    expect(branding.shortName).toBe('clinic');
    expect(branding.websiteUrl).toBeUndefined();
    expect(branding.theme?.primary).toBe(defaultBranding.theme?.primary);
  });

  it('does not inherit RT identity into a partially configured default tenant', () => {
    const { tenantId, branding } = resolveBranding(
      {
        defaultTenant: 'clinic',
        tenants: {
          clinic: {
            productName: 'Clinic Viewer',
          },
        },
      },
      { hostname: 'unknown.example' }
    );

    expect(tenantId).toBe('clinic');
    expect(branding.productName).toBe('Clinic Viewer');
    expect(branding.logoUrl).toBeUndefined();
    expect(branding.logoDarkUrl).toBeUndefined();
    expect(branding.logoAlt).toBeUndefined();
    expect(branding.logoHref).toBeUndefined();
    expect(branding.faviconUrl).toBe('');
    expect(branding.supportEmail).toBeUndefined();
  });
});
