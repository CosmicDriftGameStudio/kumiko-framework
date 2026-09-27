---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-guards": minor
---

`createTextField`/`createLongTextField` accepted no options at all, or an options object with no `personal` key — every one of those silently shipped a text/longText field with no personal-data stance (kumiko-framework#2918 only warned about it at boot). `PersonalAnnotations`/`PersonalAnnotationsLongText` no longer include the "nothing declared" shape, so `overrides` is now a required parameter on both factories and must carry a `personal` stance; a runtime gate re-checks the same shape for untyped JS callers before the field is ever built. `PersonalAnnotationsNoFind` (every other field type) is unchanged — `personal` stays optional there.

<!-- kumiko-changes
feature: framework
type: breaking
title: createTextField/createLongTextField require an explicit personal-data stance
detail: |
  Both factories' `overrides` parameter is no longer optional and must
  include a `personal` stance:
  `{ personal: "self", find: "exact" | "fuzzy" | "none" | "secret" }`
  (longText: `find: "none" | "secret"`), `{ personal: "tenant", find: … }`,
  `{ personal: { of: "<ownerField>" }, find: … }`, `{ personal: "ref" }`, or
  `{ personal: false, reason: "<why this is not personal data>" }`. A
  missing/malformed shape throws at the call site (`createTextField(...)` /
  `createLongTextField(...)` in the message, with every valid option
  listed) instead of silently resolving to an unannotated field — this
  also removes the #2918 boot-time deprecation warning, since the shape it
  warned about can no longer be constructed.
migration: |
  Two call forms now throw: `createTextField()` / `createLongTextField()`
  with no argument at all, and an options object with no `personal` key,
  e.g. `createTextField({ required: true })`. Add a stance to every call:

    createTextField({ personal: "self", find: "exact" })
    createTextField({ personal: "tenant", find: "none" })
    createTextField({ personal: { of: "authorId" }, find: "none" })
    createTextField({ personal: "ref" })
    createTextField({ personal: false, reason: "is_business_data" })

  `personal: false` additionally requires a non-empty `reason` string.
  `find` is mandatory whenever `personal` names a subject (`"self"` /
  `"tenant"` / `{ of }`) — not for `"ref"` or `false`. The #2918 boot-time
  deprecation warning for this shape is gone; there's nothing left for it
  to warn about.

  To find remaining call sites (the #2919 codemod mode below is the
  migration tool): `kumiko-guards guards
  --guard="Text-Field Personal-Stance Guard"` flags every
  statically-decidable call missing a stance. `bun
  node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/pii-personal-migration.ts
  <targetDir> --report-stance` classifies unannotated text/longText fields
  by name heuristic (direct/user-owned/user-reference/near-miss/
  unclassified) to help pick the right stance — it does not add one
  automatically, since a wrong guess would be worse than the throw. This
  codemod is not wired into `kumiko upgrade --apply`; run it by hand. It
  also only transforms fields still carrying the OLD flag-based API
  (`pii`/`userOwned`/`tenantOwned`/`subjectRef`/`allowPlaintext`) — a field
  with no annotation at all was never in its mapping table and needs a
  stance added by hand either way.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: Text-Field Personal-Stance Guard exempts the two framework tests that assert the throw
detail: |
  `guard-text-field-stance.ts` now skips an explicit, exact
  repo-relative-path allowlist
  (`packages/framework/src/engine/__tests__/factories-long-text.test.ts`,
  `packages/framework/src/engine/__tests__/factories-personal.test.ts`) —
  these two deliberately call `createTextField`/`createLongTextField`
  without a stance to prove the fail-closed throw. A different file
  sharing one of those basenames is not exempt; the match is on the exact
  repo-relative path. The guard also scans `samples/**` and `demo/**`
  now, not only `packages/*/src/**`. The baseline
  (`.kumiko-text-field-stance-baseline.json`) drops to 0.
-->
