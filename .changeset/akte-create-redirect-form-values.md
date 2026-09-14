---
"@cosmicdrift/kumiko-renderer": patch
---

An `entityEdit` create screen's object-form `redirect` now falls back to the values submitted to the write handler when resolving `idFrom`, matching the update path's fallback to the loaded record. Previously a create's success payload nests the new record under `data` rather than exposing a parent FK flatly, so redirecting to a parent detail screen after creating a child record navigated there without an id.
