---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Screens out of one mould: actionForm result figures, month field, multi-reference links, mailbox screens, document time zone and smaller list, form and GDPR fixes

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm shows key figures from the handler's success payload
detail: ActionFormScreenDefinition gets successFacts, a list of { field, label } entries read from the success payload and shown in the success box next to successLinks while the screen stays put. A number or string is one value, an array a comma-separated list of numbers, strings or { label } objects, a missing field is hidden. Mutually exclusive with redirect (boot validator). Default behaviour is unchanged.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: A text field with format month renders a native month input
detail: createTextField({ format: "month" }) renders <input type="month"> and carries YYYY-MM. The schema builder validates the pattern server-side (an empty string is accepted for optional fields). New InputProps kind "month" for custom Input primitives.
migration: Only custom CorePrimitives.Input implementations with an exhaustive switch over kind need a "month" branch; a text fallback is fine.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Array reference fields render as links in lists
detail: A reference column over an array field renders one link per entry, labelled from the eagerloaded record or the label lookup, like single references. New CellLinkItem and RuntimeCellLinkItems exports from the headless view model; DataTableCell accepts linkItems.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: List empty state, sidebar rail cursor, toolbar description spacing and root form errors
detail: The empty list no longer shows a second Create button when Create is already in the page header. The sidebar rail edge, which only toggles open and closed, shows a pointer cursor instead of a resize cursor. toolbarDescription always gets the standard bottom spacing, not only with fillsHeight. A server error without a field reference (path "(root)") shows once in the form banner instead of also at a field.
-->

<!-- kumiko-changes
feature: renderer-mail-html
type: improvement
title: Document dates can print the time in the tenant time zone
detail: The date helper accepts time=true ({{date value time=true}}). Instants print date and time in the tenant's configured IANA zone (tenant timezone config, UTC without one), offset date-times keep their own wall clock, date-only values print no time. Without time=true nothing changes. formatDocumentDate takes an optional { time, timeZone } argument, DocumentFormat gets timeZone, and TENANT_TIMEZONE_CONFIG_KEY is exported from framework/pipeline.
-->

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: tenantName in the document context falls back to the tenant record
detail: Without managed-pages there is no branding title, so tenantName was empty. It now falls back to the decrypted name of the tenant record when the tenant feature is mounted.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: seedSystemTemplateBundle sets a title per template
detail: Bundle locale entries accept an optional title, written to the template resource and exported again by the bundle export. SeedSystemTemplateOptions gets title. The template overview shows it instead of the slug.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Declarative mailbox list and rename screens
detail: The feature registers the projectionList mail-accounts (name, address, provider, status, connected; row actions rename and disconnect) and the actionForm mail-account-edit, both restricted to SystemAdmin and TenantAdmin like the handlers. The list shows several mailboxes per tenant, never a credential. Screens are dormant, so the app places the list in its own nav. MAIL_ACCOUNT_LIST_SCREEN_ID and MAIL_ACCOUNT_EDIT_SCREEN_ID are exported.
migration: Place mail-accounts in the app nav with r.nav; no other change.
-->

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: Forgetting a user also removes their unbound pending uploads
detail: forget-subject for a user deleted only files bound to a record. Uploads the user made but never attached (file refs without an entity id) stayed behind. They are now removed with their bytes, except refs a record still names in a single-file column.
-->
