---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Support-friendly error UI, client error reporting, a wider leave guard and an IBAN text format: errors show a copyable reference, browser errors reach the server, global navigation asks before dropping unsaved input and `format: "iban"` validates IBANs.

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
feature: fields
type: improvement
title: Text field format "iban"
detail: createTextField({ format: "iban" }) validates the value server-side (spaces ignored, case-insensitive, country and check digits shape plus mod-97) and reports invalid_format with format iban, which the form maps to errors.validation.invalid_format.iban (texts in en, de, es, fr, it). The value is stored as typed.
-->
