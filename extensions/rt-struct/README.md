# @ohif/extension-rt-struct

Client-side **RT Structure Set (RTSTRUCT) summary** for OHIF v3 — **RTV-146**
(verifiable slice). Follows **RTV-114** (extension-first / zero fork).

Parses RTSTRUCT in the browser and renders a read-only structures panel
(name, display color, interpreted type, contour count, **approximate volume**)
with CSV export.

## Architecture (panel-only)

The cornerstone extension already registers a SopClassHandler for RTSTRUCT
(`1.2.840.10008.5.1.4.1.1.481.3`), so this extension **does not** register one
(that would duplicate the display set). The panel reads existing RTSTRUCT display
sets from the DisplaySetService and parses their instance metadata.

## Modules

| Module | Purpose |
| --- | --- |
| `rtStructParser` (`parseRtStruct`, `contourArea`, `approximateVolumeCc`, `buildRtStructCsv`, `rgbToHex`) | Pure, unit-tested RTSTRUCT parser + planar-contour volume + CSV |
| `getPanelModule` | Structures panel; opt in via `@ohif/extension-rt-struct.panelModule.rtStruct` |

## What it extracts

- Per ROI: `ROIName`, `ROIDisplayColor`, `RTROIInterpretedType` (PTV/GTV/ORGAN…),
  `ROIGenerationAlgorithm`, contour & point counts.
- **Approximate volume** (cm³): Σ(planar contour shoelace area) × median slice
  thickness derived from contour z-positions. Labelled as an approximation.

## Scope / follow-ups

- **Contour editor** (draw/edit/delete contours, push back as a new RTSTRUCT) is a
  heavy cornerstone-viewport integration — out of scope here, tracked separately.
- RTPLAN and RTDOSE summaries ship as their own extensions (`@ohif/extension-rt-plan`
  RTV-132, `@ohif/extension-rt-dvh` RTV-131).

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-struct/jest.config.js --ci
```

## Drawing Tools + menu de contexto operacional (RTV-214)

`drawingTools.ts` — catálogo de ferramentas no formato do painel Drawing Tools do Eclipse,
ferramenta ativa, estrutura ativa e o menu de botão direito que troca a ferramenta sem ir
até o painel. Core puro, sem cornerstone e sem React.

**O princípio que o ticket enuncia, aplicado no código: *como* você edita é independente do
*que* a estrutura é.** A ferramenta (Brush, Eraser, Draw Planar Contour) é um eixo; o tipo
clínico da estrutura (PTV, OAR — RTV-213) é outro; a estrutura *ativa* é um terceiro. O
Eclipse mantém os três visíveis ao mesmo tempo porque o físico que está pincelando "Spleen"
precisa saber que está pincelando **e** que é o baço. Colapsar dois deles numa seleção só é
como se chega a uma borracha que apaga o órgão errado em silêncio. `selectTool` não toca na
estrutura, `selectStructure` não toca na ferramenta, e há teste para cada direção.

**Listado, desabilitado, e honesto sobre isso.** Paridade com o Eclipse significa mostrar a
família inteira — Deform, Extract Wall, Segmentation Wizard e mais uma dúzia. A maioria não
está implementada. Ferramenta que aparece no painel e não faz nada ao ser clicada é pior que
ferramenta ausente: o usuário não distingue no-op de bug, e abre chamado do segundo tipo.
Esconder perderia o mapa em formato Eclipse que o físico já conhece. Então toda ferramenta
declara `implemented`, as não implementadas aparecem desabilitadas com "ainda não
implementada", e `mvpTools()` é o subconjunto que funciona de verdade.

Três recusas distintas em `canEdit`, porque pedem UI diferente: **sem estrutura** é um
prompt, **não implementada** é um controle desabilitado, **desconhecida** é bug.

**Ferramenta destrutiva não fica a um clique do Brush.** "Clear Structure" esvazia um órgão
que o físico pode ter levado vinte minutos contornando, e mora no mesmo painel que o pincel.
Marcada como destrutiva, exige confirmação, e **fica fora do menu rápido** — que existe
justamente para trocar de ferramenta rápido e sem olhar, que é exatamente o jeito errado de
chegar nela. O menu rápido também descarta as não implementadas em vez de mostrá-las
cinzas: menu rápido cheio de entrada morta é mais lento que um menu curto, e o painel é onde
mora o mapa completo.

**Smart brush é modo, não ferramenta.** É um modificador do mesmo gesto; separar dobraria o
painel e a memória muscular.

Falta: a geometria de verdade. Boolean, Margin/PRV, Interpolate, Crop, Deform, Threshold e a
família de segmentação estão catalogadas e desabilitadas, não implementadas. E nada está
ligado a um viewport do cornerstone — o RTV-141 (as duas AnnotationTool subclasses) é o
ticket que faz o traço acontecer.
