---
"@cosmicdrift/kumiko-bundled-features": patch
---

Delivery evaluates channel gates once per recipient, rate-limits before resolving, and re-checks opt-outs after a retry resolve

<!-- kumiko-changes
feature: delivery
type: fix
title: Delivery checks opt-outs for addresses resolved on the retry path and logs idempotency release failures
detail: The kill switch, preference and rate-limit result per recipient channel is computed once in the prefetch and reused when delivering; the rate limit now runs before the address is resolved. When the prefetch resolve failed and the address is resolved again, the suppression list is reloaded for exactly that address, so an unsubscribed address no longer receives the mail. A failing idempotency-key release is logged and swallowed instead of masking the delivery outcome.
-->
