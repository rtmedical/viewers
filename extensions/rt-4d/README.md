# @ohif/extension-rt-4d

4D / gated imaging for OHIF v3 — **RTV-93** (4D-CT respiratory gating) and **RTV-51**
(ECG gating).

Follows the **RTV-114** extension-first / zero-fork policy: nothing in `platform/`,
`extensions/cornerstone`, `extensions/default`,
`extensions/cornerstone-dynamic-volume` or `modes/preclinical-4d` is touched.

## What this does *not* reimplement

Most of 4D already works upstream, and this extension deliberately reuses it:

| Already there | Where |
| --- | --- |
| 4D split into time points, display set flagged `isDynamicVolume` + `dynamicVolumeInfo` | `extensions/default/src/getSopClassHandlerModule.js`, via Cornerstone3D `splitImageIdsBy4DTags` |
| Phase slider ("N / total") | `platform/ui-next/src/components/CinePlayer/CinePlayer.tsx`, wired in `extensions/cornerstone/src/components/CinePlayer/CinePlayer.tsx` |
| Cine **across phases** rather than slices | `@cornerstonejs/tools` `playClip` (`dynamicCineEnabled` defaults to true) + `initCineService.ts` |
| Selecting a phase | `StreamingDynamicImageVolume.dimensionGroupNumber` (1-based) |
| Sum / average / subtract over time | `cstUtils.dynamicVolume.updateVolumeFromTimeData` |

So this extension adds only the two things the stack genuinely lacks: **what the
phases mean**, and **max/min over time**.

## Modules

| Module | Purpose |
| --- | --- |
| `phaseDetect` (`detectGating`, `describeGating`, `isPhaseSetIncomplete`) | Pure, unit-tested phase labelling from the gating tags |
| `temporalProjection` (`projectOverPhases`, `describeProjection`) | Pure MIP / MinIP / average / sum reduction along the temporal axis |
| `getCommandsModule` | `rt4dDetectGating`, `rt4dSetPhase`, `rt4dStepPhase`, `rt4dTemporalProjection`, `rt4dTemporalMip`, `rt4dTemporalMinIp`, `rt4dTemporalAvg` |
| `getHangingProtocolModule` | `rt-4d-dynamic` — the first protocol here that matches on *being 4D* |
| `getPanelModule` | "4D / gating" right panel; opt in via `@ohif/extension-rt-4d.panelModule.rt4d` |

## RTV-93 — what the phases mean

Cornerstone's `splitImageIdsBy4DTags` groups by whichever of
`TemporalPositionIdentifier`, `TriggerTime`, `EchoTime`, `DiffusionBValue`, … happens
to vary, and returns an opaque `splittingTag`. For a respiratory-gated 4D-CT the
reader needs **"40% EX"**, not "time point 5 of 10".

Tags read, in priority order:

1. **`NominalPercentageOfRespiratoryPhase` (0020,9241)** — the authoritative phase %.
2. **`SeriesDescription`** — the 4D-CT convention (`"CT 4D 50% EX"`). This matters
   because the per-frame respiratory functional group is often *absent* from a
   classic single-frame CT export, leaving the description as the only place the
   phase lives.
3. **`TriggerTime` (0018,1060)** — cardiac, and only when a cardiac tag confirms the
   study is cardiac (see below).
4. **`TemporalPositionIndex` (0020,9128)** / **`TemporalPositionIdentifier` (0020,0100)** —
   generic fallback.

`NumberOfTemporalPositions` (0020,0105) is compared against the phases actually
found, and a shortfall is surfaced in the panel. A 4D-CT silently missing a phase is
a real hazard: the physicist may contour on an incomplete respiratory cycle and miss
part of the tumour excursion.

> Note: `TemporalPositionIndex` and `NumberOfTemporalPositions` appear **nowhere**
> in Cornerstone3D's 4D splitting or in this repo before this extension.

## RTV-51 — prospective vs retrospective

`CardiacSynchronizationTechnique` (0018,9037) carries `PROSPECTIVE` /
`RETROSPECTIVE` / `REALTIME` / `TRIGGERED` / `NONE` — exactly the distinction the
ticket asks for, and it changes what the phases are worth. Each phase is expressed
as a percentage of the RR interval, taken from `CardiacRRIntervalSpecified`
(0018,9070) or derived from `HeartRate` (0018,1088).

**`TriggerTime` alone is never treated as gating.** It also varies in plain
multi-echo MR; grouping on it unconditionally would invent phases for ordinary
series. A cardiac tag has to confirm the study is cardiac first.

## Temporal MIP / MinIP — why it is written by hand

Cornerstone3D's `DynamicOperatorType` enum offers exactly **SUM, AVERAGE and
SUBTRACT**. There is no MAX and no MIN. For 4D-CT that is the gap that matters: RT
planning is built on the **MIP across the respiratory cycle** — the union of tumour
positions, from which the ITV is drawn — and on the **MinIP** for airway and lung
work. Neither is expressible as a sum or an average, and patching `node_modules` is
forbidden, so the reduction lives here and feeds `createAndCacheDerivedVolume`
directly.

### Reading one phase's voxels is stateful

There is no public per-phase scalar accessor: `voxelManager.getScalarData()` returns
whichever dimension group is *currently* selected. So reading phase N means
**selecting** it, which is visible in the viewport. Consequences, all handled:

- The reader's phase is saved and restored, even if the projection throws.
- `isDimensionGroupLoaded` is checked first, so an unloaded phase is **skipped**
  rather than contributing a buffer of zeros — a streaming volume may not have every
  phase in memory, and silently averaging in zeros would corrupt the projection. The
  result reports which phases actually contributed.
- Non-finite samples are skipped rather than propagated: one NaN voxel in one phase
  must not blank that voxel in the projection.
- The projection streams phase by phase, holding one phase plus the accumulator.

## Scope / follow-ups

- **No new phase slider or cine.** Both already exist and are driven by
  `dynamicVolumeInfo`; a second set of controls would fight the first over one
  volume. `rt4dSetPhase` / `rt4dStepPhase` exist so a hotkey or toolbar button can
  drive the same setter.
- **The projection is written into a derived volume, not exported as DICOM.**
  Persisting an ITV MIP as a new series is a follow-up.
- **Not validated against real data.** The DEV1 PACS has no 4D-CT and no gated
  series (its 11 studies are CT/RTIMAGE/RTPLAN/RTSTRUCT — see `docker/README.md`),
  and the fork's CI is blocked by a GitHub billing lock. The evidence here is the
  unit tests, including a fake dynamic volume that reproduces the stateful
  `dimensionGroupNumber` + `getScalarData` contract.

## Registering

`platform/app/pluginConfig.json` lists the extension. To use it in a mode, add
`'@ohif/extension-rt-4d': '^3.0.0'` to the mode's `extensionDependencies` and
`@ohif/extension-rt-4d.panelModule.rt4d` to its `rightPanels`.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-4d/jest.config.js --ci
```

## Binagem respiratória, e a irregularidade que a quebra (RTV-92)

`respiratoryBinning.ts` — o RTV-93 nomeia as fases de um 4D-CT **já binado**. Este é o passo
anterior: pegar o traçado do surrogate e decidir qual aquisição vai em qual bin. Dois métodos,
e eles **não produzem as mesmas imagens**.

**Binagem por fase** divide cada respiração em frações iguais *dela mesma*; todo bin enche,
sempre. **Binagem por amplitude** bina por onde o surrogate realmente está.

Com respiração perfeitamente regular os dois concordam. Com respiração irregular — que é o que
o paciente faz — a binagem por fase põe posições anatomicamente *diferentes* no mesmo bin,
porque 30% de uma respiração profunda é uma posição de diafragma diferente de 30% de uma rasa.
**É daí que vêm o artefato de degrau e o diafragma duplicado.** A binagem por amplitude não tem
esse problema e tem o outro: um bin que o paciente nunca alcançou fica **vazio**, e bin vazio é
um buraco no dataset, não uma imagem borrada.

**A irregularidade é o achado, não um incômodo.** O número mais útil aqui não são os bins, é
quanto a respiração variou — porque ele prevê o artefato *antes* da reconstrução e, em
radioterapia, prevê um **ITV que subestima a excursão**: ele cobre o que o paciente fez naqueles
trinta segundos, não o que vai fazer ao longo de trinta frações.

**O piso de ruído do detector decide o número principal.** Ruído do sensor perto do fim da
expiração é um máximo local, porque ali o traçado é quase plano. Contar isso como respiração
divide um período pela metade, infla a variação de período, e **reporta como irregular um
paciente perfeitamente regular** — mandando-o para binagem por amplitude e seus bins vazios sem
motivo. Daí a exigência de proeminência, medida contra o vale anterior e não contra uma altura
fixa, porque traçado real deriva.

0% e 100% são a mesma fase. Um off-by-one que produz onze bins para dez fases aparece como um
cine que engasga uma vez por ciclo — sutil o bastante para ser culpa do display.
