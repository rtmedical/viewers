import type { BrandingConfig } from './types';
import { sanitizeImageUrl } from './sanitizeBranding';

const NEUTRAL_DOCUMENT_TITLE = 'Medical Imaging Viewer';

/**
 * Applies document-level branding: sets the page `<title>` from `productName`
 * and favicon links from `faviconUrl`. Duplicate static favicon declarations
 * are collapsed so tenant changes cannot leave an RT-branded icon behind.
 */
export function applyDocumentBranding(
  branding: Pick<BrandingConfig, 'productName' | 'faviconUrl'>,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): void {
  if (!doc) {
    return;
  }

  const productName = typeof branding.productName === 'string' ? branding.productName.trim() : '';
  doc.title = productName || NEUTRAL_DOCUMENT_TITLE;

  if (branding.faviconUrl !== undefined) {
    const iconLinks = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    const appleTouchLinks = Array.from(
      doc.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    );

    const faviconUrl = sanitizeImageUrl(branding.faviconUrl, true);
    if (!faviconUrl) {
      [...iconLinks, ...appleTouchLinks].forEach(link => link.remove());
      return;
    }

    let link = iconLinks.shift();
    if (!link) {
      link = doc.createElement('link');
      doc.head.appendChild(link);
    }
    link.rel = 'icon';
    link.setAttribute('href', faviconUrl);
    link.removeAttribute('sizes');
    link.removeAttribute('type');
    iconLinks.forEach(duplicate => duplicate.remove());

    let appleTouchLink = appleTouchLinks.shift();
    if (!appleTouchLink) {
      appleTouchLink = doc.createElement('link');
      appleTouchLink.rel = 'apple-touch-icon';
      doc.head.appendChild(appleTouchLink);
    }
    appleTouchLink.setAttribute('href', faviconUrl);
    appleTouchLink.removeAttribute('sizes');
    appleTouchLinks.forEach(duplicate => duplicate.remove());
  }
}

export { NEUTRAL_DOCUMENT_TITLE };
