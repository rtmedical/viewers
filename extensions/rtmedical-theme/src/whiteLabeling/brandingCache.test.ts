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
    writeBrandingCache('b', { productName: 'B' });
    clearBrandingCache('a');
    expect(readBrandingCache('a')).toBeNull();
    expect(readBrandingCache('b')).toEqual({ productName: 'B' });
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
});
