// Integration-Test preload — Template pro Repo anpassen.
//
// Ersetzt vitest.integration.config.ts test.env-Section + globalSetup-Teile
// die per-process laufen. Globale Setup/Teardown (DB-Schema, ephemerale DB)
// gehört in separate Scripts (test-db-setup.ts / test-db-teardown.ts) die
// vor/nach `bun test` aufgerufen werden.

import { ensureTemporalPolyfill } from "../packages/framework/src/time/polyfill";
await ensureTemporalPolyfill();

// Stable instanceId so der boot-warn über unpinned per-instance cursors
// die Test-Suite nicht spamt. Tests die multi-instance-Verhalten testen
// passen eigene instanceId an und ignorieren diesen default.
process.env.KUMIKO_INSTANCE_ID ??= "test-instance";

// Bun setzt NODE_ENV nicht automatisch — manche Pakete (pino,
// React Production-Mode-Detection) brauchen das.
process.env.NODE_ENV ??= "test";

// Docker-Compose-Services (gestartet via `kumiko dev --services-only`
// oder direktem `docker compose up`). Tests fail-louder wenn Service
// nicht erreichbar — kein env-Gating.
process.env.DATABASE_URL ??= "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev";
process.env.TEST_DATABASE_URL ??= "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";
process.env.REDIS_URL ??= "redis://localhost:16379";
process.env.MEILI_URL ??= "http://localhost:17700";
process.env.MEILI_MASTER_KEY ??= "kumiko-dev-key";
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";

// Minio (S3-kompatibel). Mitstartet durch `kumiko dev` — gleiches Muster
// wie Postgres/Redis/Meili.
process.env.MINIO_ENDPOINT ??= "http://localhost:19000";
process.env.MINIO_ACCESS_KEY ??= "kumiko";
process.env.MINIO_SECRET_KEY ??= "kumiko-dev-secret";
process.env.MINIO_BUCKET ??= "kumiko-dev";
process.env.MINIO_REGION ??= "us-east-1";

// Legacy BeamMyCar DB (caryo_copy). Tests die diese Quelle brauchen
// skippen automatisch wenn die Var nicht gesetzt ist.
process.env.LEGACY_DATABASE_URL ??= "";
