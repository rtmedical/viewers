import { buildThemeCssVars, applyThemeOverride } from './applyThemeOverride';

describe('buildThemeCssVars', () => {
  it('returns an empty map when theme is undefined', () => {
    expect(buildThemeCssVars(undefined)).toEqual({});
  });

  it('maps known tokens to CSS custom-property names', () => {
    expect(buildThemeCssVars({ primary: '#348cfd', background: '#000000' })).toEqual({
      '--rt-color-primary': '#348cfd',
      '--rt-color-background': '#000000',
    });
  });

  it('omits unset and non-string tokens', () => {
    expect(
      buildThemeCssVars({ primary: '#fff', secondary: '', highlight: undefined })
    ).toEqual({ '--rt-color-primary': '#fff' });
  });
});

describe('applyThemeOverride', () => {
  it('writes CSS custom properties onto the provided element', () => {
    const el = document.createElement('div');
    applyThemeOverride({ primary: '#ff0000', foreground: '#111111' }, el);
    expect(el.style.getPropertyValue('--rt-color-primary')).toBe('#ff0000');
    expect(el.style.getPropertyValue('--rt-color-foreground')).toBe('#111111');
  });

  it('defaults to the document root element', () => {
    applyThemeOverride({ secondary: '#0353e9' });
    expect(document.documentElement.style.getPropertyValue('--rt-color-secondary')).toBe(
      '#0353e9'
    );
  });

  it('is a no-op when theme is empty', () => {
    const el = document.createElement('div');
    applyThemeOverride(undefined, el);
    expect(el.getAttribute('style')).toBeNull();
  });
});
