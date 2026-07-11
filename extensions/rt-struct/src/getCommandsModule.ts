/**
 * RT Structure MPR rendering (RTV-146, Wave 3a).
 *
 * The stock cornerstone-dicom-rt hydration renders RTSTRUCT as a CONTOUR
 * representation, which only draws in the AXIAL acquisition plane: in an
 * orthographic VolumeViewport, Cornerstone3D clips the polySeg surface against
 * the slice plane ONCE per viewport and its camera re-clip helper is unwired, so
 * sagittal/coronal freeze on the first slice (verified against the installed
 * source + empirically). Adding a LABELMAP representation makes polySeg rasterize
 * the contours onto the CT grid — a labelmap is volumetric, so it renders in ALL
 * MPR planes for free. The conversion is heavy for large structure sets, so this
 * is an explicit user action (toolbar button), not automatic on hydrate.
 *
 * RTV-114: no @ohif/core import; uses public @cornerstonejs/tools APIs + the
 * services from servicesManager.
 */
import { segmentation as cstSegmentation, Enums as csToolsEnums } from '@cornerstonejs/tools';

const Labelmap = csToolsEnums.SegmentationRepresentations.Labelmap;
const Surface = csToolsEnums.SegmentationRepresentations.Surface;

function getCommandsModule({ servicesManager }: { servicesManager: any }) {
  const actions = {
    showRtStructInMpr: () => {
      const { segmentationService, cornerstoneViewportService, uiNotificationService } =
        servicesManager.services;

      const contourSegs = (segmentationService?.getSegmentations?.() || []).filter(
        (s: any) => s?.representationData?.Contour
      );
      if (!contourSegs.length) {
        uiNotificationService?.show?.({
          title: 'Estruturas RT',
          message: 'Nenhuma RTSTRUCT hidratada. Carregue as estruturas primeiro.',
          type: 'info',
        });
        return false;
      }

      const renderingEngine = cornerstoneViewportService?.getRenderingEngine?.();
      if (!renderingEngine) {
        return false;
      }
      // Volume (MPR) + 3D viewports — the labelmap renders in every plane.
      const volumeViewports = renderingEngine
        .getViewports()
        .filter((vp: any) => vp?.type === 'orthographic' || vp?.type === 'volume3d');

      let added = 0;
      volumeViewports.forEach((vp: any) => {
        contourSegs.forEach((seg: any) => {
          try {
            cstSegmentation.addSegmentationRepresentations(vp.id, [
              { segmentationId: seg.segmentationId, type: Labelmap },
            ]);
            added++;
          } catch (e) {
            /* representation already present / conversion unsupported — skip */
          }
        });
      });

      uiNotificationService?.show?.({
        title: 'Estruturas RT',
        message: added
          ? 'Renderizando estruturas em MPR (labelmap)…'
          : 'Nada a renderizar.',
        type: added ? 'info' : 'warning',
      });
      return added > 0;
    },

    /**
     * Render the RTSTRUCT as a 3D **Surface** in the Model View (the volume3d
     * viewport — the 4th quadrant of the RT 4-up layout). polySeg auto-converts
     * the contour/labelmap to a surface mesh (the "Converting Contour to Surface"
     * toast). Equivalent to Eclipse's Model View / autoseg surface3d. Explicit
     * user action — the mesh build is heavy for large structure sets.
     */
    showRtStructIn3D: () => {
      const { segmentationService, cornerstoneViewportService, uiNotificationService } =
        servicesManager.services;

      const contourSegs = (segmentationService?.getSegmentations?.() || []).filter(
        (s: any) => s?.representationData?.Contour
      );
      if (!contourSegs.length) {
        uiNotificationService?.show?.({
          title: 'Estruturas RT',
          message: 'Nenhuma RTSTRUCT hidratada. Carregue as estruturas primeiro.',
          type: 'info',
        });
        return false;
      }

      const renderingEngine = cornerstoneViewportService?.getRenderingEngine?.();
      if (!renderingEngine) {
        return false;
      }
      const volume3dViewports = renderingEngine
        .getViewports()
        .filter((vp: any) => vp?.type === 'volume3d');
      if (!volume3dViewports.length) {
        uiNotificationService?.show?.({
          title: 'Estruturas RT',
          message: 'Nenhum viewport 3D (Model View) no layout atual.',
          type: 'warning',
        });
        return false;
      }

      let added = 0;
      volume3dViewports.forEach((vp: any) => {
        contourSegs.forEach((seg: any) => {
          try {
            cstSegmentation.addSegmentationRepresentations(vp.id, [
              { segmentationId: seg.segmentationId, type: Surface },
            ]);
            added++;
          } catch (e) {
            /* representation already present / conversion unsupported — skip */
          }
        });
      });

      uiNotificationService?.show?.({
        title: 'Estruturas RT',
        message: added
          ? 'Convertendo estruturas para superfície 3D…'
          : 'Nada a renderizar.',
        type: added ? 'info' : 'warning',
      });
      return added > 0;
    },
  };

  return {
    actions,
    definitions: {
      showRtStructInMpr: { commandFn: actions.showRtStructInMpr },
      showRtStructIn3D: { commandFn: actions.showRtStructIn3D },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
