import type { BrandingConfig } from './types';

/**
 * RT Medical default branding.
 *
 * The palette is Carbon-Design-inspired (neutral grays + a single focused blue
 * accent) but defined locally — Carbon is intentionally NOT imported. `primary`
 * aligns with OHIF's stock accent (#348CFD) so that tenants without an explicit
 * theme override still look native.
 */
export const defaultBranding: BrandingConfig = {
  productName: 'RT Medical Connect Viewer',
  shortName: 'Connect',
  logoHref: '/',
  logoAlt: 'RT Medical Connect',
  theme: {
    primary: '#348cfd', // OHIF accent / Carbon-like focused blue
    secondary: '#0353e9', // Carbon Blue 70
    background: '#000000',
    foreground: '#e8eaed', // neutral / Carbon Gray 20-ish
    highlight: '#5acce6',
  },
  supportEmail: 'suporte@rtmedical.com.br',
};
