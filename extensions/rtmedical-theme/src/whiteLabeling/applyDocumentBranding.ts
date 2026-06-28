import type { BrandingConfig } from './types';

/**
 * Applies document-level branding: sets the page `<title>` from `productName`
 * and the favicon (`<link rel="icon">`) from `faviconUrl`. The favicon link is
 * created when missing and reused otherwise. Safe no-op outside the browser
 * (SSR / tests without a DOM).
 */
export function applyDocumentBranding(
  branding: Pick<BrandingConfig, 'productName' | 'faviconUrl'>,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): void {
  if (!doc) {
    return;
  }

  if (branding.productName) {
    doc.title = branding.productName;
  }

  if (branding.faviconUrl) {
    let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
    }
    link.href = branding.faviconUrl;
  }
}
