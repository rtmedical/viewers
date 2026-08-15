# @ohif/extension-rt-pet

Quantificação PET/CT: **SUV/SUL**, **PERCIST 1.0** e **TMTV** (RTV-198).

A aritmética aqui é pequena. Quase todo o código é o conjunto de **recusas** que impedem um
número de ser comparado com outro número com o qual ele não pode ser comparado.

## Tempo de captação é a maior fonte isolada de mudança falsa

O FDG continua se acumulando em tumor muito depois de ter estabilizado em tecido normal. Um
SUV medido aos 90 minutos é significativamente maior que a mesma lesão aos 60 — **sem
nenhuma mudança biológica**. Seguimento escaneado tarde mostra progressão que é o relógio;
escaneado cedo, mostra resposta.

O PERCIST resolve com uma regra dura: os dois exames precisam estar a menos de 15 minutos um
do outro em tempo de captação. Aqui isso é **recusa, não nota** — porque é a falha que mais
muda conduta e é **completamente invisível nas imagens**. Nada na figura diz ao leitor que o
seguimento foi feito meia hora depois.

## SUV por peso é enviesado por gordura, então critério de resposta usa massa magra

Tecido adiposo praticamente não capta FDG, então dividir pelo peso total faz o SUV de um
paciente pesado ler alto em todo lugar. Pior no seguimento: **paciente que ganha 8 kg durante
a quimioterapia mostra alta de SUV sem nenhuma mudança no tumor** — há teste medindo
exatamente isso, e mostrando que o SUL absorve cerca de metade do efeito espúrio.

`suvLeanBodyMass` **recusa** sem altura e sexo em vez de cair para peso corporal: um valor
calculado silenciosamente como SUVbw e rotulado SUL é exatamente a confusão que a distinção
existe para evitar. A massa magra usa Janmahasatian e não James — James é não-monotônico no
peso em IMC alto (a massa magra *diminui* quando um paciente obeso engorda), o que produziria
um SUL subindo por razão puramente mecânica na população em que o SUL existe para ajudar.

## Mensurável antes de respondedor

Uma lesão só conta se estiver mais quente que o fígado do próprio paciente por uma margem
definida: `1,5 × SULmédio(fígado) + 2 DP`. Abaixo disso a captação não se distingue da
variação normal, e "resposta" medida ali é medir ruído. A referência hepática é **por exame**
e não constante, porque se move com glicemia, tempo de captação e reconstrução.

## Duas condições, não uma

Resposta e progressão exigem **30% de variação relativa E pelo menos 0,8 unidades SUL
absolutas**. O piso absoluto existe porque 30% de um número pequeno é um número pequeno:
2,6 → 1,82 SUL é exatamente 30% e é ruído. Reportar isso como resposta parcial é como um
tratamento ganha crédito por um efeito que não teve. Há teste do par: a mesma queda de 30%
numa lesão grande **é** resposta.

Lesão nova é PMD **independentemente da aritmética** — o caminho numérico não alcança essa
conclusão, então é entrada e ramo separados.

## O limiar de TMTV muda a resposta por um fator de dois

Volume metabólico é definido por limiar, e os três em uso — 41% do SUVmax, SUV fixo 2,5, e um
derivado do fígado — discordam em cerca de **2×** no mesmo paciente. Nenhum está errado; são
definições diferentes. O número é **sem sentido sem o método**, então `computeTmtv` não tem
default (quem não decidiu qual definição está usando não fez uma pergunta bem formada) e
`compareTmtv` **recusa** comparar dois volumes calculados de formas diferentes: a diferença
seria definicional, e seria reportada como resposta.

## Falta

Nada disso está ligado: não há detecção do par PET/CT, ROI de fígado, VOI de lesão, mapa por
voxel nem UI. Os valores de atividade, peso, altura, sexo, dose e tempo de captação entram
por parâmetro — ler tudo isso das tags DICOM (0018,1074 RadionuclideTotalDose, 0018,1078
RadiopharmaceuticalStartDateTime, 0010,1030 PatientWeight) é o passo de integração.

Separado da extension `tmtv` do upstream, que não foi modificada.
