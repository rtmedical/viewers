# @ohif/extension-cardiology

## Função ventricular: volumes, FE e massa (RTV-47)

`cardiacFunction.ts` — `FE = (VDF − VSF)/VDF` é uma linha. Tudo o que decide se duas frações
de ejeção do mesmo paciente significam a mesma coisa está nas convenções em volta, e
**nenhuma delas está registrada nos pixels**.

**O intervalo entre cortes é um erro de 20% esperando para acontecer.** Somação de discos
integra área ao longo da pilha, e a altura de cada disco é a espessura **mais o intervalo**.
Uma pilha rotineira de 8 mm/2 mm perde 20% do volume se o intervalo for esquecido — e parece
tudo certo, porque todo volume do estudo erra pelo mesmo fator e **a fração de ejeção, sendo
razão, não muda**. O erro fica invisível no número que as pessoas conferem e presente nos
números que elas comparam com limiares publicados. `summationOfDisks` exige o intervalo e
recusa sem ele; há teste dos dois lados, inclusive do fato de que a FE não denuncia.

**Músculos papilares são convenção, não medida.** Incluí-los no pool sanguíneo ou no
miocárdio muda a FE em alguns pontos e a massa em 10–20%. Os dois são defensáveis (o SCMR
recomenda excluí-los do pool). O que não é defensável é comparar um seguimento traçado de um
jeito contra um basal traçado do outro — **a mudança é a convenção**. Por isso a convenção é
argumento obrigatório (um default seria uma decisão silenciosa sobre a fração de ejeção de
alguém) e `compareStudies` **recusa** entre convenções. O leitor não tem como ver isso pelas
imagens.

**A escolha do corte basal é o maior termo interobservador.** O plano atrioventricular se
move através do corte basal durante o ciclo, então "este corte é ventrículo ou átrio?" é
respondido diferente por leitores diferentes e diferente em diástole e sístole. É
**registrado, não resolvido** — número cuja maior fonte de erro não tem nome não pode ser
auditado. Contagem de cortes diferente entre as fases também vira aviso.

Massa é medida em diástole por convenção, com densidade miocárdica 1,05 g/mL. Limite inferior
da normalidade da FE é específico por sexo, e por isso sexo é argumento e não constante
escondida num limiar.

## Estenose coronariana e CAD-RADS 2.0 (RTV-50)

`cadRads.ts` — a medida é uma razão de dois diâmetros; a categoria é uma tabela. Três coisas
entre as duas decidem se a resposta está certa.

**Estenose de diâmetro e de área diferem por um quadrado.** 50% de **diâmetro** é 75% de
**área**. O CAD-RADS é definido em diâmetro, e jogar uma redução de área numa tabela de
diâmetro sobe o paciente **duas categorias** — de "leve, sem investigação adicional" para
"grave, considerar angiografia invasiva". As duas estão a uma linha de distância no código e
são indistinguíveis depois que viram um número pelado, então a medida **carrega qual é** e a
conversão acontece aqui. Há teste mostrando as duas leituras da mesma medida caindo em
categorias diferentes.

**O diâmetro de referência é uma escolha, e ela muda a resposta.** Percentual é
`1 − mínimo/referência`, e "referência" pode ser o segmento proximal, o distal ou uma
interpolação. Em vaso difusamente doente a referência proximal está ela mesma estreitada, e
usá-la **subestima** a estenose — exatamente nos pacientes com mais doença. A escolha é
registrada, e proximal em vaso difuso é sinalizado.

**Florescimento de cálcio infla a estenose, e a resposta honesta muitas vezes é "não dá para
dizer".** Cálcio denso floresce na TC e faz o lúmen parecer mais estreito. Passada certa
carga, o segmento simplesmente não é avaliável, e o CAD-RADS tem uma letra para isso: **N**.
Reportar um 70% confiante através de um segmento muito calcificado é o erro característico da
angio-TC, **e manda paciente para cateterismo**. `assessSegment` devolve `N` em vez de
percentual quando a calcificação diz isso — uma recusa que é ela mesma a saída clinicamente
correta.

A categoria do estudo é o segmento mais grave, e **N vence tudo**: "não consegui avaliar um
segmento" é uma afirmação mais forte que qualquer coisa que eu tenha conseguido avaliar,
porque o segmento não avaliado pode ser o pior. Estudo limpo com um DA proximal não avaliável
não é um estudo normal.

## O modelo de segmentos coronarianos (RTV-49)

`coronaryTree.ts` — o `cadRads.ts` (RTV-50) gradua uma estenose. Este é o **mapa contra o qual
ela é graduada**: quais segmentos existem, de qual artéria cada um vem, qual miocárdio cada um
irriga, e onde uma medida deixa de significar alguma coisa.

### Um número de segmento sem o modelo é ambíguo

"Segmento 4" é a descendente posterior direita no modelo SCCT de 18 segmentos e a coronária
direita distal no AHA de 15. **Duas artérias diferentes, um rótulo** — e nada num laudo que
carregue só o número diz qual foi. Uma comparação entre dois exames laudados sob modelos
diferentes compara duas artérias em silêncio.

### A dominância decide de quem é a descendente posterior

Na dominância direita ela vem da coronária direita; na esquerda, da circunflexa. **O território
que ela irriga — a parede inferior — é o mesmo nos dois casos**, e é exatamente por isso que o
erro é fácil: o laudo lê plausível e atribui a lesão ao vaso errado. Quando um teste de estresse
depois mostra isquemia inferior, os dois exames parecem discordar.

### Uma estenose distal a uma oclusão não é uma estenose

Além de uma oclusão total o vaso enche por colaterais, a baixa pressão, e colaba. Medir
porcentagem ali compara uma luz estreita com **uma referência que encolheu junto** — é a mesma
falha da quase-oclusão carotídea (`carotidStenosis.ts`, RTV-54), e produz o mesmo número
tranquilizadoramente moderado para o pior vaso do exame.

### Abaixo de um calibre, uma porcentagem é ruído que gera exame

Uma estenose grave num ramo de um milímetro não é revascularizável e está no limite do que a TC
resolve. Reportá-la **não é conservador** — gera uma investigação a jusante para um achado que
não podia ser medido.

### Segmento omitido não é segmento normal

O `cadRads.ts` já tem o modificador N para o segmento que foi olhado e não pôde ser lido. Este é
o outro caso: aquele sobre o qual **ninguém disse nada**, e que quem lê depois não consegue
distinguir de "sem lesão".
