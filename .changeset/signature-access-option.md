---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createSignatureFeature` takes an `access` option for apps that do not hand out `TenantMember`.

<!-- kumiko-changes
feature: signature
type: improvement
title: Access rule option for the signature feature
detail: `createSignatureFeature({ ..., access })` replaces the default `{ roles: ["TenantAdmin", "TenantMember"] }` on the signed-in handlers, queries, screens and nav, like `createLedgerFeature({ access })`. Without it, nested `ctx.dispatch` calls fail for users that only hold an app-specific role.
-->
