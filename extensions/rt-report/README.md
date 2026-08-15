# @ohif/extension-rt-report

O núcleo de estado do laudo. Hoje: **ciclo de vida** (RTV-107).

## Laudo assinado é imutável. Ponto.

É a regra que sustenta o resto. Depois de assinado, o laudo é documento legal: foi
distribuído, alguém agiu sobre ele, e na arquitetura alvo tem assinatura PAdES/ICP-Brasil
sobre um PDF/A cujos bytes não podem mudar. Uma máquina de estados que permite
`assinado → rascunho` não "deixa o radiologista corrigir um typo": ela invalida uma
assinatura em silêncio e faz o arquivado divergir do vivo.

Não existe caminho de edição saindo de `signed`. O jeito de mudar um laudo assinado é
**escrever um adendo** — documento novo que referencia o que complementa e passa pelo
próprio ciclo rascunho → assinado. Toda outra tentativa é recusada **com motivo**, e o
motivo diz o que fazer: *"Laudo assinado não pode ser editado. Escreva um adendo."*

## Preliminar não é "assinado, porém menos"

Laudo preliminar é a leitura do residente ou do plantão emitida antes de o titular
assinar. É comunicação clínica de verdade — alguém vai agir sobre ela — e é *também*
explicitamente não final. Modelar como um `signed` mais fraco perde exatamente a
propriedade que importa: toda renderização tem que dizer. `requiresPreliminaryBanner`
existe para nenhum caminho de distribuição esquecer.

Texto preliminar **é** editável, ao contrário do assinado. Essa é a diferença entre os
dois, e é por isso que não podem ser o mesmo estado com uma flag.

## Versões são monotônicas e nunca reutilizadas

Toda assinatura cunha uma versão. Um adendo não modifica a versão 1: cria a versão 2, que
é a versão 1 mais o adendo. Quem recebeu a versão 1 precisa conseguir perguntar "o que eu
tenho está atual?" e obter resposta verdadeira — impossível se números forem reciclados ou
se adendo editar no lugar. `renderFullReport` anexa e rotula os adendos em vez de fundi-los
ao texto original: fundir reescreve a história no único documento onde isso é menos
aceitável.

## Retratação não apaga o que foi enviado

Retratar exige motivo, volta o texto para o editor e **mantém** as versões assinadas. Laudo
que foi distribuído não pode ser des-distribuído, e o arquivo tem que guardar o que foi
enviado.

## Quem pode assinar é outra pergunta

Residente emite preliminar e não assina final. O workflow pergunta ao host por um
`AuthorityCheck` injetado, em vez de importar um módulo de permissão — mesma costura do
RTV-190. Sem checker, falha fechado.

## Falta

O editor rich text (RTV-104), templates (RTV-105), macros (RTV-106), peer review (RTV-108),
distribuição (RTV-110), o modelo canônico CDE-first (RTV-216) e a persistência no Connect.
Nada aqui é renderizado ainda.
