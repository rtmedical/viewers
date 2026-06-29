# @ohif/extension-rt-services

Shared RT Medical services/commands for OHIF v3 — **RTV-160** (local-file
drag-drop support). Follows **RTV-114** (extension-first / zero fork).

## Scope (important — avoids duplicating native v3)

OHIF v3 **already** ingests local files natively:
`platform/app/src/routes/Local/filesToStudies.js` + `DicomLocalDataSource` +
`pdfFileLoader.js` handle **DICOM and PDF**, **multi-file batches**,
**SOP-class detection** and **progress** (the `/local` route). Re-porting the
legacy connectviewer `filesToStudies` would duplicate that, so this extension
**does not**.

What the native route does **not** expose is a reusable way to *classify /
validate* a dropped file set before ingestion — needed for drag-drop in arbitrary
modes and especially the **RTVW desktop**. This extension adds exactly that.

## Modules

| Module | Purpose |
| --- | --- |
| `localFileClassifier` (`classifyFile`, `partitionLocalFiles`) | Pure, unit-tested file classification (dicom / pdf / image / unknown) + partition with an `ingestible` summary |
| `getCommandsModule` | `classifyLocalFiles` and `summarizeLocalFileDrop` commands (framework-free) |

## Acceptance coverage

- **DICOM local parser / PDF encapsulated / multi-file / progress / SOP-class
  detection** — provided by **native OHIF v3** (verified); reuse, not re-port.
- **This extension adds**: reusable classification/validation of a drop set
  (DICOM vs PDF vs image vs unknown, ingestibility), with a human-readable
  summary command for drag-drop UIs.

## Follow-up

- Wiring an in-session drag-drop overlay that calls the native ingest
  (`filesToStudies` / `DicomMetadataStore`) is an app/RTVW integration step
  (it requires `@ohif/core` and the running data source) tracked separately.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-services/jest.config.js --ci
```
