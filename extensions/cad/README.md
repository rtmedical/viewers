# @ohif/extension-cad

**CAD (Computer-Aided Detection)** support for OHIF v3 — **RTV-79**. A
client-side CAD Structured Report parser (Mammography / Chest CAD SR) + a
findings panel. Follows **RTV-114** (extension-first / zero fork).

The CAD SR SOP classes are **not** claimed by `cornerstone-dicom-sr` (which only
handles Basic/Enhanced/Comprehensive SR), so registering a handler here is not a
duplicate.

| SOP | Class UID |
| --- | --- |
| Mammography CAD SR | `1.2.840.10008.5.1.4.1.1.88.50` |
| Chest CAD SR | `1.2.840.10008.5.1.4.1.1.88.65` |

## Modules

| Module | Purpose |
| --- | --- |
| `cadSr` (`parseCadSr`, `isCadSr`) | Pure, unit-tested CAD SR walker → findings (type / code / probability / SCOORD region / referenced image) |
| `getSopClassHandlerModule` | Display set per CAD SR with `cadSr` parsed on it (framework-free; local guid) |
| `getPanelModule` | CAD findings panel; opt in via `@ohif/extension-cad.panelModule.cad` |

## Coverage / scope

- ✅ Parse CAD findings (type, coded value, probability/likelihood, graphic
  region, referenced image) from the SR content tree (recurses nested containers).
- ✅ Findings panel (type / region / probability).
- 🟡 **Drawing the finding markers as an image overlay** is a cornerstone-viewport
  follow-up.

> Verification: pure parser unit-tested; full app bundle builds clean (rspack).
> Overlay rendering not part of this slice (not E2E-verified).

## Tests

```bash
node node_modules/.bin/jest --config extensions/cad/jest.config.js --ci
```
