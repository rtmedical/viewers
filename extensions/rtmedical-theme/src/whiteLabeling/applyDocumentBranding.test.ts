import { applyDocumentBranding } from './applyDocumentBranding';

describe('applyDocumentBranding', () => {
  afterEach(() => {
    document.querySelectorAll('link[rel="icon"]').forEach(node => node.remove());
    document.title = '';
  });

  it('sets the document title from productName', () => {
    applyDocumentBranding({ productName: 'Hospital A Viewer' });
    expect(document.title).toBe('Hospital A Viewer');
  });

  it('creates a favicon link when none exists', () => {
    applyDocumentBranding({ productName: 'X', faviconUrl: 'https://x/icon.png' });
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://x/icon.png');
  });

  it('reuses an existing favicon link instead of adding another', () => {
    const existing = document.createElement('link');
    existing.rel = 'icon';
    existing.href = 'https://old/icon.png';
    document.head.appendChild(existing);

    applyDocumentBranding({ productName: 'X', faviconUrl: 'https://new/icon.png' });

    const links = document.querySelectorAll('link[rel="icon"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://new/icon.png');
  });

  it('does not touch the favicon when faviconUrl is absent', () => {
    applyDocumentBranding({ productName: 'X' });
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });
});
