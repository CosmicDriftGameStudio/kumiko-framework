---
"@cosmicdrift/kumiko-framework": minor
---

`entityTableFromRegistry(registry, entityName, entity)` in `/db`: the table an entity actually lives in, as the booted registry sees it, falling back to `buildEntityTable` when no implicit projection registered one. Callers holding a registry and an entity but no executor — seeds, jobs, consumers reading a feature's read model — had to reimplement the projection lookup or write into a table the pipeline does not use.
