# ARCH — Política arquitetural do RTV (extension-first, zero fork do `@ohif/core`)

> **ADR vinculante (binding) — RTV-114.** Toda contribuição ao visualizador RTV (este repositório, fork OHIF v3
> "ConnectViewer" da RT Medical) **deve** seguir esta política. Leia este documento **antes de abrir sua primeira
> PR**. PRs que violam esta política não são aprovadas e são reprovadas automaticamente pelo CI
> (`.github/workflows/rtv-arch-guard.yml`).

- **Status:** Aceito · **Epic:** RTV-5 (Theme base e migração OHIF v2→v3) · **Ticket:** RTV-114
- **Decisão tomada por:** Arquitetura RT Medical · **Última atualização:** 2026-06-22

---

## Contexto

O `connectviewer` atual é um fork OHIF **v2** com alterações **no core** do framework. Consequência: cada atualização
do upstream OHIF exige merge manual doloroso e a manutenibilidade em updates é **zero**.

O OHIF **v3** foi reescrito justamente para permitir customização profunda **sem tocar no core**. O RTV deve
consumir o upstream do OHIF como qualquer outro consumidor — isolando toda a lógica RT Medical em **extensions**,
**modes** e **customizations**. Assim, atualizar é `yarn upgrade @ohif/* --latest` sem conflitos.

## Decisão (binding para todo RTV)

Toda customização do RTV **deve** ser implementada via **UMA** das estratégias abaixo, **nesta ordem de preferência**:

### 1. CustomizationService — preferido para configs
Mudanças visuais, presets, hotkeys, mensagens e hooks de UX. ~30 customization points expostos, ex.:
`ohif.hotkeyBindings`, `cornerstone.windowLevelPresets`, `cornerstone.3dVolumeRendering`,
`layoutSelector.commonPresets`, `measurementLabels`, `cinePlayer`, `viewportNotification.*`, `ui.contextMenu`,
`ui.viewportActionCorner`, `onBeforeSRAddMeasurement`, `onBeforeDicomStore`.
Operadores immutability-helper: `$set`, `$merge`, `$filter`, `$push`, `$apply`, `$splice`.

### 2. Extension — preferido para features reusáveis
10 module types disponíveis em `getModules()`:

| Module type | Para quê |
|---|---|
| `LayoutTemplate` | controla o layout de uma rota |
| `DataSource` | mapping DICOM → OHIF metadata |
| `SOPClassHandler` | split de study em DisplaySets |
| `Panel` | sidebars left/right |
| `Viewport` | render component novo |
| `Commands` | ações nomeadas no CommandsManager |
| `Toolbar` | botões e componentes |
| `Context` | estado compartilhado |
| `HangingProtocol` | regras de matching/layout |
| `Utility` | funções públicas |

Pacote: `@rt/extension-<categoria>` (ex.: `@rt/extension-cardiology`).

### 3. Mode — preferido para workflow clínico completo
Compõe extensions existentes num workflow específico (rota). Define `routes`, `displaySetSelectors`,
`hangingProtocols`, `leftPanels`, `rightPanels`, `toolGroupConfig`, `hotkeys`. Use immutability-helper para
**estender** o mode `basic` em vez de redeclarar. Pacote: `@rt/mode-<workflow>` (ex.: `@rt/mode-cardio`).

### 4. Hooks declarativos
`onBeforeSRAddMeasurement`, `onBeforeDicomStore`, `customOnDropHandler`, etc. — definidos via CustomizationService.

## NÃO fazer (BLOCKING — reprovado pelo CI)

É **proibido** forkar ou modificar os seguintes pacotes core (em `node_modules/@ohif/*`, via `patch-package`, ou
copiando seu código para dentro do repo):

- `@ohif/core`
- `@ohif/app`
- `@ohif/ui` e `@ohif/ui-next`
- `@ohif/extension-cornerstone`
- `@ohif/extension-default`
- `@ohif/extension-cornerstone-dicom-sr`
- `@ohif/extension-cornerstone-dicom-seg`

> Se uma feature **parece** exigir fork do core, **escale antes** (abra discussão / marque o arquiteto na PR).
> Quase sempre existe um customization point que ainda não conhecemos. Atualizações upstream do OHIF v3 devem
> aplicar via `yarn upgrade @ohif/* --latest` **sem conflitos**.

## Estrutura-alvo do monorepo RTV

```
rt-viewer/
├── apps/
│   ├── viewer-web/        # build web (CDN)
│   └── viewer-bundle/     # build estático para RTVW (Tauri / VoxelView)
├── extensions/
│   ├── @rt/extension-cardiology/        @rt/extension-neurology/
│   ├── @rt/extension-vascular/          @rt/extension-thorax-abdomen/
│   ├── @rt/extension-mammography/       @rt/extension-dual-energy/
│   ├── @rt/extension-mr-quantitative/   @rt/extension-rt/
│   ├── @rt/extension-lesion-tracker/    @rt/extension-hanging-protocols/
│   ├── @rt/extension-measurements/      @rt/extension-pacs-workflow/
│   ├── @rt/extension-reporting/         @rt/extension-rt-services/
│   └── @rt/extension-shell/             # header, tasks dropdown, OIDC, local loaders (RTV-152)
├── modes/
│   ├── @rt/mode-radiology/   @rt/mode-radiotherapy/   @rt/mode-mammography/
│   ├── @rt/mode-cardio/      @rt/mode-neuro/          @rt/mode-reporting/
│   └── @rt/mode-rt-workstation/
└── customizations/
    └── rt-medical-config.ts
```

## Separação por modes (Radiologia vs Radioterapia) — adendo 2026-05-05

Workflows clínicos são isolados em **modes distintos** para evitar a UI sobrecarregada do connectviewer atual
(o `RTViewerHeader` misturava 8 tabs RT + radiologia numa interface única).

- 1 mode = 1 workflow clínico = 1 rota = 1 conjunto de panels/toolbar.
- Modes compartilham extensions, mas escolhem **quais** usar.
- Toolbar/panels específicos de uma especialidade **não** aparecem em outras (ex.: DVH/Isodoses só em
  `@rt/mode-radiotherapy`).
- `ModeRouterService` permite ao radiologista alternar entre modes explicitamente (Settings → Workflow ativo).

## Convenção de README por extension/mode (binding)

Todo pacote `@rt/extension-*` e `@rt/mode-*` **deve** ter um `README.md` documentando:

1. Propósito do pacote (workflow/feature clínica que cobre).
2. **Module types exportados** em `getModules()` (LayoutTemplate, Panel, Commands, …) e o que cada um faz.
3. Customization points consumidos/expostos.
4. Tickets RTV relacionados.

## Como o CI faz cumprir

- `.github/workflows/rtv-arch-guard.yml` roda em toda PR.
- Executa `.github/scripts/check-no-core-fork.sh` (também rodável localmente), que **falha** se a PR:
  - adiciona/altera arquivos dentro de qualquer `node_modules/@ohif/*`;
  - adiciona/altera patches `patch-package` (`patches/@ohif+*.patch`) que toquem pacotes core;
  - copia código-fonte de pacote core proibido para dentro do repo.
- O `pull_request_template.md` inclui um checkbox de conformidade arquitetural obrigatório.

## Referências

- OHIF Architecture — https://docs.ohif.org/development/architecture/
- Extensions — https://docs.ohif.org/platform/extensions/
- Modes — https://v3-docs.ohif.org/platform/modes/
- CustomizationService — https://docs.ohif.org/platform/services/customization-service/customizationservice/
- HangingProtocol Service — https://v3-docs.ohif.org/platform/services/data/hangingprotocolservice/
- HP Module — https://docs.ohif.org/platform/extensions/modules/hpmodule/
- Toolbar Module — https://docs.ohif.org/platform/extensions/modules/toolbar/

## Por que isto importa

`connectviewer` atual = manutenibilidade **zero** em updates. RTV deve receber upstream do OHIF como qualquer
consumidor — extensions e modes isolam nossa lógica e mantêm o custo de atualização baixo.
