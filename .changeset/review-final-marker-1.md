---
"@cosmicdrift/kumiko-renderer": patch
---

A renderer test fixture for denied secrets access types its config fields directly instead of casting them.

<!-- kumiko-changes
feature: renderer
type: improvement
title: secrets-denied test fixture without a cast
detail: The fixture's field map already fits the annotated ConfigEditScreenDefinition, so the cast and its marker are gone. No runtime change.
-->
