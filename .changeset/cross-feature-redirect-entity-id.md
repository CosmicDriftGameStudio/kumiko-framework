---
"@cosmicdrift/kumiko-renderer": patch
---

Fix actionForm redirects that cross a feature boundary silently dropping the created record's `entityId`. The redirect target is now resolved across all mounted features (not just the current feature's own schema), so a qualified-name redirect into another feature's `entityEdit`/`projectionDetail` screen carries the id like a same-feature redirect always did.
