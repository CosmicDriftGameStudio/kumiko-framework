---
"@cosmicdrift/kumiko-framework": minor
---

Add `kumiko-schema validate` — a static, DB-free CI gate that catches "this won't boot" before deploy. Two layers: (1) **schema drift** — fails if entity definitions are ahead of `kumiko/migrations` (an entity was added/changed but never `generate`d, so its table is missing in prod → runtime 500); (2) **boot validity** — runs `validateBoot` over the composed feature set when `kumiko/schema.ts` exports `FEATURES` (QN / screen / nav / role refs). Exit 0 clean, exit 1 with a report. The DB-level gate (`assertKumikoSchemaCurrent`) still runs at boot/deploy; this is the pre-deploy static counterpart any consumer app can run in CI.
