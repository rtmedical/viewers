import { applyDocumentBranding, NEUTRAL_DOCUMENT_TITLE } from './applyDocumentBranding';

describe('applyDocumentBranding', () => {
  afterEach(() => {
    document
      .querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')
      .forEach(node => node.remove());
    document.title = '';
  });

  it('sets the document title from productName', () => {
    applyDocumentBranding({ productName: 'Hospital A Viewer' });
    expect(document.title).toBe('Hospital A Viewer');
  });

  it('replaces a previous tenant title when productName is empty', () => {
    document.title = 'Tenant A';

    applyDocumentBranding({ productName: '' });

    expect(document.title).toBe(NEUTRAL_DOCUMENT_TITLE);
  });

  it('creates a favicon link when none exists', () => {
    applyDocumentBranding({ productName: 'X', faviconUrl: 'https://x/icon.png' });
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const appleTouch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://x/icon.png');
    expect(appleTouch?.getAttribute('href')).toBe('https://x/icon.png');
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

  it('collapses duplicate browser icons and updates the Apple touch icon', () => {
    const shortcut = document.createElement('link');
    shortcut.rel = 'shortcut icon';
    shortcut.href = 'https://old/shortcut.png';
    const duplicate = document.createElement('link');
    duplicate.rel = 'icon';
    duplicate.href = 'https://old/icon.png';
    const appleTouch = document.createElement('link');
    appleTouch.rel = 'apple-touch-icon';
    appleTouch.href = 'https://old/apple.png';
    document.head.append(shortcut, duplicate, appleTouch);

    applyDocumentBranding({ productName: 'X', faviconUrl: 'https://new/icon.png' });

    const browserIcons = document.querySelectorAll('link[rel~="icon"]');
    expect(browserIcons).toHaveLength(1);
    expect(browserIcons[0].getAttribute('rel')).toBe('icon');
    expect(browserIcons[0].getAttribute('href')).toBe('https://new/icon.png');
    expect(appleTouch.getAttribute('href')).toBe('https://new/icon.png');
  });

  it('removes static identity icons when a tenant explicitly has no favicon', () => {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    const appleTouch = document.createElement('link');
    appleTouch.rel = 'apple-touch-icon';
    document.head.append(icon, appleTouch);

    applyDocumentBranding({ productName: 'Tenant', faviconUrl: '' });

    expect(document.querySelector('link[rel~="icon"]')).toBeNull();
    expect(document.querySelector('link[rel="apple-touch-icon"]')).toBeNull();
  });

  it('removes existing icons instead of applying an unsafe favicon URL', () => {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = 'https://old/icon.png';
    document.head.appendChild(icon);

    applyDocumentBranding({
      productName: 'Tenant',
      faviconUrl: 'javascript:alert(document.domain)',
    });

    expect(document.querySelector('link[rel~="icon"]')).toBeNull();
    expect(document.querySelector('link[rel="apple-touch-icon"]')).toBeNull();
  });

  it('does not touch the favicon when faviconUrl is absent', () => {
    const existing = document.createElement('link');
    existing.rel = 'icon';
    existing.href = 'https://existing/icon.png';
    document.head.appendChild(existing);

    applyDocumentBranding({ productName: 'X' });

    expect(existing.getAttribute('href')).toBe('https://existing/icon.png');
  });
});
