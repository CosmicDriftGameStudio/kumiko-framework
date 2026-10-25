// Integration test preload — adapt the template per repo.
//
// Replaces the test.env-Section + globalSetup parts in vitest.integration.config.ts
// that run per-process. Global setup/teardown (DB schema, ephemeral DB)
// belongs in separate scripts (test-db-setup.ts / test-db-teardown.ts) that are
// called before/after `bun test`.

import { ensureTemporalPolyfill } from "../packages/framework/src/time/polyfill";
await ensureTemporalPolyfill();

// Stable instanceId so the boot warning about unpinned per-instance cursors
// doesn't spam the test suite. Tests that test multi-instance behavior
// adjust their own instanceId and ignore this default.
process.env.KUMIKO_INSTANCE_ID ??= "test-instance";

// Bun doesn't set NODE_ENV automatically — some packages (pino,
// React Production-Mode-Detection) need it.
process.env.NODE_ENV ??= "test";

// Docker Compose services (started via `kumiko dev --services-only`
// or direct `docker compose up`). Tests fail louder when a service
// is unreachable — no env gating.
process.env.DATABASE_URL ??= "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev";
process.env.TEST_DATABASE_URL ??= "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";
process.env.REDIS_URL ??= "redis://localhost:16379";
process.env.MEILI_URL ??= "http://localhost:17700";
process.env.MEILI_MASTER_KEY ??= "kumiko-dev-key";
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";

// Minio (S3-compatible). Started by `kumiko dev` — same pattern
// as Postgres/Redis/Meili.
process.env.MINIO_ENDPOINT ??= "http://localhost:19000";
process.env.MINIO_ACCESS_KEY ??= "kumiko";
process.env.MINIO_SECRET_KEY ??= "kumiko-dev-secret";
process.env.MINIO_BUCKET ??= "kumiko-dev";
process.env.MINIO_REGION ??= "us-east-1";

// Legacy BeamMyCar DB (caryo_copy). Tests that need this source
// automatically skip when the var is not set.
process.env.LEGACY_DATABASE_URL ??= "";
