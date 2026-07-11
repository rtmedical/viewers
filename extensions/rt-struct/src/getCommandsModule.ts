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
  };

  return {
    actions,
    definitions: {
      showRtStructInMpr: { commandFn: actions.showRtStructInMpr },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
