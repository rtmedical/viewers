# @ohif/extension-rt-print

**RT Print** panel for OHIF v3 — **RTV-140**. Configurable print layout
(A3/A4/A5 × portrait/landscape × 1×1 / 2×2 / 3×3 grid, padding/gap), live
preview, and print (Save-as-PDF for PDF export). Follows **RTV-114**
(extension-first / zero fork).

## Modules

| Module | Purpose |
| --- | --- |
| `printLayout` (`computePrintLayout`, `zoneCount`, `PAPER_SIZES_MM`, `GRID_PRESETS`) | Pure, unit-tested layout geometry (paper dims + grid-zone rectangles in mm) |
| `getCommandsModule` | `computeRtPrintLayout`, `rtPrint` (framework-free) |
| `getPanelModule` | RtPrintPanel — config + scaled preview + print; opt in via `@ohif/extension-rt-print.panelModule.rtPrint` |

## Coverage

- ✅ Panel with full config (paper / orientation / grid / padding / gap).
- ✅ Preview before print (scaled zone layout).
- ✅ Grid zones 1×1 / 2×2 / 3×3.
- ✅ Export as PDF via the browser print dialog (Save as PDF).
- 🟡 **Populating zones with live viewport screenshots / embedded DVH / RTPlan**
  is a cornerstone-viewport integration follow-up (needs screenshot capture from
  the viewports) — the layout/preview/print scaffolding is in place.

> Verification: the pure layout core + commands are unit-tested; the full app
> bundle builds clean (rspack). Interactive panel behaviour (print rendering) is
> not E2E-verified here — it follows the same proven panel pattern as the other
> `@rt/extension-*`.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-print/jest.config.js --ci
```

## Impressão DICOM: escala, cinza e a cópia que sai do sistema (RTV-102)

`printScu.ts` — o `printLayout.ts` (RTV-140) distribui as imagens no filme. Este trata do que
precisa ser verdade depois que o filme existe, e filme é peculiar entre as saídas porque **não
carrega metadado nenhum**. Todo outro artefato que o viewer produz pode ser interrogado depois;
uma folha de plástico transparente não pode.

### Um filme que não é 1:1 convida uma régua

Planejamento ortopédico e cirúrgico é feito no filme com régua física, e **o filme não diz em que
escala foi impresso**. Imprima um quadril a 87% para caber na folha e toda medida tirada dali sai
13% curta — de forma consistente, plausível, e sem que quem segura a régua tenha como saber.

Por isso "ajustar ao filme" e "tamanho real" são **pedidos diferentes**, não o mesmo pedido com
outro zoom, e tamanho real é **recusado** quando a anatomia não cabe: uma impressão em tamanho
real que virou ajuste ao filme em silêncio é exatamente a falha.

### O filme e a tela são duas escalas de cinza

A impressão DICOM tem seu próprio pipeline de apresentação. Impresso sem a LUT de apresentação —
ou com o padrão da impressora — o filme tem contraste diferente do monitor em que o estudo foi
lido. **O médico solicitante passa a olhar uma imagem diferente, com as duas partes acreditando
que é a mesma.**

### Filme impresso não pode ser recolhido

É uma divulgação sem confirmação de entrega, sem confirmação de leitura e sem supersessão. Uma
retificação alcança quem recebeu o laudo; **não alcança um filme numa pasta**. É o mesmo
raciocínio do `distribution.ts` (RTV-110): filme é um canal não autenticado que por acaso é feito
de plástico — e por isso imprimir **não fecha** o ciclo de comunicação de um achado crítico.

### Identificação é uma troca sem saída

Filme sem nome é uma imagem inidentificável que vai aparecer numa pasta daqui a seis meses; filme
com identificação queimada não pode ser anonimizado depois. Os dois lados da troca pertencem a
quem pede a impressão.
