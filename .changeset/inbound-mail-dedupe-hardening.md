---
"@cosmicdrift/kumiko-bundled-features": minor
---

Inbound mail is safe with several workers: the dedup anchor of a mail is a unique database row, and the watch supervisor always coordinates through a distributed lock.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: The inbound mail supervisor requires a lock and the dedup anchor is unique
detail: `createInboundMailSupervisor` takes a required `lock` (a DistributedLock) instead of an optional one, so only one worker holds the IMAP watch per account; the single-process path without a lock is gone. The unmanaged table store_mail_seen_messages gets a unique index on (account_id, provider_message_id), which the ingest comment always promised; ingest-message already serialized concurrent ingests of one mail with a per-message advisory lock, so the second one reports duplicate.
migration: Pass `lock: createDistributedLock(redis, "kumiko:lock:inbound-mail:watch:")` to createInboundMailSupervisor. Run `kumiko-schema generate <name>` in each app that mounts inbound-mail-foundation to get the migration for the unique index on store_mail_seen_messages; existing rows must hold no duplicate (account_id, provider_message_id).
-->
