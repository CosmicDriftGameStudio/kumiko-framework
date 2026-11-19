---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": patch
---

Queued delivery channels only queue sealed jobs; without an address cipher they send inline.

<!-- kumiko-changes
feature: delivery
type: breaking
title: No plaintext addresses in delivery jobs
detail: createDeliveryService dispatches a send job for a queued channel only when it has an addressCipher, and the job payload always carries sealedContent. Without a cipher (no master key) the channel renders and sends inline, so recipient addresses and message content never reach Redis or the job-run store in plaintext. sealJobContent requires the cipher. Jobs already queued with plain content are still sent.
migration: Set KUMIKO_SECRETS_MASTER_KEY_V1 on web and worker so mail and other queued channels keep going through the queue. Tests that build a delivery service with a job dispatcher pass addressCipher (createTestEnvelopeCipher) and configEncryption in the job context.
affects: sealJobContent, createDeliveryService, addressCipher
-->
