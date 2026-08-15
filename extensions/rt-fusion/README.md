# @ohif/extension-rt-fusion

Image-**fusion UI** for OHIF v3 — **RTV-197**. A fusion config model (fixed/moving
layers, opacity, blend mode, colormap, inversion) + a config panel with a live
CSS-blended preview. Follows **RTV-114** (extension-first / zero fork).

## Modules

| Module | Purpose |
| --- | --- |
| `fusionConfig` (`defaultFusionConfig`, `normalizeFusionConfig`, `buildLayerStyle`, `isFusable`, `BLEND_MODES`, `FUSION_COLORMAPS`) | Pure, unit-tested fusion config + normalization + CSS-style mapping |
| `getPanelModule` | Fusion panel (layers / opacity / blend / colormap / invert + blended preview); opt in via `@ohif/extension-rt-fusion.panelModule.fusion` |

## Coverage / scope

- ✅ Fusion config UI: pick fixed/moving image layers, **opacity** slider,
  **blend mode** (normal/multiply/screen/overlay), **colormap** + invert, with a
  live CSS-blended preview and an "is fusable" guard.
- 🟡 **Compositing the moving layer onto the fixed layer in the cornerstone
  viewport** (applying opacity/blend + the colormap LUT from
  `@ohif/extension-rt-isodose`) is a viewport integration follow-up.

> Colormap names mirror `@ohif/extension-rt-isodose` (the LUT generator lives
> there); duplicated as a small constant to avoid a cross-extension import.

> Verification: pure config core unit-tested; full app bundle builds clean
> (rspack). Viewport compositing is not part of this slice (not E2E-verified).

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-fusion/jest.config.js --ci
```

## The seven fusion tools (RTV-136)

Migration of the connectviewer `FusionTools`. They fall into two families, and the split
is what makes them testable:

| Family | Tools | What they decide |
| --- | --- | --- |
| **Reveal** | Split window, Chess window, Moving window | *Where* the moving image shows through the fixed one — pure geometry, rectangles out |
| **Transform** | Pan, Zoom, Window/level, Region window/level | *How* the moving layer is drawn — pure arithmetic on a small state object |

The renderer turns the rectangles into a clip path (`regionsToClipPath`); nothing in this
module knows about canvases.

### Every tool touches the moving layer only

Panning the *fixed* image would silently destroy the registration the reader is
checking. That is the one thing a fusion tool must never do, and it is why the transform
state is explicitly named `MovingLayerTransform`.

### Details that decide whether they feel right

**The split position is a fraction, not pixels.** The divider survives a resize;
storing pixels means the split jumps whenever the panel layout changes.

**Zoom anchors on the cursor, not the viewport centre.** Anchoring at the centre makes
the reader chase the anatomy with pan after every wheel click.

**The lens is clamped inside the viewport.** Half a lens hanging over the border reads
as a rendering bug, and the reader loses the reference frame that makes the comparison
work.

**Region window/level leaves the display alone for a flat region.** Dragging over
background should not blank the image, and a flat region would otherwise produce a
zero-width window.

**A degenerate reveal region is dropped, not emitted.** Some clip implementations render
a zero-size rect as "everything", which would flip the fusion inside out at the end of
the divider's travel.

**Window width is floored at 1.** Zero width divides by zero in every renderer
downstream.

### Not delivered

The Cornerstone3D tool classes that turn pointer events into these calls, and the actual
compositing of the moving layer under a clip path. This is the geometry and the
arithmetic; the viewport integration is the follow-up the package README already flags
for the colormap LUT. Nothing here has been seen in a browser.

## Fusion Modal: validação de par e registro rígido (RTV-134)

`fusionRegistration.ts` (matemática) + `fusionSession.ts` (máquina de estados do modal),
cores puros, sem vtk e sem cornerstone.

**Um ponto dá translação. Só translação.** Marcar o mesmo ponto anatômico nos dois volumes
determina o deslocamento e mais nada — um par de landmarks não carrega informação de
orientação. Um modal que coleta um isocentro e depois apresenta "registro" está afirmando
mais do que sabe. `isocenterAlignment` devolve translação pura e `describeRegistration`
escreve *"apenas translação — um ponto não determina rotação"* no rodapé, porque leitor que
acredita que o alinhamento corrigiu orientação para de procurar o desalinhamento que ainda
está lá.

**Rotacione em torno do CR, não da origem.** É o bug contra o qual o módulo foi desenhado.
Matriz de rotação gira em torno da origem do sistema; a origem do paciente no DICOM está
onde o scanner colocou, muitas vezes a dezenas de centímetros da anatomia. Aplicar `R` e
depois a translação faz o volume descrever um arco com essa distância de braço de alavanca
— o preview salta para fora da tela, e se o leitor "corrige" arrastando o isocentro, o
registro salvo fica errado exatamente pelo tanto que ele arrastou. A composição é
`T(c)·R·T(−c)`, e há teste de que o centro é ponto fixo do resultado — mais um teste que
demonstra o modo de falha, para o guarda não ser vazio.

**Direção da matriz: moving → fixed.** Reamostrar o volume móvel na grade fixa precisa da
*inversa*; trocar isso é o erro de sinal clássico de fusão e parece plausível até o
deslocamento dobrar em vez de cancelar. `invertRigid` explora a rigidez (`Rᵀ`, `−Rᵀt`) em
vez de inverter 4×4 genérica: é exato e deixa a hipótese de rigidez explícita.

**Dois pacientes nunca é fusão** — é erro de paciente errado com uma imagem convincente por
cima. `validatePair` recusa por PatientID divergente **antes** de qualquer outra checagem.

**Mesmo Frame of Reference significa que o registro já existe.** PET/CT de scanner
combinado compartilham FoR UID, e esse UID é a afirmação do scanner de que os volumes já
estão no mesmo sistema. A transformação certa é a identidade e o passo de isocentro é
**pulado**, não oferecido: leitor que cutuca um isocentro aqui está destruindo uma relação
espacial boa e trocando por um clique à mão. É o par de fusão mais comum que existe, então
errar aqui seria a forma mais comum de errar.

**Salvar no PACS é um Spatial Registration Object** (SOP class `…1.1.66.1`) com a 4×4 e os
dois FoR UIDs — não um volume reamostrado nem um screenshot. O registro é o achado; cópia
reamostrada dobra o arquivo e não pode ser desfeita nem refinada depois. Par já registrado
sem ajuste **não gera objeto**: registro que não afirma nada é mais um objeto que todo
leitor a jusante abre e descarta.

Falta: o componente do modal (UIModalService), o preview compositado no cornerstone e o
STOW-RS. Tudo isso é integração; a decisão de o que é fusável, quais passos aparecem e qual
é a matriz está aqui e testada.
