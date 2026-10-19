---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Template designer follow-up: plain-language titles for the template-resolver write handlers, a Spanish waitlist admin notice, a capabilities query that lets the designer hide upload and test-mail actions an app cannot carry out, and layout fixes in the editor rails and the shell header.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Titles for the template-resolver write handlers and an editor-capabilities query
detail: Every agent-callable template-resolver write handler now has a title in de, en, es, fr and it, so the AI assistant names actions such as "Edit template draft" instead of "template-resolver:write:patch-draft". The handlers of mounted content collections (`<id>-set`) stay untitled because their names depend on the app. The new query `template-resolver:query:editor-capabilities` (TenantAdmin, SystemAdmin) returns `{ fileUploads, testMail }`: fileUploads is true when file storage is wired, testMail when an email channel is mounted and resolves the caller's own address. It returns booleans only, never the address. The empty-field hint of the placeholder line editor now ends in an ellipsis inside the field instead of running past it.
-->

<!-- kumiko-changes
feature: waitlist
type: improvement
title: Spanish admin notice for new waitlist entries
detail: The operator notice "new entry on the waitlist" now exists in Spanish, like the entrant's confirmation. It follows the locale of the request that created the entry and falls back to English.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: The designer hides uploads and test mails an app cannot carry out
detail: Without file storage the mail and PDF editors show one sentence instead of the upload actions; without mail delivery or an address on the account the preview shows one sentence instead of the test-mail form, and the footer no longer offers a test mail. Both are read from `template-resolver:query:editor-capabilities`; while it loads the actions stay visible. A rail section wraps its action below the heading instead of clipping it, a resource name without spaces wraps inside its row instead of running under "Remove", and the header label placeholder reads "e.g. Reminder" instead of an incident example.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Shell header: the parent crumb no longer slides under a long title
detail: The page title truncates on its own; the parent crumb stays whole and is left out when the space beside the header actions gets narrower than 20rem (a container query on the header's left side instead of the sm viewport breakpoint). The h1 carries the full title as tooltip.
-->
