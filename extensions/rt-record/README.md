# @ohif/extension-rt-record

**RT Treatment Record** support for OHIF v3 — **RTV-163**, the foundation of the
RT Summary / Course Timeline (epic RTV-162). Follows **RTV-114** (extension-first
/ zero fork).

Registers a **SopClassHandler for the 4 RT Treatment Record SOP classes** and
renders a delivery-summary panel (per-session beams, delivered vs specified MU,
fraction, date, machine) with CSV export.

| SOP | Class UID |
| --- | --- |
| RT Beams Treatment Record | `1.2.840.10008.5.1.4.1.1.481.4` |
| RT Brachy Treatment Record | `1.2.840.10008.5.1.4.1.1.481.6` |
| RT Treatment Summary Record | `1.2.840.10008.5.1.4.1.1.481.7` |
| RT Ion Beams Treatment Record | `1.2.840.10008.5.1.4.1.1.481.9` |

No native OHIF handler claims these SOPs, so registering one here is **not** a
duplicate.

## Modules

| Module | Purpose |
| --- | --- |
| `rtRecordParser` (`parseRtRecord`, `recordTypeFromSopClass`, `buildRtRecordCsv`) | Pure, unit-tested record parser (Beams + Ion Beams sessions, delivered/specified MU, fraction, machine) + CSV |
| `getSopClassHandlerModule` | Display set per record (4 SOPs), `rtRecord` parsed onto it (framework-free; local guid) |
| `getPanelModule` | Treatment-records summary panel; opt in via `@ohif/extension-rt-record.panelModule.rtRecord` |

## Scope / follow-ups (epic RTV-162)

This is the **SopClassHandler + summary** slice (RTV-163). The rich Course
Timeline sub-panels — prescription/treatment/imaging/overrides/trends timelines
(RTV-164…180) — build on this parser and are separate tickets. Brachy and Summary
records are recognised (type + identity); their detailed session models are a
follow-up.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-record/jest.config.js --ci
```
