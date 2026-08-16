# @ohif/extension-rt-rendering

Advanced rendering for OHIF v3. First feature: **SSD — Surface Shaded Display**
(**RTV-17**).

Follows the **RTV-114** extension-first / zero-fork policy.

## What this does *not* contain

Marching cubes and an STL writer. vtk.js ships **`vtkImageMarchingCubes`** and
**`STLWriter`**, both already bundled — writing either again would be strictly worse.

What was missing, and what lives here:

| Module | Purpose |
| --- | --- |
| `ssdPresets` | The clinical part: which threshold, in what colour |
| `ssdBudget` | The pre-flight that keeps a routine CT from locking the tab |
| `getCommandsModule` | `rtSsdApplyPreset`, `rtSsdSetThreshold`, `rtSsdSetColor`, `rtSsdSetOpacity`, `rtSsdPlan`, `rtSsdExtract`, `rtSsdExportStl`, `rtSsdClear` |

## The threshold is the clinical decision

Not the rendering. 300 HU gives cortical bone; 100 HU pulls in trabecular bone and
calcified plaque; −300 HU sits in the fat/air gap that makes a clean skin envelope;
−700 HU is inside lung parenchyma.

| Preset | HU | |
| --- | --- | --- |
| Cortical bone | 300 | the cleanest skeletal surface |
| Trabecular bone | 100 | includes calcified plaque; noisier |
| Skin surface | −300 | patient outline, for setup checks |
| Lung | −700 | semi-transparent, so vessels stay visible |
| Contrast vessels | 150 | depends on the injection protocol |

These are conventional starting points, not tuned numbers — the slider stays. Dragging
it onto a preset value **snaps the picker back to that preset**, so it does not keep
saying "custom" at exactly 300 HU.

## The pre-flight is the real engineering

The acceptance criterion is "SSD de CT skull renderiza em <10s". Marching cubes is
O(voxels), and 512 × 512 × 400 is **105 million voxels**. Unthrottled that does not
take ten seconds — it locks the tab long enough that the reader reloads the page.

`planSsdExtraction` answers, before anything runs:

- **How many voxels**, and what integer stride brings that under budget. Striding by
  `s` divides the count by `s³`, so stride 2 is already an 8× cut. Capped at 4 —
  past that the surface is blocky enough to mislead, and refusing beats rendering a lie.
- **Roughly how many triangles** come out (~N^⅔ × a shape factor). Deliberately rough:
  the point is distinguishing "a moment" from "a hang", not predicting milliseconds.
- **Whether the volume makes sense to threshold at all.** A Hounsfield threshold is
  only defined on CT. Applying 300 HU to an MR volume is not a worse surface, it is a
  **meaningless** one — the numbers are arbitrary signal intensities — so that is
  called out rather than silently rendered.
- **Whether the slices are anisotropic.** A 5 mm slice CT makes a visibly stepped
  surface, and readers blame the renderer rather than the acquisition.

Errors block; warnings inform. `rtSsdPlan` is cheap, so a panel can call it on every
threshold change to keep the estimate live.

## Scope / follow-ups

- **The viewport actor path is duck-typed and unverified.** `addSurfaceToViewport`
  goes through `viewport.createActorFromPolyData` / `addActor` without importing
  `@cornerstonejs/core`, and returns `false` when the viewport cannot take an actor —
  in which case the command reports that instead of pretending the surface is on
  screen. Whether Cornerstone3D's volume viewport exposes exactly that pair on this
  version has **not** been confirmed against a running viewer.
- **RTV-16 (VIP)** belongs in this package and is not implemented.
- **Not validated in a browser.** The DEV1 box has no memory headroom to build and
  serve the viewer (see `docker/README.md`). The evidence is the unit tests: presets,
  colour parsing, budget arithmetic and the pre-flight rules.

## DSA — Digital Subtraction Angiography (RTV-65)

Subtracts a pre-contrast **mask** frame from every later frame, so what remains is what
changed: the contrast column in the vessels, on a flat grey background.

| Function | Purpose |
| --- | --- |
| `subtractFrame` | Element-wise difference, with gain, offset and inversion |
| `frameStats` / `subtractionWindow` | The window/level the *result* needs |
| `detectMaskFrame` | Picks a pre-contrast frame from the intensity curve |

### Two things that make a naive DSA look broken

**1. The result is signed and centred on zero.** Subtracting two similar images gives
values around 0, mostly negative where contrast darkens the pixel. Keeping the source
window/level renders a uniformly black frame, and the usual reaction is "the subtraction
did not work".

`subtractionWindow` centres on the **background** value, not on the data's midpoint:
after subtraction the vast majority of pixels *are* background, so a naive `(min+max)/2`
centre is dragged around by a handful of extreme pixels and the vessels wash out.

**2. The mask must be a pre-contrast frame.** Subtracting a frame that already contains
contrast erases the vessels instead of revealing them. `detectMaskFrame` reads the
per-frame mean intensity and takes the last frame **before** it drops — contrast is
radio-opaque, so it lowers mean intensity as it fills the field. Not simply frame 0:
runs routinely start a beat or two early, and the opening frames are the noisiest.

The drop has to clear a threshold (2% of baseline by default) to count, so ordinary
frame-to-frame noise is not mistaken for contrast arrival. When nothing clears it, frame
0 is used and the result says `reason: 'firstFrame'` so the panel can tell the reader
the mask was a guess.

### Inverted by default

Contrast *lowers* pixel values in X-ray, so the raw difference is negative in the
vessels. `invert: true` is the default because bright vessels on grey is what
angiographers expect to see.

### Not delivered

The per-frame hook into a Cornerstone3D XA/stack viewport — this is the arithmetic and
the mask logic, applied to plain typed arrays. Nothing here has been run against a real
XA run: the DEV1 PACS has no angiography.

## CPR — Curved Planar Reformation (RTV-14, RTV-61)

Produces the 3D sample positions a renderer reads voxels at, for the three CPR modes
from Kanitsar et al., *Curved Planar Reformation of CT Angiographies* (IEEE Vis 2002).
It does **not** read voxels: keeping the geometry separate from the sampling is what
lets the whole thing be tested without a volume.

| Module | Purpose |
| --- | --- |
| `centerline` | Arc-length resampling and rotation-minimising frames |
| `cpr` | The three modes, and mapping a reformation pixel back to patient space |

### Why not Frenet frames

The textbook answer for "a frame along a curve" is Frenet-Serret. It is the wrong tool
here, and using it is the classic way a CPR ends up looking broken:

- The Frenet normal is defined by the **curvature vector**. Through a straight segment
  curvature goes to zero and the normal is undefined — it spins on noise, and the
  reformation twists like a corkscrew.
- At an **inflection point** the curvature vector flips 180°, so the reformatted image
  mirrors itself mid-vessel.

Vessels are full of near-straight runs and inflections, so both happen constantly.
`rotationMinimisingFrames` uses the double-reflection method (Wang et al., *ACM TOG*
2008): each frame is transported from the previous one with the least possible rotation.
There are tests for both failure modes — no twist along a straight run, no flip through
an S-curve.

### Uniform arc length, not spline parameter

`resampleCenterline` walks the densely-sampled spline at fixed distance. Sampling the
spline in its own parameter instead gives points that bunch on tight curves and spread
on straight runs, and a CPR built on those is stretched and squashed along its length —
so a lesion length measured on it would be wrong.

### The three modes are not cosmetic variants

| Mode | What is true | What is not |
| --- | --- | --- |
| **Straightened** | Cross-sections — measure diameters here | The vessel course is destroyed |
| **Stretched** | Distance along the vessel | Cross-sections are cut obliquely, so diameters read **wide** |
| **Projected** | Spatial context | Foreshortened out of plane; neither diameters nor lengths |

Reading a diameter off a *stretched* CPR is the classic error, which is why
`CPR_MODE_CAVEATS` exists and the panel should show it next to the mode picker.

Mechanically: straightened uses each frame's own normal, so rows are perpendicular to
the vessel. Stretched and projected use a **constant** row direction — that constancy is
exactly what makes distance along the vessel meaningful and cross-sections oblique. The
modes then differ in `rowOffsetsMm`: uniform arc length for stretched, the centerline's
projection onto `up` for projected.

### Measurements can come back

`cprPixelToPatient` maps a reformation pixel to a patient-space position, which is what
an annotation on the CPR needs to be worth anything. Outside the image it returns `null`
rather than extrapolating — a point off the reformation has no defined position, and
inventing one would put an annotation somewhere plausible and wrong.

### Not delivered

The voxel sampling itself, the viewport, and centerline *extraction*. Control points
come from the caller; automatic vessel tracking (Frangi vesselness) is **RTV-62**.
Stenosis analysis along the curve, which RTV-61 also asks for, is not here either.
Nothing has been run against a real angio volume — the DEV1 PACS has no CTA.

## Multi-station stitching (RTV-60)

Whole-body angiography is acquired in stations (pelvis, thigh, calf) that overlap by
design. Composing them into one volume is what makes a whole-body MIP possible.

### The check that has to come first

Stations can only be composed if they share a **`FrameOfReferenceUID`**. That UID is the
DICOM statement that two series' coordinates mean the same thing; without it, their
`ImagePositionPatient` values are numbers in unrelated spaces.

Stitching across frames of reference **does not fail loudly** — it produces a composite
that looks plausible and is geometrically wrong. That is the worst possible outcome for a
study someone will measure a stenosis on, so `planStitch` refuses with a reason rather
than composing. When no station declares one at all, it proceeds but says it is assuming.

### The detail that makes it look right

Concatenating at the overlap boundary leaves a visible seam: the two stations differ
slightly in noise, contrast phase and detector response, and the eye finds a straight
horizontal line instantly. `blendWeightAt` ramps **linearly** across the overlap so the
transition is spread over centimetres.

Linear rather than a smoothstep on purpose: a smooth curve keeps the two stations near
50/50 across most of the overlap, which doubles the noise where the ramp is flattest.
Linear spends the least distance at the noisiest mix.

### Two more decisions

**The output is resampled at the finest station's spacing, not the coarsest.**
Downsampling to the coarse station throws away detail that was acquired — and a
whole-body run is usually finest in the calf, where the vessels are smallest.

**A gap between stations is a warning, not an error.** The composite simply has nothing
there. But it must be said, because *a MIP across a gap looks like an occluded vessel* —
and `contributionsAt` returns an empty list inside the gap rather than inventing a
neighbour's data.

### Not delivered

The resampling and the actual voxel blending: this is the geometry, the plan and the
weights. Also not here: any handling of stations that differ in x/y (mosaicing) — this
composes along the patient axis only, which is what a stepping table produces. Nothing
has been run against a real multi-station run; the DEV1 PACS has no angio.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-rendering/jest.config.js --ci
```

## VIP — Volume Intensity Projection (RTV-16)

`vip.ts` — modo composto entre MIP e volume rendering. Core puro, sem vtk e sem WebGL: é a
implementação de referência com a qual o shader tem que concordar, e é o que dá para
testar — string de GLSL não dá.

**A definição, escrita, porque "entre MIP e VR" não é uma.** O MIP devolve `max(vᵢ)`: é
imbatível para *achar* uma estrutura brilhante e inútil para dizer *onde* ela está — uma
placa calcificada na frente da aorta e outra atrás produzem o mesmo pixel. O VR compõe tudo
e preserva profundidade, mas uma estrutura pequena e brilhante dentro de tecido denso é
diluída até sumir. VIP aqui é o **máximo ponderado pela transmitância**:

```
VIP = max sobre i de ( Tᵢ · vᵢ ),   Tᵢ = Π_{j<i} (1 − αⱼ)
```

`Tᵢ` é quanta luz ainda chega à amostra *i* atravessando tudo que está na frente. Estrutura
brilhante atrás de tecido denso é atenuada na proporção do que ela se esconde atrás, então a
profundidade volta; estrutura brilhante no vazio fica intocada, então a leitura do MIP
sobrevive. E a definição tem uma propriedade que vale ter: **com opacidade tendendo a zero
em todo lugar, VIP vira exatamente MIP** — é generalização estrita, não outra imagem. Tem
teste do limite. O que não consegue enunciar sua relação com o MIP vai ser discutido para
sempre na homologação.

**Opacidade tem que ser corrigida pelo espaçamento de amostragem.** É o bug que faz volume
rendering escurecer misteriosamente. O α de uma função de transferência é opacidade *por
unidade de comprimento* — propriedade do tecido, não de quão fino você amostrou. Aplicar uma
vez por amostra faz dobrar as multiplicações ao dividir o passo pela metade, então a mesma
anatomia renderiza mais escura em qualidade maior; o leitor muda a espessura do slab, a
imagem muda de brilho, e ele conclui que o dado mudou. `correctOpacity` aplica
`1 − (1 − α)^(Δs/Δs_ref)`, e há teste que renderiza o mesmo raio em dois passos e exige a
mesma resposta — mais um que demonstra o erro na versão sem correção, para o guarda não ser
vazio.

**Terminação antecipada é correção *e* orçamento de frame.** Quando `T` cai abaixo de 1/255,
nada mais adiante pode contribuir além de arredondamento, e o laço para. É o que torna os
≥20 fps alcançáveis num CT de tórax, e é também uma afirmação sobre o resultado: amostras
atrás de um raio saturado **não podem** mudá-lo. Testado nos dois sentidos.

`planVip` reporta o passo que cabe no orçamento em vez de aplicá-lo em silêncio: projeção
renderizada caladamente a 3 mm quando o leitor pediu 0,5 parece outro dataset, e a única
coisa pior que um render lento é um render rápido e errado sobre o qual ninguém foi avisado.

Falta: o shader GLSL no vtk.js volume mapper e o registro do modo no viewport. O que
existe aqui é a matemática, os três presets clínicos (osso, vascular, tecido) e o pré-voo
de performance.

## Frangi — realce de vasos (RTV-62)

`frangi.ts` — estrutura tubular tem assinatura característica no Hessiano: um autovalor
pequeno ao longo do vaso e dois grandes, de mesmo sinal, atravessando. A fórmula é curta e
amplamente publicada. **Quatro coisas em volta dela decidem se a implementação acha vasos ou
não acha nada**, e as quatro erram em silêncio — o filtro sempre produz *algum* número.

**O sinal é a diferença inteira entre vasos e o complemento deles.** Para vaso **claro** em
fundo escuro, os dois autovalores transversais são **negativos**. Sem a checagem de sinal o
filtro responde a tubos escuros — vias aéreas em vez de artérias, e numa TC com contraste
isso é um resultado confiante, liso e completamente errado. `vesselness` recebe a polaridade
explicitamente, **sem default**, e devolve exatamente zero para a polaridade errada em vez de
um positivo fraco (positivo fraco vira problema de limiar; zero é rejeição limpa).

**Sem normalização por γ, a maior escala sempre vence.** Derivadas segundas de gaussiana
mudam de magnitude com σ, então escalas cruas não são comparáveis e o máximo é decidido pela
aritmética e não pela anatomia. Multiplicar por `σ²` torna comensuráveis — e é isso que
permite o **argmax sobre escala ser uma estimativa de calibre**.

**`c` depende dos dados e um valor fixo torna o filtro inútil.** O termo de estruturidade
suprime fundo usando `c`, que precisa ser cerca de metade da norma máxima do Hessiano *neste
volume*. Constante calibrada num dataset mata silenciosamente a resposta noutro com faixa de
intensidade diferente — e a falha **parece "não há vasos aqui"**, não parece bug.

**Uma escala acha um calibre.** Filtro de escala única não é filtro de vasos; é filtro de
vasos de um tamanho. `multiscaleVesselness` maximiza sobre escalas **e devolve o σ vencedor**,
então quem chama ganha o calibre de graça em vez de rodar três vezes e jogar essa informação
fora. Há teste com cilindros sintéticos de raio 1 e 5 mostrando o σ vencedor acompanhando.

Autovalores por solução analítica (Smith) e não iterativa: isso roda uma vez por voxel por
escala, e um solver iterativo poria um laço de convergência na posição mais interna do filtro
inteiro.

Falta: a extração de centerline a partir do mapa de resposta (o `centerline.ts` do RTV-14 já
consome pontos, então a costura existe), a ligação com um volume carregado, e a UI.

## Eliminação virtual de osso (RTV-63)

`boneRemoval.ts` — tirar o esqueleto de uma angio-TC para os vasos aparecerem. A versão
ingênua é uma linha — limiar e apagar — e é errada de um jeito que produz uma imagem limpa e
confiante **de uma artéria que não está lá**.

**Artéria realçada e osso cortical ocupam a mesma faixa de Hounsfield.** No pico arterial uma
carótida tem 350–500 HU; osso cortical tem 400+. **Não existe limiar que separe os dois**, e
o que se escolhe remove as partes mais brilhantes do vaso junto com o osso. A consequência não
é sutil e é invisível no resultado: um segmento da carótida interna some na base do crânio e a
imagem mostra uma oclusão. A sifão carotídeo é **ao mesmo tempo onde o limiar falha pior e
onde o achado mais importa**, porque ali o vaso corre dentro do osso.

**Conectividade é o que torna o limiar tolerável.** Osso é uma estrutura grande e conectada;
um voxel brilhante dentro do lúmen não está conectado ao esqueleto, então crescer a máscara a
partir de sementes ósseas deixa o vaso em paz — *exceto onde eles se tocam*.

**E onde se tocam, o crescedor não para na fronteira: ele desce pelo vaso e o absorve.** Então
procurar "máscara ao lado de tecido brilhante fora da máscara" **não acha nada justamente no
caso que importa**, porque a essa altura o vaso já está dentro da máscara. É uma armadilha
real, e a primeira versão deste arquivo caiu nela — os testes pegaram.

O que identifica o risco é a **atenuação dos voxels mascarados**. Osso cortical inequívoco
está acima de 600 HU; tudo o que a máscara engoliu entre 300 e 600 está na faixa em que
artéria realçada e osso são indistinguíveis, e pode ser vaso. `findAtRiskVoxels` reporta isso
e também o caso de encostar sem fundir, que continua acontecendo.

**Quando há dupla energia, esta abordagem inteira é a errada.** Iodo e cálcio têm assinaturas
espectrais diferentes, e os módulos do `rt-dect` separam os dois de verdade — sem limiar, sem
conectividade, sem ponto cego na base do crânio. `recommendApproach` diz isso, em vez de
deixar uma heurística de energia única ser usada sobre dado que suporta coisa melhor.

## Polígono de Willis (RTV-53)

`circleOfWillis.ts` — descrever quais segmentos estão presentes é fácil e, sozinho, quase
inútil. A razão de reportar é a frase seguinte: **o que acontece com este paciente se um vaso
ocluir.**

**Círculo incompleto não é achado.** Um círculo completo de livro existe em algo como 40–50%
das pessoas. Reportar "círculo de Willis incompleto" como anormalidade é reportar variante
normal como patologia — enche o laudo de ruído e treina o leitor a pular a linha. O que vale
reportar é a variante que **remove uma via colateral que o paciente teria**.

**PCA fetal é a que muda o que uma oclusão de carótida faz.** Normalmente a cerebral posterior
é alimentada pela basilar via P1. Na configuração fetal o P1 é ausente ou hipoplásico e a PCA
é alimentada pela comunicante posterior — ou seja, **pela carótida interna**. A consequência é
o achado: oclusão carotídea nesse paciente ameaça o lobo occipital além do território da
cerebral média, e o planejamento de trombectomia muda. Reportar "P1 hipoplásico" sem dizer
isso é reportar a anatomia e reter o ponto.

**A1 ausente faz os dois lobos frontais dependerem de uma carótida só.** Com um A1 ausente ou
hipoplásico, as duas cerebrais anteriores enchem pela outra carótida através da comunicante
anterior — e a oclusão daquela carótida vira infarto anterior bilateral. A mesma assimetria é a
associação clássica com aneurisma de comunicante anterior, porque todo o fluxo cruzado passa
por ela.

**Hipoplásico conta como não funcional.** Um A1 de 0,8 mm é visível na angio e não carrega
nada sob carga. Tratá-lo como presente porque dá para ver é como um laudo diz que a colateral
existe quando ela não existe. A palavra usada no texto continua distinguindo os dois, porque
não são a mesma anatomia.

## Roadmap dinâmico: máscara mantida sobre fluoroscopia ao vivo (RTV-64)

`roadmap.ts` — o `dsa.ts` (RTV-65) subtrai **dentro de uma corrida gravada**, que o operador
depois revisa. Roadmap é o caso intervencionista e é outro problema: a máscara é adquirida uma
vez, de uma injeção de contraste, e depois **mantida por minutos** enquanto o operador avança
um fio-guia contra ela sob fluoro ao vivo.

### Um roadmap velho não parece quebrado — parece um roadmap

É a razão inteira do módulo existir. Numa corrida de DSA revisada, o desalinhamento aparece
como bordas duplas óbvias e o leitor desconta. No roadmap, o mapa vascular é um overlay liso
sem nada com que comparar, então quando o paciente escorrega na mesa, ou a mesa panoramiza, ou
o arco-C gira, o overlay continua desenhando vasos **onde os vasos não estão mais** — e o
operador está guiando um fio por ele.

Por isso qualquer mudança de geometria além da tolerância **invalida a máscara
automaticamente**. Não é um banner de aviso sobre um overlay ainda renderizado: `applyRoadmap`
**se recusa a produzir imagem**. Um aviso ao lado de um roadmap plausível é um aviso lido
depois que o fio já foi para algum lugar.

### Invalidar custa, então o motivo tem que ser específico

Máscara nova significa outra injeção de contraste e mais dose num paciente que já está na mesa
sob fluoro. Descartar o roadmap por algo que um deslocamento de pixels resolveria não é de
graça. `geometryChange` separa os dois casos:

| mudança | consequência |
|---|---|
| translação da mesa no plano | **corrigível por deslocamento** — sem contraste, sem dose |
| rotação, altura, DFD, campo de visão | **máscara nova** — a projeção mudou |

`shiftMask` **recusa** no segundo caso. Um deslocamento escolhido porque "ficou melhor" sobre
uma rotação alinha uma região e desalinha o resto: convincente localmente, errado globalmente,
o que é pior que um overlay obviamente velho.

### Deriva por imagem é sinal fraco, e está rotulada como tal

`maskDrift` correlaciona o quadro ao vivo com a máscara, mas um fio-guia cruzando o campo
também derruba a correlação, e movimento lento do paciente quase não a derruba. É checagem
secundária. **A comparação de geometria é a que decide** — e a máscara antiga demais gera um
aviso justamente porque movimento lento nunca aparece na geometria da mesa.

## Bolus tracking: a decisão de disparo (RTV-66)

`bolusTracking.ts` — fica ao lado do `dsa.ts` e do `roadmap.ts` porque pertence à mesma
família: o que o contraste está fazendo, e o que o equipamento deve fazer a respeito. Os
quadros de monitoramento e o handshake com o scanner não estão aqui.

### A ROI de disparo é posicionada uma vez, antes de haver contraste para ver

Tudo depois depende dela e nada depois consegue conferi-la — por isso `validateRoiBaseline`
roda primeiro. Uma ROI que pega a parede aórtica, uma placa calcificada ou um stent tem linha de
base alta e heterogênea: se o protocolo dispara por valor absoluto, ela dispara **antes** de o
contraste chegar; se dispara por realce acima da base, o realce é medido a partir do chão
errado. Uma ROI com um canto no pulmão tem o problema oposto e dispara tarde.

**Nenhuma das duas falhas se anuncia.** O exame roda, as imagens saem, e o único sinal é a
artéria mal opacificada — o que se lê como injeção ruim.

### Disparo e varredura não são o mesmo instante

Entre o disparo e o primeiro corte diagnóstico há movimento de mesa e a instrução de apneia:
vários segundos em que o contraste continua subindo ou, numa circulação rápida, já passou do
pico. Reportar o realce **no disparo** responde à pergunta errada. O módulo extrapola a
inclinação através do atraso e diz como a aorta vai estar quando a varredura de fato começar.

### Um quadro acima da linha não é uma chegada

Quadros de monitoramento são de baixa dose e ruidosos. Um único acima do limiar pode ser ruído,
e disparar nele começa a aquisição antes de o contraste estar lá: exame não diagnóstico,
repetido com outra carga de contraste e outra dose. A subida precisa ser sustentada.

### Não disparar também custa

Abortar é a direção segura e **não é de graça**: disparo perdido significa repetir o exame, com
mais contraste e mais dose, num paciente cuja função renal costuma ser o motivo de o protocolo
ser cuidadoso. Por isso o aborto diz qual dos dois foi — o bolus não chegou, ou o monitoramento
acabou enquanto ele ainda subia.

`delta` e `absolute` coexistem em protocolos reais e **dão respostas diferentes no mesmo
paciente**, então a escolha é explícita e não tem default implícito.
