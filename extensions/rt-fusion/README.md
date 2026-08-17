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

## Correção portal no registro de fusão (RTV-144)

`portalCorrection.ts` — uma imagem portal ou CBCT é casada contra a referência de planejamento;
o casamento produz um deslocamento; alguém decide o que fazer a respeito. **São três fatos
separados**, e o registro precisa mantê-los separados.

### O deslocamento da fusão e o da mesa apontam em direções opostas

O registro responde "como a imagem adquirida precisa se mover para cair sobre a referência". A
mesa responde "como o paciente precisa se mover para cair sobre o plano". São a mesma magnitude
com sinais opostos, e guardar um onde se espera o outro não produz um erro pequeno: **dobra** o
deslocamento, porque a mesa move o paciente para o lado errado exatamente pela quantidade com
que deveria tê-lo movido para o lado certo.

Nada no número resultante parece errado — ele tem o tamanho certo. Por isso a conversão é uma
função nomeada e única, explícita sobre qual direção recebe e qual devolve, e `couchShiftMm` e
`fusionShiftMm` são **campos diferentes** no registro em vez de um campo com uma convenção num
comentário. Mesma família de falha do `couchShifts.ts` (RTV-208), uma camada antes.

### Registrado não é aplicado

O casamento produz uma sugestão. Se a mesa de fato se moveu é outro fato, estabelecido por outra
pessoa em outro momento. Um registro que guarda só o deslocamento lê-se, meses depois, como se o
paciente tivesse sido corrigido — e se o terapeuta decidiu não mover, o resumo do curso está
**silenciosamente errado sobre cada fração em que isso aconteceu**. A decisão é obrigatória, e
recusa sem motivo é indistinguível de esquecimento no registro.

### Corrigir dentro do ruído piora o tratamento

Um desvio de 1 mm medido num sistema com 1,5 mm de reprodutibilidade é majoritariamente erro de
medida. Aplicá-lo move o paciente por uma quantidade aleatória a cada dia: **não faz nada com a
componente sistemática**, que é a que a receita de margem pesa três vezes e meia mais, e
**soma** à aleatória.

### A referência decide o que o número significa

Casamento contra a portal de ontem mede a deriva desde ontem. Contra o DRR mede o deslocamento
em relação ao plano. Os dois são úteis, e **só um deles entra numa análise de erro sistemático**.

### Só a decisão é editável

O deslocamento é o que o casamento produziu; editá-lo transforma uma medida numa opinião sem
registro de qual das duas era. Um casamento diferente é uma correção nova.

## QA de registro rígido multimodal (RTV-196)

`rigidRegistrationQa.ts` — o otimizador ITK vive no sidecar. O `deformableQa.ts` (RTV-199) cobre
campos deformáveis. Este é o caso rígido, que **falha de outro jeito**: um campo deformável erra
dobrando, e uma transformação rígida erra **convergindo numa resposta plausível que é a errada**.

### RM não é geometricamente verdadeira, então um registro rígido CT–RM não pode estar certo em todo lugar

É o fato que decide o que o QA pode honestamente afirmar. Não-linearidade de gradiente e
inomogeneidade de B0 deslocam voxels da RM — fração de milímetro perto do isocentro do magneto,
vários milímetros na borda do túnel. Uma transformação rígida tem **seis graus de liberdade e não
absorve deslocamento que varia no espaço**.

O registro é exato perto do centro e progressivamente errado para fora — e "para fora" é onde
estão o crânio, a superfície cerebral e o pescoço. **Um número único de resíduo faz a média do
centro bom com a periferia ruim e não descreve nenhum dos dois.**

### Determinante negativo é um espelhamento, e nenhum paciente é um espelho

Corpo rígido tem determinante +1. Determinante −1 é um espelho, que **nenhum movimento físico
produz** — significa que um eixo foi invertido em algum lugar, e confusão LPS/RAS entre dois
toolkits é a causa usual. As imagens ainda vão se sobrepor de forma convincente num corte axial
de uma cabeça quase simétrica, com esquerda e direita trocadas. É recusa e não aviso, porque **a
conferência visual que um humano faria é exatamente a que essa falha sobrevive**.

Escala embutida numa transformação declarada rígida também é recusada: é afim rotulada de rígida.

### Anatomia periódica dá ao otimizador uma resposta errada quase igualmente boa

Corpos vertebrais se repetem, então a informação mútua um nível acima ou abaixo é quase tão boa
quanto no nível certo. Um registro de coluna que começou mal converge para um resultado que
**parece correto em todos os cortes** e põe a dose uma vértebra ao lado. Não existe corte em que
isso pareça errado, **porque cada corte casa com uma vértebra**.

### Rígida não corrige postura

Braços para cima contra braços para baixo, pescoço fletido contra estendido: o otimizador devolve
uma transformação de qualquer jeito, certa onde o gradiente de intensidade dominou e errada no
resto — e nada no número diz qual região foi ajustada.

### Fusão visual e transferência de contorno não são o mesmo pedido

Fusão tolera alguns milímetros; transferir contorno ou dose não. A separação importa porque **a
mesma transformação é oferecida para as duas coisas no mesmo diálogo**. Sem landmark humano, a
transferência é bloqueada: similaridade é a função que o otimizador maximizou (RTV-199), e uma
transformação rígida bem-comportada e errada tem exatamente a mesma aparência de uma certa.

### A chave de cache

Precisa incluir o tipo de transformação e o pré-processamento. Uma chave só com as duas séries
devolve uma rígida a quem pediu afim — **e a resposta é plausível, que é o problema inteiro**.
