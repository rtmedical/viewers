/**
 * Gating / temporal phase detection — pure core (RTV-93 respiratory, RTV-51 cardiac).
 *
 * ## Why this exists at all
 *
 * Cornerstone3D already splits a 4D series into time points and OHIF already
 * marks the display set `isDynamicVolume`, so **phase navigation and cine are
 * not reimplemented here** (see the extension README for exactly what is
 * reused). What the stack does *not* do is tell you what the phases *mean*.
 * `splitImageIdsBy4DTags` groups by whichever of `TemporalPositionIdentifier`,
 * `TriggerTime`, `EchoTime`, `DiffusionBValue`, … happens to vary, and hands back
 * an opaque `splittingTag` string. For a respiratory-gated 4D-CT the reader needs
 * "40% EX", not "time point 5 of 10"; for a cardiac study the physicist needs to
 * know whether the acquisition was **prospectively** or **retrospectively**
 * gated, because that changes what the phases are worth.
 *
 * This module reads the tags that carry that meaning — several of which appear
 * nowhere in the repo or in Cornerstone3D — and produces labelled phases.
 *
 * ## Tags read (DICOM keyword, tag)
 *
 * Respiratory:
 * - `NominalPercentageOfRespiratoryPhase` (0020,9241) — the authoritative phase %
 * - `RespiratorySignalSource` (0018,9171), `RespiratoryMotionCompensationTechnique` (0018,9170)
 *
 * Cardiac:
 * - `CardiacSynchronizationTechnique` (0018,9037) — NONE / REALTIME / PROSPECTIVE / RETROSPECTIVE / TRIGGERED
 * - `CardiacRRIntervalSpecified` (0018,9070), `CardiacNumberOfImages` (0018,1090)
 * - `TriggerTime` (0018,1060), `HeartRate` (0018,1088)
 *
 * Generic temporal:
 * - `TemporalPositionIndex` (0020,9128), `TemporalPositionIdentifier` (0020,0100),
 *   `NumberOfTemporalPositions` (0020,0105)
 *
 * Framework-free and `@ohif/*`-free, like the other `rt-*` cores. Zero-fork per RTV-114.
 */

export type GatingKind = 'respiratory' | 'cardiac' | 'temporal';

/**
 * `CardiacSynchronizationTechnique` (0018,9037) values, lower-cased.
 * The prospective/retrospective distinction is the point of RTV-51.
 */
export type CardiacTechnique =
  | 'none'
  | 'realtime'
  | 'prospective'
  | 'retrospective'
  | 'triggered'
  | 'unknown';

/** The subset of instance metadata this module reads. */
export interface PhaseInstanceLike {
  SeriesDescription?: string;
  // Respiratory
  NominalPercentageOfRespiratoryPhase?: number | string;
  RespiratorySignalSource?: string;
  RespiratoryMotionCompensationTechnique?: string;
  // Cardiac
  CardiacSynchronizationTechnique?: string;
  CardiacRRIntervalSpecified?: number | string;
  CardiacNumberOfImages?: number | string;
  TriggerTime?: number | string;
  HeartRate?: number | string;
  // Generic temporal
  TemporalPositionIndex?: number | string;
  TemporalPositionIdentifier?: number | string;
  NumberOfTemporalPositions?: number | string;
}

export interface Phase {
  /** 0-based position in the ordered phase list. */
  index: number;
  /** What the reader sees, e.g. "40% EX", "320 ms", "Phase 3". */
  label: string;
  /** Percent through the cycle, when known. */
  percent?: number;
  /** Trigger delay in ms, for cardiac phases that carry it. */
  triggerTimeMs?: number;
  /** How many instances fell in this phase. */
  instanceCount: number;
  /** The raw grouping value, for traceability. */
  key: string;
}

export interface GatingInfo {
  isGated: boolean;
  kind: GatingKind | null;
  phases: Phase[];
  /** DICOM keyword that produced the grouping, or `null`. */
  sourceTag: string | null;
  /** Cardiac only. */
  cardiacTechnique?: CardiacTechnique;
  /**
   * `NumberOfTemporalPositions` / `CardiacNumberOfImages` when present. A
   * mismatch against `phases.length` means the series is incomplete, which is
   * worth surfacing rather than hiding.
   */
  expectedPhaseCount?: number;
  /** Respiratory only, when the tags say how the signal was obtained. */
  respiratorySignalSource?: string;
}

const num = (value: unknown): number | undefined => {
  if (value == null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Normalises `CardiacSynchronizationTechnique` (0018,9037). */
export function parseCardiacTechnique(value?: string): CardiacTechnique | undefined {
  if (!value) {
    return undefined;
  }
  const v = String(value).trim().toUpperCase().replace(/[\s_-]+/g, '');
  switch (v) {
    case 'NONE':
      return 'none';
    case 'REALTIME':
      return 'realtime';
    case 'PROSPECTIVE':
      return 'prospective';
    case 'RETROSPECTIVE':
      return 'retrospective';
    case 'TRIGGERED':
      return 'triggered';
    default:
      return 'unknown';
  }
}

/**
 * Extracts a respiratory phase percent from a 4D-CT SeriesDescription.
 *
 * Vendors label 4D-CT reconstructions "0%", "10% EX", "50% IN", "Phase 30%" —
 * and that string is often the *only* place the phase lives, because the
 * per-frame respiratory functional group is absent from the classic
 * single-frame CT export. Returns the percent and, when present, the
 * inspiration/expiration marker.
 *
 * Deliberately narrow: the percent must be a standalone number followed by `%`,
 * so a description like "T1 100 slices" cannot produce a phase.
 */
export function parseRespiratoryLabel(
  description?: string
): { percent: number; marker?: 'IN' | 'EX' } | undefined {
  if (!description) {
    return undefined;
  }
  const text = String(description).toUpperCase();
  const match = text.match(/(?:^|[^\d.])(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!match) {
    return undefined;
  }
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return undefined;
  }

  // EX / EXP / EXPIRATION and IN / INSP / INSPIRATION, as whole tokens.
  const tokens = text.split(/[\\\s_\-./,()[\]+%]+/).filter(Boolean);
  const marker = tokens.some(t => t === 'EX' || t === 'EXP' || t === 'EXPIRATION')
    ? 'EX'
    : tokens.some(t => t === 'IN' || t === 'INSP' || t === 'INSPIRATION')
      ? 'IN'
      : undefined;

  return marker ? { percent, marker } : { percent };
}

interface Grouping {
  kind: GatingKind;
  sourceTag: string;
  /** Grouping key per instance; `undefined` means "not in any phase". */
  keyOf: (instance: PhaseInstanceLike) => string | undefined;
  /** Sort key for ordering phases. */
  sortOf: (key: string) => number;
  label: (key: string, instances: PhaseInstanceLike[]) => string;
  percentOf?: (key: string, instances: PhaseInstanceLike[]) => number | undefined;
  triggerOf?: (key: string, instances: PhaseInstanceLike[]) => number | undefined;
}

/** RR interval in ms, from the specified interval or the heart rate. */
function rrIntervalMs(instances: PhaseInstanceLike[]): number | undefined {
  for (const instance of instances) {
    const specified = num(instance.CardiacRRIntervalSpecified);
    if (specified && specified > 0) {
      return specified;
    }
  }
  for (const instance of instances) {
    const heartRate = num(instance.HeartRate);
    if (heartRate && heartRate > 0) {
      return 60000 / heartRate;
    }
  }
  return undefined;
}

/**
 * Grouping strategies, most meaningful first.
 *
 * Order matters and is the core judgement of this module: an explicit
 * respiratory percent beats a description string, which beats an opaque temporal
 * index. Cardiac trigger time is tried only when a cardiac tag says the study is
 * cardiac — `TriggerTime` alone also varies in plain multi-echo MR, and treating
 * that as gating would invent phases.
 */
function buildStrategies(all: PhaseInstanceLike[]): Grouping[] {
  const rr = rrIntervalMs(all);
  const cardiacDeclared = all.some(
    i =>
      parseCardiacTechnique(i.CardiacSynchronizationTechnique) != null ||
      num(i.CardiacRRIntervalSpecified) != null ||
      num(i.CardiacNumberOfImages) != null
  );

  return [
    {
      kind: 'respiratory',
      sourceTag: 'NominalPercentageOfRespiratoryPhase',
      keyOf: i => {
        const p = num(i.NominalPercentageOfRespiratoryPhase);
        return p == null ? undefined : String(p);
      },
      sortOf: Number,
      label: key => `${formatPercent(Number(key))}%`,
      percentOf: key => Number(key),
    },
    {
      kind: 'respiratory',
      sourceTag: 'SeriesDescription',
      keyOf: i => {
        const parsed = parseRespiratoryLabel(i.SeriesDescription);
        return parsed == null ? undefined : `${parsed.percent}${parsed.marker ? ` ${parsed.marker}` : ''}`;
      },
      sortOf: key => Number.parseFloat(key),
      label: key => {
        const [percent, marker] = key.split(' ');
        return `${formatPercent(Number(percent))}%${marker ? ` ${marker}` : ''}`;
      },
      percentOf: key => Number.parseFloat(key),
    },
    ...(cardiacDeclared
      ? ([
          {
            kind: 'cardiac',
            sourceTag: 'TriggerTime',
            keyOf: i => {
              const t = num(i.TriggerTime);
              return t == null ? undefined : String(t);
            },
            sortOf: Number,
            label: key => {
              const ms = Number(key);
              return rr && rr > 0
                ? `${formatPercent((ms / rr) * 100)}% (${formatMs(ms)} ms)`
                : `${formatMs(ms)} ms`;
            },
            percentOf: key => (rr && rr > 0 ? (Number(key) / rr) * 100 : undefined),
            triggerOf: key => Number(key),
          },
        ] as Grouping[])
      : []),
    {
      kind: 'temporal',
      sourceTag: 'TemporalPositionIndex',
      keyOf: i => {
        const t = num(i.TemporalPositionIndex);
        return t == null ? undefined : String(t);
      },
      sortOf: Number,
      label: key => `Phase ${key}`,
    },
    {
      kind: 'temporal',
      sourceTag: 'TemporalPositionIdentifier',
      keyOf: i => {
        const t = num(i.TemporalPositionIdentifier);
        return t == null ? undefined : String(t);
      },
      sortOf: Number,
      label: key => `Phase ${key}`,
    },
  ];
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '?';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMs(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Detects gating and labels the phases.
 *
 * A single phase is **not** gating: a series where every instance shares one
 * respiratory percent is one reconstruction, not a 4D set. Two is the floor.
 */
export function detectGating(instances: PhaseInstanceLike[]): GatingInfo {
  const all = (instances ?? []).filter(Boolean);
  const notGated: GatingInfo = { isGated: false, kind: null, phases: [], sourceTag: null };
  if (!all.length) {
    return notGated;
  }

  for (const strategy of buildStrategies(all)) {
    const buckets = new Map<string, PhaseInstanceLike[]>();
    for (const instance of all) {
      const key = strategy.keyOf(instance);
      if (key == null) {
        continue;
      }
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(instance);
      } else {
        buckets.set(key, [instance]);
      }
    }

    if (buckets.size < 2) {
      continue;
    }

    const phases: Phase[] = [...buckets.entries()]
      .sort((a, b) => {
        const sa = strategy.sortOf(a[0]);
        const sb = strategy.sortOf(b[0]);
        if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
          return sa - sb;
        }
        return a[0].localeCompare(b[0]);
      })
      .map(([key, bucket], index) => ({
        index,
        key,
        label: strategy.label(key, bucket),
        percent: strategy.percentOf?.(key, bucket),
        triggerTimeMs: strategy.triggerOf?.(key, bucket),
        instanceCount: bucket.length,
      }));

    const info: GatingInfo = {
      isGated: true,
      kind: strategy.kind,
      phases,
      sourceTag: strategy.sourceTag,
      expectedPhaseCount: expectedCount(all, strategy.kind),
    };

    if (strategy.kind === 'cardiac') {
      info.cardiacTechnique = firstCardiacTechnique(all);
    }
    const signalSource = all.find(i => i.RespiratorySignalSource)?.RespiratorySignalSource;
    if (strategy.kind === 'respiratory' && signalSource) {
      info.respiratorySignalSource = String(signalSource);
    }

    return info;
  }

  return notGated;
}

function firstCardiacTechnique(all: PhaseInstanceLike[]): CardiacTechnique {
  for (const instance of all) {
    const technique = parseCardiacTechnique(instance.CardiacSynchronizationTechnique);
    if (technique) {
      return technique;
    }
  }
  return 'unknown';
}

function expectedCount(all: PhaseInstanceLike[], kind: GatingKind): number | undefined {
  const tag = kind === 'cardiac' ? 'CardiacNumberOfImages' : 'NumberOfTemporalPositions';
  for (const instance of all) {
    const n = num((instance as Record<string, unknown>)[tag]);
    if (n && n > 0) {
      return n;
    }
  }
  return undefined;
}

/**
 * True when the phase list is shorter than the series says it should be.
 * A 4D-CT missing a phase silently is a real hazard for RT planning, because the
 * physicist may be contouring on an incomplete respiratory cycle.
 */
export function isPhaseSetIncomplete(info: GatingInfo): boolean {
  return (
    info.isGated &&
    info.expectedPhaseCount != null &&
    info.phases.length > 0 &&
    info.phases.length < info.expectedPhaseCount
  );
}

/** One-line summary for the panel header. */
export function describeGating(info: GatingInfo): string {
  if (!info.isGated) {
    return 'Not gated';
  }
  const parts: string[] = [];
  if (info.kind === 'cardiac') {
    const technique = info.cardiacTechnique;
    parts.push(
      technique && technique !== 'unknown' && technique !== 'none'
        ? `Cardiac (${technique})`
        : 'Cardiac'
    );
  } else if (info.kind === 'respiratory') {
    parts.push('Respiratory');
  } else {
    parts.push('Temporal');
  }

  parts.push(`${info.phases.length} phases`);
  if (isPhaseSetIncomplete(info)) {
    parts.push(`incomplete (expected ${info.expectedPhaseCount})`);
  }
  return parts.join(' · ');
}
