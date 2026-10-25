# @cosmicdrift/kumiko-locale-it

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

### Minor Changes

- e36d480: French and Italian UI and mail copy
  
  Two new opt-in packages ship French and Italian copy for the framework screens and mails. Mount `localeFr()` + `localeFrClient()` or `localeIt()` + `localeItClient()`; for mail copy only, call `registerMailTranslations("fr", localeFrBundle)` (or `"it"` with `localeItBundle`).
  
  <!-- kumiko-changes
  feature: locale-fr
  type: improvement
  title: New opt-in package kumiko-locale-fr ships French framework copy
  detail: Same shape as kumiko-locale-es; not included by includeBundled.
  -->
  
  <!-- kumiko-changes
  feature: locale-it
  type: improvement
  title: New opt-in package kumiko-locale-it ships Italian framework copy
  detail: Same shape as kumiko-locale-es; not included by includeBundled.
  -->

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
