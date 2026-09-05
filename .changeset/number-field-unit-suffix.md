---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`NumberFieldDef` gained a `unit` option: an editable number field can now show a unit-of-measure suffix in its input, either a static string (`unit: "km"`) or a sibling field's live value (`unit: { field: "mileageUnit" }`), so the unit can vary per record (e.g. an odometer reading in "mi" or "km"). Display-only — the stored numeric value is never converted. Added `mi` (miles) to the read-only `unit` format registry's vocabulary alongside it.
