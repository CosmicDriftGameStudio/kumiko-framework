---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

A `money` field on an entity-less form screen must declare its currency source (fw#2839)

`actionForm` and `secretMint` have no entity, so their money fields never received `entity.defaultCurrency`: an untouched one seeded a bare `0` that the handler's zod schema then rejected on submit. fw#2763 closed the prefill half of this; the default half stayed open. `MoneyCurrencySource` gains `{ kind: "literal", code }` next to the existing `{ kind: "tenant" }`, and the field maps of `actionForm`, `secretMint` and its `confirm` step are narrowed so a money field there requires `currency` — enforced by the compiler at bump time and by the boot validator for untyped callers. A literal code is checked against the app's `currencies` list, the same rule `entity.defaultCurrency` already follows. Entity fields, embedded-list money cells and `configEdit`'s plain-number contract are unchanged.

<!-- kumiko-changes
feature: framework
type: breaking
title: money fields on actionForm/secretMint screens declare their currency source (fw#2839)
migration: |
  Only affects entity-less form screens — `actionForm`, `secretMint` and a
  secretMint's `confirm` step — that hold a `money` field. Entity money fields
  are unchanged (`entity.defaultCurrency` is already boot-enforced for them),
  as are embedded-list money cells (currency at the head, fw#2764) and
  `configEdit`, which keeps its plain-number contract.

  Add a `currency` to each money field in such a screen's `fields` map:

      currency: { kind: "literal", code: "EUR" }   // one fixed currency
      currency: { kind: "tenant" }                 // the tenant's own currency

  A `literal` code must be in the app's `currencies` list (`createApp({ currencies })`,
  which already includes the defaults). A `tenant`-declared field resolves through
  the tenant-settings bundle and holds the form until the value has landed, so that
  bundle has to be mounted. Missing declarations fail at compile time; an untyped
  caller fails at boot with the screen and field name in the message.
-->
