import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { z } from "zod";
import { deleteWrite } from "./handlers/delete.write";
import { listQuery } from "./handlers/list.query";
import { rotateJob } from "./handlers/rotate.job";
import { setWrite } from "./handlers/set.write";
import { secretReadSchema } from "./secrets-context";
import { tenantSecretEntity, tenantSecretsTable } from "./table";

/**
 * Env-vars contract for the `secrets` feature. Apps merge this via
 * `composeEnvSchema({ features: [secretsFeature, ...] })` so boot-time
 * validation catches a missing/short KEK before the first `.get()` call.
 *
 * Rotation: declare additional versions (V2, V3, …) in the app's `extend`
 * block — the env-master-key-provider scans the env for any
 * `KUMIKO_SECRETS_MASTER_KEY_V<n>` matching `/^KUMIKO_SECRETS_MASTER_KEY_V(\d+)$/`
 * and picks the highest as the active KEK unless
 * `KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION` pins one explicitly.
 */
export const secretsEnvSchema = z.object({
  KUMIKO_SECRETS_MASTER_KEY_V1: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "must be base64-encoded 32 bytes (AES-256 KEK)",
    })
    .describe("AES-256 master-key (KEK) for tenant-secrets encryption.")
    .meta({ kumiko: { pulumi: { generator: "openssl rand -base64 32", secret: true } } }),
  KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: z
    .string()
    .regex(/^[1-9]\d*$/, "must be a positive integer (V<n> selector)")
    .default("1")
    .describe(
      "Pins the active KEK version. Default '1'. Bump after writing a higher KUMIKO_SECRETS_MASTER_KEY_V<n>.",
    ),
});

export {
  createSecretsContext,
  type SecretsContext,
  type SecretsContextOptions,
  TENANT_SECRET_READ_EVENT,
} from "./secrets-context";
export { type StoredEnvelope, type StoredMetadata, tenantSecretsTable } from "./table";

// AppContext carries ctx.secrets via extraContext. requireSecretsContext
// wraps that raw context so every `.get(...)` call auto-includes the
// current user + handler as audit metadata — feature code can't forget
// to log the read (silent bypass of audit was the v1 gap).
//
// Surface bewusst minimal: HandlerContext-Pfade (Set/Delete-Handler) +
// FileProviderContext-Pfade (S3-Plugin im Worker) liefern dieselben
// zwei Felder, also reicht die schmale ctx-shape — kein voller
// HandlerContext-Import noetig.
export function requireSecretsContext(
  ctx: { readonly secrets?: SecretsContext; readonly _userId?: string | undefined },
  handlerName: string,
): SecretsContext {
  if (!ctx.secrets) {
    throw new InternalError({
      message:
        `[${handlerName}] ctx.secrets missing — pass ` +
        "createSecretsContext({db, masterKeyProvider}) via extraContext.secrets at boot.",
    });
  }
  const raw = ctx.secrets;
  const userId = ctx._userId;
  if (!userId) {
    throw new InternalError({
      message: `[${handlerName}] ctx._userId missing — cannot audit secret reads without a caller identity.`,
    });
  }
  return {
    get: (tenantId, key, overrideAudit) =>
      raw.get(tenantId, key, overrideAudit ?? { userId, handlerName }),
    // No audit injection: has() is metadata-only and never logs a read.
    has: raw.has.bind(raw),
    set: raw.set.bind(raw),
    delete: raw.delete.bind(raw),
  };
}

export function createSecretsFeature(): FeatureDefinition {
  return defineFeature("secrets", (r) => {
    r.describe(
      "Stores arbitrary per-tenant secrets (API keys, tokens, credentials) encrypted at rest using AES-256 with a KEK loaded from `KUMIKO_SECRETS_MASTER_KEY_V1` (and successive versions for rotation). Read a secret in handlers via `ctx.secrets.get(tenantId, handle)`, which automatically appends a `tenantSecretRead` audit event so every access is traceable. A `rotate` job re-encrypts all envelopes after a KEK version bump.",
    );
    r.envSchema(secretsEnvSchema);

    // ES entity: set/delete go through the executor, `tenantSecret.created/
    // .updated/.deleted` events land on the aggregate stream. Reads fire a
    // separate `tenantSecretRead` event per call (see secrets-context.get
    // for the one-event-per-read rationale).
    // Backing table: envelope/metadata/last_rotated_at + the (tenant,key)
    // uniqueIndex are not expressible via the field-DSL (jsonb-without-default,
    // now()-default), so the physical table is the DDL truth. Without this the
    // generated migration omitted those columns → prod-500 (publicstatus#116).
    r.entity("tenant-secret", tenantSecretEntity, { table: tenantSecretsTable });

    // Read-audit domain-event. Registered here so ops tools + MSPs can
    // discover the type; secrets-context.get parses payloads against
    // `secretReadSchema` at write time because the low-level append() path
    // skips ctx.appendEvent's schema-validation guard.
    r.defineEvent("read", secretReadSchema);

    // Per-tenant handlers (set/delete/list) run in the default tenant-scope,
    // giving them the automatic ctx.db tenant-filter as extra defense.
    // The rotation job deliberately reaches for ctx.db as DbConnection
    // (raw, cross-tenant) because rotation is a deployment-wide operation —
    // no feature-wide r.systemScope() needed.
    r.writeHandler(setWrite);
    r.writeHandler(deleteWrite);
    r.queryHandler(listQuery);
    // Manual-only by design: ops triggers rotation after a KEK version flip.
    // BullMQ delivers to exactly one worker, so running it against a busy
    // table on multiple instances is still safe.
    r.job("rotate", { trigger: { manual: true } }, rotateJob);

    // Pre-ES had a separate `retention-cleanup` job scrubbing the audit
    // table on a compliance-driven schedule (90d default). Post-ES the
    // read-audit lives on the events-table as tenantSecretRead events;
    // retention for those flows through the framework-wide `pruneEvents`
    // ops-tool (see docs/plans/architecture/event-dispatcher.md §retention).
    // No per-feature retention-job anymore.
  });
}
