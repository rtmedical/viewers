/**
 * @ohif/extension-rt-tps
 *
 * Radiotherapy TPS-style layout (Varian Eclipse-like) for OHIF v3 — RTV Wave 4.
 * DISPLAY-ONLY: no planning engine (no dose calc / optimization / contour editing).
 * Provides a custom `layoutTemplateModule` (TpsViewerLayout) that reuses the stock
 * header + resizable left/center/right regions and adds an Eclipse-style bottom
 * "Info Window" bar composing the existing RT panels. Zero fork (RTV-114).
 */
import TpsViewerLayout from './TpsViewerLayout';

const id = '@ohif/extension-rt-tps';

function getLayoutTemplateModule({
  servicesManager,
  extensionManager,
  commandsManager,
  hotkeysManager,
}) {
  function TpsViewerLayoutWithServices(props) {
    return TpsViewerLayout({
      servicesManager,
      extensionManager,
      commandsManager,
      hotkeysManager,
      ...props,
    });
  }

  return [
    {
      name: 'tps',
      id: 'tps',
      component: TpsViewerLayoutWithServices,
    },
  ];
}

const rtTpsExtension = {
  id,
  getLayoutTemplateModule,
};

export default rtTpsExtension;
