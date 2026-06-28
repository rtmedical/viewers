# @ohif/extension-rtmedical-key-images

Key Images panel and **DICOM Key Object Selection (KOS)** support for OHIF v3 — **RTV-148**.

OHIF v3 ships **no native Key Images panel**, so this is a net-new extension. It
follows the **RTV-114** extension-first / zero-fork policy: it does **not** modify
`@ohif/core`, `@ohif/app`, `@ohif/ui` or any native extension.

## Status

This first slice delivers the **framework-free, fully unit-tested core** that the
OHIF wiring layer will consume. The viewport/panel UI and DICOM byte writing are
tracked as follow-ups below.

| Layer | State |
| --- | --- |
| Selection model (`KeyImageManager`) | ✅ implemented + tested |
| Canonical id (`getKeyImageId` / `parseKeyImageId`) | ✅ implemented + tested |
| KOS descriptor (`buildKosDescriptor`, CID 7010 titles, SOP Class UID) | ✅ implemented + tested |
| Display utils (`sortKeyImages`, `groupKeyImagesBySeries`) | ✅ implemented + tested |
| OHIF metadata adapter + label (`toKeyImageReference`, `describeKeyImage`) | ✅ implemented + tested |
| `KeyImageService` (preRegistration) | ⏳ follow-up |
| Commands module (add/remove/toggle/clear, export-to-KOS) | ⏳ follow-up |
| Right-panel component (Carbon-inspired) | ⏳ follow-up |
| DICOM KOS serialization (dcmjs) + SopClassHandler (read existing KOS) | ⏳ follow-up |

## Public API

```ts
import {
  KeyImageManager,           // in-memory pub/sub selection model
  getKeyImageId,             // canonical identity for a reference
  parseKeyImageId,           // reverse of getKeyImageId
  buildKosDescriptor,        // selection -> serialization-ready KOS descriptor
  KOS_DOCUMENT_TITLES,       // DICOM PS3.16 CID 7010 subset (DCM scheme)
  DEFAULT_KOS_TITLE,         // "Of Interest" (113000, DCM)
  KEY_OBJECT_SELECTION_SOP_CLASS_UID,
  toKeyImageReference,       // loose OHIF metadata -> validated reference
  describeKeyImage,          // one-line panel/tooltip label
  sortKeyImages,
  groupKeyImagesBySeries,
} from '@ohif/extension-rtmedical-key-images';

const km = new KeyImageManager();
const sub = km.subscribe(e => console.log(e.type, e.count));

km.toggle({ StudyInstanceUID: 'S', SeriesInstanceUID: 'Se', SOPInstanceUID: 'I' }); // -> true
const kos = buildKosDescriptor(km.list(), { title: KOS_DOCUMENT_TITLES.FOR_TEACHING });
sub.unsubscribe();
```

### Identity model

A key image is identified by `Study | Series | SOPInstance` plus `:frame` for
multiframe instances. Display metadata (Modality, descriptions, numbers) is **not**
part of the identity, so re-selecting the same image is idempotent.

### KOS descriptor

`buildKosDescriptor` is the boundary between **selection logic** (here, pure and
tested) and **DICOM byte writing** (later, via `dcmjs`). It de-duplicates, groups
into `Study → Series → SOP Instance` (aggregating frame numbers) and mirrors the
KOS *Current Requested Procedure Evidence Sequence* structure. The document title
defaults to *Of Interest* (CID 7010 / `113000`, `DCM`).

## Tests

```bash
# from the repo root (node_modules installed)
node node_modules/.bin/jest --config extensions/rtmedical-key-images/jest.config.js --ci
# 5 suites / 43 tests
```

## Wiring (follow-up)

1. `KeyImageService` registered via `preRegistration`, wrapping `KeyImageManager`
   and bridging events to OHIF's `pubSubServiceInterface`.
2. `getCommandsModule` exposing `addKeyImage`, `removeKeyImage`, `toggleKeyImage`,
   `clearKeyImages`, `exportKeyImagesToKOS`. Commands map the active viewport's
   metadata through `toKeyImageReference` (already implemented) into the service;
   `exportKeyImagesToKOS` calls `buildKosDescriptor` then `dcmjs` to produce the
   KOS and stores via the active data source.
3. `getPanelModule` providing the right-panel UI (Carbon-inspired, using
   `@ohif/ui` primitives — no fork), driven by `groupKeyImagesBySeries` and
   `describeKeyImage` (both already implemented) for row rendering.
4. Register in `platform/app/pluginConfig.json` and add a `keyImage` toolbar
   button per mode (no changes to `@ohif/extension-default`).
5. `getSopClassHandlerModule` to read existing KOS instances into the model.
