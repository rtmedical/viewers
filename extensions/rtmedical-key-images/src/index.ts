/**
 * @ohif/extension-rtmedical-key-images
 *
 * Key Images panel + DICOM Key Object Selection (KOS) support for OHIF v3
 * (RTV-148). OHIF v3 ships no native Key Images panel, so this is a net-new
 * extension. It follows the RTV-114 extension-first / zero-fork policy: no
 * changes to @ohif/core, @ohif/app or @ohif/ui.
 *
 * This entry point exports the framework-free selection model, KOS descriptor
 * logic, KOS serialization (dcmjs) and KOS parsing (all unit-tested at their
 * pure core), plus the OHIF wiring: KeyImageService (preRegistration), commands,
 * the right-panel module and the SopClassHandler that reads existing KOS objects.
 */
export * from './types';
export * from './keyImageId';
export * from './keyImageLabel';
export * from './kos';
export * from './kosDataset';
export * from './kosSerialize';
export * from './parseKosInstance';
export * from './utils';
export { KeyImageManager } from './KeyImageManager';
export { KeyImageService } from './KeyImageService';
// v3.13/rspack ESM linking forbids re-exporting interfaces as values — use `export type`.
export type {
  KeyImagesChangedEvent,
  KeyImageServiceConfiguration,
} from './KeyImageService';

export { getCommandsModule } from './getCommandsModule';
export { getSopClassHandlerModule } from './getSopClassHandlerModule';

import { KeyImageService } from './KeyImageService';
import { getCommandsModule } from './getCommandsModule';
import getPanelModule from './getPanelModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';

const id = '@ohif/extension-rtmedical-key-images';

/** Minimal shape of the OHIF services manager used at registration time. */
interface ServicesManagerLike {
  registerService: (registration: unknown) => void;
}

/**
 * OHIF extension manifest. `preRegistration` registers the KeyImageService so
 * it is available to every mode that includes this extension, `getCommandsModule`
 * exposes the selection/export commands, `getPanelModule` provides the Key
 * Images right panel and `getSopClassHandlerModule` turns existing KOS objects
 * into display sets (RTV-148). A mode opts the panel in via
 * '@ohif/extension-rtmedical-key-images.panelModule.keyImages' in its rightPanels.
 */
const rtmedicalKeyImagesExtension = {
  id,

  preRegistration({ servicesManager }: { servicesManager: ServicesManagerLike }): void {
    servicesManager.registerService(KeyImageService.REGISTRATION);
  },

  getCommandsModule,
  getPanelModule,
  getSopClassHandlerModule,
};

export default rtmedicalKeyImagesExtension;
