# @rt/mode-radiotherapy (RTV-123)

RT Medical **radiotherapy planning & QA** workflow mode for OHIF v3.

## Feature

Base radiotherapy reading/planning workflow: study browser + a right-panel
stack of contour segmentation, Key Images, measurements and laudo, on a 2×2
("4-up") grid. Composes `@ohif/mode-basic` — which already provides the
RTSTRUCT/RTDOSE/RTPLAN sopClassHandlers and the dicom-rt viewport — with **no
fork** of OHIF core (RTV-114).

## Modules

| Export | Purpose |
| --- | --- |
| `modeFactory` | Re-uses `@ohif/mode-basic`'s factory bound to this mode's `modeInstance`. |
| `extensionDependencies` | mode-basic deps (incl. cornerstone-dicom-rt/seg) + rtmedical-theme + key-images. |
| `modeInstance` | `displayName: "Radioterapia"`, route `rtmedical-radiotherapy`, RT panels, `hangingProtocol: rt-cross-sectional-2x2`. |

## Follow-ups (RTV-122 epic)

- RTV-124 — RT toolbar (tabs FERRAMENTAS/LAYOUT/3D/FUSÃO/ANOTAÇÕES/LAUDO/IMPRESSÃO)
- RTV-125 — RT panels (RT Tree, DVH, Isodoses, Fusion Timeline, RT Print/Report)
- RTV-126 — auto-load RT data (FICHA/DVH/CONTORNO) on mode enter
- RTV-127 — 4-up MPR hanging protocol (axial/sagittal/coronal/3D)
- RTV-128 — RT hotkeys + persistence; RTV-129 — PYLINAC QA sidecar
