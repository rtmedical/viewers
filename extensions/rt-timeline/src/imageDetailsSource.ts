/**
 * DICOM display sets to `ImgImagingEvent` - pure adapter (RTV-233).
 *
 * `imageDetails.ts` decides what a row means; this module decides where the numbers come
 * from. It is the piece that was missing between a tested panel and a panel somebody can
 * open: the panels in this repository deliberately do not fetch, so without an adapter the
 * image-details panel had no data and no route into a mode.
 *
 * Pure and framework-free on purpose. It takes duck-typed display sets - `{ Modality,
 * instances: [naturalized DICOM tags] }` - and returns events. No OHIF service is imported
 * here; the thin subscription lives in `getPanelModule`, so every decision below is testable
 * without a viewer, a PACS or a clock.
 *
 * ## What is deliberately NOT mapped
 *
 * An absent field makes the core report `Nao informado`, which is a true statement. A field
 * filled from an approximation makes it report a number, which is a false one - and the whole
 * point of the core is that the physicist can tell those apart. So:
 *
 * - `fractionNumber`: RT Image references a fraction *group*
 *   (`ReferencedFractionGroupNumber`), which is not the fraction delivered. Conflating them
 *   would print "Fracao 1" beside an image acquired on the twentieth day of treatment.
 * - `sessionRef`: no DICOM attribute carries it. The session is resolved by
 *   `imgResolveSession` from timestamps and the session list, which is where that inference
 *   is visible and labelled `inferred-by-time`.
 * - `ssd`: no attribute in the RT Image IOD means source-to-surface for the *imaging*
 *   geometry; `SourceToSurfaceDistance` in RT Beams is the treatment beam's. Different
 *   geometry, same-looking number.
 * - `imagingDose`: no standard attribute. Vendors put it in private tags with vendor units,
 *   and reading it without the unit is exactly the failure `ImgQuantity` exists to prevent.
 *
 * ## Units are declared, never guessed
 *
 * Every quantity is returned as `{ value, unit }` with the unit fixed by the DICOM standard
 * for that attribute, not inferred from the magnitude. `KVP` is kV because the standard says
 * so, and that is a different kind of knowledge from "80 looks like kV".
 *
 * Two attributes are converted, both exact and both documented at the call site:
 * `ExposureInuAs` and `XRayTubeCurrentInuA` are microampere-based, the core models no
 * microampere unit, and dividing by 1000 is exact. Leaving them unread would print
 * `Nao informado` for an exposure the object did declare - a false statement of absence,
 * which is worse than a conversion with no rounding.
 *
 * ## The RT Image modality question
 *
 * `Modality` is `RTIMAGE` for both kV setup images and MV portal images, and the core needs
 * to know which - the kV rows and the MV rows are different rows. The decision here is taken
 * from which acquisition parameters the object itself declares, never from the series
 * description: `KVP` present means a kV tube fired, `NominalBeamEnergy` without `KVP` means
 * the treatment beam did. When neither is declared, this module returns `RTIMAGE`, which the
 * core does not recognise, and the panel refuses the whole table with the reason. That is the
 * intended outcome: an unclassified RT Image would otherwise get kV rows reading
 * `Nao informado` for parameters that never existed for it, which reads as missing data
 * rather than as inapplicable data.
 *
 * ## Timestamps: the digits are preserved, the zone is not invented
 *
 * DICOM date and time are local to the acquiring device unless `TimezoneOffsetFromUTC` is
 * present, and it usually is not. `imgFormatEpochUtc` prints in UTC, so this module encodes
 * the acquisition digits *as* UTC: the panel then prints back the same wall clock the console
 * showed, and two events from the same device stay comparable, which is what
 * `imgResolveSession` needs. The limitation is real and bounded: comparing events acquired in
 * different timezones is off by their offset difference. Choosing the viewer's local zone
 * instead would corrupt the displayed digits for every single image, which is the worse of
 * the two.
 */
import type { ImgAcquisitionMetadata, ImgImagingEvent, ImgPreviewRef, ImgQuantity, ImgUnit } from './imageDetails';

/* ------------------------------------------------------------------ */
/* Duck-typed input                                                    */
/* ------------------------------------------------------------------ */

/** A naturalized DICOM instance: attribute keywords to values. */
export interface ImgSrcInstance {
  [keyword: string]: unknown;
}

/** The shape this module needs from an OHIF display set. */
export interface ImgSrcDisplaySet {
  Modality?: unknown;
  displaySetInstanceUID?: unknown;
  SeriesInstanceUID?: unknown;
  instances?: ImgSrcInstance[];
  instance?: ImgSrcInstance;
  [key: string]: unknown;
}

/** Modalities this adapter maps. Anything else is left to the core to refuse. */
export const IMGSRC_IMAGING_MODALITIES: string[] = [
  'CT',
  'DX',
  'CR',
  'MV',
  'KV',
  'CBCT',
  'MVCT',
  'RTIMAGE',
];

export const IMGSRC_RTIMAGE_KV = 'RTIMAGE_KV';
export const IMGSRC_RTIMAGE_MV = 'RTIMAGE_MV';

/* ------------------------------------------------------------------ */
/* Small readers                                                       */
/* ------------------------------------------------------------------ */

function imgSrcText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value) && value.length === 1) {
    return imgSrcText(value[0]);
  }
  return '';
}

/**
 * A finite number, or undefined.
 *
 * A DICOM value can arrive as a string, and `Number('')` is 0 - which would put a zero kVp in
 * a dose table and read as "the tube fired at zero", not as "the attribute was empty".
 */
export function imgSrcNumber(value: unknown): number {
  if (typeof value === 'number') {
    return isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value) && value.length === 1) {
    return imgSrcNumber(value[0]);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') {
      return undefined;
    }
    const parsed = Number(text);
    return isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** A quantity, or undefined when the attribute carried no number. */
export function imgSrcQuantity(value: unknown, unit: ImgUnit, factor?: number): ImgQuantity {
  const raw = imgSrcNumber(value);
  if (raw === undefined) {
    return undefined;
  }
  const scale = factor === undefined ? 1 : factor;
  return { value: raw * scale, unit };
}

/** The first value present among several attribute keywords. */
function imgSrcFirst(instance: ImgSrcInstance, keywords: string[]): unknown {
  for (const keyword of keywords) {
    const value = instance ? instance[keyword] : undefined;
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Timestamps                                                          */
/* ------------------------------------------------------------------ */

function imgSrcDigits(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      out += text.charAt(i);
    }
  }
  return out;
}

/**
 * DICOM DA + TM (or DT) to epoch milliseconds, or undefined.
 *
 * Refuses rather than repairs. A malformed date that produced a plausible instant would date
 * an acquisition to a day it did not happen, and the session inference downstream compares
 * these numbers to decide which fraction an image belongs to.
 */
export function imgSrcParseDicomDateTime(dateText: unknown, timeText?: unknown): number {
  const date = imgSrcDigits(imgSrcText(dateText));
  if (date.length < 8) {
    return undefined;
  }
  // A DT arrives as one run of digits; the date is its first eight.
  const time = imgSrcDigits(imgSrcText(timeText)) || date.slice(8);

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  if (!(year >= 1900 && year <= 2999) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) {
    return undefined;
  }

  const hour = time.length >= 2 ? Number(time.slice(0, 2)) : 0;
  const minute = time.length >= 4 ? Number(time.slice(2, 4)) : 0;
  const second = time.length >= 6 ? Number(time.slice(4, 6)) : 0;
  if (!(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59) || !(second >= 0 && second <= 60)) {
    return undefined;
  }
  // A leap second is a real DICOM value and not a reason to discard the acquisition time.
  const clamped = second === 60 ? 59 : second;

  const epoch = Date.UTC(year, month - 1, day, hour, minute, clamped, 0);
  if (!isFinite(epoch)) {
    return undefined;
  }
  // Date.UTC rolls 31 February into March; a date that rolled was not the date written.
  const back = new Date(epoch);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return undefined;
  }
  return epoch;
}

/* ------------------------------------------------------------------ */
/* Modality                                                            */
/* ------------------------------------------------------------------ */

/**
 * The modality string the core should classify by. See the header on RT Image.
 */
export function imgSrcResolveModality(displaySet: ImgSrcDisplaySet, instance: ImgSrcInstance): string {
  const declared = imgSrcText(
    displaySet && displaySet.Modality !== undefined ? displaySet.Modality : instance ? instance.Modality : ''
  ).toUpperCase();
  if (declared !== 'RTIMAGE') {
    return declared;
  }
  const kvp = imgSrcNumber(instance ? instance.KVP : undefined);
  if (kvp !== undefined) {
    return IMGSRC_RTIMAGE_KV;
  }
  const energy = imgSrcNumber(instance ? instance.NominalBeamEnergy : undefined);
  if (energy !== undefined) {
    return IMGSRC_RTIMAGE_MV;
  }
  // Unclassified: the core refuses the table and says why. See the header.
  return 'RTIMAGE';
}

/* ------------------------------------------------------------------ */
/* The preview side of the pairing                                     */
/* ------------------------------------------------------------------ */

/**
 * The instance a display set renders when it can only render one, otherwise undefined.
 *
 * This is the preview side of `imgVerifyPreviewPairing`, and the shape of it is a consequence
 * of what the viewer can actually tell us. Copying the metadata UID into the preview
 * reference would make the pairing check pass by construction and remove the only protection
 * against a cached preview drawn beside the numbers of a newer acquisition - the failure that
 * check exists for. So the preview UID has to come from what is on screen.
 *
 * The available services do not offer that reliably. `cornerstoneViewportService` broadcasts
 * `viewportDataChanged` and `viewportVolumesChanged` and nothing for a new image within a
 * stack, and `viewportGridService` broadcasts layout and active-viewport changes. Reading the
 * current image id would therefore give an answer that goes stale on a scroll with no event
 * to react to - and a stale preview UID that still matches is the fabricated pairing again,
 * with extra steps.
 *
 * So the claim is only made where scrolling cannot invalidate it: a display set holding
 * exactly one instance renders that instance, and there is nothing to scroll to. RT setup and
 * portal images are single-instance objects, which is the case this panel is mostly about. For
 * a CT or CBCT stack this returns undefined and the panel reports the preview as unpaired,
 * which is the truth: with these events, the pairing cannot be proven.
 */
export function imgSrcSoleInstanceUid(displaySet: ImgSrcDisplaySet): string {
  if (!displaySet) {
    return undefined;
  }
  const instances = displaySet.instances;
  if (Array.isArray(instances)) {
    if (instances.length !== 1) {
      return undefined;
    }
    return imgSrcText(instances[0] ? instances[0].SOPInstanceUID : undefined) || undefined;
  }
  if (displaySet.instance) {
    return imgSrcText(displaySet.instance.SOPInstanceUID) || undefined;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

function imgSrcInstanceOf(displaySet: ImgSrcDisplaySet): ImgSrcInstance {
  if (displaySet && Array.isArray(displaySet.instances) && displaySet.instances.length > 0) {
    return displaySet.instances[0];
  }
  if (displaySet && displaySet.instance) {
    return displaySet.instance;
  }
  return {};
}

/** Whether this display set is an imaging event this panel is about. */
export function imgSrcIsImagingDisplaySet(displaySet: ImgSrcDisplaySet): boolean {
  const instance = imgSrcInstanceOf(displaySet);
  const declared = imgSrcText(
    displaySet && displaySet.Modality !== undefined ? displaySet.Modality : instance.Modality
  ).toUpperCase();
  return IMGSRC_IMAGING_MODALITIES.indexOf(declared) >= 0;
}

export function imgSrcBuildMetadata(displaySet: ImgSrcDisplaySet): ImgAcquisitionMetadata {
  const instance = imgSrcInstanceOf(displaySet);

  const acquiredAtMs =
    imgSrcParseDicomDateTime(instance.AcquisitionDateTime) ??
    imgSrcParseDicomDateTime(instance.AcquisitionDate, instance.AcquisitionTime) ??
    imgSrcParseDicomDateTime(instance.ContentDate, instance.ContentTime) ??
    imgSrcParseDicomDateTime(instance.SeriesDate, instance.SeriesTime);

  return {
    instanceUid: imgSrcText(instance.SOPInstanceUID) || undefined,
    modality: imgSrcResolveModality(displaySet, instance),
    acquiredAtMs,
    machineName:
      imgSrcText(imgSrcFirst(instance, ['RadiationMachineName', 'StationName'])) || undefined,
    // Deliberately absent: sessionRef, fractionNumber, ssd, imagingDose. See the header.
    kvp: imgSrcQuantity(instance.KVP, 'kV'),
    // Microampere attributes are exact /1000 conversions. See the header.
    tubeCurrent:
      imgSrcQuantity(instance.XRayTubeCurrent, 'mA') ??
      imgSrcQuantity(instance.XRayTubeCurrentInuA, 'mA', 1 / 1000),
    exposure:
      imgSrcQuantity(instance.Exposure, 'mAs') ??
      imgSrcQuantity(instance.ExposureInuAs, 'mAs', 1 / 1000),
    exposureTime:
      imgSrcQuantity(instance.ExposureTime, 'ms') ??
      imgSrcQuantity(instance.ExposureTimeInuS, 'ms', 1 / 1000),
    beamEnergy: imgSrcQuantity(instance.NominalBeamEnergy, 'MV'),
    sid: imgSrcQuantity(imgSrcFirst(instance, ['RTImageSID']), 'mm'),
    gantryAngle: imgSrcQuantity(instance.GantryAngle, 'deg'),
    collimatorAngle: imgSrcQuantity(instance.BeamLimitingDeviceAngle, 'deg'),
  };
}

export interface ImgSrcMapOptions {
  /** SOP Instance UID the active viewport is rendering, when it could be identified. */
  renderedInstanceUid?: string;
  /** Course the study belongs to, when the host knows it. */
  courseId?: string;
}

/**
 * One display set to one imaging event.
 *
 * `preview` is set only for the event whose instance the viewport is actually rendering, and
 * only from `renderedInstanceUid`. See `imgSrcInstanceUidFromImageId`.
 */
export function imgSrcMapDisplaySet(
  displaySet: ImgSrcDisplaySet,
  options?: ImgSrcMapOptions
): ImgImagingEvent {
  if (!displaySet) {
    return undefined;
  }
  const instance = imgSrcInstanceOf(displaySet);
  const eventId = imgSrcText(displaySet.displaySetInstanceUID) || imgSrcText(instance.SOPInstanceUID);
  if (eventId === '') {
    // Without an identifier the event cannot be navigated to or handed off, and two of them
    // would be indistinguishable in the list.
    return undefined;
  }
  const metadata = imgSrcBuildMetadata(displaySet);
  const rendered = imgSrcText(options ? options.renderedInstanceUid : '');
  const uid = imgSrcText(metadata.instanceUid);

  let preview: ImgPreviewRef;
  if (rendered !== '' && uid !== '' && rendered === uid) {
    preview = { instanceUid: rendered };
  }

  return {
    eventId,
    patientId: imgSrcText(instance.PatientID) || undefined,
    courseId: imgSrcText(options ? options.courseId : '') || undefined,
    metadata,
    preview,
  };
}

/**
 * Every imaging display set as an event, oldest first.
 *
 * Events with no acquisition time sort last rather than first: an undated image placed at the
 * start of the list reads as the earliest acquisition of the course, which is a claim the
 * object did not make.
 */
export function imgSrcMapDisplaySets(
  displaySets: ImgSrcDisplaySet[],
  options?: ImgSrcMapOptions
): ImgImagingEvent[] {
  const events: ImgImagingEvent[] = [];
  for (const displaySet of displaySets ?? []) {
    if (!imgSrcIsImagingDisplaySet(displaySet)) {
      continue;
    }
    const event = imgSrcMapDisplaySet(displaySet, options);
    if (event) {
      events.push(event);
    }
  }
  return events.sort(function (a, b) {
    const left = a.metadata ? a.metadata.acquiredAtMs : undefined;
    const right = b.metadata ? b.metadata.acquiredAtMs : undefined;
    if (left === undefined && right === undefined) {
      return 0;
    }
    if (left === undefined) {
      return 1;
    }
    if (right === undefined) {
      return -1;
    }
    return left - right;
  });
}
