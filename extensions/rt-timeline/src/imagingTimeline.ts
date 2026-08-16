/**
 * The imaging timeline of a treatment course: classifying the seven kinds — pure core
 * (RTV-167).
 *
 * A course generates verification imaging of very different natures, and the record shows
 * them side by side. Getting the kind wrong is not cosmetic: it changes what the image
 * means, what may be measured on it, and whether its dose belongs to the patient's
 * treatment or to their imaging burden.
 *
 * ## Classify from attributes, never from the series description
 *
 * `SeriesDescription` is typed by whoever set up the protocol. A site that calls its
 * cone-beam protocol "CBCT Pelve" and one that calls it "Volume View" produce the same
 * images, and a classifier keyed on the string finds one and loses the other. Worse, a
 * kV pair described as "CBCT setup" gets filed as a cone-beam, and the timeline then
 * reports a volumetric acquisition that never happened.
 *
 * So the description is used for nothing except display, and
 * {@link classifyImagingSeries} returns `unknown` when the attributes do not decide.
 * **Unknown is a legitimate answer**: defaulting an unclassifiable series into the most
 * common bucket hides it somewhere plausible, where nobody will ever look for it again.
 *
 * ## kV and MV are not two settings of one thing
 *
 * An MV portal image is made with the treatment beam. Its dose is delivered by the linac at
 * therapeutic energy, along the beam axis, into the target — it is part of the treatment,
 * and in some protocols it is accounted for in the plan. A kV image is imaging dose from a
 * separate tube, at a different angle, and belongs to the patient's imaging burden.
 * {@link doseAttribution} keeps the two apart, because summing them produces a number that
 * describes neither.
 *
 * ## A portal dose image is a dosimetric map, not a picture
 *
 * It carries dose units. Windowing it like an anatomical image and reading anatomy off it
 * is a category error that looks like a badly windowed portal film.
 *
 * ## An image pair is one event
 *
 * Two orthogonal images acquired seconds apart are a single setup verification. Listing
 * them separately doubles the apparent imaging frequency and quietly corrupts every
 * per-fraction statistic built on top of the timeline.
 *
 * ## Simulation imaging is not part of the course
 *
 * It belongs to planning. Placed on the treatment axis at its acquisition date, it makes
 * the course appear to have started weeks before the first fraction.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type ImagingKind =
  | 'kv'
  | 'mv'
  | 'cbct'
  | 'portal-dose'
  | 'movie'
  | 'simulation'
  | 'image-pair'
  | 'unknown';

export const KIND_LABELS: Record<ImagingKind, string> = {
  kv: 'kV',
  mv: 'MV',
  cbct: 'CBCT',
  'portal-dose': 'dose portal',
  movie: 'cine',
  simulation: 'simulação',
  'image-pair': 'par ortogonal',
  unknown: 'não classificado',
};

/** kVp above this is not a diagnostic tube. */
export const KV_MAX_KVP = 160;

export interface ImagingSeries {
  seriesInstanceUid: string;
  /** DICOM Modality. */
  modality: string;
  /** Epoch ms. */
  acquiredAt: number;
  /** Display only. Never used to classify. */
  seriesDescription?: string;
  /** Peak tube voltage, kV. Present for kV imaging. */
  kvp?: number;
  /** Nominal treatment beam energy, MV. Present for MV imaging. */
  beamEnergyMv?: number;
  /** Present on a portal dose image. */
  doseUnits?: string;
  numberOfFrames?: number;
  /** Set by the reconstruction: this CT came from a cone beam. */
  coneBeam?: boolean;
  /** Declared acquisition intent, when the record carries one. */
  intent?: 'treatment' | 'simulation';
  gantryAngleDeg?: number;
  /** Fraction this belongs to, when the record says. */
  fraction?: number;
}

export interface Classification {
  kind: ImagingKind;
  /** Why it was classified this way, or what was missing. */
  reason: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const upper = (value: unknown): string => String(value ?? '').trim().toUpperCase();

/**
 * The kind of a single series.
 *
 * Returns `unknown` rather than a guess. A series filed into the most common bucket because
 * nothing else fit is a series nobody will ever find again.
 */
export function classifyImagingSeries(series: ImagingSeries): Classification {
  if (!series) {
    return { kind: 'unknown', reason: 'Série ausente.' };
  }

  const modality = upper(series.modality);

  if (series.intent === 'simulation') {
    return { kind: 'simulation', reason: 'Intenção declarada de simulação.' };
  }

  if (modality === 'CT') {
    if (series.coneBeam === true) {
      return { kind: 'cbct', reason: 'CT reconstruída de feixe cônico.' };
    }
    if (series.coneBeam === false) {
      return {
        kind: 'simulation',
        reason: 'CT de feixe em leque — no contexto de um curso, é a tomografia de planejamento.',
      };
    }
    return {
      kind: 'unknown',
      reason:
        'CT sem indicação de feixe cônico. Não dá para distinguir CBCT de CT de simulação por descrição de série, ' +
        'e classificar errado faz a linha do tempo reportar uma aquisição volumétrica que não houve.',
    };
  }

  if (modality === 'RTIMAGE') {
    if (String(series.doseUnits ?? '').trim()) {
      return { kind: 'portal-dose', reason: 'Imagem com unidades de dose — mapa dosimétrico, não anatômico.' };
    }
    const frames = num(series.numberOfFrames);
    if (Number.isFinite(frames) && frames > 1) {
      return { kind: 'movie', reason: `Aquisição com ${frames} quadros.` };
    }
    const kvp = num(series.kvp);
    if (Number.isFinite(kvp) && kvp > 0 && kvp <= KV_MAX_KVP) {
      return { kind: 'kv', reason: `Tubo diagnóstico a ${kvp} kVp.` };
    }
    const mv = num(series.beamEnergyMv);
    if (Number.isFinite(mv) && mv > 0) {
      return { kind: 'mv', reason: `Feixe de tratamento a ${mv} MV.` };
    }
    return {
      kind: 'unknown',
      reason: 'RTIMAGE sem kVp nem energia de feixe — não dá para dizer se a dose veio do tubo ou do acelerador.',
    };
  }

  if (modality === 'RTRECORD' || modality === 'RTPLAN' || modality === 'RTSTRUCT') {
    return { kind: 'unknown', reason: `${modality} não é uma série de imagem de verificação.` };
  }

  return { kind: 'unknown', reason: `Modalidade ${series.modality || '?'} não reconhecida.` };
}

export type DoseSource = 'treatment-beam' | 'imaging-only' | 'none';

export interface DoseAttribution {
  source: DoseSource;
  message: string;
}

/**
 * Whose dose budget this image belongs to.
 *
 * MV imaging is made with the treatment beam, at therapeutic energy, along the beam axis;
 * some protocols account for it inside the plan. kV imaging is a separate tube at a
 * different angle and belongs to the imaging burden. Adding the two produces a number that
 * describes neither.
 */
export function doseAttribution(kind: ImagingKind): DoseAttribution {
  switch (kind) {
    case 'mv':
    case 'portal-dose':
      return {
        source: 'treatment-beam',
        message:
          'Feita com o feixe de tratamento, em energia terapêutica e no eixo do feixe — parte do tratamento, e em alguns protocolos contabilizada no plano.',
      };
    case 'kv':
    case 'cbct':
    case 'movie':
      return {
        source: 'imaging-only',
        message: 'Dose de imagem, de um tubo separado e em outro ângulo — entra na carga de imagem, não no plano.',
      };
    case 'simulation':
      return { source: 'none', message: 'Pertence ao planejamento, não ao curso.' };
    default:
      return {
        source: 'none',
        message: 'Não classificada — a dose não pode ser atribuída, e somá-la a qualquer um dos lados seria inventar.',
      };
  }
}

export interface DisplayRules {
  /** Whether an anatomical window/level makes sense. */
  anatomicalWindow: boolean;
  /** Whether geometric measurement on the image is meaningful. */
  measurable: boolean;
  note: string;
}

/**
 * What may be done with the image.
 *
 * A portal dose image windowed like a portal film looks like a badly windowed portal film,
 * which is why the rule has to be stated rather than left to the viewer.
 */
export function displayRules(kind: ImagingKind): DisplayRules {
  if (kind === 'portal-dose') {
    return {
      anatomicalWindow: false,
      measurable: false,
      note:
        'Mapa dosimétrico em unidades de dose. Janelar como imagem anatômica e ler anatomia dela é erro de categoria — ' +
        'e o resultado parece apenas uma imagem portal mal janelada.',
    };
  }
  if (kind === 'unknown') {
    return { anatomicalWindow: false, measurable: false, note: 'Natureza da imagem desconhecida.' };
  }
  return { anatomicalWindow: true, measurable: true, note: '' };
}

export interface ImagingEvent {
  /** One or two series. */
  series: ImagingSeries[];
  kind: ImagingKind;
  at: number;
  fraction?: number;
  reason: string;
}

/** Two orthogonal images acquired within this window are one setup verification. */
export const PAIR_WINDOW_SEC = 120;
/** How far from 90 degrees the two gantry angles may be. */
export const ORTHOGONAL_TOLERANCE_DEG = 15;

function angularSeparation(a: number, b: number): number {
  const raw = Math.abs(((a - b) % 360) + 360) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/**
 * Groups the series into events, pairing orthogonal kV images.
 *
 * Two images listed separately double the apparent imaging frequency, and every
 * per-fraction statistic built on the timeline inherits the error without anything looking
 * wrong.
 */
export function buildImagingEvents(
  seriesList: ImagingSeries[],
  options: { pairWindowSec?: number; orthogonalToleranceDeg?: number } = {}
): ImagingEvent[] {
  const windowMs =
    (Number.isFinite(num(options.pairWindowSec)) ? Number(options.pairWindowSec) : PAIR_WINDOW_SEC) * 1000;
  const tolerance = Number.isFinite(num(options.orthogonalToleranceDeg))
    ? Number(options.orthogonalToleranceDeg)
    : ORTHOGONAL_TOLERANCE_DEG;

  const sorted = (seriesList ?? [])
    .filter(s => s && Number.isFinite(num(s.acquiredAt)))
    .slice()
    .sort((a, b) => a.acquiredAt - b.acquiredAt);

  const events: ImagingEvent[] = [];
  const used = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (used.has(a.seriesInstanceUid)) {
      continue;
    }
    const classificationA = classifyImagingSeries(a);

    let paired: ImagingSeries | null = null;
    if (classificationA.kind === 'kv' || classificationA.kind === 'mv') {
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (used.has(b.seriesInstanceUid) || b.acquiredAt - a.acquiredAt > windowMs) {
          break;
        }
        if (classifyImagingSeries(b).kind !== classificationA.kind) {
          continue;
        }
        const angleA = num(a.gantryAngleDeg);
        const angleB = num(b.gantryAngleDeg);
        if (!Number.isFinite(angleA) || !Number.isFinite(angleB)) {
          continue;
        }
        if (Math.abs(angularSeparation(angleA, angleB) - 90) <= tolerance) {
          paired = b;
          break;
        }
      }
    }

    if (paired) {
      used.add(a.seriesInstanceUid);
      used.add(paired.seriesInstanceUid);
      events.push({
        series: [a, paired],
        kind: 'image-pair',
        at: a.acquiredAt,
        fraction: a.fraction,
        reason: `Duas imagens ${KIND_LABELS[classificationA.kind]} ortogonais em ${((paired.acquiredAt - a.acquiredAt) / 1000).toFixed(0)}s — uma única verificação de setup.`,
      });
      continue;
    }

    used.add(a.seriesInstanceUid);
    events.push({
      series: [a],
      kind: classificationA.kind,
      at: a.acquiredAt,
      fraction: a.fraction,
      reason: classificationA.reason,
    });
  }

  return events;
}

export interface CourseTimeline {
  /** Events that belong on the treatment axis. */
  events: ImagingEvent[];
  /** Simulation imaging, kept off the axis. */
  planning: ImagingEvent[];
  unclassified: ImagingEvent[];
  message: string;
}

/**
 * Splits the events into the treatment axis, planning, and what could not be classified.
 *
 * Simulation is excluded rather than plotted early: on the treatment axis at its
 * acquisition date it makes the course appear to have started weeks before the first
 * fraction, and every duration read off the chart is then wrong.
 */
export function courseImagingTimeline(events: ImagingEvent[]): CourseTimeline {
  const list = events ?? [];
  const planning = list.filter(e => e.kind === 'simulation');
  const unclassified = list.filter(e => e.kind === 'unknown');
  const onAxis = list.filter(e => e.kind !== 'simulation' && e.kind !== 'unknown');

  const parts = [`${onAxis.length} evento(s) de imagem no curso.`];
  if (planning.length) {
    parts.push(
      `${planning.length} de simulação mantida(s) fora do eixo: no eixo de tratamento ela faz o curso parecer ter começado semanas antes da primeira fração.`
    );
  }
  if (unclassified.length) {
    parts.push(
      `${unclassified.length} não classificada(s) — listada(s) à parte em vez de encaixada(s) no balde mais comum.`
    );
  }

  return { events: onAxis, planning, unclassified, message: parts.join(' ') };
}

export interface FractionStats {
  fraction: number;
  events: number;
  byKind: Partial<Record<ImagingKind, number>>;
}

/** Imaging events per fraction — the statistic that a duplicated pair would inflate. */
export function perFraction(events: ImagingEvent[]): FractionStats[] {
  const byFraction = new Map<number, FractionStats>();
  for (const event of events ?? []) {
    const fraction = num(event.fraction);
    if (!Number.isFinite(fraction)) {
      continue;
    }
    const entry = byFraction.get(fraction) ?? { fraction, events: 0, byKind: {} };
    entry.events++;
    entry.byKind[event.kind] = (entry.byKind[event.kind] ?? 0) + 1;
    byFraction.set(fraction, entry);
  }
  return [...byFraction.values()].sort((a, b) => a.fraction - b.fraction);
}

/** One line per event for the imaging timeline. */
export function describeEvent(event: ImagingEvent): string {
  const label = KIND_LABELS[event.kind];
  const fraction = Number.isFinite(num(event.fraction)) ? ` · fração ${event.fraction}` : '';
  return `${label}${fraction} — ${event.reason}`;
}
