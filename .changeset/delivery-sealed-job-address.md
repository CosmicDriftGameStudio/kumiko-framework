---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Queued delivery jobs carry the recipient address sealed

`delivery.render` and `delivery.send` job payloads sit in Redis and the job-run table. With a master key configured, the recipient address now travels as `sealedAddress` (encrypted per tenant) and is opened only right before `channel.send`. Without a master key the payload keeps the plaintext `address` and boot logs one warning. Jobs queued before the upgrade keep their plaintext address and still send.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Queued delivery jobs carry the recipient address sealed
detail: createDeliveryService takes an addressCipher; the boot wiring passes the master-key cipher, so delivery.render and delivery.send payloads hold sealedAddress instead of address. Workers open it through ctx.configEncryption.
migration: Roll out worker and web together with the same KUMIKO_SECRETS_MASTER_KEY_V<n>; a worker without the master key fails sealed jobs with send_failed. Code that calls createDeliveryService itself passes addressCipher to get sealed payloads.
-->
