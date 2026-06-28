/**
 * @ohif/extension-rtmedical-key-images
 *
 * Key Images panel + DICOM Key Object Selection (KOS) support for OHIF v3
 * (RTV-148). OHIF v3 ships no native Key Images panel, so this is a net-new
 * extension. It follows the RTV-114 extension-first / zero-fork policy: no
 * changes to @ohif/core, @ohif/app or @ohif/ui.
 *
 * This entry point exports the framework-free selection model and KOS
 * descriptor logic (all unit-tested) plus the KeyImageService that wraps them.
 * The service is registered via `preRegistration`. The remaining wiring layer —
 * a commands module (add/remove/toggle/clear, export-to-KOS) and the right-panel
 * component — consumes these primitives and is tracked as a follow-up in the
 * README.
 */
export * from './types';
export * from './keyImageId';
export * from './keyImageLabel';
export * from './kos';
export * from './utils';
export { KeyImageManager } from './KeyImageManager';
export { KeyImageService } from './KeyImageService';
// v3.13/rspack ESM linking forbids re-exporting interfaces as values — use `export type`.
export type {
  KeyImagesChangedEvent,
  KeyImageServiceConfiguration,
} from './KeyImageService';

export { getCommandsModule } from './getCommandsModule';

import { KeyImageService } from './KeyImageService';
import { getCommandsModule } from './getCommandsModule';

const id = '@ohif/extension-rtmedical-key-images';

/** Minimal shape of the OHIF services manager used at registration time. */
interface ServicesManagerLike {
  registerService: (registration: unknown) => void;
}

/**
 * OHIF extension manifest. `preRegistration` registers the KeyImageService so
 * it is available to every mode that includes this extension, and
 * `getCommandsModule` exposes the selection/export commands. The panel module
 * getter is intentionally omitted until that UI layer lands, so the extension
 * can be registered without further side effects.
 */
const rtmedicalKeyImagesExtension = {
  id,

  preRegistration({ servicesManager }: { servicesManager: ServicesManagerLike }): void {
    servicesManager.registerService(KeyImageService.REGISTRATION);
  },

  getCommandsModule,
};

export default rtmedicalKeyImagesExtension;
