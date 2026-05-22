// Framework-core env-schema — the vars that runProdApp + buildServer
// + the connection-pool read directly from process.env today. Apps merge
// this into their app-wide schema via `composeEnvSchema({ core, ... })`.
//
// Sprint 9.2 is purely additive: the schema is exposed, but the call-sites
// in run-prod-app.ts (requireEnv("DATABASE_URL"), …) and api/server.ts
// (process.env["KUMIKO_INSTANCE_ID"]) keep reading process.env directly.
// Apps that opt into the schema get aggregated boot-validation errors
// BEFORE those legacy reads run; apps that don't, behave as before.
//
// Feature-specific vars (JWT_SECRET, KUMIKO_SECRETS_MASTER_KEY_*) live
// in their owning feature's envSchema — Phase 2 (bundled-features).

import { z } from "zod";

/** Env-vars read by framework-core (api/server, db/connection,
 *  dev-server/run-prod-app). NOT including feature-specific vars.
 *
 *  PORT-default "3000" is the same fallback as
 *  `packages/dev-server/src/run-prod-app.ts:533` — keep in sync when the
 *  call-site is refactored to consume parsed env (Sprint 9.5 Phase 4). */
export const frameworkCoreEnvSchema = z.object({
  PORT: z
    .string()
    .regex(/^\d+$/, "PORT must be a positive integer string")
    .default("3000")
    .describe("HTTP listen port. runProdApp defaults to 3000 when unset."),

  DATABASE_URL: z
    .url("DATABASE_URL must be a valid postgres:// URL")
    .describe("Primary Postgres connection string (write + read).")
    .meta({ kumiko: { pulumi: { secret: true } } }),

  REDIS_URL: z
    .url("REDIS_URL must be a valid redis:// URL")
    .describe("Redis connection string for SSE-broker + job-queues.")
    .meta({ kumiko: { pulumi: { secret: true } } }),

  KUMIKO_INSTANCE_ID: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Stable per-process identifier (pod name, hostname). " +
        "Multi-instance deploys SHOULD set this so per-instance consumers " +
        "(SSE) don't accumulate orphaned cursor-rows on restart.",
    ),

  // `z.string().optional()` (not `z.literal("1")`) — the run-prod-app
  // call-site (`process.env["KUMIKO_SKIP_ES_OPS"] !== "1"`) ignores any
  // value other than literal "1". A stricter schema would reject e.g.
  // "true" / "yes" that the runtime silently ignores, surfacing
  // boot-errors for inputs the framework doesn't actually care about.
  KUMIKO_SKIP_ES_OPS: z
    .string()
    .optional()
    .describe(
      "Set to '1' to skip event-store ops (seed/migrate) at boot. " +
        "Any other value is treated as 'not set' by run-prod-app. " +
        "Used by integration-test stacks that manage ES-ops out-of-band.",
    ),
});

export type FrameworkCoreEnv = z.infer<typeof frameworkCoreEnvSchema>;
