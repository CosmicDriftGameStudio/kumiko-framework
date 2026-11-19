---
"@cosmicdrift/kumiko-guards": minor
---

The As-Casts Audit no longer accepts `engine-payload` casts of `event.payload` and `query.payload` in write and query handlers.

<!-- kumiko-changes
feature: guards
type: breaking
title: Payload casts in handlers count as suspect casts
detail: A cast marked `// @cast-boundary engine-payload` whose expression starts with `event.payload` or `query.payload` in a `handlers/**/*.write.ts` or `handlers/**/*.query.ts` file is now a suspect cast instead of a legit boundary. `defineWriteHandler` and `defineQueryHandler` type the payload from the schema, so such a cast hides drift between schema and payload type. Projections and all other files keep the marker.
migration: Define the handler with `defineWriteHandler` or `defineQueryHandler` instead of an object typed `WriteHandlerDef`/`QueryHandlerDef` and drop the cast. Casts that must stay for now can be frozen with `kumiko-guards guards --write-baseline --guard="As-Casts Audit"`.
affects: kumiko-guards
-->
