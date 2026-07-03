---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Crypto-shredding phase A — kms-adapter foundation (#724): new `@cosmicdrift/kumiko-framework/crypto` module with the `KmsAdapter` contract (user/tenant `SubjectId`, `local-key` vs `remote-crypto` capability modes for the later Vault transit adapter, `KeyErased`/`KeyNotFound`/`KeyAlreadyExists` errors) plus `InMemoryKmsAdapter` and a reusable adapter contract test suite. Erased subjects keep a tombstone — `createKey` after `eraseKey` throws, so forget cannot be undone by re-keying. `runProdApp({ kms })` exposes the adapter as `ctx.kms` and health-gates boot (an app configured for crypto-shredding refuses to start against an unreachable key store). No behavior change for apps that don't pass the option.
