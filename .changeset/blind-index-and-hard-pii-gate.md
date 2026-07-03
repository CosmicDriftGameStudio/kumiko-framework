---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Blind index for PII equality lookups + hard PII boot gate (#818, PRs #819/#821/#822/#823 + this one).

**BREAKING for apps that mount PII-annotated features (user, tenant, sessions, …) without a KMS:** `runProdApp` now ABORTS boot instead of warning. Either wire `kms: createPgKmsAdapter({ databaseUrl, platformKek })` (plus `blindIndexKey`, env `KUMIKO_BLIND_INDEX_KEY`) or acknowledge explicitly with `allowPlaintextPii: "<reason>"` until your KMS is provisioned. Apps with their own `r.unmanagedTable` stores carrying subject annotations must encrypt on write (`encryptForDirectWrite`) and declare `piiEncryptedOnWrite: true`, or boot fails.

New: `lookupable: true` on pii text fields maintains an HMAC blind-index column so equality lookups (login by email, dedup checks, invites, password reset) keep working on encrypted columns — query compilers rewrite `eq` filters to `(col = $1 OR col_bidx = $2)`, rollout-neutral for plaintext legacy rows. `user.email` and `tenant-invitation.email` are lookupable; `api-token.name` is `userOwned`; `config.userId`/`notification-preference.userId` are declared `allowPlaintext` (pseudonymous FKs). All bundled read paths that hand stored PII to mails, responses, comparisons or lookups decrypt via the new `decryptStoredPii` helper (13 fixed call sites — with a KMS active, all three invite-accept branches and password-reset mails were previously broken). GDPR exports decrypt every `kumiko-pii:` value centrally. Runtime tripwires: a PII ciphertext in a JSON API response is a loud 500 in dev/test and redacted+logged in prod; outgoing mail to a ciphertext recipient is always refused. Executor write-response echoes (`event.payload`) now carry plaintext (the persisted event log is unchanged). `runDevApp` accepts `kms` + `blindIndexKey` to exercise the full crypto path locally.
