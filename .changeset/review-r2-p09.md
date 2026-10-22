---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-renderer": patch
---

Review fixes: the waitlist legacy migration dry run reports the streams it would archive, the document designer keeps keyboard focus order across its rails, shares its mail layout constants and tenant currency lookup with the server and renderer, drops stale picked preview values, and reads singular tenant counts correctly.

<!-- kumiko-changes
feature: waitlist
type: fix
title: Legacy migration dry run counts the streams it would archive
detail: The dry run now runs the read-only archive checks and reports archivedStreams without writing; the CLI prints "would archive" for it.
-->

<!-- kumiko-changes
feature: document-designer
type: fix
title: Editor rails keep a logical focus order
detail: The right rail follows the center in the DOM and moves below the left rail by grid placement in narrow layouts, so keyboard and screen reader order matches the visual order.
-->

<!-- kumiko-changes
feature: document-designer
type: fix
title: Picked preview values are filtered to declared variables
detail: A picked record value for a variable the template does not declare no longer travels into the preview or test mail, which the server rejected as an unknown variable.
-->

<!-- kumiko-changes
feature: document-designer
type: fix
title: Singular tenant counts in the override texts
detail: The override summary and the system origin bar use plural forms, so one customising tenant reads "1 tenant has its own version" in en, de and es.
-->

<!-- kumiko-changes
feature: template-resolver
type: chore
title: Mail layout enums and hex color pattern are exported client-side
detail: The layout editor imports the width, font, accent line and button style lists plus the hex pattern from the template-resolver web barrel instead of keeping copies, so editor and server validation cannot drift.
-->

<!-- kumiko-changes
feature: renderer
type: feature
title: useTenantCurrency hook
detail: The tenant currency resolution of the entity edit prefill is exported as a hook with an explicit fallback for errors and missing values and no query when no currency is needed; the mail preview uses it only for templates with a money variable.
-->
