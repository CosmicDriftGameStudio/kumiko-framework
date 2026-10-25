# @cosmicdrift/kumiko-locale-es

## 0.392.1

### Patch Changes

- 51fc72c: The "Connect mailbox" form has a required SMTP port field, preset to 587. New mailboxes send over 587 with STARTTLS instead of a fixed port 465, because many hosters (for example Hetzner) block outgoing 465.
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: fix
  title: Mailboxes connect and send over SMTP port 587 with STARTTLS
  detail: The connect form gets a required field "SMTP port", preset to 587, and stores it as smtpPort in the credential document (the schema still accepts any stored port, default now 587). Port 465 uses implicit TLS; every other port uses STARTTLS with requireTLS, so the password is never sent in clear text and the connection fails when the server offers no STARTTLS. The certificate is checked against the host name on the STARTTLS upgrade as well. The SMTP failure texts name the entered port. New key for the field label in all locale packages.
  -->
- @cosmicdrift/kumiko-framework@0.392.1

## 0.392.0

### Patch Changes

- 3cfb343: Closes four gaps in plain framework screens. The projectionDetail header badge shows the translated status, the shell title follows the active workspace, cap-overview formats amounts by unit and says "Not included" for a limit of 0, and admin-shell can drop its tenant overview.
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: RecordHeaderSpec takes statusFormat
  detail: header.statusFormat is a FormatSpec for the header badge text, typically enumOption with a keyPrefix. The badge tone still resolves on the raw status value.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: The projectionDetail header badge shows the translated status
  detail: The header badge formats its text with header.statusFormat. Without it, the badge reuses the layout renderer of the status field when that is enumOption or i18nText, so header and body show the same text. Without either, the raw value is shown as before. The tone keeps resolving on the raw value.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: The shell header title follows the active workspace
  detail: When two navs point at the same screen, the breadcrumb now takes the label of the nav the sidebar shows for the active workspace. Before, the first nav in the app won, so the title could differ from the sidebar entry. Without a matching nav in the workspace, the old lookup applies.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The boot validator checks header.statusFormat
  detail: A projectionDetail screen with header.statusFormat but without header.status fails boot, because there is no badge to format.
  -->
  
  <!-- kumiko-changes
  feature: cap-overview
  type: improvement
  title: Cap amounts follow their unit and a limit of 0 reads "Not included"
  detail: Values with unit "mb" show as MB, GB or TB (base 1024), count and tokens use the locale's digit grouping. A limit of 0 or less shows "Not included" instead of a 0 bar, also when nothing is measured. caps:usage rows and the tenant-caps list cells now carry the unit of the cap. New key cap-overview.notIncluded in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: includeTenantOverview turns the tenant overview off
  detail: createAdminShellFeature({ includeTenantOverview: false }) registers neither the tenant overview screen nor its nav and leaves it out of the tenant workspace. The default stays true.
  -->
- 3d7f455: The paid system check run gets its own button next to "Start check", the mail probe tests the platform sender when a tenant has no own mail provider, and tenant admins can connect an IMAP mailbox from the mail account list, which can then also send replies from its own address.
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: projectionDetail takes inlineActions
  detail: ProjectionDetailScreenDefinition.inlineActions lists action ids that stay visible buttons next to the primary action in the page header instead of folding into the "More actions" menu. Without it the header behaves as before. The phone header keeps its single icon button.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The boot check validates inlineActions
  detail: Every id in a projectionDetail inlineActions list must name a declared action (or edit when the screen has an edit target), the same rule as primaryAction; an unknown id fails the boot.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: The detail header keeps inlineActions as buttons
  detail: HeaderActionsBar takes inlineActionIds and renders those actions as buttons after the primary action; only the remaining actions go into the overflow menu, and no menu is shown when none remain.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The paid run is a button next to Start check
  detail: The system check screen declares run-paid-check as an inline action, so "Test AI extraction" shows as a button beside "Start check" instead of in the "More actions" menu. It stays hidden while the app has no paid probes.
  -->
  
  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: channel-email publishes its app transport
  detail: channel-email declares the emailAppTransport extension and registers its app transport under it; findEmailAppTransport(registry) returns that transport, or null when the app has none or does not mount channel-email.
  -->
  
  <!-- kumiko-changes
  feature: mail-foundation
  type: improvement
  title: The mail probe tests the platform sender
  detail: A tenant without its own mail provider now gets the test mail through the channel-email app transport, the sender its tenant-transport notifications fall back to. The probe reports mail-foundation.probe.send-test-mail.platform-accepted on success and mail-foundation.probe.platform-send-rejected when the platform server rejects it; it is skipped only when neither an own provider nor an app transport exists, and mail-foundation.probe.not-configured now reads "No email sending set up". New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: The mail account list links to the IMAP connect form
  detail: mailAccountListScreen gets a "Connect mailbox" toolbar action that opens the screen mail-account-connect-imap. The button shows only when the app mounts inbound-provider-imap, which registers that screen. The Systemcheck fix link for inbound mail now leads to a list where a mailbox can be added.
  -->
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: improvement
  title: IMAP mailboxes can be connected from a form
  detail: The new write handler inbound-provider-imap:write:connect-mailbox (TenantAdmin, SystemAdmin, not exposed to the agent, 10 calls per tenant in 10 minutes) checks the IMAP login before the transaction, then creates a shared mail account and stores host, port, user and password in its credential secret in the same transaction. It always connects with implicit TLS (default port 993); there is no plaintext option, and a secure:false in the payload is ignored. A failed check stores nothing and answers with one of four texts: host not reachable or not allowed, login rejected, TLS failed, no connection. The form screen mail-account-connect-imap has a masked password field and no TLS toggle. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Apps can send from a connected mailbox
  detail: The provider contract gets an optional send(ctx, account, message). The new server function sendMailFromAccount(ctx, { accountId, message }) is called from an app's own write handler and sends through the provider of the mailbox, with the mailbox address as From and In-Reply-To and References for replies. It returns WriteResult<{ messageIdHeader }>; failures are typed UnprocessableErrors with the reasons mail_send_not_configured, mail_send_login_rejected, mail_send_server_unreachable, mail_send_rejected and mail_send_invalid_message (i18n keys inboundMail.send.errors.*). A missing, disconnected or someone else's personal mailbox answers not found. There is no fallback to the app sender. New exports: sendMailFromAccount, MAIL_SEND_ERRORS, outboundMailMessageSchema, OutboundMailMessage, OutboundMailSent, MailSendNotConfiguredError, MailSendRejectedError. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: improvement
  title: IMAP mailboxes send over their own SMTP server
  detail: The connect form gets an optional field "Outgoing server (SMTP)". Left empty, the IMAP host is used, with smtp. in place of a leading imap.. connect-mailbox now also checks the SMTP login on port 465 (implicit TLS, same user and password, same host guard) and answers a failure with its own text ("Receiving works, but sending does not: ..."). The credential document gains smtpHost and smtpPort (default 465). The provider implements send: it sends over SMTP with From = the mailbox address and display name, then stores the same message in the sent folder (special use \Sent, else Sent, Gesendet or INBOX.Sent); a failed copy is only logged. Accounts stored without smtpHost answer mail_send_not_configured. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: foundation-shared
  type: improvement
  title: sanitizeMailDisplayName is shared
  detail: The display-name sanitizer from channel-email moved to foundation-shared as sanitizeMailDisplayName, so the IMAP sender uses the same rule. No behavior change.
  -->
- c22ca75: Follow-ups to the system check. ProbeTextKeys is part of the readiness entry, the paid hint names the button, the search probe has its own failure text, and the latest run says why it is empty.
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The readiness entry exports ProbeTextKeys
  detail: ProbeTextKeys comes from @cosmicdrift/kumiko-bundled-features/readiness next to ReadinessQueries and ReadinessWrites, so apps can name probe texts without a deep import.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The paid probe hint names the button
  detail: readiness.probe.paid-not-requested now reads "Only via “Test AI extraction”" (de „Nur über „KI-Auslesen testen““), the label of the button that starts the paid run.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The search probe fails with its own text
  detail: When the search service throws, the search probe fails with readiness.probe.search.unavailable ("The search service does not answer"). The raw error can name the search host, so it goes only to the server log. New key in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: An empty latest run says why it is empty
  detail: The latest results and the run detail show "The check is running. Results appear when it is done." while a run is running and "There is nothing to check for this tenant." when a finished run has no rows the caller may see, and "The run was stopped before it returned results." for an abandoned run. Without a run the old text stays. New keys readiness.screen.latest.running, readiness.screen.latest.nothing-to-check and readiness.screen.latest.abandoned in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: relatedList emptyState takes variants
  detail: EditRelatedListSection.emptyState is a RelatedListEmptyStateSpec. Its optional variants list pairs a FieldCondition on the parent record with a title and description; the first matching variant replaces the default text, the action stays.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: The relatedList empty state follows the parent record
  detail: RelatedListSection evaluates emptyState.variants against the parent record and shows the first matching text. The headless view model translates the variant texts.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The i18n boot check covers emptyState variants
  detail: Title and description keys of relatedList emptyState variants count as required surface keys, so a missing translation fails the boot check.
  -->
- 05c9bef: Closes gaps in declarative screens. A drawer-hosted actionForm follows its `redirect`, `useQuery({ live: true })` listens on the handler's `liveEntities`, relatedList drawer and writeHandler toolbar actions take `params` from the parent record, a projectionDetail `visibleWhen` can pass the route id to its query, and option tones gain `critical` and `accent`. Custom dashboard panels accept static `params`, and the cap-overview CapCardsPanel uses them to limit its cards via `capKeys`, with a remaining-amount line per card and a link to the full usage screen. The locale packages add the new card strings.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: A drawer-hosted actionForm follows its redirect
  detail: After a successful submit the drawer closes, the host refetches, and a declared redirect then navigates like on the full page, without returnTo. A redirect that points at the screen the drawer sits on (no record id, no tab) does not navigate, so filters and scroll position stay. Behavior change: before, a drawer ignored redirect.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Live queries follow the handler's liveEntities
  detail: useQuery({ live: true }) and InfinityList refetch on signals for the entity in the query name and for every entity the query handler declares in liveEntities, in both the declared and the kebab-case form. The app schema carries them per feature as queryLiveEntities, and a tenant feature toggle strips them with the feature. A query that reads a second entity no longer needs a name under that entity to stay live.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: relatedList drawer and writeHandler toolbar actions take params
  detail: RelatedListToolbarAction kind "drawer" and kind "writeHandler" accept params as a RowFieldExtractor evaluated against the parent record, for example params with map appId to id. A drawer gets the values as prefill, a writeHandler merges them over its static payload with the extracted values winning. Without a parent record the action stays hidden.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: projectionDetail visibleWhen can pass the route id
  detail: A screen-level visibleWhen takes idParam on projectionDetail. The gate then queries with the route id under that key, and boot accepts a visibleWhen query that requires exactly that input. Without idParam the empty-payload rule stays, and idParam on another screen type fails boot. A failing gate query, such as a 403 for a downgraded tenant, shows the fallback or the standard notice instead of the screen.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Option tones gain critical and accent
  detail: SelectOptionTone is now ok, warn, bad, critical, accent or neutral, for select optionTones, enumOption tones, relatedList rowTone and projectionDetail header.statusTones. critical and accent reuse the StatusBadge colors (status-critical and the primary brand color), neutral stays muted. An informative state such as "Ready" can use accent instead of a custom cell.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Custom dashboard panels accept static params
  detail: A dashboard panel of kind custom takes params, static values laid over the screen's filterParams for its component. The panel wins when a filter uses the same name. Without params nothing changes.
  -->
  
  <!-- kumiko-changes
  feature: cap-overview
  type: improvement
  title: CapCardsPanel can be limited to specific cap keys via params.capKeys
  detail: A custom dashboard panel with params capKeys as a list of cap ids shows only those cards, in the order of the capsUsage query. Anything other than a list of strings means no limit, and capKeys is not sent to the server. Each limited cap card also shows how much is left (or that nothing is), next to the percent chip, and a limited panel adds a link to the full usage screen.
  -->
- Updated dependencies [383b6a8]
- Updated dependencies [99eea8a]
- Updated dependencies [3cfb343]
- Updated dependencies [3d7f455]
- Updated dependencies [c22ca75]
- Updated dependencies [05c9bef]
- Updated dependencies [c639de3]
  - @cosmicdrift/kumiko-framework@0.392.0

## 0.391.1

### Patch Changes

- Updated dependencies [70ceb25]
  - @cosmicdrift/kumiko-framework@0.391.1

## 0.391.0

### Minor Changes

- c823c6f: Readiness gains live probe runs and a system-check screen. Features register probes with `r.probe`, an admin starts a run, and the screen shows the latest results and the run history. The renderer gains the building blocks the screen needs. The disable-MFA form now confirms success, and the profile can link to account security.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.probe registers live readiness probes with a per-probe timeout
  detail: A feature registers a probe with r.probe({ name, scope, cost, area, label, timeoutMs?, targets?, run }). scope "system" probes run only for SystemAdmins, "tenant" probes also for TenantAdmins of that tenant; cost "paid" probes run only when the caller asks for them. targets splits one probe into one result per target, such as one per mailbox. runWithTimeout from the api barrel is the shared timeout runner the readiness checks and probe runs use. A probe's context holds db, registry, obs, tz and services plus the run fields; the run job's dispatch, event emitter and escape-hatch powers stay with the job. The readiness status query still makes no network call.
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
  title: i18nText format, enumOption tones, linkScreenField, live projectionDetail and metric tiles
  detail: FormatSpec gains { format: "i18nText" } for values that are a server-built { i18nKey, i18nParams } or a plain i18n key. enumOption takes tones per option value. ListColumnSpec takes linkScreenField, the row field holding the screen QN the cell links to. ProjectionDetailScreenDefinition takes live and metricsStyle ("band" or "tiles"); MetricSpec takes tone and icon.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Translated text cells, toned status pills, screen links in rows and live detail screens
  detail: An i18nText cell renders the text in the user's language. An enumOption column with tones draws the translated label as a status pill. A column with linkScreenField links the cell to the screen the row names, but only when the user may open that screen. A projectionDetail with live: true refetches the record and its relatedList sections on entity events. With metricsStyle "tiles" its metrics render as the dashboard KPI tiles (StatCard), the icon chip colored by the metric's tone; like on dashboards a value of 0 keeps the neutral tone.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: No repeated screen title on detail screens, header actions as high as the header controls, embedded table description first
  detail: A projectionDetail without a record title no longer repeats the screen title above its sections when the shell header already shows it. Screen actions in the shell header are now as high as the header's own controls (h-8) instead of the toolbar height. An embedded table (one that does not fill the screen height) shows its description above its toolbar, right under the section title.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: Probe runs and the system-check screen
  detail: The new readiness:write:run-probes starts a run as a worker job; includePaid also runs paid probes. A run only writes its own probe-run events, the probes read through adapters and fixtures and never write domain data. New queries return the latest run with its summary, the run history with the starter's name, and one run with its results. Probe texts arrive as { i18nKey, i18nParams }, and failed rows carry the QN of the screen that fixes the problem; the boot validator checks that QN against the feature screens and the generated settings screens. A probe that reports itself skipped shows no duration. createReadinessFeature({ nav: { order?, parent?, workspaces? } }) adds the system-check screen to the nav (workspace apps list the workspaces, a parent's membership does not carry over): start buttons (the paid one only when paid probes exist), the latest results with a fix link on failed rows, and the history that opens each run. Standard probes cover database, cache, search, mail sending, file storage, inbound mailboxes and the PDF service.
  migration: New table read_readiness_probe_runs. Apps that mount readiness run `kumiko schema generate` and apply the migration before deploying. Without a nav option the screen stays dormant; pass createReadinessFeature({ nav: {} }) or a parent nav QN to show it.
  -->
  
  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: The audit log leaves readiness probe runs to SystemAdmins
  detail: A probe run's events carry system-probe and personal-mailbox results. audit:query:list and audit:query:details now leave the probe-run stream out for every caller below SystemAdmin, also when the caller filters by that aggregate type.
  -->
  
  <!-- kumiko-changes
  feature: mail-foundation
  type: improvement
  title: Mail-sending probe
  detail: mail-foundation registers a probe that sends a short test mail through the tenant's mail transport to the user who started the check. The address is not stored in the result. A failed row names the reason (server not found, settings incomplete, mail not accepted) and links to the email sending settings; the raw error stays in the server log.
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

### Patch Changes

- Updated dependencies [8e6d41e]
- Updated dependencies [c823c6f]
- Updated dependencies [ffe0424]
  - @cosmicdrift/kumiko-framework@0.391.0

## 0.390.1

### Patch Changes

- Updated dependencies [8297c01]
  - @cosmicdrift/kumiko-framework@0.390.1

## 0.390.0

### Patch Changes

- Updated dependencies [1a7eebe]
- Updated dependencies [5d7dfe1]
- Updated dependencies [a01d30a]
- Updated dependencies [454b49d]
- Updated dependencies [21b70ba]
- Updated dependencies [be576a7]
- Updated dependencies [5ee91c6]
- Updated dependencies [febcd93]
- Updated dependencies [abef0e6]
- Updated dependencies [01a611f]
- Updated dependencies [c2fd4b3]
- Updated dependencies [3131c5c]
- Updated dependencies [8d06990]
- Updated dependencies [c2fd4b3]
- Updated dependencies [6d20414]
- Updated dependencies [f6d230f]
- Updated dependencies [e0e2dfe]
- Updated dependencies [22f9f23]
- Updated dependencies [6c1151a]
- Updated dependencies [54cda5b]
- Updated dependencies [9e6de88]
  - @cosmicdrift/kumiko-framework@0.390.0

## 0.389.0

### Minor Changes

- ac00e8a: List screens get a `table` block: remembered filter, search and sort per user, a reset-all button, a column picker with reordering, and a comfortable or compact row density.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: table block on entityList, projectionList and relatedList
  detail: The new optional table block (rememberState, resetAll, columnPicker, density with default and userChoice) is validated at boot; unknown keys, hidden columns without columnPicker and invalid density values are rejected. Columns accept hidden: true. Remembered state lives in sessionStorage per tenant and user and is cleared on logout or identity change.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: DataTable view menu, remembered list state and compact density
  detail: Lists with a table block show a view menu (columns, density, reset view) and a reset-all button. Remembered query parameters are copied into the URL once; links with explicit parameters win. Compact density uses 32px rows with 4px cell padding. New keys kumiko.list.reset-all and kumiko.list.view.* in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: CurrentUser carries tenantId, logout clears remembered list state
  detail: The session CurrentUser has an optional tenantId used to scope remembered list state; logout removes all kumiko.list.* storage entries.
  -->
- 7ca1a98: The list `table` block gets `pinning`, `resizing` and `keyboardNavigation`, and columns get `pinned`, `width` and `minWidth`. This release carries the types, the boot validation, the remembered view state and the texts.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: table.pinning, table.resizing and table.keyboardNavigation, column pinned, width and minWidth
  detail: The boot validator rejects pinned without table.pinning, a pinned value other than left or right, width or minWidth without table.resizing, values that are not finite numbers above 0, and a minWidth above the width.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: remembered column pins and widths in the list view state
  detail: useListTable passes pins, widths, minWidths and keyboardNavigation to the DataTable view options. Pins and widths live in the list-state store next to columns and density; a saved pin set replaces the schema pins, so a user can release a pinned column. New keys kumiko.list.view.pinning, kumiko.list.view.pin-left, kumiko.list.view.pin-right and kumiko.list.column.resize in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: DataTable resize grip, pinned focus ring and bounded widths
  detail: Column widths stay between minWidth and 2000 px, also when read back from the session. The resize grip shows on header hover and focus and carries aria-valuenow, aria-valuemin and aria-valuemax. Pinned and actions cells repeat the keyboard focus ring, and a pressed pin button is highlighted.
  -->
- 95b16ff: Lists group on the server with `table.grouping`, show a footer row with `table.totals` and filter number fields with a from/to range facet.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Money list aggregates answer one value per currency
  detail: A sum, avg, min or max measure over a money field in a list aggregate now answers [{ currency, value }] with value in minor units, one entry per currency in the matching rows, and never adds amounts of different currencies. Before, it answered one plain number over all currencies.
  migration: code reading measures of a money field from a list aggregate answer (executor.aggregate, answerListAggregate or the list query with aggregate) reads an array of { currency, value } instead of a number; take the entry of the wanted currency, value stays in minor units
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: table.grouping, table.totals and range facets validated at boot
  detail: The table block takes grouping ({ field, label?, labels?, collapsedWhen?, userChoice?, fields? }) and totals ([{ field, kind }]). The boot validator checks the fields against the entity or the columns, rejects measures a field type cannot carry and requires the list query to accept aggregate (entityListSchema does; hand-written queries answer it with answerListAggregate). facets.<field>.display "range" needs a filterable number, decimal, money or bigInt field.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Server-side groups, totals row and number range facet in the DataTable
  detail: With table.grouping the groups load via one aggregate query; each open group near the viewport loads its rows with the list query plus a group filter, page by page with "Load more", at most four groups at once, a collapsed group sends no query. Headers show the server count and measures, the global pager gives way in both pagination modes, and the view menu offers "Group by" with userChoice. table.totals renders a live footer row over the filters and search. A range facet shows from/to inputs, keeps <screenId>.f.<field>.min/.max in the URL and sends gte/lte filters, money in minor units. Infinite lists now also start over when a facet changes. New keys kumiko.list.group.*, kumiko.list.measure.*, kumiko.list.totals.label, kumiko.list.range.* and kumiko.list.notice.* in all locale packages.
  -->
- 1b8c7ba: Lists get `bulkActions`: row checkboxes, a selection bar and a run that calls a writeHandler row action once per selected row.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: bulkActions on entityList, projectionList and relatedList
  detail: Each entry is { id, rowAction, confirm? } and points at a writeHandler entry of the same screen's rowActions. The boot validator rejects unknown keys, a non-kebab or duplicate id, an unknown rowAction and a rowAction of kind clientAction, navigate or drawer.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: DataTable row selection and bulk run
  detail: With bulkActions the table gets a checkbox column, a header checkbox for the loaded rows (at most 100), a checkbox per card and a bar with "n selected" and the actions. A run sends one /api/write per row, at most 4 at a time; rows hidden by the row action's visible are skipped. Cancel stops new writes. A banner shows succeeded, failed, skipped and not run; failed and not-run rows stay selected and the list reloads. With table.keyboardNavigation, Space toggles the focused row. New keys kumiko.list.bulk.* in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: entityList writeHandler row actions keep display
  detail: entityList built its writeHandler row actions inline and dropped display; it now uses the same builder as projection and related lists.
  -->
- 7b3c3c0: Lists with `table.export` get an Export button that downloads the filtered list as an XLSX file.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: XLSX export for entityList and projectionList via table.export
  detail: The new table.export block ({ xlsx: true, maxRows? }) is validated at boot and is only accepted on entityList and projectionList. POST /api/export/xlsx runs the list query again with the caller's session, pages through the whole filtered list and answers 413 above maxRows (default 10000, hard cap 100000). Encrypted, sensitive, write-only and unreadable fields and virtual columns are left out of the sheet. Reference columns export the label of the target (joined with commas for multiple references), not the id. Timestamp cells use the browser time zone sent with the request, else the profile zone, else UTC. Personal access tokens are rejected. A projectionList query must honor offset or return nextCursor. Adds the write-excel-file dependency.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Export button in the DataTable toolbar
  detail: Lists with table.export show an Export button next to the view menu. It exports the current search, sort and facets with the visible columns in their order and shows a hint when the list exceeds the row limit. New keys kumiko.list.export, kumiko.list.export-busy, kumiko.list.export-too-many and kumiko.list.export-failed in all locale packages.
  -->
- 9253635: Selector fields in the generated provider forms now carry the owner feature in their field id, so two selector owners that both name their key `provider` no longer overwrite each other's empty-option label. The mail selector field is now `mail-foundation-provider` and its option labels live under `config:entity:__config-edit__:field:mail-foundation-provider:option:<value>`; the locale catalogs follow.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: provider selector option labels are unique per owner
  detail: The selector field id of a provider form is qualified with its owner feature, so the translation keys of its option labels change.
  migration: move app translation overrides from config:entity:__config-edit__:field:provider:option:<value> to the owner-qualified field id, field:mail-foundation-provider:option:<value> or field:file-foundation-provider:option:<value>
  -->

### Patch Changes

- 9253635: `copy-locale` of a template with linked files now reads each source file through the storage provider of the tenant that owns it. Before, it read through the caller's provider, so with one provider per tenant the files of a system template looked missing and the copy silently lost its images and attachments. A file whose row exists but whose bytes cannot be read now fails the copy with `templateResolver.errors.resource.sourceUnreadable` and stores nothing.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: copy-locale reads source files from the owning tenant's storage
  detail: The copy of linked files uses readFileRefContent with the provider of the fileRef's tenant. A source file whose fileRef row exists but whose bytes cannot be read fails the copy with template_resource_source_unreadable and releases the files already copied. A deleted fileRef is still left out of the copy.
  -->
- 9253635: `patch-draft` `replaceText` now says why a find that is visible in `document-blocks` does not match. A find that crosses a formatting change fails with `text_spans_formatting`, and a find containing a `{{placeholder}}` fails with `placeholder_not_replaceable`, instead of `text_not_found`. The handler description names the limit: the text must lie within one formatting run and cannot contain a placeholder.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: replaceText explains finds across formatting or placeholders
  detail: replaceText matches inside single text nodes so formatting stays intact. A find that appears in the block line but crosses a formatting change now fails with text_spans_formatting, and a find with a {{placeholder}} fails with placeholder_not_replaceable, both with translated messages. Only a string that is not in the block at all still gives text_not_found.
  -->
- Updated dependencies [47ba075]
- Updated dependencies [1b3a297]
- Updated dependencies [ed98312]
- Updated dependencies [c16fa0c]
- Updated dependencies [ac00e8a]
- Updated dependencies [7ca1a98]
- Updated dependencies [95b16ff]
- Updated dependencies [1b8c7ba]
- Updated dependencies [7b3c3c0]
- Updated dependencies [e2211ac]
- Updated dependencies [641f268]
- Updated dependencies [641f268]
- Updated dependencies [ad0c891]
- Updated dependencies [947470b]
- Updated dependencies [dd5fd28]
- Updated dependencies [a50674e]
- Updated dependencies [53e2a0e]
- Updated dependencies [ab1ca17]
- Updated dependencies [5b72552]
- Updated dependencies [768a67e]
- Updated dependencies [d8f9c73]
- Updated dependencies [91fb415]
- Updated dependencies [8628ea3]
- Updated dependencies [9253635]
- Updated dependencies [a50674e]
- Updated dependencies [5b707a6]
- Updated dependencies [cee9e32]
- Updated dependencies [aa83c70]
- Updated dependencies [a50674e]
- Updated dependencies [80399a2]
- Updated dependencies [a50674e]
- Updated dependencies [ff84ee4]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [8449190]
- Updated dependencies [080c5e7]
- Updated dependencies [76c95ae]
  - @cosmicdrift/kumiko-framework@0.389.0

## 0.388.0

### Minor Changes

- 453b3f0: Six-cell one-time code input for the MFA screens: autofocus, auto-submit on the last digit in login and setup, and a recovery-code switch in verify, disable and regenerate.
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Input gets kind "code" and autoFocus on kind "text"
  detail: Input has a new kind "code" (length, onComplete, autoFocus, autoComplete defaulting to one-time-code), a single real input shown as separate cells; onComplete fires once when input, paste or autofill reaches full length and the value holds digits only. kind "text" gains autoFocus.
  migration: custom Input implementations (PrimitivesProvider override) with an exhaustive switch over props.kind need a case "code"; delegating to DefaultInput from @cosmicdrift/kumiko-renderer/web is enough
  -->
  
  <!-- kumiko-changes
  feature: auth-mfa
  type: improvement
  title: Six-cell code input, autofocus, auto-submit and recovery switch
  detail: The MFA login, setup, disable and regenerate screens use the six-cell code input with autofocus. Login and setup submit automatically on the sixth digit; disable and regenerate keep the explicit confirm button. Verify, disable and regenerate can switch to a recovery-code field. New keys auth.mfa.verify.useRecoveryCode, useAuthenticatorCode, recoveryCode and recoverySubtitle in all locale packages; auth.mfa.disable.code now names the authenticator code only.
  -->
- 1425622: Dodo Payments as a subscription provider, and billing-foundation offers several providers side by side.
  
  <!-- kumiko-changes
  feature: subscription-dodo
  type: improvement
  title: New subscription provider for Dodo Payments
  detail: createSubscriptionDodoFeature() registers the "dodo" subscription provider (Merchant of Record). It verifies Standard Webhooks signatures, maps Dodo events to the foundation events, creates hosted checkouts and portal sessions, and switches plans in the app through previewPlanSwitch and applyPlanSwitch. Config keys are api-key, webhook-secret, billing-live and environment. Plan switches need a Product Collection in Dodo.
  -->
  
  <!-- kumiko-changes
  feature: subscription-dodo
  type: improvement
  title: dodoEnvSchema declares the Dodo product id slots
  detail: dodoEnvSchema({ prices: ["PRO"] }) adds one optional DODO_PRODUCT_PRO slot per plan next to the API key and webhook key, and checks the pdt_ prefix. It is the counterpart to stripeEnvSchema.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Several subscription providers in one catalog
  detail: The billing-plans query returns providers (name, displayName, plans, note) when more than one provider is offered, and start-plan-checkout takes providerName. consumerProtection.providerTexts overrides checkoutNote and vatNote per provider, and the consent record carries providerName. switch-plan always uses the provider of the existing subscription.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: In-app plan switch with a preview and consent
  detail: A provider plugin that implements previewPlanSwitch and applyPlanSwitch switches plans without a hosted portal. The new plan-switch-preview query returns the proration, the billing-plans result carries inAppPlanSwitch, and the panel shows PlanSwitchConfirmDialog with the withdrawal consent checkboxes. The confirmation mail is sent when the plan_changed webhook arrives with the consent id.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: breaking
  title: A catalog with several providers no longer throws an ambiguous-provider error
  detail: With more than one subscription provider mounted, billing-plans and start-plan-checkout used to throw. They now list the providers; start-plan-checkout answers with errors.providerRequired when several are offered and no providerName is given, and errors.providerNotOffered for an unknown one. Plugins have to set displayName.
  migration: Set displayName on custom subscriptionProvider plugins. Callers that send start-plan-checkout with several providers mounted must pass providerName.
  -->
  
  <!-- kumiko-changes
  feature: subscription-stripe
  type: improvement
  title: Stripe plugin has a displayName
  detail: The Stripe plugin sets displayName "Stripe", which the provider choice in the billing panel shows.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: billing boot option takes stripe and/or dodo
  detail: billing.stripe is now optional and billing.dodo is new (priceToTier, oneOffPriceIds). At least one is required. resolveBillingOption returns features (an array) instead of feature, and one webhook route serves every provider on stripe.webhookPath or SUBSCRIPTION_WEBHOOK_PATH. DODO_PAYMENTS_API_KEY and DODO_PAYMENTS_WEBHOOK_KEY are the env bridge.
  migration: Callers of resolveBillingOption use billing.features instead of billing.feature.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings for the provider choice and the in-app plan switch
  detail: Adds billing-foundation planSwitch.*, plans.providerChoice, plans.planSwitchRequested and the providerNotOffered and providerRequired errors.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: ChoiceCards widget and PlanCard price prefix
  detail: ChoiceCards is a card-styled radio group (title, description, aside, native radios, keyboard operable) for exclusive choices that need more than a segment label. PlanCardPrice takes an optional prefix shown before the amount, for example "from".
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Provider choice moved into the checkout dialog
  detail: The plan panel no longer shows a provider switch. Cards show the first provider's price, or the cheapest one with a "from" prefix when providers disagree. With several providers, or with consumerProtection, choosing a plan opens CheckoutConsentDialog, which now has an optional providerChoice (ChoiceCards with the checkout note and, when prices differ, the price), an optional note, and an optional consumerProtection (without it there are no checkboxes and the order carries no consent). The plan switch dialog shows the recurring price with its interval.
  -->
  
  <!-- kumiko-changes
  feature: subscription-stripe
  type: fix
  title: A malformed stored credential no longer leaks into the error
  detail: A stored api-key or webhook-secret that is not valid JSON used to raise the JSON parser's own message, which repeats the value into logs and the webhook 401 body. The error now has a fixed text and names no input. subscription-dodo behaves the same.
  -->

### Patch Changes

- 5520352: Renderer robustness fixes and clearer template-reset wording in es/fr/it.
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Renderer low-severity robustness fixes
  detail: The list search echo handling no longer mutates state during render and no longer re-sends an already sent value. A failing live refetch no longer drops a queued follow-up run. Downloaded blob URLs are revoked after a delay, failed PDF loads are retried on the next mount, the file meta cache is cleared when the app gate unmounts, and renderFlow rejects duplicate node ids and unknown icons. The es/fr/it titles of the reset-to-system action now say the tenant template is reset to the system template.
  -->
- 084c9c0: Review fixes: an inline mail image no longer swallows transient storage errors, the unsubscribe tenant origin is resolved once per notify call, one-click unsubscribe POSTs keep the JSON rejection, the resubscribe limit has its own page text, and form drafts fail loudly when the PII key service is missing.
  
  <!-- kumiko-changes
  feature: delivery
  type: fix
  title: Inline mail image retries on transient storage errors
  detail: Only a missing file storage for the file's tenant sends the mail without the inline image; any other read error (timeout, provider failure, DB) is rethrown so the send job retries instead of mailing without the logo.
  -->
  
  <!-- kumiko-changes
  feature: delivery
  type: fix
  title: Unsubscribe tenant origin resolved once per notify call
  detail: The app's tenantOrigin callback runs once per notify call and tenant instead of once per recipient and channel, so a newsletter no longer causes one lookup and one fallback warning per address. The docs state the callback must only return verified, active domains.
  -->
  
  <!-- kumiko-changes
  feature: delivery
  type: fix
  title: One-click unsubscribe POST keeps the JSON rejection
  detail: RFC 8058 one-click POSTs (form body List-Unsubscribe=One-Click) answer an invalid or expired token with the JSON 400 again and skip the branding lookup; only browser form submits get the HTML page.
  -->
  
  <!-- kumiko-changes
  feature: delivery
  type: fix
  title: Resubscribe limit page has its own text
  detail: A browser that hits the resubscribe limit sees that the address cannot be subscribed again here, instead of the generic "try again later" error (new key mail.unsubscribe.resubscribeLimitReached in en, de, es, fr, it).
  -->
  
  <!-- kumiko-changes
  feature: form-draft
  type: fix
  title: Encrypted drafts without a PII key service raise an error
  detail: Reading a ciphertext draft with no PII subject key service configured throws instead of returning an empty draft, so the stale-draft cleanup defers it and no longer releases its file refs as if it were empty.
  -->
- 6884324: Review fixes: a failing trial gate hides the add-on in the app schema instead of failing the request, error docs links skip app-overridden error codes, anonymous sessions never bind pending uploads in the save pipeline, and failed uploads drop their ledger row.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Failing trial gate no longer breaks GET /api/schema
  detail: The trial gates of all disabled toggleable features run in parallel; a gate that throws counts as not unlocked, hides the add-on and is logged, so the client still boots.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: No docsUrl for app error codes without a framework page
  detail: An app subclass that overrides the error code with an uncovered reason no longer links to a framework page that does not exist; the field is absent unless errorDocs covers the reason.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Anonymous sessions cannot bind pending uploads on save
  detail: The save pipeline now applies the same anonymous-session exclusion as the pending file ref helpers, so one visitor cannot attach another visitor's pending upload to their record.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Failed uploads drop their upload ledger row
  detail: When the fileRef create fails after the bytes were written, POST /files and createFileRefFromBytes now delete the bytes and forget the ledger row instead of leaving it for the next sweep.
  -->
- Updated dependencies [7e54012]
- Updated dependencies [f81f639]
- Updated dependencies [bd38fdc]
- Updated dependencies [7447ac1]
- Updated dependencies [7e54012]
- Updated dependencies [b4be520]
- Updated dependencies [e1c01e4]
- Updated dependencies [2b49eb8]
- Updated dependencies [be79841]
- Updated dependencies [1adee91]
- Updated dependencies [9eec92b]
- Updated dependencies [044428c]
- Updated dependencies [9ba9cf4]
- Updated dependencies [7e54012]
- Updated dependencies [4ce85cd]
- Updated dependencies [ee0aaf9]
- Updated dependencies [374a12b]
- Updated dependencies [014b9ab]
- Updated dependencies [b62c381]
- Updated dependencies [ab7c4ee]
- Updated dependencies [22bc0a7]
- Updated dependencies [32cf2fe]
- Updated dependencies [5e03e77]
- Updated dependencies [52859ba]
- Updated dependencies [6884324]
- Updated dependencies [2638a4a]
- Updated dependencies [b137525]
- Updated dependencies [f507989]
- Updated dependencies [da784a9]
- Updated dependencies [ff5f68e]
  - @cosmicdrift/kumiko-framework@0.388.0

## 0.387.0

### Patch Changes

- Updated dependencies [10d7581]
- Updated dependencies [935306d]
- Updated dependencies [39afc25]
- Updated dependencies [e4ea6e1]
- Updated dependencies [5a25c89]
- Updated dependencies [2b4c84a]
- Updated dependencies [c25b54f]
- Updated dependencies [de7a63d]
  - @cosmicdrift/kumiko-framework@0.387.0

## 0.386.0

### Patch Changes

- Updated dependencies [f0a9e8f]
- Updated dependencies [5759e39]
  - @cosmicdrift/kumiko-framework@0.386.0

## 0.385.0

### Patch Changes

- Updated dependencies [3b011a8]
- Updated dependencies [9950dd0]
- Updated dependencies [e345be5]
  - @cosmicdrift/kumiko-framework@0.385.0

## 0.384.0

### Minor Changes

- 26cd745: Event-consumer admin screens, readable audit log, device column for sessions, and a privacy center that keeps its deletion section.
  
  <!-- kumiko-changes
  feature: jobs
  type: improvement
  title: Event consumers screen with restart, skip, pause and resume
  detail: SystemAdmins get the screens event-consumers and event-consumer-detail. A stopped consumer offers Restart as the primary action; Skip event (with a confirm dialog), Pause and Resume sit in the overflow menu. The write handlers no longer return the raw error text: unknown consumer, wrong status and nothing to skip have their own codes and messages, anything else is logged on the server and answers a generic message. The shared instance reads "Shared".
  -->
  
  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: Audit log shows a label for every event type and hides technical entries
  detail: Events that are not entity lifecycle events get a readable label (for example "Custom field value set") or are classified technical (delivery attempts, counters, tenant-destruction stages) and hidden by default behind "Show technical entries". New event types of bundled features need an entry in the audit classification; a test over all registered events fails without one. Apps that add their own event types are unaffected, they keep the entity and action wording or the raw type.
  -->
  
  <!-- kumiko-changes
  feature: sessions
  type: improvement
  title: Session lists show the device
  detail: The new subpath @cosmicdrift/kumiko-bundled-features/sessions/web exports sessionsClient(). Apps must add sessionsClient() to their client features to get the device column (browser and OS parsed from the user agent) and the translated "This session" cell; without it the screens fall back to the raw columns. The IP display is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: Privacy center keeps the deletion section and speaks to the user
  detail: The deletion section only held a conditional field and the request-deletion and cancel-deletion actions, so the renderer dropped it as empty. It now stays whenever it has a visible action. The subtitle is written for the person on the page and names Art. 20, 18 and (when deletion is configured) 17.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Consumer admin functions accept a transaction, notIn where operator
  detail: restartConsumer, skipPoisonEvent, disableConsumer, enableConsumer and the progress readers accept a DbRunner (pool or open transaction); skipPoisonEvent uses its own transaction on a pool and a savepoint inside a handler transaction. skipPoisonEvent takes { requireStatus } and checks it under its row lock; the consumer-skip handler requires "dead". Rejected transitions throw ConsumerTransitionError with rejection "unknown-consumer" or "wrong-status". Where clauses support { notIn: [...] }. Existing callers passing a DbConnection compile unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: A section with a visible action is not hidden when all its fields are
  detail: Edit and detail sections (entityEdit, projectionDetail, in every app) whose fields are all hidden by visibility conditions now stay on screen while at least one of their actions is visible. Before, such a section vanished together with its action buttons; apps that relied on that to hide a section must hide the action with its own visible condition.
  -->

### Patch Changes

- Updated dependencies [c28119a]
- Updated dependencies [26cd745]
- Updated dependencies [26cd745]
  - @cosmicdrift/kumiko-framework@0.384.0

## 0.383.1

### Patch Changes

- Updated dependencies [4ea38e1]
  - @cosmicdrift/kumiko-framework@0.383.1

## 0.383.0

### Minor Changes

- 9ef4b39: Support-friendly error UI, client error reporting, a wider leave guard and an IBAN text format: errors show a copyable reference, browser errors reach the server, global navigation asks before dropping unsaved input and `format: "iban"` validates IBANs.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Error reference with copy button in toasts, banners and fallbacks
  detail: A server error that carries a request id now shows "Error ID: <id>" with a copy button in toasts, action error banners, the write-form error section, query error banners and list empty states. The root and screen error fallbacks show a per-error id the same way; the root fallback is styled with inline styles so it stays readable without CSS. New exports ErrorReference, ErrorNotice and errorNoticeOf; New keys kumiko.error.reference, kumiko.error.copyReference and kumiko.error.referenceCopied in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: HeaderActionsBar onError receives an ErrorNotice instead of a string
  detail: The onError prop of HeaderActionsBar is now (notice: ErrorNotice | null) => void, where ErrorNotice is { message, requestId? }, so the error reference can be shown next to the message.
  migration: change the handler to read notice.message (and notice.requestId); a handler that stores the string only needs `notice?.message ?? null`
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: createKumikoApp reports browser errors to POST /api/client-errors
  detail: New option reportClientErrors (default true) sends error-boundary errors (kind render) and window error and unhandledrejection events (kind unhandled) to /api/client-errors with the same errorId the fallback shows, at most 5 reports per page load, identical messages once, path without query and hash, CSRF header when a token is present. A custom onError runs in addition and receives { errorId, screen? } as third argument. Set reportClientErrors: false to opt out.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Global navigation with search params asks before dropping unsaved input
  detail: navigateWithReturnTo, navigateToReturn, the metric tab navigation, closing the editor panel and the target resolver now go through the leave guard, and a requestLeave nested in a confirmed leave no longer asks twice. List filters and sorting stay unguarded because they do not unmount a form. The mail designer registers its draft as unsaved input, so link and browser navigation ask before discarding it.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Text field format "iban"
  detail: createTextField({ format: "iban" }) validates the value server-side (spaces ignored, case-insensitive, country and check digits shape plus mod-97) and reports invalid_format with format iban, which the form maps to errors.validation.invalid_format.iban (texts in en, de, es, fr, it). The value is stored as typed.
  -->

### Patch Changes

- Updated dependencies [72ac4b1]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
  - @cosmicdrift/kumiko-framework@0.383.0

## 0.382.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.382.0

## 0.381.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.381.0

## 0.380.0

### Patch Changes

- Updated dependencies [07ccdc9]
  - @cosmicdrift/kumiko-framework@0.380.0

## 0.379.0

### Minor Changes

- ba1a10e: File uploads in an actionForm, dropzone display for files fields
  
  <!-- kumiko-changes
  feature: files
  type: improvement
  title: File uploads in an actionForm, dropzone display for files fields
  detail: A files or images field of an actionForm screen uploads through POST /files with actionForm=<screen QN> and fieldName; the file is stored pending under the screen and the route checks the caller's access to the screen and its handler before writing bytes. New helpers resolveActionFormFileField and listActionFormFileFields (framework/files), bindPendingFileRef takes bindTo (the target entity file field, checked against its accept and maxSize) and registry, and ACTION_FORM_PSEUDO_ENTITY moves to framework/ui-types. New display "list" or "dropzone" on FilesFieldDef and ImagesFieldDef; the dropzone works in entityEdit and actionForm and maps server error codes to translated texts. Pending actionForm uploads are removed on user forget and by the forget-subject file purge. New i18n keys kumiko.widget.upload.too-large|invalid-type|max-count|remove, kumiko.field.dropzone.* and errors.file.violatesBindTarget (de, es, fr, it included).
  migration: Custom upload screens such as solon document-upload can become an actionForm with a files field and display "dropzone". The form's handler must bind every file it keeps: load it with loadPendingFileRef (entityName = the screen QN) and move it onto a record with bindPendingFileRef({ bindTo, registry: ctx.registry }); unbound uploads are treated as the uploader's personal data and removed on forget.
  -->
- aa886cc: Fixes for the gaps the attack tests found: form drafts are encrypted per owner, SSE entity signals follow the read access of the connection, late Stripe events no longer roll a subscription back, unknown e-mail addresses count towards the login lockout, and cause details no longer leak when NODE_ENV is missing.
  
  <!-- kumiko-changes
  feature: form-draft
  type: breaking
  title: Form draft content is encrypted per owner
  detail: The jsonb field draft carries personal: { of: "ownerId" }, so its content is stored as ciphertext in events and in read_form_drafts; the delete event no longer keeps the plaintext in previous. The PII event backfill (jsonb-objects-v3) encrypts existing events once on the next boot and rebuilds the table. The column type stays jsonb, so there is no schema change.
  migration: Nothing to run; the backfill happens on boot. Code that reads read_form_drafts.draft with raw SQL must decrypt it (decryptPiiFieldValues) or use the form-draft lookup helpers; the get and list queries are unchanged for clients.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: PII backfill encrypts jsonb object and array fields
  detail: runPiiEventBackfill and backfillEventPiiEncryption now retro-encrypt plaintext jsonb objects and arrays of personal fields and personal jsonb scalars, and createPiiBackfillStateTable bootstraps under an advisory lock so concurrent first boots no longer skip the ALTER. Completed backfill states rerun once because the transform version changed.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: applyEntityEvent is exported from the db barrel, extension sources accept auto-verbs
  detail: applyEntityEvent can be used by extendEntityProjection apply handlers to project stored entity events of a foreign aggregate type. validateProjectionApplyKeys accepts the entity auto-verbs for an extension source that is not a registered entity.
  -->
  
  <!-- kumiko-changes
  feature: document-ingest-foundation
  type: fix
  title: documentExtract projection survives a rebuild
  detail: DOCUMENT_EXTRACT_AGGREGATE_TYPE is exported, and the documentExtract entity projection applies the stored document-extract.* events, so rebuildProjection restores the rows. No event is rewritten.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: SSE entity signals follow the read access of the connection
  detail: A signed-in connection receives an entity signal only when a query reading that entity lets one of its roles in (SseRouteOptions.entityReadAccess, built by collectEntityReadAccess). Entities without a reading query no longer go on the channel. When the reading access depends on a row or owner filter, the signal goes out without id and version, so a client refetches its query instead of learning which row changed.
  migration: Apps that rely on a signal for an entity no query exposes to the user must add a query for that entity with a matching access rule. Custom buildServer callers that build SseRouteOptions themselves must pass entityReadAccess.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: Late Stripe events are dropped
  detail: The Stripe plugin passes event.created as providerEventAt, process-event stores it as providerEventAtIso in the subscription event and drops a created, updated or canceled event that is older than one already stored (result stale: true). A canceled subscription is no longer reactivated by a late delivery. Providers without a timestamp are unaffected; no migration.
  -->
  
  <!-- kumiko-changes
  feature: tags
  type: fix
  title: assign-tag and delete-tag no longer race
  detail: Re-assigning a tag after it was deleted no longer restores the assignment of a gone tag. assign-tag and delete-tag now take the same per-tag advisory lock, so a parallel assign can no longer leave an assignment for a deleted tag.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Unknown e-mail addresses count towards the login lockout
  detail: Failed logins for unknown or deleted addresses are counted under a keyed digest of the normalized address (ctx.rateLimitDigest, derived from the JWT secret), so after the threshold they answer account_locked like a registered address and the lock no longer reveals which addresses exist. Without a digest key the old invalid_credentials answer stays.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Cause details only with NODE_ENV development or test
  detail: internal_error responses and write error infos carry the cause snapshot (name, message, stack) only when NODE_ENV is explicitly development or test. A missing or misspelled NODE_ENV no longer exposes stack traces, paths or upstream URLs. kumiko-dev starts the server with NODE_ENV=development when none is set, so local dev keeps the details; a dev script that runs the server directly (bun --watch bin/server.ts) must set NODE_ENV=development itself to see them.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Global IP rate-limit middleware default matches runProdApp
  detail: globalIpRateLimit defaults to 600 requests per 60 seconds (was 1000). DEFAULT_GLOBAL_RATE_LIMIT is exported from the api barrel and shared with server-runtime. authEndpointRateLimit keeps its default of 5 per 60 seconds.
  migration: Apps that use globalIpRateLimit directly and relied on 1000 pass limit explicitly. runProdApp users see no change.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot warning when /metrics is off in production
  detail: buildServer logs a warning in production when no metrics option is set, which happens when PROMETHEUS_METRICS_TOKEN is unset.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Empty list with an active default filter offers "Show all"
  detail: A list that is empty only because its defaultFilters are on says so and offers a Show all button instead of the "create the first one" text. The hard-coded Loading… banners use the kumiko.widget.loading key, so they follow the locale.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: Translations for the default-filter empty state
  detail: kumiko.list.empty.defaultFiltered and kumiko.list.empty.showAll are translated in de, es, fr and it.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: Retry documentation matches the client
  detail: The client retries 502, 503 and network errors; other 5xx and client timeouts fail at once because the render already ran. The feature description no longer promises a retry for every 5xx.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Count messages use singular and plural forms
  detail: Nine count messages (template usage, mail preview entries, layout origin and footer, tag delete confirmation, embedded-list paste warnings) now come as .one and .other keys in en, de, es, fr and it, so "1 template" no longer reads "1 templates". Apps that override these keys must rename them to .one and .other.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: runDevApp stop releases the late-bound revokers
  detail: stop() swaps the session and PAT revokers that boot bound onto the auth-mfa, sessions and personal-access-tokens feature instances for inert ones, and those features now accept a new binding on a second boot instead of keeping the first. A later app or test stack on the same feature instances no longer reaches the closed database connection.
  -->
- ba1a10e: SystemAdmin audit log across all tenants
  
  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: SystemAdmin audit log across all tenants
  detail: New queries audit:query:list-all-tenants and audit:query:details-all-tenants (SystemAdmin only) return the audit trail of every tenant, each row with its tenantId, filterable by tenant. Screens audit-log-all-tenants and audit-log-all-tenants-detail show the tenant name; the admin-shell platform workspace lists the new nav audit:nav:audit-log-all-tenants. Events of the system tenant are not included. The audit feature now declares r.systemScope(), so its handlers read through ctx.systemDb instead of ctx.db, and list and details rows carry tenantId too. A targetless cross-tenant read (acknowledgeCrossTenant or cross-tenant-read) is now recorded at most once per actor, handler, tenant and reason per hour, so the reference lookups of a SystemAdmin list no longer flood the trail on every page load; all other escape-hatch kinds keep the 60 s window. The audit events keep metadata free of PII ciphertext, a cursor or id beyond bigint is a 422 and the all-tenants tenant filter takes at most 100 ids. Applies to every user:user reference column and read-only reference field in all apps, not only the audit screens: an actor without a visible row no longer shows the raw id but reads "Unknown" (kumiko.reference.unknown-user), once the lookup finished without error (while it loads or after it failed the cell keeps a placeholder), and the "system" createdBy literal reads "System". The audit screen descriptions are now short user-facing sentences.
  migration: Apps with their own platform workspace add the nav `audit:nav:audit-log-all-tenants` (screen `audit:screen:audit-log-all-tenants`) to its navs; apps using the admin-shell platform workspace get it automatically.
  -->
- 9d81e04: Live updates reconnect and resync after a dropped stream, forms ask before throwing away unsaved input, and the receipt of a public cancellation carries a link to take it back.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Live updates reconnect, resync and coalesce refetches
  detail: The web EventSource reconnects with exponential backoff and jitter after a refused handshake unless the session ended, rewires every subscribed entity on the new connection and sends each listener a LIVE_RESYNC_EVENT_TYPE event after a reconnect, because frames during the gap are lost. useQuery and the nav tree refetch in the background and collapse a burst of live events into one trailing run (LIVE_REFETCH_COALESCE_MS); an event during a running fetch queues exactly one follow-up. A failed refetch keeps the last data on screen and shows QueryErrorBanner with a retry button above it.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: A slow SSE client no longer buffers without bound
  detail: The SSE route tracks the writes a client has not consumed. A client whose queued frames make no progress for SSE_STALLED_CLIENT_TIMEOUT_MS (one heartbeat interval), or that queues SSE_MAX_PENDING_WRITES_PER_CLIENT frames, is aborted and unregistered; it reconnects and resyncs. A large broadcast batch does not drop a client that keeps reading, and one failing client no longer stops the broadcast to the others. SseRouteOptions.now makes the clock injectable.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Forms ask before unsaved input is discarded
  detail: A dirty entity form or writeForm section now asks with the discard dialog before an in-app navigation, a projectionDetail tab switch, browser back or forward, and the browser asks on tab close or reload (beforeunload). A successful save clears the form before its follow-up navigation, and wizards with layout.draft keep their draft instead of asking. requestLeave, hasUnsavedInput and useUnsavedInputSource are exported for custom screens.
  migration: End-to-end tests that fill a form and then navigate away without saving now meet the dialog (testId leave-guard-dialog); confirm it or save first. page.goto from a dirty form triggers the browser's beforeunload prompt.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Form writes carry a requestId and reuse it only for a safe retry
  detail: The form controller passes { requestId } as third argument to dispatcher.write. After a transport failure without a server answer, a submit with the same values reuses the requestId, so the server idempotency guard does not run the write twice; any server answer or changed values get a new one. generateRequestId moved to the headless dispatcher module.
  migration: Tests that assert a mocked dispatcher.write with toHaveBeenCalledWith(type, payload) must accept the third argument, e.g. toHaveBeenCalledWith(type, payload, expect.objectContaining({ requestId: expect.any(String) })). Custom Dispatcher implementations should forward options.requestId.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Failed submits focus the first invalid field, clearer format errors
  detail: After a failed submit the web form focuses and scrolls to the first field with aria-invalid (FormProps.focusFirstErrorKey; native forms ignore it). Format errors for email, url, date, datetime and uuid name the expected format with an example, the error line no longer shifts the labels of neighbouring fields, and SegmentedControl options with up to four entries get equal widths.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: "This cancellation was not me" link in the public cancellation receipt
  detail: When a public § 312k declaration matches an account, the receipt mail carries a one-time link (random token, only its sha256 is stored as revocationTokenHash in the declared event). The link opens a confirmation page; confirming with POST takes the cancellation back until it takes effect, resumes the provider subscription through the new optional SubscriptionProviderPlugin.resumeSubscription (Stripe sets cancel_at_period_end to false) or asks the operator to do it by hand, appends contract-termination.revoked and notifies the operator. Unknown requests and wrong tokens get the same answer; after the effective date the page says it is too late. Declarations stored before this release have no token and cannot be revoked by link.
  -->
  
  <!-- kumiko-changes
  feature: auth-mfa
  type: fix
  title: MFA setup uses the shared QR secret primitive
  detail: The pre-auth MFA setup screen renders the QR code and secret through the renderer's QR secret primitive instead of its own markup.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: One English reference catalog for all locale packages
  detail: The completeness checks of es, fr and it run in the use-all-bundled i18n parity test against the single English catalog in locale-de; the harvest script writes only that file. New keys errors.validation.invalid_format.{email,url,date,datetime,uuid} in all locales.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Deprecations name their removal release
  detail: The three @deprecated APIs without a target release (the minor-units money accessor and the landingPath props of the invite and signup screens) now say they are removed in 0.390.0.
  -->

### Patch Changes

- 2a057b1: Template designer follow-up: plain-language titles for the template-resolver write handlers, a Spanish waitlist admin notice, and layout fixes in the editor rails and the shell header.
  
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
  detail: A rail section wraps its action below the heading instead of clipping it, a resource name without spaces wraps inside its row instead of running under "Remove" and its meta text takes its own line instead of an ellipsis, the footer no longer offers a test mail when send-test-status says none can be sent, and the header label placeholder reads "e.g. Reminder" instead of an incident example. In a narrow window (1024px beside the app sidebar) both rails share the left column so the page keeps its room, and the header leaves save and publish to the footer below 1280px so the template title stays readable.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Shell header: the parent crumb no longer slides under a long title
  detail: The page title truncates on its own; the parent crumb stays whole and is left out when the space beside the header actions gets narrower than 20rem (a container query on the header's left side instead of the sm viewport breakpoint). The h1 carries the full title as tooltip.
  -->
- ba1a10e: A rejected empty embedded list shows its error at the list, once, without a banner-only failure
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: A rejected empty embedded list shows its error at the list, once, without a banner-only failure
  detail: The empty state of an embedded list now shows list-level issues (min items, required), and the surrounding field no longer prints them a second time. An issue on a derived head total that is not laid out (an empty list leaves it without a value) no longer adds the generic form banner while another issue is shown; it still shows the banner when it is the only issue. A list below its minItems now reads "At least 1 row required." / "At least N rows required." (errors.validation.list_min_rows.one and .other) instead of the generic too-small text. Only embedded lists get the row wording (their schema reports a custom issue with params.i18nKey and minimum, which both zod bridges now forward); other arrays such as a required multiSelect keep errors.validation.too_small.
  migration: None.
  -->
- ece210b: New overview string for locked template overrides.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Overview label for locked template overrides
  detail: Adds templateResolver.overview.lockedOverride.
  -->
- Updated dependencies [ba1a10e]
- Updated dependencies [aa886cc]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [632da48]
- Updated dependencies [94d55c0]
- Updated dependencies [d72e1fc]
- Updated dependencies [ba1a10e]
- Updated dependencies [9d81e04]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [434be6e]
  - @cosmicdrift/kumiko-framework@0.379.0

## 0.378.0

### Minor Changes

- a08f6d6: The tenant "Email sending" screen is a standard settings form. The provider is a select with "Platform sending (default)" and "Own SMTP server"; the SMTP fields sit in the same form with one save.
  
  A selector owner without panels now generates one configEdit screen `<owner>-tenant` instead of a dashboard around a dormant `<owner>-tenant-selection` form. The provider select gets an empty option for "no own provider", labelled by `<field label key>.platformDefault` or the generic `config.settings.provider.platformDefault`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Extension-selector settings form is one standard configEdit screen
  detail: Without owner panels the provider form is the `<owner>-tenant` screen itself (no dashboard, no `<owner>-tenant-selection`). The provider select offers an empty "platform default" option next to the plugin ids.
  -->
  
  <!-- kumiko-changes
  feature: mail-foundation
  type: improvement
  title: Email sending offers a platform default and an own SMTP server
  detail: The provider field is labelled "Send via" with the options "Platform sending (default)" (empty, saved as "") and "Own SMTP server"; the SMTP fields show only while the own server is picked.
  -->
- a08f6d6: Only the SystemAdmin edits templates by default. An app unlocks TenantAdmins per kind and slug with `createTemplateResolverFeature({ tenantEditable: [{ kind, slug, access }] })`; reading and delivery are unchanged. Template collections without an `access` rule are SystemAdmin-only. The document designer takes `createDocumentDesignerFeature({ access })` for its editor screens, and `composeRendererStack` passes `templateResolver` options through.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: Template editing is SystemAdmin-only unless the app unlocks it
  detail: Every tenant write handler, the overview and resource upload accept SystemAdmin only, plus the roles of the tenantEditable entries. A write on a template that is not unlocked fails with templateNotTenantEditable. The test send follows the same rule. For a non-SystemAdmin an unknown template id answers 403 like a locked one, so the response does not reveal whether it exists. Collections without an access rule default to SystemAdmin.
  migration: Where TenantAdmins must keep editing a template, pass tenantEditable to createTemplateResolverFeature, for example tenantEditable: [{ kind: "mail", slug: "billing:notify:invoice-issued", access: { roles: ["TenantAdmin"] } }]. Give template collections an explicit access rule if tenants should manage them.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: breaking
  title: Designer screens are SystemAdmin-only unless the app passes access
  detail: The templates screen, layout, PDF and mail editors are visible to SystemAdmin only by default. createDocumentDesignerFeature takes an optional access rule whose roles are added.
  migration: Pass createDocumentDesignerFeature({ access: templateEditAccess(tenantEditable) }) with the same entries given to the template resolver when TenantAdmins edit templates.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack forwards templateResolver options
  detail: RendererStackOptions.templateResolver is passed to createTemplateResolverFeature, so an app can set tenantEditable.
  -->

### Patch Changes

- 2d7ee3e: Document PDFs can embed the images of a record
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Document PDFs embed the images of a record
  detail: A template variable of type images (templateVariable.images()) holds FileRef ids of the record. The new Images block (div[data-images], PDF templates only, rejected for mail kinds) renders them as data-URI images in the real PDF render. Only files of the rendering tenant are read, only png, jpeg, gif and webp, at most 24 images and 20 MB per document; missing, foreign, oversized or non-image ids are dropped silently. Previews and draft PDFs never read files and show one placeholder box per block. An images variable never renders as inline text. i18n keys template-resolver.documentEditor.images, template-resolver.documentEditor.imagesVariable and templateResolver.errors.document.imagesBlockPdfOnly ship in de, es, fr and it.
  migration: Declare a template variable with type `images`, place the Images block, and pass FileRef ids of the record in `variables`. Images resolve only in the real PDF render, previews show placeholders. The ids must come from the record on the server, never from client input: a resolved id is read for the whole tenant without an entity access check.
  -->
- f47cbd1: Files fields show download and PDF preview on detail screens
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Files fields show download and PDF preview
  detail: A read-only detail field with renderer { format: "file" } (projectionDetail, readOnly edit field) lists each file with its name and a download link; PDFs get an inline preview toggle. New optional primitive FileValueList, and PdfPreview (moved here from the document designer) with a per-source bounded document cache so several PDFs can share a page. i18n keys kumiko.field.file-list.download/preview/hidePreview and kumiko.widget.pdf-preview.* ship in de, es, fr and it.
  migration: PdfPreview is now exported from @cosmicdrift/kumiko-renderer/web (props: source {base64}|{url}, testId).
  -->
- Updated dependencies [2d7ee3e]
- Updated dependencies [0250376]
- Updated dependencies [a08f6d6]
- Updated dependencies [6352d97]
  - @cosmicdrift/kumiko-framework@0.378.0

## 0.377.0

### Patch Changes

- Updated dependencies [e552c13]
- Updated dependencies [c00af64]
- Updated dependencies [60a29a8]
- Updated dependencies [9400d43]
- Updated dependencies [c00af64]
- Updated dependencies [c00af64]
- Updated dependencies [fd450c2]
  - @cosmicdrift/kumiko-framework@0.377.0

## 0.376.0

### Patch Changes

- Updated dependencies [6a15526]
- Updated dependencies [e3e3faa]
  - @cosmicdrift/kumiko-framework@0.376.0

## 0.375.0

### Patch Changes

- 5c7b19e: Template documents can be read as blocks and patched as a draft
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Read a mail or PDF template as blocks and change it with structured operations
  detail: The query `template-resolver:query:document-blocks` returns a document template as blocks with stable ids (b0, b1, ...), its meta, variables, allowed block types and uploaded image keys, plus a `base` (scope and version). The write `template-resolver:write:patch-draft` applies up to 50 operations (insertBlock, replaceText, removeBlock, setResource, setMeta, setVariable) to that state and stores the result as the caller's tenant draft; an active version keeps being served until publish. Block ids refer to the state that was read. If the template changed since `base` was read, the call fails with `version_conflict` and writes nothing; a patch that removes a required placeholder or sets variables a notification declares is refused. `writeTemplateRow` accepts an optional `expectedVersion`. The universal helpers `placeholder-text` and the toolbar block sets moved out of `web/` without changing the web exports.
  -->
- @cosmicdrift/kumiko-framework@0.375.0

## 0.374.0

### Minor Changes

- 926e08e: Dashboards bound to a record, with header actions, auto refresh and relative times
  
  `DashboardScreenDefinition.record: { param, payloadKey?, query?, titleField? }` ties a dashboard to one record via a URL search param. The id is merged into every panel and `visibleWhen` gate query after `filter`/`timeRange` and before a panel's own `params`; screen-kind panels get none. Without the param the dashboard shows a hint (`kumiko.dashboard.record.missing`) and runs no query. `record.query` loads the record row for the page title (`titleField`), the actions and `refresh.field`.
  
  `actions` puts writeHandler, navigate and clientAction actions in the dashboard header, running on the record row (or `{ id, [payloadKey]: id }` without `record.query`). After a success the record and all panels refetch. The header bar is the shared `HeaderActionsBar` component also used by projectionDetail. Boot rejects actions without `record`, drawer actions, `rowClick` and `redirect`.
  
  `refresh: { seconds } | { field }` polls the record and all panels, never faster than 5 s (`DASHBOARD_MIN_REFRESH_SECONDS`): boot rejects `seconds` below it, a `field` value is clamped at runtime. A running refetch is never stacked and polling stops on unmount.
  
  `valueFormat: { kind: "relativeTime" }` on stat panels and `{ kind: "relativeTime", atMs }` as a text param render epoch ms via `Intl.RelativeTimeFormat` in the user locale ("5 minutes ago", "in 30 seconds") and keep ticking while mounted.
  
  fillAction is only allowed on text, number, decimal and bigInt fields and rejected on password, sensitive and writeOnly ones; an actionForm `load` never fills those fields from the loaded record. The email clientActions answer a 429 with the new `auth.errors.tooManyRequests` instead of the login-specific rate-limit text.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Dashboard record binding, header actions, refresh and relative time
  detail: Dashboards take record, actions and refresh; stat panels and text params gain a relativeTime format; the surface keys include kumiko.dashboard.record.missing.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: DashboardChartPanel.valueFormat only takes the currency format
  detail: DashboardValueFormat is now a union of DashboardCurrencyFormat and DashboardRelativeTimeFormat. Stat panels take both, chart panels only the currency one, and boot rejects relativeTime on a chart.
  migration: A chart panel that declares valueFormat keeps working with { kind: "currency", currency }. Code that types a chart's valueFormat as DashboardValueFormat should use DashboardCurrencyFormat instead; relativeTime on a chart was never meaningful and now fails boot.
  -->
- 8e735ed: progress-list rows take used/limit, an unlimited state and a danger tone
  
  A `progress-list` row may return `used` and `limit` (`number | null`) instead of `value` and `fraction`. The panel shows "used / limit" with the viewer's number format and fills the bar with `used / limit`. `limit: null` shows "used / unlimited" without a bar. The new row field `tone` (`DashboardProgressTone`: `"default" | "danger"`) colors bar and value; used/limit rows turn `danger` automatically once `used >= limit`, and an explicit `tone` wins. `ProgressListRow.fraction` accepts `null` (no bar) and gains `tone`. New translation key `kumiko.dashboard.progress.unlimited` in the defaults and the de, es, fr and it bundles.
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: progress-list rows take used/limit, an unlimited state and a danger tone
  detail: A progress-list row may return used and limit (number or null) instead of value and fraction; limit null shows "used / unlimited" without a bar. Row tone "danger" (automatic once used >= limit in used/limit rows) colors bar and value. ProgressListRow.fraction accepts null and gains tone.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: DashboardProgressTone type and unlimited label key
  detail: New exported type DashboardProgressTone for progress-list row tones. The default translations gain kumiko.dashboard.progress.unlimited.
  -->

### Patch Changes

- Updated dependencies [40b8667]
- Updated dependencies [de5d674]
- Updated dependencies [47e3a05]
- Updated dependencies [926e08e]
- Updated dependencies [1d72366]
- Updated dependencies [c3df9a2]
- Updated dependencies [1b710f1]
- Updated dependencies [8e735ed]
- Updated dependencies [fc221ab]
  - @cosmicdrift/kumiko-framework@0.374.0

## 0.373.0

### Patch Changes

- Updated dependencies [6913834]
- Updated dependencies [6913834]
  - @cosmicdrift/kumiko-framework@0.373.0

## 0.372.0

### Patch Changes

- 7c04d2a: Screen-reader labels in the app shell are translated
  
  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Sidebar, breadcrumb, drawer and table labels for screen readers follow the user's language
  detail: The sidebar toggle ("Toggle Sidebar"), the sidebar rail, the title of the mobile sidebar sheet, the breadcrumb landmark, the drawer's close button, the close button of the workspace editor panel and the actions column of tables had hard-coded English names. They now come from the translations in de, en, es, fr and it (`kumiko.sidebar.*`, `kumiko.breadcrumb.label`, `kumiko.list.actions`, `kumiko.dialog.close`).
  -->
- Updated dependencies [a4401ab]
- Updated dependencies [de53a14]
- Updated dependencies [236858e]
- Updated dependencies [5cd8710]
- Updated dependencies [27b759f]
- Updated dependencies [221f81c]
- Updated dependencies [dca222d]
- Updated dependencies [2cb8b4f]
- Updated dependencies [4224023]
- Updated dependencies [9bc4bc4]
  - @cosmicdrift/kumiko-framework@0.372.0

## 0.371.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.371.1

## 0.371.0

### Patch Changes

- 5a822b2: Consumer findings from the second rollout wave
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Default mail resolveEmail finds users of any tenant
  detail: The default resolveEmail of the mail boot option loads the user by id only. Rows in read_users carry the system tenant, so the former tenantId filter returned null for every real tenant.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: extraContext factories see the boot env, billing hook and new exports
  detail: The merged env, including the defaults of declarative boot options such as FILE_STORAGE_PROVIDER from fileStorage, is passed to extraContext factories as env. resolveBillingOption, parseRunMode, HostDispatchFn, buildDemoModeRoute and withDemoReadOnlyFetch are exported from the package index. The billing boot option accepts afterSync.
  -->
  
  <!-- kumiko-changes
  feature: file-provider-s3
  type: improvement
  title: S3 endpoint over http outside production
  detail: s3EndpointSchema rejects http on non-loopback hosts only when NODE_ENV=production, so compose hostnames such as minio work in smoke setups.
  -->
  
  <!-- kumiko-changes
  feature: auth-foundation
  type: improvement
  title: Boot warning when anonymous routes run without anonymousAccess
  detail: A boot warning names anonymousAccess when host-routing, managed-pages or legal-pages is mounted without it; anonymous requests get no tenant until the option is set.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Billing webhook sync exposes afterSync
  detail: The billing webhook sync calls afterSync({ tenantId, tier, changed, event }) after every webhook, with changed false when the tier stayed the same.
  -->
  
  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Unsubscribe endpoint answers form posts with an HTML page
  detail: POST on the delivery unsubscribe route returns an HTML confirmation page for a form post and JSON for a bare POST. The behavior is unchanged; this only documents it.
  migration: Clients that post the unsubscribe form expect HTML, API clients that post without a form content type expect JSON. No code change is needed.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Dry-run env table and boot check respect required overrides and the fileStorage default
  detail: The env table of KUMIKO_DRY_RUN_ENV=boot shows a variable as required when the app schema overlays required() on an optional field, and the error says required. The schema-cli boot check applies runProdApp's fileStorage default instead of demanding FILE_STORAGE_PROVIDER.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Scaffold test:dom passes without test files
  detail: The scaffold sets test:dom to pass without test files and adds the devDependencies @testing-library/react, @testing-library/dom and @happy-dom/global-registrator.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Pre-push shim stops at the repo boundary, nearest kumiko.json wins, process.env guard covers bin
  detail: The pre-push shim searches upward only through ancestors up to the git root and fails with a message when nothing is found. findLocalRepo prefers the nearest kumiko.json over the git root. guard-no-direct-process-env scans bin/**/*.ts including bin/ops.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeGdprStack access, composePagesStack terms, migrate-step project name
  detail: composeGdprStack({ access }) is passed to compliance-profiles and composeOpsStack({ access }) to delivery as their handler roles. composePagesStack({ terms }) is passed to legal-pages. DevHostDispatch and DevHostDispatchResult are exported. The migrate-step.sh template and the managed pre-push template follow the show-pony version, with the compose project name taken from docker compose config.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: improvement
  title: kumiko codemod lists and runs codemods
  detail: kumiko codemod lists the codemods without a name. kumiko codemod <name> runs one against the current directory as a dry run and applies it with --write.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Missing-screen page spaces title and hint like other cards
  detail: The page-not-available card renders title and hint through the Card title and subtitle slots.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: errors.demoReadOnly translated
  detail: The read-only demo error has German copy in the informal and formal catalogs.
  -->
  
  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: errors.demoReadOnly translated
  detail: The read-only demo error has Spanish copy.
  -->
- Updated dependencies [5a822b2]
  - @cosmicdrift/kumiko-framework@0.371.0

## 0.370.0

### Minor Changes

- 2930518: Unsubscribe pages wear the tenant's mail look
  
  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Unsubscribe confirmation, result and link-invalid pages look like the tenant's mails
  detail: The pages behind a mail's unsubscribe link now show the tenant's brand row (logo from managed-pages branding or the initial tile, name, brand suffix), the accent color, the site band and the mail footer (footer text, imprint, privacy) in a centered card with the bundled IBM Plex Sans font served same-origin, no external font CDN. Every state (confirm, unsubscribed with undo, subscribed again, failed, link invalid or expired) is translated in en, de and es and fits 375 px. The page answers with its own CSP (default-src 'none', the style block by sha256 hash, font-src 'self', img-src 'self' data: plus the logo's https origin, form-action 'self'). A browser GET or form POST with an invalid or expired token now gets a 400 HTML page instead of JSON (expired tokens keep the tenant's look and the mail's language, forged ones get the plain page in the Accept-Language language); JSON and one-click requests answer as before. Mail renderers can implement the new optional RendererPlugin.readMailChrome (renderer-mail-html does) which the system-only query delivery:query:unsubscribePageChrome reads. renderUnsubscribeResultPage takes an optional chrome and the new kind "invalid" for an app's own dead links; apps with their own CSP need style-src 'unsafe-inline' and the logo origin for it.
  -->

### Patch Changes

- a02e354: New bundled feature account-security
  
  <!-- kumiko-changes
  feature: account-security
  type: improvement
  title: createAccountSecurityFeature bundles the self-service screen for MFA and own sessions
  detail: createAccountSecurityFeature({ nav?, access? }) registers account-security:screen:account-security, a dashboard that embeds the auth-mfa enable, regenerate and disable screens and the sessions list of the signed-in user. It owns no handlers; mount it next to auth-mfa and sessions, or let composeAuthStack({ mfa }) mount it. Without nav the screen is dormant (no sidebar entry); nav takes { order?, parent? } with order 90 by default. access defaults to every signed-in user. Apps with a local copy of this screen replace it with the bundled feature.
  -->
- 2930518: Mail editor: informal German, tenant sender hint, readable button chips
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Designer addresses the user informally in German, points tenant-routed senders to Email sending and renders chips inside buttons
  detail: All German document designer strings use du like the rest of the framework; the formal locale overrides keep Sie. For a notification with tenantTransport the sender hint in the mail editor says the address comes from the tenant's Email sending settings and links to that screen when the app mounts it; TemplateUsageEntry gains tenantTransport. A placeholder chip inside a button block is now drawn in inverted colors so the button text stays readable in the editor.
  -->
- Updated dependencies [8ff5d19]
- Updated dependencies [79a0aa6]
- Updated dependencies [8ff5d19]
- Updated dependencies [4a6e151]
- Updated dependencies [c051152]
- Updated dependencies [8ff5d19]
- Updated dependencies [8ff5d19]
  - @cosmicdrift/kumiko-framework@0.370.0

## 0.369.0

### Minor Changes

- 57c0cff: Tenant admins edit their own mail server in the settings
  
  <!-- kumiko-changes
  feature: mail-transport-smtp
  type: breaking
  title: Tenant admins edit their own SMTP server on the Email sending screen
  detail: mail-foundation's provider key and the SMTP keys (host, port, SSL/TLS, user name, sender address) carry settings masks, so the generated Settings-Hub shows tenant admins one Email sending form: the provider choice, the chosen provider's connection fields and its password, each field with a help text and every label in English, German and Spanish, saved together by one Save button in one /api/batch. Switching the provider swaps the fields at once; fields of a provider that is not selected are not saved. A selector owner's selection screen (`<owner>-tenant-selection`) now carries the plugins' config keys (field id `<owner>-<key>`) and secrets (field id `<plugin>-<key>`, listed in the new ConfigEditScreenDefinition.secretKeys) behind a visible condition on the provider field; the separate `<plugin>-tenant` and `<plugin>-tenant-secrets` screens and their dashboard panels are gone, and so is the `config.settings.saveProvider` label. A secret with its own writeRoles stays on the global secrets screen. Boot validation checks every secretKeys field (tenant scope, writeOnly text, declared secret). The configEdit renderer loads secretKeys fields from secrets:query:list (set or unset, no preview), writes them with secrets:write:set or secrets:write:delete in the same batch, and leaves hidden fields out. The provider key is no longer required: empty means the tenant has no own server and the platform sends, so readiness no longer reports it as missing (createTransportForTenant still throws on an empty provider). The provider and SMTP keys are written by TenantAdmin and the system identity, no longer by SystemAdmin, because a platform-level provider would reach every tenant without that tenant's password. The secrets set and delete handlers also admit the system identity, so server code stores a tenant secret via dispatchSystemWrite through the same key and value checks as an admin; the settings screens keep showing only the human roles. The provider choice shows each plugin's `<feature>.settings` name, also for a plugin without settings of its own, and keeps the English name when a locale feature mounted earlier declares the same key in its own language only. A MailTransportPlugin with `selectableInSettings: false` stays allowed on the server but is not offered in the form; the in-memory transport sets it, because apps mount it next to smtp in production and a tenant admin picking it would drop every mail. A plugin's secrets section takes an optional `<feature>.settings.secrets` title (SMTP password under "SMTP sign-in").
  migration: E2E specs that used the testIds `dashboard-panel-<plugin>-tenant`, `dashboard-panel-<plugin>-tenant-secrets` or the separate secret input of these screens address the fields of `<owner>-tenant-selection` instead (one Save). Code that wrote these keys as a SystemAdmin user writes them as the tenant's TenantAdmin or via dispatchSystemWrite. Apps that relied on readiness flagging an empty provider check it themselves.
  -->

### Patch Changes

- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [a4cab24]
  - @cosmicdrift/kumiko-framework@0.369.0

## 0.368.0

### Patch Changes

- Updated dependencies [133ef08]
- Updated dependencies [fbc0759]
- Updated dependencies [7949df2]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [478ee1f]
- Updated dependencies [1404b33]
  - @cosmicdrift/kumiko-framework@0.368.0

## 0.367.0

### Minor Changes

- a0db2ac: Unavailable-screen empty state, projectionDetail title, folder picker
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: A route to a screen missing from the schema shows an empty state
  detail: A tenant-disabled feature, stale link or typo no longer falls back to the first feature or shows "Screen not found: <qn>". The app renders "This page is not available" with a button to the landing screen; the qualified name only goes to the console. New i18n keys kumiko.screen-missing.title, .hint and .home (en, de, es). The access-denied banner of KumikoScreen and the toolbar drawer is now translated too (kumiko.screen-access-denied.title) and no longer prints the qualified name.
  migration: e2e checks on the text "Screen not found" should use the testId kumiko-screen-not-found; the testIds are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: projectionDetail drops the duplicate title block
  detail: A screen with recordTitleField no longer repeats the screen title above the form when the page header already shows the record title.
  -->
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: FileUploadInput folder mode
  detail: FileUploadInput takes directory (sets webkitdirectory and multiple) and onFilesPicked. In directory mode it uploads nothing and hands the picked File[] with webkitRelativePath to the callback. Web-only: the input is not part of the cross-platform primitive contract.
  -->

### Patch Changes

- f6b1803: Mail footer texts come from the i18n system
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: breaking
  title: Mail footer texts come from the i18n system
  detail: The "Sent by" line of the default mail layout, the unsubscribe label and the imprint and privacy labels now come from the mail translations (mail.footer.sentBy, mail.footer.unsubscribe, mail.footer.imprint, mail.footer.privacy). English ships with the renderer, German and Spanish with locale-de and locale-es; an unknown locale falls back to its root language and then to English. MailFooterLink.label is optional and defaults to the framework text. The default layout renders the sender line through the new mailSentBy placeholder. MAIL_CHROME_EN exports the English source texts for translation tooling.
  migration: Apps that send German or Spanish mails mount localeDe() or localeEs(), otherwise the footer labels are English. A mail layout already stored from the old default keeps its fixed "Sent by" text until it is reseeded or edited.
  -->
- 5f2cc2f: Unsubscribe links use the tenant's host and the mail's language, apps learn about address opt-outs
  
  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Unsubscribe links use the tenant's host and the mail's language, apps learn about address opt-outs
  detail: unsubscribeLinks and the runProdApp option unsubscribe take tenantOrigin, an app callback that returns the sending tenant's own origin (subdomain or custom domain) per send; null, a throw or a non-https value fall back to the app origin and never fail the send. The signed token now carries the mail's locale (notify option locale), so the confirmation, result and undo pages render in that language; tokens without it keep working and show English. A form post to the resubscribe route now answers with an HTML page, JSON callers are unchanged. After a committed address opt-out an app job declared with trigger on DeliveryHandlers.unsubscribeAddress receives addressHash, notificationType and channel (unsubscribeAddressPayloadSchema) with the tenant in ctx.triggeredBy.tenantId; hashUnsubscribeAddress(email) matches it to the app's own subscriber. UNSUBSCRIBE_PAGE_EN exports the English page texts, German and Spanish come with the locale packages.
  -->
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [04bf143]
  - @cosmicdrift/kumiko-framework@0.367.0

## 0.366.0

### Patch Changes

- 3d58dea: Error boundaries keep a render error from blanking the whole page
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: A throwing screen shows an error card instead of a blank page
  detail: createKumikoApp wraps the active screen in a boundary that keeps the shell and navigation visible, shows a card with the screen name and a reload action, and resets on route change. A second boundary around the whole app shows a minimal provider-free fallback. Both log the error with console.error. createKumikoApp takes an onError option for telemetry. kumiko-testing/e2e exports boundaryGuardedTest, a plain Playwright test that fails a spec when a boundary caught an error; the seeded test builds on it.
  -->
- Updated dependencies [22b7f6e]
- Updated dependencies [15d76a8]
- Updated dependencies [8a7d835]
- Updated dependencies [7053800]
- Updated dependencies [5df8e3a]
- Updated dependencies [22b7f6e]
- Updated dependencies [7053800]
  - @cosmicdrift/kumiko-framework@0.366.0

## 0.365.1

### Patch Changes

- Updated dependencies [93e1a7d]
- Updated dependencies [9a8abc9]
- Updated dependencies [34530bf]
- Updated dependencies [8633239]
- Updated dependencies [34530bf]
  - @cosmicdrift/kumiko-framework@0.365.1

## 0.365.0

### Patch Changes

- 45abe9d: The document designer names seeded mails, opens in the UI language and shows the built-in layout
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Seeded mails show readable titles and the editor opens in the UI language
  detail: A mail template without a stored title is named by its notification label (<feature>:notify.<name>.label) in the overview and the editor header instead of its slug. The mail editor opens on the UI language, or its base language, when the template has it, and falls back to the previous choice otherwise. The layout select offers the built-in standard layout when no default layout is stored, and the preview text field shows a hint while empty.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Auth mails carry designer labels
  detail: The feature registers <feature>:feature.label and notify labels for password-reset, account-unlock, email-verification, signup-activation and invite, so the document designer lists them by name. German and Spanish ship in the locale packages.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: GDPR mails carry designer labels
  detail: Feature and notify labels for export-ready, export-failed, deletion-requested and deletion-executed name the GDPR mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Contract mails carry designer labels
  detail: Feature and notify labels for contract-confirmation, contract-termination-receipt and contract-termination-operator-notice name the contract mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: improvement
  title: Waitlist mails carry designer labels
  detail: Feature and notify labels for confirmation and admin-notice name the waitlist mails in the document designer.
  -->
- 45abe9d: Structured mails render as a card with a brand row, a toned chip and top line, a steps block and a footer band
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Structured mail layouts render as a card with a footer band
  detail: The structured frame now draws a rounded white card with a border on the outer background. The top line sits inside the card, the footer region goes into a grey band at the bottom of the card, and the platform line from the footer resolver sits below the card. The in-code layout uses 640 px width and #ecedea as outer background and shows the tenant logo at 28 px height beside the tenant name, or an initial tile in the accent colour when no logo is set. Mail headings carry inline sizes (h1 30 px bold) and small text renders at 13 px. Existing structured layouts change their look accordingly; mjml layouts are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Mail meta headerChip, tone and footerNote
  detail: A mail template can set meta.headerChip (a chip right of the brand row), meta.tone (accent, info, success, warning, danger or neutral; colours the chip, the top line of the card and the steps block) and meta.footerNote (a line above the site and unsubscribe links in the card band). All three accept placeholders and are rendered escaped; an unknown tone falls back to the accent colour. The band links the tenant site from the branding siteUrl next to the unsubscribe link. createRendererMailHtmlFeature({ brandSuffix }) adds a word after the tenant name in the brand row.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Steps block in mail and PDF templates
  detail: The document editor offers a steps block in the toolbar block menu. It stores a fixed list of stages (value=label, at most 8) and the variable that names the current stage. Mail and PDF render it as a row of bars and labels; stages up to the current one are coloured, the current label is bold. Invalid blocks are dropped by the sanitizer and render nothing. Layout regions do not offer the block.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack passes a mail brand suffix resolver
  detail: composeRendererStack({ mailBrandSuffix }) hands the resolver to createRendererMailHtmlFeature as brandSuffix.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Mail editor rail edits header chip, tone and footer note
  detail: The properties rail of the mail editor has a section "Kopf und Fuß" with the header chip and the footer note as placeholder lines and the tone as a select (accent, info, success, warning, danger, neutral). The values are saved in the mail meta and show in the preview right away. A tone stored as placeholder stays as its own option; the accent tone is stored as no tone. template-resolver/web exports MAIL_TONES and MailTone.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: PDF steps block uses the branding accent colour
  detail: The steps block in a PDF document is coloured with the accent colour from the tenant branding, like in mails, and falls back to #1f5468 when no branding colour is set.
  -->
- Updated dependencies [cd16f29]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [7aa3223]
- Updated dependencies [efa6253]
- Updated dependencies [7e1b974]
- Updated dependencies [ec7d696]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [fbc6938]
- Updated dependencies [5a1cdc1]
- Updated dependencies [efa6253]
- Updated dependencies [80e2132]
- Updated dependencies [72a5c9c]
- Updated dependencies [82dc9a4]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [59bbd15]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [a546703]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [5c276e6]
- Updated dependencies [21c5cbc]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [b6b75fa]
- Updated dependencies [0f8bff5]
- Updated dependencies [067aa7b]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
  - @cosmicdrift/kumiko-framework@0.365.0

## 0.364.0

### Minor Changes

- 68078ee: Spanish text for discarding a template draft
  
  Adds templateResolver.errors.noDraft.
  
  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish text for discarding a template draft
  -->

### Patch Changes

- 8be3807: Stripe customer portal reports an unknown customer as a business error
  
  <!-- kumiko-changes
  feature: subscription-stripe
  type: fix
  title: A stale Stripe customer id no longer turns the customer portal into a 500
  detail: createPortalSession now maps Stripe's "No such customer" rejection (account switch, customer deleted in the dashboard) to an UnprocessableError with the i18n key billing-foundation.errors.providerCustomerUnknown, translated in German and Spanish, instead of letting the raw Stripe error surface as a server error.
  -->
- Updated dependencies [8e81d73]
- Updated dependencies [e9b032f]
- Updated dependencies [cfbffba]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [6b1567e]
- Updated dependencies [2b255c2]
- Updated dependencies [8e81d73]
- Updated dependencies [8be3807]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [dfb2523]
- Updated dependencies [8fb6aa6]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [5a39305]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [f1b4367]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [22f40e1]
- Updated dependencies [5a2bea5]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [15039ce]
- Updated dependencies [b5a6395]
- Updated dependencies [fd5009a]
- Updated dependencies [55f003d]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
  - @cosmicdrift/kumiko-framework@0.364.0

## 0.363.0

### Patch Changes

- b022cca: Document PDFs are rendered from stored templates by renderer-puppeteer-client

  <!-- kumiko-changes
  feature: renderer-foundation
  type: breaking
  title: document-pdf requests name a template, the response carries fileName
  detail: The document-pdf payload is { slug, locale, variables } instead of ready HTML in content. The response has a fileName, RendererContext gets an optional filesForTenant (file access per tenant) and RendererError has the new code unavailable for a renderer backend that cannot be reached.
  migration: |
    Callers that sent `payload: { content }` switch to a document-pdf template and pass slug, locale and variables (money-horse credit-schedule-pdf follows in #621); renderer-pdf callers pass slug and locale too. The enterprise package @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client no longer builds against these types and is replaced by @cosmicdrift/kumiko-renderer-puppeteer-client.
  -->

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: breaking
  title: renders document-pdf from templates, adds renderAndStorePdf, the rendered-pdf entity and puppeteer-status
  detail: The plugin resolves the document-pdf template and its pdf-layout (header, signature, footer), embeds every image as a data URI and sends finished HTML to the puppeteer-service. renderAndStorePdf(ctx, { slug, locale, variables, attachTo? }) stores the PDF as a file and a rendered-pdf record with the template and layout version. The puppeteer-status query reports whether the service answers; while it does not, rendering fails with PuppeteerUnavailableError (HTTP 503, puppeteer_unavailable). The feature adds the table rendered_pdfs.
  migration: |
    Call renderAndStorePdf(ctx, { slug, locale, variables, attachTo? }) from a write handler; no escape hatch or rendererDb is needed because the tenant db also reads system templates and files. Apps that mount renderer-puppeteer-client need a schema migration for rendered_pdfs (`kumiko schema generate`). PUPPETEER_SERVICE_URL and PUPPETEER_AUTH_TOKEN stay as before. image-snapshot requests are unchanged.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Mails can attach a PDF that is rendered from a document template when the mail is sent
  detail: notify data.attachments accepts { kind: "rendered-pdf", templateSlug, variables, fileName, locale? }. The send job renders the PDF through the document-pdf renderer, so the job payload carries the variables (at most 64000 bytes as JSON), not the bytes. Variables are stored in the job payload, so keep personal data out of them or accept that retention.
  -->

  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: Email channel sends rendered-pdf attachments
  detail: The channel resolves rendered-pdf entries from notify data next to file entries; without a locale the message locale is used. A render failure fails the send job, so the retry runs it again.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Images in layout regions, exported document-kit helpers
  detail: A mail layout region can contain images (data-resource) that are sent as inline attachments. The document helpers (createDocumentHandlebars, compileDocumentSource, readDocumentFormat, readTenantName, resolveResourceFileRefs, collectRegionResourceKeys, mergeResourceFileRefs) are exported, so other renderers format documents the same way.
  -->

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: The service performs no network fetches
  detail: Only data:, about: and blob: requests are allowed, everything else is aborted. The client embeds all resources as data URIs, so there is no DNS rebinding and no reachable node IP or kubelet. Margins accept 0.
  -->

  <!-- kumiko-changes
  feature: renderer-foundation
  type: improvement
  title: renderer plugins can preview a document
  detail: RendererPlugin gets the optional capability previewDocument(req, ctx), which returns the filled-in body and layout regions without calling the print service. template-resolver:query:preview with kind document-pdf uses it, so the editor shows replaced placeholders and the resource and required-placeholder checks; without such a plugin the preview keeps returning the body and raw layout.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: Preview uses the examples of a stored or draft variable schema
  detail: A template's variableSchema kept only type and required, label and example were dropped, so the preview showed [name] instead of the declared example. The schema now keeps label and example, for mail and document previews.
  -->

- 2972bc2: Error texts for template meta and placeholder validation, formatMoney delegates to headless, feature manifest refreshed

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: error texts for template meta and placeholder validation in German and Spanish
  detail: The locale packages carry the new templateResolver.errors keys (invalid meta, unknown and missing placeholders, mail layout format, collection kind not allowed); renderer-web's formatMoney delegates to headless and the create-kumiko-app feature manifest is refreshed.
  -->

- f3fe91e: Template preview and test mail

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Preview query and send-test write for mail and PDF templates
  detail: template-resolver:query:preview renders a draft, or the stored template when no content is given, with sample values from the declared variable examples (list variables get two rows). The draft passes the same write gates as a save and a mail goes through the real mail renderer, so subject, html, plain text and inline images match a real send. The response carries checks (images resolved, plain text present, size under 10 MiB, required placeholders used); a PDF template returns its sanitized body and the layout regions. template-resolver:write:send-test mails the rendered mail to the calling user's own address only, subject prefixed with [TEST], limited to 10 per user and hour. It needs delivery, channel-email and renderer-mail-html.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: EMAIL_CHANNEL_NAME, createTemplateMailRenderer and createEmailAttachmentReader are exported
  detail: The email channel name is a shared constant instead of a string literal. The mail renderer and the inline-attachment reader that build the channel context are exported and accept a tenant-bound db, so a handler can send through the same path as a notification.
  -->

  <!-- kumiko-changes
  feature: renderer-foundation
  type: improvement
  title: MailPayload.draft renders an unsaved mail template; RendererContext.db also accepts a TenantDb
  detail: MailDraft (content, meta, variableSchema) replaces the stored body and subject of the template with the payload's slug and keeps its stored images; a slug without a stored template renders as a tenant draft. The renderer sanitizes the draft body and validates its meta again, and the response carries no template provenance. RendererContext.db is widened from DbConnection to DbRunner | TenantDb.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Renders a MailPayload.draft instead of the stored template body and subject
  detail: With a draft the stored template of the slug only supplies its linked images and variable schema; the body goes through the document sanitizer and the meta through the mail meta check, and a violation is an invalid_payload error. The response has no template reference because a draft is not a stored version.
  -->

- Updated dependencies [045f886]
- Updated dependencies [a12e094]
- Updated dependencies [58452ae]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [cbed66e]
- Updated dependencies [366d89f]
  - @cosmicdrift/kumiko-framework@0.363.0

## 0.362.0

### Patch Changes

- Updated dependencies [61f7dd2]
- Updated dependencies [b6870d9]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [75d3e38]
  - @cosmicdrift/kumiko-framework@0.362.0

## 0.361.0

### Minor Changes

- a3a51aa: An entity can declare `lockedWhen: FieldCondition`, for example `lockedWhen: { field: "status", eq: "closed" }`. The event-store executor refuses `update` and `delete` on a stored row whose state meets the condition, so generic CRUD, custom handlers (whatever they return), nested `ctx.write` and jobs running as a regular user are all covered. The write answers 409 `record_locked` (`errors.recordLocked`) and the transaction rolls back, so no event is written. The check reads the state before the write, so the write that sets the lock still passes. A row that lacks the condition field counts as locked. The check runs after the entity and field ownership checks and before the event append, so a caller without write rights sees `ownership_denied`, not 409. `forget` (Art. 17) never checks the lock. A write by the framework system user skips it only when the executor call names a `writePurpose` (`WritePurposes.retention` or `WritePurposes.erasure`, exported from `@cosmicdrift/kumiko-framework/db`); retention cleanup, the user-data erasure hooks and tenant destroy set it, so statutory deletion and anonymisation reach locked rows. A system-user write without a purpose is rejected like any other. A server-code call site that must change a locked row on purpose passes `{ unsafeSkipLockGuard: true }` as an executor option; neither it nor `writePurpose` is ever read from a request payload. Boot rejects a condition on an unknown field, on a `personal` or `encrypted` field, and on any type other than text, longText, select, boolean, number or reference. An `entityEdit` screen without its own `readOnly` shows a locked record as a read-only view, so the condition is declared once; a record that lacks the lock field (for example no read right on it) is always shown as a view, like the server treats it; `screen.readOnly` adds a UI-only condition on top; either one shows the view. A parent delete with `onDelete: cascade` or `setNull` answers 409 for the parent when a child row is locked, instead of removing or detaching it with the parent; this check runs in the dispatch delete lifecycle, so a write handler that returns the result of a parent `forget` is held back by a locked cascade child too. Remaining limits: `restore` is not guarded (it brings back unchanged data), and a custom projection that reacts to a domain event from `ctx.appendEvent` can still change a locked row, because that bypasses the executor. An app-written erasure hook should use `forget`; one that deletes or anonymises a locked row with `delete` or `update` needs `writePurpose: WritePurposes.erasure` as the system user, or `unsafeSkipLockGuard` as a regular user.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EntityDefinition.lockedWhen and the executor options unsafeSkipLockGuard and writePurpose
  detail: lockedWhen is a FieldCondition evaluated against the stored row. update and delete on the EventStoreExecutor take unsafeSkipLockGuard to opt one call out, and writePurpose (WritePurposes.retention or erasure) lets the framework system user through. EntityEditScreenDefinition.readOnly is combined with the entity's lockedWhen (either shows the view).
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Locked records reject executor writes
  detail: The event-store executor checks entity.lockedWhen against the loaded row in update and delete and fails with RecordLockedError (409, code record_locked, i18n key errors.recordLocked); a missing condition field counts as locked. Create, restore, forget, framework-system-user writes that name a writePurpose and the write that sets the lock pass. validateBoot rejects a lockedWhen field that is unknown, personal, encrypted or not a plain scalar type.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityEdit shows locked records as a view
  detail: EntityEditUpdateForm shows the view when screen.readOnly matches or entity.lockedWhen matches or its field is missing from the record. Adds the default string errors.recordLocked.
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German string for locked records
  detail: Adds errors.recordLocked.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish string for locked records
  detail: Adds errors.recordLocked.
  -->

- f2346e5: `primaryAction` on a projectionDetail screen names the header action that renders as the filled primary button; the boot validator rejects an id that is not a header action.

  `emptyState` on an entityList or projectionList defines the title, description and an optional action for an empty list, and `description` now also shows on searchable lists; a search or filter without matches shows its own "no entries match" text (`kumiko.list.empty.filtered`).

  `header.statusToneField` on a projectionDetail screen picks the `statusTones` entry from another record field, so a badge text like "Terminated on 31.03.2027" keeps its tone.

  A writeHandler `redirect` accepts `tab` to open a specific tab of a projectionDetail target.

  File and image fields render as a rectangular thumbnail (variant, then original, then placeholder) or the file name instead of an id, in read-only forms and in list cells; `{ format: "image" | "file" }` selects the same display for list columns.

  On narrow screens the status badge of a projectionDetail header moves into the page body so a long status stays readable, and the header keeps the edit pencil.

  In a flow layout an edit field with `span` takes a full row.

  Writes now reject file and image field values whose file id does not exist or does not belong to the writer's tenant, with a validation error on the field.

  File and image fields only request ids that are UUIDs and encode the id and variant in the URL path.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Writes with file ids from another tenant are rejected
  detail: A create or update that puts a file id into a file or image field now fails with a ValidationError (code invalid_element, path = field name) when the id is not a UUID, does not exist, or belongs to another tenant. That includes files stored under the SYSTEM tenant. On update only the changed fields are checked. The check runs for every write that returns a save result, inside the transaction, before pending file refs are bound. System users created for a tenant pass with that tenant's own files.
  migration: Check seeds, imports and handlers that copy file ids across tenants or reference files uploaded as SYSTEM. Upload the file in the target tenant (or copy it there) before writing its id. A custom handler that writes through an executor directly, without returning a save result, is not covered and needs its own check.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Searchable lists show their description as its own row
  detail: An entityList or projectionList with search used to hide its description. It now renders as a muted row below the toolbar, the same as on lists without search.
  migration: Look at lists that set description together with search. Drop descriptions that were only kept as a hint for developers, or move the text into emptyState if it explains an empty list.
  -->

### Patch Changes

- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [99d1037]
- Updated dependencies [a3a51aa]
- Updated dependencies [4bf01ba]
- Updated dependencies [7f32198]
- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [91fc70e]
- Updated dependencies [99d1037]
- Updated dependencies [99d1037]
- Updated dependencies [f2346e5]
  - @cosmicdrift/kumiko-framework@0.361.0

## 0.360.0

### Minor Changes

- 16fe359: Behaviour change: files uploaded from an update form are now attached to the record. `computeEditViewModel` takes the edited record's id (`entityId`, update mode only) and puts it on the hints of `file`, `image`, `files` and `images` fields. `RenderEdit` passes the id it was mounted with, the file input sends it as the `entityId` part of `POST /api/files`, and the new `buildFileUploadFormData` builds that body. Before, such uploads carried only `entityType` and `fieldName`, so `ctx.derivatives.variant(...)` on a qr-overlay variant threw because the FileRef had no `entityId`. Uploads from a create form are bound to the new record by the create itself: after a successful create, every file id in the record's `file`, `image`, `files` and `images` fields that is still pending (same entity and field, no `entityId`, uploaded by the same user) gets the record id through a regular `fileRef.updated` event in the create's transaction.

  Attached files are readable by everyone who may read their record: the default file access guard runs the entity's `<entity>:detail` query as the requesting user (handler access, row ownership and parent visibility apply) when the user is neither the uploader nor in `privilegedRoles`. Delete stays with the uploader and `privilegedRoles`. Entities without a detail query keep the uploader/privileged rule.

  `images` and `files` fields have an edit widget. `FileListField` shows one tile per stored file with move up, move down and remove buttons plus one empty tile to add a file, and hides the add tile at `maxCount` or when the field is read-only. It is composed from the existing `Input kind="file" | "image"`, `Button` and layout primitives, so web and native primitive sets get it without a new primitive kind. `required: true` on `images`/`files` is now allowed and means "at least one file". `NO_WIDGET_FIELD_TYPES` shrinks to `jsonb` and `embedded`. The edit view model carries `maxCount` for these fields.

  Embedded lists are accessible: every cell control has an accessible name ("Qty, row 2"), also in the mobile card layout, and the row-actions column header uses the translated `kumiko.field.embedded-list.actions` instead of a hard-coded "Actions". `EmbeddedListInput` has a new required `actionsLabel` prop; custom primitive sets must pass it through. `MoneyInput`, `DateField`, `TimestampInput` and `ComboboxInput` accept an optional `ariaLabel`.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Uploads from an update form are attached to the record
  detail: computeEditViewModel accepts entityId (the record being edited, update mode only) and sets it on the hints of file, image, files and images fields; RenderEdit passes the id it was mounted with and the file input sends it as the entityId multipart part of POST /api/files. Create forms send no entityId; after a successful create the write pipeline binds the caller's own pending uploads named in the record's file fields (same entityType and fieldName, entityId null, insertedById = caller) to the new record via a fileRef.updated event in the same transaction, for single and plural file fields alike, when the files feature (fileRef entity) is mounted. Behaviour change: such files are now attached to the record. The default file access guard allows read on an attached file to the uploader, privilegedRoles (default Admin/SystemAdmin) and everyone whose run of the entity's <entity>:detail query returns the record; delete stays uploader and privilegedRoles only. A qr-overlay variant of an image field no longer throws for a file uploaded from an update or create form. Write-form sections send no entityId. EmbeddedListInput has a new required actionsLabel prop.
  migration: Files attached through forms now follow the record's read access instead of being tenant-wide: anyone who cannot read the record no longer reads the file, anyone who can read it does. Check image, images, file and files fields whose files must be visible beyond the record's readers (for example an avatar shown in lists to users without detail access) and add those roles to privilegedRoles or set accessGuard in the files feature options. An entity without a detail query falls back to uploader plus privilegedRoles. Files uploaded before the update keep their old attachment. Custom primitive sets that implement EmbeddedListInput accept the new actionsLabel prop and render it as the actions column header; custom file/image Input primitives forward entityId into the upload and offer a remove control that calls onChange(null).
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: images and files fields get an edit widget; required is allowed
  detail: NO_WIDGET_FIELD_TYPES now holds only jsonb and embedded. required true on an images or files field passes boot validation and the client-side check treats an empty array as missing. The edit view model carries maxCount for files and images fields.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: FileListField edits images and files fields
  detail: RenderField renders type images and files as FileListField instead of the unsupported banner. One tile per stored FileRef id with move up, move down and remove buttons, one trailing empty tile to add a file (hidden at maxCount or when read-only). It is built from Input kind file or image, Button and the layout primitives, passes accept, maxSize, entityType, entityId, fieldName, imageVariant and capture to every tile, and reads only string ids from the stored value. The read-only text display of these fields lists the ids. New i18n keys kumiko.field.file-list.add, move-up, move-down and empty; kumiko.field.file-upload.upload, change, remove, attached and failed; kumiko.field.embedded-list.actions and cell-label. The file and image Input kinds accept entityId. EmbeddedListInput has a new required actionsLabel prop.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: File inputs post entityId; embedded list cells have accessible names
  detail: FileUploadInput accepts entityId, translates its labels (kumiko.field.file-upload.*) and builds its multipart body with the exported buildFileUploadFormData. Every embedded list cell control (text, number, boolean, date, timestamp, money, select, reference) carries aria-label "<column>, row <n>" in the table and the mobile card layout, and the actions column header uses the actionsLabel prop instead of the fixed "Actions". MoneyInput, DateField, TimestampInput and ComboboxInput accept an optional ariaLabel.
  -->

  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: Edit view model carries entityId and maxCount for file fields
  detail: ComputeEditViewModelInput has an optional entityId (the record being edited, omitted on create). EditFieldViewModel gains entityId for file, image, files and images fields and maxCount for files and images. The file-field hints now also cover type files, which was missing.
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings for the file list widget and embedded list accessibility
  detail: Adds kumiko.field.file-list.add, empty, move-down and move-up, kumiko.field.file-upload.attached, change, failed, remove and upload, plus kumiko.field.embedded-list.actions and cell-label.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings for the file list widget and embedded list accessibility
  detail: Adds kumiko.field.file-list.add, empty, move-down and move-up, kumiko.field.file-upload.attached, change, failed, remove and upload, plus kumiko.field.embedded-list.actions and cell-label.
  -->

### Patch Changes

- Updated dependencies [cc46b78]
- Updated dependencies [b0e8bd3]
- Updated dependencies [16fe359]
  - @cosmicdrift/kumiko-framework@0.360.0

## 0.359.0

### Patch Changes

- Updated dependencies [dacda2f]
  - @cosmicdrift/kumiko-framework@0.359.0

## 0.358.0

### Patch Changes

- Updated dependencies [5037fe8]
- Updated dependencies [b182c6c]
- Updated dependencies [067bc4c]
- Updated dependencies [eec3b6b]
- Updated dependencies [e028f23]
  - @cosmicdrift/kumiko-framework@0.358.0

## 0.357.0

### Patch Changes

- Updated dependencies [774c60c]
- Updated dependencies [06e8ad8]
- Updated dependencies [d7872bd]
- Updated dependencies [eb71a72]
  - @cosmicdrift/kumiko-framework@0.357.0

## 0.356.0

### Patch Changes

- Updated dependencies [4e110c4]
- Updated dependencies [4c06248]
- Updated dependencies [77c6851]
  - @cosmicdrift/kumiko-framework@0.356.0

## 0.355.0

### Patch Changes

- 44650be: Edit and detail screens show a localized empty state with a way back to the list for an unknown or deleted record id instead of a hard-coded English banner, and an entity list or detail no longer fails with a 500 when one row's encrypted field cannot be decrypted: that field reads null, the rest of the row and list are served, and the failure is logged at error level with entity, row id and field

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Unknown record ids show a localized empty state; an undecryptable encrypted field reads null instead of failing the whole list
  -->

- Updated dependencies [17496fd]
- Updated dependencies [326bfb5]
- Updated dependencies [c40ac62]
- Updated dependencies [32d725c]
- Updated dependencies [44650be]
  - @cosmicdrift/kumiko-framework@0.355.0

## 0.354.1

### Patch Changes

- Updated dependencies [a5f13a7]
- Updated dependencies [a7b381b]
  - @cosmicdrift/kumiko-framework@0.354.1

## 0.354.0

### Minor Changes

- 8d5fa1a: Select fields gain `conditionalOptions`: options that are only available while a condition on a sibling field holds, filtered in the form and enforced on write.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Select field options can depend on another field
  -->

### Patch Changes

- Updated dependencies [36a08aa]
- Updated dependencies [81153cb]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [a734025]
- Updated dependencies [94eb2fc]
- Updated dependencies [f060e44]
- Updated dependencies [fde53b0]
- Updated dependencies [8307320]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [f060e44]
- Updated dependencies [f1a576b]
- Updated dependencies [a2bafb2]
- Updated dependencies [c10805f]
- Updated dependencies [edcb2d0]
- Updated dependencies [2873c76]
- Updated dependencies [357f33d]
- Updated dependencies [a62e62c]
- Updated dependencies [6bd7df1]
- Updated dependencies [a6d5c20]
- Updated dependencies [b15e90d]
- Updated dependencies [67d8d41]
- Updated dependencies [cc7e2ce]
- Updated dependencies [8d5fa1a]
- Updated dependencies [4803d4c]
- Updated dependencies [a62e62c]
- Updated dependencies [2b0566a]
- Updated dependencies [fde53b0]
- Updated dependencies [13f6b6f]
  - @cosmicdrift/kumiko-framework@0.354.0

## 0.353.0

### Patch Changes

- d32c9b3: Stricter boot checks and role projection for screens and handlers

  Inline handler registration without `options.access` now throws immediately, a section with `fields: []` and `groups: []` fails boot, and unknown tones in `header.statusTones` or select `optionTones` fail boot instead of dropping the badge colour. The renderer falls back to the value heuristic for an unknown tone, and `statusToneForOptionTone` now returns `undefined` for it. `secretMint` confirm-step actions are stripped for roles that cannot see the target screen.

  Entity convention `create` handlers keep tenant-filtered lookups even when the handler declares `escapeHatch`/`crossTenant`. Duplicate `waitForEvent` steps on the same `awaits` event are rejected when the workflow pipeline is built. An empty `PROMETHEUS_METRICS_TOKEN` counts as unset instead of failing boot.

  `GET /api/sse` now closes itself when the JWT it was opened with expires. File uploads must attach to a registered file field (a non-file field answers 400 `unresolvable_field`), and a `.docx` upload must be a ZIP containing `word/` entries. Signature extra routes outside `/api` get the request-body cap (`maxRequestBytes`) before their body is read. `EXT_USER_DATA` registrations with neither an export nor a delete hook fail boot. The dashboard updated-at stamp follows live refetches and retries.

  Text fields accept `minLength` (enforced by the generated write schema), `enumOption` renders array values per entry, list columns can opt out of sorting with `sortable: false`, and `BUILT_IN_MEMBERSHIP_ROLES` exposes the ranked membership roles. The PAT list translates its scopes column, MFA code fields enforce their minimum length, plan checkout no longer repeats the billing-enabled and active-subscription gates.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Unknown status tones fail boot and secretMint confirm actions respect role gating
  -->

  `jobs:query:list` (job-runs screen) now pages with a `cursor` and returns `nextCursor` while older runs exist. Ledger `create-transaction` requires `subjectType` and `subjectId` together and rejects empty strings (also on schedule fields). The form-draft sweep re-check is tenant-scoped. A workflow run resumed without a stored definition fingerprint logs a warning.

  `EventDef.piiFields` is now required in the type, screen definitions accept only `agent: { expose }` (`AgentScreenHints`), and `FormController.validate(scope)` rejects field names that the form values do not have. The dedupe doc and the security-baseline recipe note that late-bound state (sessions auto-revoke) binds on the kept instance.

  A text or longText field with `multiline.rows` that is not a positive integer now fails the app-schema build with the entity or screen and field name instead of silently rendering four rows. List columns of type multiSelect render one pill per value like select columns. `config:query:values` accepts an optional `keys` list, and the tenant-currency lookup of money fields asks for its one key only.

  `createKumikoApp` accepts `schemaUrl` for the schema fetch when the API lives on another origin than the SPA (a cross-origin URL is fetched with `credentials: "include"`). List select cells and a danger `Dialog` now follow the registered primitives: select pills use the registered `StatusBadge`, and a danger dialog focuses Cancel by default. Form drafts no longer store fields marked `sensitive: true`.

  German and Spanish translations for `jobs.errors.invalidCursor` were missing.

  The release workflow waits for npm `latest` only on the packages the changesets run actually published and skips packages published under another dist-tag. `check:dist` compiles the installed `styles.css` and fails when classes from renderer-web or the renderer's compiled dist are missing.

- Updated dependencies [3932e47]
- Updated dependencies [f05c4e7]
- Updated dependencies [4ec1c59]
- Updated dependencies [0609d09]
- Updated dependencies [d32c9b3]
- Updated dependencies [a9ab2be]
- Updated dependencies [b5466a7]
  - @cosmicdrift/kumiko-framework@0.353.0

## 0.352.0

### Patch Changes

- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [b905d4b]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
  - @cosmicdrift/kumiko-framework@0.352.0

## 0.351.0

### Patch Changes

- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
  - @cosmicdrift/kumiko-framework@0.351.0

## 0.350.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.350.0

## 0.349.0

### Patch Changes

- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
  - @cosmicdrift/kumiko-framework@0.349.0

## 0.348.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.348.1

## 0.348.0

### Patch Changes

- Updated dependencies [400490e]
- Updated dependencies [d7fd7e0]
  - @cosmicdrift/kumiko-framework@0.348.0

## 0.347.0

### Patch Changes

- a35ad24: actionForm screens can confirm a submit with the chosen record

  A new `successMessage` i18n key on an `actionForm` screen shows a confirmation above the form after a successful submit, for screens that stay put (no `redirect`, not in a drawer). `{field}` placeholders take the submitted values, and a `reference` field shows the chosen record's label instead of its id. The tier-engine admin form uses it: "Tier assigned: Acme → Pro", so choosing the wrong tenant is visible right away. New i18n key: `tier-admin.success` (en/de/es). `RenderEdit`'s `onSubmit` receives the submitted values as a second argument.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm successMessage names the chosen record's label after a successful submit
  -->

- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [69c182c]
  - @cosmicdrift/kumiko-framework@0.347.0

## 0.346.0

### Patch Changes

- Updated dependencies [6b8dde4]
  - @cosmicdrift/kumiko-framework@0.346.0

## 0.345.0

### Patch Changes

- 07495cf: `POST /auth/signup-confirm` now runs the login's MFA gate before it issues the first session. Self-signup makes the new user TenantAdmin of a fresh tenant, so under an MFA policy that covers admins the route used to hand out an admin session without a second factor. The account, the tenant and a bound handover claim are still created, but when the gate applies the route answers with the login contract (`mfaSetupRequired` plus `preauthSetupToken`, or `mfaRequired` plus `challengeToken`) and sets no cookies. `SignupCompleteScreen` then tells the user the account is active and sends them to sign in, where they set up the second factor. Without `mfaStatusChecker` nothing changes. Two exported types change shape: `SignupConfirmData` gains the two MFA variants, and `confirmSignup` now resolves to `SignupConfirmResult` with `kind: "signed-in"` (the previous `SignupConfirmSuccess` fields) or `kind: "mfa-pending"`. The handler and `invite-signup-complete` also run the gate before they delete the token, so an error in the MFA check leaves the link usable for a retry.

  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: signup-confirm enforces the MFA gate before issuing a session
  -->

- Updated dependencies [cef5fa0]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
  - @cosmicdrift/kumiko-framework@0.345.0

## 0.344.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.344.0

## 0.343.0

### Patch Changes

- 446b714: Auth mails state the link validity as a duration and in the user's time zone

  The five token mail renderers replace the UTC timestamp with `{duration}` (for example "1 day") and `{when}` (medium date and short time with zone abbreviation, in the recipient's locale). `RenderTokenContentArgs` gains `issuedAt` (default now) and `timeZone` (default UTC; an invalid zone falls back to UTC); the handlers pass the token issue time and `ctx.tz.user`. German strings use "Konto" instead of "Account".

  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Mail expiry shows duration and local time with time zone
  migration: |
    Custom `auth.mail.*.expiry` translations should use the new `{duration}` and `{when}` placeholders; `{when}` now includes the time and zone abbreviation instead of a UTC timestamp.
  -->

- Updated dependencies [23b0bec]
- Updated dependencies [446b714]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [d32e123]
- Updated dependencies [6adca33]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
  - @cosmicdrift/kumiko-framework@0.343.0

## 0.342.0

### Patch Changes

- Updated dependencies [0978e85]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [0978e85]
  - @cosmicdrift/kumiko-framework@0.342.0

## 0.341.0

### Minor Changes

- 4b01c83: Add waitlist bundled feature: public signup intake with admin invite and reject, GDPR export and erasure

  <!-- kumiko-changes
  feature: waitlist
  type: improvement
  title: Add waitlist bundled feature: public signup intake with admin invite and reject, GDPR export and erasure
  -->

### Patch Changes

- 37c0974: Add errors.rate_limit_unavailable (es)

  <!-- kumiko-changes
  feature: locale-es
  type: fix
  title: Add errors.rate_limit_unavailable (es)
  -->

- Updated dependencies [610201f]
- Updated dependencies [82309a5]
- Updated dependencies [c2c7862]
- Updated dependencies [610201f]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [1feae69]
- Updated dependencies [c5e6814]
- Updated dependencies [8443f22]
- Updated dependencies [1f0a63b]
  - @cosmicdrift/kumiko-framework@0.341.0

## 0.340.0

### Patch Changes

- Updated dependencies [483bb16]
  - @cosmicdrift/kumiko-framework@0.340.0

## 0.339.0

### Minor Changes

- d5b87a1: Both framework lightboxes can now page through several images. The React `Lightbox` primitive accepts `images`, `index` and `onIndexChange` as an alternative to `src`/`alt`, and the Apex marketing lightbox walks all `.shot-frame` screenshots on the page. Both wrap around at the ends and respond to the arrow keys.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Lightbox pages through multiple images
  detail: |
    `LightboxProps` is now a union: the existing `src`/`alt` form is unchanged, and the new `images` + `index` + `onIndexChange` form renders previous/next buttons, a position counter and ArrowLeft/ArrowRight navigation with wrap-around when more than one image is given. The Apex lightbox collects every `.shot-frame img` on open and gains previous/next buttons; its CSP script hash changed. New i18n keys: `kumiko.lightbox.previous`, `kumiko.lightbox.next`, `kumiko.lightbox.position`.
  -->

- b4c15f6: Theme mode auto follows prefers-color-scheme

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Theme preference auto follows the OS color scheme live; ThemeToggle and ThemeMenuItem step through light, dark and auto, a stored choice wins, and defineAppTheme accepts defaultColorScheme
  migration: |
    Apps with a theme-restore inline script in their host HTML must update it. The toggle can now store "auto", which an old script that only checks for "dark" treats as light, so dark-mode users see a light flash on load. Use the script from the comment in renderer-web tokens.ts, which also handles "auto" via matchMedia. Under a strict CSP, update the script hash or keep the nonce.
  -->

### Patch Changes

- 0e065d2: A missing or unchecked checkout consent now fails with `422 consent_required` instead of a schema `400`. `start-plan-checkout` and `create-checkout-session` accept an absent `consent` and `false` flags and reject them in the consent gate, so clients can show the localized `billing-foundation.errors.consentRequired` message.

  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Missing or unchecked checkout consent returns 422 consent_required
  detail: |
    The consent payload is optional in the `start-plan-checkout` and `create-checkout-session` input schemas and its two flags are plain booleans. `prepareConsent` throws `UnprocessableError("consent_required")` with `billing-foundation.errors.consentRequired` when consumer protection is on and the consent is missing or either flag is not true.
  migration: |
    Clients that treated the previous `400` validation error for a missing consent as the signal must check for `422` with `reason: "consent_required"`.
  -->

- 80ecf93: The billing consent and cancel-contract dialogs now address the user informally ("du" in German, "tú" in Spanish), like the rest of `BillingPlansPanel`. The German contract confirmation mail, the receipt mail for a termination or withdrawal and the public cancellation pages use "du" as well.

  <!-- kumiko-changes
  feature: locale-de
  type: fix
  title: Billing consent and cancel dialogs use "du"
  detail: |
    `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` switch from "Sie" to "du", matching the `billing-foundation.plans.*` keys. The formal bundle (`address: "formal"`) keeps the "Sie" wording through `localeDeFormalOverrides`.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: fix
  title: Billing consent and cancel dialogs use "tú"
  detail: |
    `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` switch from "usted" to "tú", matching the `billing-foundation.plans.*` keys.
  -->

  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: Contract confirmation, termination receipt and cancellation pages use "du"
  detail: |
    The German contract confirmation mail, the termination and withdrawal receipt mail, the public cancellation pages and the subscription and payment submit messages address the customer with "du". The recorded consent statements are first-person and unchanged, so `consentTextVersion` stays the same.
  -->

- Updated dependencies [5b6e5f7]
- Updated dependencies [c1e6186]
- Updated dependencies [fcbf184]
- Updated dependencies [e3adda3]
- Updated dependencies [1954386]
- Updated dependencies [b040ca7]
- Updated dependencies [252f749]
  - @cosmicdrift/kumiko-framework@0.339.0

## 0.338.0

### Patch Changes

- 6016fa6: German and Spanish strings for the billing consent and cancel-contract dialogs of `BillingPlansPanel`, in the formal address, matching the wording of the cancellation pages.

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings for the billing consent and cancel-contract dialogs
  detail: |
    Adds the `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` keys in formal German.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings for the billing consent and cancel-contract dialogs
  detail: |
    Adds the `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` keys in formal Spanish.
  -->

- Updated dependencies [c710f1e]
- Updated dependencies [3613e5a]
- Updated dependencies [3451156]
- Updated dependencies [4a13a0e]
- Updated dependencies [57467b5]
- Updated dependencies [e8e5e2f]
- Updated dependencies [bac056f]
- Updated dependencies [f4f3d4a]
- Updated dependencies [87938e0]
- Updated dependencies [51b4867]
- Updated dependencies [d1bba78]
  - @cosmicdrift/kumiko-framework@0.338.0

## 0.337.1

### Patch Changes

- Updated dependencies [b1b01b8]
- Updated dependencies [6c1c1d4]
  - @cosmicdrift/kumiko-framework@0.337.1

## 0.337.0

### Patch Changes

- 00313ba: Adds the Spanish copy for `jobs.errors.invalidPayload`, shown when a manual job trigger gets a broken or non-object JSON payload.

  <!-- kumiko-changes
  feature: locale-es
  type: fix
  title: Spanish copy for the jobs invalid-payload error
  -->

- Updated dependencies [c68ebb6]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [a7fcca9]
- Updated dependencies [469df86]
- Updated dependencies [8b6daed]
- Updated dependencies [c2da99c]
- Updated dependencies [7949847]
- Updated dependencies [a5023de]
- Updated dependencies [edc2b80]
- Updated dependencies [acde687]
- Updated dependencies [e889f3f]
  - @cosmicdrift/kumiko-framework@0.337.0

## 0.336.1

### Patch Changes

- Updated dependencies [ad3999e]
  - @cosmicdrift/kumiko-framework@0.336.1

## 0.336.0

### Patch Changes

- Updated dependencies [e91de78]
- Updated dependencies [e19453a]
- Updated dependencies [83378b1]
- Updated dependencies [c95f017]
- Updated dependencies [58154f0]
- Updated dependencies [b83c348]
- Updated dependencies [4618e1d]
  - @cosmicdrift/kumiko-framework@0.336.0

## 0.335.0

### Patch Changes

- 07ddc7e: `InviteAcceptScreen` no longer redirects to a tenant URL when the accept route answers with an MFA challenge or setup requirement (no session cookie was minted); it sends the user to `loginHref` instead. `SessionBootstrapErrorScreen` accepts an optional `onSignOut` and the auth gate wires it, so a permanent bootstrap failure no longer traps the user behind "Try again" (new i18n key `auth.sessionBootstrap.signOut`). Cap bookings back off with a small random delay between version-conflict retries.

  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Invite accept handles MFA responses, bootstrap error screen offers Sign out
  -->

- 1e9cc86: `tenant-caps:list` now rejects a malformed pagination cursor and unsupported or repeated filters with a validation error instead of returning a wrong page or silently ignoring the filter, and loads per-tenant usage in parallel. The `cap-counter` operator list is no longer searchable, because search resolved against the caller's own tenant instead of all tenants.

  <!-- kumiko-changes
  feature: cap-overview
  type: fix
  title: tenant-caps:list validates cursor and filters, parallel usage reads; cap-counter list not searchable
  -->

- 099f406: The cap usage bar labels an unlimited cap as "<used> · unlimited" through the new `cap-overview.unlimited` key instead of a bare number. The German and Spanish catalogs ship the translation.

  <!-- kumiko-changes
  feature: cap-overview
  type: fix
  title: Unlimited caps show a labelled usage count
  -->

- d7d5bd7: Renderer review fixes. Deleting a secret on a secretsEdit screen now asks for confirmation first (new `config.secrets.deleteConfirm` key) and the delete button is disabled while a save or delete is running. The multiSelect checkbox group is exposed as a labelled group (`GridProps.ariaLabelledBy`). The inline reference-create dialog seeds `currency: { kind: "tenant" }` money fields from the tenant currency. Fields declared only inside a section `groups` entry now get their `visible`/`readOnly`/`required` conditions registered. `onChange`'s `valid` ignores issues on hidden fields and outside the `fields` scope, like submit does (shared `relevantFieldIssues` helper). Copy-link in the form footer keeps a 44px touch target on narrow viewports. A free-text sibling-field number unit longer than 8 characters is no longer rendered as a suffix.

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Secret delete confirmation, grouped-field conditions, scoped valid flag, tenant currency in reference-create dialog
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Labelled multiSelect checkbox group, mobile touch target for secondary form actions, bounded number unit suffix
  -->

- 8a49831: Ended session leads back to the login screen

  When the server ends a session (revoked, expired), the app now shows the login screen with a short hint instead of a raw error banner. After signing in again the user lands on the same screen as before.

  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Ended session leads back to the login screen
  -->

- 3d37d50: Saving member roles keeps roles the editor cannot grant

  Admin, TenantAdmin and SystemAdmin saves keep DataProtectionOfficer, TenantOwner, undeclared and higher-tier app roles; the system user still replaces the list. The roles column translates TenantOwner and DataProtectionOfficer. New exports: canActorAssignRole, mergeAssignedRoles, assignableAppRolesOf. Apps translate their roles via tenant:entity:**action-form**:field:roles:option:<Role> (and role:option: for the invite).

  <!-- kumiko-changes
  feature: tenant
  type: fix
  title: Saving member roles keeps roles the editor cannot grant
  -->

- Updated dependencies [ff1dea2]
- Updated dependencies [d973444]
- Updated dependencies [a4fa088]
- Updated dependencies [ed072dc]
- Updated dependencies [44c5898]
- Updated dependencies [c97a39a]
- Updated dependencies [bf12ac5]
- Updated dependencies [6d4068f]
- Updated dependencies [1e9cc86]
- Updated dependencies [a86aa83]
- Updated dependencies [f86bcd2]
- Updated dependencies [a8f5305]
- Updated dependencies [0705037]
- Updated dependencies [4805c38]
- Updated dependencies [4f6e8d7]
- Updated dependencies [099f406]
- Updated dependencies [70aa253]
- Updated dependencies [837245e]
- Updated dependencies [5b6f9da]
- Updated dependencies [4805c38]
- Updated dependencies [4805c38]
- Updated dependencies [c791abd]
- Updated dependencies [782fdea]
- Updated dependencies [0191e3e]
- Updated dependencies [b18daf9]
- Updated dependencies [ff29a06]
- Updated dependencies [dae5a21]
- Updated dependencies [567a4bd]
- Updated dependencies [f5ff653]
- Updated dependencies [5bca19c]
- Updated dependencies [85dead2]
- Updated dependencies [9acf185]
- Updated dependencies [d7d5bd7]
- Updated dependencies [57f0e78]
- Updated dependencies [5e9cc10]
- Updated dependencies [a86aa83]
- Updated dependencies [a39d8a6]
- Updated dependencies [9061d9e]
- Updated dependencies [e550021]
- Updated dependencies [4e617da]
- Updated dependencies [3d37d50]
- Updated dependencies [7cdc623]
  - @cosmicdrift/kumiko-framework@0.335.0

## 0.334.0

### Patch Changes

- bc0172a: Generated config screens (configEdit, secretsEdit, extension-selector dashboard) render as a settings list: section header on top, one row per key with label, description, origin and reset on the left and the control on the right, hairlines between rows and an accent line on values set at the current level. `EditLayout.variant: "settings-list"` enables the layout, `RenderEditProps.dirtyFooter` shows the unsaved count with Discard and Save changes, `validateOnChange` shows field errors while typing. Number bounds on config keys are validated on the client and read "Must be 1000 or less" / "Must be at least 1". Rows split into two columns by container width, so they stack next to a sidebar on tablets.

  `DashboardScreenDefinition.showUpdatedAt` (default true) hides the "As of" timestamp; the selector dashboard sets it to false. `DashboardScreenPanel.chromeless` embeds a panel's screen without card frame and without its own screen padding, aligned to the page grid; the selector dashboard uses it. Features can name the config section via `<feature>.settings.section`; tenant-settings uses it and the platform screen is titled "Tenant defaults" to match the navigation.

  Consumer tests on secretsEdit need updating: the `required-marker-<field>` test id is gone (a missing required secret now shows as the `secret-not-set-<field>` status), a stored secret gets `secret-saved-<field>`, and `secrets-edit-submit` stays disabled until at least one secret is entered.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Settings list layout for generated config and secrets screens
  -->

- Updated dependencies [6633f59]
- Updated dependencies [6633f59]
- Updated dependencies [bc0172a]
  - @cosmicdrift/kumiko-framework@0.334.0

## 0.333.0

### Minor Changes

- 90420cb: Additive screen options for list, drawer, form and wizard screens

  entityList: `facets` (per-field `display: "chips"`, `showCounts`, `hideEmpty`, `extraOptions`, or `false` to hide), `defaultFilters` (initial value only, the URL wins, "no filter" stays chosen) and `rowActionMode`. Row actions get `display: "button" | "link" | "icon"`; with `display` set an action stays inline next to the kebab. Drawer actions get `title` / `subtitle` (i18n keys, `{param}` filled from the row prefill). Edit fields get `submit: false` (kept out of the payload), actionForm gets `footerActions` (patch values, then submit), relatedList gets `groupBy` / `rowTone` / `rowActionMode`. Wizard sections get `subtitle`, `layout.wizard.aside.upNext` adds an "up next" box, entityEdit gets `titleTemplate`. `Button` gets a `pressed` style, the DataTable contract `rowGrouping` / `rowTone`, `StepBar` `subtitles` / `upNext`, `Drawer` `subtitle`.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: New optional screen options for facet chips, default filters, row action display, drawer titles, footer actions, grouped related lists and wizard side info
  migration: No code change needed.
  -->

  - Screenshot runner: `SCREENSHOT_DESKTOP_WIDTH` overrides the desktop viewport width (default 1920).

### Patch Changes

- 2d7f76f: Apps declare assignable membership roles via `r.useExtension(EXT_ASSIGNABLE_ROLE, "<Role>", { assignableFrom? })` (the feature must `r.requires("tenant")`). `assignableFrom` defaults to "Admin"; set it higher to raise the bar. The role-elevation guard and the members/invite screens pick the declarations up; undeclared roles stay rejected. "Member" is now ranked with "User" and labelled.

  <!-- kumiko-changes
  feature: tenant
  type: improvement
  title: Apps declare assignable membership roles via EXT_ASSIGNABLE_ROLE
  -->

- Updated dependencies [2d7f76f]
- Updated dependencies [90420cb]
  - @cosmicdrift/kumiko-framework@0.333.0

## 0.332.0

### Patch Changes

- ae6d506: Narrow-card meta separator ("·") is now rendered as an element instead of `before:content`, so it survives consumer Tailwind scans of the published dist. The value span keeps its `data-testid` and exact text. The mobile page-header overflow trigger (`shell-header-overflow-trigger`) now has its own aria-label "Page actions" (was "More actions", same as row menus); E2E selectors by label need updating.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Card subtitle separators render in apps again, header overflow trigger has its own label
  -->

- 14c0fb8: The phone header overflow is now a right-aligned menu (`role="menu"`, arrow-key navigation) instead of a full-width panel, and `ThemeToggle` renders as a labelled row inside it. `ThemeToggle` titles default to the new i18n keys `kumiko.theme.dark` / `kumiko.theme.light`. On phones, a list's primary toolbar action without `onCreate` moves into the page header as an icon button.

  Inline embedded-list tables no longer squeeze reference, select and number columns: columns have realistic minimum widths (the table scrolls horizontally below their sum), widths sit on `<col>` so text and reference columns take the free space, and the sticky actions column fits its four buttons.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Phone header overflow is a right-aligned menu with labelled rows, primary list toolbar action moves into the header on phones
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Embedded list tables keep readable column widths and scroll instead of squeezing, actions column fits its buttons
  -->

- Updated dependencies [991ed87]
- Updated dependencies [dcf135e]
- Updated dependencies [3917e63]
- Updated dependencies [b81f794]
- Updated dependencies [541d24b]
- Updated dependencies [e82b023]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
  - @cosmicdrift/kumiko-framework@0.332.0

## 0.331.0

### Minor Changes

- 16797a4: entityList rows can expand into a related list

  `expandableRow` on an entityList declares a related list under each row, with the same fields as a projectionDetail `relatedList` section (query, `parentFilter` or `parentParam`, columns, row and toolbar actions, emptyState). The parent id is the row's `id`. An arrow button at the start of the row opens and closes the area, carries `aria-expanded`, and works by keyboard. Several rows can be open at once. A successful write from the area reloads both the related list and the parent list, so counters on the parent row update. The boot validator and the role projection check the area like a relatedList section. `DataTableProps` gains `expandedRowIds`, `onToggleRowExpanded` and `renderExpandedRow` for custom DataTable primitives.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityList rows can expand into a related list with its own row actions (expandableRow)
  -->

### Patch Changes

- Updated dependencies [16797a4]
- Updated dependencies [6b95958]
- Updated dependencies [3ea4ffc]
- Updated dependencies [e4ea9f0]
  - @cosmicdrift/kumiko-framework@0.331.0

## 0.330.2

### Patch Changes

- Updated dependencies [32a6102]
  - @cosmicdrift/kumiko-framework@0.330.2

## 0.330.1

### Patch Changes

- Updated dependencies [63a63d6]
- Updated dependencies [39c2fbd]
- Updated dependencies [03ad4bc]
  - @cosmicdrift/kumiko-framework@0.330.1

## 0.330.0

### Minor Changes

- dc5981b: Dashboard screens get new chart kinds, panel states and a time range; admin-shell overviews are built from metrics

  Dashboard panels gain the chart kinds `stacked-bars`, `segment-bars` and `stacked-area`, a subtitle, per-series tones, static query `params`, `ignoreScreenFilter`, an empty label and hint, a `span` (half/full width), a stat `sparklineField` and static `tone`, a `negative` tone, an unlabelled `stat-group` KPI strip and bar/badge list columns. Every panel shows skeleton, empty and error states with retry. A screen can declare a `timeRange` control and a `scope` badge and notice. The admin-shell overview screens use all of this and show the metrics of the new `metrics` and `metrics-system` features. `deliveries-by-channel` now labels the email, in-app and push channels.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Dashboard screens get stacked-bars, segment-bars and stacked-area charts, panel states, time range, scope badge and bar/badge list columns
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Dashboard screens show screen.description only when it is an i18n key; plain-text descriptions stay agent-facing and are no longer rendered
  migration: |
    To keep a visible subtitle under a dashboard title, set screen.description to an i18n key (for example "my-feature:screen.overview.description") and register its translations.
  -->

  <!-- kumiko-changes
  feature: metrics
  type: fix
  title: deliveries-by-channel shows readable channel labels instead of raw channel ids
  -->

  <!-- kumiko-changes
  feature: admin-shell
  type: breaking
  title: admin-shell requires the metrics and metrics-system features and builds its overview dashboards from a metrics list
  migration: |
    Mount createMetricsFeature({ metrics: DEFAULT_METRICS }) and createSystemMetricsFeature({ metrics: DEFAULT_METRICS }) from the metrics bundled feature before admin-shell. DEFAULT_METRICS also requires the delivery, sessions, jobs and tenant features.

    If you do not mount all of them, pass the same reduced list to all three: createMetricsFeature({ metrics }), createSystemMetricsFeature({ metrics }) and createAdminShellFeature({ metrics }). Overview panels exist only for metric ids in that list.
  -->

- 7a886f1: German and Spanish cover every registered key, enforced by a parity test

  The new i18n-parity test in `use-all-bundled` harvests the English copy from the real registrations (feature translations, client plugins, renderer defaults, mail templates) and fails with `key -> locale` when `locale-de` or `locale-es` lacks a key or an en-catalog drifts. This added the missing German and Spanish copy for billing plans, the privacy-center status field and many more keys, and removed 110 translation keys no feature registers any more. German uses "Ereignisprotokoll" for the audit log everywhere. `userDataRights.privacyCenter.restriction.dialogTitle` and `.deletion.dialogTitle` are registered in English by the feature.

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings cover every registered key and call the audit log "Ereignisprotokoll" everywhere
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings cover every registered key
  -->

  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: The privacy-center restriction and deletion dialog titles are registered in English by the feature
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: breaking
  title: locale-de and locale-es drop 110 keys that no framework feature registers any more (old custom-screen keys such as audit.log.*, jobs.runs.*, userDataRights.privacyCenter.title)
  migration: |
    The framework no longer renders these keys, so framework screens are unaffected. If app code or an app test calls t() with one of them, register that key in the app's own translations or switch to the key the framework screen uses now (for example the screen title key screen:<screen-id>.title, as in screen:audit-log.title).
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: breaking
  title: locale-es drops the same keys that no framework feature registers any more
  migration: |
    Same as locale-de: register any removed key your app still calls in the app's own translations, or switch to the key the framework screen uses now.
  -->

### Patch Changes

- 1e18129: Bundled screens use translated subtitles; PAT status and MFA strings are translated in de and es

  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: Bundled screen subtitles (admin-shell, jobs, auth-mfa, tier-engine, user-profile) are i18n keys with de and es translations
  migration: |
    Additive. Apps that override these screen descriptions keep working; apps that asserted the old English description text in tests now see the translated subtitle.
  -->
  <!-- kumiko-changes
  feature: personal-access-tokens
  type: fix
  title: The token list status column shows translated labels instead of raw status values
  -->

- Updated dependencies [dc5981b]
- Updated dependencies [7a886f1]
- Updated dependencies [89e32ce]
- Updated dependencies [f19fb5c]
- Updated dependencies [1e18129]
  - @cosmicdrift/kumiko-framework@0.330.0

## 0.329.0

### Patch Changes

- Updated dependencies [9bbdb64]
  - @cosmicdrift/kumiko-framework@0.329.0

## 0.328.1

### Patch Changes

- Updated dependencies [863e8e4]
  - @cosmicdrift/kumiko-framework@0.328.1

## 0.328.0

### Minor Changes

- 822928f: UI design defaults: fixed-height screens, warm-neutral tokens, IBM Plex

  Declarative screens now follow the Kumiko design refresh. List, detail, form, action form and wizard screens fill the shell height by default (`fillHeight`, opt out with `fillHeight: false` on the screen to get page scrolling back). The renderer ships IBM Plex Sans and Mono instead of hard-wiring Inter (apps that expect Inter set `--font-sans`), uses warm-neutral light and dark tokens with 6px radius, and redesigns pager, row actions, select presentation, form and wizard footers and the detail layout. New optional schema fields (`createLabel`, `searchPlaceholder`, option tones, `description`, `itemNoun`, `valueType`, `summary`, `hideOnNarrow`) and widgets (`PageHeader`, `MetricBand`, `SideBySideTable`) are additive. See docs/reference/theming.md and docs/reference/screen-layout.md.

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Screens fill the shell height by default
  detail: |
    entityList, projectionList, projectionDetail, entityEdit, actionForm and wizard screens now fill the height of the shell content. The table or the form body scrolls inside, the toolbar stays on top and the pager or action bar stays pinned at the bottom (`scrollBody`, `stickyActions`). The shell header is 56px. Custom screens and direct DataTable or Form usage are unchanged.
  migration: |
    Set `fillHeight: false` on a screen to restore the old page scrolling (table grows with its rows, pager below the last row, form footer in the flow). Apps with e2e or screenshot tests that scroll the page to reach the pager or the form footer need to adjust them or opt out per screen.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Pager shows a status line, page size select and Page X of Y instead of page numbers
  detail: |
    The numbered page list is gone. The list footer shows "1-19 of 19 <entities>" (with the entity plural label when known), "Page X of Y", previous and next buttons and a page size select (25, 50, 100). Lists without a pager show a plain entry count. The chosen size is kept in the URL under `<screen>.size`.
  migration: |
    Remove code and tests that click numbered page buttons (`-page-N` test ids); use the next and previous buttons. The screen's declared `pageSize` stays the default, `<screen>.size` in the URL overrides it. The new keys `kumiko.pager.pageOf`, `kumiko.pager.status.noun`, `kumiko.pager.pageSize`, `kumiko.pager.pageSizeLabel`, `kumiko.list.count.*` exist in en, de and es; apps with their own locale need them too.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: rowActionMode adaptive has new semantics and mobile rows lose the kebab for plain navigation
  detail: |
    With `rowActionMode: "adaptive"` (the default), a table with `onRowClick` renders the first cell as a keyboard-operable link and puts all row actions into the kebab. Without `onRowClick` the primary row action is a link-button and the remaining actions go into the kebab (a single action gets no kebab). Below the md breakpoint a row that only navigates shows a chevron and no kebab.
  migration: |
    Code or tests that expect up to two inline row action buttons must open the kebab or use `rowActionMode: "inline"`, which is unchanged. To keep a visible action next to the row link, drop `onRowClick` and declare the action as the primary row action.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Form, wizard and detail screens use the board layout
  detail: |
    Screen forms have no card, sections are separated by lines, fields flow in rows with widths by type (text 240px, number 96px, money 160px, date and select 200px, textarea full row) and the page title lives in the shell header. Delete and Copy link move into the header kebab, the footer reads status, Cancel, Save, and the wizard footer has no Cancel. Wizard steps sit in a vertical rail from the lg breakpoint. The first detail header action is a button, further ones sit in the kebab. Detail screens have no header card and use the full width: metrics render as a dl band, tabs are underlined only when active, related lists are full-bleed with a count footer. Required-field asterisks are omitted when every field is required and "All fields are required." is shown instead.
  migration: |
    Adjust screenshots and DOM tests that pin the old card layout. `fillHeight: false` restores page scrolling only; the footer order, the moved actions and the new field layout apply in both modes. Empty list cells render a dash.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: PageHeader slot, MetricBand, wizard Save and close, drawer row actions with unsaved-input guard
  detail: |
    Core primitives `PageHeader` (status and actions portalled into the shell header when a shell provides the slot, otherwise the caller keeps its placement) and `MetricBand` (borderless dl of metrics) are new and optional. Wizards on an existing record show "Save and close". Row actions and related list row actions with `kind: "drawer"` open the action form in a flush drawer. Closing it with unsaved input (X, Escape, overlay, Cancel) asks for confirmation first; nothing is asked after a successful submit. Row action drawers are prefilled from the row through `params`. The action form `summary` renders a context box above the fields.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Related list no longer claims "showing the first N entries" for a complete list
  detail: |
    The hint "Zeigt die ersten 1 Einträge. Es gibt weitere, die hier nicht angezeigt werden." appeared for a single row even when nothing else existed. It now appears only when more rows exist than were loaded.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: IBM Plex replaces Inter as the default typeface
  detail: |
    renderer-web ships IBM Plex Sans (400, 500, 600) and IBM Plex Mono (400, 500) as self-hosted woff2 files under the SIL Open Font License. `--font-sans` and `--font-mono` default to Plex. Inter is no longer wired in.
  migration: |
    Apps that expect Inter set `--font-sans` (and load the font themselves) in their styles.css or through the theme plugin. Nothing else is needed for apps happy with Plex. Custom server setups that do not use the dev server or the prod build of server-runtime must serve `/assets/kumiko/fonts/*.woff2` from the renderer-web `fonts` folder with the MIME type `font/woff2`, and `font-src 'self'` covers it.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Warm-neutral design tokens, 6px radius, content on the surface color
  detail: |
    Light and dark themes were rebuilt. Light: surface #FFFFFF, page #F3F2EE, sunken #F6F5F1, line #E2E0D9, strong line #CFCCC3, row line #ECEAE4, control border #908D85, text #1A1C1E, text 2 #474B50, text 3 #5F6368, disabled #8A8E93. New tokens: `--color-foreground-secondary`, `--color-foreground-disabled`, `--color-border-strong`, `--color-border-row`, `--color-status-*-surface` (ok, warn, bad, critical), `--color-status-neutral` and `--color-status-neutral-surface`, `--color-sidebar-muted`, `--color-sidebar-input`. `--radius` is 0.5rem so controls use 6px. The shell content, header and toolbars sit on the card surface, the sidebar (232px wide) takes the page color. Buttons: the secondary variant is a surface with a border, a ghost variant was added. Controls are 36px high (32px small), at least 44px below md.
  migration: |
    Apps that override tokens keep working, but check contrast pairs for the new roles and add overrides for the new tokens if the brand needs them. Apps with hard-coded colors that relied on the page color behind content, on grey secondary buttons or on the 10px radius must adjust. Screenshot tests need new baselines.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Field presentation follows option count, label length and type
  detail: |
    A select without an explicit `display` renders as a segmented control for up to 3 options with labels of at most 16 characters, as a vertical radio list for up to 3 longer options and as a dropdown for 4 or more. MoneyInput has no stepper, right-aligns its value and shows the currency as a suffix. Number inputs are left-aligned. Fields get a control width by type (number 96px, money 160px, date 200px, select at least 200px, text 240px), labels never wrap, radio lists and textareas take their own row.
  migration: |
    Set `display: "radio"` or `display: "dropdown"` on the select field to pin a presentation. Selects with 4 options no longer render as radio groups by default. Tests that spin a money value with the stepper buttons must type the value instead.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Drawer widget defaults to the flush variant, Link with target _blank sets rel
  detail: |
    The `Drawer` widget renders flush against the right edge with full height, no margin, no radius and a strong left border unless `variant="floating"` is passed. Every `<Drawer>` without `variant` changes its look. `Link` now forwards `rel` and `target`; with `target="_blank"` the default `rel` is `noopener noreferrer`.
  migration: |
    Pass `variant="floating"` to keep the detached panel look. Tests that assert a missing `rel` on `target="_blank"` links need updating.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: StatusBadge accent tone, ModeSwitch counts, radio cards, SideBySideTable, InfinityList selection
  detail: |
    `StatusBadge` gets an `accent` tone (primary tint with dot). `ModeSwitch` options take `count`, shown as a muted tabular counter. A select input takes `radioVariant: "card"` and each option a `description` for card-style radio choices. `SideBySideTable` renders a semantic table (th scope, ReactNode cells) for comparisons. `InfinityList` takes `selectedId` and `onSelectionChange({ index, total, prevId, nextId })`. `ProgressBar` takes `ariaLabel` and `size: "thin"`. `Button` has a `ghost` variant, DataTable rows take `DataTableRowAction.rowClick`, columns take `hideOnNarrow`. Tables and wizard steps use the new flush layout, tabs show counters.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Shell: user menu holds tenant, language and theme controls
  detail: |
    The sidebar user block sits in the sidebar footer and its menu contains the tenant, language and theme controls (`LanguageMenuItems` and `ThemeMenuItem` are exported). Sidebar items are 32px high on desktop, at least 44px below md.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Floating user block no longer overlaps the toolbar
  detail: |
    The "Admin" block hovered at the top left over the content below the header and covered the search field. The user block is part of the sidebar footer now.
  -->

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Screen schema gains fillHeight, createLabel, searchPlaceholder, optionTones, statusTones, description, itemNoun, valueType, summary, hideOnNarrow
  detail: |
    `fillHeight` (default true) on entityList, projectionList, projectionDetail, entityEdit and actionForm. `createLabel` and `searchPlaceholder` (i18n keys) on lists. `optionTones` on select fields and `statusTones` on projectionDetail map values to ok, warn, bad or neutral (`SelectOptionTone`). `description` and `itemNoun` on relatedList sections. `valueType` on relatedList columns (numbers and money align right), `hideOnNarrow` on list columns. `summary: { title, subtitle }` on actionForm with `{name}` placeholders from the drawer prefill. New nav icon `chevron-left`.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: build-app-schema carries optionTones and collects the new screen i18n keys
  detail: |
    Select `optionTones` reach the client schema. `createLabel`, `searchPlaceholder`, `summary`, related list `description` and `itemNoun` are collected as i18n keys of the screen, so they are translated like other screen text.
  -->

  <!-- kumiko-changes
  feature: headless
  type: breaking
  title: Dates format with two-digit day and month
  detail: |
    `formatValue` for date values passes `day: "2-digit"` and `month: "2-digit"`, so German output is 01.10.2026 instead of 1.10.2026 in lists, details and related lists. List view models carry `hideOnNarrow` onto columns.
  migration: |
    Update tests and snapshots that expect single-digit day or month.
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: New pager, list, form, wizard and drawer strings
  detail: |
    Adds the keys for the pager, list counts, sort label, form changed marker, unsaved counter, "All fields are required.", the on-this-page nav, wizard "Save and close" and "Next: {title}" and the drawer discard dialog.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: New pager, list, form, wizard and drawer strings
  detail: |
    Adds the keys for the pager, list counts, sort label, form changed marker, unsaved counter, "All fields are required.", the on-this-page nav, wizard "Save and close" and "Next: {title}" and the drawer discard dialog.
  -->

  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Production build copies the renderer-web fonts
  detail: |
    `buildProdBundle` copies the IBM Plex woff2 files to `dist/assets/kumiko/fonts/`, where the compiled CSS expects them. The new export `@cosmicdrift/kumiko-server-runtime/renderer-web-fonts` holds the URL prefix, the file name allowlist and the resolver, and the woff2 MIME type is known to the static file server.
  -->

  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: User menu and tenant menu items fit the new shell
  detail: |
    The web user menu and tenant menu items are adapted to the sidebar footer user block, which now hosts the tenant, language and theme controls.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Dev server serves the renderer-web fonts
  detail: |
    GET `/assets/kumiko/fonts/<file>.woff2` streams the packaged IBM Plex files with `font/woff2` and a one day cache header. Names outside the allowlist answer 404.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Money field shows the currency symbol as a suffix inside the field, date field has its calendar button inside the input
  detail: |
    MoneyInput renders the value right-aligned with the currency symbol as a separate muted adornment (`<id>-currency`), placed before the number for locales that put it there. The input text no longer contains the symbol ("1.234,56", not "1.234,56 €"); parsing and the stored minor-unit value are unchanged. DateField and TimestampInput draw the calendar button as an icon inside the right edge of the input instead of a separate square button; the button keeps its aria-label and keyboard operation.
  migration: |
    Tests that read the money input value and expect the symbol must read the `<id>-currency` element or drop the symbol from the expected text. Selectors that find the calendar button by role and label keep working.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Mobile list cards keep the status badge top right, pager page size select uses the shared chevron
  detail: |
    On narrow viewports the status badge sits in the title row (top aligned) and the meta line runs across the full card width up to the chevron. The page size select in the pager hides the native arrow and shows the same chevron icon as the other selects.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Sidebar marks the list while an existing record is edited
  detail: |
    When the route carries an `entityId`, the nav entry of the screen's parent list is active instead of the edit screen's own nav entry (for example "Add vehicle"), the same rule the shell breadcrumb already applies.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: writeForm section Save button without icon, parity with entityEdit
  detail: |
    The Save button of a writeForm section no longer shows a check icon; it matches the entityEdit submit button. Tests that look for the icon inside the section Save button need updating.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Money input keeps the currency symbol beside the value and survives an invalid locale
  detail: |
    The currency symbol is a flex sibling of the input inside one bordered wrapper, so multi-character symbols (CHF, R$, kr) never overlap the digits; without a symbol there is no extra padding. An invalid locale tag renders the plain number without a symbol instead of throwing. Native controls (date input, scrollbars, select) follow the theme through `color-scheme`.
  -->

### Patch Changes

- Updated dependencies [424f49a]
- Updated dependencies [eae8d2b]
- Updated dependencies [9cc1787]
- Updated dependencies [2a4350b]
- Updated dependencies [c3fbe54]
- Updated dependencies [822928f]
  - @cosmicdrift/kumiko-framework@0.328.0

## 0.327.0

### Minor Changes

- 7341d07: FloatingPanel widget and r.webSocketRoute

  renderer-web gains `FloatingPanel` (movable, resizable, non-modal panel with persisted geometry and a full-screen sheet on narrow viewports) and exports `useIsNarrowViewport`. Features can declare `r.webSocketRoute` under `/api/ws/` with session auth, an Origin check (allowlist, or same host without one), a per-route message cap, backpressure protection (4 MiB, the socket is closed beyond it) and a per-user connection cap (`maxConnectionsPerUser`, default 5, per server process; over it the upgrade gets 429). Handlers run one after another in arrival order per socket; on close `onClose` runs immediately (not queued behind a hung handler), queued messages never start, and `connection.signal` aborts. A 25 s heartbeat revalidates session, roles, tenant lifecycle and the token's own expiry (close 1008); a session store that keeps failing closes the socket with 1013 after three failed checks in a row. A server without upgrade wiring answers 501 `websocket_upgrade_not_wired` and logs the fix. `buildBunServeOptions` takes an optional `{ upgradeFetch, heartbeatIntervalMs? }` object as 4th argument and `runProdApp` handles expose `webSocketUpgradeFetch`; the dev server wires it. Upgrade rejections carry the same security headers as other responses. Additive, no migration.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: FloatingPanel widget and exported useIsNarrowViewport
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.webSocketRoute for authenticated WebSocket routes under /api/ws/
  -->

### Patch Changes

- Updated dependencies [7341d07]
- Updated dependencies [268c3bd]
- Updated dependencies [532a197]
- Updated dependencies [eef5a2f]
- Updated dependencies [da6e569]
  - @cosmicdrift/kumiko-framework@0.327.0

## 0.326.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.326.1

## 0.326.0

### Minor Changes

- 6af6be2: A feature that declares `r.extensionSelector(extension, configKey)` now gets one tenant settings screen in the generated Settings-Hub: the selector as a select of the mounted plugin ids, and below it the config and secrets of the selected plugin. The panels follow the saved selection live.

  New query `config:query:config-value:selected-extensions` returns the caller's selected plugin id per extension point.

  BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and `config:write:set` rejects every other value except `""` with 422 `config.errors.unknownExtensionPlugin`. The owner's tenant screen `<owner>-tenant` is now a dashboard; its configEdit moved to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link still resolves), and their secrets move from the global `secrets` screen into `<plugin>-tenant-secrets` panels.

  <!-- kumiko-changes
  feature: config
  type: breaking
  title: Extension-selector settings render as one tenant screen
  detail: |
    BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and
    `config:write:set` rejects every value except a mounted plugin id or "" with 422
    `config.errors.unknownExtensionPlugin`.

    The owner's tenant screen `<owner>-tenant` is now a dashboard; its former configEdit moved
    to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav
    entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link
    still resolves), and their secrets move from the global `secrets` screen into
    `<plugin>-tenant-secrets` panels. A plugin feature registered under more than one selector
    registration keeps the previous behaviour.

    Generated hub screens need the new key `config.settings.extensionSelectorHint` (shipped in
    the config and secrets bundles, en/de/es).
  migration: |
    Links, tests or screenshots that open `<plugin>-tenant` through the nav or expect a configEdit
    at `<owner>-tenant` should open `<owner>-tenant` (now the dashboard) and look for the plugin
    panels there. Tenant rows or scripts that write a selector value naming no mounted plugin must
    write a mounted plugin id or "" instead. No new translation keys are required from apps.
  -->

### Patch Changes

- Updated dependencies [6af6be2]
  - @cosmicdrift/kumiko-framework@0.326.0

## 0.325.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.325.2

## 0.325.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.325.1

## 0.325.0

### Patch Changes

- Updated dependencies [100732a]
  - @cosmicdrift/kumiko-framework@0.325.0

## 0.324.0

### Patch Changes

- Updated dependencies [efa4114]
- Updated dependencies [3c0095d]
  - @cosmicdrift/kumiko-framework@0.324.0

## 0.323.0

### Patch Changes

- Updated dependencies [d7bba26]
- Updated dependencies [72727cd]
- Updated dependencies [1343b18]
  - @cosmicdrift/kumiko-framework@0.323.0

## 0.322.0

### Patch Changes

- Updated dependencies [d0c631a]
- Updated dependencies [9e7bedc]
  - @cosmicdrift/kumiko-framework@0.322.0

## 0.321.0

### Patch Changes

- Updated dependencies [959b3fb]
- Updated dependencies [fa27809]
- Updated dependencies [fa27809]
- Updated dependencies [8246f13]
- Updated dependencies [b74db24]
- Updated dependencies [5616ad9]
- Updated dependencies [fa27809]
  - @cosmicdrift/kumiko-framework@0.321.0

## 0.320.0

### Patch Changes

- fe36eeb: AppSchema now leaves the server only via an authenticated GET /api/schema

  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: Static fallback no longer injects __KUMIKO_SCHEMA__ into HTML
  migration: |
    `HostDispatchResult.injectSchema` is deprecated and ignored — HTML never
    carries the schema anymore, in prod or dev. `createKumikoApp` now fetches
    the schema itself from the authenticated `GET /api/schema` after its
    clientFeature gates (e.g. an auth gate) let rendering through, so a
    signed-in admin app keeps working without changes. Anything that read
    `window.__KUMIKO_SCHEMA__` directly (custom clients, e2e fixtures) must
    switch to fetching `/api/schema` instead. An anonymously reachable page
    that used to render schema-based screens needs `createPublicSurface`,
    which never carries a schema. The `@cosmicdrift/kumiko-server-runtime/inject-schema`
    subpath export is removed.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: New GET /api/schema route
  detail: |
    Behind the existing `/api/*` auth guard. A signed-in, non-anonymous user
    gets the built `AppSchema` as JSON with `Cache-Control: private, no-cache`
    and a strong `ETag`; a matching `If-None-Match` gets a bodyless 304 (still
    behind the same auth check, so an anonymous request with a stolen/guessed
    ETag still 401s instead of getting a 304). Anonymous or missing auth gets
    the same 401 `unauthenticated` response shape as every other non-public
    route.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: breaking
  title: Dev-server HTML no longer injects __KUMIKO_SCHEMA__ either
  migration: |
    Same semantics as the prod change: `DevHostDispatchResult.injectSchema`
    is deprecated and ignored. The dev-server's auto-mint mode still sets
    the `kumiko_auth`/`kumiko_csrf` cookies on the HTML response, so a
    client-side fetch to `/api/schema` is authenticated immediately without
    a real login round-trip.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: createKumikoApp loads the schema after the auth gate, with loading/error states
  detail: |
    When neither `options.schema` nor `window.__KUMIKO_SCHEMA__` is set,
    `createKumikoApp` now fetches the schema from `GET /api/schema` itself,
    only after its clientFeature gates let rendering through (so an
    unauthenticated visitor never triggers the request). While the fetch is
    in flight a minimal loading placeholder renders; a 401/403 shows a clear
    "sign in required" message with no auto-retry; any other failure shows a
    retry button. Losing schema access mid-session (a gate withdrawing
    children, e.g. on logout) resets the fetched schema so the next mount
    re-fetches instead of reusing a previous session's — important once
    schemas become role-dependent. An explicit `options.schema` never resets
    this way.
  -->

- Updated dependencies [0ab9874]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [3a99ac1]
- Updated dependencies [fe36eeb]
- Updated dependencies [02cc7b3]
- Updated dependencies [c498565]
- Updated dependencies [9907bc6]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
  - @cosmicdrift/kumiko-framework@0.320.0

## 0.319.0

### Patch Changes

- 53c5206: Spanish strings for the new billing-plans cancel-scheduled banner and reactivate label

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings for the new billing-plans cancel-scheduled banner and reactivate label
  detail: |
    Adds Spanish i18n strings for the cancel-scheduled info banner and the
    "Reactivate subscription" button label introduced by billing-foundation's
    cancel/reactivate change.
  -->

  - @cosmicdrift/kumiko-framework@0.319.0

## 0.318.0

### Minor Changes

- 4c5152f: billing-foundation's checkout gate no longer blocks forever on a stale `incomplete` subscription

  `modified_at`/`inserted_at` now track every subscription-projection upsert (using the appended event's own `createdAt`, not `now()`, so a rebuild stays deterministic). `getSubscriptionForTenant` exposes this as `SubscriptionView.lastChangedAt`. `isSubscriptionBlockingCheckout` treats an `incomplete` subscription older than 24h (Stripe's own auto-expiry window) as terminal, so a tenant whose checkout was abandoned can start a fresh one instead of getting stuck behind `ConflictError('subscriptionExists')` forever. A young `incomplete` subscription for a plan tier now shows `BillingPlanActions.paymentPending` on the billing-plans query, and the panel shows a "still completing" hint instead of a CTA for it. `createBillingFoundationFeature` gained an optional `now` clock option (defaults to real time), threaded through the checkout/plan-catalog handlers so tests can control staleness.

  Known limit: two checkouts started in parallel before the provider's first webhook arrives can still create two subscriptions, since the gate only sees subscriptions already projected.

  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: billing-foundation's checkout gate no longer blocks forever on a stale incomplete subscription
  detail: |
    A stale `incomplete` subscription (older than 24h) no longer counts as an active subscription for the checkout gate, so a tenant whose Stripe checkout was abandoned can start a fresh one. `SubscriptionView.lastChangedAt` (required) and `BillingPlanActions.paymentPending` are new; a consumer with an exhaustive switch over `BillingPlanAction` needs a `paymentPending` case. Known limit: two checkouts started in parallel before the provider's first webhook arrives can still create two subscriptions, since the gate only sees subscriptions already projected.
  -->

- 4c5152f: subscription-stripe's switch-plan returns a 422 instead of a bare 500 when two plan tiers share one Stripe product

  `createStripePlanSwitchSession`'s pre-check (two allowed prices at the same product+interval) and a matching Stripe Customer-Portal `StripeInvalidRequestError` (from `configurations.create()` or `sessions.create()`) both now throw `UnprocessableError('plan_tiers_share_product')` with i18nKey `billing-foundation.errors.planTiersShareProduct`, so the caller gets an actionable 422 instead of an opaque 500. Every other Stripe error keeps its existing mapping; the portal-configuration cache is still evicted on a `sessions.create()` failure.

  Each plan tier needs its own Stripe product: the Customer Portal configuration allows only one price per product and interval, so tiers that share a product cannot be switched between.

  <!-- kumiko-changes
  feature: subscription-stripe
  type: fix
  title: switch-plan returns a 422 instead of a 500 when two plan tiers share one Stripe product
  -->

### Patch Changes

- Updated dependencies [5d3b3e8]
- Updated dependencies [4fac08d]
  - @cosmicdrift/kumiko-framework@0.318.0

## 0.317.0

### Patch Changes

- Updated dependencies [fd40653]
- Updated dependencies [b13c820]
- Updated dependencies [94ce380]
  - @cosmicdrift/kumiko-framework@0.317.0

## 0.316.0

### Patch Changes

- Updated dependencies [aa32979]
  - @cosmicdrift/kumiko-framework@0.316.0

## 0.315.0

### Patch Changes

- Updated dependencies [0f2643d]
  - @cosmicdrift/kumiko-framework@0.315.0

## 0.314.0

### Patch Changes

- Updated dependencies [483666f]
- Updated dependencies [22d89ec]
- Updated dependencies [483666f]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
  - @cosmicdrift/kumiko-framework@0.314.0

## 0.313.0

### Patch Changes

- f0c1ef1: Untranslated member status/roles, screen subtitles and audit aggregate columns now go through i18n

  <!-- kumiko-changes
  feature: tenant
  type: fix
  title: Team member status and roles now translate instead of showing the raw enum value
  detail: |
    member-status-cell and member-roles-cell rendered the raw status/role
    enum values (e.g. "active", "TenantAdmin") straight into the table —
    non-English admin UIs showed English words next to translated column
    labels. Both cells now resolve through useTranslation against the
    existing tenant.members.filter.status.option.<status> and
    tenant:entity:__action-form__:field:roles:option:<role> keys, falling
    back to the raw value for any status/role not covered by those keys.
  -->

  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: Privacy-center screen subtitle is now translatable
  detail: |
    The Privacy screen's description was hardcoded English prose baked
    into feature.ts instead of an i18n key, so it never localized. It's
    now userDataRights.privacyCenter.subtitle, registered in i18n.ts with
    de/es translations.
  -->

  <!-- kumiko-changes
  feature: audit
  type: fix
  title: Audit-log-detail screen subtitle is translatable; aggregate columns get de/es copy
  detail: |
    The audit-log-detail screen's description was hardcoded English prose;
    it's now the audit.log.detail.subtitle key with de/es translations.
    Separately, audit.log.col.aggregateType/aggregateId (the actual column
    keys the audit-log-detail screen renders) had no de/es copy at all —
    only the dead, unused audit.log.col.aggregate key did. Added
    aggregateType/aggregateId to de/es, removed the dead aggregate key, and
    fixed the German filter label typo "Aggregate-Typ" -> "Aggregattyp".
  -->

  <!-- kumiko-changes
  feature: agent-tools
  type: fix
  title: Agent manifest now resolves a screen's i18n-key description to English prose
  detail: |
    buildAgentManifest passed screen.description straight through even when
    a feature registered it as an i18n key (e.g. "audit.log.detail.subtitle")
    rather than literal text, so agents saw the raw key instead of prose.
    It now resolves through the registry's translations the same way
    labelsForSuffix already does for entity/field labels, falling back to
    the literal string when the description isn't a registered key.
  -->

- 8e5e170: Four mobile-viewport (390px) fixes: tab-strip overflow, sticky wizard footer, facet-reset i18n, segmented-select placeholder/borders

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: DefaultTabs shows an edge fade and keeps the active tab scrolled into view when the strip overflows on narrow viewports
  detail: |
    At 390px, a tab strip with more tabs than fit gave no visible hint that
    it scrolled, and the active tab could end up scrolled out of view with
    no way to tell. The scroller now renders a mask-image edge fade on
    whichever side is scrollable (updated on scroll/resize via a guarded
    ResizeObserver), and scrolls the active trigger into view via
    `scrollLeft` — not `scrollIntoView`, which would also scroll the page
    vertically — on mount and on every activeId change.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Wizard form footer on mobile now only pins the primary action, not Back/Cancel
  detail: |
    Below 640px, DefaultForm's stickyActions pinned the whole footer
    (Back, Next/Submit, and secondaryActions like Cancel) to the viewport
    bottom together. Only the actual submit-type action needs that
    treatment (fw#1918: stay reachable above a virtual keyboard) — Back and
    secondaryActions now render in normal document flow alongside each
    other, while the primary action keeps its own `max-sm:fixed` bar.
    Desktop (sm+) layout is unchanged.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: DataTable's facet-reset button is now translatable ("Reset")
  detail: |
    The facet-filter Reset button rendered a hardcoded English "Reset"
    regardless of locale. It now resolves kumiko.list.filter.reset (falling
    back to "Reset"), with German ("Zurücksetzen") and Spanish
    ("Restablecer") translations added to locale-de/locale-es.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Select-as-SegmentedSelect excludes the placeholder option and fixes borders on wrapped segments
  detail: |
    A `""`-value placeholder option counted toward the ≤4-option segmented-
    control threshold and rendered as its own (permanently unchecked)
    segment — it's now filtered out of both the eligibility count and the
    rendered segments, consistently for the radio-group and dropdown
    fallback. Separately, the container's `divide-x` only drew vertical
    borders between siblings in source order, which misplaced borders once
    segments wrapped to a second row (a stray left border, no line between
    rows); each segment now carries its own collapsing top/left border
    instead, correct for any wrap arrangement.
  -->

- Updated dependencies [a14fd1f]
- Updated dependencies [42c5298]
- Updated dependencies [93d7b77]
- Updated dependencies [4dea3ec]
- Updated dependencies [b99240c]
- Updated dependencies [e7dc624]
  - @cosmicdrift/kumiko-framework@0.313.0

## 0.312.0

### Patch Changes

- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
  - @cosmicdrift/kumiko-framework@0.312.0

## 0.311.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.311.0

## 0.310.0

### Patch Changes

- Updated dependencies [4f36c3f]
  - @cosmicdrift/kumiko-framework@0.310.0

## 0.309.0

### Patch Changes

- Updated dependencies [75925be]
- Updated dependencies [cb0adcf]
- Updated dependencies [11b6f67]
- Updated dependencies [ac9bdae]
- Updated dependencies [8f109b5]
- Updated dependencies [711de11]
  - @cosmicdrift/kumiko-framework@0.309.0

## 0.308.0

### Patch Changes

- Updated dependencies [49e07f5]
- Updated dependencies [ad701ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [3ae4b82]
- Updated dependencies [9816d20]
- Updated dependencies [6b8b0ed]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-framework@0.308.0

## 0.307.0

### Patch Changes

- Updated dependencies [c5c5ddb]
- Updated dependencies [e682776]
- Updated dependencies [cc23d3d]
- Updated dependencies [4179f26]
- Updated dependencies [aae3f5d]
  - @cosmicdrift/kumiko-framework@0.307.0

## 0.306.0

### Patch Changes

- Updated dependencies [fdf9377]
- Updated dependencies [499b9c2]
- Updated dependencies [4f96ced]
- Updated dependencies [2e332a3]
- Updated dependencies [5785f57]
- Updated dependencies [cb31fad]
- Updated dependencies [b43fe63]
- Updated dependencies [cbbbb19]
- Updated dependencies [946f7e7]
- Updated dependencies [c6013bd]
- Updated dependencies [659c575]
  - @cosmicdrift/kumiko-framework@0.306.0

## 0.305.0

### Patch Changes

- Updated dependencies [90c5398]
- Updated dependencies [9de2cde]
- Updated dependencies [05b87d7]
- Updated dependencies [0ee6000]
- Updated dependencies [0567906]
- Updated dependencies [d98d172]
- Updated dependencies [d42d76a]
  - @cosmicdrift/kumiko-framework@0.305.0

## 0.304.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.304.0

## 0.303.0

### Patch Changes

- Updated dependencies [3d28528]
  - @cosmicdrift/kumiko-framework@0.303.0

## 0.302.0

### Patch Changes

- Updated dependencies [deede20]
  - @cosmicdrift/kumiko-framework@0.302.0

## 0.301.0

### Patch Changes

- Updated dependencies [bae6958]
  - @cosmicdrift/kumiko-framework@0.301.0

## 0.300.0

### Patch Changes

- Updated dependencies [2414932]
  - @cosmicdrift/kumiko-framework@0.300.0

## 0.299.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.299.0

## 0.298.0

### Patch Changes

- Updated dependencies [4ae8163]
- Updated dependencies [6735981]
  - @cosmicdrift/kumiko-framework@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [cb6e8a4]
- Updated dependencies [bfa7536]
- Updated dependencies [42b0562]
- Updated dependencies [f042685]
- Updated dependencies [d8cdd8a]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-framework@0.296.0

## 0.295.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.295.0

## 0.294.1

### Patch Changes

- Updated dependencies [7f6fbc6]
  - @cosmicdrift/kumiko-framework@0.294.1

## 0.294.0

### Patch Changes

- Updated dependencies [ea10c90]
  - @cosmicdrift/kumiko-framework@0.294.0

## 0.293.0

### Patch Changes

- Updated dependencies [7fb8a62]
  - @cosmicdrift/kumiko-framework@0.293.0

## 0.292.0

### Patch Changes

- 787c572: Audit log shows actor display names instead of raw UUIDs (fw#3103)

  The `Actor` column of `audit:screen:audit-log` and the `createdBy` field of its detail screen rendered the raw `createdBy` UUID. The framework primitive for this already existed — `ListColumnSpec.refEntity` / `refLabelField`, used by `sessions` and `delivery` — the audit feature just did not declare it. Both now carry `refEntity: "user:user"`, `refLabelField: "displayName"`, which also makes the `createdBy → user:user` relation machine-readable in the app schema instead of implicit.

  `audit:query:list` and `audit:query:details` are unchanged and still return the plain id.

  A system write (`SYSTEM_USER_ID`, the null UUID) has no `read_users` row, so the bulk reference lookup can never resolve it. `SYSTEM_REFERENCE_LABELS` gained a `user:user` entry with the new `kumiko.reference.system-user` key, so every screen referencing `user:user` — not just the audit log — renders "System" for it. An actor that resolves to no row at all (deleted user) keeps the existing generic fallback: the raw id, no throw.

  `SYSTEM_USER_ID` moved from `framework/engine/system-user` to `kumiko-types/identifiers`, next to `SYSTEM_TENANT_ID`, so the client-side reference-label map can read it without importing a runtime module. `engine/system-user` re-exports it — every existing import keeps working.

  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: Audit log shows actor display names instead of raw UUIDs (fw#3103)
  migration: The audit feature now declares `r.requires("tenant", "user")`. An app that mounts `createAuditFeature()` without the `user` feature fails at boot with `Feature "audit" requires feature "user" which is not registered` — mount `createUserFeature()`. Apps using `securityBaselineFeatures()` already had to mount it.
  -->

- Updated dependencies [787c572]
- Updated dependencies [fbe8ffa]
- Updated dependencies [7b5ac24]
- Updated dependencies [6d53c10]
  - @cosmicdrift/kumiko-framework@0.292.0

## 0.291.0

### Patch Changes

- Updated dependencies [0fa2da2]
- Updated dependencies [ef54b65]
- Updated dependencies [d47adef]
- Updated dependencies [ca8d3e3]
- Updated dependencies [53e20f4]
- Updated dependencies [67a4227]
- Updated dependencies [0621367]
- Updated dependencies [0fd6bb5]
- Updated dependencies [229298b]
- Updated dependencies [32a1ce3]
  - @cosmicdrift/kumiko-framework@0.291.0

## 0.290.0

### Patch Changes

- Updated dependencies [878d8b2]
- Updated dependencies [9da6b5f]
- Updated dependencies [fe23245]
  - @cosmicdrift/kumiko-framework@0.290.0

## 0.289.0

### Patch Changes

- Updated dependencies [78f9c42]
- Updated dependencies [efac5bb]
- Updated dependencies [20853fa]
- Updated dependencies [1e5a8e0]
- Updated dependencies [f01015e]
- Updated dependencies [a84d3cb]
- Updated dependencies [dea8ea0]
- Updated dependencies [2e868a7]
- Updated dependencies [253ade3]
  - @cosmicdrift/kumiko-framework@0.289.0

## 0.288.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.288.0

## 0.287.0

### Patch Changes

- Updated dependencies [3489874]
- Updated dependencies [76f2631]
  - @cosmicdrift/kumiko-framework@0.287.0

## 0.286.0

### Patch Changes

- Updated dependencies [1f7ab5d]
  - @cosmicdrift/kumiko-framework@0.286.0

## 0.285.2

### Patch Changes

- Updated dependencies [9c28242]
  - @cosmicdrift/kumiko-framework@0.285.2

## 0.285.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.285.1

## 0.285.0

### Patch Changes

- Updated dependencies [8ee38b3]
  - @cosmicdrift/kumiko-framework@0.285.0

## 0.284.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.284.0

## 0.283.0

### Patch Changes

- Updated dependencies [45f7641]
  - @cosmicdrift/kumiko-framework@0.283.0

## 0.282.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.282.0

## 0.281.0

### Patch Changes

- Updated dependencies [8de23a7]
- Updated dependencies [7ae9256]
- Updated dependencies [7bf2e5e]
- Updated dependencies [f1dc700]
  - @cosmicdrift/kumiko-framework@0.281.0

## 0.280.0

### Patch Changes

- Updated dependencies [fae19a6]
  - @cosmicdrift/kumiko-framework@0.280.0

## 0.279.0

### Patch Changes

- Updated dependencies [e55f357]
  - @cosmicdrift/kumiko-framework@0.279.0

## 0.278.0

### Patch Changes

- Updated dependencies [3e1eb25]
- Updated dependencies [17dcac1]
  - @cosmicdrift/kumiko-framework@0.278.0

## 0.277.0

### Patch Changes

- Updated dependencies [411e80b]
  - @cosmicdrift/kumiko-framework@0.277.0

## 0.276.0

### Patch Changes

- Updated dependencies [e2312ee]
  - @cosmicdrift/kumiko-framework@0.276.0

## 0.275.0

### Patch Changes

- Updated dependencies [2cb61dd]
- Updated dependencies [9d9a462]
  - @cosmicdrift/kumiko-framework@0.275.0

## 0.274.0

### Patch Changes

- Updated dependencies [47070b6]
- Updated dependencies [282072a]
  - @cosmicdrift/kumiko-framework@0.274.0

## 0.273.0

### Patch Changes

- Updated dependencies [e9d3944]
- Updated dependencies [01c9133]
  - @cosmicdrift/kumiko-framework@0.273.0

## 0.272.0

### Patch Changes

- Updated dependencies [147fb82]
- Updated dependencies [6c55fa2]
- Updated dependencies [94812d3]
- Updated dependencies [7bf4309]
  - @cosmicdrift/kumiko-framework@0.272.0

## 0.271.0

### Patch Changes

- Updated dependencies [94b9d44]
- Updated dependencies [c704c75]
- Updated dependencies [60ed7ed]
- Updated dependencies [c704c75]
- Updated dependencies [5f8be0d]
  - @cosmicdrift/kumiko-framework@0.271.0

## 0.270.0

### Patch Changes

- Updated dependencies [dba0a60]
  - @cosmicdrift/kumiko-framework@0.270.0

## 0.269.2

### Patch Changes

- Updated dependencies [3d58c23]
  - @cosmicdrift/kumiko-framework@0.269.2

## 0.269.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.269.1

## 0.269.0

### Patch Changes

- Updated dependencies [ec9aaca]
- Updated dependencies [8412e09]
  - @cosmicdrift/kumiko-framework@0.269.0

## 0.268.0

### Patch Changes

- Updated dependencies [b16457a]
  - @cosmicdrift/kumiko-framework@0.268.0

## 0.267.0

### Patch Changes

- Updated dependencies [e87ab51]
  - @cosmicdrift/kumiko-framework@0.267.0

## 0.266.0

### Patch Changes

- Updated dependencies [4d36b68]
  - @cosmicdrift/kumiko-framework@0.266.0

## 0.265.0

### Patch Changes

- Updated dependencies [371a263]
  - @cosmicdrift/kumiko-framework@0.265.0

## 0.264.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.264.1

## 0.264.0

### Patch Changes

- Updated dependencies [d0184f7]
  - @cosmicdrift/kumiko-framework@0.264.0

## 0.263.0

### Patch Changes

- Updated dependencies [cd255ca]
- Updated dependencies [f6732fa]
  - @cosmicdrift/kumiko-framework@0.263.0

## 0.262.0

### Patch Changes

- Updated dependencies [6fbede9]
  - @cosmicdrift/kumiko-framework@0.262.0

## 0.261.0

### Patch Changes

- Updated dependencies [5139a3f]
  - @cosmicdrift/kumiko-framework@0.261.0

## 0.260.0

### Patch Changes

- Updated dependencies [71b9c4b]
  - @cosmicdrift/kumiko-framework@0.260.0

## 0.259.0

### Minor Changes

- 20dc41a: fw#2844 (decision fw#2841): declarative screens are composable. A `dashboard` takes a new `DashboardScreenPanel` (`kind: "screen"`) that embeds another registered screen — `screen` is a same-feature short id or a cross-feature QN `<feature>:screen:<id>`, resolved like actionForm `redirect`. Together with `kind: "custom"` for app content this replaces the "framework screen plus own content" custom screens three consumer apps carried with an `app-feature-structure` lint-ignore.

  - The boot-validator rejects an unresolvable target and target types that can't stand in a tile: `dashboard` (no nesting), `entityEdit`/`projectionDetail` (need a route id), `custom` (use a custom panel), `entityList`. Embeddable: `projectionList`, `actionForm`, `secretMint`, `configEdit`, `secretsEdit`.
  - `visibleWhen: { query, field, eq }` shows the panel only while `field` of the query's flat result equals `eq`. The query runs live, so a write that flips the state (e.g. `auth-mfa:query:user-mfa:status`) swaps panels without reload; hidden while loading. The query is checked against registered query handlers at boot.
  - A user without access to the target screen doesn't get the tile at all — no "access denied" banner inside an otherwise working page.
  - `@cosmicdrift/kumiko-renderer` exports `useEmbeddedScreen(hostFeatureName, screen)`; `DashboardBodyProps` gains the required `featureName` (KumikoScreen passes it; only relevant for a custom dashboard body implementation).

  Bundled self-service screens so account security needs no custom code:

  - `auth-mfa`: `auth-mfa-disable` (actionForm on `auth-mfa:write:disable`) and `auth-mfa-regenerate-recovery` (secretMint on `auth-mfa:write:regenerate-recovery`, one-time reveal of the new codes), next to the existing `auth-mfa-enable`. Exported ids `MFA_DISABLE_SCREEN_ID`, `MFA_REGENERATE_RECOVERY_SCREEN_ID`.
  - `sessions`: `my-sessions` (projectionList, open to every signed-in user) on `sessions:query:user-session:mine` — revoke per row (hidden on the current session) and "sign out all other devices". Exported id `SESSION_MINE_SCREEN_ID`.

  **BREAKING**

  `sessions:query:user-session:mine` returns the paged envelope `{ rows, nextCursor: null }` instead of a bare array, so the projectionList can bind to it (same migration `personal-access-tokens:query:mine` went through). Migration: read `data.rows` instead of `data`. The account-security custom screens in money-horse, publicstatus and kumiko-studio that call this query are superseded by the composition above (money-horse#477, publicstatus#435, kumiko-studio#283).

### Patch Changes

- Updated dependencies [20dc41a]
  - @cosmicdrift/kumiko-framework@0.259.0

## 0.258.1

### Patch Changes

- Updated dependencies [3c6c428]
  - @cosmicdrift/kumiko-framework@0.258.1

## 0.258.0

### Patch Changes

- Updated dependencies [f2e57b4]
- Updated dependencies [c1b53a3]
- Updated dependencies [27166cb]
  - @cosmicdrift/kumiko-framework@0.258.0

## 0.257.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.257.0

## 0.256.0

### Patch Changes

- Updated dependencies [586d707]
  - @cosmicdrift/kumiko-framework@0.256.0

## 0.255.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.255.2

## 0.255.1

### Patch Changes

- Updated dependencies [5b04527]
  - @cosmicdrift/kumiko-framework@0.255.1

## 0.255.0

### Patch Changes

- Updated dependencies [88530a2]
- Updated dependencies [0374846]
- Updated dependencies [1212eeb]
- Updated dependencies [7003472]
  - @cosmicdrift/kumiko-framework@0.255.0

## 0.254.0

### Patch Changes

- Updated dependencies [9b74bc9]
  - @cosmicdrift/kumiko-framework@0.254.0

## 0.253.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.253.0

## 0.252.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.252.1

## 0.252.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.252.0

## 0.251.0

### Patch Changes

- Updated dependencies [55691fd]
- Updated dependencies [28ad1f3]
  - @cosmicdrift/kumiko-framework@0.251.0

## 0.250.0

### Patch Changes

- Updated dependencies [86e18dd]
- Updated dependencies [a4a25ee]
- Updated dependencies [e349f03]
- Updated dependencies [0be08d9]
- Updated dependencies [d9f9337]
- Updated dependencies [5c1c606]
  - @cosmicdrift/kumiko-framework@0.250.0

## 0.249.0

### Patch Changes

- Updated dependencies [812795d]
  - @cosmicdrift/kumiko-framework@0.249.0

## 0.248.0

### Patch Changes

- Updated dependencies [109ff0d]
  - @cosmicdrift/kumiko-framework@0.248.0

## 0.247.0

### Minor Changes

- 25cbdd2: fw#2722 (remaining scope — Card-Rahmen already shipped separately): a `relatedList` section can now sort and no longer stretches the page.

  **Sorting.** `ListColumnSpec` gains a `sortable?: boolean` flag and `EditRelatedListSection` gains `defaultSort?: ListSortSpec` — declared per-column, the same shape `entityList.defaultSort` uses, and validated the same way at boot (`defaultSort.field` must name a listed, `sortable: true` column, or the app fails to boot). Both are opt-in: a `relatedList` section that declares neither behaves exactly as before.

  Sorting is applied **client-side**, over the rows already loaded for the section. Unlike `entityList`/`projectionList`, a `relatedList` section has no pager at all — one one-shot fetch, no cursor, no `onReachEnd`. When the server-side `limit` truncates that fetch (`PagedRows.nextCursor !== null`), the loaded rows are only the first page in the server's own order, not "the top N by this column" — sorting that subset client-side would otherwise silently misrepresent it as the latter. `RelatedListSection` now renders an info `Banner` above the table whenever `nextCursor !== null`, independent of whether a sort is active, naming how many rows are shown (`kumiko.list.related-list-truncated`, added to `i18n-defaults.ts` and the `locale-de`/`locale-es` packages). Sending the sort to the server instead would need pagination this section doesn't have, so it was not built for this PR.

  **Height.** A `relatedList` section in a tabs-mode Akte (the layout that already hides the section title, `hideSectionTitles: true`) now fills the tab panel's available height and scrolls its table internally, instead of a fixed `60vh` guess or growing the whole page — the concrete complaint (a 40-row Akte tab pushing the page and making the record unusable, on any viewport height) is fixed. `FormProps` gains a `fillHeight` flag; `RenderEdit` sets it only when tabs mode has narrowed the form to a single, active `relatedList` section (`hideSectionTitles === true && filteredSections[0]?.kind === "relatedList"`) — every other form (multi-section, non-`relatedList` tabs, stacked non-tabs forms, `entityList`/`projectionList`) is untouched. The flag threads a `flex-1 min-h-0` chain from `FormRoot` through `FormScreenShell`, the form's card, `RelatedListSection`'s own wrapper, down to `DataTableProps.scrollBody`'s table body (now `flex-1 min-h-0 overflow-y-auto` instead of `h-[60vh] overflow-y-auto`) — the narrow-viewport card list (`scrollBody`'s `cardsInner()` branch) gets the same `flex-1 min-h-0 overflow-y-auto` treatment so it scrolls internally instead of clipping. No change to `app-layout.tsx`/`DefaultAppShell` was needed: `<main>` is already viewport-bounded with a passive `overflow-auto`, so a child that itself never grows past `<main>`'s available height never triggers it — avoiding nested scrollbars without touching shell code shared by every screen. This depends on the shell's `fill` prop staying at its default `true` (an app-level choice, not per-screen); `fill={false}` is an explicit page-scroll escape hatch that leaves `<main>` height-unbound, so the chain degrades gracefully to the pre-fix, unbounded-growth behavior rather than clipping — grepped across every consuming app repo in the workspace, none currently sets `fill={false}`.

  `@cosmicdrift/kumiko-renderer` stays platform-neutral (no DOM/Tailwind), so the terminal link of this chain — the wrapper around `RelatedListSection`'s `hideTitle` content — can't be a raw `<div>`. `CorePrimitives` gains an optional `FillContainer` primitive (same additive-rollout pattern as `JsonView`/`Drawer`/`Progress`: existing partial `CorePrimitives` test doubles keep compiling), implemented in `renderer-web` as the `flex-1 min-h-0 flex-col` div; `RelatedListSection` falls back to rendering its content unwrapped when a host has no `FillContainer` (e.g. a native impl, where the parent is already a bounded viewport and the wrapper is meaningless).

  Not included: search/facets on `relatedList` (`ListFacetSpec`, as `projectionList` has it). Doing this properly would mean replacing `RelatedListSection`'s synthetic minimal entity (a `{ type: "text" }` field per column, with no real query-schema/facet metadata behind it) with genuine reuse of the `projectionList` path — a structural rebuild out of scope for this PR. Left for a follow-up ticket.

  https://claude.ai/code/session_0135cRvFdyV956Aae8PxyyDd

### Patch Changes

- Updated dependencies [25cbdd2]
- Updated dependencies [f9f5608]
  - @cosmicdrift/kumiko-framework@0.247.0

## 0.246.0

### Patch Changes

- Updated dependencies [b4d5b20]
- Updated dependencies [f2c9178]
  - @cosmicdrift/kumiko-framework@0.246.0

## 0.245.0

### Patch Changes

- Updated dependencies [3359dae]
  - @cosmicdrift/kumiko-framework@0.245.0

## 0.244.0

### Patch Changes

- Updated dependencies [2cb949e]
- Updated dependencies [dc4e6a2]
  - @cosmicdrift/kumiko-framework@0.244.0

## 0.243.4

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.4

## 0.243.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.3

## 0.243.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.2

## 0.243.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.1

## 0.243.0

### Patch Changes

- Updated dependencies [349d763]
  - @cosmicdrift/kumiko-framework@0.243.0

## 0.242.0

### Patch Changes

- Updated dependencies [efd5891]
  - @cosmicdrift/kumiko-framework@0.242.0

## 0.241.0

### Patch Changes

- Updated dependencies [8289b69]
  - @cosmicdrift/kumiko-framework@0.241.0

## 0.240.0

### Patch Changes

- Updated dependencies [db53bbc]
  - @cosmicdrift/kumiko-framework@0.240.0

## 0.239.0

### Patch Changes

- Updated dependencies [2fbab3d]
  - @cosmicdrift/kumiko-framework@0.239.0

## 0.238.0

### Minor Changes

- 8206493: `ListColumnSpec` gains optional `refEntity`/`refLabelField` fields so `projectionList`/`relatedList` columns can declare a reference lookup — those screens have no `EntityDefinition` to carry a real `reference` field type, so a declared reference column previously rendered the raw id. `computeListViewModel` now checks this metadata before the entity-fields lookup and marks the column as `type: "reference"`; the existing renderer-side bulk lookup (`useReferenceLookup`) picks it up automatically.

  `delivery-log`'s `tenantId` column and `sessions-list`'s `userId` column now declare this metadata and resolve to the tenant/user display name instead of the GUID. `useReferenceLookup` also gained a generic fallback (`SYSTEM_REFERENCE_LABELS`, keyed by `refFeature:refEntity`) for reference ids that have no backing row — currently covering `SYSTEM_TENANT_ID`, which renders as the new `kumiko.reference.system-tenant` ("System") label instead of the all-zero GUID.

  `EditFieldSpec` gains the same `refEntity`/`refLabelField` metadata for `projectionDetail` fields, resolved by `computeEditViewModel` with the same before-the-fieldDef-lookup precedence; `session-detail`'s `userId` field now declares it (matching `sessions-list`) and its read-only display (`ReadOnlyReferenceValue`) also consults `SYSTEM_REFERENCE_LABELS`.

### Patch Changes

- Updated dependencies [8206493]
  - @cosmicdrift/kumiko-framework@0.238.0

## 0.237.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.237.2

## 0.237.1

### Patch Changes

- Updated dependencies [da3aed4]
  - @cosmicdrift/kumiko-framework@0.237.1

## 0.237.0

### Patch Changes

- Updated dependencies [0f399c2]
- Updated dependencies [1dca3bc]
- Updated dependencies [9b2eae0]
  - @cosmicdrift/kumiko-framework@0.237.0

## 0.236.1

### Patch Changes

- Updated dependencies [825acb8]
  - @cosmicdrift/kumiko-framework@0.236.1

## 0.236.0

### Patch Changes

- Updated dependencies [ccad32d]
- Updated dependencies [69529cd]
- Updated dependencies [e668a62]
  - @cosmicdrift/kumiko-framework@0.236.0

## 0.235.4

### Patch Changes

- Updated dependencies [c5a5dd4]
- Updated dependencies [41ef079]
  - @cosmicdrift/kumiko-framework@0.235.4

## 0.235.3

### Patch Changes

- Updated dependencies [fa9a541]
  - @cosmicdrift/kumiko-framework@0.235.3

## 0.235.2

### Patch Changes

- Updated dependencies [1ce74b3]
  - @cosmicdrift/kumiko-framework@0.235.2

## 0.235.1

### Patch Changes

- Updated dependencies [4c83a80]
  - @cosmicdrift/kumiko-framework@0.235.1

## 0.235.0

### Minor Changes

- 38d7ffc: The self-populating settings hub now also derives a screen from `r.secret(...)` declarations, alongside masked config keys.

  - New `secretsEdit` screen, grouped by declaring feature, shown under the tenant-audience nav with label/hint taken from the declaration.
  - The screen only appears when the `secrets` feature is mounted, and mirrors the access rule of `secrets:write:set`.
  - Inputs always start empty — the redacted preview is shown next to the field but never loaded into it; deleting a secret goes through `secrets:write:delete`.

  Consumer note: new screen type `SecretsEditScreenDefinition` added to the `ScreenDefinition` union — consumers that switch exhaustively on `screen.type` need to handle it.

### Patch Changes

- Updated dependencies [9dc8d1c]
- Updated dependencies [38d7ffc]
- Updated dependencies [5882fb3]
  - @cosmicdrift/kumiko-framework@0.235.0

## 0.234.0

### Patch Changes

- Updated dependencies [40a8143]
  - @cosmicdrift/kumiko-framework@0.234.0

## 0.233.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.233.0

## 0.232.0

### Patch Changes

- Updated dependencies [aeac06f]
- Updated dependencies [05bdf93]
- Updated dependencies [03a8df0]
  - @cosmicdrift/kumiko-framework@0.232.0

## 0.231.0

### Patch Changes

- Updated dependencies [404d143]
- Updated dependencies [5d4c21e]
- Updated dependencies [4f4bc49]
  - @cosmicdrift/kumiko-framework@0.231.0

## 0.230.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.230.0

## 0.229.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.229.1

## 0.229.0

### Patch Changes

- Updated dependencies [ebadd51]
  - @cosmicdrift/kumiko-framework@0.229.0

## 0.228.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.228.0

## 0.227.0

### Patch Changes

- Updated dependencies [5f157b6]
  - @cosmicdrift/kumiko-framework@0.227.0

## 0.226.0

### Patch Changes

- Updated dependencies [211ff70]
- Updated dependencies [db616cb]
- Updated dependencies [bcac6f3]
- Updated dependencies [c4ed490]
  - @cosmicdrift/kumiko-framework@0.226.0

## 0.225.0

### Patch Changes

- aa1a1a7: German/Spanish translations for the new `cap-overview` feature's strings, and the regenerated feature manifest (`create-kumiko-app`) that lists it as an available choice.
- Updated dependencies [aa1a1a7]
- Updated dependencies [d63b2e8]
  - @cosmicdrift/kumiko-framework@0.225.0

## 0.224.2

### Patch Changes

- Updated dependencies [415ff22]
  - @cosmicdrift/kumiko-framework@0.224.2

## 0.224.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.224.1

## 0.224.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.224.0

## 0.223.0

### Minor Changes

- c4d07f5: `createMultiSelectField` can now render as a checkbox grid instead of the combobox dropdown. Set `display: "checkboxes"` on the field to get one checkbox per option plus a select-all/deselect-all toggle; omitting `display` keeps the existing combobox behavior unchanged.

  Two more options come on top, both only meaningful with `display: "checkboxes"`:

  - `columns` (1–4) sets the grid's column count at the widest breakpoint; narrow viewports always collapse to a single column.
  - `maxRows` caps how many grid rows stay visible before the grid becomes vertically scrollable; omitted, the grid grows with its content.

  Setting `columns` or `maxRows` without `display: "checkboxes"`, or an invalid `maxRows` (not a positive integer), fails at boot.

### Patch Changes

- Updated dependencies [c4d07f5]
  - @cosmicdrift/kumiko-framework@0.223.0

## 0.222.0

### Patch Changes

- Updated dependencies [6a13c64]
- Updated dependencies [8edfaa0]
- Updated dependencies [b00604c]
- Updated dependencies [d3ec5e0]
- Updated dependencies [afceecd]
  - @cosmicdrift/kumiko-framework@0.222.0

## 0.221.0

### Patch Changes

- Updated dependencies [1656ff9]
- Updated dependencies [fab31bf]
  - @cosmicdrift/kumiko-framework@0.221.0

## 0.220.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.220.1

## 0.220.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.220.0

## 0.219.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.219.0

## 0.218.0

### Patch Changes

- Updated dependencies [bfae2fb]
  - @cosmicdrift/kumiko-framework@0.218.0

## 0.217.0

### Patch Changes

- Updated dependencies [02aadf9]
  - @cosmicdrift/kumiko-framework@0.217.0

## 0.216.0

### Patch Changes

- Updated dependencies [89654bc]
  - @cosmicdrift/kumiko-framework@0.216.0

## 0.215.7

### Patch Changes

- 93220e2: Panel-ready for offlot: translate projectionList facets, Members status-filter es/de, cap-list gauge icon, SystemAdmin cross-tenant delivery log (incl. SYSTEM_TENANT_ID).
  - @cosmicdrift/kumiko-framework@0.215.7

## 0.215.6

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.6

## 0.215.5

### Patch Changes

- Updated dependencies [16454c2]
  - @cosmicdrift/kumiko-framework@0.215.5

## 0.215.4

### Patch Changes

- Updated dependencies [e2a55b2]
  - @cosmicdrift/kumiko-framework@0.215.4

## 0.215.3

### Patch Changes

- be16c6b: Normalize the tenant-concept terminology: German UI copy now consistently says "Mandant" (was a mix of "Mandant"/"Tenant"/"Organisation" across bundles), Spanish consistently says "Organización" (was a mix of "Organización"/loanword "tenant"). English source copy for `config.settings.tenant` reverted to "Tenant" to match the chosen term.
- Updated dependencies [469ec58]
  - @cosmicdrift/kumiko-framework@0.215.3

## 0.215.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.2

## 0.215.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.1

## 0.215.0

### Patch Changes

- Updated dependencies [5cf7f9d]
- Updated dependencies [2bcf3c9]
  - @cosmicdrift/kumiko-framework@0.215.0

## 0.214.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.214.0

## 0.213.0

### Patch Changes

- fd90843: SignupCompleteScreen now shows a confirmation with a continue button after successful account activation, instead of silently redirecting.
- Updated dependencies [7ffd0f6]
- Updated dependencies [774ca7d]
  - @cosmicdrift/kumiko-framework@0.213.0

## 0.212.0

### Patch Changes

- 120e585: Audit log actor column and detail view now show a translated "System" label when an event's `createdBy` is the literal `"system"` string written by system-authored events (e.g. delivery attempts), instead of rendering an empty cell.
- Updated dependencies [35b0005]
- Updated dependencies [d006e42]
- Updated dependencies [28fc80a]
  - @cosmicdrift/kumiko-framework@0.212.0

## 0.211.0

### Patch Changes

- Updated dependencies [f38784b]
  - @cosmicdrift/kumiko-framework@0.211.0

## 0.210.0

### Patch Changes

- Updated dependencies [f2e6862]
- Updated dependencies [8b4467d]
- Updated dependencies [1ba89fb]
- Updated dependencies [d85987c]
- Updated dependencies [db14e69]
  - @cosmicdrift/kumiko-framework@0.210.0

## 0.209.1

### Patch Changes

- Updated dependencies [f387a20]
- Updated dependencies [2c05054]
  - @cosmicdrift/kumiko-framework@0.209.1

## 0.209.0

### Patch Changes

- Updated dependencies [f707d1b]
- Updated dependencies [49662ef]
- Updated dependencies [12df48b]
- Updated dependencies [f86cf43]
- Updated dependencies [b9fdc41]
- Updated dependencies [92a5361]
  - @cosmicdrift/kumiko-framework@0.209.0

## 0.208.3

### Patch Changes

- Updated dependencies [e595330]
- Updated dependencies [8087d17]
  - @cosmicdrift/kumiko-framework@0.208.3

## 0.208.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.208.2

## 0.208.1

### Patch Changes

- Updated dependencies [f538bc0]
  - @cosmicdrift/kumiko-framework@0.208.1

## 0.208.0

### Minor Changes

- 025c5b9: Framework UI copy is English-only. German and Spanish live in `@cosmicdrift/kumiko-locale-de` / `-es`. Apps that want those languages mount `localeDe()` + `localeDeClient()` (or the es equivalents). Without a locale package, framework screens and auth/GDPR mails render in English.

### Patch Changes

- Updated dependencies [025c5b9]
  - @cosmicdrift/kumiko-framework@0.208.0
