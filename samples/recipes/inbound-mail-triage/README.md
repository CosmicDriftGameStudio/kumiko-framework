# Sample: Inbound-Mail Triage

Attach a business process to inbound e-mail: `inbound-mail-foundation` owns transport, dedup and PII — this sample's `mail-triage` feature turns every ingested mail into a triage item via a worker-lane job.

## What you learn here

- **Consumer pattern**: hook your business process onto the foundation's ingest write-handler with `r.job({ trigger: { on: InboundMailFoundationHandlers.ingestMessage } })` — the job receives the plaintext normalized mail (PII encryption happens inside the handler, after your trigger payload was captured).
- **Idempotency discipline**: the trigger also fires on idempotent replays (duplicate ingest returns success) — key your side-effects by `providerMessageId` so replays overwrite instead of duplicating.
- **Provider swap**: the test drives `inbound-provider-inmemory`; production mounts `inbound-provider-imap` (password/app-password, IMAP IDLE) against the same contract — the consumer code does not change.

## Feature composition

```
tenant-lifecycle (transitively pulls tenant + config + compliance-profiles)
inbound-mail-foundation                                     (streams, projections, ingest)
inbound-provider-inmemory                                   (scriptable provider)
mail-triage  ← this sample                                  (the app-side consumer)
```

## Flow

1. `connect-account` creates a mail account (shared mailbox, `ownerUserId = null`).
2. A mail is ingested — in production the watch-supervisor (IMAP IDLE push) or the reconciliation poll dispatches `ingest-message`; the inline projection materializes `read_inbound_messages` in the same transaction.
3. The handler-trigger fans the write out to the worker lane; the triage job records `{ from, subject, scope, threadHint }`.
4. A replay of the same `providerMessageId` reports `duplicate: true`, creates no second row — and the keyed triage store stays at one item.

## Sign-in errors

When the provider rejects the stored login, the supervisor sets the account to `auth_error` and stops fetching. With `inbound-provider-imap` mounted, the mail accounts list offers **Reconnect** on that row: the form `mail-account-reconnect-imap` is prefilled with the stored server settings (never the password), `inbound-provider-imap:write:reconnect-mailbox` checks the new login and puts the same account back to `active`. Threads, sync cursor and seen messages stay, so the next poll continues where the account stopped instead of ingesting the mailbox again. The cases are covered in `inbound-provider-imap/__tests__/reconnect-mailbox.integration.test.ts`; they need greenmail, which this sample's in-memory provider does not.

## Mail content, quarantine and status

Every ingested mail now carries its full text (`bodyText`, at most 32,000 characters, flagged by `bodyTextTruncated`), the original (`.eml`, or `.html` for HTML-only mails) and its attachments as file references; `inbound-mail-foundation:query:message:content` returns them, while `message:list` stays light and never carries the body. Retention removes the mail row but keeps the attachment files. Needs file storage in the app; without it the mail is still imported and the mailbox shows **Unterbrochen** (`file_storage_unavailable`).

A mail the provider cannot parse is set aside in quarantine instead of blocking the mailbox: the rest imports, the sync cursor moves on, the account shows `degraded` with `lastError: message_quarantined` and the count, and `acknowledge-quarantine` clears it. Three failed polls in a row (`connection_failed`, `rate_limited`) also mark the mailbox `degraded` until the next success.

A disconnected mailbox keeps its account id: `reactivate-account` (or connecting the same OAuth address again) puts it back to `active` with its cursor, so nothing is imported twice, and the mail arrives right away instead of at the next poll. Connecting an address that is already connected is refused with 409.

## Tests

- E2E through `createAllInOneEntrypoint` (HTTP → dispatcher → BullMQ worker lane, no framework-internal shortcuts): connect → ingest → triage item appears.
- Replay scenario: duplicate ingest stays idempotent on both the projection and the consumer side.
