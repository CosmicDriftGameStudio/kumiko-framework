---
"@cosmicdrift/kumiko-framework": minor
---

Entity-list filters (`payload.filter`/`payload.filters`, screen-declared `filter`, facets) accept two new comparison operators, `lte` and `gte`, alongside the existing `eq`/`ne`/`lt`/`gt`/`in` — for a "valid as of today or earlier" style filter that previously required paging through every row in memory to apply after the fact. Allowed on the same comparable field types as `lt`/`gt` (number/money/decimal/date/timestamp/locatedTimestamp); the boot validator rejects them on text/boolean/select/multiSelect fields the same way it already rejects `lt`/`gt` there.
