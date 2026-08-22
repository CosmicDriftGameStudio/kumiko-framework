---
"@cosmicdrift/kumiko-framework": patch
---

Pin `html-to-text@10.0.1` (via resolutions + Bun overrides) instead of forcing `deepmerge-ts` alone. `mailparser` still declares `html-to-text@10.0.0` which pulls vulnerable `deepmerge-ts@^7`; 10.0.1 already depends on `deepmerge-ts@^8`.
