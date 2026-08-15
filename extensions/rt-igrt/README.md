# @ohif/extension-rt-igrt

Radioterapia guiada por imagem (RTV-208): detecção de CBCT, correções de mesa a partir de um
registro, e margens de setup por van Herk.

## Um erro de sinal move o paciente para o lado errado, pelo dobro do erro

O registro está em coordenadas de paciente do DICOM (**+x esquerda, +y posterior, +z
superior** em HFS). A mesa é descrita no vocabulário IEC 61217 que o técnico de fato digita
(**vertical, lateral, longitudinal**). **Não são os mesmos eixos e não têm os mesmos sinais**,
e um erro de 4 mm aplicado ao contrário deixa o paciente 8 mm fora.

Não há como tornar isso seguro sendo cuidadoso no chamador. Então o mapeamento mora aqui, uma
vez, com a **posição do paciente como argumento obrigatório** — `couchShifts` recusa sem ela
em vez de assumir head-first supino, porque prono e feet-first invertem sinais e são
exatamente os casos que ninguém testa.

**O sinal da correção é oposto ao do deslocamento medido.** O registro diz onde o paciente
*está* em relação ao que o plano espera; a correção é o que cancela isso. Reportar o
deslocamento num campo rotulado "correção" é o segundo jeito de mandar o paciente para o lado
errado, e é invisível porque os dois números têm a mesma magnitude. O resultado carrega os
dois, com nomes diferentes, e o readout imprime **o que se aplica**.

**Ângulos de Euler só são seguros porque rotações de setup são pequenas.** A decomposição
depende de convenção e é instável perto de gimbal lock. Um registro que deu errado produz
exatamente os ângulos grandes onde ela quebra, então o resultado *avisa* quando está perto do
caso degenerado em vez de devolver um trio confiante. E ler o yaw de `r01/r00` em vez de
`r10/r00` devolve o ângulo **negado** — o transposto da convenção pretendida, um erro de sinal
numa rotação de mesa. Foi o que os testes pegaram nesta implementação.

Detecção de CBCT é heurística por necessidade (não existe tag dizendo "isto é imagem de
setup"), então as regras que casaram são **reportadas**, não colapsadas num booleano: o modo
de falha é uma TC diagnóstica virar imagem de setup, e o leitor precisa ver *por quê*.
Fabricante sozinho nunca basta — uma TC diagnóstica de Varian continua sendo diagnóstica.

O registro de aprovação **recusa** correção acima do limite de tolerância sem override
explícito: um log de aprovações que inclui correções que ninguém deveria ter aplicado é pior
que log nenhum, porque é um registro de que a conferência foi feita.

## Sistemático e aleatório são erros diferentes e só um deles é corrigível

É a distinção em que a análise inteira se apoia, e ela **desaparece** se os desvios forem
agrupados num único desvio padrão.

- **Sistemático (Σ)** — a *média* dos desvios de um paciente. É o mesmo todo dia, desloca a
  distribuição de dose inteira, e é **corrigível**: um ajuste conserta todas as frações
  restantes.
- **Aleatório (σ)** — o *espalhamento* em torno da própria média. Borra a distribuição em vez
  de deslocá-la, e **não é corrigível**, só margem.

Σ é o desvio padrão **das médias** por paciente; σ é a raiz quadrática média **dos desvios
padrão** por paciente. Um desvio padrão sobre todos os shifts jogados juntos não é nenhum dos
dois — **e é o que uma planilha produz por padrão**. Há teste mostrando que o valor agrupado é
maior que os dois.

## A receita pesa os dois muito diferente, e é esse o ponto

```
M = 2,5 Σ + 0,7 σ
```

Erro sistemático pesa **três vezes e meia** mais. Um serviço que reduz o espalhamento aleatório
e deixa um desvio sistemático no lugar praticamente não moveu a margem — e a receita diz isso
**numericamente**, que argumenta melhor que uma afirmação. As duas contribuições voltam
separadas exatamente por isso.

Média de grupo diferente de zero dispara alerta próprio: isso é **problema do processo de
setup, não de margem**, e absorvê-lo com margem entrega dose a tecido sadio em toda fração de
todo paciente.

A receita assume distribuição normal, independência e uma população. Amostra pequena, tendência
sistemática ao longo do curso ou dois outliers grandes quebram tudo — então os tamanhos de
amostra são reportados e o que dá para sinalizar é sinalizado, em vez de emitir uma margem de
seis frações e um paciente como se significasse algo.

## Falta

O co-registro em si (é o ITK do connectpy, RTV-196), o layout IGRT de 4 viewports, o painel de
correções, o endpoint `POST /api/igrt/verify` e a integração com a Course Timeline do RTV-173.
A matriz de registro entra por parâmetro.
