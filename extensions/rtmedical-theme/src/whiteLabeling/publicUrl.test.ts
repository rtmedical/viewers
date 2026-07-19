import {
  getPublicUrlPath,
  normalizePublicUrl,
  publicAssetUrl,
  setRouterBasename,
} from './publicUrl';

describe('public URL helpers', () => {
  const runtimeWindow = window as typeof window & { PUBLIC_URL?: string };
  const originalPublicUrl = runtimeWindow.PUBLIC_URL;

  afterEach(() => {
    setRouterBasename(undefined);
    if (originalPublicUrl === undefined) {
      delete runtimeWindow.PUBLIC_URL;
    } else {
      runtimeWindow.PUBLIC_URL = originalPublicUrl;
    }
  });

  it.each([
    [undefined, '/'],
    ['/', '/'],
    ['/viewer', '/viewer/'],
    ['/viewer///', '/viewer/'],
    ['https://cdn.example/viewer', 'https://cdn.example/viewer/'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizePublicUrl(input)).toBe(expected);
  });

  it('resolves assets under a subpath deployment', () => {
    expect(publicAssetUrl('/assets/logo.png', '/viewer')).toBe('/viewer/assets/logo.png');
    expect(publicAssetUrl('/assets/logo.png', 'https://cdn.example/viewer')).toBe(
      'https://cdn.example/viewer/assets/logo.png'
    );
  });

  it('keeps navigation same-origin when assets use a CDN', () => {
    expect(getPublicUrlPath('https://cdn.example/viewer')).toBe('/viewer/');
  });

  it('prefers OHIF routerBasename over the asset PUBLIC_URL for navigation', () => {
    runtimeWindow.PUBLIC_URL = 'https://cdn.example/assets/';
    setRouterBasename('/ohif-viewer/');

    expect(getPublicUrlPath()).toBe('/ohif-viewer/');
  });
});
