---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

runDevApp encrypts PII by default on an ephemeral dev DB, with an in-memory KMS and a throwaway blind-index key. A persistent dev DB (KUMIKO_DEV_DB_NAME) stays plaintext with the boot warning, and `kms: false` opts out.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: runDevApp encrypts PII on ephemeral dev DBs by default
detail: Without a kms option, runDevApp now configures an InMemoryKmsAdapter and a random blind-index key when KUMIKO_DEV_DB_NAME is unset. With a persistent dev DB nothing changes (plaintext plus warning, pass createPgKmsAdapter to encrypt). RunDevAppOptions.kms also accepts false for explicit plaintext. An app-provided kms keeps its previous behavior, including the boot abort for lookupable fields without a blindIndexKey.
migration: e2e or dev scripts that read PII columns raw must decrypt them or pass kms false to runDevApp. Apps that pass their own kms are unaffected.
-->
