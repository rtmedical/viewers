import { UI_POLISH_CSS, UI_POLISH_STYLE_ID, applyUiPolishStyle, buildUiPolishCss } from './uiPolish';

describe('uiPolish (RTV-212)', () => {
  afterEach(() => {
    document.getElementById(UI_POLISH_STYLE_ID)?.remove();
  });

  it('clamps Radix tooltip poppers to the visual viewport', () => {
    expect(UI_POLISH_CSS).toContain('[data-radix-popper-content-wrapper]');
    expect(UI_POLISH_CSS).toContain("[role='tooltip']");
    expect(UI_POLISH_CSS).toContain('100vw');
  });

  it('makes the study-browser thumbnail cells shrinkable', () => {
    expect(UI_POLISH_CSS).toContain("minmax(0,135px)");
    expect(UI_POLISH_CSS).toContain("minmax(0,275px)");
    expect(UI_POLISH_CSS).toContain("w-[128px]");
    expect(UI_POLISH_CSS).toContain('min-width: 0');
  });

  it('layers content < side panels < header (Carbon g100 elevation)', () => {
    const css = buildUiPolishCss('g100');
    // header (ui-next NavBar = bg-popover border-background) → layer-02
    expect(css).toContain('div.bg-popover.border-background { background-color: #393939');
    // side panels (SidePanel root = bg-background border-background) → layer-01
    expect(css).toContain('background-color: #262626');
  });

  it('shifts the elevation trio one step for the g80 theme (RTV-181)', () => {
    const css = buildUiPolishCss('g80');
    expect(css).toContain('div.bg-popover.border-background { background-color: #525252');
    expect(css).toContain('background-color: #393939');
    // unknown themes fall back to g100
    expect(buildUiPolishCss('weird')).toContain('background-color: #262626');
  });

  it('ships the loading skeleton + centered spinner styles', () => {
    for (const cls of ['.rt-skeleton', '.rt-loading-center', '.rt-loading-spinner', '.rt-loading-bar']) {
      expect(UI_POLISH_CSS).toContain(cls);
    }
    expect(UI_POLISH_CSS).toContain('@keyframes rt-loading-spin');
    expect(UI_POLISH_CSS).toContain('@keyframes rt-skeleton-pulse');
  });

  it('injects the stylesheet once (idempotent)', () => {
    applyUiPolishStyle();
    applyUiPolishStyle();
    const styles = document.querySelectorAll(`#${UI_POLISH_STYLE_ID}`);
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toBe(buildUiPolishCss());
  });

  it('is a no-op without a document', () => {
    expect(() => applyUiPolishStyle(null)).not.toThrow();
  });
});
