import {
  readBrandingCache,
  writeBrandingCache,
  clearBrandingCache,
  CACHE_PREFIX,
} from './brandingCache';

describe('brandingCache', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when nothing is cached', () => {
    expect(readBrandingCache('hospital-a')).toBeNull();
  });

  it('round-trips branding through the cache', () => {
    writeBrandingCache('hospital-a', { productName: 'Hospital A' }, 1000, 5000);
    expect(readBrandingCache('hospital-a', 5500)).toEqual({ productName: 'Hospital A' });
  });

  it('isolates entries for the same tenant by branding source', () => {
    writeBrandingCache(
      'hospital-a',
      { productName: 'Source A' },
      1000,
      5000,
      'https://connect-a.example/branding'
    );

    expect(readBrandingCache('hospital-a', 5500, 'https://connect-a.example/branding')).toEqual({
      productName: 'Source A',
    });
    expect(readBrandingCache('hospital-a', 5500, 'https://connect-b.example/branding')).toBeNull();
  });

  it('sanitizes legacy cache entries when reading and rewrites the safe payload', () => {
    window.localStorage.setItem(
      `${CACHE_PREFIX}legacy`,
      JSON.stringify({
        branding: {
          productName: 'Legacy Clinic',
          logoHref: 'javascript:alert(1)',
          logoUrl: '/assets/legacy.png',
          unknown: 'drop',
        },
        storedAt: 5000,
        ttlMs: 1000,
      })
    );

    expect(readBrandingCache('legacy', 5500)).toEqual({
      productName: 'Legacy Clinic',
      logoUrl: '/assets/legacy.png',
    });

    const rewritten = JSON.parse(window.localStorage.getItem(`${CACHE_PREFIX}legacy`) as string);
    expect(rewritten.branding).toEqual({
      productName: 'Legacy Clinic',
      logoUrl: '/assets/legacy.png',
    });
  });

  it('sanitizes values before writing them', () => {
    writeBrandingCache(
      'unsafe',
      {
        productName: 'Clinic',
        logoHref: 'javascript:alert(1)',
        websiteUrl: 'https://clinic.example',
      },
      1000,
      5000
    );

    expect(readBrandingCache('unsafe', 5500)).toEqual({
      productName: 'Clinic',
      websiteUrl: 'https://clinic.example',
    });
  });

  it('expires entries past their TTL and removes them', () => {
    writeBrandingCache('hospital-a', { productName: 'Hospital A' }, 1000, 5000);
    expect(readBrandingCache('hospital-a', 7000)).toBeNull();
    expect(window.localStorage.getItem(`${CACHE_PREFIX}hospital-a`)).toBeNull();
  });

  it('returns null and clears the entry on corrupt JSON', () => {
    window.localStorage.setItem(`${CACHE_PREFIX}corrupt`, '{not json');
    expect(readBrandingCache('corrupt')).toBeNull();
    expect(window.localStorage.getItem(`${CACHE_PREFIX}corrupt`)).toBeNull();
  });

  it('clears a single tenant entry', () => {
    writeBrandingCache('a', { productName: 'A' });
    writeBrandingCache('a', { productName: 'A source 1' }, undefined, undefined, 'source-1');
    writeBrandingCache('a', { productName: 'A source 2' }, undefined, undefined, 'source-2');
    writeBrandingCache('b', { productName: 'B' });
    writeBrandingCache('b', { productName: 'B source' }, undefined, undefined, 'source-1');

    clearBrandingCache('a');

    expect(readBrandingCache('a')).toBeNull();
    expect(readBrandingCache('a', undefined, 'source-1')).toBeNull();
    expect(readBrandingCache('a', undefined, 'source-2')).toBeNull();
    expect(readBrandingCache('b')).toEqual({ productName: 'B' });
    expect(readBrandingCache('b', undefined, 'source-1')).toEqual({
      productName: 'B source',
    });
  });

  it('clears only one source when tenant and source are given', () => {
    writeBrandingCache('a', { productName: 'A source 1' }, undefined, undefined, 'source-1');
    writeBrandingCache('a', { productName: 'A source 2' }, undefined, undefined, 'source-2');

    clearBrandingCache('a', 'source-1');

    expect(readBrandingCache('a', undefined, 'source-1')).toBeNull();
    expect(readBrandingCache('a', undefined, 'source-2')).toEqual({
      productName: 'A source 2',
    });
  });

  it('clears all RT branding entries when no tenant is given', () => {
    writeBrandingCache('a', { productName: 'A' });
    writeBrandingCache('b', { productName: 'B' });
    window.localStorage.setItem('unrelated', 'keep-me');
    clearBrandingCache();
    expect(readBrandingCache('a')).toBeNull();
    expect(readBrandingCache('b')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep-me');
  });

  it('does nothing for an empty tenant id', () => {
    writeBrandingCache('', { productName: 'X' });
    expect(readBrandingCache('')).toBeNull();
  });

  it('treats throwing storage operations as cache misses', () => {
    const storage = window.localStorage;
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    expect(readBrandingCache('blocked')).toBeNull();
    expect(() => clearBrandingCache('blocked')).not.toThrow();

    getItem.mockRestore();
    removeItem.mockRestore();
    expect(storage).toBe(window.localStorage);
  });

  it('does not throw when storage enumeration is blocked', () => {
    const length = jest.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    expect(() => clearBrandingCache()).not.toThrow();

    length.mockRestore();
  });
});
