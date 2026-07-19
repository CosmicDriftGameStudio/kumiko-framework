---
"@cosmicdrift/kumiko-framework": patch
---

Fix `buildAppSchema` dropping the field-level `searchable` flag, which silently disabled the documented EntityList search-toolbar default for any screen not setting `screen.searchable` explicitly.
