---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Review fixes: an inline mail image no longer swallows transient storage errors, the unsubscribe tenant origin is resolved once per notify call, one-click unsubscribe POSTs keep the JSON rejection, the resubscribe limit has its own page text, and form drafts fail loudly when the PII key service is missing.

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
