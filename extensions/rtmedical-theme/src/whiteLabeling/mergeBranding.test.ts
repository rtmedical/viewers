import { mergeBranding } from './mergeBranding';
import type { BrandingConfig } from './types';

describe('mergeBranding', () => {
  const base: BrandingConfig = {
    productName: 'RT Medical Viewer',
    shortName: 'RT Medical',
    logoHref: '/',
    theme: { primary: '#348cfd', background: '#000000', foreground: '#e8eaed' },
    supportEmail: 'suporte@rtmedical.com.br',
  };

  it('returns a shallow clone when there is no override', () => {
    const result = mergeBranding(base);
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });

  it('overrides top-level scalar fields', () => {
    const result = mergeBranding(base, { productName: 'Hospital A Viewer' });
    expect(result.productName).toBe('Hospital A Viewer');
    expect(result.shortName).toBe('RT Medical');
  });

  it('deep-merges nested theme tokens instead of replacing the object', () => {
    const result = mergeBranding(base, { theme: { primary: '#ff0000' } });
    expect(result.theme).toEqual({
      primary: '#ff0000',
      background: '#000000',
      foreground: '#e8eaed',
    });
  });

  it('ignores undefined override values so base values survive', () => {
    const result = mergeBranding(base, { productName: undefined, shortName: 'X' });
    expect(result.productName).toBe('RT Medical Viewer');
    expect(result.shortName).toBe('X');
  });

  it('does not mutate the base object', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeBranding(base, { theme: { primary: '#123456' }, productName: 'Changed' });
    expect(base).toEqual(snapshot);
  });

  it('adds new fields present only in the override', () => {
    const result = mergeBranding(base, { faviconUrl: 'https://x/favicon.ico' });
    expect(result.faviconUrl).toBe('https://x/favicon.ico');
  });
});
