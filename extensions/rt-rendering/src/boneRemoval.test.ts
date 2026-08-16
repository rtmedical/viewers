import {
  BONE_THRESHOLD_HU,
  CONFIDENT_BONE_HU,
  dilate,
  ENHANCED_ARTERY_HU,
  findAtRiskVoxels,
  growBoneMask,
  recommendApproach,
  removeBone,
  BoneVolume,
} from './boneRemoval';

const N = 16;
const index = (x: number, y: number, z: number) => z * N * N + y * N + x;

/** Empty soft-tissue volume. */
const blank = (): BoneVolume => ({
  data: new Float32Array(N * N * N).fill(40),
  width: N,
  height: N,
  depth: N,
});

const set = (volume: BoneVolume, x: number, y: number, z: number, hu: number) => {
  (volume.data as Float32Array)[index(x, y, z)] = hu;
};

/** A bone slab along x at y=2, and a bright vessel along z at (10,10). */
const scene = ({ touching = false, vesselHu = 400 } = {}): BoneVolume => {
  const volume = blank();
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      set(volume, x, 2, z, 800);
    }
  }
  const vesselX = touching ? 5 : 10;
  const vesselY = touching ? 3 : 10;
  for (let z = 0; z < N; z++) {
    set(volume, vesselX, vesselY, z, vesselHu);
  }
  return volume;
};

const BONE_SEED = [{ x: 5, y: 2, z: 5 }];

describe('boneRemoval — connectivity is what makes thresholding tolerable', () => {
  it('grows the bone slab from a seed on it', () => {
    const result = growBoneMask(scene(), BONE_SEED);
    expect(result.ok).toBe(true);
    expect(result.voxels).toBe(N * N);
    expect(result.mask[index(0, 2, 0)]).toBe(1);
  });

  // A bright voxel inside a vessel lumen is not connected to the skeleton.
  it('LEAVES a disconnected bright vessel alone, even above the threshold', () => {
    const volume = scene();
    const result = growBoneMask(volume, BONE_SEED);
    expect(Number(volume.data[index(10, 10, 5)])).toBeGreaterThan(BONE_THRESHOLD_HU);
    expect(result.mask[index(10, 10, 5)]).toBe(0);
  });

  it('and a global threshold WOULD have removed it', () => {
    const volume = scene();
    let removedByThreshold = 0;
    for (let i = 0; i < volume.data.length; i++) {
      if (Number(volume.data[i]) >= BONE_THRESHOLD_HU) {
        removedByThreshold += 1;
      }
    }
    expect(removedByThreshold).toBeGreaterThan(growBoneMask(volume, BONE_SEED).voxels);
  });

  it('6-connectivity does not leak diagonally', () => {
    const volume = blank();
    set(volume, 5, 5, 5, 800);
    set(volume, 6, 6, 5, 800);
    expect(growBoneMask(volume, [{ x: 5, y: 5, z: 5 }], 300, 6).voxels).toBe(1);
    expect(growBoneMask(volume, [{ x: 5, y: 5, z: 5 }], 300, 26).voxels).toBe(2);
  });

  // Growing from a seed in soft tissue would flood the soft tissue.
  it('rejects a seed below the threshold instead of growing from it', () => {
    const result = growBoneMask(scene(), [{ x: 8, y: 8, z: 8 }]);
    expect(result.ok).toBe(false);
    expect(result.rejectedSeeds).toBe(1);
    expect(result.reason).toMatch(/Nenhuma semente válida/);
  });

  it('rejects a seed outside the volume', () => {
    expect(growBoneMask(scene(), [{ x: 99, y: 0, z: 0 }]).rejectedSeeds).toBe(1);
  });

  it('refuses an invalid volume', () => {
    expect(growBoneMask({ data: [], width: 0, height: 0, depth: 0 }, BONE_SEED).ok).toBe(false);
  });
});

describe('boneRemoval — the vessel that touches bone gets EATEN', () => {
  // The trap: when they touch, the grower flows down the vessel and absorbs it. So
  // "mask next to bright non-mask tissue" finds nothing in precisely the case that
  // matters, because the vessel is already inside the mask by then.
  it('the grower swallows a vessel that abuts the bone', () => {
    const volume = scene({ touching: true });
    const plain = growBoneMask(scene(), BONE_SEED).voxels;
    const touching = growBoneMask(volume, BONE_SEED).voxels;
    expect(touching).toBeGreaterThan(plain);
    expect(growBoneMask(volume, BONE_SEED).mask[index(5, 3, 7)]).toBe(1);
  });

  // Which is why the risk is found by ATTENUATION, not by geometry.
  it('flags the swallowed vessel by its attenuation', () => {
    const volume = scene({ touching: true });
    const { mask } = growBoneMask(volume, BONE_SEED);
    const risks = findAtRiskVoxels(volume, mask);
    expect(risks.some(r => r.kind === 'ambiguousAttenuation')).toBe(true);
    expect(risks.filter(r => r.kind === 'ambiguousAttenuation')).toHaveLength(N);
  });

  it('says nothing about unambiguous cortical bone', () => {
    const volume = scene();
    const { mask } = growBoneMask(volume, BONE_SEED);
    expect(findAtRiskVoxels(volume, mask)).toHaveLength(0);
  });

  it('still reports a vessel running alongside without merging', () => {
    const volume = blank();
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        set(volume, x, 2, z, 800);
      }
      // One voxel gap, so it is not absorbed but is adjacent after nothing grows into it.
      set(volume, 5, 4, z, 400);
    }
    const { mask } = growBoneMask(volume, BONE_SEED);
    expect(mask[index(5, 4, 7)]).toBe(0);
    const risks = findAtRiskVoxels(volume, mask);
    expect(risks.every(r => r.kind === 'abutting')).toBe(true);
  });

  it('ignores tissue below the bright threshold', () => {
    const volume = scene({ touching: true, vesselHu: 100 });
    const { mask } = growBoneMask(volume, BONE_SEED);
    expect(findAtRiskVoxels(volume, mask)).toHaveLength(0);
  });

  it('the ambiguous band sits between the two thresholds', () => {
    expect(ENHANCED_ARTERY_HU).toBeGreaterThanOrEqual(BONE_THRESHOLD_HU);
    expect(CONFIDENT_BONE_HU).toBeGreaterThan(ENHANCED_ARTERY_HU);
  });
});

describe('boneRemoval — the removal', () => {
  it('replaces bone with air and leaves everything else', () => {
    const volume = scene();
    const result = removeBone(volume, { seeds: BONE_SEED });
    expect(result.ok).toBe(true);
    expect(result.data[index(0, 2, 0)]).toBe(-1000);
    expect(result.data[index(10, 10, 5)]).toBe(400);
    expect(result.data[index(8, 8, 8)]).toBe(40);
    expect(result.removedVoxels).toBe(N * N);
  });

  it('honours a custom fill value', () => {
    const result = removeBone(scene(), { seeds: BONE_SEED, fillHu: 0 });
    expect(result.data[index(0, 2, 0)]).toBe(0);
  });

  it('dilation catches the partial-volume rim, at the cost of more removal', () => {
    const plain = removeBone(scene(), { seeds: BONE_SEED });
    const dilated = removeBone(scene(), { seeds: BONE_SEED, dilationVoxels: 1 });
    expect(dilated.removedVoxels).toBeGreaterThan(plain.removedVoxels);
  });

  // The result looks clean either way, which is why the warning is not optional.
  it('ALWAYS reports the at-risk voxels as a warning', () => {
    const result = removeBone(scene({ touching: true }), { seeds: BONE_SEED });
    expect(result.atRisk.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/Não interprete oclusão a partir dessas regiões/);
  });

  it('is quiet when nothing touched', () => {
    expect(removeBone(scene(), { seeds: BONE_SEED }).warnings).toEqual([]);
  });

  it('warns about ignored seeds', () => {
    const result = removeBone(scene(), { seeds: [...BONE_SEED, { x: 8, y: 8, z: 8 }] });
    expect(result.warnings.join(' ')).toMatch(/semente\(s\) fora do volume ou abaixo do limiar/);
  });

  it('fails cleanly with no usable seed', () => {
    const result = removeBone(scene(), { seeds: [] });
    expect(result.ok).toBe(false);
    expect(result.removedVoxels).toBe(0);
  });

  it('dilate grows a single voxel into its 6 neighbours', () => {
    const volume = blank();
    set(volume, 5, 5, 5, 800);
    const { mask } = growBoneMask(volume, [{ x: 5, y: 5, z: 5 }]);
    const grown = dilate(volume, mask, 6);
    expect(grown.reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe('boneRemoval — choosing the method', () => {
  // A single-energy heuristic used on dual-energy data is a worse answer that looks the
  // same.
  it('prefers dual energy whenever it exists', () => {
    const result = recommendApproach({ hasDualEnergy: true, hasMaskRun: true });
    expect(result.approach).toBe('dualEnergy');
    expect(result.message).toMatch(/ponto cego da base do crânio/);
  });

  it('prefers subtraction over thresholding when there is a mask run', () => {
    const result = recommendApproach({ hasMaskRun: true });
    expect(result.approach).toBe('subtraction');
    expect(result.message).toMatch(/sensível a movimento/);
  });

  it('falls back to threshold plus connectivity, saying where it fails', () => {
    const result = recommendApproach({});
    expect(result.approach).toBe('thresholdConnectivity');
    expect(result.message).toMatch(/falha onde vaso e osso se tocam/);
  });
});
