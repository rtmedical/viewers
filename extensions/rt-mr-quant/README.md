# @ohif/extension-rt-mr-quant

MR-quantitative display for OHIF v3 — **RTV-83** (Dixon fat/water) and **RTV-82**
(parametric maps).

Follows the **RTV-114** extension-first / zero-fork policy: it does **not** modify
`@ohif/core`, `@ohif/app`, `@ohif/ui` or `@ohif/extension-cornerstone`. The colour
ramps in particular are handed to Cornerstone3D as colormap *presets* rather than
being appended to `extensions/cornerstone/src/utils/colormaps.js`, which is a
fork-forbidden package.

## Modules

| Module | Purpose |
| --- | --- |
| `dixon` (`classifyDixonSeries`, `detectDixonSet`) | Pure, unit-tested detection of the fat / water / in-phase / out-of-phase reconstructions of a Dixon acquisition |
| `parametricLut` (`lutColor`, `buildLut`, `toColormapPreset`) | Perceptually-uniform colour ramps + the `RGBPoints` preset shape the cornerstone colorbar consumes |
| `parametricRange` (`normalizeValue`, `rangeToWindow`, `mapValueToRgba`) | Display range, the window/level equivalence, transparency threshold and unit-aware formatting |
| `getHangingProtocolModule` | Registers the `rt-mr-dixon-2x2` protocol |
| `getPanelModule` | "Parametric map" right panel; opt in via `@ohif/extension-rt-mr-quant.panelModule.parametricMap` |
| `getCommandsModule` | `rtApplyParametricMap`, `rtDetectDixon` |

## RTV-83 — Dixon fat/water

A Dixon acquisition arrives as up to four reconstructions of the same anatomy.
The reader compares them slice by slice, so they are hung 2×2 — **water and fat
on top** (the separation that carries the diagnosis), **in/out-phase below** (the
source pair) — with `stack` and `voi` sync groups on every viewport, so scrolling
or windowing any one moves all four.

### How detection avoids the two traps

There is no DICOM tag that says "this is the fat image", so the detector reads
ImageType (0008,0008) first and SeriesDescription second, always on **whole
tokens** — never substrings, so `WATERFALL` and `OUTER` cannot match. Two traps
are worth naming, because a naive implementation falls into both:

1. **Fat-saturation is not fat-only — it is the opposite.** `T2 TSE FS`,
   `STIR fatsat`, `SPAIR` and `CHESS` suppress fat; classifying them as the Dixon
   `fat` reconstruction would put a suppressed image where the reader expects a
   fat map. Those tokens veto a fat match, across both fields.
2. **`W` and `F` are usually weighting, not water and fat.** `T2 W` and `T1_W`
   tokenise to a bare `W`. The ambiguous abbreviations (`W`, `F`, `IP`, `OP`,
   `OPP`) only count when the series also names the technique — `DIXON`,
   `mDIXON`, `IDEAL`, `FLEX`, `LAVAFLEX` — which is what real vendor strings do
   (`mDIXON W`, `IDEAL IP`).

The hanging protocol's declarative `containsAnyOf` rules **cannot** express those
guards (a constraint cannot also require a technique marker), so the protocol
deliberately matches only the unambiguous spellings, and gives the fat selector a
negative-weight rule on the suppression tokens. Studies labelled only with
abbreviations will not auto-hang; `detectDixonSet` still finds them for the panel
and a manual layout. That asymmetry is intentional — the alternative is a
protocol that hijacks every T1-weighted MR study.

## RTV-82 — parametric maps

Parametric maps are quantitative: a reader compares colours across patients and
across time, so the ramp has to be perceptually uniform. Rainbow-family ramps are
not — they invent edges at the cyan/yellow bands and hide detail in the green
plateau. Hence the matplotlib perceptual family:

| LUT | |
| --- | --- |
| `viridis` | default |
| `magma`, `inferno`, `plasma` | |
| `grayscale` | for reading the map without colour |

Each ramp is stored as **11 control points sampled from the published colormap**
and linearly interpolated in sRGB — enough for a display LUT, and explicitly not
a byte-exact reproduction of matplotlib's 256-entry tables.

Conventional display windows ship with the map kinds, so opening an "ADC map"
series loads 0–3000 ×10⁻⁶ mm²/s instead of a meaningless 0–1:

| Kind | Unit | Default window |
| --- | --- | --- |
| ADC | ×10⁻⁶ mm²/s | 0 – 3000 |
| CBV | mL/100 g | 0 – 8 |
| CBF | mL/100 g/min | 0 – 80 |
| MTT | s | 0 – 20 |
| TTP | s | 0 – 30 |

These are *display* conventions, not diagnostic thresholds.

`mapValueToRgba` draws values at or below the threshold fully transparent. That is
the detail that makes a map usable *over* anatomy: without it, background voxels
(typically 0) paint the whole slice with the ramp's low end.

### Relationship to `@ohif/extension-rt-isodose`

`rt-isodose` owns the **dose-heat** ramps (`hot`, `jet`, `grayscale`, `rainbow`),
where a banded rainbow is the clinical convention for isodose lines. This
extension owns the **quantitative** ramps. The two sets are deliberately disjoint
and are not shared through an import: the `rt-*` extension cores in this repo are
self-contained and `@ohif/*`-free (see `extensions/rt-plan/README.md`), and
`rt-fusion` sets the same precedent by mirroring the isodose colormap names rather
than importing them.

## RTV-81 — DWI and ADC

ADC comes from the monoexponential model `S(b) = S0 · exp(-b · ADC)`, so taking logs
turns it into a straight line and the fit is ordinary least squares on `ln S` against `b`.

The arithmetic is three lines. Everything that makes an ADC map *right* is the guards
around it.

### The noise floor is what biases ADC

At high b the diffusion signal decays toward the noise floor. Magnitude MR noise is
**Rician**, not Gaussian, so it does not average to zero — it **raises** the measured
signal wherever the true signal has decayed below it. The log of a floored signal
flattens, the fitted slope goes shallow, and **ADC comes out too low exactly where
restricted diffusion matters**: in the bright-on-high-b lesion the reader is looking at.

`fitAdc` takes a `noiseFloor`, drops samples at or below it, and reports how many. There
is a test that demonstrates the bias in the right direction (a floored b = 5000 sample
pulls a true 800 ×10⁻⁶ ADC down to ~633) and a second showing it recovers once the sample
is excluded.

It deliberately does **not** attempt a Rician bias correction: that needs a noise-sigma
estimate this module has no way to obtain, and a wrong correction is worse than a
documented omission.

### Two b-values is exact, three or more is a fit

Both are supported, and the result says which — they are not equally trustworthy. A
two-point ADC inherits the full noise of both points with **no residual to check it
against**, so `r2` is `NaN` there rather than a misleading 1.0.

### Where a b-value hides

The standard attribute is `DiffusionBValue` (0018,9087), but plenty of installed scanners
write only their private tag — Siemens (0019,100C), GE (0043,1039), Philips (2001,1003) —
and a viewer that reads only the standard one silently treats a multi-b series as a single
acquisition. GE's offset encoding (`1000000750` meaning b = 750) is decoded.

A series with **no** readable b-value is excluded rather than assumed to be b = 0:
treating an unknown as zero would make it the reference signal for every other point and
skew the whole fit.

### Guards

A fitted ADC outside 0 – 0.01 mm²/s is rejected as non-physical (signal *rising* with b is
not diffusion). `computeAdcMap` writes **0** where a voxel fails, not `NaN` — a NaN voxel
makes every downstream statistic special-case it.

Output is in **×10⁻⁶ mm²/s**, the same unit the parametric-map panel (RTV-82) displays,
so the two halves of this extension line up.

### Not delivered

The map is computed from signal arrays the caller supplies; pulling the b-value frames out
of a loaded display set and pushing the result back as a derived volume is the integration
step. Nothing has been run against a real DWI series — the DEV1 PACS has no MR.

## Scope / follow-ups

- **Layer compositing is not wired.** `rtApplyParametricMap` goes as far as the
  public viewport API allows: colormap preset + VOI on the active viewport.
  Rendering a *separate* parametric volume as a semi-transparent second actor over
  anatomy — the `opacity` / `lowerThreshold` half of the panel — needs a second
  volume actor and is a cornerstone integration follow-up, the same boundary
  `rt-fusion` and `rt-isodose` draw. The pure colour/alpha function that layer
  will use (`mapValueToRgba`) is already here and unit-tested.
- **ADC computation landed** (RTV-81, see above). The remaining gap is wiring it
  to a loaded display set rather than to caller-supplied arrays.
- **Not validated against real data.** The DEV1 PACS has no MR Dixon and no
  parametric-map series (its 11 studies are CT/RTIMAGE/RTPLAN/RTSTRUCT — see
  `docker/README.md`), and the fork's CI is blocked by a GitHub billing lock, so
  the evidence here is the unit tests, not a rendered viewport.

## Registering

`platform/app/pluginConfig.json` lists the extension. To use it in a mode, add
`'@ohif/extension-rt-mr-quant': '^3.0.0'` to the mode's `extensionDependencies`
and the panel id to its `rightPanels`.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-mr-quant/jest.config.js --ci
```

## Perfusão DSC — T2* (RTV-56)

`dscPerfusion.ts` — bolus de gadolínio passa pelo voxel, o sinal T2* mergulha, e a forma
desse mergulho carrega CBV, CBF, MTT e TTP. Três coisas nisso são rotineiramente erradas, e
as três mudam os números do mapa que o neurorradiologista está olhando.

**Sinal não é concentração.** O mergulho é exponencial na concentração, não linear:
`C(t) = −k·ln(S(t)/S₀)/TE`. Integrar a queda bruta de sinal e chamar de CBV subpondera o
pico e superpondera os ombros — e o erro é maior exatamente onde o bolus está concentrado,
então **não cancela**. Há teste de que a razão concentração/queda difere entre o pico e o
ombro por mais que um fator de escala.

**Recirculação contamina a área sob a curva.** O traçador volta. Integrar a série inteira
conta a segunda passagem como se fosse a primeira e infla o CBV. A correção padrão é ajustar
uma gama-variada à primeira passagem e integrar o *ajuste*. O ajuste é log-linearizado
(`ln C = ln k + α·ln(t−t₀) − (t−t₀)/β`), portanto mínimos quadrados de três parâmetros: sem
otimizador iterativo, sem convergência para explicar, determinístico. Há teste de que uma
curva com segunda passagem sintética recupera a área da primeira dentro de 10% — e outro
mostrando que a integral ingênua da mesma curva infla mais de 30%.

Área e primeiro momento saem da **forma fechada** (`k·β^(α+1)·Γ(α+1)` e `(α+1)·β`), não de
somar amostras: é o que mantém dois scanners com TRs diferentes comparáveis. O resíduo em TR
grosso é o `t₀` quantizado na grade de amostragem, não a quadratura — está dito no código.

**CBF não é a altura do pico, e MTT não é a FWHM.** A curva tecidual é a entrada arterial
convoluída com a função resíduo. Recuperar CBF exige **deconvolução** por uma AIF medida, e
este módulo não faz isso: deconvolução por SVD circulante precisa de AIF, escolha de
regularização e dado de validação, nenhum dos quais existe aqui.

Então o que é calculado é declarado pelo que é. `requiresDeconvolution` é **sempre**
verdadeiro e `caveats` sempre nomeia isso. Não é ruído defensivo: **um mapa de CBF que não
diz que pulou a deconvolução parece o do console do scanner e discorda dele por um fator que
varia com o bolus.**

Falta: a deconvolução, a seleção automática de AIF, a correção de vazamento (Boxerman-Weisskoff)
e qualquer ligação com um volume carregado.

## Perfusão DCE — T1, Tofts estendido (RTV-57)

`dcePerfusion.ts` — `Ct(t) = vp·Cp(t) + Ktrans·∫Cp(τ)e^(−kep(t−τ))dτ`, com `kep = Ktrans/ve`.

**O ajuste é linear, e isso importa mais do que parece.** Integrando o modelo (Murase 2004)
ele vira `Ct = (Ktrans + kep·vp)·∫Cp − kep·∫Ct + vp·Cp`, linear nos três coeficientes assim
que as integrais cumulativas estão formadas. Uma solução de mínimos quadrados por voxel: sem
chute inicial, sem critério de convergência, sem otimizador que cai noutro mínimo local na
terça. Ajuste não linear sobre um cérebro inteiro é também onde o tempo vai, e mapa que leva
quatro minutos é mapa que ninguém gera.

**Repare no primeiro coeficiente: é `Ktrans + kep·vp`, não `Ktrans`.** Ler direto como Ktrans
superestima em `kep·vp` — ~12% para um `Ktrans 0.25 / ve 0.4 / vp 0.05` típico, e mais em
tumor vascularizado onde vp é maior, que é exatamente onde o número está sendo olhado. E o
ajuste continua reportando **R² = 1 enquanto está errado**, porque o modelo *linear* descreve
os dados perfeitamente; só a extração é que estava torta. Foi um round-trip sintético pelo
modelo direto que pegou isso, e ele está na suíte.

**Realce relativo não é concentração, e Ktrans a partir dele não é Ktrans.** Obter `Ct` exige
o **T1 nativo** do tecido e o ângulo de flip — a equação SPGR invertida voxel a voxel, com
mapa T1 de flip angle variável. A maioria dos viewers pula isso e ajusta o modelo sobre
`(S−S₀)/S₀`. O resultado é um número com unidade de Ktrans, que correlaciona com Ktrans, e
que **não é Ktrans**: varia com scanner, bobina, ângulo de flip e T1 basal do paciente. Não
compara entre visitas — que é o ponto inteiro de medir Ktrans em seguimento oncológico. O
método usado viaja dentro do resultado, com caveat explícito.

**A AIF é a outra metade de todo número aqui.** AIF populacional (Parker) e medida discordam
em dezenas de porcento no mesmo dado. Qual foi usada fica registrada no resultado.

Ajuste fora da fisiologia (`ve > 1`, `vp > 1`, Ktrans absurdo) é **rejeitado**, não devolvido:
um `ve` de 3 não é "um tumor incomum", é um solve irrestrito ajustando ruído — e um mapa com
esses dentro tem pontos brilhantes exatamente onde o leitor olha.

Falta: mapa T1 por flip angle variável, detecção automática de AIF, o mapa por voxel e a UI.

## Espectroscopia de prótons (RTV-58)

`spectroscopy.ts` — um espectro de voxel único é um punhado de picos em deslocamentos
químicos conhecidos. Lê-lo é integrar janelas e dividir. **Decidir se ele *pode* ser lido é a
parte que muda a resposta**, e vem primeiro.

**Espectro mal shimado não é espectro.** Largura de linha é o jogo inteiro. Passados ~0,1 ppm
de FWHM os picos se fundem, as janelas de integração invadem os vizinhos, e toda razão sai
errada numa direção que depende de qual pico vazou em qual. **E o espectro continua
*parecendo* um espectro** — é liso e tem calombos mais ou menos nos lugares certos. Por isso a
checagem roda antes de tudo e a análise **recusa** em vez de reportar razões dali. O ruído é
estimado além de 8 ppm, onde um espectro de cérebro é vazio: estimar sobre o espectro inteiro
dobraria os picos dentro dele e faria todo SNR parecer bom.

**Cr é o denominador, e Cr não é constante.** Quantificação absoluta exige referência de água
e calibração de bobina, então espectroscopia clínica reporta razões à creatina. Isso funciona
até a própria creatina se mover — e **ela cai em tumor de alto grau e em necrose**, que são
exatamente os casos sobre os quais se está perguntando. **Uma Cho/Cr subindo pode ser uma Cr
caindo.** A razão não distingue, e nenhuma dose de cuidado na leitura distingue. Então as
áreas cruas voltam ao lado das razões, e uma creatina abaixo da referência contralateral vira
aviso explícito.

**Lactato inverte em TE 144, lipídio não.** O dupleto em 1,33 ppm aponta **para baixo** em
144 ms e **para cima** em 35 ms; lipídio fica embaixo e sempre aponta para cima. Em TE curto
os dois são indistinguíveis, e **chamar um pico de lipídio de lactato é chamar necrose de
isquemia**. O TE é argumento obrigatório, e a função diz o que dá para concluir no TE que foi
de fato usado em vez de adivinhar — inclusive dizendo "repita em TE 144 se a distinção
importar".

**O eixo de deslocamento químico precisa ser referenciado.** As janelas são estreitas: eixo
0,1 ppm fora e a janela da colina está amostrando creatina. NAA em 2,02 ppm é a âncora, e uma
correção grande demais é ela mesma sinal de que algo está errado — então ela é reportada, não
aplicada em silêncio.

A área de pico subtrai uma linha de base linear pelos extremos da janela: sem isso um fundo
inclinado é contado como sinal, **e contado diferente em cada janela**, porque elas têm
larguras diferentes.
