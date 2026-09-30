---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

step.dispatch-requested payloads are flat and crypto-shredded; kumiko:system:* events have a declared PII stance

<!-- kumiko-changes
feature: step-dispatcher
type: breaking
title: step.dispatch-requested payloads are flat and crypto-shredded; kumiko:system:* events have a declared PII stance
migration: |
  No code change is needed for r.step.mail.send / r.step.webhook.send callers. The step.dispatch-requested payload changed from a nested `spec` object to flat fields (mail.send: to as JSON string, subject, body, from; webhook.send: url, method, headersJson, bodyJson, auth, retry). With a subject KMS configured, those fields are encrypted under a per-dispatch record key (record:step-dispatch:<aggregateId>) that the step-dispatcher erases once the outcome is recorded (Art. 17 via crypto-shredding). There is no legacy branch: a dispatch-requested event still in flight at upgrade (old nested shape) ends as step.dispatch-failed with error "invalid dispatch payload", so drain the queue before deploying or accept the one-time failed event. Webhook delivery errors no longer echo the URL or the raw request error. mail.send delivery errors are recorded as a generic "mail delivery failed"; the adapter's raw error goes to the step-dispatcher log. Code reading dispatch-requested payloads directly must switch to the flat shape. A new kumiko:system:* event type must be added to SYSTEM_EVENT_PII_STANCES (crypto/system-event-pii.ts); encryptEventPayloadPii throws for an undeclared system type. SYSTEM_EVENT_PREFIX and AGGREGATE_TRANSFERRED_EVENT_TYPE now live in crypto/system-event-pii.ts, and the STEP_DISPATCH_* constants are exported from @cosmicdrift/kumiko-framework/engine instead of engine/steps/webhook-send.
-->
