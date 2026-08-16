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
