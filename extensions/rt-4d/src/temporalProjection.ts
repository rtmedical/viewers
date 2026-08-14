/**
 * Temporal projection — pure core (RTV-93).
 *
 * ## Why this is written by hand
 *
 * Cornerstone3D can already reduce a dynamic volume along time, but its
 * `DynamicOperatorType` enum offers exactly **SUM, AVERAGE and SUBTRACT**.
 * There is no MAX and no MIN. For 4D-CT that is the gap that matters: RT
 * planning is built on the **MIP across the respiratory cycle** (the union of
 * tumour positions, from which the ITV is drawn) and on the **MinIP** (used for
 * airway and lung work). Neither can be expressed as a sum or an average.
 *
 * Patching `node_modules` or the core is forbidden (RTV-114), so the reduction
 * lives here and feeds `createAndCacheDerivedVolume` directly — the same shape
 * the upstream 4D panel uses, just with the two operations it lacks.
 *
 * Framework-free: the volume is reached through a tiny accessor interface, so
 * this module is unit-testable without cornerstone, a GPU or a browser.
 */

export type TemporalOperation = 'MIP' | 'MinIP' | 'AvgIP' | 'SUM';

export const TEMPORAL_OPERATIONS: TemporalOperation[] = ['MIP', 'MinIP', 'AvgIP', 'SUM'];

/** Full labels, for the panel's operation picker. */
export const TEMPORAL_OPERATION_LABELS: Record<TemporalOperation, string> = {
  MIP: 'MIP (max over phases)',
  MinIP: 'MinIP (min over phases)',
  AvgIP: 'Average over phases',
  SUM: 'Sum over phases',
};

/**
 * Short names, for composing a derived series description.
 * Kept as its own map rather than stripped out of the label above: two of those
 * labels already contain the words "over phases", so deriving from them produced
 * "Average over phases over phases 1, 2".
 */
export const TEMPORAL_OPERATION_SHORT: Record<TemporalOperation, string> = {
  MIP: 'MIP',
  MinIP: 'MinIP',
  AvgIP: 'Average',
  SUM: 'Sum',
};

/**
 * Minimal view of a dynamic volume.
 *
 * In production `getPhaseData` wraps
 * `volume.voxelManager.getDimensionGroupScalarData(n)`; in tests it is an array
 * lookup. Nothing else about the volume is needed.
 */
export interface PhaseDataSource {
  phaseCount: number;
  voxelCount: number;
  getPhaseData(phaseIndex: number): ArrayLike<number> | undefined;
}

/** Builds a source from plain arrays — used by tests and by simple callers. */
export function phaseDataSourceFromArrays(phases: ArrayLike<number>[]): PhaseDataSource {
  const list = phases ?? [];
  return {
    phaseCount: list.length,
    voxelCount: list.length ? list[0].length : 0,
    getPhaseData: index => list[index],
  };
}

export interface ProjectionOptions {
  /**
   * Which phases to include, 0-based. Omit for all of them. Out-of-range and
   * duplicate indices are dropped, so a slider that overshoots cannot throw.
   */
  phaseIndices?: number[];
  /** Reuse an existing buffer instead of allocating (the volume's scalar data). */
  output?: Float32Array;
}

/** Normalises and validates the requested phase list. */
export function resolvePhaseIndices(source: PhaseDataSource, requested?: number[]): number[] {
  const count = Math.max(0, Math.floor(source?.phaseCount ?? 0));
  if (!requested) {
    return Array.from({ length: count }, (_unused, i) => i);
  }
  const seen = new Set<number>();
  const resolved: number[] = [];
  for (const raw of requested) {
    const index = Math.floor(Number(raw));
    if (Number.isFinite(index) && index >= 0 && index < count && !seen.has(index)) {
      seen.add(index);
      resolved.push(index);
    }
  }
  return resolved;
}

/**
 * Reduces the volume along the temporal axis.
 *
 * Non-finite samples are **skipped**, not propagated: one NaN voxel in one phase
 * must not blank that voxel in the projection. A voxel with no finite sample at
 * all resolves to 0, which is what a derived scalar volume expects for "no data".
 *
 * Streams phase by phase — only one phase's scalar data plus the accumulator is
 * held at a time, which matters on the machines this runs on.
 *
 * @throws RangeError when there is nothing to project.
 */
export function projectOverPhases(
  source: PhaseDataSource,
  operation: TemporalOperation,
  options: ProjectionOptions = {}
): Float32Array {
  const indices = resolvePhaseIndices(source, options.phaseIndices);
  if (!indices.length) {
    throw new RangeError('projectOverPhases: no phases selected.');
  }

  const voxelCount = Math.max(0, Math.floor(source.voxelCount ?? 0));
  if (!voxelCount) {
    throw new RangeError('projectOverPhases: voxelCount is zero.');
  }

  if (options.output && options.output.length < voxelCount) {
    throw new RangeError(
      `projectOverPhases: output buffer holds ${options.output.length}, needs ${voxelCount}.`
    );
  }

  const out = options.output ?? new Float32Array(voxelCount);
  // How many finite samples each voxel actually received. Needed for AvgIP, and
  // to tell "never written" from "legitimately zero" for MIP/MinIP.
  const counts = new Uint32Array(voxelCount);

  const isMax = operation === 'MIP';
  const isMin = operation === 'MinIP';

  for (const phaseIndex of indices) {
    const data = source.getPhaseData(phaseIndex);
    if (!data) {
      // A phase that fails to load is skipped rather than aborting the whole
      // projection; `counts` keeps the result honest.
      continue;
    }
    const length = Math.min(voxelCount, data.length);
    for (let v = 0; v < length; v++) {
      const value = data[v];
      if (!Number.isFinite(value)) {
        continue;
      }
      if (counts[v] === 0) {
        out[v] = value;
      } else if (isMax) {
        if (value > out[v]) {
          out[v] = value;
        }
      } else if (isMin) {
        if (value < out[v]) {
          out[v] = value;
        }
      } else {
        out[v] += value;
      }
      counts[v] += 1;
    }
  }

  if (operation === 'AvgIP') {
    for (let v = 0; v < voxelCount; v++) {
      if (counts[v] > 1) {
        out[v] /= counts[v];
      }
    }
  }

  // Voxels no phase contributed to: explicit zero, so a reused buffer cannot
  // leak values from a previous projection.
  for (let v = 0; v < voxelCount; v++) {
    if (counts[v] === 0) {
      out[v] = 0;
    }
  }

  return out;
}

/**
 * A display name for the derived series, e.g. "MIP over phases 1-10".
 * Used as the derived display set's SeriesDescription so the reader can tell
 * a projection apart from an acquired series in the study browser.
 */
export function describeProjection(
  operation: TemporalOperation,
  phaseIndices: number[],
  phaseLabels?: string[]
): string {
  const base = TEMPORAL_OPERATION_SHORT[operation] ?? operation;
  if (!phaseIndices?.length) {
    return base;
  }
  const named = phaseLabels?.length
    ? phaseIndices.map(i => phaseLabels[i] ?? String(i + 1))
    : phaseIndices.map(i => String(i + 1));

  const contiguous =
    phaseIndices.length > 2 &&
    phaseIndices.every((value, i) => i === 0 || value === phaseIndices[i - 1] + 1);

  return contiguous
    ? `${base} over phases ${named[0]}-${named[named.length - 1]}`
    : `${base} over phases ${named.join(', ')}`;
}
