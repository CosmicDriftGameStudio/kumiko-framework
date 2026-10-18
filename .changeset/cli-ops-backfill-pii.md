---
"@cosmicdrift/kumiko-cli": minor
---

New command kumiko ops backfill-pii

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko ops backfill-pii encrypts plaintext PII events of the app in kumiko.config.ts
detail: kumiko ops backfill-pii [--dry-run] [--resolve-owner-from-projection] [--rekey-tenant-keyed-owner-fields] [--erase-unresolvable-subjects] runs the framework PII backfill over the features of kumiko.config.ts with DATABASE_URL, PLATFORM_KEK (and PLATFORM_KEK_PREVIOUS) and KUMIKO_BLIND_INDEX_KEY from the environment. It does not rebuild projections; run kumiko ops backfill-pii --rebuild afterwards, which rebuilds only the projections of entities with personal fields. A second backfill run changes nothing. Apps with their own backfill-pii script switch to this command and to the two-step runbook.
-->
