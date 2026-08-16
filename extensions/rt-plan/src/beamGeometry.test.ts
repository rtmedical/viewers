import {
  Beam,
  beamAxes,
  centralAxisOnAxialSlice,
  centralAxisSegment,
  describeBeam,
  dot,
  fieldCornersAtDepth,
  iecToPatient,
  norm,
  PATIENT_ORIENTATIONS,
  PatientOrientation,
  Vec3,
} from './beamGeometry';

const beam = (over: Partial<Beam> = {}): Beam => ({
  name: 'F1',
  gantryAngleDeg: 0,
  collimatorAngleDeg: 0,
  couchAngleDeg: 0,
  sadMm: 1000,
  isocentreMm: [0, 0, 0],
  jawsMm: [-50, 50, -40, 40],
  ...over,
});

const close = (a: Vec3, b: Vec3, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
  expect(a[2]).toBeCloseTo(b[2], digits);
};

describe('beamGeometry — patient orientation is not cosmetic', () => {
  // DICOM patient axes: +x patient left, +y posterior, +z superior.
  it('puts a gantry-0 source anterior for a supine patient', () => {
    close(beamAxes(beam(), 'HFS').towardsSource, [0, -1, 0]);
    close(beamAxes(beam(), 'FFS').towardsSource, [0, -1, 0]);
  });

  // Prone: the patient's back is up, so the source above is posterior to them.
  it('puts a gantry-0 source posterior for a prone patient', () => {
    close(beamAxes(beam(), 'HFP').towardsSource, [0, 1, 0]);
    close(beamAxes(beam(), 'FFP').towardsSource, [0, 1, 0]);
  });

  // Left-for-right is the class of error that reaches the patient.
  it('swaps left and right between head-first and feet-first', () => {
    const hfs = beamAxes(beam({ gantryAngleDeg: 90 }), 'HFS').towardsSource;
    const ffs = beamAxes(beam({ gantryAngleDeg: 90 }), 'FFS').towardsSource;
    close(hfs, [1, 0, 0]);
    close(ffs, [-1, 0, 0]);
  });

  it('maps the room axis along the couch to superior or inferior with the orientation', () => {
    close(iecToPatient([0, 1, 0], 'HFS'), [0, 0, 1]);
    close(iecToPatient([0, 1, 0], 'FFS'), [0, 0, -1]);
    expect(PATIENT_ORIENTATIONS).toEqual(['HFS', 'FFS', 'HFP', 'FFP']);
  });

  it('keeps every axis a unit vector', () => {
    const axes = beamAxes(beam({ gantryAngleDeg: 37, collimatorAngleDeg: 22, couchAngleDeg: 15 }), 'HFS');
    expect(norm(axes.towardsSource)).toBeCloseTo(1, 10);
    expect(norm(axes.u)).toBeCloseTo(1, 10);
    expect(norm(axes.v)).toBeCloseTo(1, 10);
  });

  it('keeps the in-plane axes perpendicular to the beam and to each other', () => {
    const axes = beamAxes(beam({ gantryAngleDeg: 37, collimatorAngleDeg: 22, couchAngleDeg: 15 }), 'HFS');
    expect(dot(axes.u, axes.direction)).toBeCloseTo(0, 10);
    expect(dot(axes.v, axes.direction)).toBeCloseTo(0, 10);
    expect(dot(axes.u, axes.v)).toBeCloseTo(0, 10);
  });
});

describe('beamGeometry — the couch is the rarely-exercised path', () => {
  // A rotation about the vertical axis cannot change a vertical beam.
  it('leaves a gantry-0 beam untouched at any couch angle', () => {
    for (const couch of [0, 30, 90, 270]) {
      close(beamAxes(beam({ couchAngleDeg: couch }), 'HFS').towardsSource, [0, -1, 0]);
    }
  });

  // A lateral beam with the couch turned a quarter turn becomes an AP/PA beam.
  it('turns a lateral beam into an anterior-posterior one at couch 90', () => {
    const axes = beamAxes(beam({ gantryAngleDeg: 90, couchAngleDeg: 90 }), 'HFS');
    expect(Math.abs(axes.towardsSource[2])).toBeCloseTo(1, 10);
    expect(Math.abs(axes.towardsSource[0])).toBeCloseTo(0, 10);
  });

  it('pins the couch sign: positive couch moves a gantry-90 source towards the head', () => {
    close(beamAxes(beam({ gantryAngleDeg: 90, couchAngleDeg: 90 }), 'HFS').towardsSource, [0, 0, -1]);
  });

  it('returns to the original beam after a full turn', () => {
    close(
      beamAxes(beam({ gantryAngleDeg: 45, couchAngleDeg: 360 }), 'HFS').towardsSource,
      beamAxes(beam({ gantryAngleDeg: 45 }), 'HFS').towardsSource
    );
  });
});

describe('beamGeometry — the source and the direction', () => {
  it('places the source one SAD from the isocentre', () => {
    const axes = beamAxes(beam({ isocentreMm: [10, 20, 30] }), 'HFS');
    close(axes.sourceMm, [10, -980, 30]);
  });

  it('has the beam travelling opposite the source direction', () => {
    const axes = beamAxes(beam({ gantryAngleDeg: 42 }), 'HFS');
    close(axes.direction, [-axes.towardsSource[0], -axes.towardsSource[1], -axes.towardsSource[2]]);
  });

  it('has a gantry-0 beam travelling anterior to posterior', () => {
    close(beamAxes(beam(), 'HFS').direction, [0, 1, 0]);
  });
});

describe('beamGeometry — the collimator rotates the field, not the axis', () => {
  it('leaves the central axis alone', () => {
    close(
      beamAxes(beam({ collimatorAngleDeg: 45 }), 'HFS').towardsSource,
      beamAxes(beam(), 'HFS').towardsSource
    );
  });

  it('rotates the in-plane axes', () => {
    const straight = beamAxes(beam(), 'HFS');
    const rotated = beamAxes(beam({ collimatorAngleDeg: 90 }), 'HFS');
    expect(dot(straight.u, rotated.u)).toBeCloseTo(0, 10);
  });

  it('turns a wide field into a tall one at collimator 90', () => {
    const straight = fieldCornersAtDepth(beam(), 'HFS', 1000);
    const rotated = fieldCornersAtDepth(beam({ collimatorAngleDeg: 90 }), 'HFS', 1000);
    const width = (f: typeof straight) => norm([
      f.cornersMm[1][0] - f.cornersMm[0][0],
      f.cornersMm[1][1] - f.cornersMm[0][1],
      f.cornersMm[1][2] - f.cornersMm[0][2],
    ]);
    expect(width(straight)).toBeCloseTo(100, 6);
    expect(width(rotated)).toBeCloseTo(100, 6);
    // The 100 mm edge lay along the patient's left-right axis and now lies along superior-inferior.
    expect(Math.abs(straight.cornersMm[1][0] - straight.cornersMm[0][0])).toBeCloseTo(100, 6);
    expect(Math.abs(rotated.cornersMm[1][2] - rotated.cornersMm[0][2])).toBeCloseTo(100, 6);
  });
});

describe('beamGeometry — field edges diverge', () => {
  it('gives the jaw size exactly at the isocentre plane', () => {
    const field = fieldCornersAtDepth(beam(), 'HFS', 1000);
    expect(field.divergenceFactor).toBeCloseTo(1, 10);
    close(field.cornersMm[0], [-50, 0, -40]);
  });

  // Reads as a slightly generous field rather than as a bug.
  it('scales by the distance ratio away from the isocentre', () => {
    const beyond = fieldCornersAtDepth(beam(), 'HFS', 1100);
    expect(beyond.divergenceFactor).toBeCloseTo(1.1, 10);
    expect(Math.abs(beyond.cornersMm[0][0])).toBeCloseTo(55, 6);
  });

  it('shrinks the field closer to the source', () => {
    expect(fieldCornersAtDepth(beam(), 'HFS', 900).divergenceFactor).toBeCloseTo(0.9, 10);
  });

  it('refuses without jaws, without an SAD or with a nonsense distance', () => {
    expect(fieldCornersAtDepth(beam({ jawsMm: undefined }), 'HFS', 1000).ok).toBe(false);
    expect(fieldCornersAtDepth(beam({ sadMm: 0 }), 'HFS', 1000).reason).toMatch(/divergência/);
    expect(fieldCornersAtDepth(beam(), 'HFS', -5).ok).toBe(false);
  });

  it('keeps the four corners in a plane perpendicular to the beam', () => {
    const field = fieldCornersAtDepth(beam({ gantryAngleDeg: 33, collimatorAngleDeg: 15 }), 'HFS', 1050);
    const axes = beamAxes(beam({ gantryAngleDeg: 33, collimatorAngleDeg: 15 }), 'HFS');
    const depths = field.cornersMm.map(c =>
      dot([c[0] - axes.sourceMm[0], c[1] - axes.sourceMm[1], c[2] - axes.sourceMm[2]], axes.direction)
    );
    for (const d of depths) {
      expect(d).toBeCloseTo(1050, 6);
    }
  });
});

describe('beamGeometry — where the axis crosses a slice', () => {
  it('crosses the isocentre slice for an oblique beam', () => {
    const result = centralAxisOnAxialSlice(
      beam({ gantryAngleDeg: 90, couchAngleDeg: 90, isocentreMm: [0, 0, 50] }),
      'HFS',
      50
    );
    expect(result.parallel).toBe(false);
    expect(result.pointMm![2]).toBeCloseTo(50, 6);
  });

  // Returning the isocentre here would draw a point that means nothing.
  it('says a lateral beam runs parallel to the axial plane', () => {
    const result = centralAxisOnAxialSlice(beam({ gantryAngleDeg: 90 }), 'HFS', 0);
    expect(result.parallel).toBe(true);
    expect(result.pointMm).toBeNull();
    expect(result.message).toMatch(/desenharia um ponto que não significa nada/);
  });

  // Gantry 90 with the couch at 90 puts the source towards the feet, at z = -1000; a slice
  // at z = -2000 is beyond it, on the far side from the patient.
  it('says so when the slice is behind the source', () => {
    const result = centralAxisOnAxialSlice(
      beam({ gantryAngleDeg: 90, couchAngleDeg: 90 }),
      'HFS',
      -2000
    );
    expect(result.pointMm).toBeNull();
    expect(result.message).toMatch(/atrás da fonte/);
  });
});

describe('beamGeometry — the drawn segment and the legend', () => {
  // The source is a metre away and outside every image.
  it('centres the segment on the isocentre rather than starting at the source', () => {
    const segment = centralAxisSegment(beam({ isocentreMm: [0, 0, 0] }), 'HFS', 150);
    close(segment.fromMm, [0, -150, 0]);
    close(segment.toMm, [0, 150, 0]);
    expect(segment.lengthMm).toBe(300);
  });

  it('names the angles, the orientation and the direction', () => {
    expect(describeBeam(beam({ gantryAngleDeg: 90, couchAngleDeg: 15 }), 'HFS')).toMatch(
      /^F1: gantry 90°, colimador 0°, mesa 15° \(HFS\) — direção \[/
    );
  });

  it('omits the couch when it is zero', () => {
    expect(describeBeam(beam(), 'HFS')).not.toMatch(/mesa/);
  });

  it.each(PATIENT_ORIENTATIONS)('produces a unit direction for %s', (orientation: PatientOrientation) => {
    expect(norm(beamAxes(beam({ gantryAngleDeg: 120 }), orientation).direction)).toBeCloseTo(1, 10);
  });
});
