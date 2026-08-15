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

## VNC / VUE — sem contraste virtual (RTV-86)

`virtualNonContrast.ts` — remove a contribuição de iodo e renderiza o que sobra. Vale uma
aquisição inteira de dose: protocolo só em fase portal que ainda produz uma série
"pré-contraste" poupa o paciente do exame sem contraste de verdade. **E esse valor é
inteiramente condicionado a o leitor saber onde a VNC não equivale.**

**VNC perde cálcio sistematicamente.** Cálcio não está na base água/iodo, então o solve o
expressa como água mais *iodo espúrio* — e a VNC subtrai esse iodo espúrio de volta.
Estruturas calcificadas voltam **mais escuras na VNC do que realmente são**, e calcificações
pequenas ou pouco densas somem. Duas consequências, ambas **recusadas** aqui em vez de
deixadas para o leitor:

- **Escore de cálcio (Agatston) na VNC é inválido.** O escore é definido sobre aquisição sem
  contraste verdadeira com limiar de 130 HU; na VNC a mesma placa cai abaixo do limiar ou
  pontua numa faixa menor — e sai **na mesma unidade** de um escore real, que é o que o torna
  perigoso e não apenas errado. `isValidForCalciumScoring()` responde não, sempre, com o
  motivo.
- **Cálculo pequeno pode sumir.** `stoneVisibilityWarning` marca o tamanho abaixo do qual
  ausência na VNC não exclui. O modo de falha é: o cálculo está lá, a VNC não mostra, e o
  leitor conclui que não há cálculo.

**O resíduo não é zero e não é aleatório.** Mesmo em partes moles a VNC não reproduz o HU
sem contraste exatamente — é enviesada alguns HU, e o viés depende do tecido. `vncHu` devolve
uma incerteza junto com o valor, somando em quadratura o viés sistemático (±10 HU de
referência) com o ruído propagado. E o ganho de ruído da base de água é ~2×, que é o
"VNC é mais ruidosa que sem contraste verdadeira" num número.

A consequência incômoda de ser honesto sobre ±10 HU: **na incerteza de referência, a VNC não
consegue fazer a chamada de cisto simples em 20 HU** a menos que o valor esteja abaixo de 0
ou acima de 40. Isso é um achado sobre a VNC, não um defeito da comparação — e é por isso que
`compareToThreshold` compara a 2σ e devolve `inconclusive`, que é a resposta que manda o
paciente para o exame que decide.

A descrição da série derivada carrega o aviso junto com os pixels: quem abrir a série três
meses depois não tem outro lugar de onde tirar isso.

## Classificação de materiais (RTV-88)

`materialClassification.ts` — a razão dual-energy (atenuação em kVp baixo sobre kVp alto)
depende do número atômico efetivo e quase nada da densidade. Água e uma solução diluída de
água têm a mesma razão; água e cálcio não. É isso que faz da razão uma **assinatura de
material** em vez de uma medida de densidade.

**A razão é sem sentido em material de baixa atenuação.** A razão é
`(HU_baixo + 1000)/(HU_alto + 1000)`. Quando os dois se aproximam da água, numerador e
denominador se aproximam de 1000 e **a razão tende a 1 seja qual for o material** — enquanto
o ruído em cada um continua do mesmo tamanho. Uma estrutura de 20 HU tem razão inteiramente
dominada por ruído, e vai classificar como alguma coisa, com confiança. Por isso há um piso
duro de atenuação: sem ele, o overlay colorido cobre as partes moles inteiras e **todo voxel
tem uma opinião**.

**A dupla energia separa ácido úrico de todo o resto. Ela não separa o resto.** É a afirmação
clinicamente estruturante. Ácido úrico (Z≈7) e cálculos cálcicos (Z≈15–20) estão longe e são
distinguíveis de forma confiável. Oxalato de cálcio e fosfato de cálcio **não são**: as
razões se sobrepõem em dose e tamanho clínicos.

E a distinção que importa clinicamente é exatamente a que a dupla energia consegue fazer —
cálculo de ácido úrico dissolve com alcalinização urinária, cálculo cálcico não. Então este
módulo reporta `uricAcid` versus `nonUricAcid` e **se recusa a nomear o mineral**. Um viewer
que imprime "oxalato de cálcio monoidratado" a partir de uma razão está inventando uma
precisão que a física não tem, e um urologista vai agir em cima dela. Não existe banda de
oxalato nem de fosfato no arquivo, e há teste garantindo isso.

**Volume parcial puxa objeto pequeno na direção do meio.** Um cálculo de 2 mm num corte de
3 mm é majoritariamente urina em volume. Abaixo do limite, recusa.

Fora de faixa também é recusa, não a banda mais próxima: a banda mais próxima está sempre
disponível e está sempre errada quando a entrada está fora, que é o que a torna o default
perigoso. Metal é sinalizado como metal, porque ali a decomposição não vale.

`bandsAreSeparable` existe para um serviço que adicione bandas próprias descobrir na hora
que as duas que acabou de adicionar se sobrepõem — em vez de descobrir por um classificador
que oscila entre elas voxel a voxel.

## Caracterização de cálculos renais (RTV-89)

`renalStones.ts` — compõe o que os módulos anteriores estabeleceram nas três coisas que um
urologista de fato usa: **que tamanho**, **do que é feito**, e **a LECO vai funcionar**.

**O tamanho decide o tratamento mais que a composição, e o tamanho depende da janela.**
Passagem espontânea é essencialmente função do diâmetro: quase todo cálculo abaixo de 5 mm
passa, quase nenhum acima de 10 mm passa. Então a medida que dirige a conduta é justamente a
mais vulnerável a uma configuração de display — cálculo medido em janela de partes moles
floresce e lê 1–2 mm maior que o mesmo cálculo em janela óssea, e **1 mm na fronteira de
5 mm move o paciente entre "hidratar e esperar" e "encaminhar"**. Então a janela entra como
parâmetro, é registrada, e a correção é aplicada — em vez de aceitar em silêncio um número
cuja procedência ninguém anotou. Há teste de que a correção muda a faixa de conduta.

**Atenuação prediz LECO.** Acima de ~1000 HU o cálculo resiste à litotripsia extracorpórea e
a ureteroscopia serve melhor. Custa nada calcular e é útil no laudo — mas só faz sentido num
cálculo grande o bastante para não estar sob volume parcial, então herda a mesma guarda de
tamanho da composição. Cálculo pequeno demais recebe `null`, não um palpite.

**Tudo o que a física não pode dizer, ele não diz.** A composição vem do RTV-88, que reporta
ácido úrico versus não-ácido-úrico e se recusa a nomear o mineral — e essa recusa sobrevive
até a frase do laudo. E cálculo visto só em série VNC abaixo do limite de visibilidade
carrega o aviso do RTV-86: ausência na VNC não exclui.

A frase do laudo é montada só com as partes que passaram por suas próprias guardas: cálculo
de composição indeterminada gera uma frase sobre tamanho e nada sobre química, em vez de uma
frase com um buraco de aparência confiante.

## Depósito de urato — gota (RTV-90)

`urateDeposition.ts` — a dupla energia colore urato monossódico de verde e tudo calcificado
de azul, e é genuinamente diagnóstica: tofo numa articulação de radiografia normal muda a
terapia. **É também a aplicação de dupla energia com o problema de falso-positivo mais bem
documentado**, e um módulo que só implementa a coloração implementa os falsos-positivos
junto.

**A gota mora exatamente onde a razão é menos confiável.** O classificador (RTV-88) recusa
abaixo de 100 HU porque a razão degenera para 1 conforme a atenuação se aproxima da água.
Tofos ficam em 130–170 HU — logo acima desse piso, em partes moles, que é precisamente o
regime pior. Essa tensão não se resolve ajustando um limiar; é a razão de as regras de
artefato existirem. A posição honesta é que uma chamada de urato nessa faixa é **candidata**
até sobreviver a elas.

**Os cinco falsos-positivos conhecidos, aplicados como regras e não como rodapé:**

| fonte | assinatura | tratamento |
|---|---|---|
| leito ungueal / pele | queratina tem razão de urato | exclusão por localização |
| pontilhado na cortical | endurecimento de feixe | exclusão por **tamanho E proximidade juntos** |
| movimento | borrão que o módulo não vê | recusa de comparabilidade, marcada pelo chamador |
| artrose avançada / subcondral | verde reconhecido na literatura | exclusão por localização |
| calcificação vascular | atenuação acima da faixa de tofo | exclusão |

Tamanho **e** proximidade juntos porque cada um sozinho joga fora tofo periarticular
verdadeiro — há teste dos dois lados. E a ordem importa: exclusões por localização rodam
**antes** da checagem de material, porque um leito ungueal *de fato* classifica como urato e
o classificador não está errado — está sendo feita a pergunta errada a ele.

**Volume é a medida de desfecho, então o que ele exclui precisa estar visível.** O volume de
urato é o que o seguimento sob terapia hipouricemiante mede. Volume que inclui em silêncio
artefato de leito ungueal **não encolhe quando o paciente melhora, e a terapia parece ter
falhado**. Então o volume excluído e o motivo de cada exclusão viajam junto com o número.

`compareUrateVolumes` recusa quando a **fração excluída** mudou muito entre os dois exames:
um seguimento em que se jogou fora o dobro como artefato não está medindo a mesma coisa, e a
diferença vai ser lida como resposta ao tratamento.
