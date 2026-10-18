---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

runProdApp declares mail, KMS, file storage, billing, demo mode, seeds and signal handling as options

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp boot options for mail, kmsMode, fileStorage, billing, demoMode, seeds and signals
detail: New optional runProdApp fields replace hand-wired bin/main.ts code. mail ({ transport: "smtp-env" | "inmemory" | EmailTransport, from?, resolveEmail?, tenantTransport? }) mounts channel-email and routes the auth mails through it; needs delivery. kmsMode ("required" | "optional" | { plaintextReason }) builds KMS and blind-index key from PLATFORM_KEK, SUBJECT_KEYS_DATABASE_URL and KUMIKO_BLIND_INDEX_KEY and cannot be combined with kms, blindIndexKey or allowPlaintextPii. fileStorage ({ provider: "s3-env" | "inmemory" | "auto" }) mounts the file provider; auto picks S3 when S3_* is complete and aborts a production boot on a partial S3 env; needs file-foundation. billing ({ stripe: { priceToTier, webhookPath? }, defaultTier }) mounts subscription-stripe and the tier-sync webhook route; needs billing-foundation and tier-engine (composeSaasStack). demoMode ({ readOnly, notice? }) serves GET /demo-mode and answers writes with 403 demo_read_only while readOnly; demo account credentials are published only when listed in notice.accounts. seeds also takes { demoTenant, demoAdminFromEnv, sysadminFromEnv, run }; the array form still works, but code indexing RunProdAppOptions["seeds"][number] must switch to ProdSeedFn. SIGTERM/SIGINT now run stop() with a 25 s drain timeout (signals: { drainTimeoutMs }) and exit 1 on timeout or error instead of always 0; signals: false hands the signals to the host. Without the new fields the boot behaves as before. createSubscriptionTierSync().createWebhookRoute takes an optional { path }. Recipe: samples/recipes/prod-boot-options.
-->
