import type { BrandingThemeTokens } from './types';

/** Maps branding theme tokens to their CSS custom-property names. */
const TOKEN_TO_CSS_VAR: Record<keyof BrandingThemeTokens, string> = {
  primary: '--rt-color-primary',
  secondary: '--rt-color-secondary',
  background: '--rt-color-background',
  foreground: '--rt-color-foreground',
  highlight: '--rt-color-highlight',
};

/**
 * Builds a `{ cssVarName: value }` map from theme tokens. Pure — does not touch
 * the DOM, so it is trivially testable. Unset / non-string tokens are omitted.
 */
export function buildThemeCssVars(theme?: BrandingThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!theme) {
    return vars;
  }

  (Object.keys(TOKEN_TO_CSS_VAR) as (keyof BrandingThemeTokens)[]).forEach(token => {
    const value = theme[token];
    if (typeof value === 'string' && value.length > 0) {
      vars[TOKEN_TO_CSS_VAR[token]] = value;
    }
  });

  return vars;
}

/**
 * Applies theme tokens as CSS custom properties on the given element (defaults
 * to the document root). Safe no-op outside the browser (SSR / tests without a
 * DOM).
 */
export function applyThemeOverride(
  theme?: BrandingThemeTokens,
  element?: HTMLElement | null
): void {
  const target =
    element ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) {
    return;
  }

  const vars = buildThemeCssVars(theme);
  Object.entries(vars).forEach(([name, value]) => {
    target.style.setProperty(name, value);
  });
}

export { TOKEN_TO_CSS_VAR };
