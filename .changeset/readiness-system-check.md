---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Readiness gains live probe runs and a system-check screen. Features register probes with `r.probe`, an admin starts a run, and the screen shows the latest results and the run history. The renderer gains the building blocks the screen needs. The disable-MFA form now confirms success, and the profile can link to account security.

<!-- kumiko-changes
feature: framework
type: improvement
title: r.probe registers live readiness probes with a per-probe timeout
detail: A feature registers a probe with r.probe({ name, scope, cost, area, label, timeoutMs?, targets?, run }). scope "system" probes run only for SystemAdmins, "tenant" probes also for TenantAdmins of that tenant; cost "paid" probes run only when the caller asks for them. targets splits one probe into one result per target, such as one per mailbox. runWithTimeout from the api barrel is the shared timeout runner the readiness checks and probe runs use. The readiness status query still makes no network call.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: The boot validator checks enumOption tones
detail: A list column with renderer { format: "enumOption", tones } fails boot when a tone is not one of the select-option tones.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: i18nText format, enumOption tones, linkScreenField and live projectionDetail
detail: FormatSpec gains { format: "i18nText" } for values that are a server-built { i18nKey, i18nParams } or a plain i18n key. enumOption takes tones per option value. ListColumnSpec takes linkScreenField, the row field holding the screen QN the cell links to. ProjectionDetailScreenDefinition takes live.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Translated text cells, toned status pills, screen links in rows and live detail screens
detail: An i18nText cell renders the text in the user's language. An enumOption column with tones draws the translated label as a status pill. A column with linkScreenField links the cell to the screen the row names, but only when the user may open that screen. A projectionDetail with live: true refetches the record and its relatedList sections on entity events.
-->

<!-- kumiko-changes
feature: readiness
type: improvement
title: Probe runs and the system-check screen
detail: The new readiness:write:run-probes starts a run as a worker job; includePaid also runs paid probes. A run only writes its own probe-run events, the probes read through adapters and fixtures and never write domain data. New queries return the latest run with its summary, the run history with the starter's name, and one run with its results. Probe texts arrive as { i18nKey, i18nParams }, and failed rows carry the QN of the screen that fixes the problem; the boot validator checks that QN. createReadinessFeature({ nav: { order?, parent?, workspaces? } }) adds the system-check screen to the nav (workspace apps list the workspaces, a parent's membership does not carry over): start buttons (the paid one only when paid probes exist), the latest results with a fix link on failed rows, and the history that opens each run. Standard probes cover database, cache, search, mail sending, file storage, inbound mailboxes and the PDF service.
migration: New table read_readiness_probe_runs. Apps that mount readiness run `kumiko schema generate` and apply the migration before deploying. Without a nav option the screen stays dormant; pass createReadinessFeature({ nav: {} }) or a parent nav QN to show it.
-->

<!-- kumiko-changes
feature: mail-foundation
type: improvement
title: Mail-sending probe
detail: mail-foundation registers a probe that sends a short test mail through the tenant's mail transport to the user who started the check. The address is not stored in the result.
-->

<!-- kumiko-changes
feature: file-foundation
type: improvement
title: File-storage probe
detail: file-foundation registers a probe that writes, reads and deletes a probe object in the configured storage provider.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Inbound-mailbox probes
detail: inbound-mail-foundation registers a probe with one result per configured mailbox. A personal mailbox is probed only when its owner starts the run, and only its owner sees the result.
-->

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: PDF-service probe
detail: renderer-puppeteer-client registers a probe that calls the PDF service health check. probePuppeteerService and PuppeteerStatus are exported for it.
-->

<!-- kumiko-changes
feature: auth-mfa
type: fix
title: The disable-MFA form confirms success
detail: After a successful disable the auth-mfa-disable screen shows "Two-factor authentication is now turned off." and clears the spent code. Before, the form looked unchanged. New key mfa.disable.done in all locale packages.
-->

<!-- kumiko-changes
feature: user-profile
type: improvement
title: The profile can link to account security
detail: createUserProfileFeature({ linkAccountSecurity: true }) adds a header action that opens the account-security screen, which offers MFA enable or disable by the user's status. It requires the account-security feature; the default stays off. New key profile.mfa.open in all locale packages.
-->
