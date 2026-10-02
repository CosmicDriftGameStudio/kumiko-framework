---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A projectionDetail screen with a header card (headerRegion with metrics or header actions) on a full-height screen form without tabs now defaults to a `4xl` column instead of 640px, and the metric band lines up with the form column instead of carrying its own padding. An explicit `layout.width` still wins. Explicit screen form widths (`3xl`, `4xl`, `full`) now left-align with the form column instead of centering, which moves screens such as the showcase item edit. Typing into a password input that shows a clear or undo action no longer remounts the input and drops focus after the first character.

The secretMint reveal phase with a confirm step renders as one screen form. The reveal block (title, warning, secret) leads the confirm form through the new `RenderEdit` prop `leadContent`, and the confirm form no longer sits in a second card. The `kumiko-screen-secret-mint-card` test id now marks only that reveal block. The confirm step shows the parent screen's translated title (new `RenderEdit` prop `i18nScreenId`) instead of the raw key `<screen>:confirm`.

Text config keys stored encrypted at rest (`encrypted: true` or `backing: "secrets"`, such as the Stripe API key and webhook secret) are write-only on generated settings screens. The field shows whether this scope stores a value, keeps it unless a new one is typed, and resets it when cleared. Hand-written configEdit text fields over such keys become write-only as well, and form drafts never store write-only fields. `config:write:set` answers with the mask for these keys, and pattern, select option and extension validation errors no longer return the value. A hand-written configEdit screen may declare `writeOnly` only on a field whose key is encrypted at rest; other keys fail at boot.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Header-card detail screens default to a 4xl column; metric band aligns with the form column; explicit screen form widths left-align; password input keeps focus
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: secretMint reveal and confirm render as one screen form with the translated screen title; new RenderEdit props leadContent and i18nScreenId
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Encrypted-at-rest text config keys derive writeOnly settings fields; boot validator allows writeOnly on configEdit only for those keys
-->

<!-- kumiko-changes
feature: config
type: breaking
title: config:write:set masks the echoed value for encrypted-at-rest keys; validation errors no longer include the value
migration: |
  A caller that reads `data.value` from a `config:write:set` result for a key with `encrypted: true` or `backing: "secrets"` now gets the mask. Use the value it sent instead. Tests that match the `value` param of a validation error on such a key need to drop that expectation.
-->
