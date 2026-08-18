# @ohif/extension-rt-governance

Access governance for OHIF v3: **who may open a study** (RTV-193) and **an auditable
record of what they did with it** (RTV-206).

Both are pure policy, framework-free and unit-tested. Follows **RTV-114**
(extension-first, zero fork).

## Access policy (RTV-193)

A referring physician must see their own patients' studies and nobody else's. That is an
LGPD requirement (Art. 6 — finalidade e necessidade) before it is a product feature, so
the rule lives in one exhaustively tested function instead of being scattered through
query builders and UI guards.

### Deny is the default

Every path that does not explicitly grant returns a denial **with a reason code**. A
policy that falls through to "allow" fails open, and an access control that fails open
is not an access control.

### This is the second line, not the first

The datasource must also scope its query server-side. A client-side filter alone is a UI
convenience, not a security boundary — the rows already reached the browser.
`filterVisibleStudies` exists to keep the UI honest when the server sends more than it
should, **not** to replace the server doing its job.

### The most specific reason wins

Grants are checked narrowest-first, so the decision's `code` names *why*: `assigned` and
`institution` are very different answers to "how could they see this?", and the audit
trail records the difference.

Institution membership deliberately does **not** widen a referrer's scope: a referring
physician at the same hospital still cannot open a colleague's referral.

### Break-glass

Emergency override is allowed, **flagged**, and requires a justification —
unjustified break-glass is indistinguishable from a policy hole at review time. It is
evaluated **last**, so it is only recorded when nothing else would have granted access;
flagging a case the user could see anyway would flood the review queue and hide the real
overrides.

## Audit trail (RTV-206)

LGPD Art. 37, ANVISA RDC 657/2022 and SBIS NGS v5.2 all require a record of who touched
health data, when, and what they did. Connect already has `audit_logs` for RIS
operations; the viewer side was missing.

### No free text — the decision that matters

An audit event carries **structured fields only**. There is no `description` string.

The tempting alternative is a free-text detail field plus a regex that scrubs PHI out of
it. That is a false sense of security: PHI in free text is unbounded (a nickname, a room
number, a fragment of a report), regexes catch the shapes you thought of, and the
failures are silent and permanent — an audit log is append-only and often replicated
off-site.

So `createAuditEvent` takes an **allowlist** of keys, coerces each to a bounded scalar,
and reports what it dropped. Refusing free text means there is nothing to scrub. Adding
a field is a deliberate, reviewable act.

### The queue must not lose events

An audit trail that drops events when the network blips is not an audit trail.

- A failed batch goes **back to the front**, so ordering survives.
- After N consecutive failures the queue stops until something new is enqueued, so a
  dead endpoint does not spin.
- When the buffer is full it drops the **newest** event and counts it — never the
  oldest. A reviewer reconstructing a timeline needs the beginning; a gap at the start
  is worse than a gap at the end.

## A toolchain note

`auditLog.ts` uses `catch (error)` rather than the optional catch binding, and exits its
flush loop through the loop condition rather than `break`. Both are worked around, not
stylistic: this repo's `@babel/plugin-transform-regenerator` fails with
`Cannot read properties of null (reading 'name')` on an `async` function that has
`await` inside a `try` with an optional catch binding — and the error points at the
`import` line, not at the real cause.

## Scope / follow-ups

- **No transport.** `AuditSink` is an interface; posting to Connect's `audit_logs`
  endpoint is one implementation. Nothing here talks to a network.
- **No persistence across reloads.** The queue holds events in memory. For a real
  deployment the first hop should be synchronous and the durability the server's
  problem; buffering in `localStorage` would put PHI-adjacent records in shared browser
  storage, which is the wrong trade.
- **Not wired to the viewer.** Nothing emits these events yet — the SOP class handlers,
  export commands and measurement service call sites are the integration step.
- **Nothing has been seen in a browser.**

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-governance/jest.config.js --ci
```

## Governança institucional de templates, CDE/RADS, macros e IA (`adminGovernance.ts`) — RTV-230

O ticket diz: *"templates e IA precisam de governança institucional, senão viram comportamento
imprevisível"*. A pergunta de governança que realmente morde não é quem pode clicar em editar. É
**o que acontece com laudos já assinados** quando a coisa contra a qual foram assinados muda por
baixo deles.

### Template aprovado é imutável, e editar bifurca

Um laudo assinado em 12 de março afirma o que afirma **em parte por referência**: usou o template
"Tórax CT", e esse template decidiu quais campos existiam, quais eram afirmativos, e o que o texto
padrão dizia. Editar o template no lugar muda **retroativamente** o significado do laudo assinado —
a trilha de auditoria diz "conforme o template Tórax CT" e o template que ela nomeia já não é o que
foi usado. Ninguém é notificado, e não há diff para olhar.

Então `govEditTemplate` **recusa** modificar versão aprovada e devolve uma bifurcação. Rascunho é
editado direto, porque nada foi assinado contra ele.

### Aprovação clínica não é "um administrador salvou"

Um template que traz texto de normalidade pré-preenchido está fazendo afirmações clínicas por quem
assinar (é exatamente a falha que RTV-228 bloqueia campo a campo). Decidir essa redação é **ato
clínico**, então o registro de aprovação exige um clínico nomeado **com registro profissional**.

Pedir o registro em vez de checar um papel é deliberado: **um papel pode ser concedido a um
administrador de TI, um CRM não.**

E template com campos afirmativos exige que o aprovador **os reconheça por id** — senão "aprovei o
template" é uma afirmação sobre o layout enquanto os padrões afirmativos entram sem serem lidos.

Autor não aprova a própria versão: a aprovação existe para ser um segundo par de olhos.

### "Importa sem deploy" não pode significar "importa para uso clínico"

O critério de aceite é que o admin importe RadReport/CDE sem deploy. Isso é sobre processo de
release, **não sobre confiança**: um MRRT importado é conteúdo de terceiro que ninguém nesta
instituição leu. `govImportTemplate` sempre aterra como **rascunho**, e **não existe parâmetro que
mude isso**. Importar e aprovar são dois atos de duas pessoas.

### Uma versão de pacote não se retira enquanto laudos apontam para ela

Um laudo registra um achado como elemento `RDE818` com valor `RDE818.2`. Se o pacote é atualizado e o
significado ou o conjunto permitido daquele valor muda, o laudo histórico **não quebra** — ele
continua perfeitamente legível e passa a significar outra coisa. Fixar a versão por laudo é o que
evita isso, e fixar não vale nada se a versão fixada pode ser removida.

Daí `govResolvePackForReport` **recusar** cair para "a versão atual" quando o laudo já existe: a
versão atual é a resposta certa só na criação; para um laudo existente é a resposta errada que
acontece de estar disponível.

### Macro sombreada

Três escopos — radiologista, grupo, instituição — e o mais específico vence, que é a única regra que
não surpreende ninguém. A parte que valia construir é o **relatório**: quando a instituição
acrescenta uma macro cujo gatilho um radiologista já usa, a do radiologista continua vencendo e a
institucional **silenciosamente nunca dispara**. Sem essa lista o admin vê uma macro que "não
funciona" sem causa visível.

Duas macros no **mesmo** escopo com o mesmo gatilho não é questão de precedência, é erro de
configuração: qual dispara dependeria da ordem de carregamento. Recusa.

### Desligar a IA tem um caso interessante

Ligar exige modelo e versão — RTV-224 recusa rodar sem eles de todo modo, e falhar aqui dá ao
administrador o motivo em vez de deixar o recurso misteriosamente inerte.

**Desligar** é onde está o problema: sugestões já na tela esperando aceite deixam de ser decidíveis.
Elas são **nomeadas por id e descartadas**, não deixadas no documento — um trecho de máquina
indecidível bloquearia a assinatura para sempre, e o radiologista não teria como limpá-lo.

69 testes.
