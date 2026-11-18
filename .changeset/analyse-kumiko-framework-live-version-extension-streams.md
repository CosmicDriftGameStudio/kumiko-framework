---
"@cosmicdrift/kumiko-framework": patch
---

A domain event on a stream that an entity projection takes in through `r.extendEntityProjection` now moves the row version on the live path too. Before, only a rebuild aligned the row with that stream, so the live row of a document extract stayed one version behind its replayed copy after the ready or failed event.
