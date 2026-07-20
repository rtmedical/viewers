/**
 * Registers the RIS-style worklist route (RTV-161) at /worklist-rt through
 * OHIF's `routes.customRoutes` customization — same `$push` shape as
 * extensions/default/src/customizations/helloPageCustomization.tsx, same
 * registration pattern as extensions/rt-display-cal. It lives in the
 * extension's 'default' customization module, so the route is active whenever
 * the extension is loaded (registration in platform/app/pluginConfig.json is
 * sufficient — no mode involvement, this is an app-level page).
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

export default function getCustomizationModule({ servicesManager, extensionManager }) {
  const RtWorklistRoute = (props: Record<string, unknown>) =>
    React.createElement(RtWorklistPage, {
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
            ],
          },
        },
      },
    },
  ];
}
