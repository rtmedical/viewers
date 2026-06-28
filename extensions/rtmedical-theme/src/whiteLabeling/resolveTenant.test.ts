import { resolveTenant } from './resolveTenant';
import type { WhiteLabelingConfig } from './types';

describe('resolveTenant', () => {
  const config: WhiteLabelingConfig = {
    defaultTenant: 'rtmedical',
    matchers: [
      { tenantId: 'hospital-a', hostnames: ['a.viewer.rtmedical.ai', 'A.alias.com'] },
      { tenantId: 'hospital-b', hostnameSuffixes: ['.b.rtmedical.ai'] },
      { tenantId: 'regex-tenant', hostnamePattern: '^clinic-\\d+\\.example\\.com$' },
    ],
  };

  it('returns null when config is missing', () => {
    expect(resolveTenant(undefined, { hostname: 'a.viewer.rtmedical.ai' })).toBeNull();
  });

  it('returns null when white-labeling is disabled', () => {
    expect(resolveTenant({ ...config, enabled: false }, { tenantId: 'hospital-a' })).toBeNull();
  });

  it('lets an explicit tenantId win over hostname matchers', () => {
    expect(
      resolveTenant(config, { tenantId: 'explicit', hostname: 'a.viewer.rtmedical.ai' })
    ).toBe('explicit');
  });

  it('matches an exact hostname (case-insensitive)', () => {
    expect(resolveTenant(config, { hostname: 'A.VIEWER.RTMEDICAL.AI' })).toBe('hospital-a');
    expect(resolveTenant(config, { hostname: 'a.alias.com' })).toBe('hospital-a');
  });

  it('matches a hostname suffix when no exact match exists', () => {
    expect(resolveTenant(config, { hostname: 'site1.b.rtmedical.ai' })).toBe('hospital-b');
  });

  it('matches a regex pattern as the lowest-priority rule', () => {
    expect(resolveTenant(config, { hostname: 'clinic-42.example.com' })).toBe('regex-tenant');
    expect(resolveTenant(config, { hostname: 'clinic-x.example.com' })).toBe('rtmedical');
  });

  it('prefers exact hostname over suffix match', () => {
    const cfg: WhiteLabelingConfig = {
      matchers: [
        { tenantId: 'suffix', hostnameSuffixes: ['.rtmedical.ai'] },
        { tenantId: 'exact', hostnames: ['special.rtmedical.ai'] },
      ],
    };
    expect(resolveTenant(cfg, { hostname: 'special.rtmedical.ai' })).toBe('exact');
  });

  it('ignores invalid regex matchers without throwing', () => {
    const cfg: WhiteLabelingConfig = {
      defaultTenant: 'fallback',
      matchers: [{ tenantId: 'bad', hostnamePattern: '([' }],
    };
    expect(resolveTenant(cfg, { hostname: 'whatever.com' })).toBe('fallback');
  });

  it('falls back to defaultTenant when no matcher applies', () => {
    expect(resolveTenant(config, { hostname: 'unknown.host.com' })).toBe('rtmedical');
  });

  it('returns null when nothing matches and no default is set', () => {
    expect(resolveTenant({ matchers: [] }, { hostname: 'unknown.host.com' })).toBeNull();
  });
});
