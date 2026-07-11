/**
 * Density line-profile tool (RTV-32). Extends the cornerstone3D LengthTool to
 * draw a line; on completion we sample the image scalar (HU for CT) along the
 * line and publish the profile to the store the panel reads. Follows the
 * CalibrationLineTool pattern (extend LengthTool + an onCompleted handler).
 *
 * RTV-114: no @ohif/core import; the completion handler receives servicesManager
 * from the subscriber. Voxel read mirrors ProbeTool exactly
 * (transformWorldToIndex + voxelManager.getAtIJKPoint) so it is version-correct.
 */
import { LengthTool } from '@cornerstonejs/tools';
import { utilities as csUtils } from '@cornerstonejs/core';
import { sampleLineProfile, type Vec3 } from './lineProfile';
import { setLineProfile } from './lineProfileStore';

const { transformWorldToIndex } = csUtils;

class LineProfileTool extends LengthTool {
  static toolName = 'LineProfile';
}

export default LineProfileTool;

/** Build a world→scalar sampler from a cornerstone viewport's image data. */
function makeSampler(viewport: any): {
  sampleAt: (w: Vec3) => number | null;
  modality?: string;
} | null {
  const image = viewport?.getImageData?.();
  if (!image) {
    return null;
  }
  const { imageData, voxelManager, dimensions, metadata } = image;
  if (!imageData || !voxelManager?.getAtIJKPoint || !dimensions) {
    return null;
  }
  const [dx, dy, dz] = dimensions;
  const sampleAt = (world: Vec3): number | null => {
    try {
      const ijk = transformWorldToIndex(imageData, world as unknown as number[]);
      const i = Math.round(ijk[0]);
      const j = Math.round(ijk[1]);
      const k = Math.round(ijk[2]);
      if (i < 0 || j < 0 || k < 0 || i >= dx || j >= dy || k >= dz) {
        return null;
      }
      const v = voxelManager.getAtIJKPoint([i, j, k]);
      return typeof v === 'number' ? v : Array.isArray(v) ? v[0] : null;
    } catch {
      return null;
    }
  };
  return { sampleAt, modality: metadata?.Modality };
}

/**
 * Subscriber for cornerstone ANNOTATION_COMPLETED. When a LineProfile line is
 * finished, sample the active viewport along it and publish the profile.
 */
export function onLineProfileCompleted(servicesManager: any, evt: any): void {
  const annotation = evt?.detail?.annotation;
  if (!annotation || annotation?.metadata?.toolName !== LineProfileTool.toolName) {
    return;
  }
  const points = annotation?.data?.handles?.points;
  if (!points || points.length < 2) {
    return;
  }
  const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
  const activeId = viewportGridService?.getActiveViewportId?.();
  const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(activeId);
  const sampler = viewport && makeSampler(viewport);
  if (!sampler) {
    return;
  }
  const profile = sampleLineProfile(sampler.sampleAt, points[0] as Vec3, points[1] as Vec3, {
    stepMm: 1,
  });
  setLineProfile({
    points: profile,
    modality: sampler.modality,
    unit: sampler.modality === 'CT' ? 'HU' : undefined,
  });
}
