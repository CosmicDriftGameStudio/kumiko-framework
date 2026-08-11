---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

`redirect` (actionForm, entityEdit) and `cancelTarget` (actionForm) now also accept a fully-qualified cross-feature screen QN (`<feature>:screen:<id>`), in addition to the existing same-feature short screen-ID. Boot-validator resolves the QN directly against all registered screens; the renderer strips it to the short id before navigating, since the runtime router already resolves bare short ids app-wide. Short IDs keep their unchanged same-feature behavior (kumiko-framework#1946).
