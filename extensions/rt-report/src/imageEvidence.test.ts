import {
  assessDurability,
  COORDINATE_LABELS,
  describeEvidence,
  Evidence,
  summariseEvidence,
  toSrContent,
  validateEvidence,
  ValidationContext,
} from './imageEvidence';

const STUDY = '1.2.3';
const CONTEXT: ValidationContext = { studyInstanceUid: STUDY };

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  id: 'e1',
  reference: {
    studyInstanceUid: STUDY,
    seriesInstanceUid: '1.2.3.1',
    sopInstanceUid: '1.2.3.1.1',
  },
  ...over,
});

const withPoint = (space: 'image2d' | 'patient3d') =>
  evidence({
    annotation: {
      space,
      graphicType: 'POINT',
      data: space === 'image2d' ? [120, 200] : [10, 20, 30],
      frameOfReferenceUid: space === 'patient3d' ? 'FOR-1' : undefined,
    },
  });

describe('imageEvidence — the coordinate space is recorded, never inferred', () => {
  // SCOORD is bound to one SOP instance; SCOORD3D survives a re-reconstruction.
  it('a patient coordinate survives a re-reconstruction', () => {
    const result = assessDurability(withPoint('patient3d'));
    expect(result.durability).toBe('survivesReconstruction');
    expect(result.message).toMatch(/mesma aquisição/);
  });

  // Worse than dangling: it may point at SOMETHING, in the wrong place.
  it('an image coordinate does not, and says what happens instead', () => {
    const result = assessDurability(withPoint('image2d'));
    expect(result.durability).toBe('boundToInstance');
    expect(result.message).toMatch(/passa a apontar para outro lugar/);
  });

  it('evidence with no annotation points at the whole image', () => {
    expect(assessDurability(evidence()).durability).toBe('noSpatialLink');
  });

  it('labels both spaces', () => {
    expect(COORDINATE_LABELS.image2d).toMatch(/SCOORD/);
    expect(COORDINATE_LABELS.patient3d).toMatch(/SCOORD3D/);
  });

  // A patient coordinate with no frame of reference is a triple of numbers.
  it('REFUSES a patient coordinate with no frame of reference', () => {
    const broken = evidence({
      annotation: { space: 'patient3d', graphicType: 'POINT', data: [1, 2, 3] },
    });
    const issue = validateEvidence(broken, CONTEXT).find(i => i.code === 'missingFrameOfReference')!;
    expect(issue.severity).toBe('error');
    expect(issue.message).toMatch(/não localiza nada/);
  });
});

describe('imageEvidence — frames are 1-based', () => {
  it('accepts frame 1', () => {
    expect(
      validateEvidence(
        evidence({ reference: { ...evidence().reference, frameNumber: 1 } }),
        CONTEXT
      )
    ).toEqual([]);
  });

  // The off-by-one puts the arrow on the wrong slice, and on 200 frames nobody notices
  // which direction.
  it('REFUSES frame 0, saying why', () => {
    const issue = validateEvidence(
      evidence({ reference: { ...evidence().reference, frameNumber: 0 } }),
      CONTEXT
    )[0];
    expect(issue.code).toBe('frameNotPositive');
    expect(issue.message).toMatch(/começam em 1, não em 0/);
  });

  it('refuses a non-integer frame', () => {
    expect(
      validateEvidence(
        evidence({ reference: { ...evidence().reference, frameNumber: 2.5 } }),
        CONTEXT
      )[0].code
    ).toBe('frameNotPositive');
  });

  it('refuses a frame past the end when the count is known', () => {
    const issues = validateEvidence(
      evidence({ reference: { ...evidence().reference, frameNumber: 300 } }),
      { ...CONTEXT, frameCounts: { '1.2.3.1.1': 200 } }
    );
    expect(issues[0].message).toMatch(/além dos 200 frames/);
  });

  it('warns about a frame number on a single-frame object', () => {
    const issues = validateEvidence(
      evidence({ reference: { ...evidence().reference, frameNumber: 3 } }),
      { ...CONTEXT, multiFrameSopInstanceUids: ['9.9.9'] }
    );
    expect(issues[0].code).toBe('frameOnSingleFrame');
    expect(issues[0].severity).toBe('warning');
  });
});

describe('imageEvidence — the reference has to belong to the study', () => {
  // Either a mis-click or a cross-contamination between two patients' reports.
  it('REFUSES evidence from another study', () => {
    const issue = validateEvidence(
      evidence({ reference: { ...evidence().reference, studyInstanceUid: '9.9.9' } }),
      CONTEXT
    )[0];
    expect(issue.code).toBe('wrongStudy');
    expect(issue.severity).toBe('error');
  });

  it('refuses a reference missing any of the three UIDs', () => {
    expect(
      validateEvidence(
        evidence({ reference: { studyInstanceUid: STUDY, seriesInstanceUid: '', sopInstanceUid: 'x' } }),
        CONTEXT
      )[0].code
    ).toBe('missingUid');
  });
});

describe('imageEvidence — coordinate arithmetic', () => {
  it('accepts a well-formed polyline', () => {
    const polyline = evidence({
      annotation: { space: 'image2d', graphicType: 'POLYLINE', data: [0, 0, 10, 0, 10, 10] },
    });
    expect(validateEvidence(polyline, CONTEXT)).toEqual([]);
  });

  it('refuses a coordinate list that does not divide into points', () => {
    const broken = evidence({
      annotation: { space: 'patient3d', graphicType: 'POINT', data: [1, 2], frameOfReferenceUid: 'F' },
    });
    const issue = validateEvidence(broken, CONTEXT)[0];
    expect(issue.code).toBe('wrongCoordinateCount');
    expect(issue.message).toMatch(/3 componentes/);
  });

  it('refuses a graphic type with too few points', () => {
    const broken = evidence({
      annotation: { space: 'image2d', graphicType: 'ELLIPSE', data: [1, 2, 3, 4] },
    });
    expect(validateEvidence(broken, CONTEXT)[0].message).toMatch(/ELLIPSE precisa de ao menos 4/);
  });

  it('refuses an empty annotation', () => {
    const broken = evidence({ annotation: { space: 'image2d', graphicType: 'POINT', data: [] } });
    expect(validateEvidence(broken, CONTEXT)[0].code).toBe('emptyAnnotation');
  });
});

describe('imageEvidence — DICOM SR content', () => {
  // A finding exported as SR is readable by any PACS; a bespoke JSON blob is readable by
  // this viewer.
  it('renders a bare reference as an IMAGE item', () => {
    const item = toSrContent(evidence())!;
    expect(item.ValueType).toBe('IMAGE');
    expect(item.ReferencedSOPSequence![0].ReferencedSOPInstanceUID).toBe('1.2.3.1.1');
  });

  // The coordinates only mean anything relative to that instance.
  it('NESTS the image under a 2D annotation', () => {
    const item = toSrContent(withPoint('image2d'))!;
    expect(item.ValueType).toBe('SCOORD');
    expect(item.GraphicData).toEqual([120, 200]);
    expect(item.ContentSequence![0].ValueType).toBe('IMAGE');
  });

  it('carries the frame of reference on a 3D annotation', () => {
    const item = toSrContent(withPoint('patient3d'))!;
    expect(item.ValueType).toBe('SCOORD3D');
    expect(item.ReferencedFrameOfReferenceUID).toBe('FOR-1');
  });

  it('carries the frame number through', () => {
    const item = toSrContent(
      evidence({ reference: { ...evidence().reference, frameNumber: 7 } })
    )!;
    expect(item.ReferencedSOPSequence![0].ReferencedFrameNumber).toBe(7);
  });

  it('returns null for a reference with no SOP instance', () => {
    expect(toSrContent(evidence({ reference: { studyInstanceUid: STUDY, seriesInstanceUid: 'a', sopInstanceUid: '' } }))).toBeNull();
  });
});

describe('imageEvidence — the whole set', () => {
  it('counts by space and lists the fragile links', () => {
    const summary = summariseEvidence(
      [withPoint('image2d'), withPoint('patient3d'), evidence({ id: 'e3' })],
      CONTEXT
    );
    expect(summary.total).toBe(3);
    expect(summary.bySpace).toEqual({ image2d: 1, patient3d: 1, none: 1 });
    expect(summary.fragile).toEqual(['e1']);
    expect(summary.ok).toBe(true);
  });

  it('is not ok when any evidence has an error', () => {
    const summary = summariseEvidence(
      [evidence({ reference: { ...evidence().reference, studyInstanceUid: '9.9' } })],
      CONTEXT
    );
    expect(summary.ok).toBe(false);
    expect(summary.issues[0].code).toBe('wrongStudy');
  });

  it('handles an empty set', () => {
    expect(summariseEvidence([], CONTEXT)).toMatchObject({ total: 0, ok: true });
  });

  it('renders a chip with the durability note', () => {
    expect(describeEvidence(withPoint('image2d'))).toMatch(/presa a este SOP Instance/);
    expect(describeEvidence(evidence({ label: 'Nódulo LSD' }))).toMatch(/^Nódulo LSD ·/);
    expect(describeEvidence({ id: 'x' } as Evidence)).toBe('');
  });
});
