---
"@cosmicdrift/kumiko-framework": patch
---

A jsonb field can now carry a `personal` annotation. The framework serializes the value to JSON, encrypts it under the subject key and stores the ciphertext as a JSON string in the column and the event payload; reads decrypt it back to the original object, array or scalar.

<!-- kumiko-changes
feature: framework
type: improvement
title: PII encryption for jsonb fields
detail: |
  `createJsonbField({ personal: "tenant" })` (or `"self"` / `{ of }`) is encrypted per subject like a text field, so crypto-shredding applies: after the key is erased, list and detail return `[[erased]]` for the field. The ciphertext uses the self-describing format `kumiko-pii:v3:` (v2 plus a JSON-typed plaintext, AAD-bound to subject and field), so a string, number or object round-trips by type. Existing plaintext objects, arrays and strings are read as-is and are not re-encrypted; they become ciphertext on the next write of the field, and the backfill skips jsonb fields. There is no search, filter, sort or index inside an encrypted jsonb field: boot rejects `personal` on a jsonb field that is in an entity index, has `sortable`, `filterable`, `searchable` or `lookupable`, or is the custom-fields `customFields` column. Event payload fields declared in `piiFields` may now be objects or arrays; they are encrypted in the same JSON format. Non-jsonb fields still require a string.
migration: |
  Runtimes before this release cannot read `kumiko-pii:v3:` ciphertext. Before annotating a jsonb field with `personal`, roll this version out to every instance, so a rolling deploy never has an old instance reading a value a new one wrote.
-->
