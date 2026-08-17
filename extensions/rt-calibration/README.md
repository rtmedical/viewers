# @ohif/extension-rt-calibration

Calibração por phantom para o OHIF v3. A calibração de **monitor** (GSDF) é outra coisa e vive
em `@ohif/extension-rt-display-cal`: aquela ajusta como o pixel é exibido, esta define **quanto
ele mede**.

## Calibração por phantom (RTV-138)

`calibration.ts` — calibrar uma imagem **substitui o espaçamento a partir do qual toda medida
seguinte é calculada**. É um ato grande executado por um diálogo pequeno, e tudo aqui existe
para tornar o raio de alcance dele explícito.

### Um comprimento de referência errado é infalsificável por dentro

Se o operador digita 100 mm para uma esfera de 50 mm, toda medida depois disso é exatamente o
dobro — e **perfeitamente coerente consigo mesma**. Nada parece ruidoso, nada contradiz nada, e
a lesão que mede 18 mm é laudada como 18 mm. **Erros consistentes são os que ninguém percebe.**

As defesas são que a referência vem de um **catálogo** e não de um campo de texto livre, e que a
escala derivada é comparada com a que já está na imagem: um fator que nenhuma geometria real
produz é recusado.

### Escopo é o segundo jeito de errar em escala

Um espaçamento medido numa imagem só é conhecido para aquela imagem. Aplicado no nível do estudo
ele passa a reger séries adquiridas com outra distância, outro campo de visão, outro detector.
Ampliar o escopo é decisão de alguém, **nunca um default** — é campo obrigatório, e o resolvedor
sempre prefere a calibração mais estreita que cobre a imagem.

### Em imagem de projeção uma escala só vale num plano

Um phantom sobre a mesa e um vaso vinte centímetros mais fundo têm ampliações diferentes. A
calibração está certa na profundidade do phantom e progressivamente errada longe dela — o que
**não é defeito a corrigir, é propriedade de projetar um cone num plano**. O módulo diz isso em
vez de deixar o leitor supor o contrário.

### A geometria em que foi medida faz parte dela

Mesma regra do `roadmap.ts` (RTV-64): mude a distância foco-detector, a altura da mesa ou o campo
de visão e o número antigo descreve uma cena que não existe mais. Recusar vence escalar algo
plausível, porque **régua errada plausível é usada sem questionamento**.

### A auditoria guarda a régua que foi substituída

Não só a nova. Uma medida contestada seis meses depois só é reconferível se as duas réguas —
a que foi usada e a que ela deslocou — estiverem registradas.

## QA de acelerador: interpretação dos resultados (RTV-129)

`linacQa.ts` — o pylinac faz a análise de imagem no sidecar. O que está aqui é **o que os
números significam depois** que ele os produziu, e a interpretação é onde um programa de QA
silenciosamente para de funcionar.

### Passa e falha são três estados, não dois

O TG-142 dá uma **tolerância** e, separadamente, um **nível de ação**. Dentro da tolerância está
bem. Acima do nível de ação, não tratar. **Entre os dois** está o estado que o programa de QA
existe para pegar: investigar, decidir, e provavelmente tratar enquanto investiga. Colapsar os
três num booleano joga fora a faixa onde quase toda deriva real vive, e deixa um painel que fica
verde até o dia em que fica vermelho.

### Um resultado que passa e está derivando não é o mesmo que um estável

Duas máquinas marcam 1,2% de erro de output. Uma marca 1,2% há um ano; a outra marcava 0,1% no
mês passado. **O valor é idêntico e a segunda estará fora de tolerância em três semanas.** A
separação é a mesma do `setupStatistics.ts` (RTV-208) para erro de setup e do `trendsTimeline.ts`
(RTV-169) para peso: **direção sustentada** e **dispersão** são fatos diferentes, e um desvio
padrão sobre os dois não é nenhum.

Quando a dispersão é grande e a deriva não, o problema é reprodutibilidade da medida — e **não
adianta ajustar a máquina**.

### Re-basear apaga a deriva do registro

Muitas tolerâncias do TG-142 são relativas a uma linha de base do comissionamento. Quando a
máquina deriva e alguém re-estabelece a base, toda leitura futura volta a estar em tolerância e a
deriva **desaparece do histórico — não marcada, desaparecida**. Mesma falha que a lápide do
`treatmentAudit.ts` (RTV-178) evita e que a régua substituída do `calibration.ts` (RTV-138)
registra, e precisa da mesma resposta: a base anterior fica, com motivo, e **quanto de deriva a
mudança absorveu** é registrado para ninguém ter que reconstruir depois.

### Um evento de manutenção é uma descontinuidade, não um ponto

Tendência atravessando uma troca de guia de onda ou uma recalibração de MLC faz a média de **duas
máquinas**. O histórico é segmentado no evento.

### Um número único de Winston-Lutz culpa o acelerador pelo fantoma

O deslocamento medido combina sag do gantry, walkout do colimador, walkout da mesa, o offset do
próprio painel de imagem **e onde o técnico colocou a esfera**. Só os walkouts de eixo se
corrigem ajustando a máquina — e o deslocamento **médio**, que é o número normalmente citado como
"tamanho do isocentro", é dominado pelos dois que não se corrigem.

Citá-lo sozinho culpa o acelerador pelo posicionamento do fantoma, e **manda o físico ajustar
algo que nunca esteve fora**.

### Energia que ninguém mediu não é energia que passou

Um teste em 6 MV não diz nada sobre 10 MV.
