---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-feature-ast": patch
---

Scaffolded apps mount the security baseline, and `kumiko-upgrade` adds it to existing apps.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Scaffolded apps mount crypto-shredding, rate-limiting and audit next to sessions
detail: `scaffoldApp` adds `...composeSecurityStack({ includeSessions: false })` after `createSessionsFeature()` in `src/run-config.ts`, so a production boot no longer warns that the security baseline is incomplete. The initial migration contains the audit table `store_access_log`. crypto-shredding brings the `PLATFORM_KEK`, `SUBJECT_KEYS_DATABASE_URL` and `KUMIKO_BLIND_INDEX_KEY` env block, in which an empty value is invalid, so the scaffolded `.env.example` now lists the three variables commented out.
migration: Run the codemod. It adds `...composeSecurityStack({ includeSessions: false })` and its import after `createSessionsFeature()` in the `APP_FEATURES` array literal of `src/run-config.ts`. It skips apps that already mount composeSecurityStack, createCryptoShreddingFeature, createRateLimitingFeature or createAuditFeature, and lists apps as manual whose `bin/main.ts` passes no kmsMode, kms, allowPlaintextPii or kmsWiring to runProdApp (crypto-shredding would abort their boot) or sets `rateLimit: false` (rate-limiting would abort it). Afterwards run `kumiko-schema generate` for the audit table, and remove empty `PLATFORM_KEK=`, `SUBJECT_KEYS_DATABASE_URL=` and `KUMIKO_BLIND_INDEX_KEY=` lines from env files.
codemod: scripts/codemod/security-baseline-stack.ts
-->
