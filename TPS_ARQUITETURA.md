# Arquitetura TPS de Radioterapia — OHIF Viewer (ConnectViewer)

## Visão Geral

Este documento descreve a arquitetura recomendada para construir um **TPS (Treatment Planning System) de Radioterapia** baseado no OHIF Viewer, utilizando a abordagem de **Extensions + Modes** para maximizar o reuso do código existente e facilitar atualizações futuras.

---

## Decisão Arquitetural: Extensions + Modes (NÃO fork pesado)

### Por que NÃO fazer fork pesado

| Fork pesado | Extensions + Modes |
|---|---|
| Difícil manter atualizado com OHIF upstream | Atualiza o core sem conflitos |
| Mudanças espalhadas por todo código | Mudanças isoladas em pacotes próprios |
| Merge hell a cada release do OHIF | Só atualiza `package.json` |
| Difícil testar isoladamente | Cada extensão pode ter seus testes |
| Risco de quebrar funcionalidades existentes | Core intocado, extensões independentes |

### Abordagem Recomendada

Criar **1 mode novo** + **2-3 extensions novas** + expandir a extensão `rtmedical-theme` existente. **Zero mudanças no core do OHIF**. Registrar tudo no `pluginConfig.json`.

---

## Estrutura de Diretórios Proposta

```
viewers/
├── modes/
│   ├── longitudinal/                 # OHIF stock (manter)
│   ├── segmentation/                 # OHIF stock (manter)
│   └── rtmedical-tps/                # ← NOVO: Mode customizado de Radioterapia
│       ├── package.json
│       └── src/
│           ├── index.ts              # Definição do mode (toolbar, layout, painéis)
│           ├── toolbarButtons.ts     # Botões da toolbar do TPS
│           └── initToolGroups.ts     # Ferramentas de contorno, dose, etc.
│
├── extensions/
│   ├── cornerstone/                  # OHIF stock (herdar)
│   ├── cornerstone-dicom-rt/         # OHIF stock (herdar — suporte a RTSTRUCT)
│   ├── cornerstone-dicom-seg/        # OHIF stock (herdar — segmentação)
│   ├── default/                      # OHIF stock (herdar)
│   ├── rtmedical-theme/              # ← JÁ EXISTE: expandir com tema completo
│   │   ├── index.js
│   │   └── src/
│   │       ├── ViewerLayout/
│   │       │   └── ViewerLayout.jsx  # Layout principal (já existe)
│   │       ├── icons/                # ← NOVO: ícones customizados
│   │       └── getCustomizationModule.ts  # ← NOVO: registrar customizações
│   │
│   ├── rtmedical-worklist/           # ← NOVO: listview customizado
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── getCustomizationModule.ts
│   │       └── components/
│   │           ├── WorkList.tsx       # StudyList customizado para RT
│   │           └── filtersMeta.ts     # Filtros específicos de radioterapia
│   │
│   └── rtmedical-tps-panels/         # ← NOVO: painéis do TPS
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── getPanelModule.ts
│           └── panels/
│               ├── RTStructPanel.tsx  # Painel de estruturas/contornos
│               ├── DVHPanel.tsx       # Dose-Volume Histogram
│               ├── DosePanel.tsx      # Visualização de dose
│               └── PlanPanel.tsx      # Painel de plano de tratamento
│
└── platform/
    └── app/
        ├── pluginConfig.json          # Registrar novas extensions e modes
        └── public/config/
            └── default.js             # Configuração runtime
```

---

## Detalhamento de Cada Componente

### 1. Mode: `rtmedical-tps`

**Localização**: `modes/rtmedical-tps/`

O mode é o orquestrador — ele combina extensões, define a toolbar, layout e painéis.

```typescript
// modes/rtmedical-tps/src/index.ts
export default {
  id: 'rtmedical-tps',
  routeName: 'tps',
  displayName: 'Planejamento RT',

  // Extensões que este mode utiliza
  extensions: [
    '@ohif/extension-cornerstone',
    '@ohif/extension-cornerstone-dicom-rt',
    '@ohif/extension-cornerstone-dicom-seg',
    '@ohif/extension-default',
    '@ohif/extension-measurement-tracking',
    '@rtmedical/extension-theme',
    '@rtmedical/extension-tps-panels',
    '@rtmedical/extension-worklist',
  ],

  // Configuração de layout
  defaultContext: ['VIEWER'],

  // Hanging protocols para RT
  hangingProtocol: 'rtHangingProtocol',

  // SOP Class Handlers (quais tipos DICOM suportar)
  sopClassHandlers: [
    '@ohif/extension-default.sopClassHandlerModule.stack',
    '@ohif/extension-cornerstone-dicom-rt.sopClassHandlerModule.dicom-rt',
    '@ohif/extension-cornerstone-dicom-seg.sopClassHandlerModule.dicom-seg',
  ],

  // Layout
  routes: [
    {
      path: 'tps',
      layoutTemplate: ({ location, servicesManager }) => ({
        id: 'rtmedical-tps-layout',
        props: {
          leftPanels: ['rtmedical.panelStructures'],
          rightPanels: ['rtmedical.panelDVH', 'rtmedical.panelDose'],
          viewports: [/* configuração de viewports */],
        },
      }),
    },
  ],
};
```

### 2. Extension: `rtmedical-theme` (Expandir)

**Localização**: `extensions/rtmedical-theme/`
**Status**: Já existe — precisa ser expandido.

#### O que já existe

- `ViewerLayout.jsx` — layout principal com classes Tailwind
- Cores definidas no `platform/ui/tailwind.config.js`:

| Grupo | Cores |
|---|---|
| **primary** | dark: `#090c29`, main: `#0944b3`, light: `#5acce6`, active: `#348cfd` |
| **secondary** | dark: `#041c4a`, main: `#2b166b`, light: `#3a3f99`, active: `#1f1f27` |
| **customblue** | `#0A163F`, `#0B1F54`, `#09286e`, `#0E307F`, `#0F3A94`, `#1454D4`, etc. |
| **customgreen** | `#05D97C`, `#0FD97C` |
| **customgray** | `#262943` |

#### O que adicionar

- **Ícones customizados**: criar pasta `src/icons/` com SVGs específicos do TPS
- **`getCustomizationModule.ts`**: registrar ícones e customizações de UI
- Expandir o `ViewerLayout.jsx` para incluir elementos específicos do TPS (header, footer, branding)

#### Ícones — Como Registrar

```typescript
// extensions/rtmedical-theme/src/getCustomizationModule.ts
import rtPlanIcon from './icons/rt-plan.svg';
import rtDoseIcon from './icons/rt-dose.svg';
import rtStructIcon from './icons/rt-struct.svg';

export default function getCustomizationModule() {
  return [
    {
      name: 'default',
      value: [
        {
          id: 'rtmedical.icons',
          // registrar ícones customizados
        },
      ],
    },
  ];
}
```

### 3. Extension: `rtmedical-worklist` (NOVO)

**Localização**: `extensions/rtmedical-worklist/`

#### Objetivo

Customizar a tela de listagem de estudos (StudyList/WorkList) para focar em radioterapia.

#### Filtros Específicos de RT

O worklist base do OHIF (`platform/app/src/routes/WorkList/filtersMeta.js`) já suporta modalidades RT:
- RTPLAN, RTDOSE, RTIMAGE, RTINTENT, RTPLAN, RTRAD, RTRECORD, RTSEGANN, RTSTRUCT

A extensão customizada deve:

- Filtros padrão pré-selecionados para modalidades RT
- Colunas adicionais: paciente, plano, status do tratamento, frações
- Ações rápidas: abrir no TPS, ver plano, ver dose
- Agrupamento por paciente/plano de tratamento

#### Referência — Arquivo Base

O worklist original está em:
- **Componente**: `platform/app/src/routes/WorkList/WorkList.tsx`
- **Filtros**: `platform/app/src/routes/WorkList/filtersMeta.js`

### 4. Extension: `rtmedical-tps-panels` (NOVO)

**Localização**: `extensions/rtmedical-tps-panels/`

#### Painéis a Implementar

| Painel | Descrição |
|---|---|
| **RTStructPanel** | Lista de estruturas/contornos (ROIs), toggle visibilidade, cores |
| **DVHPanel** | Gráfico Dose-Volume Histogram |
| **DosePanel** | Configurações de visualização de dose (isodose, colorwash, opacidade) |
| **PlanPanel** | Informações do plano de tratamento (beams, frações, dose prescrita) |

#### Registro dos Painéis

```typescript
// extensions/rtmedical-tps-panels/src/getPanelModule.ts
export default function getPanelModule({ servicesManager, extensionManager }) {
  return [
    {
      name: 'panelStructures',
      iconName: 'rt-struct',
      iconLabel: 'Estruturas',
      label: 'Estruturas RT',
      component: RTStructPanel,
    },
    {
      name: 'panelDVH',
      iconName: 'rt-dvh',
      iconLabel: 'DVH',
      label: 'Dose-Volume Histogram',
      component: DVHPanel,
    },
    {
      name: 'panelDose',
      iconName: 'rt-dose',
      iconLabel: 'Dose',
      label: 'Visualização de Dose',
      component: DosePanel,
    },
    {
      name: 'panelPlan',
      iconName: 'rt-plan',
      iconLabel: 'Plano',
      label: 'Plano de Tratamento',
      component: PlanPanel,
    },
  ];
}
```

---

## O que Herdar Pronto (NÃO reimplementar)

O OHIF já oferece tudo isso pronto:

| Funcionalidade | Extensão/Localização |
|---|---|
| Renderização DICOM (CT, MR, etc.) | `extensions/cornerstone/` |
| Suporte a RTSTRUCT (contornos) | `extensions/cornerstone-dicom-rt/` |
| Segmentação (labelmaps) | `extensions/cornerstone-dicom-seg/` |
| Ferramentas de medição | `extensions/measurement-tracking/` |
| Zoom, pan, scroll, window/level | `extensions/cornerstone/` (tools) |
| Overlays de viewport | `extensions/cornerstone/` (customization) |
| Colormaps (Grayscale, hot_iron, X-Ray, hsv, etc.) | `extensions/cornerstone/src/utils/colormaps.js` |
| Colorbar UI | `extensions/cornerstone/src/components/WindowLevelActionMenu/Colormap.tsx` |
| Sistema de customização (CustomizationService) | `platform/core/` |
| Worklist base com filtros | `platform/app/src/routes/WorkList/` |
| SidePanel, Toolbar, Header | `platform/ui/` |

---

## Colormaps Disponíveis

Já definidos em `extensions/cornerstone/src/utils/colormaps.js` (~1600 linhas):

| Colormap | Uso Típico em RT |
|---|---|
| **Grayscale** | Imagens CT/MR padrão |
| **X Ray** | Visualização invertida |
| **hot_iron** | Distribuição de dose (colorwash) |
| **hsv** | Mapas de cor científicos |
| + 5 outros | Diversos |

**Colormap padrão**: `Grayscale`
**Configuração**: `extensions/cornerstone/src/getCustomizationModule.ts` (bloco `cornerstone.colorbar`)

Para adicionar colormaps customizados de dose (jet, rainbow, etc.), estender o array em `colormaps.js` ou registrar via `CustomizationService`.

---

## Registro no pluginConfig.json

Após criar as extensões e mode, registrar em `platform/app/pluginConfig.json`:

```json
{
  "extensions": [
    // ... extensões existentes ...
    {
      "packageName": "@rtmedical/extension-theme",
      "version": "1.0.0"
    },
    {
      "packageName": "@rtmedical/extension-worklist",
      "version": "1.0.0"
    },
    {
      "packageName": "@rtmedical/extension-tps-panels",
      "version": "1.0.0"
    }
  ],
  "modes": [
    // ... modes existentes ...
    {
      "packageName": "@rtmedical/mode-tps",
      "version": "1.0.0"
    }
  ]
}
```

---

## Configuração Runtime (default.js)

Customizações que não precisam de código — apenas configuração:

```javascript
// platform/app/public/config/default.js
window.config = {
  // ... configurações existentes ...

  customizationService: {
    // Overlays customizados no viewport
    cornerstoneOverlayTopLeft: {
      id: 'cornerstoneOverlayTopLeft',
      items: [
        {
          id: 'PatientNameOverlay',
          customizationType: 'ohif.overlayItem',
          attribute: 'PatientName',
          label: 'Paciente:',
          color: 'white',
        },
      ],
    },
  },

  // Configuração específica do mode TPS
  modesConfiguration: {
    '@rtmedical/mode-tps': {
      displayName: 'Planejamento RT',
      routeName: 'tps',
    },
  },
};
```

---

## Problemas da Extensão `cornerstone-dicom-rt` (Stock OHIF)

A extensão original do OHIF para RTSTRUCT **não funciona bem**. Nada foi modificado localmente — os problemas são do upstream.

### Bugs e Limitações Encontrados no Código

#### 1. Cache Completamente Desabilitado
**Arquivo**: `extensions/cornerstone-dicom-rt/src/getSopClassHandlerModule.ts:179`
```typescript
function _segmentationExistsInCache(rtDisplaySet, segmentationService) {
  // Todo: fix this
  return false;  // SEMPRE retorna false — cache nunca funciona!
}
```
**Impacto**: Toda vez que abre um estudo RT, recarrega e reprocessa tudo do zero, mesmo que já tenha sido carregado antes. Lento e desperdiça memória.

#### 2. Segmentos Sobrepostos Não Suportados
**Arquivo**: `extensions/cornerstone-dicom-rt/src/viewports/OHIFCornerstoneRTViewport.tsx:180-185`
```typescript
if (evt.overlappingSegments) {
  uiNotificationService.show({
    title: 'Overlapping Segments',
    message: 'Overlapping segments detected which is not currently supported',
    type: 'warning',
  });
}
```
**Impacto**: Em radioterapia, sobreposição é **extremamente comum** (PTV contém CTV que contém GTV). Essa limitação é crítica para um TPS.

#### 3. Conversão Contorno → Labelmap (Problema Fundamental)
**Arquivo**: `extensions/cornerstone-dicom-rt/src/getSopClassHandlerModule.ts:124-135`

O OHIF converte contornos vetoriais RTSTRUCT para segmentação volumétrica (labelmap/voxels):
```typescript
await segmentationService.createSegmentationForRTDisplaySet(rtDisplaySet, null, suppressEvents);
```
**Problemas**:
- **Perda de precisão** — contornos vetoriais são suaves, labelmaps são discretizados em voxels
- **Lento** — rasterização de contornos 3D é computacionalmente pesado
- **Memória** — labelmap volumétrico consome muito mais que contornos vetoriais
- **Sobreposição** — labelmaps não suportam dois segmentos no mesmo voxel (por isso o problema #2)

#### 4. Somente Leitura (View-Only)
- Não dá para **editar** estruturas existentes
- Não dá para **criar** novas estruturas/contornos
- Não dá para **deletar** segmentos
- Não há funcionalidade de **salvar/exportar**
- Não há **undo/redo**

#### 5. Suporta Apenas RTSTRUCT
- **RTDOSE** (distribuição de dose) — NÃO suportado
- **RTPLAN** (plano de tratamento) — NÃO suportado
- **RTIMAGE** (imagens de verificação) — NÃO suportado
- Apenas RTSTRUCT (SOP Class UID: `1.2.840.10008.5.1.4.1.1.481.3`)

#### 6. Outros TODOs no Código
- **Não navega para primeiro segmento** ao abrir (`OHIFCornerstoneRTViewport.tsx:108`)
- **isReconstructable: false** fixo — comentário diz "by default for now" (`getSopClassHandlerModule.ts:33`)
- Sem memoização dos dados parseados

### Resumo dos Problemas

| Problema | Severidade | Arquivo |
|---|---|---|
| Cache desabilitado (TODO: fix this) | Alta | `getSopClassHandlerModule.ts:179` |
| Segmentos sobrepostos não suportados | Crítica (RT) | `OHIFCornerstoneRTViewport.tsx:180` |
| Conversão contorno → labelmap | Crítica (RT) | `getSopClassHandlerModule.ts:124` |
| Somente leitura | Crítica (TPS) | Toda extensão |
| Sem RTDOSE/RTPLAN | Crítica (TPS) | Toda extensão |
| Sem navegação ao primeiro segmento | Baixa | `OHIFCornerstoneRTViewport.tsx:108` |

---

## Estratégia: Herdar e Sobrescrever (NÃO editar o stock)

### Por que NÃO editar direto no `cornerstone-dicom-rt`

- Quando atualizar o OHIF upstream, **perde todas as mudanças**
- Dificuldade de resolver merge conflicts
- Mistura código RTMedical com código OHIF

### Como Sobrescrever

Criar uma **nova extensão** (`rtmedical-rt`) que registra o **mesmo SOP Class UID** com **prioridade maior**. O OHIF usa a sua no lugar da stock.

```
extensions/
├── cornerstone-dicom-rt/          # MANTER INTACTO (stock OHIF)
└── rtmedical-rt/                   # NOVO — herda e sobrescreve
    ├── package.json
    └── src/
        ├── index.ts                # Registra com prioridade maior
        ├── getSopClassHandlerModule.ts  # Fix: cache, contornos nativos
        ├── loadRTStruct.ts         # Reutiliza parser (funciona ok)
        ├── loadRTDose.ts           # NOVO: carregamento de RTDOSE
        ├── loadRTPlan.ts           # NOVO: carregamento de RTPLAN
        ├── viewports/
        │   ├── RTStructViewport.tsx    # Viewport melhorado (contornos nativos, não labelmap)
        │   ├── RTDoseViewport.tsx      # NOVO: viewport de dose
        │   └── RTFusionViewport.tsx    # NOVO: CT + dose + contornos
        ├── utils/
        │   ├── contourRenderer.ts     # Renderização vetorial (não labelmap)
        │   ├── doseColorwash.ts       # Colorwash de dose
        │   └── isodoseLines.ts        # Linhas de isodose
        └── panels/
            ├── RTStructPanel.tsx       # Painel de estruturas (com edição)
            ├── DVHPanel.tsx            # Dose-Volume Histogram
            ├── DosePanel.tsx           # Controles de dose
            └── PlanPanel.tsx           # Info do plano
```

### O que Reutilizar do Stock

| Componente | Reutilizar? | Motivo |
|---|---|---|
| `loadRTStruct.js` (parser de contornos) | Sim | Funciona bem — parseia ROIContourSequence corretamente |
| `getSopClassHandlerModule.ts` (handler) | Parcial | Reescrever com cache funcional e sem conversão para labelmap |
| `OHIFCornerstoneRTViewport.tsx` | Não | Reescrever — hydration flow é problemático |
| `promptHydrateRT.ts` | Não | Simplificar — carregar direto sem prompt |
| `_getStatusComponent.tsx` | Sim | UI simples, funciona ok |
| Bulk data loading | Sim | Carregamento assíncrono paralelo funciona bem |

### Correções Principais na Nova Extensão

#### Fix 1: Cache Funcional
```typescript
// rtmedical-rt/src/getSopClassHandlerModule.ts
function _segmentationExistsInCache(rtDisplaySet, segmentationService) {
  const rtContourId = rtDisplaySet.displaySetInstanceUID;
  const segmentations = segmentationService.getSegmentations();
  return segmentations.some(seg => seg.displaySetInstanceUID === rtContourId);
}
```

#### Fix 2: Contornos Vetoriais (Não Labelmap)
Em vez de converter para labelmap, renderizar como contornos nativos via Cornerstone3D:
```typescript
// Usar cornerstone3D contour representation ao invés de labelmap
import { Enums } from '@cornerstonejs/tools';
const representationType = Enums.SegmentationRepresentations.Contour; // NÃO Labelmap
```
Isso resolve sobreposição, precisão e performance de uma vez.

#### Fix 3: Suporte a RTDOSE
```typescript
// rtmedical-rt/src/loadRTDose.ts
// Carregar RTDOSE como volume 3D
// Renderizar como colorwash overlay no CT
// Suportar isodose lines
```

---

## Roadmap de Implementação

### Fase 1 — Fundação
- [ ] Expandir `rtmedical-theme` com ícones e customizações
- [ ] Criar `rtmedical-worklist` com listview customizado
- [ ] Criar `modes/rtmedical-tps` básico (toolbar + layout)
- [ ] Registrar tudo no `pluginConfig.json`

### Fase 2 — Painéis do TPS
- [ ] Implementar `RTStructPanel` (visualização de contornos)
- [ ] Implementar `DosePanel` (colorwash, isodose, opacidade)
- [ ] Implementar `DVHPanel` (gráfico dose-volume)
- [ ] Implementar `PlanPanel` (dados do plano)

### Fase 3 — Ferramentas e Interação
- [ ] Ferramentas de contorno customizadas (desenho, edição de ROI)
- [ ] Cálculo de dose (integração com backend)
- [ ] Colormaps customizados para dose
- [ ] Hanging protocols para RT (CT + dose overlay + estruturas)

### Fase 4 — Refinamento
- [ ] Testes unitários e E2E
- [ ] Performance (lazy loading, web workers)
- [ ] Exportação DICOM RT (RTPLAN, RTDOSE, RTSTRUCT)
- [ ] Integração com TPS backend

---

## Referência de Arquivos Importantes

| Arquivo | Descrição |
|---|---|
| `platform/app/pluginConfig.json` | Registro de extensions e modes |
| `platform/app/public/config/default.js` | Configuração runtime |
| `platform/ui/tailwind.config.js` | Cores do tema (customblue, customgreen, etc.) |
| `extensions/cornerstone/src/utils/colormaps.js` | Colormaps disponíveis |
| `extensions/cornerstone/src/getCustomizationModule.ts` | Customização do cornerstone (colorbar) |
| `extensions/cornerstone-dicom-rt/src/` | Suporte a RTSTRUCT |
| `extensions/cornerstone-dicom-rt/src/utils/loadRTStruct.js` | Carregamento de contornos |
| `extensions/rtmedical-theme/src/ViewerLayout/ViewerLayout.jsx` | Layout customizado atual |
| `platform/app/src/routes/WorkList/WorkList.tsx` | Worklist base |
| `platform/app/src/routes/WorkList/filtersMeta.js` | Filtros do worklist |
| `modes/longitudinal/src/index.ts` | Exemplo de mode com suporte RT |
| `modes/segmentation/src/index.tsx` | Exemplo de mode de segmentação |
