# @cosmicdrift/kumiko-renderer-puppeteer-client

## 0.390.0

### Patch Changes

- Updated dependencies [38e816b]
- Updated dependencies [2376b07]
- Updated dependencies [1a7eebe]
- Updated dependencies [5d7dfe1]
- Updated dependencies [a01d30a]
- Updated dependencies [c2fd4b3]
- Updated dependencies [22f792d]
- Updated dependencies [84e9d9c]
- Updated dependencies [c2fd4b3]
- Updated dependencies [454b49d]
- Updated dependencies [4b36bd9]
- Updated dependencies [21b70ba]
- Updated dependencies [be576a7]
- Updated dependencies [5ee91c6]
- Updated dependencies [febcd93]
- Updated dependencies [c2fd4b3]
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
- Updated dependencies [8c25e2f]
- Updated dependencies [d6c1dec]
- Updated dependencies [22f9f23]
- Updated dependencies [9cf6cc6]
- Updated dependencies [6c1151a]
- Updated dependencies [54cda5b]
- Updated dependencies [9e6de88]
- Updated dependencies [276216d]
- Updated dependencies [dd62f90]
- Updated dependencies [f5f2fe9]
- Updated dependencies [a01d30a]
  - @cosmicdrift/kumiko-bundled-features@0.390.0
  - @cosmicdrift/kumiko-framework@0.390.0
  - @cosmicdrift/kumiko-types@0.390.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.390.0

## 0.389.0

### Minor Changes

- 2602c62: `renderPdfBytes(ctx, { slug, locale, variables })` renders a PDF and returns `fileName`, `pdfBytes`, `pageCount`, `sizeBytes`, `template` and `layout` without storing a file or a rendered-pdf row. `renderPdfBeforeTransaction` now builds on it.
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: Render a PDF without storing it
  detail: renderPdfBytes is the render half of renderPdfBeforeTransaction. Use it when the bytes go straight into a mail or a download and no file or rendered-pdf row should exist.
  -->

### Patch Changes

- Updated dependencies [47ba075]
- Updated dependencies [1b3a297]
- Updated dependencies [ed98312]
- Updated dependencies [c16fa0c]
- Updated dependencies [ac00e8a]
- Updated dependencies [7ca1a98]
- Updated dependencies [95b16ff]
- Updated dependencies [1b8c7ba]
- Updated dependencies [7b3c3c0]
- Updated dependencies [77a25ac]
- Updated dependencies [e2211ac]
- Updated dependencies [641f268]
- Updated dependencies [ffbb25e]
- Updated dependencies [641f268]
- Updated dependencies [ffbb25e]
- Updated dependencies [ad0c891]
- Updated dependencies [947470b]
- Updated dependencies [dd5fd28]
- Updated dependencies [a50674e]
- Updated dependencies [8a6508a]
- Updated dependencies [53e2a0e]
- Updated dependencies [9253635]
- Updated dependencies [ab1ca17]
- Updated dependencies [f75a6dd]
- Updated dependencies [5b72552]
- Updated dependencies [bd1b61a]
- Updated dependencies [5947ab0]
- Updated dependencies [7d5f95c]
- Updated dependencies [2dd1de3]
- Updated dependencies [7336a78]
- Updated dependencies [768a67e]
- Updated dependencies [f0c2983]
- Updated dependencies [c14ccd3]
- Updated dependencies [203085b]
- Updated dependencies [6bb9d66]
- Updated dependencies [a407a3c]
- Updated dependencies [9a72476]
- Updated dependencies [d8f9c73]
- Updated dependencies [91fb415]
- Updated dependencies [9253635]
- Updated dependencies [e5fe5f2]
- Updated dependencies [8628ea3]
- Updated dependencies [bec6021]
- Updated dependencies [bec6021]
- Updated dependencies [9253635]
- Updated dependencies [a50674e]
- Updated dependencies [5b707a6]
- Updated dependencies [cee9e32]
- Updated dependencies [aa83c70]
- Updated dependencies [bec6021]
- Updated dependencies [a50674e]
- Updated dependencies [80399a2]
- Updated dependencies [59028a5]
- Updated dependencies [a50674e]
- Updated dependencies [d6940f1]
- Updated dependencies [ff84ee4]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [2602c62]
- Updated dependencies [8449190]
- Updated dependencies [080c5e7]
- Updated dependencies [76c95ae]
  - @cosmicdrift/kumiko-bundled-features@0.389.0
  - @cosmicdrift/kumiko-framework@0.389.0
  - @cosmicdrift/kumiko-types@0.389.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.389.0

## 0.388.0

### Patch Changes

- 7ef7e6c: Mail footer, richText meta lines and PDF image conditions hardened.
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: fix
  title: Mail footer cannot be dropped, richText in subject is plain text
  detail: An mjml layout without the mailFooterHtml placeholder now gets the platform footer appended before the end of the body. Layout links to the imprint or unsubscribe URL only count when they sit in the header, signature or footer region and have link text. richText variables in subject, preview and other meta lines render as plain text instead of raw HTML. An invalid tenant time zone is logged as a warning.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: fix
  title: Conditions on images variables work in the PDF render
  detail: A data-condition on an images variable now shows its block when the record has resolvable images, instead of never. Record image loading stops once the byte budget is used up, caps the number of looked-up ids, and ignores image blocks whose variable is not declared as images.
  -->
- Updated dependencies [7e54012]
- Updated dependencies [f81f639]
- Updated dependencies [bd38fdc]
- Updated dependencies [7447ac1]
- Updated dependencies [7e54012]
- Updated dependencies [b4be520]
- Updated dependencies [ff553d1]
- Updated dependencies [e1c01e4]
- Updated dependencies [2b49eb8]
- Updated dependencies [be79841]
- Updated dependencies [1adee91]
- Updated dependencies [9eec92b]
- Updated dependencies [044428c]
- Updated dependencies [9ba9cf4]
- Updated dependencies [7e54012]
- Updated dependencies [4e3bb2c]
- Updated dependencies [453b3f0]
- Updated dependencies [4ce85cd]
- Updated dependencies [ee0aaf9]
- Updated dependencies [ed4e21b]
- Updated dependencies [374a12b]
- Updated dependencies [cecdf71]
- Updated dependencies [014b9ab]
- Updated dependencies [37db191]
- Updated dependencies [b62c381]
- Updated dependencies [ab7c4ee]
- Updated dependencies [7ef7e6c]
- Updated dependencies [2924949]
- Updated dependencies [c52702e]
- Updated dependencies [b62e6cd]
- Updated dependencies [1e3e94d]
- Updated dependencies [084c9c0]
- Updated dependencies [c5b197e]
- Updated dependencies [c2a97fd]
- Updated dependencies [669cd2e]
- Updated dependencies [3c57f8f]
- Updated dependencies [2fb7e2b]
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
- Updated dependencies [1425622]
  - @cosmicdrift/kumiko-framework@0.388.0
  - @cosmicdrift/kumiko-bundled-features@0.388.0
  - @cosmicdrift/kumiko-types@0.388.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.388.0

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
  - @cosmicdrift/kumiko-bundled-features@0.387.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.387.0
  - @cosmicdrift/kumiko-types@0.387.0

## 0.386.0

### Patch Changes

- Updated dependencies [f0a9e8f]
- Updated dependencies [5759e39]
  - @cosmicdrift/kumiko-framework@0.386.0
  - @cosmicdrift/kumiko-types@0.386.0
  - @cosmicdrift/kumiko-bundled-features@0.386.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.386.0

## 0.385.0

### Patch Changes

- Updated dependencies [3b011a8]
- Updated dependencies [9950dd0]
- Updated dependencies [e345be5]
  - @cosmicdrift/kumiko-framework@0.385.0
  - @cosmicdrift/kumiko-bundled-features@0.385.0
  - @cosmicdrift/kumiko-types@0.385.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.385.0

## 0.384.0

### Patch Changes

- Updated dependencies [c28119a]
- Updated dependencies [f516b5d]
- Updated dependencies [26cd745]
- Updated dependencies [26cd745]
- Updated dependencies [26cd745]
  - @cosmicdrift/kumiko-framework@0.384.0
  - @cosmicdrift/kumiko-bundled-features@0.384.0
  - @cosmicdrift/kumiko-types@0.384.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.384.0

## 0.383.1

### Patch Changes

- Updated dependencies [4ea38e1]
  - @cosmicdrift/kumiko-framework@0.383.1
  - @cosmicdrift/kumiko-bundled-features@0.383.1
  - @cosmicdrift/kumiko-renderer-mail-html@0.383.1
  - @cosmicdrift/kumiko-types@0.383.1

## 0.383.0

### Patch Changes

- Updated dependencies [72ac4b1]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
  - @cosmicdrift/kumiko-framework@0.383.0
  - @cosmicdrift/kumiko-types@0.383.0
  - @cosmicdrift/kumiko-bundled-features@0.383.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.383.0

## 0.382.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.382.0
  - @cosmicdrift/kumiko-framework@0.382.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.382.0
  - @cosmicdrift/kumiko-types@0.382.0

## 0.381.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.381.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.381.0
  - @cosmicdrift/kumiko-framework@0.381.0
  - @cosmicdrift/kumiko-types@0.381.0

## 0.380.0

### Patch Changes

- Updated dependencies [07ccdc9]
  - @cosmicdrift/kumiko-framework@0.380.0
  - @cosmicdrift/kumiko-types@0.380.0
  - @cosmicdrift/kumiko-bundled-features@0.380.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.380.0

## 0.379.0

### Minor Changes

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

### Patch Changes

- 5876d7b: Billing confirmation and termination receipt mails reach users again when PII encryption is active. The tests of the designer and renderer packages are now part of the root type check, and a DOM test no longer types into a form before its effects have run.
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: Contract mails reach users with encrypted email addresses
  detail: With a KMS configured, the contract confirmation and the receipt for a termination from the user account used the stored, encrypted email address as recipient. The mail channel refuses such addresses, so neither mail was sent and the send job failed after its retries. Both now decrypt the address first; an erased user gets no mail, as before for deleted users.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Long template names wrap in the template overview
  detail: In the template overview, a long template name such as "Kündigungshinweis an den Betreiber" now wraps to a second line instead of widening the first column. The overview fits at 1280 px again when billing-foundation templates are listed.
  -->
- 632da48: Ships kumiko-es-tables.json, the list of this package's event-store tables, so the direct-entity-writes guard can recognise them in consumer repos.
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: Package ships its event-store table catalog
  detail: kumiko-es-tables.json is included in the published files; no runtime change.
  -->
- ece210b: PDF rendering passes the registry to createTemplateResolverApi so locked overrides are not served.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: PDF rendering follows the template delivery policy
  detail: Resolves templates through createTemplateResolverApi(db, registry); overrides of locked templates fall back to the system version.
  -->
- Updated dependencies [ba1a10e]
- Updated dependencies [aa886cc]
- Updated dependencies [ba1a10e]
- Updated dependencies [2a057b1]
- Updated dependencies [5876d7b]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [632da48]
- Updated dependencies [632da48]
- Updated dependencies [94d55c0]
- Updated dependencies [d72e1fc]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [9d81e04]
- Updated dependencies [7b01b0d]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [434be6e]
  - @cosmicdrift/kumiko-framework@0.379.0
  - @cosmicdrift/kumiko-types@0.379.0
  - @cosmicdrift/kumiko-bundled-features@0.379.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.379.0

## 0.378.0

### Minor Changes

- 2d7ee3e: Document PDFs can embed the images of a record
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Document PDFs embed the images of a record
  detail: A template variable of type images (templateVariable.images()) holds FileRef ids of the record. The new Images block (div[data-images], PDF templates only, rejected for mail kinds) renders them as data-URI images in the real PDF render. Only files of the rendering tenant are read, only png, jpeg, gif and webp, at most 24 images and 20 MB per document; missing, foreign, oversized or non-image ids are dropped silently. Previews and draft PDFs never read files and show one placeholder box per block. An images variable never renders as inline text. i18n keys template-resolver.documentEditor.images, template-resolver.documentEditor.imagesVariable and templateResolver.errors.document.imagesBlockPdfOnly ship in de, es, fr and it.
  migration: Declare a template variable with type `images`, place the Images block, and pass FileRef ids of the record in `variables`. Images resolve only in the real PDF render, previews show placeholders. The ids must come from the record on the server, never from client input: a resolved id is read for the whole tenant without an entity access check.
  -->

### Patch Changes

- Updated dependencies [2d7ee3e]
- Updated dependencies [0250376]
- Updated dependencies [a08f6d6]
- Updated dependencies [e75268c]
- Updated dependencies [a08f6d6]
- Updated dependencies [a08f6d6]
- Updated dependencies [6352d97]
  - @cosmicdrift/kumiko-types@0.378.0
  - @cosmicdrift/kumiko-framework@0.378.0
  - @cosmicdrift/kumiko-bundled-features@0.378.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.378.0

## 0.377.0

### Patch Changes

- Updated dependencies [ae10fa6]
- Updated dependencies [e552c13]
- Updated dependencies [c00af64]
- Updated dependencies [60a29a8]
- Updated dependencies [9400d43]
- Updated dependencies [c00af64]
- Updated dependencies [c00af64]
- Updated dependencies [fd450c2]
  - @cosmicdrift/kumiko-bundled-features@0.377.0
  - @cosmicdrift/kumiko-framework@0.377.0
  - @cosmicdrift/kumiko-types@0.377.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.377.0

## 0.376.0

### Patch Changes

- Updated dependencies [05ba6c5]
- Updated dependencies [5274ebc]
- Updated dependencies [6a15526]
- Updated dependencies [e3e3faa]
  - @cosmicdrift/kumiko-bundled-features@0.376.0
  - @cosmicdrift/kumiko-types@0.376.0
  - @cosmicdrift/kumiko-framework@0.376.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.376.0

## 0.375.0

### Patch Changes

- Updated dependencies [4ca58ad]
- Updated dependencies [5c7b19e]
  - @cosmicdrift/kumiko-bundled-features@0.375.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.375.0
  - @cosmicdrift/kumiko-framework@0.375.0
  - @cosmicdrift/kumiko-types@0.375.0

## 0.374.0

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
  - @cosmicdrift/kumiko-types@0.374.0
  - @cosmicdrift/kumiko-framework@0.374.0
  - @cosmicdrift/kumiko-bundled-features@0.374.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.374.0

## 0.373.0

### Patch Changes

- Updated dependencies [6913834]
- Updated dependencies [6913834]
  - @cosmicdrift/kumiko-framework@0.373.0
  - @cosmicdrift/kumiko-types@0.373.0
  - @cosmicdrift/kumiko-bundled-features@0.373.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.373.0

## 0.372.0

### Patch Changes

- Updated dependencies [a4401ab]
- Updated dependencies [de53a14]
- Updated dependencies [16ab9fe]
- Updated dependencies [7c04d2a]
- Updated dependencies [7c04d2a]
- Updated dependencies [7c04d2a]
- Updated dependencies [5cd8710]
- Updated dependencies [236858e]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [27b759f]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [221f81c]
- Updated dependencies [dca222d]
- Updated dependencies [2cb8b4f]
- Updated dependencies [4224023]
- Updated dependencies [9bc4bc4]
- Updated dependencies [7c04d2a]
  - @cosmicdrift/kumiko-framework@0.372.0
  - @cosmicdrift/kumiko-bundled-features@0.372.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.372.0
  - @cosmicdrift/kumiko-types@0.372.0

## 0.371.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.371.1
  - @cosmicdrift/kumiko-framework@0.371.1
  - @cosmicdrift/kumiko-renderer-mail-html@0.371.1
  - @cosmicdrift/kumiko-types@0.371.1

## 0.371.0

### Patch Changes

- Updated dependencies [5a822b2]
  - @cosmicdrift/kumiko-bundled-features@0.371.0
  - @cosmicdrift/kumiko-framework@0.371.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.371.0
  - @cosmicdrift/kumiko-types@0.371.0

## 0.370.0

### Patch Changes

- Updated dependencies [8ff5d19]
- Updated dependencies [a02e354]
- Updated dependencies [a02e354]
- Updated dependencies [79a0aa6]
- Updated dependencies [2930518]
- Updated dependencies [8ff5d19]
- Updated dependencies [4a6e151]
- Updated dependencies [a02e354]
- Updated dependencies [c051152]
- Updated dependencies [8ff5d19]
- Updated dependencies [75c45e4]
- Updated dependencies [2930518]
- Updated dependencies [2930518]
- Updated dependencies [2930518]
- Updated dependencies [7fa8420]
- Updated dependencies [8ff5d19]
  - @cosmicdrift/kumiko-framework@0.370.0
  - @cosmicdrift/kumiko-bundled-features@0.370.0
  - @cosmicdrift/kumiko-types@0.370.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.370.0

## 0.369.0

### Patch Changes

- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [a4cab24]
  - @cosmicdrift/kumiko-bundled-features@0.369.0
  - @cosmicdrift/kumiko-types@0.369.0
  - @cosmicdrift/kumiko-framework@0.369.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.369.0

## 0.368.0

### Patch Changes

- fbc0759: One DB connection factory: createDbConnection({ url, ... }) on postgres-js, and the query helpers move from the bun-db subpath into the db subpath
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: createDbConnection({ url, ... }) is the only connection factory, query helpers move from /bun-db to /db
  detail: |
    postgres-js is the only DB driver. createDbConnection takes one options object, is synchronous and accepts the new options ssl and onNotice. The Bun.SQL provider, createConnection, createPgConnection and DB_PROVIDER are removed. The query helpers (selectMany, insertOne, transaction, asRawClient, ...) keep their API and are now exported from @cosmicdrift/kumiko-framework/db. The `tx` handed to the transaction() callback is typed as DbTx (the postgres-js transaction handle it always was at runtime) instead of the Bun.SQL instance type; a helper that takes `db: DbConnection` and receives that tx needs `DbRunner` or `DbTx`.
  
    The positional form createDbConnection(url, options) and the @cosmicdrift/kumiko-framework/bun-db subpath keep working as deprecated aliases and are removed in the first release after 2026-10-29.
  
    old -> new:
      createConnection(url, options) (async) -> createDbConnection({ url, ...options }) (sync)
      createPgConnection(url, options) -> createDbConnection({ url, ...options })
      createDbConnection(url, options) -> createDbConnection({ url, ...options }) (positional form is deprecated)
      @cosmicdrift/kumiko-framework/bun-db -> @cosmicdrift/kumiko-framework/db (deprecated alias until the first release after 2026-10-29)
  
    Removed without replacement: createBunDbConnection, bunDbConnectionOptionsFromEnv, the BunDbConnection, BunDbTx, BunDbRunner and BunDbConnectionOptions types, DbPoolHandle (use DbConnectionHandle), the PgListenClient re-export from /bun-db (import it from @cosmicdrift/kumiko-types/db-connection) and the DB_PROVIDER environment variable.
  migration: Run `bun kumiko-upgrade --apply`. It rewrites bun-db imports to /db, createDbConnection(url, options) and createConnection/createPgConnection calls to the object form, and reports leftovers (removed Bun.SQL exports, DB_PROVIDER) with file and line. Remove DB_PROVIDER from your env files.
  codemod: scripts/codemod/db-factory.ts
  -->
- 478ee1f: createTenantDb takes one options object, and HandlerContext/AppContext drop the internal _userId and _handlerType fields
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: createTenantDb({ db, tenantId, ... }) takes one options object
  detail: |
    createTenantDb takes one CreateTenantDbOptions object ({ db, tenantId, mode?, tracer?, meter?, signal?, grants? }); mode still defaults to "tenant". The positional form createTenantDb(db, tenantId, mode, tracer, meter, signal, grants) keeps working as a deprecated overload and is removed in the first release after 2026-10-29.
  
    old -> new:
      createTenantDb(db, tenantId) -> createTenantDb({ db, tenantId })
      createTenantDb(db, tenantId, "system", tracer, meter, signal, grants) -> createTenantDb({ db, tenantId, mode: "system", tracer, meter, signal, grants })
  migration: Run `bun kumiko-upgrade --apply`. It rewrites positional calls (literal undefined arguments are dropped) and reports spread arguments, calls with more than seven arguments and uses of createTenantDb as a value (callback, .bind/.call/.apply) with file and line.
  codemod: scripts/codemod/tenant-db-options.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: HandlerContext and AppContext no longer expose _userId and _handlerType
  detail: |
    The dispatcher no longer sets _userId and _handlerType on the context of write handlers, query handlers and hooks. The caller identity is ctx.user.id. requireSecretsContext reads ctx._userId first and falls back to ctx.user.id, so passing a handler context to it keeps the same audit identity. Provider contexts (FileProviderContext, MailTransportContext, InboundMailContext) keep their own _userId. JobContext._userId is unchanged.
  migration: Replace ctx._userId with ctx.user.id in write/query handlers and hooks. Known sites: one file each in money-horse, offlot-app, phronexsis and kumiko-enterprise. _handlerType had no readers.
  -->
- 1404b33: Test stack and test helpers move from kumiko-framework to kumiko-testing; the old framework paths stay as deprecated re-exports
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Test stack and helpers moved to kumiko-testing, old framework paths are deprecated
  detail: |
    Everything a test needs now lives in @cosmicdrift/kumiko-testing. Its core (stack, helpers, preload, bunfig, integration-runner) depends only on kumiko-framework and kumiko-types; bundled-features and dev-server are optional peers used by the root entry and /e2e. Install kumiko-testing as a dev dependency where tests import it.
  
    The old framework paths re-export the new ones and are removed in the first release after 2026-10-29. Production symbols that tests also use stay in the framework.
  
    old -> new:
      @cosmicdrift/kumiko-framework/stack -> @cosmicdrift/kumiko-testing/stack
      TestUsers, testTenantId, testUserId, createTestUser from /stack -> @cosmicdrift/kumiko-framework/seeding
      @cosmicdrift/kumiko-framework/testing -> @cosmicdrift/kumiko-testing/helpers
      bridgeStub from /testing and /testing/handler-context -> @cosmicdrift/kumiko-framework/engine
      @cosmicdrift/kumiko-framework/testing/real-providers -> @cosmicdrift/kumiko-testing/helpers/real-providers
      @cosmicdrift/kumiko-framework/testing/e2e-generator -> @cosmicdrift/kumiko-testing/helpers/e2e-generator
  migration: Run `bun kumiko-upgrade --apply`. It rewrites imports from the old paths and splits mixed imports by target. Add @cosmicdrift/kumiko-testing to devDependencies where it is missing.
  codemod: scripts/codemod/testing-move.ts
  -->
- Updated dependencies [133ef08]
- Updated dependencies [39b5de4]
- Updated dependencies [1a1b772]
- Updated dependencies [fbc0759]
- Updated dependencies [7949df2]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [be3c6eb]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [478ee1f]
- Updated dependencies [1404b33]
  - @cosmicdrift/kumiko-framework@0.368.0
  - @cosmicdrift/kumiko-bundled-features@0.368.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.368.0
  - @cosmicdrift/kumiko-types@0.368.0

## 0.367.0

### Patch Changes

- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [04bf143]
- Updated dependencies [5f2cc2f]
  - @cosmicdrift/kumiko-bundled-features@0.367.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.367.0
  - @cosmicdrift/kumiko-types@0.367.0
  - @cosmicdrift/kumiko-framework@0.367.0

## 0.366.0

### Patch Changes

- 7053800: The registrar takes one object per call: r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook lose their positional forms
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Registrar methods take a single object, positional calls throw at registration
  detail: |
    r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook now take one object. The positional overloads are gone from the types and throw when the feature is defined, with a message that points at the codemod. The throw is removed in the first release after 2026-10-29.
  
    writeHandler (queryHandler is the same shape):
      before: r.writeHandler("order:archive", schema, handler, { access });
      after:  r.writeHandler({ name: "order:archive", schema, handler, access });
  
    hook (type picks the handler shape, target is a name, a list or { allOf }):
      before: r.hook("postSave", "order", handler, { escapeHatch });
      after:  r.hook({ type: "postSave", target: "order", handler, escapeHatch });
  
    entity and requires:
      before: r.entity("order", definition, { table: ordersTable });  r.requires("auth", "tenant");
      after:  r.entity({ name: "order", ...definition, backingTable: ordersTable });  r.requires({ features: ["auth", "tenant"] });
  
    registerEntityCrud is no longer exported from @cosmicdrift/kumiko-framework/engine; call r.crud(name, entity, options) instead. The entity option { table } is now backingTable on the r.entity object and lands in the feature's entityTables, not in its entities. HookDefinition and EntityObjectDefinition are exported from @cosmicdrift/kumiko-types. Hook definitions are checked per type: validation takes no escapeHatch, phase only exists on postSave and postDelete, and { allOf } is not accepted on preSave.
  migration: Run `bun kumiko-upgrade --apply`. It rewrites every positional r.writeHandler, r.queryHandler, r.entity, r.requires, r.hook and registerEntityCrud call to the object form. Calls it cannot resolve statically (a spread argument, a registrar that is not typed as FeatureRegistrar) are listed as manual work with file and line; rewrite those by hand.
  codemod: scripts/codemod/object-form.ts
  manualAfterCodemod: true
  -->
- Updated dependencies [09d5344]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [a919906]
- Updated dependencies [15d76a8]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [8a7d835]
- Updated dependencies [7053800]
- Updated dependencies [3d58dea]
- Updated dependencies [5df8e3a]
- Updated dependencies [22b7f6e]
- Updated dependencies [7053800]
  - @cosmicdrift/kumiko-bundled-features@0.366.0
  - @cosmicdrift/kumiko-framework@0.366.0
  - @cosmicdrift/kumiko-types@0.366.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.366.0

## 0.365.1

### Patch Changes

- Updated dependencies [93e1a7d]
- Updated dependencies [9a8abc9]
- Updated dependencies [34530bf]
- Updated dependencies [8633239]
- Updated dependencies [34530bf]
- Updated dependencies [34530bf]
  - @cosmicdrift/kumiko-framework@0.365.1
  - @cosmicdrift/kumiko-bundled-features@0.365.1
  - @cosmicdrift/kumiko-types@0.365.1
  - @cosmicdrift/kumiko-renderer-mail-html@0.365.1

## 0.365.0

### Patch Changes

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
- 72a5c9c: Correct the release note on image-snapshot requests
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: breaking
  title: image-snapshot HTML must embed every resource as a data URI
  detail: An earlier release note said image-snapshot requests were unchanged. Since the puppeteer-service egress guard, the service fetches no http(s) resources for any request kind, so external img, link and font references in an image-snapshot are dropped without an error.
  migration: Embed images, fonts and stylesheets in image-snapshot HTML as data: URIs before sending payload.content.
  -->
- b6b75fa: image-snapshot reports the real image size, and the pdf-layout default slug has one source
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: fix
  title: image-snapshot width and height come from the image header; PDF default layout slug is shared
  detail: The service screenshots the full page, so the image can be taller than the requested viewport; the response now reports the size read from the PNG or JPEG header. DEFAULT_PDF_LAYOUT_SLUG is exported from template-resolver and used by both the PDF renderer and the editor preview, so they cannot pick different layouts. image-snapshot HTML must embed all resources as data: URIs because the service fetches no http(s) resources.
  -->
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [cd16f29]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [7aa3223]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [7e1b974]
- Updated dependencies [e4ecaba]
- Updated dependencies [ec7d696]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [81169ec]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [fbc6938]
- Updated dependencies [5a1cdc1]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
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
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [45abe9d]
- Updated dependencies [5e5d83b]
- Updated dependencies [72a5c9c]
- Updated dependencies [a546703]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [5c276e6]
- Updated dependencies [21c5cbc]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [72a5c9c]
- Updated dependencies [0f8bff5]
- Updated dependencies [84d7f1a]
- Updated dependencies [067aa7b]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [cd16f29]
- Updated dependencies [72a5c9c]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [72a5c9c]
  - @cosmicdrift/kumiko-bundled-features@0.365.0
  - @cosmicdrift/kumiko-framework@0.365.0
  - @cosmicdrift/kumiko-types@0.365.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.365.0

## 0.364.0

### Minor Changes

- e9b032f: renderAndStorePdf is replaced by renderPdfBeforeTransaction and storeRenderedPdf
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: breaking
  title: renderAndStorePdf is removed; render in beforeTransaction with renderPdfBeforeTransaction and store with storeRenderedPdf
  detail: renderAndStorePdf called the print service inside the write transaction and held a pool connection for the whole render. renderPdfBeforeTransaction(ctx, { slug, locale, variables, attachTo? }) now renders and uploads the PDF before the transaction opens, and storeRenderedPdf(ctx, event.prepared) writes the fileRef and rendered-pdf rows inside it. RenderAndStorePdfArgs is renamed RenderPdfArgs.
  migration: Move the render into the handler's beforeTransaction phase and store in the handler: defineWriteHandler({ name, schema, access, beforeTransaction: (event, ctx) => renderPdfBeforeTransaction(ctx, { slug: "invoice", locale: "de", variables }), handler: (event, ctx) => storeRenderedPdf(ctx, event.prepared) }). The result of storeRenderedPdf has the same shape as the old renderAndStorePdf result (StoredRenderedPdf). Rename the RenderAndStorePdfArgs type to RenderPdfArgs. A handler with a beforeTransaction phase cannot be called through a nested ctx.write; call it as a top-level command.
  -->

### Patch Changes

- 8e81d73: PDF editor saves only the margins that are set; preview and error handling fixes
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: PDF editor keeps unset margins unset, frees old PDF previews, and shows reset and diff errors
  detail: Setting one margin no longer stores the other three as 15 mm, so the layout's header and footer margins still apply to them. The PDF preview no longer re-renders pages or stacks text layers on re-render and destroys the previous document. A failed reset to the system version shows an error banner in the PDF and mail editors, and a failing diff query shows an error state with retry instead of loading forever. The canvas reserves the footer margin like the renderer. Page formats, orientations and default margins now come from template-resolver (new exports PDF_ORIENTATIONS, PDF_DEFAULT_MARGIN_MM, PDF_HEADER_MARGIN_MM, PDF_FOOTER_MARGIN_MM, PdfOrientation).
  -->
- 15039ce: Render requests retry only network errors, 502 and 503, and the timeout covers the body
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: fix
  title: Render requests retry only network errors, 502 and 503, and the timeout covers the body
  detail: A 500 or 504 from puppeteer-service is a final RendererError with code other instead of being retried up to maxRetries times, and a client timeout abort is final too, so a failing or slow render no longer starts parallel renders on the service. The request timer now runs until the response body is read, so a service that stalls after the headers cannot block the caller forever.
  -->
- 15039ce: Template preview size budget and draft scope
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: Template preview counts encoding overhead and reports missing attachments
  detail: The mail size estimate counts base64 size plus a fixed per-part overhead, an attachment whose file reference is missing fails the resources_resolved check, and the document draft scope is derived once per request.
  -->
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [a0dcd31]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [cfbffba]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [6b1567e]
- Updated dependencies [2b255c2]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [fd5009a]
- Updated dependencies [8be3807]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [c181b3f]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [b13c0d4]
- Updated dependencies [fd5009a]
- Updated dependencies [dfb2523]
- Updated dependencies [8fb6aa6]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [5a39305]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [7482ee2]
- Updated dependencies [f1b4367]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [c181b3f]
- Updated dependencies [22f40e1]
- Updated dependencies [5a2bea5]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [baf641a]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8be3807]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [68078ee]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [b5a6395]
- Updated dependencies [fd5009a]
- Updated dependencies [55f003d]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
  - @cosmicdrift/kumiko-bundled-features@0.364.0
  - @cosmicdrift/kumiko-framework@0.364.0
  - @cosmicdrift/kumiko-types@0.364.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.364.0

## 0.363.0

### Minor Changes

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

- 0a79504: Server side of the PDF editor: PDF preview, page setup and text alignment

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: Query preview-pdf prints a document draft to a real PDF
  detail: renderer-puppeteer-client:query:preview-pdf takes { slug, locale, content, meta, variableSchema? } and returns { fileName, pdfBase64, pageCount, sizeBytes, durationMs }. The draft passes the same write rules as a save, is printed with the sample values of its variable schema through the puppeteer-service and nothing is stored. It is limited to 60 calls per user and hour and fails with puppeteer_unavailable (HTTP 503) while the service does not answer. Access is TenantAdmin and SystemAdmin.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: PDF meta gets orientation, printBackground and layoutHeaderFooter; paragraphs and headings get data-align
  detail: The document-pdf meta accepts orientation (portrait or landscape), printBackground (default true) and layoutHeaderFooter (false prints without the layout header and footer). Paragraphs and headings carry textAlign (left, center, right, justify), serialized as data-align and kept by the sanitizer only with these four values. New exports are evaluateDocumentDraft, localeSchema, DOCUMENT_TEXT_ALIGNMENTS and DocumentTextAlign; compileDocumentBodyToHandlebars accepts alignmentAsInlineStyle.
  -->

  <!-- kumiko-changes
  feature: renderer-foundation
  type: improvement
  title: PdfOptions has landscape
  detail: The document-pdf options gain landscape, which the puppeteer-service passes to Chromium.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Text alignment of paragraphs and headings is sent as an inline style
  detail: A paragraph or heading with data-align is rendered with an inline text-align, because mail clients ignore document CSS.
  -->

- 0a79504: Add the PDF template editor screen (`@cosmicdrift/kumiko-document-designer/web`): placeholder panel, page canvas with layout header and footer, page settings, validation footer and a pdf.js preview. The template-resolver document editor gains an `align` block, labelled placeholder chips, a repeat-table bar and an `onEditorReady` handle; `template-resolver/web` exports the qualified names; `renderer-puppeteer-client` exports `./qualified-names`; renderer-web's stylesheet scans the new package.

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: New package with the PDF template editor screen
  detail: "@cosmicdrift/kumiko-document-designer/web" exports documentDesignerClient(screenId), PdfTemplateEditorScreen, PdfTemplateEditor and documentDesignerTranslations. The screen takes the template from the URL (?slug=...&locale=...), edits the system template for a SystemAdmin and a tenant customisation for everyone else, and previews the printed PDF with pdf.js. template-resolver/web additionally exports DocumentEditorHandle, TemplateResolverQueries, TemplateResolverHandlers and TemplateResolverErrors.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: uploadFileRef uploads a file to the stack and returns its FileRef id
  detail: uploadFileRef(file, target?) posts to /api/files with the CSRF header and returns the new FileRef id; it throws FileUploadFailedError carrying the server message when the endpoint sent one. FileUploadInput uses it with unchanged behaviour.
  -->

- f7da271: The puppeteer-client renderer plugin moves from kumiko-enterprise into the framework under the `@cosmicdrift` scope; the API is unchanged.

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: breaking
  title: Package moved to the framework under the @cosmicdrift scope
  detail: Renamed from @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client (GitHub Packages, kumiko-enterprise) to @cosmicdrift/kumiko-renderer-puppeteer-client on npmjs; the API is unchanged.
  migration: |
    Replace @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client with @cosmicdrift/kumiko-renderer-puppeteer-client in package.json and in every import; install from npmjs instead of GitHub Packages.
  -->

### Patch Changes

- a12e094: dispatcher-live validates server envelopes with Zod

  <!-- kumiko-changes
  feature: dispatcher-live
  type: improvement
  title: dispatcher-live validates server envelopes with Zod
  detail: Query, write, batch and stream responses are parsed against Zod schemas for the envelope (isSuccess, error, failedIndex, results); the data payload stays typed by the caller. A malformed envelope now yields the network_error fallback ("unexpected response shape") instead of passing wrongly typed fields through; bare gate errors ({ error } from csrf, origin, auth or rate limits) keep their code, and a missing i18nKey defaults to errors.unknown; a malformed SSE error frame yields stream_error, and failing batch items get httpStatus filled from the response like top-level errors. renderer-web types CSS custom properties on React's CSSProperties instead of casting style objects.
  -->

- 3c6b3da: Layouts resolve across locales

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: resolveLayout finds a layout in any locale
  detail: TemplateResolverApi gains resolveLayout({ tenantId, slug, kind, locale }) for mail-layout and pdf-layout. It looks at the tenant first (requested locale, then the fallback locale, then any active locale) and then at the system layouts the same way, ignoring draft and archived rows. A layout saved by the layout editor under one locale is therefore found for every locale. The template preview uses it for the PDF layout.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: fix
  title: Mails use a tenant layout stored under another locale
  detail: The mail renderer resolves its layout with resolveLayout, so a tenant layout saved in en no longer leaves German mails without the tenant branding.
  -->

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: fix
  title: PDFs use a tenant layout stored under another locale
  detail: The document PDF renderer resolves its letterhead with resolveLayout, so a tenant pdf-layout saved under one locale applies to every document locale.
  -->

- Updated dependencies [9120f65]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [045f886]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [b9a146d]
- Updated dependencies [9120f65]
- Updated dependencies [58452ae]
- Updated dependencies [ef689d8]
- Updated dependencies [3c6b3da]
- Updated dependencies [09a4aa2]
- Updated dependencies [0a79504]
- Updated dependencies [b022cca]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [0a79504]
- Updated dependencies [0a79504]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [f7da271]
- Updated dependencies [6b8d89b]
- Updated dependencies [9120f65]
- Updated dependencies [7ed530a]
- Updated dependencies [d35e9a0]
- Updated dependencies [549a6f6]
- Updated dependencies [f3fe91e]
- Updated dependencies [3c6b3da]
- Updated dependencies [2972bc2]
- Updated dependencies [3c6b3da]
- Updated dependencies [46b83b8]
- Updated dependencies [cbed66e]
- Updated dependencies [366d89f]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [9120f65]
  - @cosmicdrift/kumiko-bundled-features@0.363.0
  - @cosmicdrift/kumiko-framework@0.363.0
  - @cosmicdrift/kumiko-types@0.363.0
  - @cosmicdrift/kumiko-renderer-mail-html@0.363.0
