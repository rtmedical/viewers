import type { BrandingConfig } from './types';
import { publicAssetUrl } from './publicUrl';

/**
 * RT Medical default branding.
 *
 * The palette is IBM Carbon g100 (near-monochrome greys + a single Blue50
 * accent) defined locally — Carbon is intentionally NOT imported. The accent is
 * Carbon Blue50 #4589ff, matching the autoseg viewer's interactive blue, so the
 * header reads as the same black/grey/white chrome as the rest of the viewer.
 */
export const defaultBranding: BrandingConfig = {
  productName: 'RT Medical Viewer',
  shortName: 'RT Medical Systems',
  logoAlt: 'RT Medical Systems',
  logoUrl: publicAssetUrl('assets/rtmedical-logo-black.png'),
  logoDarkUrl: publicAssetUrl('assets/rtmedical-logo-white.png'),
  faviconUrl: publicAssetUrl('assets/rtmedical-favicon.png'),
  theme: {
    primary: '#4589ff', // Carbon Blue50 — interactive/focus accent (autoseg)
    secondary: '#393939', // Carbon Gray80 — neutral surface
    background: '#161616', // Carbon Gray100 — g100 shell
    foreground: '#f4f4f4', // Carbon Gray10 — primary text
    highlight: '#4589ff', // Carbon Blue50 (was cyan #5acce6 — off-palette)
  },
  supportEmail: 'suporte@rtmedical.com.br',
  websiteUrl: 'https://rtmedical.com.br',
  websiteLabel: 'rtmedical.com.br',
};
