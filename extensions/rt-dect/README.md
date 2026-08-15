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
