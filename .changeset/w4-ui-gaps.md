---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
---

Four UI gaps from wave 3: an actionForm can load a singleton row, the dashboard text block gets a role-gated link, seeded PDF templates can carry an i18n title key, and the template overview shows locked tenant overrides.

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm loads a singleton row without a record id
detail: load.singleton: true on an actionForm sends the load query without idParam and prefills the form from the tenant's single row, like projectionDetail. A route id is never forwarded. The boot validator rejects singleton together with idParam.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Dashboard text block link shown only to given roles
detail: A text block of kind link ({ text, screen, roles? }) renders a link to a screen and is hidden unless the user holds one of the roles. This only gates the display; the target screen still checks access on the server. The boot validator rejects an unknown target screen and an empty roles list.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: seedSystemTemplate accepts titleI18nKey
detail: A seeded template can store an i18n key as its title (titleI18nKey, exclusive with title). The overview returns the key; the document-designer overview, mail editor and PDF link modal translate it and fall back to the raw text. Templates without a key behave as before; no migration.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Template overview shows locked tenant overrides
detail: Rows with lockedOverride and lockedOverrideI18nKey show the status text as a warning badge in the status column. The row action "Remove own version" calls the existing resetToSystem with the new overview field lockedOverrideId (the tenant row; one locale per click). The status shows a short label with the long sentence as tooltip.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: DataTable no longer hides its last column under the sticky actions column
detail: Header and text cells wrap instead of staying on one line (badges, dates and row actions keep their own nowrap), and a row-action group wraps when the column is narrow. A table whose cells could not shrink scrolled sideways without a visible scrollbar and its last column slid under the sticky actions column. Long values now wrap (up to max-w-xs per column) instead of being cut with an ellipsis.
-->
