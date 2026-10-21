# @cosmicdrift/kumiko-locale-it

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
