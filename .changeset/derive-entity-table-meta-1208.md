---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Rename `buildEntityTableMeta` → `deriveEntityTableMeta` so the helper is not mistaken for the unmanaged escape hatch (`defineUnmanagedTable`). Deprecated alias kept. Unmanaged builders now reject the reserved `read_` table-name prefix (#1208/#1220).
