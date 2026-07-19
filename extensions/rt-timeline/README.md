# @ohif/extension-rt-timeline

**RT Summary / Course Timeline** for OHIF v3 — epic **RTV-162**. Delivers the
CourseTimelinePanel (**RTV-164**) hosting the **prescription** (**RTV-165**) and
**treatment** (**RTV-166**) sub-timelines. Follows **RTV-114** (extension-first /
zero fork).

## Design (panel-only, no cross-extension imports)

The panel reads the **already-parsed** models that the sibling extensions attach
to their display sets:
- `rtPlan` from `@ohif/extension-rt-plan` (RTV-132) → prescription timeline.
- `rtRecord` from `@ohif/extension-rt-record` (RTV-163) → treatment timeline.

These are consumed via **duck-typed** interfaces (`RtPlanLike` / `RtRecordLike`),
so there is **no cross-extension import** — the timeline transform is pure and
unit-tested in isolation.

## Modules

| Module | Purpose |
| --- | --- |
| `courseTimeline` (`buildPrescriptionTimeline`, `buildTreatmentTimeline`, `buildCourseTimeline`) | Pure, unit-tested timeline transforms + course summary |
| `getPanelModule` | CourseTimelinePanel; opt in via `@ohif/extension-rt-timeline.panelModule.courseTimeline` |

## Coverage

- ✅ **RTV-165** prescription timeline: per plan fraction group — fractions,
  dose/fraction, total dose, dominant energy + technique (BeamType).
- ✅ **RTV-166** treatment timeline: per record, chronological — date, fraction,
  beams, delivered MU; course summary (Σ MU, date span).
- 🟡 **RTV-164** CourseTimelinePanel: the host panel + these two sub-timelines are
  in place. The remaining sub-timelines — imaging (RTV-167), overrides (RTV-168),
  trends (RTV-169) — and the detail panels / controls (RTV-170…180) are
  follow-ups, several of which need data not present in the standard RT objects
  (e.g. per-image stats, patient weight trends) → backend/extra-object dependent.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-timeline/jest.config.js --ci
```
