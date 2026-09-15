# Atualizar o viewer a partir do OHIF upstream

Procedimento para trazer `OHIF/Viewers` para o `rtmedical/viewers` sem perder o que é nosso.

Tudo aqui foi **medido, não estimado**. Os números envelhecem; o método não — antes de
executar, refaça a medição da seção ["Medir de novo"](#medir-de-novo).

**O que foi executado de verdade** num worktree descartável em 15/09/2026: os passos 1 a 3
(preparar, medir, resolver). Os comandos deles são os que rodaram.

**O que ainda não foi executado numa árvore realmente mesclada:** o passo 4 (regerar o
lockfile) e o passo 5 (verificar). Eles estão aqui porque cada peça tem razão documentada — o
`--frozen-lockfile` é o que pegou o defeito do PR #223, a dispensa do arch guard está prevista
no próprio script — mas a sequência inteira ponta a ponta é a primeira coisa a validar quando
houver um sync real. Quem for fazê-lo: anote aqui o que divergiu.

---

## O fato que decide tudo: não há ancestral comum

O histórico do fork foi reescrito. Tudo aparece adicionado num único commit (`0d5ac237c`,
16/08/2026), e por isso:

```console
$ git merge-base master upstream/master
$ echo $?
1
```

`git merge` recusa com **`refusing to merge unrelated histories`**, e é preciso
`--allow-unrelated-histories` para que ele sequer tente.

Duas consequências práticas:

1. **Todo conflito vem como `AA`** ("adicionado nos dois lados"). Sem base comum o git não faz
   3-way merge — cada conflito é o arquivo inteiro contra o arquivo inteiro, e não há
   "as mudanças deles" para aplicar sobre "as nossas".
2. **Os números do GitHub e os do git local não batem.** O compare da API diz 304 atrás / 28 à
   frente; `git rev-list --left-right --count` diz 7409 / 53. Nenhum dos dois está errado: sem
   base comum, cada lado conta o que quer. Não tente reconciliar.

## O que a medição achou

| medida | 11/09/2026 | 15/09/2026 |
|---|---|---|
| arquivos em conflito | 133, todos `AA` | **134**, todos `AA` |
| conflitos nos nossos pacotes (`extensions/rt-*`, `modes/rtmedical-*`, …) | 0 | **0** |
| quantos **nós** modificamos desde o import | 1 | **2** |

A última linha é o número que importa. **A política zero-fork do [RTV-114](../ARCH.md) segurou**:
os outros 132 arquivos em conflito nunca foram tocados por nós. Um sync não é uma reconciliação —
é um *take-theirs* mecânico mais um punhado de arquivos com julgamento.

Os dois que exigem julgamento hoje são `pnpm-lock.yaml` e `jest.config.js` (este último diverge
por uma linha, do RTV-234). O `babel.config.js` entra como terceiro a partir do RTV-236.

A subida de 133 para 134 em quatro dias é o upstream andando, e é a razão de a medição ser parte
do procedimento e não um número guardado aqui.

Se numa medição futura esse número subir **por um arquivo dentro de `platform/` ou
`extensions/cornerstone*`**, pare: significa que alguém forkou core, e aí o sync deixa de ser
mecânico e vira reconciliação de verdade. Subir por mais um arquivo de configuração na raiz é
esperado e barato.

## O procedimento

### 1. Preparar

O remote `upstream` não existe no clone por padrão:

```bash
git remote add upstream https://github.com/OHIF/Viewers.git   # se ainda não existir
git fetch upstream master
git switch -c sync-upstream-$(date +%Y%m%d)
```

### 2. Medir antes de mexer

```bash
git merge --no-commit --no-ff --allow-unrelated-histories upstream/master
git diff --name-only --diff-filter=U > /tmp/conflitos.txt
wc -l /tmp/conflitos.txt

# Quantos desses NÓS modificamos desde o commit de import?
IMPORT=$(git log --format=%H --reverse | head -1)
while read -r f; do
  n=$(git log --oneline "$IMPORT..master" -- "$f" | wc -l)
  [ "$n" -gt 0 ] && echo "$n  $f"
done < /tmp/conflitos.txt
```

A segunda lista é a única que exige julgamento. Se ela tiver só o `pnpm-lock.yaml`, siga.

### 3. Resolver

**Take-theirs em tudo que não está na lista de julgamento:**

```bash
while read -r f; do
  git checkout --theirs -- "$f" && git add -- "$f"
done < /tmp/conflitos.txt
```

> Verificado em 15/09/2026: `--theirs` funciona em conflito `AA` (os dois lados existem como
> estágios 2 e 3), resolve os 134 sem uma única falha, e o conteúdo resultante é byte a byte
> igual a `git show upstream/master:<arquivo>`.

**Tratar à parte** (estes têm conteúdo nosso misturado com o do upstream — leia os dois lados):

| arquivo | por quê |
|---|---|
| `package.json` (raiz) | scripts e deps nossos |
| `pnpm-workspace.yaml` | nossos pacotes entram aqui |
| `pnpm-lock.yaml` | **não resolva à mão** — veja o passo 4 |
| `jest.config.js` | já diverge: habilita os projetos de `modes/` (RTV-234) |
| `babel.config.js` | já diverge: o `test` env não carrega o regenerator (RTV-236) |
| `.github/workflows/*.yml` | `build.yml` e o arch guard são só nossos |
| `.gitignore`, `Dockerfile`, `rsbuild.config.ts`, `.webpack/webpack.base.js` | ajustes locais |

> As divergências deliberadas em `jest.config.js` e `babel.config.js` são **de uma linha cada** e
> estão comentadas no próprio arquivo. Aceitar a versão do upstream nelas reintroduz dois
> defeitos conhecidos — leia o comentário antes de decidir.

### 4. Lockfile

Não resolva o `pnpm-lock.yaml` editando. Regere:

```bash
git checkout --theirs -- pnpm-lock.yaml
pnpm install                       # reconcilia com o nosso pnpm-workspace.yaml
git add pnpm-lock.yaml
```

Depois **prove que ele está íntegro**, porque é exatamente aqui que o defeito dos catorze
importers ausentes se escondeu por onze dias (PR #223):

```bash
pnpm install --frozen-lockfile     # reprova se o lockfile não descreve o workspace
```

Uma suíte verde **não** cobre isso: os testes rodam sobre o `node_modules` já instalado. Só um
install do zero reprova.

### 5. Verificar

O arch guard precisa da dispensa — é o caso de uso que ele prevê:

```bash
ARCH_GUARD_WAIVE_CORE=1 .github/scripts/check-no-core-fork.sh master
```

Depois, as guardas que existem justamente para esta hora:

```bash
npx jest extensions/rt-services modes/ --runInBand --coverage=false
```

| guarda | o que prova sobre o sync |
|---|---|
| `workspaceImports.test.ts` | nenhum nome que importamos sumiu do upstream |
| `extensionLoads.test.ts` | toda extensão nossa ainda monta |
| `modes/*/modeLoads.test.ts` | os dois modos ainda montam |
| `panelRegistry.test.ts` | todo painel citado ainda existe, e nenhum nasceu órfão |
| `carbonThemeCoverage.test.ts` | o tema ainda cobre todos os tokens do ui-next |
| `archPolicy.test.ts` | o ARCH.md e o gate não divergiram |

**O que nenhuma delas prova:** que o viewer builda e roda. Isso exige o CI
(**[RTV-232](https://rtmedical.atlassian.net/browse/RTV-232)**) ou uma máquina de build — o DEV1
não tem RAM. Enquanto isso não existir, um sync é uma mudança **não validada de ponta a ponta**,
e vale dizer isso em voz alta na PR em vez de deixar implícito.

## Medir de novo

Antes de qualquer sync, refaça e compare:

```bash
git fetch upstream master
git merge --no-commit --no-ff --allow-unrelated-histories upstream/master 2>/dev/null
echo "conflitos: $(git diff --name-only --diff-filter=U | wc -l)"
git merge --abort
```

E a superfície de API, que é o que de fato quebra:

```bash
npx jest extensions/rt-services/src/workspaceImports --runInBand --coverage=false
```

Eram **45 nomes** importados de pacotes do workspace em 11/09/2026 — 2 de `@ohif/core`,
9 de `@ohif/ui-next`, 10 de `@ohif/mode-basic`. Essa é toda a superfície que um sync pode
quebrar, e ela é pequena porque o extension-first a manteve pequena.
