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
