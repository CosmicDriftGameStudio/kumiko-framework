---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stripe checkout now retries once without the customer when the stored customer id is unknown to Stripe (for example after switching from a test to a live account), instead of failing with "No such customer".
