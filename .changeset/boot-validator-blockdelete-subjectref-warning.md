---
"@cosmicdrift/kumiko-framework": patch
---

The `pii-retention` boot-validator's `blockDelete`-without-`anonymize` warning no longer fires for entities whose only subject binding is a `subjectRef` field (`personal: "ref"`). This narrows the behavior added in #1645: the `personal: "ref"` variant of `PersonalAnnotations` structurally forbids an `anonymize` property, so the warning could never be silenced through the type-sanctioned field API — it was an unactionable false positive. `subjectRef`-only entities rely on the `EXT_USER_DATA` extension hook for Art.17 erasure instead of a per-field `anonymize` function. Entities with a `pii`/`userOwned`/`tenantOwned` subject field still get the warning as before.
