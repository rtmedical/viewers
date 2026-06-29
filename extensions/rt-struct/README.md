# @ohif/extension-rt-struct

Client-side **RT Structure Set (RTSTRUCT) summary** for OHIF v3 — **RTV-146**
(verifiable slice). Follows **RTV-114** (extension-first / zero fork).

Parses RTSTRUCT in the browser and renders a read-only structures panel
(name, display color, interpreted type, contour count, **approximate volume**)
with CSV export.

## Architecture (panel-only)

The cornerstone extension already registers a SopClassHandler for RTSTRUCT
(`1.2.840.10008.5.1.4.1.1.481.3`), so this extension **does not** register one
(that would duplicate the display set). The panel reads existing RTSTRUCT display
sets from the DisplaySetService and parses their instance metadata.

## Modules

| Module | Purpose |
| --- | --- |
| `rtStructParser` (`parseRtStruct`, `contourArea`, `approximateVolumeCc`, `buildRtStructCsv`, `rgbToHex`) | Pure, unit-tested RTSTRUCT parser + planar-contour volume + CSV |
| `getPanelModule` | Structures panel; opt in via `@ohif/extension-rt-struct.panelModule.rtStruct` |

## What it extracts

- Per ROI: `ROIName`, `ROIDisplayColor`, `RTROIInterpretedType` (PTV/GTV/ORGAN…),
  `ROIGenerationAlgorithm`, contour & point counts.
- **Approximate volume** (cm³): Σ(planar contour shoelace area) × median slice
  thickness derived from contour z-positions. Labelled as an approximation.

## Scope / follow-ups

- **Contour editor** (draw/edit/delete contours, push back as a new RTSTRUCT) is a
  heavy cornerstone-viewport integration — out of scope here, tracked separately.
- RTPLAN and RTDOSE summaries ship as their own extensions (`@ohif/extension-rt-plan`
  RTV-132, `@ohif/extension-rt-dvh` RTV-131).

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-struct/jest.config.js --ci
```
