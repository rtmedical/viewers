# @ohif/extension-mammography

Mammography / **BI-RADS®** support for OHIF v3 — **RTV-78**. A structured
ACR BI-RADS (5th ed.) reporting form + finding labels. Follows **RTV-114**
(extension-first / zero fork). Fully client-side.

## Modules

| Module | Purpose |
| --- | --- |
| `birads` (`BIRADS_CATEGORIES`, `BREAST_DENSITY`, `BIRADS_LEXICON`, `buildBiradsReport`, `recommendedManagement`, `BIRADS_MEASUREMENT_LABELS`) | Pure, unit-tested BI-RADS model + report builder |
| `getCustomizationModule` | Exposes BI-RADS finding labels as `measurementLabels` |
| `getPanelModule` | BI-RADS form panel (laterality / density / findings / category → live report + copy); opt in via `@ohif/extension-mammography.panelModule.birads` |

## Coverage / scope

- ✅ **BI-RADS form complete**: categories 0–6 (+ 4A/4B/4C), ACR density a–d,
  finding lexicon (mass shape/margin/density, calcification morphology/
  distribution), recommended management, structured report text + copy.
- ✅ **Categorized markings (labels)**: BI-RADS finding labels exposed via
  customization for annotation tools.
- ✅ **DICOM SR TID 2000 export** (RTV-37): `buildMammographyCadSr` (pure,
  unit-tested) builds a Mammography CAD SR from a BI-RADS assessment; `srExport`
  writes a Part-10 file via dcmjs; "Export SR" button + `downloadBiradsSr`
  command. STOW-RS push to PACS is a separate backend ticket (RTV-39).
- 🟡 **Overlay** (drawing finding markers on the image) is a viewport follow-up.

## Tests

```bash
node node_modules/.bin/jest --config extensions/mammography/jest.config.js --ci
```

## Breast tomosynthesis (DBT) — RTV-76

A tomosynthesis study is read as the classic four-up: **CC on top, MLO below, right
breast on the viewer left** ("as if facing the patient"), with slice and window/level
synchronised across all four tiles. Comparing the same depth across projections is the
whole point of the layout, and scrolling one tile to slice 30 while another sits at
slice 1 is exactly the mistake the sync prevents.

| Module | Purpose |
| --- | --- |
| `dbt` (`parseMammoView`, `detectDbtSet`, `tileFor`) | Pure detection: laterality, projection, and whether the series is a tomosynthesis stack |
| `dbtProtocol` | The `rt-mammo-dbt-4up` hanging protocol |
| `getHangingProtocolModule` | Registers it |

### Detection details

**A tomosynthesis stack is multi-frame MG.** The SOP Class
(`1.2.840.10008.5.1.4.1.1.13.1.3`) is definitive when present; otherwise `Modality ===
MG` with `NumberOfFrames > 1` identifies it, because a conventional 2D mammogram is
single-frame. Modality is required — a multi-frame CT is not DBT.

**The 2D mammogram that ships alongside is deliberately excluded.** A routine study
carries both the 2D image and the DBT stack for each view. Hanging the 2D image in a
tile whose slice slider does nothing is worse than leaving the tile empty, so every
selector requires `numImageFrames > 1`.

**Laterality is matched on whole tokens.** `LM` is a projection, not "left".

**ML, LM, XCCL and AT are left out of the four-up.** They are supplementary
projections; the reader opens them manually.

### Chest-wall orientation

`expectedChestWallSide` describes the intended presentation — with the right breast on
the viewer left, the two chest walls meet in the middle. It is **not** a transform to
apply blindly: whether the stored pixel data already satisfies it depends on how the
vendor oriented the image (`PatientOrientation`, 0020,0020), and the renderer should
reconcile the two rather than flipping on laterality alone.

### Not delivered

The **1:1 pixel magnification glass** the ticket asks for is a viewport interaction,
not covered here. Cine playback across the slice stack is the existing OHIF cine
player driving the synchronised stack — no new code, but not verified on a real DBT
series either: the DEV1 PACS has no mammography.
