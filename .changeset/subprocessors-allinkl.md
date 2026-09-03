---
"@cosmicdrift/kumiko-framework": patch
---

`KUMIKO_SUB_PROCESSORS` was out of date in three ways, and the list is served publicly under `/api/compliance/sub-processors` as the GDPR Art. 28 sub-processor disclosure — so a stale entry is a compliance defect, not a cosmetic one.

Mailbox.org (Heinlein Hosting) is removed: it is no longer used, and the `Marketing Email Delivery` purpose it carried has always been Brevo's. Mailbox hosting moved to ALL-INKL.COM, which is added as an active sub-processor covering the support and contact mailboxes.

Anthropic and Stripe move from `planned` to `active` — both are in production use, and listing an active US sub-processor as merely planned understates the actual third-country transfer.

Note for consumers reading the endpoint: the `planned` section is now empty. It remains part of the response shape.
