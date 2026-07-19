# @ohif/extension-rtmedical-key-images

Key Images panel and **DICOM Key Object Selection (KOS)** support for OHIF v3 — **RTV-148**.

OHIF v3 ships **no native Key Images panel**, so this is a net-new extension. It
follows the **RTV-114** extension-first / zero-fork policy: it does **not** modify
`@ohif/core`, `@ohif/app`, `@ohif/ui` or any native extension.

## Status

The extension is **feature-complete** for RTV-148: a framework-free, unit-tested
core plus the full OHIF wiring (service, commands, right panel) and round-trip
DICOM KOS support (write via `dcmjs`, read existing KOS via a SopClassHandler).

| Layer | State |
| --- | --- |
| Selection model (`KeyImageManager`) | ✅ implemented + tested |
| Canonical id (`getKeyImageId` / `parseKeyImageId`) | ✅ implemented + tested |
| KOS descriptor (`buildKosDescriptor`, CID 7010 titles, SOP Class UID) | ✅ implemented + tested |
| Display utils (`sortKeyImages`, `groupKeyImagesBySeries`) | ✅ implemented + tested |
| OHIF metadata adapter + label (`toKeyImageReference`, `describeKeyImage`) | ✅ implemented + tested |
| `KeyImageService` (preRegistration) | ✅ implemented + tested |
| Commands module (add/remove/toggle/clear, export + download KOS) | ✅ implemented + tested |
| Right-panel component (Carbon-inspired) | ✅ implemented |
| DICOM KOS serialization → Part-10 (`dcmjs`, TID 2010 / CID 7010) | ✅ implemented + tested core |
| SopClassHandler — read existing KOS into references | ✅ implemented + tested core |

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
# 10 suites / 82 tests
```

## KOS read/write

- **Write:** `serializeKosToArrayBuffer(descriptor, opts)` / `downloadKosDocument(...)`
  ({@link ./kosSerialize}) turn a descriptor into a Part-10 DICOM KOS document via
  `dcmjs` (Explicit VR LE). The IOD shaping is the pure, unit-tested
  `buildKosNaturalizedDataset` ({@link ./kosDataset}) — KO Document template
  TID 2010, CID 7010 title, Current Requested Procedure Evidence + IMAGE content
  items (with `ReferencedFrameNumber` for multiframe). The `downloadKeyImagesKOS`
  command serializes the current selection and triggers a browser download.
- **Read:** `getSopClassHandlerModule` registers a handler for the KOS SOP Class
  (`1.2.840.10008.5.1.4.1.1.88.59`). It builds a display set per KOS instance,
  parsing it back to `KeyImageReference[]` with the pure `parseKosInstance`
  ({@link ./parseKosInstance}); `build → parse` is covered by a round-trip test.

## Integration notes

- Registered in `platform/app/pluginConfig.json` as
  `@ohif/extension-rtmedical-key-images`; a mode opts the panel in via
  `@ohif/extension-rtmedical-key-images.panelModule.keyImages` in its `rightPanels`.
- The SopClassHandler avoids importing `@ohif/core` (it generates the display-set
  UID locally): under pnpm the extension's nested `@ohif/core` peer build fails to
  bundle against Cornerstone3D 5.x. Pure modules stay `@ohif/*`-free by design.
