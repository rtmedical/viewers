import { KeyImageService } from './KeyImageService';
import { buildKosDescriptor, KosDescriptor } from './kos';
import { KeyImageReference, KosDocumentTitle } from './types';

/** Minimal shape of the OHIF services manager passed to module getters. */
interface ServicesManagerLike {
  services: Record<string, unknown>;
}

interface CommandsModuleParams {
  servicesManager: ServicesManagerLike;
}

/**
 * Commands for the Key Images extension (RTV-148).
 *
 * Thin, side-effect-only bridge between OHIF's command manager (toolbar buttons,
 * keyboard shortcuts, the panel) and the {@link KeyImageService}. The selection
 * semantics live in the service/model; these commands only resolve the service
 * and forward arguments, so they stay trivially testable with a fake services
 * manager and never duplicate the model logic (RTV-114 zero-fork).
 *
 * OHIF invokes a command's `commandFn` with a single merged options object, so
 * each action destructures its arguments from that object.
 */
export function getCommandsModule({ servicesManager }: CommandsModuleParams) {
  const getService = (): KeyImageService =>
    servicesManager.services[KeyImageService.REGISTRATION.name] as KeyImageService;

  const actions = {
    /** Flag a reference as a key image. Returns true if newly added. */
    addKeyImage: ({ reference }: { reference: KeyImageReference }): boolean =>
      getService().addKeyImage(reference),

    /** Remove a key image by reference or canonical id. */
    removeKeyImage: ({
      reference,
    }: {
      reference: KeyImageReference | string;
    }): boolean => getService().removeKeyImage(reference),

    /** Toggle a reference. Returns the resulting selected state. */
    toggleKeyImage: ({ reference }: { reference: KeyImageReference }): boolean =>
      getService().toggleKeyImage(reference),

    /** Clear the whole selection. */
    clearKeyImages: (): void => getService().clearKeyImages(),

    /** Read the current selection (insertion order). */
    getKeyImages: (): KeyImageReference[] => getService().getKeyImages(),

    /**
     * Build a serialization-ready KOS descriptor from the current selection.
     * Returns `undefined` for an empty selection so a toolbar click is a
     * harmless no-op (a valid KOS requires at least one reference). The dcmjs
     * byte-writing step consumes this descriptor and lands as a follow-up.
     */
    exportKeyImagesToKOS: ({
      title,
      seriesDescription,
    }: {
      title?: KosDocumentTitle;
      seriesDescription?: string;
    } = {}): KosDescriptor | undefined => {
      const references = getService().getKeyImages();
      if (references.length === 0) {
        return undefined;
      }
      return buildKosDescriptor(references, { title, seriesDescription });
    },
  };

  const definitions = {
    addKeyImage: { commandFn: actions.addKeyImage },
    removeKeyImage: { commandFn: actions.removeKeyImage },
    toggleKeyImage: { commandFn: actions.toggleKeyImage },
    clearKeyImages: { commandFn: actions.clearKeyImages },
    getKeyImages: { commandFn: actions.getKeyImages },
    exportKeyImagesToKOS: { commandFn: actions.exportKeyImagesToKOS },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
