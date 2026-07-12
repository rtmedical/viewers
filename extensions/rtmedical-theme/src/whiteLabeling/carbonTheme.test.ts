import {
  CARBON_G100_TOKENS,
  applyCarbonTheme,
  applyCarbonIconStyle,
  CARBON_ICON_STYLE_ID,
} from './carbonTheme';

describe('carbonTheme (RTV-7)', () => {
  it('maps the core OHIF ui-next design tokens', () => {
    for (const token of ['--background', '--foreground', '--primary', '--muted', '--border', '--card']) {
      expect(CARBON_G100_TOKENS[token]).toBeDefined();
    }
    // Carbon Gray100 background, Carbon Blue50 primary (autoseg accent), square corners.
    expect(CARBON_G100_TOKENS['--background']).toBe('0 0% 8.6%');
    expect(CARBON_G100_TOKENS['--primary']).toBe('218 100% 64%');
    expect(CARBON_G100_TOKENS['--radius']).toBe('0rem');
  });

  it('sets every token as an inline custom property on the target element', () => {
    const el = { style: { setProperty: jest.fn() } } as unknown as HTMLElement;
    applyCarbonTheme(el);
    expect((el.style.setProperty as jest.Mock).mock.calls.length).toBe(
      Object.keys(CARBON_G100_TOKENS).length
    );
    expect(el.style.setProperty).toHaveBeenCalledWith('--background', '0 0% 8.6%');
  });

  it('is a no-op without a DOM (no throw)', () => {
    expect(() => applyCarbonTheme(null)).not.toThrow();
  });

  it('injects the icon stylesheet once', () => {
    const appended: any[] = [];
    const store: Record<string, any> = {};
    const doc = {
      getElementById: (id: string) => store[id] || null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild: (el: any) => { appended.push(el); store[el.id] = el; } },
    } as unknown as Document;
    applyCarbonIconStyle(doc);
    applyCarbonIconStyle(doc); // second call is a no-op (already present)
    expect(appended.length).toBe(1);
    expect(appended[0].id).toBe(CARBON_ICON_STYLE_ID);
    expect(appended[0].textContent).toContain('stroke-width');
  });
});
