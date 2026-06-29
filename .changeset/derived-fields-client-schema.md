---
"@cosmicdrift/kumiko-framework": patch
---

Fix: `buildAppSchema` dropped `derivedFields` from the client AppSchema, so a declarative `entityList` with a derived column threw `computeListViewModel: references unknown field` at render (the column resolved server-side + boot-validated, but the browser had no derived-field metadata). `projectEntity` now projects `derivedFields` metadata (`valueType`, with the server-only `derive` fn stripped — stays JSON-safe). Regression test pins the buildAppSchema→client path that no test covered before.
