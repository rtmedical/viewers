/**
 * Registers the RIS-style worklist route (RTV-161) at /worklist-rt and the
 * IHE Invoke Image Display entry points (RTV-157) at /ihe-invoke plus the
 * conformance alias /IHEInvokeImageDisplay (the URL component the IID
 * profile itself uses) through OHIF's `routes.customRoutes` customization —
 * same `$push` shape as
 * extensions/default/src/customizations/helloPageCustomization.tsx, same
 * registration pattern as extensions/rt-display-cal. They live in the
 * extension's 'default' customization module, so the routes are active
 * whenever the extension is loaded (registration in
 * platform/app/pluginConfig.json is sufficient — no mode involvement, these
 * are app-level pages).
 *
 * The route deliberately does NOT claim '/' — that path belongs to the stock
 * WorkList and RRv6 route specificity would make the two collide. Promoting
 * this page to be the landing experience is a deployment/config decision:
 * set `showStudyList: false` in the app config (which removes the stock '/'
 * route) and point users at /worklist-rt.
 *
 * The router (platform/app/src/routes/index.tsx, RouteWithErrorBoundary)
 * injects `servicesManager` and `extensionManager` props into route children;
 * the closure parameters below are kept as a fallback so the page keeps
 * working even if the router's prop injection changes.
 */
import React from 'react';
import RtWorklistPage from './RtWorklistPage';
import IheInvokePage from './IheInvokePage';

export default function getCustomizationModule({ servicesManager, extensionManager }) {
  const RtWorklistRoute = (props: Record<string, unknown>) =>
    React.createElement(RtWorklistPage, {
      servicesManager,
      extensionManager,
      ...props,
    });

  const IheInvokeRoute = (props: Record<string, unknown>) =>
    React.createElement(IheInvokePage, {
      servicesManager,
      extensionManager,
      ...props,
    });

  return [
    {
      name: 'default',
      value: {
        'routes.customRoutes': {
          routes: {
            $push: [
              {
                path: '/worklist-rt',
                children: RtWorklistRoute,
                // Authenticated route: PrivateRoute only wraps when private
                // is EXPLICITLY true (routes/index.tsx) — patient names and
                // MRNs must never be public.
                private: true,
              },
              // IHE Invoke Image Display (RTV-157): both paths render the
              // same page. Also PRIVATE — an IID invocation carries Study
              // Instance UIDs / PatientIDs and resolves to patient data, so
              // the invoker must authenticate exactly like any viewer user.
              {
                path: '/ihe-invoke',
                children: IheInvokeRoute,
                private: true,
              },
              {
                // Conformance alias: the IID profile invokes the display via
                // this URL component.
                path: '/IHEInvokeImageDisplay',
                children: IheInvokeRoute,
                private: true,
              },
            ],
          },
        },
      },
    },
  ];
}
