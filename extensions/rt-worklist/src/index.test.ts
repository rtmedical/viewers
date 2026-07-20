import rtWorklistExtension from './index';

describe('@ohif/extension-rt-worklist manifest', () => {
  it('exposes the extension id and the customization module', () => {
    expect(rtWorklistExtension.id).toBe('@ohif/extension-rt-worklist');
    expect(typeof rtWorklistExtension.getCustomizationModule).toBe('function');
  });

  it('registers a PRIVATE /worklist-rt custom route in the default module', () => {
    const modules = rtWorklistExtension.getCustomizationModule({
      servicesManager: { services: {} },
      extensionManager: {},
    } as any);

    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('default');

    const pushed = modules[0].value['routes.customRoutes'].routes.$push;
    expect(pushed).toHaveLength(1);

    const route = pushed[0];
    expect(route.path).toBe('/worklist-rt');
    // The app router only wraps in PrivateRoute when private === true
    // (platform/app/src/routes/index.tsx) — this must never regress, the
    // worklist shows patient names and MRNs.
    expect(route.private).toBe(true);
    expect(typeof route.children).toBe('function');
  });
});
