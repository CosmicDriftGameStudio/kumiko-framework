---
"@cosmicdrift/kumiko-bundled-features": patch
---

Helpdesk requests stored before the rename from contact are now included in a user's data export and erased with the user.

<!-- kumiko-changes
feature: helpdesk
type: fix
title: pre-rename contact requests are exported and erased with the user
detail: Since the rename from contact to helpdesk, requests and replies stored under the aggregates `contact-request` and `contact-reply` (tables `read_contact_requests`, `read_contact_replies`, attachments with that entity type) sat inert; the EXT_USER_DATA hooks only covered `helpdesk-*`, so a user's export missed them and an erasure left the personal data behind. The helpdesk feature now registers export and delete hooks for the former aggregate, matching by reporter user id or verified email like the current hooks. Deleting forgets the rows through the event-store executor, removes their attachments and shreds the record subject keys. The former entities are not registered, so no schema is generated for them, and installs without former data skip the hooks. The data-retention job does not see these rows, since it only walks registered entities.
-->
