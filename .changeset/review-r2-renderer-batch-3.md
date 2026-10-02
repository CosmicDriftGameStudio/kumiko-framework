---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Renderer review fixes. Deleting a secret on a secretsEdit screen now asks for confirmation first (new `config.secrets.deleteConfirm` key) and the delete button is disabled while a save or delete is running. The multiSelect checkbox group is exposed as a labelled group (`GridProps.ariaLabelledBy`). The inline reference-create dialog seeds `currency: { kind: "tenant" }` money fields from the tenant currency. Fields declared only inside a section `groups` entry now get their `visible`/`readOnly`/`required` conditions registered. `onChange`'s `valid` ignores issues on hidden fields and outside the `fields` scope, like submit does (shared `relevantFieldIssues` helper). Copy-link in the form footer keeps a 44px touch target on narrow viewports. A free-text sibling-field number unit longer than 8 characters is no longer rendered as a suffix.

<!-- kumiko-changes
feature: renderer
type: fix
title: Secret delete confirmation, grouped-field conditions, scoped valid flag, tenant currency in reference-create dialog
-->

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Labelled multiSelect checkbox group, mobile touch target for secondary form actions, bounded number unit suffix
-->
