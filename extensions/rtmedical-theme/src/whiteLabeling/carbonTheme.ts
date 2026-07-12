/**
 * Carbon-Design (g100 dark) look for OHIF (RTV-7).
 *
 * OHIF's ui-next components read HSL-triplet design tokens (`--background`,
 * `--primary`, …) as `hsl(var(--token))` — defined in
 * platform/ui-next/src/tailwind.css. We do NOT fork that file (RTV-114); instead
 * we override the tokens with IBM Carbon g100 values as inline custom properties
 * on <html>, which wins over the stylesheet :root/.dark rules. This repaints the
 * whole viewer in Carbon's neutral greys + focused blue, matching the autoseg
 * viewer (Carbon g100). SVG icons use `currentColor`, so they follow
 * `--foreground` automatically — no icon swap needed for the colour scheme.
 *
 * Values are the canonical Carbon Gray/Blue ramp converted to `H S% L%`:
 *   Gray100 #161616, Gray90 #262626, Gray80 #393939, Gray70 #525252,
 *   Gray30 #c6c6c6, Gray10 #f4f4f4, Blue50 #4589ff.
 *
 * The single accent is Carbon Blue50 #4589ff — this is exactly the interactive
 * blue the autoseg viewer paints for active/selected states in its g100 island;
 * we match it so our chrome reads as the same near-monochrome black/grey/white.
 */
export const CARBON_G100_TOKENS: Record<string, string> = {
  '--background': '0 0% 8.6%', // Gray100 #161616 — app background
  '--foreground': '0 0% 95.7%', // Gray10 #f4f4f4 — primary text
  '--card': '0 0% 14.9%', // Gray90 #262626 — layer-01 (panels)
  '--card-foreground': '0 0% 95.7%',
  '--popover': '0 0% 14.9%', // #262626
  '--popover-foreground': '0 0% 95.7%',
  '--primary': '218 100% 64%', // Carbon Blue50 #4589ff — interactive (autoseg accent)
  '--primary-foreground': '0 0% 100%',
  '--secondary': '0 0% 22.4%', // Gray80 #393939 — layer-02
  '--secondary-foreground': '0 0% 95.7%',
  '--muted': '0 0% 22.4%', // #393939
  '--muted-foreground': '0 0% 77.6%', // Gray30 #c6c6c6 — secondary text
  '--accent': '0 0% 22.4%', // #393939 — hover layer
  '--accent-foreground': '0 0% 95.7%',
  '--border': '0 0% 22.4%', // #393939 — subtle borders
  '--input': '0 0% 22.4%', // #393939 — fields
  '--ring': '218 100% 64%', // Carbon Blue50 #4589ff — focus ring
  '--highlight': '218 100% 72%', // Carbon Blue40 #78a9ff
  '--neutral': '0 0% 52%',
  '--neutral-light': '0 0% 77.6%',
  '--neutral-dark': '0 0% 22.4%',
  '--radius': '0rem', // Carbon = square corners
};

/**
 * Applies the Carbon g100 token overrides to `element` (defaults to the document
 * root). Inline custom properties on <html> beat the ui-next stylesheet's
 * :root/.dark rules. No-op outside the browser (SSR / tests).
 */
export function applyCarbonTheme(element?: HTMLElement | null): void {
  const target = element ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) {
    return;
  }
  Object.entries(CARBON_G100_TOKENS).forEach(([name, value]) => {
    target.style.setProperty(name, value);
  });
}

/** Stylesheet id so the icon refinement is injected only once. */
export const CARBON_ICON_STYLE_ID = 'rt-carbon-icon-style';

/**
 * Carbon-like icon weight (RTV-7). OHIF renders each icon as an `<svg>` inside a
 * `.inline-flex.items-center.justify-center` wrapper; cornerstone's annotation
 * SVGs (contours/measurements/reference-lines) live in the viewport render layer,
 * NOT in that wrapper, so this rule leaves them untouched. Icons are already
 * currentColor (follow --foreground) + mostly 1–1.5 stroke; we just unify the
 * stroke weight toward Carbon's ~1.5 line and render crisply. Fill-based icons
 * (no stroke attr) are unaffected.
 */
export const CARBON_ICON_CSS = `
.inline-flex.items-center.justify-center > svg { shape-rendering: geometricPrecision; }
.inline-flex.items-center.justify-center > svg [stroke]:not([stroke="none"]):not([stroke-width="6"]) { stroke-width: 1.5px; }
`;

/** Injects the Carbon icon stylesheet once (no-op outside the browser). */
export function applyCarbonIconStyle(doc?: Document | null): void {
  const d = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!d || d.getElementById(CARBON_ICON_STYLE_ID)) {
    return;
  }
  const style = d.createElement('style');
  style.id = CARBON_ICON_STYLE_ID;
  style.textContent = CARBON_ICON_CSS;
  d.head.appendChild(style);
}
