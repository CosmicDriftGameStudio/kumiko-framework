---
"@cosmicdrift/kumiko-framework": patch
---

Fix `populateTranslations()` double-prefixing translation keys that already
carry the feature's own namespace prefix (e.g. a nav label referencing
`"cap-counter:nav.cap-list"` verbatim). Previously every key was
unconditionally prefixed with `${feature.name}:`, so an already-qualified
key ended up double-prefixed in `registry.getAllTranslations()` and could
never be resolved by server-side `t()`.
