/**
 * Virtual bone removal for CT angiography — pure core (RTV-63).
 *
 * Taking the skeleton out of a CTA so the vessels can be seen. The naive version is one
 * line — threshold and delete — and it is wrong in a way that produces a confident,
 * clean-looking image of an artery that is not there.
 *
 * ## Contrast-enhanced arteries and cortical bone occupy the same Hounsfield range
 *
 * At peak arterial enhancement a carotid is 350–500 HU. Cortical bone is 400+ HU. There is
 * no threshold that separates them, and the one people pick removes the brightest parts of
 * the vessel along with the bone.
 *
 * The failure is not subtle in its consequences and is completely invisible in the result:
 * a segment of the internal carotid disappears at the skull base and the image shows an
 * occlusion. **The carotid siphon is simultaneously where thresholding fails worst and
 * where the finding matters most**, because the vessel runs through the bone there.
 *
 * ## Connectivity is what makes thresholding tolerable at all
 *
 * Bone is one large connected structure. A bright voxel inside a vessel lumen is not
 * connected to the skeleton, so growing the mask from bone seeds instead of thresholding
 * globally leaves the vessel alone — **except where they touch**, which is exactly the
 * skull base again.
 *
 * And when they touch, the region grower does not stop at the boundary: it flows straight
 * down the vessel and **absorbs it into the mask**. So looking for "mask next to bright
 * non-mask tissue" finds nothing in precisely the case that matters — the vessel is
 * already inside the mask by then. That is a real trap and the first version of this file
 * fell into it.
 *
 * What actually identifies the risk is the *attenuation* of the masked voxels.
 * Unambiguous cortical bone is above {@link CONFIDENT_BONE_HU}; anything the mask swallowed
 * between {@link BONE_THRESHOLD_HU} and there is in the band where enhanced artery and bone
 * are indistinguishable, and it might be vessel. {@link findAtRiskVoxels} reports both that
 * and the abutting case, because the second still happens where the vessel runs alongside
 * without merging.
 *
 * ## When dual energy is available, this whole approach is the wrong one
 *
 * Iodine and calcium have different dual-energy signatures, and the `rt-dect` modules
 * separate them properly — no threshold, no connectivity, no skull-base blind spot.
 * {@link recommendApproach} says so rather than letting a single-energy heuristic be used
 * on data that supports something better.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface BoneVolume {
  data: ArrayLike<number>;
  width: number;
  height: number;
  depth: number;
}

/** Cortical bone floor. Also, unavoidably, enhanced arterial blood. */
export const BONE_THRESHOLD_HU = 300;

/** Arteries at peak enhancement reach here, which is why the threshold cannot separate. */
export const ENHANCED_ARTERY_HU = 350;

/**
 * Above this, a voxel is cortical bone and nothing else.
 *
 * The band between {@link BONE_THRESHOLD_HU} and here is the ambiguous one — it is where
 * enhanced arterial blood and trabecular bone overlap, and where a removal may have taken
 * a vessel.
 */
export const CONFIDENT_BONE_HU = 600;

export type Connectivity = 6 | 26;

const NEIGHBOURS_6 = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function neighbourOffsets(connectivity: Connectivity): number[][] {
  if (connectivity === 6) {
    return NEIGHBOURS_6;
  }
  const out: number[][] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy || dz) {
          out.push([dx, dy, dz]);
        }
      }
    }
  }
  return out;
}

const indexOf = (v: BoneVolume, x: number, y: number, z: number) =>
  z * v.width * v.height + y * v.width + x;

const inside = (v: BoneVolume, x: number, y: number, z: number) =>
  x >= 0 && y >= 0 && z >= 0 && x < v.width && y < v.height && z < v.depth;

export interface Seed {
  x: number;
  y: number;
  z: number;
}

export interface GrowthResult {
  /** 1 where the voxel is bone, 0 elsewhere. */
  mask: Uint8Array;
  voxels: number;
  /** Seeds that were below threshold and grew nothing. */
  rejectedSeeds: number;
  ok: boolean;
  reason?: string;
}

/**
 * Grows a bone mask from seeds, staying above the threshold.
 *
 * Growing from seeds rather than thresholding globally is what leaves a bright vessel
 * lumen alone: it is not connected to the skeleton. The exception is where they touch,
 * which {@link findContactRegions} finds.
 */
export function growBoneMask(
  volume: BoneVolume,
  seeds: Seed[],
  thresholdHu = BONE_THRESHOLD_HU,
  connectivity: Connectivity = 26
): GrowthResult {
  const size = (volume?.width ?? 0) * (volume?.height ?? 0) * (volume?.depth ?? 0);
  const mask = new Uint8Array(Math.max(0, size));
  if (!size || !(volume?.data?.length >= size)) {
    return { mask, voxels: 0, rejectedSeeds: 0, ok: false, reason: 'BoneVolume inválido.' };
  }

  const threshold = Number(thresholdHu);
  if (!Number.isFinite(threshold)) {
    return { mask, voxels: 0, rejectedSeeds: 0, ok: false, reason: 'Limiar inválido.' };
  }

  const offsets = neighbourOffsets(connectivity);
  const stack: number[] = [];
  let rejectedSeeds = 0;

  for (const seed of seeds ?? []) {
    const x = Math.round(Number(seed?.x));
    const y = Math.round(Number(seed?.y));
    const z = Math.round(Number(seed?.z));
    if (!inside(volume, x, y, z)) {
      rejectedSeeds += 1;
      continue;
    }
    const index = indexOf(volume, x, y, z);
    if (Number(volume.data[index]) < threshold) {
      // A seed below threshold is a seed in the wrong place; growing from it anyway would
      // flood the soft tissue.
      rejectedSeeds += 1;
      continue;
    }
    if (!mask[index]) {
      mask[index] = 1;
      stack.push(x, y, z);
    }
  }

  if (!stack.length) {
    return {
      mask,
      voxels: 0,
      rejectedSeeds,
      ok: false,
      reason: 'Nenhuma semente válida acima do limiar.',
    };
  }

  let voxels = 0;
  while (stack.length) {
    const z = stack.pop() as number;
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    voxels += 1;
    for (const [dx, dy, dz] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!inside(volume, nx, ny, nz)) {
        continue;
      }
      const ni = indexOf(volume, nx, ny, nz);
      if (!mask[ni] && Number(volume.data[ni]) >= threshold) {
        mask[ni] = 1;
        stack.push(nx, ny, nz);
      }
    }
  }

  return { mask, voxels, rejectedSeeds, ok: true };
}

export type RiskKind = 'ambiguousAttenuation' | 'abutting';

export interface AtRiskVoxel {
  x: number;
  y: number;
  z: number;
  kind: RiskKind;
  hu: number;
}

/**
 * Masked voxels the removal cannot vouch for.
 *
 * Two kinds, and the first is the one that matters:
 *
 * - `ambiguousAttenuation` — the voxel is in the mask and its attenuation is in the band
 *   where enhanced artery and bone overlap. The grower may have flowed down a vessel that
 *   touched the skeleton and taken it. **This is the skull-base failure**, and it cannot be
 *   found geometrically, because by the time it happens the vessel is inside the mask.
 * - `abutting` — the voxel is in the mask and sits next to bright tissue that is not, so a
 *   vessel is running alongside without having merged. Less dangerous, still worth showing.
 *
 * A reader shown a clean subtraction with no indication of where it was uncertain has no
 * way to tell an occlusion from a deletion.
 */
export function findAtRiskVoxels(
  volume: BoneVolume,
  mask: Uint8Array,
  options: {
    ambiguousFromHu?: number;
    ambiguousToHu?: number;
    brightThresholdHu?: number;
    connectivity?: Connectivity;
  } = {}
): AtRiskVoxel[] {
  const out: AtRiskVoxel[] = [];
  if (!volume?.width || !mask?.length) {
    return out;
  }
  const from = numberOr(options.ambiguousFromHu, BONE_THRESHOLD_HU);
  const to = numberOr(options.ambiguousToHu, CONFIDENT_BONE_HU);
  const bright = numberOr(options.brightThresholdHu, ENHANCED_ARTERY_HU);
  const offsets = neighbourOffsets(options.connectivity ?? 26);

  for (let z = 0; z < volume.depth; z++) {
    for (let y = 0; y < volume.height; y++) {
      for (let x = 0; x < volume.width; x++) {
        const index = indexOf(volume, x, y, z);
        if (!mask[index]) {
          continue;
        }
        const hu = Number(volume.data[index]) || 0;
        if (hu >= from && hu < to) {
          out.push({ x, y, z, kind: 'ambiguousAttenuation', hu });
          continue;
        }
        for (const [dx, dy, dz] of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (!inside(volume, nx, ny, nz)) {
            continue;
          }
          const ni = indexOf(volume, nx, ny, nz);
          if (!mask[ni] && Number(volume.data[ni]) >= bright) {
            out.push({ x, y, z, kind: 'abutting', hu });
            break;
          }
        }
      }
    }
  }
  return out;
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Grows the mask by one voxel in every direction. */
export function dilate(
  volume: BoneVolume,
  mask: Uint8Array,
  connectivity: Connectivity = 6
): Uint8Array {
  const out = Uint8Array.from(mask ?? []);
  const offsets = neighbourOffsets(connectivity);
  for (let z = 0; z < volume.depth; z++) {
    for (let y = 0; y < volume.height; y++) {
      for (let x = 0; x < volume.width; x++) {
        if (!mask[indexOf(volume, x, y, z)]) {
          continue;
        }
        for (const [dx, dy, dz] of offsets) {
          if (inside(volume, x + dx, y + dy, z + dz)) {
            out[indexOf(volume, x + dx, y + dy, z + dz)] = 1;
          }
        }
      }
    }
  }
  return out;
}

export interface RemovalResult {
  /** BoneVolume with the masked voxels replaced by `fillHu`. */
  data: Float32Array;
  mask: Uint8Array;
  removedVoxels: number;
  atRisk: AtRiskVoxel[];
  warnings: string[];
  ok: boolean;
  reason?: string;
}

export interface RemovalOptions {
  seeds: Seed[];
  thresholdHu?: number;
  brightThresholdHu?: number;
  connectivity?: Connectivity;
  /** Voxels to grow the mask by, to catch the partial-volume rim. */
  dilationVoxels?: number;
  /** Value written where bone was. Air by default. */
  fillHu?: number;
}

/**
 * Removes bone from a CTA volume.
 *
 * Always reports the at-risk voxels. A subtraction that does not say where it was
 * uncertain is the failure mode this whole module is arranged around — the result looks
 * clean either way.
 */
export function removeBone(volume: BoneVolume, options: RemovalOptions): RemovalResult {
  const warnings: string[] = [];
  const size = (volume?.width ?? 0) * (volume?.height ?? 0) * (volume?.depth ?? 0);
  const empty: RemovalResult = {
    data: new Float32Array(Math.max(0, size)),
    mask: new Uint8Array(Math.max(0, size)),
    removedVoxels: 0,
    atRisk: [],
    warnings,
    ok: false,
  };

  const growth = growBoneMask(
    volume,
    options?.seeds ?? [],
    options?.thresholdHu,
    options?.connectivity ?? 26
  );
  if (!growth.ok) {
    return { ...empty, reason: growth.reason };
  }
  if (growth.rejectedSeeds) {
    warnings.push(
      `${growth.rejectedSeeds} semente(s) fora do volume ou abaixo do limiar foram ignoradas.`
    );
  }

  let mask = growth.mask;
  const dilations = Math.max(0, Math.floor(Number(options?.dilationVoxels) || 0));
  for (let i = 0; i < dilations; i++) {
    mask = dilate(volume, mask, 6);
  }

  const atRisk = findAtRiskVoxels(volume, mask, {
    brightThresholdHu: options?.brightThresholdHu,
    connectivity: options?.connectivity ?? 26,
  });
  const ambiguous = atRisk.filter(v => v.kind === 'ambiguousAttenuation').length;
  const abutting = atRisk.length - ambiguous;
  if (ambiguous) {
    warnings.push(
      `${ambiguous} voxel(s) removidos com atenuação na faixa em que artéria realçada e osso se confundem — a remoção pode ter apagado vaso. Não interprete oclusão a partir dessas regiões.`
    );
  }
  if (abutting) {
    warnings.push(
      `${abutting} voxel(s) da máscara encostam em tecido realçado não removido — verifique o contorno do vaso ali.`
    );
  }

  const fill = Number.isFinite(Number(options?.fillHu)) ? Number(options.fillHu) : -1000;
  const data = new Float32Array(size);
  let removedVoxels = 0;
  for (let i = 0; i < size; i++) {
    if (mask[i]) {
      data[i] = fill;
      removedVoxels += 1;
    } else {
      data[i] = Number(volume.data[i]) || 0;
    }
  }

  return { data, mask, removedVoxels, atRisk, warnings, ok: true };
}

export type RemovalApproach = 'dualEnergy' | 'subtraction' | 'thresholdConnectivity';

export interface ApproachRecommendation {
  approach: RemovalApproach;
  message: string;
}

/**
 * Which method to use for this study.
 *
 * Dual energy first when it is available: iodine and calcium have different spectral
 * signatures, and separating them properly has no skull-base blind spot at all. Saying so
 * is the point — a single-energy heuristic used on dual-energy data is a worse answer that
 * looks the same.
 */
export function recommendApproach(input: {
  hasDualEnergy?: boolean;
  hasMaskRun?: boolean;
}): ApproachRecommendation {
  if (input?.hasDualEnergy) {
    return {
      approach: 'dualEnergy',
      message:
        'Dupla energia disponível: separe iodo de cálcio pela decomposição (rt-dect) em vez de limiar. Não tem o ponto cego da base do crânio.',
    };
  }
  if (input?.hasMaskRun) {
    return {
      approach: 'subtraction',
      message:
        'Há aquisição de máscara: a subtração remove osso sem limiar, mas depende de registro e é sensível a movimento entre as aquisições.',
    };
  }
  return {
    approach: 'thresholdConnectivity',
    message:
      'Sem dupla energia nem máscara: limiar com conectividade é a única opção, e falha onde vaso e osso se tocam — verifique as regiões de contato antes de concluir oclusão.',
  };
}
