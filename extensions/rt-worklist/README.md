# @ohif/extension-rt-worklist

RIS-style study list for OHIF v3 (RTV-161).

## Composite filters, chips and saved views — RTV-185, RTV-186, RTV-187

| Module | Purpose |
| --- | --- |
| `worklistFilters` | Composite AND/OR criteria, local evaluation, and URL round-tripping |
| `worklistViews` | Saved views and pinned chips over a pluggable store |

### Filters (RTV-185)

Criteria combine with an **explicit** AND/OR, because "CT or MR" and "CT and MR" are
both things a reader means and only one can be the default.

`matchesStudy` runs the same predicate a server would, so a filter behaves identically
whether the rows came from QIDO-RS or a RIS API. Dates normalise from both `20260814`
and `2026-08-14` for the same reason.

Three behaviours are deliberate and tested:

- **An empty group matches everything.** Clearing the last chip shows the full
  worklist, not an empty one — even though the mathematical convention for an empty OR
  is the opposite.
- **An empty needle matches everything.** A half-typed search box must not blank the
  list before the reader finishes the word.
- **An undated study never satisfies a date filter.** Treating it as a match would
  quietly pad every date-filtered list.

### URL state, and a separator bug worth remembering

Filters serialise to one compact query value:

```
?filter=modality:anyOf:ct,mr;reportStatus:equals:none
```

Compact so it survives being pasted into a chat window, which a JSON blob does not.

The separators **must** be characters that `encodeURIComponent` escapes. The first
version used a tilde as the criterion separator, which is wrong: `encodeURIComponent`
leaves the unreserved marks (hyphen, underscore, period, exclamation, tilde, asterisk,
apostrophe, parentheses) untouched, so a patient name containing a tilde would inject a
criterion boundary and split the filter. A unit test with a hostile value caught it;
the semicolon, colon and comma all encode (%3B %3A %2C).

Unknown fields and operators are **dropped, not rejected** — the URL may come from a
colleague on an older build.

### Views and chips (RTV-187, RTV-186)

A view is a named snapshot of *filters + columns + sort*; a chip is the same thing
pinned above the list. They are **one type**, not two: "Urgentes" as a chip and as a
saved view are the same intention, and splitting them would mean two editors, two
storage shapes and two ways to disagree.

System views (Sem laudo, Urgentes, CT, MR) are read-only and **never persisted**, so an
admin changing the list changes it for everyone instead of fighting stale copies in
every browser. A stored view claiming `scope: 'system'` is demoted to `user` —
otherwise a hand-edited localStorage entry would be undeletable.

### Persistence seam

Everything goes through a `ViewStore` adapter with two methods. The default is
localStorage, which makes the feature work **today**; swapping in the Connect endpoints
(`/api/worklist-views`) later is one implementation of the same interface, with no
change to any logic. RTV-187 is blocked on backend only for *sharing*, not for working.

### Not delivered

No UI. These are the model and the rules; the filter panel, the chip bar and the views
dropdown are components on top. Nothing here has been seen in a browser.
