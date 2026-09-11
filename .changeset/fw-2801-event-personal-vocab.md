---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2801: `r.defineEvent(...).piiFields` gains the entity-field `personal` vocabulary as its canonical subject declaration: `{ <field>: { personal: { of: "<ownerField>" } } }`, matching `createTextField({ personal: { of: "<ownerField>" } } })` on entities.

The previous `{ <field>: { subjectField: "<ownerField>" } }` form still works unchanged — it is now a deprecated alias for the same declaration, not a separate code path. Both forms resolve through the same internal normalizer (`normalizeEventPiiSubject`, exported from `@cosmicdrift/kumiko-types/handlers`) and encrypt under the identical subject key, so mixing old and new declarations across events is safe.

Migration (optional, non-breaking): replace `{ subjectField: "authorId" }` with `{ personal: { of: "authorId" } }` in `piiFields` declarations at your convenience. Only a user subject is resolvable via this declaration today (fw#2801 step 1 of 3) — `"self"`/`"tenant"`/`"ref"` subjects on events land in a follow-up.
