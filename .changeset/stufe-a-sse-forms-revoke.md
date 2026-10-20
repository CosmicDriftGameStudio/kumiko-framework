---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Live updates reconnect and resync after a dropped stream, forms ask before throwing away unsaved input, and the receipt of a public cancellation carries a link to take it back.

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
detail: The SSE route counts the writes a client has not consumed. Past SSE_MAX_PENDING_WRITES_PER_CLIENT the stream is aborted, the client reconnects and resyncs; one failing client no longer stops the broadcast to the others. A burst of more than that many frames in one tick also drops a healthy client once, which then resyncs.
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
