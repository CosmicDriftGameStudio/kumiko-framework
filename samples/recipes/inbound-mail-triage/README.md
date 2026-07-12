# Sample: Inbound-Mail Triage

Attach a business process to inbound e-mail: `inbound-mail-foundation` owns transport, dedup and PII — this sample's `mail-triage` feature turns every ingested mail into a triage item via a worker-lane job.

## What you learn here

- **Consumer pattern**: hook your business process onto the foundation's ingest write-handler with `r.job({ trigger: { on: InboundMailFoundationHandlers.ingestMessage } })` — the job receives the plaintext normalized mail (PII encryption happens inside the handler, after your trigger payload was captured).
- **Idempotency discipline**: the trigger also fires on idempotent replays (duplicate ingest returns success) — key your side-effects by `providerMessageId` so replays overwrite instead of duplicating.
- **Provider swap**: the test drives `inbound-provider-inmemory`; production mounts `inbound-provider-imap` (password/app-password, IMAP IDLE) against the same contract — the consumer code does not change.

## Feature composition

```
config + tenant + compliance-profiles + tenant-lifecycle   (foundation requirements)
inbound-mail-foundation                                     (streams, projections, ingest)
inbound-provider-inmemory                                   (scriptable provider)
mail-triage  ← this sample                                  (the app-side consumer)
```

## Flow

1. `connect-account` creates a mail account (shared mailbox, `ownerUserId = null`).
2. A mail is ingested — in production the watch-supervisor (IMAP IDLE push) or the reconciliation poll dispatches `ingest-message`; the inline projection materializes `read_inbound_messages` in the same transaction.
3. The handler-trigger fans the write out to the worker lane; the triage job records `{ from, subject, scope, threadHint }`.
4. A replay of the same `providerMessageId` reports `duplicate: true`, creates no second row — and the keyed triage store stays at one item.

## Tests

- E2E through `createAllInOneEntrypoint` (HTTP → dispatcher → BullMQ worker lane, no framework-internal shortcuts): connect → ingest → triage item appears.
- Replay scenario: duplicate ingest stays idempotent on both the projection and the consumer side.
