import {
  getPublicUrlPath as getRuntimePublicUrlPath,
  normalizePublicUrl,
  publicAssetUrl,
} from './publicUrl';
import normalizeBuildPublicUrl, {
  getPublicUrlPath as getBuildPublicUrlPath,
} from '../../.webpack/normalizePublicUrl';

describe('publicUrl', () => {
  it('keeps exactly one trailing slash', () => {
    expect(normalizePublicUrl('/viewer')).toBe('/viewer/');
    expect(normalizePublicUrl('/viewer///')).toBe('/viewer/');
    expect(normalizePublicUrl('viewer')).toBe('/viewer/');
    expect(normalizePublicUrl('https://cdn.example/viewer')).toBe('https://cdn.example/viewer/');
  });

  it('builds route-independent asset URLs', () => {
    expect(publicAssetUrl('./assets/logo.png', '/viewer/')).toBe('/viewer/assets/logo.png');
    expect(publicAssetUrl('/assets/logo.png', '/viewer')).toBe('/viewer/assets/logo.png');
    expect(publicAssetUrl('/assets/logo.png', 'https://cdn.example/viewer')).toBe(
      'https://cdn.example/viewer/assets/logo.png'
    );
  });

  it.each([undefined, '', '/', 'viewer', '/viewer', '/viewer///', 'https://cdn.example/viewer'])(
    'keeps the runtime and build-time base normalization aligned for %p',
    value => {
      expect(normalizeBuildPublicUrl(value)).toBe(normalizePublicUrl(value));
    }
  );

  it.each([
    [undefined, '/'],
    ['/viewer', '/viewer/'],
    ['https://cdn.example/viewer', '/viewer/'],
  ])('derives the server pathname from %p', (value, expected) => {
    expect(getBuildPublicUrlPath(value)).toBe(expected);
    expect(getRuntimePublicUrlPath(value)).toBe(expected);
  });

  it.each([
    ['https://cdn.example/viewer?version=1', 'query string'],
    ['/viewer#release', 'hash'],
    ['data:text/plain,viewer', 'HTTP(S)'],
    ['//cdn.example/viewer', 'protocol-relative'],
    ['/viewer\\assets', 'backslash'],
    ['/viewer path', 'whitespace'],
  ])('rejects ambiguous or unsafe base %p', (value, message) => {
    expect(() => normalizePublicUrl(value)).toThrow(message);
    expect(() => normalizeBuildPublicUrl(value)).toThrow(message);
  });
});
