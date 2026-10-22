---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko ops waitlist-migrate` now configures the PII key service from the environment like the app boot (`PLATFORM_KEK`, `SUBJECT_KEYS_DATABASE_URL`, `KUMIKO_BLIND_INDEX_KEY`). Before, it ran without one and wrote name, email and message of every imported entry as plaintext into the event log, out of reach of crypto-shredding. Without the key service it now aborts, unless `--allow-plaintext-pii <reason>` is passed for an app without subject encryption. Legacy offlot rows that hold ciphertext are decrypted with the same key service.

<!-- kumiko-changes
feature: cli
type: fix
title: waitlist-migrate encrypts imported personal data or aborts
detail: waitlist-migrate wires the PII KMS and blind-index key from the environment before importing. Without them it aborts with a clear message; --allow-plaintext-pii <reason> opts out for apps without subject encryption.
-->
