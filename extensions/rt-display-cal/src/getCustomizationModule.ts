/**
 * Registers the fullscreen /display-calibration route (RTV-211) through OHIF's
 * `routes.customRoutes` customization — same `$push` shape as
 * extensions/default/src/customizations/helloPageCustomization.tsx. It lives in
 * the extension's 'default' customization module so the route is active
 * whenever the extension is loaded (no toolbar button in Fase 1 — access by
 * URL). The base `routes.customRoutes` value ({ routes: [] }) is registered by
 * @ohif/extension-default and consumed in platform/app/src/routes/index.tsx,
 * which passes servicesManager/extensionManager props to `children`.
 */
import CalibrationPage from './CalibrationPage';

export default function getCustomizationModule() {
  return [
    {
      name: 'default',
      value: {
        'routes.customRoutes': {
          routes: {
            $push: [
              {
                path: '/display-calibration',
                children: CalibrationPage,
                // Authenticated route: PrivateRoute only wraps when private
                // is EXPLICITLY true (routes/index.tsx) — the conformance
                // history and audit identity must not be public.
                private: true,
              },
            ],
          },
        },
      },
    },
  ];
}
