/**
 * RT Medical white-labeling / multi-tenant branding (RTV-156).
 *
 * Public surface of the white-labeling module. Pure resolvers + cache/fetch
 * helpers are framework-agnostic and unit-tested; the React layer
 * (provider/hook/Logo) integrates with OHIF via the CustomizationService and the
 * native `whiteLabeling.createLogoComponentFn` hook — zero fork of @ohif/core.
 */
export * from './types';

export { defaultBranding } from './defaultBranding';
export { mergeBranding } from './mergeBranding';
export { resolveTenant } from './resolveTenant';
export { resolveBranding } from './resolveBranding';
export type { ResolvedBranding } from './resolveBranding';
export { buildThemeCssVars, applyThemeOverride } from './applyThemeOverride';
export { applyDocumentBranding } from './applyDocumentBranding';
export { readBrandingCache, writeBrandingCache, clearBrandingCache } from './brandingCache';
export { fetchBranding } from './fetchBranding';
export type { FetchBrandingOptions } from './fetchBranding';
export {
  WhiteLabelingProvider,
  WhiteLabelingContext,
  useWhiteLabeling,
} from './WhiteLabelingContext';
export type {
  WhiteLabelingContextValue,
  WhiteLabelingProviderProps,
} from './WhiteLabelingContext';
export { Logo, createLogoComponentFn } from './Logo';
export type { LogoProps } from './Logo';
