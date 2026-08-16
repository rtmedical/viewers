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

## Registro de seguimento oncológico CT+CT (RTV-205)

`followUpRegistration.ts` — comparar uma TC com a prévia. Rígido põe o paciente no mesmo
referencial; deformável faz a anatomia de fato se sobrepor. **Os dois são úteis e só um pode
ser medido através**, e inverter isso produz uma avaliação de resposta que é artefato do
algoritmo.

**Um campo deformável flexível o bastante para alinhar a anatomia é flexível o bastante para
comprimir o tumor.** É a tensão inteira. Entre dois exames o paciente perde peso, uma
atelectasia resolve, gás intestinal se move. Rígido não acompanha nada disso e as imagens não
sobrepõem. Deformável acompanha tudo — **e não sabe que o tumor é a única estrutura que ele
não pode seguir**. Registrada deformavelmente, uma lesão em crescimento é parcialmente
*comprimida de volta* na direção da forma prévia. Propague o contorno basal por esse campo e
meça, e você mediu a força de regularização, não a doença.

Então: **rígido para medir, deformável para olhar.** `isMeasurable` impõe isso, e
`propagateContour` devolve o contorno deformado marcado `visualOnly` — a marcação está no
*valor* e não num comentário, porque comentário não sobrevive a ser passado para uma função de
volume.

**O jacobiano diz onde a transformação fez exatamente aquilo que se estava medindo.** O
determinante é a variação local de volume que a transformação aplicou: 1,0 preserva, 0,8 é
20% de compressão. Na região do tumor esse número é a grandeza sob investigação, aplicada
pelo algoritmo. **Uma "resposta" de 30% dentro de um campo que comprimiu 25% não é resposta.**

**Uma boa similaridade global pode esconder um alinhamento local péssimo.** Informação mútua
sobre o tórax é dominada por pulmão e parede torácica; um registro que acerta esses e erra o
linfonodo mediastinal por um centímetro pontua lindamente. Global e local são reportados
**separados, nunca a média** — a média é o número que esconde o problema.

## QA de registro deformável no seguimento oncológico (RTV-199)

`deformableQa.ts` — o RTV-205 registra estudos de seguimento e o RTV-134 cuida da sessão de
fusão. Esta é a parte que decide se um campo de deformação **pode ser usado, e para quê**.

### Similaridade de imagem não valida um registro

Vale dizer primeiro, porque é a métrica de QA que todo mundo alcança: NCC, informação mútua e
parentes **são o que o otimizador maximizou**. Devolver uma delas como evidência de acurácia
mede o quanto o algoritmo se esforçou, não se ele acertou. Um campo deformável com graus de
liberdade suficientes alinha lindamente quase quaisquer duas imagens **movendo tecido para
onde ele nunca esteve**.

As três checagens aqui independem da função objetivo: o **jacobiano**, que é propriedade só do
campo; a **consistência inversa**, que pede às duas direções que concordem entre si; e o **erro
em landmarks**, que pergunta a um humano.

### Um campo que dobra não é uma deformação

Onde o determinante jacobiano é zero ou negativo a transformação não é inversível: o tecido foi
virado do avesso. Não é um erro pequeno, e não parece um — as imagens alinham **porque** o
algoritmo empurrou voxels uns através dos outros. `foldingReport` **localiza**, em vez de dar um
escore global: "0,2% de dobra" não diz ao planejador se a dobra está no GTV ou no ar fora do
paciente.

### Propagar um contorno e depois medi-lo mede o registro

É a falha específica do seguimento oncológico, e é o buraco dentro do qual este ticket existe.
Registro deformável é guiado por intensidade de imagem. No exame de seguimento, **a intensidade
é o que mudou** — essa mudança é o achado. Propagar o contorno da linha de base e ler um
diâmetro dele produz um número que descreve como o algoritmo interpolou, e **o viés é na direção
de "sem mudança"**, porque o campo foi ajustado para fazer os dois exames se parecerem. Que é
exatamente a direção que perde uma progressão. `propagatedMeasurement` recusa, e `measurement` é
`false` no tipo do veredito.

### Dose é padrão mais estrito que contorno

Um contorno propagado é revisado por um humano antes de ser tratado; uma dose acumulada
normalmente não é — ela vira um número numa comparação de planos. Por isso dobra reprova dose
imediatamente, e ausência de landmarks também.
