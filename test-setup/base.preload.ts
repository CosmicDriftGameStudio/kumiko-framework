// Base preload for ALL `bun test` runs (unit + integration). Carries only
// runtime polyfills and test-process identity — NO service-URL env. Service
// defaults (DATABASE_URL, REDIS_URL, MEILI_*, MINIO_*, JWT_SECRET) live in
// integration.preload.ts so unit tests never branch on the presence of those
// vars and never attempt a real connect to docker services that aren't up.

import "./app-define-resolver";
import { ensureTemporalPolyfill } from "../packages/framework/src/time/polyfill";
await ensureTemporalPolyfill();

process.env.KUMIKO_INSTANCE_ID ??= "test-instance";
process.env.NODE_ENV ??= "test";
