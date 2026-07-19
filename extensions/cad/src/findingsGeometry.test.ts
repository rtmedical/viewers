import {
  abbreviateFindingType,
  boundsOf,
  buildAffine2D,
  chunkPairs,
  circleFromCenterPerimeter,
  clampToBox,
  ellipseFromAxisEndpoints,
  estimateLabelBox,
  findingLabel,
  findingMatchesImage,
  frameNumberFromImageId,
  sameFinding,
  targetImageIndexInDisplaySet,
  Point2,
} from './findingsGeometry';

describe('buildAffine2D', () => {
  it('reproduces a scale + translation from its three probes', () => {
    // source (0,0)→(10,20); x step ×2; y step ×3 (independent axes).
    const affine = buildAffine2D([10, 20], [12, 20], [10, 23]);
    expect(affine.apply([0, 0])).toEqual([10, 20]);
    expect(affine.apply([5, 4])).toEqual([20, 32]);
  });

  it('handles rotation/flip probes (pure linear combination)', () => {
    // 90° rotation: x→(0,1), y→(-1,0).
    const affine = buildAffine2D([0, 0], [0, 1], [-1, 0]);
    expect(affine.apply([2, 3])).toEqual([-3, 2]);
  });
});

describe('chunkPairs', () => {
  it('chunks a flat list into [column, row] pairs', () => {
    expect(chunkPairs([1, 2, 3, 4])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('drops a trailing unpaired value and tolerates empty/absent input', () => {
    expect(chunkPairs([1, 2, 3])).toEqual([[1, 2]]);
    expect(chunkPairs([])).toEqual([]);
    expect(chunkPairs(undefined)).toEqual([]);
  });
});

describe('circleFromCenterPerimeter', () => {
  it('builds a circle from [center, point-on-perimeter]', () => {
    expect(
      circleFromCenterPerimeter([
        [100, 120],
        [110, 120],
      ])
    ).toEqual({ cx: 100, cy: 120, r: 10 });
  });

  it('is undefined without both points', () => {
    expect(circleFromCenterPerimeter([[1, 2]])).toBeUndefined();
    expect(circleFromCenterPerimeter([])).toBeUndefined();
  });
});

describe('ellipseFromAxisEndpoints', () => {
  it('builds an axis-aligned ellipse (major horizontal)', () => {
    const e = ellipseFromAxisEndpoints([
      [90, 50],
      [110, 50],
      [100, 45],
      [100, 55],
    ]);
    expect(e).toBeDefined();
    expect(e!.cx).toBe(100);
    expect(e!.cy).toBe(50);
    expect(e!.rx).toBe(10);
    expect(e!.ry).toBe(5);
    expect(e!.rotationDeg).toBeCloseTo(0);
  });

  it('derives the rotation from the major axis angle', () => {
    // Major axis along the y-down 45° diagonal.
    const e = ellipseFromAxisEndpoints([
      [0, 0],
      [10, 10],
      [7.5, 2.5],
      [2.5, 7.5],
    ]);
    expect(e!.cx).toBe(5);
    expect(e!.cy).toBe(5);
    expect(e!.rx).toBeCloseTo(Math.hypot(10, 10) / 2);
    expect(e!.ry).toBeCloseTo(Math.hypot(5, -5) / 2);
    expect(e!.rotationDeg).toBeCloseTo(45);
  });

  it('is undefined with fewer than 4 points', () => {
    expect(
      ellipseFromAxisEndpoints([
        [0, 0],
        [1, 1],
        [2, 2],
      ])
    ).toBeUndefined();
  });
});

describe('boundsOf', () => {
  it('returns the axis-aligned bounding box', () => {
    expect(
      boundsOf([
        [3, 9],
        [-1, 4],
        [5, 5],
      ])
    ).toEqual({ minX: -1, minY: 4, maxX: 5, maxY: 9 });
  });

  it('is undefined for an empty list', () => {
    expect(boundsOf([])).toBeUndefined();
  });
});

describe('clampToBox', () => {
  const box = (x: number, y: number): Point2 => clampToBox(x, y, 50, 20, 200, 100, 2);

  it('keeps a rect already inside the box', () => {
    expect(box(60, 40)).toEqual([60, 40]);
  });

  it('clamps each overflowing edge', () => {
    expect(box(-10, 40)).toEqual([2, 40]); // left
    expect(box(190, 40)).toEqual([148, 40]); // right: 200 - 50 - 2
    expect(box(60, -5)).toEqual([60, 2]); // top
    expect(box(60, 95)).toEqual([60, 78]); // bottom: 100 - 20 - 2
  });

  it('degrades gracefully when the rect is larger than the box', () => {
    expect(clampToBox(10, 10, 300, 200, 200, 100, 2)).toEqual([2, 2]);
  });
});

describe('estimateLabelBox', () => {
  it('grows with text length and includes padding', () => {
    const short = estimateLabelBox('CC 82%');
    const long = estimateLabelBox('CC 82% and then some');
    expect(long.w).toBeGreaterThan(short.w);
    expect(short.h).toBe(17); // 11px font + 6
    expect(short.w).toBeGreaterThan(short.h);
  });
});

describe('abbreviateFindingType / findingLabel', () => {
  it('turns multi-word types into initials', () => {
    expect(abbreviateFindingType('Calcification cluster')).toBe('CC');
    expect(abbreviateFindingType('Architectural Distortion')).toBe('AD');
  });

  it('keeps short single words and truncates long ones', () => {
    expect(abbreviateFindingType('Mass')).toBe('Mass');
    expect(abbreviateFindingType('Nodule')).toBe('Nodule');
    expect(abbreviateFindingType('Calcification')).toBe('Calcif.');
  });

  it('falls back to CAD when there is no type', () => {
    expect(abbreviateFindingType(undefined)).toBe('CAD');
    expect(abbreviateFindingType('  ')).toBe('CAD');
  });

  it('appends the probability as a percentage (fraction or percent input)', () => {
    expect(findingLabel({ type: 'Calcification cluster', probability: 0.82 })).toBe('CC 82%');
    expect(findingLabel({ type: 'Nodule', probability: 44 })).toBe('Nodule 44%');
    expect(findingLabel({ type: 'Mass' })).toBe('Mass');
    expect(findingLabel({ codeValue: 'F-01' })).toBe('F-01');
  });
});

describe('frameNumberFromImageId', () => {
  it('reads the 1-based wadors frames path segment', () => {
    expect(
      frameNumberFromImageId('wadors:https://pacs/studies/1/series/2/instances/3/frames/22')
    ).toBe(22);
  });

  it('reads the regular 1-based wadouri frame query parameter', () => {
    expect(frameNumberFromImageId('dicomweb:https://pacs/wado?objectUID=3&frame=7')).toBe(7);
  });

  it('normalizes DicomJSON stacks whose frame query starts at zero', () => {
    const imageIds = [
      'https://example.test/image?frame=0',
      'https://example.test/image?frame=1',
      'https://example.test/image?frame=2',
    ];
    expect(frameNumberFromImageId(imageIds[0], imageIds)).toBe(1);
    expect(frameNumberFromImageId(imageIds[1], imageIds)).toBe(2);
    expect(frameNumberFromImageId(imageIds[2], imageIds)).toBe(3);
  });

  it('is undefined for single-frame ids', () => {
    expect(frameNumberFromImageId('wadors:https://pacs/studies/1/instances/3')).toBeUndefined();
    expect(frameNumberFromImageId(undefined)).toBeUndefined();
  });
});

describe('findingMatchesImage', () => {
  it('matches on SOP with frames defaulting to 1 on both sides', () => {
    expect(findingMatchesImage({ referencedSopInstanceUID: '1.2' }, '1.2', undefined)).toBe(true);
    expect(findingMatchesImage({ referencedSopInstanceUID: '1.2' }, '1.2', 1)).toBe(true);
  });

  it('requires the frame to match when either side has one', () => {
    const f = { referencedSopInstanceUID: '1.2', referencedFrameNumber: 7 };
    expect(findingMatchesImage(f, '1.2', 7)).toBe(true);
    expect(findingMatchesImage(f, '1.2', 1)).toBe(false);
    expect(findingMatchesImage(f, '1.2', undefined)).toBe(false);
    expect(findingMatchesImage({ referencedSopInstanceUID: '1.2' }, '1.2', 7)).toBe(false);
  });

  it('rejects SOP mismatches and missing references', () => {
    expect(findingMatchesImage({ referencedSopInstanceUID: '1.2' }, '9.9')).toBe(false);
    expect(findingMatchesImage({}, '1.2')).toBe(false);
    expect(findingMatchesImage({ referencedSopInstanceUID: '1.2' }, undefined)).toBe(false);
  });
});

describe('sameFinding', () => {
  const finding = () => ({
    type: 'Mass',
    graphicType: 'POINT',
    points: [200, 210],
    referencedSopInstanceUID: '1.2.img',
  });

  it('matches by reference and by structural spatial identity', () => {
    const a = finding();
    expect(sameFinding(a, a)).toBe(true);
    expect(sameFinding(finding(), finding())).toBe(true);
  });

  it('rejects differing geometry, image or frame', () => {
    expect(sameFinding(finding(), { ...finding(), points: [200, 211] })).toBe(false);
    expect(sameFinding(finding(), { ...finding(), graphicType: 'CIRCLE' })).toBe(false);
    expect(sameFinding(finding(), { ...finding(), referencedSopInstanceUID: '9.9' })).toBe(false);
    expect(sameFinding(finding(), { ...finding(), referencedFrameNumber: 2 })).toBe(false);
    expect(sameFinding(finding(), null)).toBe(false);
    expect(sameFinding(null, null)).toBe(false);
  });

  it('uses report identity to distinguish coincident findings', () => {
    const identified = (reportSopInstanceUID: string, findingIndex: number) => ({
      ...finding(),
      reportSopInstanceUID,
      findingIndex,
    });
    expect(sameFinding(identified('report-a', 0), identified('report-a', 0))).toBe(true);
    expect(sameFinding(identified('report-a', 0), identified('report-a', 1))).toBe(false);
    expect(sameFinding(identified('report-a', 0), identified('report-b', 0))).toBe(false);
    expect(sameFinding(identified('report-a', 0), finding())).toBe(false);
  });
});

describe('targetImageIndexInDisplaySet', () => {
  it('finds the index in a single-frame series', () => {
    const ds = {
      images: [{ SOPInstanceUID: 'a' }, { SOPInstanceUID: 'b' }, { SOPInstanceUID: 'c' }],
    };
    expect(targetImageIndexInDisplaySet(ds, 'b')).toBe(1);
    expect(targetImageIndexInDisplaySet(ds, 'c', 1)).toBe(2);
  });

  it('adds the frame offset inside a multiframe instance', () => {
    const ds = { images: [{ SOPInstanceUID: 'mf', NumberOfFrames: 30 }] };
    expect(targetImageIndexInDisplaySet(ds, 'mf', 7)).toBe(6);
    expect(targetImageIndexInDisplaySet(ds, 'mf')).toBe(0);
  });

  it('accounts for preceding multiframe instances and clamps the frame', () => {
    const ds = {
      images: [
        { SOPInstanceUID: 'a' },
        { SOPInstanceUID: 'mf', NumberOfFrames: 10 },
        { SOPInstanceUID: 'c' },
      ],
    };
    expect(targetImageIndexInDisplaySet(ds, 'c')).toBe(11);
    expect(targetImageIndexInDisplaySet(ds, 'mf', 99)).toBe(10); // clamped to frame 10
  });

  it('falls back to instances[] and is undefined when the SOP is absent', () => {
    expect(targetImageIndexInDisplaySet({ instances: [{ SOPInstanceUID: 'x' }] }, 'x')).toBe(0);
    expect(targetImageIndexInDisplaySet({ images: [] }, 'x')).toBeUndefined();
    expect(targetImageIndexInDisplaySet(undefined, 'x')).toBeUndefined();
  });
});
