---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Review fixes: a Paddle legacy checkout is redelivered again when the ledger backfill marker fails transiently, a plan-switch consent older than 24 hours is no longer attached to a later tier change, WhatsApp media and context ids are dropped instead of truncated, and `waitlist` and `helpdesk` no longer re-export `normalizeEmail`.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Review fixes for Paddle redelivery, plan-switch consent age and WhatsApp ids
detail: shouldRedeliverLegacyCheckout answers false only for configuration or permission failures of the backfill marker (access_denied, not_found, feature_disabled) and true for transient or internal ones, since Paddle retries only a bounded number of times. billing-foundation attaches a recorded switch consent to a provider tier change only within 24 hours before the provider event time. channel-whatsapp sets mediaId and contextWamid to null when they exceed the id length instead of truncating them into a different reference. The waitlist and helpdesk lib modules no longer re-export normalizeEmail; it comes from the shared index.
-->
