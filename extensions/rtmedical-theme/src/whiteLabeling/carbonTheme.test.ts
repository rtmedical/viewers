import { CARBON_G100_TOKENS, applyCarbonTheme } from './carbonTheme';

describe('carbonTheme (RTV-7)', () => {
  it('maps the core OHIF ui-next design tokens', () => {
    for (const token of ['--background', '--foreground', '--primary', '--muted', '--border', '--card']) {
      expect(CARBON_G100_TOKENS[token]).toBeDefined();
    }
    // Carbon Gray100 background, Carbon Blue60 primary, square corners.
    expect(CARBON_G100_TOKENS['--background']).toBe('0 0% 8.6%');
    expect(CARBON_G100_TOKENS['--primary']).toBe('219 99% 53%');
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
});
