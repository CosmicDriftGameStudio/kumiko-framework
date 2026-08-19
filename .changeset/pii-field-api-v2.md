---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

PII field annotations collapse from twelve low-level flags (`pii`, `userOwned`, `tenantOwned`, `subjectRef`, `allowPlaintext`, `lookupable`, `searchable`, `sensitive`, `piiEncrypted`, ...) to two author-facing options: `personal` (whose data it is) and `find` (how it stays findable). No backward compatibility — the old flags are a type error now and every field definition must migrate.

Before:

```ts
email: createTextField({ required: true, pii: true, lookupable: true }),
body: createLongTextField({ userOwned: { ownerField: "authorId" } }),
```

After:

```ts
email: createTextField({ required: true, personal: "self", find: "exact" }),
body: createLongTextField({ personal: { of: "authorId" }, find: "none" }),
```

`personal` picks the erasure subject, and with it the key whose destruction shreds the value: `"self"` (the row's own subject), `{ of: "<fieldName>" }` (someone else's data, keyed by that field), `"tenant"`, `"ref"` for a plain foreign key to a subject stored elsewhere, or `false` with a required `reason` for a field that looks sensitive but deliberately is not PII.

`find` picks findability, and is mandatory on text fields once `personal` names a subject — forgetting it is what produced the drift this change removes:

- `"exact"` — equality lookup over an HMAC blind index (`<column>_bidx`)
- `"fuzzy"` — full-text search over the derived index, and equality on top
- `"none"` — encrypted, not queryable
- `"secret"` — never indexed, and stripped from the write-response echo. It is not a read gate: a detail query still returns the value, and who may see it remains `access: { read: [...] }`.

`longtext` takes only `"none" | "secret"` — it has no field-level search index.

`encrypted: true` is unchanged and orthogonal: an app-wide master key that stacks *on top of* a subject key (as `userMfa.totpSecret` does), not an alternative to it. `piiEncrypted` is gone from entity fields; config keys keep their own.

Fields that gain `"fuzzy"` where they previously had only `searchable` need a `_bidx` column — run `kumiko-schema generate` and let the projection rebuild backfill it. `scripts/codemod/pii-personal-migration.ts` migrates existing field definitions and reports anything it cannot map mechanically.
