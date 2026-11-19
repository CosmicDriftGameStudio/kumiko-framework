---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The event-store executor quotes table names, aliases and columns through the shared `quoteIdent` helper.

<!-- kumiko-changes
feature: framework
type: fix
title: Executor SQL escapes identifiers through one helper
detail: List, count, aggregate, search, sort and read-gate SQL in the event-store executor interpolated table names, aliases and column names as raw `"${name}"`, so a name containing `"` broke the statement. All of them now go through `quoteIdent` from `db/sql-identifier.ts`, and the seven internal copies of that helper in the framework are gone. custom-fields keeps one internal helper instead of three. No public API changes.
-->
