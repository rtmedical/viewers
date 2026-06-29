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
- 🟡 **Overlay** (drawing finding markers on the image) and **DICOM SR TID 2000
  export** are viewport / SR follow-ups (epic 5).

## Tests

```bash
node node_modules/.bin/jest --config extensions/mammography/jest.config.js --ci
```
