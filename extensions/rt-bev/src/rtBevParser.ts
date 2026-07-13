/**
 * Pure, framework-free **RTPLAN → BEV model parser**.
 *
 * Turns a *naturalized* RTPLAN instance (DICOM keyword → value, as OHIF
 * instance metadata / dcmjs produce) into per-beam Beam's Eye View data:
 * MLC leaf banks, leaf boundaries, jaws, gantry/collimator angles, blocks
 * and wedge orientation — everything the BEV overlay renderer needs.
 *
 * Port of the legacy connectviewer pipeline (Nanodicom `rtp.php` bank split +
 * `DrawBlockAndMlcTool.js` consumption), see
 * viewers-artifacts/bev-mlc-port-plan.md.
 *
 * Conventions (mirroring extensions/rt-plan/src/rtPlanParser.ts):
 * - Numeric DICOM values (DS/IS) may arrive as strings → always Number().
 * - Sequences may be naturalized as scalars → be defensive (toArray).
 * - All positions are kept in **mm at the isocenter plane** (no cm division —
 *   unlike rtPlanParser's Eclipse-style cm columns).
 *
 * DICOM control points are SPARSE: a control point only restates attributes
 * that changed, so gantry/collimator/jaws/leaves are carried forward from the
 * previous control point when absent (DICOM PS3.3 C.8.8.14.5).
 */

export const RT_PLAN_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.5';

export interface BevControlPoint {
  /** ControlPointIndex (falls back to the array position). */
  index: number;
  /** GantryAngle in degrees (carried forward when the CP omits it). */
  gantryAngle?: number;
  /** BeamLimitingDeviceAngle (collimator) in degrees (carried forward). */
  collimatorAngleDeg?: number;
  /** X jaws [X1, X2] in signed mm at isocenter (ASYMX/X; carried forward). */
  jawXmm?: [number, number];
  /** Y jaws [Y1, Y2] in signed mm at isocenter (ASYMY/Y; carried forward). */
  jawYmm?: [number, number];
  /**
   * MLC bank A leaf tip positions, mm at isocenter — the FIRST half of the
   * MLC device's LeafJawPositions (legacy rtp.php midpoint split). For MLCX
   * this is the bank on the negative-X side. Empty when the beam has no MLC.
   */
  bankA: number[];
  /** MLC bank B leaf tips — the SECOND half of LeafJawPositions. */
  bankB: number[];
}

export interface BevBeam {
  beamNumber: number;
  name?: string;
  /** SourceAxisDistance (300A,00B4), mm. */
  sadMm?: number;
  /** RTBeamLimitingDeviceType of the MLC device, when present. */
  mlcType?: 'MLCX' | 'MLCY';
  /**
   * LeafPositionBoundaries (300A,00BE), mm at isocenter, along the axis
   * perpendicular to leaf travel (Y for MLCX, X for MLCY).
   * Length = numberOfLeafPairs + 1.
   */
  leafBoundariesMm?: number[];
  /** NumberOfLeafJawPairs (300A,00BC) of the MLC device. */
  numberOfLeafPairs?: number;
  /** WedgeOrientation (300A,00D8) of the first wedge, degrees. */
  wedgeOrientationDeg?: number;
  /** BlockSequence: BlockData paired into [x, y] mm-at-isocenter vertices. */
  blocks?: { type?: string; pointsMm: Array<[number, number]> }[];
  /** IsocenterPosition (300A,012C), patient mm, from the first CP defining it. */
  isocenterMm?: [number, number, number];
  controlPoints: BevControlPoint[];
}

/** dcmjs naturalizes sequences as arrays, but be defensive about scalars. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** Coerce a DICOM numeric (DS/IS, possibly string or [string]) to a number. */
function toNum(value: unknown): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null || v === '') {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce a multi-valued DICOM numeric (DS array) to number[] (drops non-finite). */
function toNumArray(value: unknown): number[] {
  return toArray(value)
    .map(v => {
      const n = Number(v as any);
      return Number.isFinite(n) ? n : undefined;
    })
    .filter((n): n is number => n != null);
}

function deviceType(device: unknown): string {
  return String((device as any)?.RTBeamLimitingDeviceType ?? '').toUpperCase();
}

/**
 * First [pos1, pos2] pair, in signed mm, from a control point's
 * BeamLimitingDevicePositionSequence matching one of `types`.
 */
function jawMm(
  cp: Record<string, any> | undefined,
  types: string[]
): [number, number] | undefined {
  for (const d of toArray(cp?.BeamLimitingDevicePositionSequence)) {
    if (types.includes(deviceType(d))) {
      const pos = toNumArray((d as any)?.LeafJawPositions);
      if (pos.length >= 2) {
        return [pos[0], pos[1]];
      }
    }
  }
  return undefined;
}

/** LeafJawPositions (mm) of the CP's MLC entry (matching `mlcType` if known). */
function mlcPositionsMm(
  cp: Record<string, any> | undefined,
  mlcType: string | undefined
): number[] | undefined {
  for (const d of toArray(cp?.BeamLimitingDevicePositionSequence)) {
    const t = deviceType(d);
    const isMlc = mlcType ? t === mlcType : t.startsWith('MLC');
    if (isMlc) {
      const pos = toNumArray((d as any)?.LeafJawPositions);
      if (pos.length >= 2) {
        return pos;
      }
    }
  }
  return undefined;
}

/** Pair a flat BlockData [x1, y1, x2, y2, …] (mm) into [x, y] vertices. */
function pairPoints(flat: number[]): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    points.push([flat[i], flat[i + 1]]);
  }
  return points;
}

/**
 * Parse a naturalized RTPLAN instance into BEV beams.
 *
 * Beams that never define a BeamLimitingDevicePositionSequence in any control
 * point (e.g. setup/imaging beams) are skipped gracefully — there is nothing
 * to draw for them. Beams without a BeamNumber are skipped as well.
 */
export function parseRtPlanBev(instance: Record<string, any>): BevBeam[] {
  const beams: BevBeam[] = [];

  for (const b of toArray(instance?.BeamSequence)) {
    const beamNumber = toNum((b as any)?.BeamNumber);
    if (beamNumber == null) {
      continue;
    }

    const cps = toArray((b as any)?.ControlPointSequence) as Record<string, any>[];
    const hasAnyPositions = cps.some(
      cp => toArray(cp?.BeamLimitingDevicePositionSequence).length > 0
    );
    if (!hasAnyPositions) {
      continue; // setup / imaging beam — nothing to render in BEV
    }

    // ---- MLC device description (BeamLimitingDeviceSequence) ----
    let mlcType: 'MLCX' | 'MLCY' | undefined;
    let leafBoundariesMm: number[] | undefined;
    let numberOfLeafPairs: number | undefined;
    for (const d of toArray((b as any)?.BeamLimitingDeviceSequence)) {
      const t = deviceType(d);
      if (t === 'MLCX' || t === 'MLCY') {
        mlcType = t;
        const boundaries = toNumArray((d as any)?.LeafPositionBoundaries);
        leafBoundariesMm = boundaries.length ? boundaries : undefined;
        numberOfLeafPairs = toNum((d as any)?.NumberOfLeafJawPairs);
        break;
      }
    }

    const beam: BevBeam = {
      beamNumber,
      name: (b as any)?.BeamName,
      sadMm: toNum((b as any)?.SourceAxisDistance),
      mlcType,
      leafBoundariesMm,
      numberOfLeafPairs,
      wedgeOrientationDeg: toNum(
        (toArray((b as any)?.WedgeSequence)[0] as any)?.WedgeOrientation
      ),
      controlPoints: [],
    };

    const blockItems = toArray((b as any)?.BlockSequence);
    if (blockItems.length) {
      beam.blocks = blockItems.map((blk: any) => ({
        type: blk?.BlockType,
        pointsMm: pairPoints(toNumArray(blk?.BlockData)),
      }));
    }

    // ---- Control points, with sparse-CP carry-forward ----
    let prev: BevControlPoint | undefined;
    cps.forEach((cp, i) => {
      const mlc = mlcPositionsMm(cp, mlcType);
      let bankA: number[];
      let bankB: number[];
      if (mlc) {
        // Legacy rtp.php split: first half = bank A, second half = bank B.
        const mid = Math.floor(mlc.length / 2);
        bankA = mlc.slice(0, mid);
        bankB = mlc.slice(mid);
      } else {
        bankA = prev ? prev.bankA.slice() : [];
        bankB = prev ? prev.bankB.slice() : [];
      }

      const point: BevControlPoint = {
        index: toNum(cp?.ControlPointIndex) ?? i,
        gantryAngle: toNum(cp?.GantryAngle) ?? prev?.gantryAngle,
        collimatorAngleDeg: toNum(cp?.BeamLimitingDeviceAngle) ?? prev?.collimatorAngleDeg,
        jawXmm: jawMm(cp, ['X', 'ASYMX']) ?? (prev?.jawXmm && [...prev.jawXmm]),
        jawYmm: jawMm(cp, ['Y', 'ASYMY']) ?? (prev?.jawYmm && [...prev.jawYmm]),
        bankA,
        bankB,
      };

      if (!beam.isocenterMm) {
        const iso = toNumArray(cp?.IsocenterPosition);
        if (iso.length >= 3) {
          beam.isocenterMm = [iso[0], iso[1], iso[2]];
        }
      }

      beam.controlPoints.push(point);
      prev = point;
    });

    beams.push(beam);
  }

  return beams;
}

/**
 * Extract the BEV geometry of a *naturalized* RTIMAGE instance in the shape
 * {@link ./bevGeometry!RtImageGeometry} expects (structurally typed here to
 * avoid an import cycle):
 * - `rtImagePositionMm` — RTImagePosition (3002,0012), [x, y] mm of the
 *   center of the first (top-left) pixel;
 * - `pixelSpacingMm` — **[x, y] = [col, row]**: the raw ImagePlanePixelSpacing
 *   (3002,0011) attribute is ordered [rowSpacing, colSpacing] and is SWAPPED
 *   here (identical for the square-pixel Eclipse DRRs);
 * - `sadMm`/`sidMm` — RadiationMachineSAD / RTImageSID for the guarded
 *   magnification factor (equal on Eclipse DRRs → mag 1).
 *
 * Returns undefined when RTImagePosition or ImagePlanePixelSpacing is missing
 * (not an RTIMAGE, or one we cannot place).
 */
export function parseRtImageBevGeometry(instance: Record<string, any>):
  | {
      rtImagePositionMm: [number, number];
      pixelSpacingMm: [number, number];
      sadMm?: number;
      sidMm?: number;
    }
  | undefined {
  const pos = toNumArray(instance?.RTImagePosition);
  const spacingRowCol = toNumArray(instance?.ImagePlanePixelSpacing);
  if (pos.length < 2 || spacingRowCol.length < 1) {
    return undefined;
  }
  const rowSpacing = spacingRowCol[0];
  const colSpacing = spacingRowCol.length > 1 ? spacingRowCol[1] : spacingRowCol[0];
  if (!(rowSpacing > 0) || !(colSpacing > 0)) {
    return undefined;
  }
  return {
    rtImagePositionMm: [pos[0], pos[1]],
    pixelSpacingMm: [colSpacing, rowSpacing],
    sadMm: toNum(instance?.RadiationMachineSAD),
    sidMm: toNum(instance?.RTImageSID),
  };
}

/**
 * ReferencedBeamNumber (300C,0006) of a naturalized RTIMAGE instance.
 * Top-level first (where this dataset carries it), then inside
 * ReferencedRTPlanSequence / ExposureSequence items.
 */
export function referencedBeamNumber(instance: Record<string, any>): number | undefined {
  const topLevel = toNum(instance?.ReferencedBeamNumber);
  if (topLevel != null) {
    return topLevel;
  }
  for (const seq of [instance?.ReferencedRTPlanSequence, instance?.ExposureSequence]) {
    for (const item of toArray(seq)) {
      const n = toNum((item as any)?.ReferencedBeamNumber);
      if (n != null) {
        return n;
      }
    }
  }
  return undefined;
}

export default parseRtPlanBev;
