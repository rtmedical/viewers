# @ohif/extension-thorax-abdomen

Análise de tórax e abdômen. Hoje: **Lung-RADS v2022** (RTV-68).

A metade de detecção do RTV-68 é um sidecar MONAI e não está neste repositório. O que está
aqui é a metade que decide o que acontece com o paciente: transformar um nódulo medido em
categoria e conduta.

## A regra de medida faz parte da classificação

O Lung-RADS classifica pela **média dos eixos maior e menor, arredondada ao milímetro
inteiro**. Não é detalhe de exibição: um nódulo de 7,2 × 4,1 mm tem média 5,65, que
arredonda para 6 — categoria 3, TC em 6 meses — enquanto o mesmo nódulo comparado sem
arredondar fica na categoria 2 e volta para rastreamento anual. O arredondamento acontece
antes de qualquer comparação, porque é o que a norma diz e porque as duas ordens discordam
exatamente nos limiares onde isso importa.

## Nódulo parcialmente sólido é classificado pelo componente sólido

O tamanho total só estabelece o piso. Um parcialmente sólido de 12 mm com componente sólido
de 3 mm é 4A; o mesmo total com componente de 9 mm é 4B — território de biópsia.
Classificar parcialmente sólidos pelo tamanho total é o jeito mais fácil de subestimar um
câncer aqui, e é o que uma tabela ingênua "tamanho → categoria" faz. Parcialmente sólido
≥ 6 mm **sem** medida do componente é recusado, não classificado pelo total.

## Baseline, novo e em seguimento são três conjuntos de regras diferentes

O mesmo nódulo sólido de 5 mm é categoria 2 no baseline e categoria 3 se for novo. Não há
padrão seguro, e o padrão tentador é o inseguro: assumir baseline subestima todo nódulo novo
entre 4 e 8 mm. `classifyNodule` **recusa** sem contexto explícito em vez de assumir um.

## A categoria sem a conduta é um convite a chutar

Ninguém conduz paciente a partir de um número. Todo resultado carrega o intervalo de
seguimento e a ação, e o modificador 4X carrega o motivo do escalonamento — escalonamento
sem explicação é escalonamento que o leitor desfaz em silêncio. O 4X só se aplica sobre 3,
4A ou 4B: escalonar um nódulo definitivamente benigno porque parece espiculado é uma
contradição que o leitor tem que resolver, não algo que a tabela deva encobrir.

A categoria do exame é o **nódulo mais suspeito**. A categoria 0 não entra nesse máximo: é
override, porque "não consegui ver parte do pulmão" vale mais que qualquer coisa que eu
tenha visto.

## Falta

Detecção (sidecar MONAI/LIDC-IDRI), o painel do formulário Lung-RADS, o overlay de
segmentação e o export DICOM SR.

## Endoscopia virtual: centerline, trajeto de câmera e cobertura (RTV-71)

`virtualEndoscopy.ts` — o fly-through em si é uma câmera perspectiva vtk.js e pertence ao
viewport. O que pertence aqui é a parte que decide **por onde a câmera passa** e, mais
importante, **o que ela nunca viu**.

### Uma passagem não vê a superfície inteira, e esse é o achado

A falha característica da colonoscopia virtual não é uma imagem ruim, é um **ponto cego**: o
lado de trás de uma prega haustral fica oculto para uma câmera voando anterógrado, e uma lesão
ali não é sutil nas imagens — ela está **ausente** delas. Um leitor que completou o fly-through
viu o cólon inteiro no sentido de que a câmera o percorreu de ponta a ponta, e é exatamente por
isso que a lacuna é perigosa.

Daí `surfaceCoverage`, que mede a fração da parede que esteve de fato em campo, e
`bidirectionalCoverage`, que mostra o que a segunda passagem acrescenta *nesta anatomia* em vez
de citar a literatura. **É o único número do módulo capaz de contradizer a impressão de
completude do leitor.**

### A centerline não é o caminho mais curto

O caminho mais curto entre dois pontos num lúmen curvo abraça a face interna de cada curva e
põe a câmera na mucosa — onde a vista é inútil e, pior, onde a parede oclui o segmento adiante,
e o leitor passa voando por um trecho de cólon que não viu. O Dijkstra aqui é ponderado por
distância-à-parede: um passo perto do eixo é barato, um passo perto da mucosa é caro. O
resultado é mais longo e fica dentro. Há teste comparando com o caminho não ponderado.

### Um fly-through contínuo não prova um lúmen contínuo

Onde o cólon está colabado, ou onde uma alça encosta em delgado adjacente, a busca de caminho
atravessa alegremente. A câmera então sai do cólon e entra em outro órgão sem nada no vídeo
parecer errado. `validatePath` reporta o perfil de raio e marca as cinturas, porque um raio
subitamente próximo de zero é a assinatura das duas falhas.

### Nada pode ser medido na vista endoluminal

Tamanho aparente sob câmera perspectiva é função da distância, e FOV largo ainda acrescenta
distorção de barril: um pólipo de 6 mm perto e um de 12 mm ao dobro da distância ocupam o mesmo
ângulo. O tamanho do pólipo decide polipectomia versus intervalo de três anos, então o número
tem que vir das imagens de origem. `measureFromEndoluminalView` recusa e diz onde medir.

### Detalhe de digitalização que vale saber

O voxel exterior mais próximo de um disco digitalizado é **diagonal**, não axial: para um disco
de raio 5 é (5,1) a 5,10 mm, não (6,0) a 6 mm. O raio de lúmen reportado corre um pouco abaixo
do nominal, e um limiar de cintura fixado no raio nominal dispara num tubo exatamente daquele
calibre.

## Volume e densidade de órgãos abdominais (RTV-72)

`abdominalOrgans.ts` — a segmentação em si é um sidecar Python. Esta é a parte que transforma
uma máscara em números que um radiologista pode pôr no laudo, e **a parte que se recusa a
transformar**.

### Uma atenuação sem fase de contraste é um número sem unidade

Um fígado a 55 HU é normal sem contraste e nitidamente anormal na fase portal. Os mesmos três
dígitos, e a diferença entre "nada a dizer" e "esteatose significativa, mencione". Reportar
densidade de órgão sem a fase não é uma medida incompleta — é uma **medida ininterpretável**.
Os limiares de esteatose se recusam a rodar fora da fase em que foram derivados: aplicá-los a um
fígado em fase portal produz um grau que varia com **a velocidade com que o contraste foi
empurrado**.

A diferença fígado-baço é preferida quando há baço porque **normaliza por kV, kernel e tamanho
do paciente** — o número absoluto não normaliza.

### A precisão do volume não é a mesma para um fígado e uma adrenal

Contagem de voxels erra na borda, por cerca de meio voxel para cada lado, e o tamanho desse erro
em relação ao órgão é dado pela razão superfície/volume. **O mesmo contorno dá um volume
hepático bom a uma fração de por cento e um volume adrenal bom a talvez dez.** Imprimir os dois
com a mesma casa decimal afirma uma precisão que um deles não tem.

### Uma média sobre o órgão inteiro responde a uma pergunta que ninguém fez

Um fígado com um cisto grande, um rim incluindo o sistema coletor opacificado: a média cai entre
as duas populações, num valor que **não descreve nenhuma**. Mediana e intervalo interquartil
saem por isso, e dispersão larga é sinalizada em vez de ser mediada.

### Vazamento move dois órgãos em direções opostas

Uma segmentação que escorre do fígado para o baço infla um e deflaciona o outro na mesma medida.
**O total é preservado**, então uma conferência de "está tudo somando" passa. A borda
compartilhada é a única pista disponível a partir das máscaras — pista, não prova: órgãos se
tocam mesmo.

## Diâmetro aórtico e índice muscular (RTV-74)

`aorticDiameter.ts` + `muscleIndex.ts`. A segmentação é um sidecar; estas são as **medidas**, e
é na medida que mora o erro que chega no paciente.

### Uma medida axial superestima uma aorta angulada, e o limiar de encaminhamento não sabe disso

A aorta raramente é perpendicular ao plano axial. Onde ela corre inclinada, a secção axial é uma
elipse cujo eixo maior é o diâmetro verdadeiro **dividido pelo cosseno** do ângulo. A trinta
graus isso é quinze por cento: um aneurisma real de 4,8 cm mede 5,5 cm — que é o número no qual
um paciente é encaminhado para correção.

A medida **não é ruidosa**: é consistente e previsivelmente grande demais, e parece uma medida
cuidadosa **porque é uma** — da grandeza errada. O módulo mede no plano normal à linha central e
diz quanto a medida axial teria somado, para que a diferença possa ser mostrada em vez de
discutida.

### Parede externa ou luz não é detalhe

Um saco aneurismático forrado de trombo tem uma luz muito mais estreita que o aneurisma. Medir a
luz produz **um número tranquilizador para uma aorta perigosa**. A convenção é campo
obrigatório, e a comparação com o exame anterior é recusada entre convenções diferentes — a
mudança relatada seria a convenção, não a aorta.

### Taxa de crescimento em intervalo curto é quase toda ruído

A variabilidade entre observadores num diâmetro aórtico é de uns dois milímetros. Dois
milímetros em três meses anualizam para oito milímetros por ano, bem acima do limiar de
encaminhamento urgente — **e o paciente não cresceu um aneurisma**: o segundo radiologista pôs o
paquímetro num lugar ligeiramente diferente. **O intervalo pesa mais que a diferença.**

O limiar difere por sexo, e usar o masculino numa mulher deixa um aneurisma de 5,2 cm abaixo da
linha quando está acima da dela.

### O corte e a janela fazem parte da definição do índice muscular

Os pontos de corte de sarcopenia vêm de coortes medidas num **único corte de L3**, porque a área
muscular ali correlaciona com a massa muscular corporal. Em L2 ou no disco L3–L4 a área é outra e
o corte não se aplica — o número ainda é uma área de músculo, só não é a que o limiar descreve.

A janela de −29 a +150 HU também é definição, não preferência de exibição: é o que separa
músculo da gordura intramuscular abaixo e do contraste e osso acima. **Alargá-la para "ficar bom"
inclui gordura em silêncio, e um paciente sarcopênico deixa de ser sarcopênico.**

Sem altura não há índice — um índice calculado a partir de uma altura presumida é **um número com
cara de medida**.

## Métricas de via aérea e densitometria pulmonar (RTV-70)

`airwayMetrics.ts` — a segmentação é um sidecar. Esta é a medida, e medida de via aérea tem uma
propriedade que a torna especialmente fácil de publicar errado: **o número depende da
reconstrução tanto quanto do paciente**.

### Espessura de parede é propriedade do kernel tanto quanto do brônquio

Kernel duro realça a borda, então a parede parece **mais fina** e melhor definida. Kernel suave
borra, então parece **mais grossa**. Mesmo paciente, mesma aquisição, duas séries reconstruídas
do mesmo dado bruto — e a porcentagem de área de parede difere mais do que a maioria das doenças
a move.

**Nada na imagem diz qual você está olhando.** Por isso o kernel viaja junto com a medida, e a
comparação entre kernels é recusada: a mudança relatada seria a reconstrução.

### O Pi10 existe porque a área de parede depende do tamanho da via aérea

Um brônquio segmentar e um subsegmentar têm frações de parede diferentes num pulmão saudável,
então "a porcentagem de área de parede" não significa nada sem dizer qual via aérea. O Pi10 — a
raiz da área de parede de uma via aérea hipotética de 10 mm de perímetro interno, lida de uma
regressão sobre muitas vias — remove a dependência do tamanho.

**Ele não remove a dependência do kernel**, e é rotineiramente tratado como se removesse.

### Abaixo do limite de resolução a espessura da parede é a função de espalhamento

Com dois milímetros de luz, a parede tem poucos voxels e a maior parte da espessura aparente é
volume parcial. A medida ainda devolve um número, e o número ainda varia entre pacientes — **só
varia com como o borrão caiu**. Abaixo do piso o módulo recusa, em vez de contribuir ruído para
a regressão.

### Calibre muda com o volume pulmonar, e apneia ruim parece doença

Vias aéreas estreitam conforme o pulmão esvazia. Comparar um exame inspiratório com outro em que
o paciente não inspirou bem mostra um estreitamento que é a apneia. O mesmo confundidor corre no
sentido inverso para aprisionamento aéreo: **expiração incompleta deixa o pulmão parecendo menos
aprisionado**, e o viés aponta para o resultado tranquilizador.

Aprisionamento aéreo na expiração e enfisema na inspiração são **a mesma conta em aquisições
diferentes** — rodada na errada, o número sai plausível e descreve outra coisa.

## Cálculos, hidronefrose e cobertura do urograma (RTV-73)

`renalUrogram.ts` — a segmentação é um sidecar e os volumes de órgão vivem em
`abdominalOrgans.ts`. O que está aqui é o raciocínio específico do trato urinário, e é quase
todo sobre **os jeitos pelos quais um número confiante deixa de significar o que diz**.

### A atenuação de um cálculo é propriedade da espessura de corte

Composição por unidade Hounsfield supõe que a atenuação de pico pertence ao cálculo. Em cortes
grossos ela não pertence: um cálculo de quatro milímetros num corte de cinco é mediado com a
urina e a gordura em volta, e o pico volta **centenas de unidades baixo**. Um cálculo de cálcio
então lê na faixa do ácido úrico — que é justamente a chamada que muda a conduta, porque ácido
úrico dissolve com alcalinização e cálcio não.

A falha escala com a razão, então **bate mais forte nos cálculos pequenos** — e é neles que a
decisão clínica ou cirúrgica está em aberto. O módulo recusa em vez de classificar, e aponta
para a dupla energia (RTV-89), que separa por material e não por atenuação.

### O diâmetro máximo depende do plano em que você olhou

Previsão de eliminação usa diâmetro máximo, e um cálculo alongado no eixo crânio-caudal mede
pequeno em todo corte axial e grande no reformatado coronal. Medir só no axial **não é
impreciso, é enviesado para menor** — e menor é a direção que prevê eliminação espontânea.

### Dilatação não é obstrução, e obstrução nem sempre dilata

Pelve extrarrenal é larga num rim normal. Obstrução precoce ou já descomprimida quase não dilata.
Graduar pelo diâmetro pélvico sozinho erra os dois casos, **em direções opostas**. Os cálices
decidem o grau; o parênquima diz há quanto tempo aquilo dura — e parênquima fino significa que
a função daquele rim provavelmente não recupera com a desobstrução, o que só uma medida
**absoluta** de função responde (a relativa, do RTV-209, não).

### Um ureter que nunca opacificou não é um ureter normal

O urograma exclui falha de enchimento **apenas nos segmentos que encheram**. "Sem falha de
enchimento" escrito sobre um segmento não opacificado é uma afirmação sobre o tempo do contraste
que se lê como afirmação sobre o ureter. O módulo lista o que **não** foi avaliado em vez de
omitir.
