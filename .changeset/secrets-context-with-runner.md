---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
---

SecretsContext.withRunner binds secret reads and writes to a transaction

<!-- kumiko-changes
feature: secrets
type: improvement
title: SecretsContext.withRunner(tx) runs secret access on a given transaction
detail: The OAuth refresh now reads and writes the refresh token on its advisory-lock transaction, so a refresh holds one pool connection instead of two and parallel refreshes cannot starve the pool. Custom SecretsContext implementations need a `withRunner` method.
-->
