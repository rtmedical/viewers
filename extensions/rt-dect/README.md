# @ohif/extension-rt-dect

TC de dupla energia. Hoje: **decomposição de dois materiais e imagens monocromáticas
virtuais** (RTV-87).

Em energias diagnósticas a atenuação é a soma de dois efeitos — fotoelétrico e Compton —
então o µ(E) de qualquer material se escreve como combinação de dois materiais de base. Duas
medidas em dois kVp dão duas equações, e as densidades de base saem de um solve 2×2. Tudo o
que vem depois (mapa de iodo, VNC, VMI, classificação de materiais) é uma leitura diferente
dos mesmos dois números.

## É um problema inverso mal condicionado, e essa é a história de engenharia inteira

A matriz 2×2 vem da atenuação dos materiais de base nos dois espectros. Quando os espectros
são próximos — 100/120 kVp, ou detector de dupla camada mal separado — as colunas ficam quase
paralelas, a matriz fica quase singular, e **o ruído no HU de entrada é amplificado pelo
número de condição** no caminho para as densidades. Uma incerteza de 5 HU vira 50 HU no mapa
de iodo, e o mapa **parece um mapa**: liso, plausível e errado.

`decompose` calcula o número de condição, **devolve sempre** (não só na falha) e **recusa**
acima de 50. Separação espectral não é ajuste de qualidade; é o que torna a medida possível.

O condicionamento é medido na matriz com **colunas normalizadas**. O número de condição bruto
confunde duas coisas completamente diferentes: que o iodo atenua quarenta vezes mais que a
água (isso é *sinal* — é por isso que a decomposição funciona) e que dois materiais de base
apontam quase na mesma direção (isso é a falha). Normalizar deixa só o ângulo entre eles, que
é a pergunta que está sendo feita — e torna a resposta independente das unidades em que as
atenuações de base foram cotadas. Há teste de que reescalar um material de base por 10 não
muda o condicionamento reportado, e outro mostrando que **mudaria** o número bruto.

## VMI a 40 keV não é contraste de graça

Monocromática virtual em keV baixo realça o iodo enormemente — e realça o ruído também,
porque é uma diferença ponderada das duas imagens de base e os pesos crescem rápido quando o
keV cai. O ruído é uma tigela com o fundo perto de 70 keV; abaixo de ~50 keV sobe íngreme.

`virtualMonochromatic` reporta a amplificação de ruído **junto com** a imagem, e
`optimalContrastToNoiseKev` acha o keV que maximiza **CNR**, não contraste. Otimizar contraste
sozinho sempre responde "40 keV" — que é por que tanto protocolo é configurado assim. Um
leitor a quem se mostra uma série de 40 keV sem dizer que o ruído triplicou vai lê-la como se
fosse uma de 70 keV.

## Falta

Mapa de iodo (RTV-85), VNC/VUE (RTV-86), classificação de materiais (RTV-88), caracterização
de cálculos (RTV-89) e redução de artefato metálico (RTV-91) — todos leituras adicionais das
mesmas duas densidades de base. E nada está ligado: não há par de séries dual-energy sendo
detectado, nem slider de keV, nem mapa por voxel.

## Mapa e quantificação de iodo (RTV-85)

`iodineMap.ts` — lê a densidade de base de iodo como concentração em mg/mL e responde a
pergunta que um mapa de iodo de fato recebe: **essa lesão realça?**

**Tudo o que está fora da base é projetado sobre ela.** É a ressalva que importa, e é
propriedade da decomposição de dois materiais, não bug a corrigir. A base é água e iodo. Um
voxel de cálcio não é nenhum dos dois — mas o solve só tem duas direções para expressá-lo, e
o cálcio aterrissa como *um pouco de água mais um pouco de iodo*. Cálcio denso reporta vários
mg/mL de iodo que não estão lá. A consequência é concreta: **cisto renal calcificado lê como
realçante, e realce é a diferença entre "seguimento" e "ressecção".** `iodineConcentration`
marca o voxel cuja atenuação está na faixa do cálcio, e `assessEnhancement` **se recusa** a
chamá-lo de realçante só com o mapa de iodo. Há teste que decompõe cálcio puro pela base
água/iodo e mostra o iodo fantasma aparecendo.

**Abaixo do piso de ruído não há iodo, há ruído.** A decomposição devolve alegremente
0,3 mg/mL para um voxel de água pura, porque o HU de entrada tinha ruído. Renderizar isso
como um blush suave num colormap cria realce onde não existe, exatamente nas lesões de baixo
contraste que se usa mapa de iodo para resolver. Então há um piso, derivado do ruído de
entrada e do **ganho de ruído exato** da decomposição (a norma da linha da inversa, não o
número de condição), e valores abaixo dele voltam como `none` — não como quantidade pequena.
O piso é devolvido para o leitor ver o que o exame conseguia resolver: **com 10 HU de ruído
por voxel num par 80/140 ele fica em torno de 10 mg/mL**, que é o custo honesto da
quantificação voxel a voxel e a razão de ROIs existirem.

**`indeterminate` é uma resposta de verdade**: concentração entre o piso e o limiar significa
que este exame não decide, e dizer isso manda o paciente para uma aquisição sem contraste em
vez de para a cirurgia.

Em ROI, voxels suspeitos de cálcio são **excluídos da média e contados à parte**. Diluí-los
na média é como uma borda de calcificação arrasta um cisto não realçante acima do limiar — e
a média é o número que o radiologista cita.
