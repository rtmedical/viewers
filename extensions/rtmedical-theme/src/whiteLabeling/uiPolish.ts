/**
 * Viewer UI/UX polish (RTV-212) — one injected stylesheet, four fixes:
 *
 * 1. Loading: styles for the RtLoadingIndicator (centered ring spinner +
 *    shell skeleton) that replaces the stock top-left LoadingIndicatorProgress
 *    via the 'ui.loadingIndicatorProgress' customization (set by our modes).
 * 2. Tooltips: Radix portals its tooltip content to <body> with an inline
 *    popper transform; near a screen edge long content can still spill.
 *    Clamp the popper wrapper + tooltip content to the visual viewport and
 *    let text wrap.
 * 3. Study-browser cards: ui-next's ThumbnailList grid uses
 *    `minmax(0,135px)` columns but each Thumbnail keeps a FIXED w-[128px]/
 *    w-[135px], so a panel narrower than the column overflows horizontally.
 *    Make the cells and their fixed-width descendants shrinkable.
 * 4. Grey elevation hierarchy (VSCode-style, Carbon g100 layer tokens):
 *    content #161616 (background) < side panels #262626 (layer-01) <
 *    header #393939 (layer-02). ui-next's NavBar is `bg-popover
 *    border-background` and the SidePanel root is `bg-background
 *    border-background` — both CORE, so the layering is applied by CSS
 *    (zero-fork, RTV-114) keyed on those class pairs.
 */

/** Stylesheet id so the polish CSS is injected only once. */
export const UI_POLISH_STYLE_ID = 'rt-ui-polish-style';

export const UI_POLISH_CSS = `
/* ---- RTV-212(1): loading — shell skeleton + centered spinner ---- */
.rt-skeleton { position: absolute; inset: 0; display: flex; gap: 2px; padding: 4px; }
.rt-skeleton-rail { width: 260px; display: flex; flex-direction: column; gap: 8px; padding: 8px; }
.rt-skeleton-grid { flex: 1 1 auto; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2px; }
.rt-skeleton-block { border-radius: 2px; background: #262626; animation: rt-skeleton-pulse 1.6s ease-in-out infinite; }
.rt-skeleton-rail .rt-skeleton-block { height: 96px; flex: none; }
.rt-skeleton-rail .rt-skeleton-block:first-child { height: 32px; }
@media (max-width: 900px) { .rt-skeleton-rail { display: none; } }
@keyframes rt-skeleton-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

.rt-loading-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
.rt-loading-spinner { width: 44px; height: 44px; border-radius: 9999px; border: 3px solid #393939; border-top-color: #4589ff; animation: rt-loading-spin 0.9s linear infinite; }
@keyframes rt-loading-spin { to { transform: rotate(360deg); } }
.rt-loading-bar-rail { width: 192px; height: 8px; border-radius: 2px; background: #262626; overflow: hidden; }
.rt-loading-bar { height: 100%; background: #4589ff; }
.rt-loading-bar[data-indeterminate='true'] { width: 35%; animation: rt-loading-slide 1.2s ease-in-out infinite; }
@keyframes rt-loading-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }

/* ---- RTV-212(2): tooltips never leave the visual viewport ---- */
[data-radix-popper-content-wrapper] { max-width: calc(100vw - 8px); }
/* whitespace-nowrap on the content must not defeat the clamp — long labels wrap */
[data-radix-popper-content-wrapper] [role='tooltip'] { max-width: min(20rem, calc(100vw - 16px)); white-space: normal !important; overflow-wrap: anywhere; }

/* ---- RTV-212(3): study-browser cards shrink inside narrow panels ---- */
[class*='minmax(0,135px)'] > *, [class*='minmax(0,275px)'] > * { max-width: 100%; min-width: 0; }
[class*='minmax(0,135px)'] [class*='w-[128px]'],
[class*='minmax(0,135px)'] [class*='w-[135px]'],
[class*='minmax(0,135px)'] [class*='max-w-[160px]'],
[class*='minmax(0,275px)'] [class*='w-[275px]'] { max-width: 100%; }
[class*='minmax(0,135px)'] img, [class*='minmax(0,275px)'] img { max-width: 100%; }

/* ---- RTV-212(4): grey elevation — content < side panels < header ---- */
div.bg-popover.border-background { background-color: __HEADER__ !important; }
div.bg-background.border-background,
div.bg-background.border-background .bg-background { background-color: __SIDEBAR__ !important; }
`;

/** Elevation trio per Carbon theme (RTV-212 hierarchy follows RTV-181's theme). */
const ELEVATION = {
  g100: { sidebar: '#262626', header: '#393939' },
  g80: { sidebar: '#393939', header: '#525252' },
} as const;

/** The polish CSS with the elevation surfaces resolved for `theme`. */
export function buildUiPolishCss(theme?: string | null): string {
  const level = theme === 'g80' ? ELEVATION.g80 : ELEVATION.g100;
  return UI_POLISH_CSS.replace('__HEADER__', level.header).replace('__SIDEBAR__', level.sidebar);
}

/** Injects the UI-polish stylesheet once (no-op outside the browser). */
export function applyUiPolishStyle(doc?: Document | null, theme?: string | null): void {
  const d = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!d || d.getElementById(UI_POLISH_STYLE_ID)) {
    return;
  }
  const style = d.createElement('style');
  style.id = UI_POLISH_STYLE_ID;
  style.textContent = buildUiPolishCss(theme);
  d.head.appendChild(style);
}
