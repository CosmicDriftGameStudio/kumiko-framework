---
"@cosmicdrift/kumiko-bundled-features": patch
---

Mail steps no longer repeat a send that cannot succeed or may already have gone out. A mail runner failure with an SMTP 5xx `smtpCode` is recorded at once instead of being retried three times, and a mail runner that throws is recorded as failed without a retry, because a mail has no idempotency key and the provider may have accepted it before the error. Failures without a code and 4xx codes are still retried; webhook steps keep their retries under the Idempotency-Key.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: Mail steps do not retry permanent rejections or throws
detail: MailDispatchResult failures take an optional smtpCode; 5xx is permanent and recorded after the first attempt. A throwing mail runner is not retried, since the message may already be sent. A mail runner that wants a retry after a transport error should return a failure without smtpCode instead of throwing.
-->
