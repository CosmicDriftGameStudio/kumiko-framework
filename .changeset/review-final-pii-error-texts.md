---
"@cosmicdrift/kumiko-bundled-features": patch
---

Delivery jobs, the retention file cleanup and the tier sync no longer put adapter or storage error texts and storage keys into logs or error results.

<!-- kumiko-changes
feature: bundled-features
type: fix
title: Adapter error texts and storage keys stay out of logs and run rows
detail: `redactErrorText` strips only emails, URLs and bot tokens, not names, phone numbers or storage keys. `delivery.send` and `delivery.render` now log the error class and an optional string code instead of the adapter text. The `data-retention` hard-delete file cleanup logs the error class and a failed-file count instead of storage keys and storage error texts. `subscription-tier-sync` reports `tier sync threw <class>` and `afterSync threw <class>` instead of the thrown message, so the `InternalError` text and the webhook warn log carry no adapter text either. A new `errorKindOf` helper in `shared` builds the class and code text.
-->
