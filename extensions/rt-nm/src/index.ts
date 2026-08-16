/**
 * @ohif/extension-rt-nm
 *
 * Nuclear medicine (SPECT / SPECT-CT) for OHIF v3.
 *
 * - **RTV-209 — SPECT quantification.** Counts, %ID, target-to-background and differential
 *   renal function, with the two guards the modality needs: **there is no SUV** on a
 *   conventional gamma camera, and **relative function cannot see bilateral disease**.
 *
 * PET quantification lives in `@ohif/extension-rt-pet` and deliberately does not extend to
 * here: SUL, PERCIST and the liver reference all assume a cross-calibrated scanner.
 *
 * Zero-fork per RTV-114: nothing in `platform/` or the upstream extensions is touched.
 */
export * from './spectQuantification';
