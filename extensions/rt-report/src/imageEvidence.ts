/**
 * Image evidence for report findings — pure core (RTV-221).
 *
 * A structured finding that says "8 mm" without saying *where* is a number somebody has to
 * take on faith and nobody can re-check. This is the link back to the pixels, in the shape
 * DICOM SR already defines so it can be exported rather than reinvented.
 *
 * ## A 2D image coordinate does not survive a re-reconstruction; a 3D one does
 *
 * DICOM has two spatial coordinate types and they are not interchangeable:
 *
 * - **SCOORD** is in image pixel coordinates and belongs to one specific SOP instance. If
 *   the series is re-reconstructed at a different slice thickness — which happens, and is
 *   invisible to the report — the SOP instances are new and the coordinates point at
 *   nothing. Worse, they may point at *something*, in the wrong place.
 * - **SCOORD3D** is in the frame of reference and survives it, because a patient-coordinate
 *   point is still that point after any reconstruction of the same acquisition.
 *
 * So the type is recorded, never inferred, and {@link assessDurability} says plainly which
 * kind of link a finding has. A report whose evidence all dangles after a re-reconstruction
 * looks fine until somebody clicks.
 *
 * ## Frame numbers are 1-based
 *
 * DICOM counts frames from 1. Every array in the code counts from 0. The off-by-one puts
 * the arrow on the wrong slice, and on a 200-frame multi-frame object nobody notices which
 * direction it is off by. It is validated here rather than being a convention people
 * remember.
 *
 * ## Evidence has to belong to the study being reported
 *
 * A reference to a SOP instance from a different study is either a mis-click or a
 * cross-contamination between two patients' reports. Both are worth failing on.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type CoordinateSpace = 'image2d' | 'patient3d';

export const COORDINATE_LABELS: Record<CoordinateSpace, string> = {
  image2d: 'coordenada de imagem (SCOORD)',
  patient3d: 'coordenada de paciente (SCOORD3D)',
};

/** DICOM SR graphic types, restricted to the ones a finding actually uses. */
export type GraphicType = 'POINT' | 'CIRCLE' | 'ELLIPSE' | 'POLYLINE';

export interface ImageReference {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  sopClassUid?: string;
  /** 1-based, per DICOM. Absent for a single-frame object. */
  frameNumber?: number;
}

export interface SpatialAnnotation {
  space: CoordinateSpace;
  graphicType: GraphicType;
  /**
   * Flat coordinate list. For `image2d` these are column/row pairs; for `patient3d` they
   * are x/y/z triples in the frame of reference.
   */
  data: number[];
  /** Required for `patient3d`: the frame of reference the coordinates live in. */
  frameOfReferenceUid?: string;
}

export interface Evidence {
  id: string;
  reference: ImageReference;
  annotation?: SpatialAnnotation;
  /** Free-text note about what the reader is being pointed at. */
  label?: string;
}

const text = (v: unknown): string => String(v ?? '').trim();

export type EvidenceIssueCode =
  | 'missingUid'
  | 'wrongStudy'
  | 'frameNotPositive'
  | 'frameOnSingleFrame'
  | 'missingFrameOfReference'
  | 'wrongCoordinateCount'
  | 'emptyAnnotation';

export interface EvidenceIssue {
  code: EvidenceIssueCode;
  severity: 'error' | 'warning';
  message: string;
  evidenceId?: string;
}

/** Coordinates per point, by space. */
const COMPONENTS: Record<CoordinateSpace, number> = { image2d: 2, patient3d: 3 };

/** Minimum points a graphic type needs to mean anything. */
const MIN_POINTS: Record<GraphicType, number> = {
  POINT: 1,
  CIRCLE: 2,
  ELLIPSE: 4,
  POLYLINE: 2,
};

export interface ValidationContext {
  /** The study the report is about. Evidence outside it is refused. */
  studyInstanceUid: string;
  /** SOP instances known to be multi-frame, if the caller knows. */
  multiFrameSopInstanceUids?: string[];
  /** Frame counts by SOP instance, if the caller knows. */
  frameCounts?: Record<string, number>;
}

/**
 * Validates one piece of evidence.
 *
 * Everything that would make the link dangle or point at the wrong pixel is an error;
 * things that merely weaken it are warnings.
 */
export function validateEvidence(
  evidence: Evidence,
  context: ValidationContext
): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const id = text(evidence?.id);
  const reference = evidence?.reference;

  const push = (code: EvidenceIssueCode, severity: 'error' | 'warning', message: string) =>
    issues.push({ code, severity, message, evidenceId: id });

  if (!text(reference?.studyInstanceUid) || !text(reference?.sopInstanceUid) || !text(reference?.seriesInstanceUid)) {
    push('missingUid', 'error', 'Evidência sem Study, Series ou SOP Instance UID.');
    return issues;
  }

  // Either a mis-click or a cross-contamination between two patients' reports.
  if (text(reference.studyInstanceUid) !== text(context?.studyInstanceUid)) {
    push(
      'wrongStudy',
      'error',
      `Evidência aponta para o estudo ${reference.studyInstanceUid}, que não é o estudo do laudo.`
    );
  }

  const frame = reference.frameNumber;
  if (frame !== undefined) {
    const numeric = Number(frame);
    if (!Number.isInteger(numeric) || numeric < 1) {
      // DICOM counts frames from 1; every array counts from 0.
      push(
        'frameNotPositive',
        'error',
        `Frame ${frame} inválido — no DICOM os frames começam em 1, não em 0.`
      );
    } else {
      const count = context?.frameCounts?.[text(reference.sopInstanceUid)];
      if (Number.isFinite(Number(count)) && numeric > Number(count)) {
        push(
          'frameNotPositive',
          'error',
          `Frame ${numeric} além dos ${count} frames do objeto.`
        );
      }
      const multiFrame = (context?.multiFrameSopInstanceUids ?? []).map(text);
      if (multiFrame.length && !multiFrame.includes(text(reference.sopInstanceUid))) {
        push(
          'frameOnSingleFrame',
          'warning',
          'Número de frame informado num objeto de frame único — provavelmente sobra de um multi-frame.'
        );
      }
    }
  }

  const annotation = evidence?.annotation;
  if (annotation) {
    const components = COMPONENTS[annotation.space];
    if (!components) {
      push('emptyAnnotation', 'error', 'Espaço de coordenadas não informado.');
    } else {
      const data = (annotation.data ?? []).map(Number).filter(Number.isFinite);
      if (!data.length) {
        push('emptyAnnotation', 'error', 'Anotação sem coordenadas.');
      } else if (data.length % components !== 0) {
        push(
          'wrongCoordinateCount',
          'error',
          `${data.length} coordenadas não formam pontos de ${components} componentes em ${COORDINATE_LABELS[annotation.space]}.`
        );
      } else {
        const points = data.length / components;
        const minimum = MIN_POINTS[annotation.graphicType] ?? 1;
        if (points < minimum) {
          push(
            'wrongCoordinateCount',
            'error',
            `${annotation.graphicType} precisa de ao menos ${minimum} ponto(s) e tem ${points}.`
          );
        }
      }
      if (annotation.space === 'patient3d' && !text(annotation.frameOfReferenceUid)) {
        // A patient coordinate with no frame of reference is a triple of numbers.
        push(
          'missingFrameOfReference',
          'error',
          'Coordenada de paciente sem Frame of Reference UID — sem ele o ponto não localiza nada.'
        );
      }
    }
  }

  return issues;
}

export type Durability = 'survivesReconstruction' | 'boundToInstance' | 'noSpatialLink';

export interface DurabilityAssessment {
  durability: Durability;
  message: string;
}

/**
 * How well this evidence survives the series being re-reconstructed.
 *
 * A report whose evidence all dangles after a re-reconstruction looks fine until somebody
 * clicks — which is typically months later, in a follow-up, when it matters.
 */
export function assessDurability(evidence: Evidence): DurabilityAssessment {
  const annotation = evidence?.annotation;
  if (!annotation) {
    return {
      durability: 'noSpatialLink',
      message: 'Evidência aponta para a imagem inteira, sem coordenada.',
    };
  }
  if (annotation.space === 'patient3d') {
    return {
      durability: 'survivesReconstruction',
      message:
        'Coordenada de paciente — continua válida se a série for reconstruída de novo a partir da mesma aquisição.',
    };
  }
  return {
    durability: 'boundToInstance',
    message:
      'Coordenada de imagem — presa a este SOP Instance. Se a série for reconstruída, o ponto deixa de existir (ou pior, passa a apontar para outro lugar).',
  };
}

export interface EvidenceSummary {
  total: number;
  bySpace: Record<CoordinateSpace | 'none', number>;
  fragile: string[];
  issues: EvidenceIssue[];
  ok: boolean;
}

/** Validates and summarises a report's whole evidence set. */
export function summariseEvidence(
  evidence: Evidence[],
  context: ValidationContext
): EvidenceSummary {
  const issues: EvidenceIssue[] = [];
  const bySpace: EvidenceSummary['bySpace'] = { image2d: 0, patient3d: 0, none: 0 };
  const fragile: string[] = [];

  for (const item of evidence ?? []) {
    issues.push(...validateEvidence(item, context));
    const space = item?.annotation?.space;
    if (space === 'image2d' || space === 'patient3d') {
      bySpace[space] += 1;
    } else {
      bySpace.none += 1;
    }
    if (assessDurability(item).durability === 'boundToInstance') {
      fragile.push(text(item?.id));
    }
  }

  return {
    total: (evidence ?? []).length,
    bySpace,
    fragile,
    issues,
    ok: !issues.some(i => i.severity === 'error'),
  };
}

export interface SrContentItem {
  ValueType: 'IMAGE' | 'SCOORD' | 'SCOORD3D';
  ConceptNameCodeSequence?: { CodeValue: string; CodingSchemeDesignator: string; CodeMeaning: string };
  ReferencedSOPSequence?: Array<{
    ReferencedSOPClassUID?: string;
    ReferencedSOPInstanceUID: string;
    ReferencedFrameNumber?: number;
  }>;
  GraphicType?: GraphicType;
  GraphicData?: number[];
  ReferencedFrameOfReferenceUID?: string;
  ContentSequence?: SrContentItem[];
}

/**
 * Renders evidence as DICOM SR content items.
 *
 * Uses the shape the standard already defines rather than inventing one: a finding exported
 * as SR is readable by any PACS, and a bespoke JSON blob is readable by this viewer.
 *
 * A 2D annotation is nested *under* its IMAGE item, because the coordinates only mean
 * anything relative to that instance. A 3D annotation sits beside it with its frame of
 * reference, because it does not.
 */
export function toSrContent(evidence: Evidence): SrContentItem | null {
  const reference = evidence?.reference;
  if (!text(reference?.sopInstanceUid)) {
    return null;
  }

  const image: SrContentItem = {
    ValueType: 'IMAGE',
    ReferencedSOPSequence: [
      {
        ReferencedSOPClassUID: text(reference.sopClassUid) || undefined,
        ReferencedSOPInstanceUID: text(reference.sopInstanceUid),
        ReferencedFrameNumber: reference.frameNumber,
      },
    ],
  };

  const annotation = evidence?.annotation;
  if (!annotation) {
    return image;
  }

  if (annotation.space === 'image2d') {
    return {
      ValueType: 'SCOORD',
      GraphicType: annotation.graphicType,
      GraphicData: annotation.data,
      // Nested: the coordinates only mean anything relative to this instance.
      ContentSequence: [image],
    };
  }

  return {
    ValueType: 'SCOORD3D',
    GraphicType: annotation.graphicType,
    GraphicData: annotation.data,
    ReferencedFrameOfReferenceUID: text(annotation.frameOfReferenceUid),
    ContentSequence: [image],
  };
}

/** One line for the evidence chip next to a finding. */
export function describeEvidence(evidence: Evidence): string {
  if (!evidence?.reference?.sopInstanceUid) {
    return '';
  }
  const frame = evidence.reference.frameNumber ? ` frame ${evidence.reference.frameNumber}` : '';
  const label = text(evidence.label);
  const durability = assessDurability(evidence);
  const head = label || `SOP ${evidence.reference.sopInstanceUid}${frame}`;
  return `${head} · ${durability.message}`;
}
