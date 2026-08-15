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
