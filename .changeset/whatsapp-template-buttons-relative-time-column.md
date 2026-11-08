---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

WhatsApp templates can carry quick-reply payloads and a header image, and table columns can show a timestamp as relative time.

<!-- kumiko-changes
feature: channel-whatsapp
type: improvement
title: WhatsApp sendTemplate takes quickReplyPayloads and headerImageLink
detail: quickReplyPayloads (1 to 10 entries, each non-empty and at most 256 characters) adds one quick-reply button component per entry, so a tap comes back with that payload. headerImageLink (https only) adds an image header. Components are sent as header, body, buttons; without the new fields the request is unchanged.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Column format relativeTime
detail: A list column with renderer { format: "relativeTime" } shows an ISO timestamp or epoch ms as "5 minutes ago" in the user locale. The text is computed at render time and does not tick.
-->
