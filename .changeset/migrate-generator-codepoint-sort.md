---
"@cosmicdrift/kumiko-framework": patch
---

migrate-generator: locale-independent table sort, shared `compareByCodepoint` (#367, follow-up to #330)

`snapshotFromMetas` sorted tables with `String.localeCompare`, whose order
depends on the runner's ICU locale. The snapshot is serialized to byte-exact
JSON and the order carries into the generated migration SQL, so the committed
bytes could drift between a macOS dev box and Linux CI — worse than the manifest
case (#330) because migrations are diffed and replayed. It now uses a codepoint
comparator, extracted to `utils/compareByCodepoint` and shared by feature-manifest
(#330's file-local copy removed) and collect-table-metas (an in-process equality
key, switched for consistency). A regression test feeds mixed-case table names
and asserts codepoint order. Byte-identical for all current artifacts (table
names are lowercase snake_case, for which codepoint and locale order agree).
