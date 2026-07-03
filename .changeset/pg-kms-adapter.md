---
"@cosmicdrift/kumiko-framework": minor
---

PgKmsAdapter: production subject-key storage for crypto-shredding. Subject DEKs live KEK-wrapped (AES-256-GCM envelope) in a dedicated Postgres cluster; erase leaves an audit tombstone (erased_at/erased_by/erase_reason) without key material. Wire via `runProdApp({ kms: createPgKmsAdapter({ databaseUrl, platformKek }) })`.
