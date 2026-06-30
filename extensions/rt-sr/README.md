# @ohif/extension-rt-sr

DICOM **Structured Report builders** for OHIF v3. Currently **TID 1500
(Measurement Report)** — **RTV-36**. Follows **RTV-114** (extension-first / zero
fork). A home for further SR templates (e.g. TID 3000 CAD-RADS, RTV-38).

## Modules

| Module | Purpose |
| --- | --- |
| `measurementSr` (`buildMeasurementSr`, `COMPREHENSIVE_SR_SOP_CLASS_UID`) | Pure, unit-tested TID 1500 SR builder: root CONTAINER → Imaging Measurements → Measurement Group → NUM items (value + UCUM units, tracking id, referenced image); `generateUID` injectable |
| `srExport` (`serializeMeasurementSr`, `downloadMeasurementSr`, `serializeSrToArrayBuffer`) | dcmjs Part-10 byte writing |
| `getCommandsModule` | `downloadMeasurementSr` |

## Coverage / scope

- ✅ TID 1500 Measurement Report construction (Comprehensive SR, SOP `…88.33`) +
  Part-10 export from a list of measurements.
- 🟡 STOW-RS push to PACS is a separate backend ticket (RTV-39); capturing the
  measurements from viewport annotations is the integration layer (the
  `@ohif/extension-measurements` calculators + the cornerstone measurement
  service feed this). dcmjs export path not E2E-verified.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-sr/jest.config.js --ci
```
