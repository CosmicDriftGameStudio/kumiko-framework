---
"@cosmicdrift/kumiko-framework": patch
---

Fix `TypeError: Cannot use valueOf` on create/upsert of any entity whose schema
declares a field named `source` (or `columns` / `tableName` / `indexes` — any
`EntityTableMeta` key).

`table()` spreads the column handles as enumerable props over the
`EntityTableMeta`, so such a field overwrote the `source: "managed" |
"unmanaged"` discriminator. `extractTableInfo` then failed its meta check and
fell into the legacy drizzle-introspection branch, which typed timestamptz
columns via `getSQLType()` as `"timestamp with time zone"` instead of
`"timestamptz"`. The bun-db serializer only coerces `Temporal.Instant → ISO`
for `"timestamptz"`, so a raw `Temporal.Instant` reached postgres → the crash,
on every create of such an entity (e.g. pattern-storage's `pattern-file`, which
has a `source` field).

The table builder now stores the canonical meta under a dedicated, unshadowable
symbol; `extractTableInfo` reads the meta from it and the dead
drizzle-introspection branch is removed. The two internal call sites that relied
on the legacy branch — `clearTables`-by-name and a couple of test fixtures — now
build a real `EntityTableMeta`.
