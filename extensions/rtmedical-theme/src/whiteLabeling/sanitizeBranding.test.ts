import {
  BRANDING_TEXT_LIMITS,
  sanitizeBrandingPayload,
  sanitizeImageUrl,
  sanitizeNavigationUrl,
} from './sanitizeBranding';

describe('branding sanitization', () => {
  describe('sanitizeNavigationUrl', () => {
    it.each([
      ['/viewer/', '/viewer/'],
      ['./assets/logo.png', './assets/logo.png'],
      ['https://clinic.example/about', 'https://clinic.example/about'],
      ['http://localhost:3000/about', 'http://localhost:3000/about'],
    ])('accepts %p', (value, expected) => {
      expect(sanitizeNavigationUrl(value)).toBe(expected);
    });

    it.each([
      'javascript:alert(document.domain)',
      ' \nJaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      42,
      null,
    ])('rejects %p', value => {
      expect(sanitizeNavigationUrl(value)).toBeUndefined();
    });
  });

  describe('sanitizeImageUrl', () => {
    it('accepts relative, HTTP(S), and raster data image URLs', () => {
      expect(sanitizeImageUrl('/assets/logo.svg')).toBe('/assets/logo.svg');
      expect(sanitizeImageUrl('https://clinic.example/logo.png')).toBe(
        'https://clinic.example/logo.png'
      );
      expect(sanitizeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(
        'data:image/png;base64,iVBORw0KGgo='
      );
    });

    it('rejects executable and SVG data URLs', () => {
      expect(sanitizeImageUrl('javascript:alert(1)')).toBeUndefined();
      expect(
        sanitizeImageUrl(
          'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        )
      ).toBeUndefined();
    });
  });

  describe('sanitizeBrandingPayload', () => {
    it('keeps known fields with valid runtime types and safe URLs', () => {
      expect(
        sanitizeBrandingPayload({
          productName: 'Clinic Viewer',
          logoUrl: '/assets/clinic.png',
          logoHref: 'https://clinic.example',
          faviconUrl: '',
          websiteUrl: '/support',
          theme: { primary: '#123456', background: 42, unknown: 'drop' },
          unknown: 'drop',
        })
      ).toEqual({
        productName: 'Clinic Viewer',
        logoUrl: '/assets/clinic.png',
        logoHref: 'https://clinic.example',
        faviconUrl: '',
        websiteUrl: '/support',
        theme: { primary: '#123456' },
      });
    });

    it('drops invalid field types and unsafe URLs', () => {
      expect(
        sanitizeBrandingPayload({
          productName: { nested: 'invalid' },
          shortName: 'Clinic',
          logoHref: 'javascript:alert(1)',
          logoUrl: 42,
          websiteUrl: 'data:text/html,boom',
          theme: 'invalid',
        })
      ).toEqual({ shortName: 'Clinic' });
    });

    it('accepts documented hex colors and rejects CSS URLs or other color formats', () => {
      expect(
        sanitizeBrandingPayload({
          theme: {
            primary: 'url(javascript:alert(1))',
            secondary: '#abc',
            background: ' #abcd ',
            foreground: '#abcdef',
            highlight: '#abcdef12',
          },
        })
      ).toEqual({
        theme: {
          secondary: '#abc',
          background: '#abcd',
          foreground: '#abcdef',
          highlight: '#abcdef12',
        },
      });

      expect(
        sanitizeBrandingPayload({
          theme: {
            primary: 'red',
            secondary: 'rgb(0, 0, 0)',
            background: '#12',
            foreground: '#12345g',
          },
        })
      ).toEqual({});
    });

    it('trims and bounds remote text fields', () => {
      const excessiveName = `  ${'X'.repeat(BRANDING_TEXT_LIMITS.productName + 100)}  `;

      expect(
        sanitizeBrandingPayload({
          productName: excessiveName,
          shortName: '  Clinic  ',
          supportEmail: '  support@clinic.example  ',
        })
      ).toEqual({
        productName: 'X'.repeat(BRANDING_TEXT_LIMITS.productName),
        shortName: 'Clinic',
        supportEmail: 'support@clinic.example',
      });
    });

    it.each([null, 'branding', [], 42])('rejects a non-object root payload: %p', value => {
      expect(sanitizeBrandingPayload(value)).toBeNull();
    });

    it('drops prototype-related and other unknown keys', () => {
      const payload = JSON.parse(
        '{"productName":"Clinic","__proto__":{"logoHref":"javascript:alert(1)"}}'
      );
      const sanitized = sanitizeBrandingPayload(payload);

      expect(sanitized).toEqual({ productName: 'Clinic' });
      expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
      expect((sanitized as Record<string, unknown>).logoHref).toBeUndefined();
    });
  });
});
