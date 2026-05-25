// Integration-test preload — env defaults for Docker-Compose services.
// Replaces vitest.integration.config.ts `test.env` section.

import "./app-define-resolver";
import { ensureTemporalPolyfill } from "../packages/framework/src/time/polyfill";
await ensureTemporalPolyfill();

process.env.KUMIKO_INSTANCE_ID ??= "test-instance";
process.env.NODE_ENV ??= "test";

process.env.DATABASE_URL ??= "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev";
process.env.TEST_DATABASE_URL ??= "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";
process.env.REDIS_URL ??= "redis://localhost:16379";
process.env.MEILI_URL ??= "http://localhost:17700";
process.env.MEILI_MASTER_KEY ??= "kumiko-dev-key";
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";

process.env.MINIO_ENDPOINT ??= "http://localhost:19000";
process.env.MINIO_ACCESS_KEY ??= "kumiko";
process.env.MINIO_SECRET_KEY ??= "kumiko-dev-secret";
process.env.MINIO_BUCKET ??= "kumiko-dev";
process.env.MINIO_REGION ??= "us-east-1";

process.env.LEGACY_DATABASE_URL ??= "";
