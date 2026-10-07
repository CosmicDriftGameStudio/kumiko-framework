---
"@cosmicdrift/kumiko-framework": patch
---

`defineEvent` rejects `personal: { of: "id" }` in `piiFields` at boot

On entities `of: "id"` means record-owned, but on events it encrypted under a user key named after the payload id, which a forget never reaches, so crypto-shredding silently did nothing. Declare a record-owned event field with `personal: "self"` instead.

<!-- kumiko-changes
feature: framework
type: fix
title: Event piiFields reject owner field "id" instead of encrypting under a phantom user key
-->
