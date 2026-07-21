import rtWorklistExtension from './index';

describe('@ohif/extension-rt-worklist manifest', () => {
  it('exposes the extension id and the customization module', () => {
    expect(rtWorklistExtension.id).toBe('@ohif/extension-rt-worklist');
    expect(typeof rtWorklistExtension.getCustomizationModule).toBe('function');
  });

  it('registers PRIVATE custom routes for the worklist and the IHE IID entry points', () => {
    const modules = rtWorklistExtension.getCustomizationModule({
      servicesManager: { services: {} },
      extensionManager: {},
    } as any);

    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('default');

    const pushed = modules[0].value['routes.customRoutes'].routes.$push;
    const paths = pushed.map((route: any) => route.path);
    // /IHEInvokeImageDisplay is the conformance alias the IID profile itself
    // uses; /ihe-invoke is the friendly path (RTV-157).
    expect(paths).toEqual(['/worklist-rt', '/ihe-invoke', '/IHEInvokeImageDisplay']);

    for (const route of pushed) {
      // The app router only wraps in PrivateRoute when private === true
      // (platform/app/src/routes/index.tsx) — this must never regress: the
      // worklist shows patient names/MRNs and the IID entry points resolve
      // Study Instance UIDs / PatientIDs to patient data.
      expect(route.private).toBe(true);
      expect(typeof route.children).toBe('function');
    }
  });
});
