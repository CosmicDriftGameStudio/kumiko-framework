---
"@cosmicdrift/kumiko-framework": patch
---

`list()` now checks field-level read access before filtering or sorting by a field, closing an oracle that let a caller probe a stripped field's values through result counts or row order.

Consumers change behavior without changing their own code: a filter on a field the caller cannot read is now unsatisfiable (empty rows, `total: 0`) instead of silently filtering on stripped values, and a sort on such a field falls back to the default id ordering. A screen with a declared facet filter on an access-restricted field therefore shows an empty list for roles lacking read access on that field. No error-contract change — the denial stays silent, matching how `filterReadFields` strips the field from the response.
