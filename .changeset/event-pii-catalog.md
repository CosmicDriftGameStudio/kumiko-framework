---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

PII on custom-event payloads (#799). `r.defineEvent(name, schema, { piiFields: { recipientAddress: { subjectField: "recipientId" } } })` declares payload fields that are encrypted under the owning user's DEK (crypto-shredding). Enforcement lives in the low-level event-store `append()` — the single write funnel — so `ctx.appendEvent`, MSP-apply AND out-of-dispatcher writers (delivery attempt-log, jobs run-logger) are all covered; the stored event and the returned echo carry ciphertext, keeping inline projections and rebuilds identical. A null subject field (system cron runs, recipient-less attempts) stays plaintext — there is no user key to shred. Misconfigured `piiFields` (unknown field/subjectField) throw at feature-definition time.

Bundled features annotated: `delivery:event:attempt`.`recipientAddress` (subject = recipientId) and `jobs` `run-started`.`payload` (subject = triggeredById); the pseudonymous fk ids stay plaintext. `delivery log.query` and `jobs list/details` decrypt for display — a forgotten subject shows `[[erased]]`. This makes the events-only aggregates from #797 Art.-17-capable: user-forget erases the DEK, historical delivery addresses and job payloads become unreadable without touching the append-only stream. New exports: `encryptPiiValueForSubject`, `configureEventPiiCatalog`/`configuredEventPiiCatalog`/`encryptEventPayloadPii` (framework/crypto).
