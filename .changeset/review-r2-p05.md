---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes: the mailbox rename audit reason is derived from the caller role, inbound-mail seen-id lookups run in chunks, the tenant mail transport falls back to the app transport without tenant config, and renderTablePdf enforces the document size caps for direct callers.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Rename audit reason comes from the caller role
detail: update-account records tenant_admin or system_admin from the caller's roles and honors a client-supplied reason only for the system identity, so a form call can no longer write system reasons such as watch_supervisor. The rename form no longer carries a reason field and the reason payload field is optional.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Seen-message lookup handles listings of any size
detail: filterUnknownMessageIds queries the already seen provider message ids in chunks of 1000, so a full-mailbox listing no longer exceeds the Postgres bind parameter limit and aborts the account's poll.
-->

<!-- kumiko-changes
feature: mail-foundation
type: fix
title: Tenant mail transport falls back to the app transport without tenant config
detail: tenantMailTransport returns null when the channel context carries no tenant config, instead of throwing on every send, so the channel uses the app transport as documented.
-->

<!-- kumiko-changes
feature: renderer-pdf
type: fix
title: renderTablePdf validates the document for direct callers
detail: renderTablePdf parses the document against pdfTableDocumentSchema and throws RendererError invalid_payload above the row, column and cell caps. Title, subtitle, meta entries, headers, empty text, footer text and page label now have length caps and meta at most 500 entries.
-->

<!-- kumiko-changes
feature: host-routing
type: fix
title: Redirects documented as hostDispatch-only
detail: The redirects option and README state that redirects run inside hostDispatch, so only for requests that reach the HTML fallback; a from matching a static file or an API route never fires. The shared existence lookup of the host and resolver modes is one helper.
-->
