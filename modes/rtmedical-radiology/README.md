# @rt/mode-radiology (RTV-116)

RT Medical general **diagnostic radiology** workflow mode for OHIF v3.

## Feature

A clean diagnostic reading workflow: 1×1 viewport with a study-browser left
panel and a right panel stack of **Key Images** (RTV-148) + measurements.
Composes `@ohif/mode-basic` — no fork of OHIF core (RTV-114).

## Modules

| Export | Purpose |
| --- | --- |
| `modeFactory` | Re-uses `@ohif/mode-basic`'s factory bound to this mode's `modeInstance`. |
| `extensionDependencies` | `@ohif/mode-basic` deps + `@ohif/extension-rtmedical-theme` + `@ohif/extension-rtmedical-key-images`. |
| `modeInstance` | `displayName: "Radiologia"`, route `rtmedical-radiology`, RT right panels. |

## Customization points consumed

- Panel `@ohif/extension-rtmedical-key-images.panelModule.keyImages` (right panel).
- Inherits the `@ohif/mode-basic` toolbar/tool groups (RT-specific toolbar tracked in RTV-117).

## Tickets

- **RTV-116** — this base mode.
- Follow-ups: RTV-117 (RT toolbar), RTV-118 (full panel set), RTV-119 (hanging
  protocols), RTV-120 (next/prev study), RTV-121 (inline laudo).
