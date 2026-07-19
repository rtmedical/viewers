# @ohif/extension-deid

**DICOM de-identification** for OHIF v3 — **RTV-113**. A pure de-identification
engine per **PS3.15 Annex E** (Basic Application Level Confidentiality Profile)
+ **LGPD**, a dcmjs Part-10 exporter, a command and a policy/options panel.
Follows **RTV-114** (extension-first / zero fork).

## Modules

| Module | Purpose |
| --- | --- |
| `deidentify` (`deidentify`, `deidActions`, `PHI_ACTIONS`, `DATE_TIME_KEYWORDS`) | Pure, unit-tested de-id engine: per-tag actions **D** (dummy) / **Z** (blank) / **X** (remove) / **K** (keep) / **U** (UID remap); recurses sequences; retain-dates / retain-UIDs options; stamps `PatientIdentityRemoved`/`DeidentificationMethod`; input never mutated |
| `deidExport` (`deidentifyToArrayBuffer`, `downloadDeidentified`, `makeUidRemapper`) | dcmjs Part-10 byte writing + consistent UID remapper |
| `getCommandsModule` | `downloadDeidentifiedInstance` |
| `getPanelModule` | Policy preview + retain-dates/UIDs toggles + download; opt in via `@ohif/extension-deid.panelModule.deid` |

## Coverage / scope

- ✅ Pure de-identification engine (Basic Profile-aligned tag-action table over
  patient identity, physicians/institution, identifiers, dates and UIDs), with
  retain-dates and retain-UIDs (consistent remap) options. Sequences recursed.
- ✅ Single-instance de-identified Part-10 export (dcmjs) + panel + command.
- 🟡 **Whole-study batch de-identification + re-import** is a follow-up.

> Verification: pure engine fully unit-tested; full app bundle builds clean
> (rspack). The dcmjs export path is not E2E-verified here.

## Tests

```bash
node node_modules/.bin/jest --config extensions/deid/jest.config.js --ci
```
