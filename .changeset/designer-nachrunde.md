---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Template designer follow-up: plain-language titles for the template-resolver write handlers, a Spanish waitlist admin notice, and layout fixes in the editor rails and the shell header.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Titles for the template-resolver write handlers
detail: Every agent-callable template-resolver write handler now has a title in de, en, es, fr and it, so the AI assistant names actions such as "Edit template draft" instead of "template-resolver:write:patch-draft". The handlers of mounted content collections (`<id>-set`) stay untitled because their names depend on the app. The empty-field hint of the placeholder line editor now ends in an ellipsis inside the field instead of running past it.
-->

<!-- kumiko-changes
feature: waitlist
type: improvement
title: Spanish admin notice for new waitlist entries
detail: The operator notice "new entry on the waitlist" now exists in Spanish, like the entrant's confirmation. It follows the locale of the request that created the entry and falls back to English.
-->

<!-- kumiko-changes
feature: document-designer
type: fix
title: Designer rails wrap instead of clipping
detail: A rail section wraps its action below the heading instead of clipping it, a resource name without spaces wraps inside its row instead of running under "Remove", the footer no longer offers a test mail when send-test-status says none can be sent, and the header label placeholder reads "e.g. Reminder" instead of an incident example.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Shell header: the parent crumb no longer slides under a long title
detail: The page title truncates on its own; the parent crumb stays whole and is left out when the space beside the header actions gets narrower than 20rem (a container query on the header's left side instead of the sm viewport breakpoint). The h1 carries the full title as tooltip.
-->
