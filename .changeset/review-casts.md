---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

Suspect `as` casts in framework, types, bundled-features and renderer replaced by type guards, Zod checks at input boundaries and typing at the source.

<!-- kumiko-changes
feature: framework
type: fix
title: Fewer unchecked casts, runtime checks at boundaries
detail: bridgeStub needs no casts, the db dialect types drop any (TableColumns is SchemaTable, SelectQuery is unknown). Malformed input now fails at the boundary instead of later, for example a step that returns a non-WriteResult as the pipeline result, a non-numeric Redis counter in the login rate limiter, or r.useExtension and r.referenceData called without their required argument. The cast baseline is rewritten so new suspect casts in a file fail the As-Casts Audit.
-->
