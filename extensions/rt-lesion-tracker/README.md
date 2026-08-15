# @ohif/extension-rt-lesion-tracker

RECIST 1.1 lesion tracking (**RTV-10**) and the labelling workflow (**RTV-150**).

Follows the **RTV-114** extension-first / zero-fork policy. The response arithmetic is
pure and framework-free; the commands only hold state and delegate.

## Modules

| Module | Purpose |
| --- | --- |
| `recist` | The guideline, transcribed: measurability, sum of diameters, target/non-target/overall response, nadir tracking |
| `anatomies` | 38 anatomic sites, each flagged nodal or non-nodal |
| `labellingWorkflow` | The step machine: select → measure → classify → follow up → review |
| `getCommandsModule` | `rtLesionAdd`, `rtLesionRemove`, `rtLesionRecordTimepoint`, `rtLesionValidateTargets`, `rtLesionAssess`, and the `rtLesionWorkflow*` commands |

## The four rules that are easy to get wrong

Every rule comes from RECIST 1.1 (Eisenhauer et al., *Eur J Cancer* 2009;45:228-247).
These four are where an "obvious" simplification is wrong, and each has its own test:

1. **Nodal lesions are measured by SHORT axis, not longest diameter.** A lymph node is
   measured across, not along. Summing longest diameters for nodes overstates every
   sum in the study.
2. **PR is measured against baseline; PD is measured against NADIR.** Not both against
   baseline. A patient who shrinks 100 → 50 and grows back to 70 is *progressing*
   (+40% from nadir) even though they are still 30% below baseline. PD wins.
3. **PD needs BOTH ≥20% relative growth AND ≥5 mm absolute growth.** Without the
   absolute floor, a 4 mm nadir growing to 5 mm is "25% progression" — measurement
   noise promoted to a clinical event.
4. **A node that falls below 10 mm short axis counts as resolved for CR**, even though
   it is still visible and still measurable.

Two more that the overall-response table decides, and that people misread:

- **CR target + residual non-target disease is PR, not CR.**
- **Any new lesion is PD**, regardless of everything else.

## Design choices worth knowing

**One unmeasurable lesion makes the whole timepoint not evaluable.** Dropping it and
summing the rest would compare a 4-lesion sum against a 5-lesion baseline and
manufacture a response.

**A not-evaluable scan never moves the nadir.** An unmeasurable scan is missing
information, not evidence of shrinkage.

**All lymph-node stations share one organ key.** RECIST treats nodes as a single
"organ" for the two-lesions-per-organ rule, however far apart the stations are.

**An unknown anatomic site defaults to non-nodal.** That is the safe direction —
longest diameter and the 10 mm floor. Defaulting to nodal would silently switch a
solid organ to short-axis measurement.

**Workflow completeness is derived, never stored**, and every step stays reachable.
The machine gates *advancing* on completeness but never traps the reader: they can jump
back to fix a label after three follow-ups. A workflow that will not let you correct a
mistake gets worked around, not followed.

## About the 38 sites

RECIST does **not** standardise a site list — it only distinguishes nodal from
non-nodal, because that changes how a lesion is measured. The 38 sites here are a
*curated* set carried over from the legacy Meteor tracker, kept because the
two-per-organ rule needs a consistent vocabulary to group by. The `nodal` flag is the
load-bearing part; the names are convention.

## Scope / follow-ups

- **No UI.** The ticket asks for a `LabellingWorkflowPanel`; this delivers the engine
  and the commands, not the panel. That is a deliberate split: the engine is the part
  that can be proven correct without a browser, and a large unverifiable React table
  would add risk without adding confidence. The commands are a complete API for one.
- **No DICOM SR export.** RTV-10 asks for a RECIST report as SR TID 1500. Writing SRs
  is `@ohif/extension-rt-sr`'s job (RTV-39 already sends them via STOW-RS); wiring the
  RECIST model into that belongs there.
- **Not wired to measurements.** Lesion diameters arrive as numbers through
  `rtLesionRecordTimepoint`. Pulling them from Cornerstone3D bidirectional annotations
  is the integration step.
- **Not validated in a browser.** The DEV1 box has no memory headroom to build and
  serve the viewer (see `docker/README.md`). The evidence is 77 unit tests over the
  guideline rules.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-lesion-tracker/jest.config.js --ci
```
