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

  /*
   * RTV-235 — o resto da paleta que o ui-next declara e o tema nao pintava.
   *
   * ATENCAO AO FORMATO, porque ele NAO e uniforme no tailwind.css do ui-next e errar aqui
   * produz cor invisivel em vez de erro:
   *   - `--destructive` e `--chart-*` sao TRIPLETES (`H S% L%`), consumidos como
   *     `hsl(var(--token))` pelo tailwind.config.js;
   *   - as quatro familias semanticas sao declaradas com a COR COMPLETA (`hsl(49, 100%, 97%)`).
   * Como `applyCarbonTheme` grava o valor verbatim, cada token vai no formato do seu par.
   *
   * O QUE E DIVIDA DE HOJE E O QUE E SEGURO CONTRA AMANHA. Medido em 11/09/2026: so
   * `--destructive`/`--destructive-foreground` tem consumidor (cinco lugares usando
   * `bg-destructive`/`text-destructive`); as doze semanticas e os cinco `--chart-*` estao
   * declarados no ui-next e nao sao usados por ninguem. Entao pintar `--destructive` corrige
   * algo visivel agora, e pintar o resto e apolice: no dia em que um componente do upstream
   * comecar a usar `--warning-bg`, ele ja nasce Carbon em vez de nascer com a cor CLARA que o
   * tailwind.css declara (`hsl(49, 100%, 97%)`, quase branco -- as semanticas so existem no
   * bloco claro e NUNCA sao redefinidas no `.dark`).
   *
   * A guarda de cobertura em carbonThemeCoverage.test.ts e o que impede essa apolice de
   * envelhecer: token novo do ui-next reprova ate alguem decidir o valor Carbon dele.
   */

  // Vermelho de acao destrutiva — Carbon Red 50 #fa4d56, o tom de erro dos temas escuros.
  '--destructive': '357 94.5% 64.1%',
  '--destructive-foreground': '0 0% 100%',

  /*
   * Familias semanticas, no padrao de notificacao do Carbon para tema escuro: a superficie e a
   * camada (layer-01), e quem carrega o significado sao a borda e o texto na cor de suporte.
   * Pintar o FUNDO com a cor de suporte daria o bloco saturado dos temas claros, que em g100
   * vira uma mancha e ainda perde contraste com o texto.
   */
  '--error-bg': 'hsl(0, 0%, 14.9%)', // Gray 90 — layer-01
  '--error-border': 'hsl(357, 94.5%, 64.1%)', // Red 50
  '--error-text': 'hsl(357, 94.5%, 64.1%)', // Red 50
  '--success-bg': 'hsl(0, 0%, 14.9%)',
  '--success-border': 'hsl(137, 48.8%, 50.2%)', // Green 40
  '--success-text': 'hsl(137, 48.8%, 50.2%)',
  '--warning-bg': 'hsl(0, 0%, 14.9%)',
  '--warning-border': 'hsl(47, 88.4%, 52.5%)', // Yellow 30
  '--warning-text': 'hsl(47, 88.4%, 52.5%)',
  '--info-bg': 'hsl(0, 0%, 14.9%)',
  '--info-border': 'hsl(218, 100%, 73.5%)', // Blue 40
  '--info-text': 'hsl(218, 100%, 73.5%)',

  /*
   * Paleta categorica. A ordem e de MATIZ SEPARADO, nao de gradiente: series vizinhas num
   * grafico precisam ser distinguiveis lado a lado, e um degrade de azuis falha nisso -- e
   * falha de vez para quem tem deficiencia de visao de cores. Todos sao tons 40/50 do Carbon,
   * que e a faixa legivel sobre fundo escuro.
   */
  '--chart-1': '218 100% 73.5%', // Blue 40
  '--chart-2': '334 82% 62.9%', // Magenta 50
  '--chart-3': '179 91.9% 38.6%', // Teal 40
  '--chart-4': '263 100% 71.6%', // Purple 50
  '--chart-5': '47 88.4% 52.5%', // Yellow 30
};

/**
 * Carbon g80 alternative (RTV-181): one step LIGHTER than g100 — base #262626,
 * layers #393939/#525252 — closer to VSCode Dark, intended for long reading
 * shifts. Only the neutral surfaces shift; the Blue50 accent, foreground and
 * radius are shared with g100. NOT the default: opt in per workstation via
 * `?theme=g80` (persisted) — the product default remains g100.
 *
 * ## O nome "g80" nao e um nome do Carbon, e isso e deliberado (RTV-235)
 *
 * O Carbon tem QUATRO temas: White, g10, g90 e g100. **Nao existe g80.** A rampa abaixo e,
 * valor por valor, o tema **g90** do Carbon: base Gray 90 #262626, layer-01 Gray 80 #393939,
 * layer-02 Gray 70 #525252.
 *
 * A decisao (11/09/2026) foi MANTER o nome `g80`, porque ele ja esta persistido no
 * `localStorage` das estacoes que o usaram e renomear exigiria migracao — o autoseg passou por
 * isso e carrega ate hoje um `// Migrate legacy g90 to g100` no ThemeContext dele.
 *
 * O risco de um nome errado e alguem "corrigir" os VALORES para casar com o nome, escurecendo a
 * rampa para Gray 80/70/60 e quebrando um tema que esta certo. Por isso os cinzas estao fixados
 * por teste em `carbonThemeCoverage.test.ts`: a divergencia fica onde esta, no nome, e nao
 * escorrega para a cor.
 */
export const CARBON_G80_TOKENS: Record<string, string> = {
  ...CARBON_G100_TOKENS,
  '--background': '0 0% 14.9%', // Gray90 #262626 — app background
  '--card': '0 0% 22.4%', // Gray80 #393939 — layer-01
  '--popover': '0 0% 22.4%', // #393939
  '--secondary': '0 0% 32.2%', // Gray70 #525252 — layer-02
  '--muted': '0 0% 32.2%',
  '--accent': '0 0% 32.2%',
  '--border': '0 0% 32.2%',
  '--input': '0 0% 32.2%',
  '--neutral-dark': '0 0% 32.2%',
  /*
   * RTV-235 — as superficies semanticas acompanham a camada do tema. Se ficassem no Gray 90 do
   * g100, um aviso em g80 apareceria mais escuro que o painel em volta e leria como buraco.
   * Borda e texto NAO mudam: as cores de suporte do Carbon sao as mesmas nos dois temas, e e
   * delas que vem o significado.
   */
  '--error-bg': 'hsl(0, 0%, 22.4%)', // Gray 80 — layer-01 do g80
  '--success-bg': 'hsl(0, 0%, 22.4%)',
  '--warning-bg': 'hsl(0, 0%, 22.4%)',
  '--info-bg': 'hsl(0, 0%, 22.4%)',
};

export type CarbonThemeName = 'g100' | 'g80';

/** Token map for a theme name (unknown values fall back to g100). */
export function resolveCarbonTheme(theme?: string | null): Record<string, string> {
  return theme === 'g80' ? CARBON_G80_TOKENS : CARBON_G100_TOKENS;
}

/**
 * Applies the Carbon token overrides to `element` (defaults to the document
 * root). Inline custom properties on <html> beat the ui-next stylesheet's
 * :root/.dark rules. No-op outside the browser (SSR / tests).
 */
export function applyCarbonTheme(element?: HTMLElement | null, theme?: string | null): void {
  const target = element ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) {
    return;
  }
  Object.entries(resolveCarbonTheme(theme)).forEach(([name, value]) => {
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

/* Idle chrome reads GREY like autoseg's Carbon g100 — blue is reserved for
 * active/selected/hover states. Stock ui-next paints idle icons, side-panel
 * tab strips, header actions and ghost buttons with text-primary / a blue
 * bg tint, which made the whole chrome read blue. Active indicators use
 * bg-highlight / text-highlight / explicit active classes and keep the blue. */
.text-primary { color: #c6c6c6 !important; }
.hover\\:text-primary:hover { color: #4589ff !important; }
.bg-primary\\/10 { background-color: rgba(141, 141, 141, 0.12) !important; }
.hover\\:bg-primary\\/20:hover { background-color: rgba(141, 141, 141, 0.22) !important; }
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
