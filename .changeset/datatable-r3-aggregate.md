---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

The entity list query takes an optional `aggregate` payload and answers with groups and measures instead of rows, so a table can show group headers and sums over all matching rows rather than one page.

<!-- kumiko-changes
feature: framework
type: improvement
title: Groups and sums on the entity list query
detail: Pass aggregate with an optional groupBy field and up to 20 measures (sum, avg, count, min, max per field) to a list query. The answer is groups with key, count, one value per measure in request order and, for a reference groupBy, the label of the referenced row. Screen filters, search, ownership and field read access apply exactly as for rows; a field the caller may not read yields null or no groups, and encrypted, personal or secret fields and unsuitable field types are rejected with a validation error. At most 200 groups are returned, with truncated set beyond that. Custom query handlers use executor.aggregate or answerListAggregate.
-->
