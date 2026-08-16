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
