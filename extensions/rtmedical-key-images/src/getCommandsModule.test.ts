import { getCommandsModule } from './getCommandsModule';
import { KeyImageService } from './KeyImageService';
import { KEY_OBJECT_SELECTION_SOP_CLASS_UID, KOS_DOCUMENT_TITLES } from './kos';
import { KeyImageReference } from './types';

const ref = (SOPInstanceUID: string): KeyImageReference => ({
  StudyInstanceUID: '1.2.study',
  SeriesInstanceUID: '1.2.series',
  SOPInstanceUID,
});

/** Wrap a real service in a minimal OHIF-style services manager. */
const setup = () => {
  const service = new KeyImageService();
  const servicesManager = {
    services: { [KeyImageService.REGISTRATION.name]: service },
  };
  const { actions, definitions, defaultContext } = getCommandsModule({ servicesManager });
  return { service, actions, definitions, defaultContext };
};

describe('getCommandsModule', () => {
  it('exposes a commandFn for every command in the DEFAULT context', () => {
    const { definitions, defaultContext } = setup();
    expect(defaultContext).toBe('DEFAULT');
    expect(Object.keys(definitions).sort()).toEqual(
      [
        'addKeyImage',
        'clearKeyImages',
        'exportKeyImagesToKOS',
        'getKeyImages',
        'removeKeyImage',
        'toggleKeyImage',
      ].sort()
    );
    Object.values(definitions).forEach(def =>
      expect(typeof def.commandFn).toBe('function')
    );
  });

  it('add/remove/toggle/clear/getKeyImages delegate to the resolved service', () => {
    const { service, actions } = setup();

    expect(actions.addKeyImage({ reference: ref('a') })).toBe(true);
    expect(actions.addKeyImage({ reference: ref('b') })).toBe(true);
    expect(service.getCount()).toBe(2);

    expect(actions.getKeyImages().map(r => r.SOPInstanceUID)).toEqual(['a', 'b']);
    expect(actions.toggleKeyImage({ reference: ref('a') })).toBe(false); // de-selected
    expect(actions.removeKeyImage({ reference: 'noop' })).toBe(false);

    actions.clearKeyImages();
    expect(service.getCount()).toBe(0);
  });

  it('resolves the service lazily so commands see post-registration state', () => {
    // A command captured before any selection still reflects later mutations.
    const { service, actions } = setup();
    const read = actions.getKeyImages;
    service.addKeyImage(ref('a'));
    expect(read().map(r => r.SOPInstanceUID)).toEqual(['a']);
  });
});

describe('getCommandsModule.exportKeyImagesToKOS', () => {
  it('returns undefined for an empty selection (no-op)', () => {
    const { actions } = setup();
    expect(actions.exportKeyImagesToKOS()).toBeUndefined();
  });

  it('builds a KOS descriptor from the current selection', () => {
    const { service, actions } = setup();
    service.addKeyImage(ref('a'));
    service.addKeyImage(ref('b'));

    const descriptor = actions.exportKeyImagesToKOS();
    expect(descriptor).toBeDefined();
    expect(descriptor?.sopClassUID).toBe(KEY_OBJECT_SELECTION_SOP_CLASS_UID);
    expect(descriptor?.references.map(r => r.SOPInstanceUID)).toEqual(['a', 'b']);
  });

  it('forwards the document title and description', () => {
    const { service, actions } = setup();
    service.addKeyImage(ref('a'));

    const descriptor = actions.exportKeyImagesToKOS({
      title: KOS_DOCUMENT_TITLES.FOR_TEACHING,
      seriesDescription: 'Teaching file',
    });
    expect(descriptor?.title).toEqual(KOS_DOCUMENT_TITLES.FOR_TEACHING);
    expect(descriptor?.seriesDescription).toBe('Teaching file');
  });
});
