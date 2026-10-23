import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  type AccessRule,
  defineFeature,
  type FeatureDefinition,
  SYSTEM_ROLE,
} from "@cosmicdrift/kumiko-framework/engine";
import { type FeatureWithEnvSchema, featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { SETTINGS_HUB_I18N } from "@cosmicdrift/kumiko-framework/i18n";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import * as z from "zod";
import { createDeleteHandler } from "./handlers/delete.write.ts";
import { createListHandler } from "./handlers/list.query.ts";
import { rotateJob } from "./handlers/rotate.job.ts";
import { createSetHandler } from "./handlers/set.write.ts";
import { SECRETS_I18N } from "./i18n.ts";
import { secretReadSchema } from "./secrets-context.ts";
import { tenantSecretEntity, tenantSecretsTable } from "./table.ts";
import { DEFAULT_SECRETS_ACCESS } from "./web/constants.ts";

const ROTATE_ESCAPE_HATCH_REASON = "re-encrypts every tenant's secrets with the new master key";

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
export const SECRETS_FEATURE_NAME = "secrets";

/** Env keys that carry the KEK keyring. Optional when the app supplies its own
 *  `masterKey` provider. */
export const SECRETS_MASTER_KEK_ENV_KEYS = ["KUMIKO_SECRETS_MASTER_KEY_V1"] as const;

export const secretsEnvSchema = z.object({
  KUMIKO_SECRETS_MASTER_KEY_V1: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "must be base64-encoded 32 bytes (AES-256 KEK)",
    })
    .describe("AES-256 master-key (KEK) for tenant-secrets encryption.")
    .meta({
      kumiko: { kms: true, pulumi: { generator: "openssl rand -base64 32", secret: true } },
    }),
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
} from "./secrets-context.ts";
export { type StoredEnvelope, type StoredMetadata, tenantSecretsTable } from "./table.ts";

// The settings form saves config values and secrets in one /api/batch; the secret
// write has to join that transaction so a rejected command rolls it back too.
export const JOIN_REQUEST_TRANSACTION_REASON =
  "the secret write runs on the request transaction so a failing batch rolls it back together with the config writes";

// AppContext carries ctx.secrets via extraContext. requireSecretsContext
// wraps that raw context so every `.get(...)` call automatically includes
// the current user and handler as audit metadata, preventing feature code
// from silently bypassing read auditing.
//
// The context shape stays minimal: HandlerContext paths (Set/Delete handlers)
// and FileProviderContext paths (the S3 plugin in the worker) provide the same
// two fields, so importing the full HandlerContext is unnecessary.
// Handler contexts carry the caller as ctx.user; provider contexts set
// auditUserId, which takes precedence.
export function requireSecretsContext(
  ctx: {
    readonly secrets?: SecretsContext;
    readonly auditUserId?: string | undefined;
    readonly user?: { readonly id: string };
  },
  handlerName: string,
): SecretsContext {
  if (!ctx.secrets) {
    throw new InternalError({
      message:
        `[${handlerName}] ctx.secrets missing — pass ` +
        "createSecretsContext({db, masterKeyProvider, registry}) via extraContext.secrets at boot.",
    });
  }
  const userId = ctx.auditUserId ?? ctx.user?.id;
  if (!userId) {
    throw new InternalError({
      message: `[${handlerName}] ctx.auditUserId missing (and no ctx.user) — cannot audit secret reads without a caller identity.`,
    });
  }
  const withAudit = (raw: SecretsContext): SecretsContext => ({
    withRunner: (runner) => withAudit(raw.withRunner(runner)),
    get: (tenantId, key, overrideAudit) =>
      raw.get(tenantId, key, overrideAudit ?? { userId, handlerName }),
    // No audit injection: has() is metadata-only and never logs a read.
    has: raw.has.bind(raw),
    set: raw.set.bind(raw),
    delete: raw.delete.bind(raw),
  });
  return withAudit(ctx.secrets);
}

export type SecretsFeatureOptions = {
  /** Access rule for the `set`, `delete` and `list` handlers. Default
   *  { roles: ["TenantAdmin"] }. Adopt the host's role vocabulary with
   *  { roles: [...] }, or { openToAll: { reason: "..." } } to let any authenticated tenant
   *  user manage secrets — note this is a much larger blast radius than the
   *  default: tenant credentials (API keys, tokens) become writable/deletable,
   *  and their previews/hints listable, by every tenant member, not just
   *  admins. Mutually exclusive with `roles`. The `rotate` job is unaffected —
   *  it's a manual, cross-tenant ops path, not per-tenant RBAC. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Mutually exclusive with `access`. */
  readonly roles?: readonly string[];
};

function resolveSecretsAccess(opts: SecretsFeatureOptions): AccessRule {
  if (opts.access !== undefined && opts.roles !== undefined) {
    throw new InternalError({
      message:
        "createSecretsFeature: pass either `access` or `roles`, not both — " +
        "`access` previously silently discarded `roles`, which looks like a refinement.",
    });
  }
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return DEFAULT_SECRETS_ACCESS;
}

// Server-side system writes (dispatchSystemWrite, e.g. a wire hook migrating credentials) take the
// same declared-key gate, value check and cache-sync announce as an admin instead of bypassing them
// via SecretsContext.set. The system role is in-process only and never minted into a session.
function withSystemWriter(rule: AccessRule): AccessRule {
  if (!("roles" in rule) || rule.roles.includes(SYSTEM_ROLE)) return rule;
  return { ...rule, roles: [SYSTEM_ROLE, ...rule.roles] };
}

export function createSecretsFeature(
  opts: SecretsFeatureOptions = {},
): FeatureWithEnvSchema<FeatureDefinition, typeof secretsEnvSchema.shape> {
  const access = resolveSecretsAccess(opts);
  const writeAccess = withSystemWriter(access);
  const feature: FeatureDefinition = defineFeature(SECRETS_FEATURE_NAME, (r) => {
    r.describe(
      'Stores arbitrary per-tenant secrets (API keys, tokens, credentials) encrypted at rest using AES-256 with a KEK loaded from `KUMIKO_SECRETS_MASTER_KEY_V1` (and successive versions for rotation). Read a secret in handlers via `ctx.secrets.get(tenantId, handle)`, which automatically appends a `tenantSecretRead` audit event so every access is traceable. A `rotate` job re-encrypts all envelopes after a KEK version bump. The `set`/`delete`/`list` handlers share one access rule — default { roles: ["TenantAdmin"] }; adopt the host\'s role vocabulary with createSecretsFeature({ roles }) or open it to every authenticated tenant user with { access: { openToAll: { reason } } } (larger blast radius: any tenant member can then read secret previews and write/delete secrets, not just admins). Server-side code writes a tenant secret with `dispatchSystemWrite({ handlerQn: SecretsHandlers.set, payload, tenantId })`: set and delete also admit the in-process system identity, so such writes pass the same declared-key and value checks.',
    );
    r.uiHints({
      displayLabel: "Tenant Secrets",
      category: "infrastructure",
      recommended: true,
    });
    r.envSchema(secretsEnvSchema);

    // `secrets` is a foundation feature auto-mounted even when `config` is
    // not (see FOUNDATION_FEATURES, dev-server scaffold-app.ts), so it must
    // ship the Settings-Hub chrome keys itself — server-authored
    // r.translations are projected into FeatureSchema.translations and used
    // as a client fallback bundle (create-app.tsx schemaTranslations),
    // covering both boot-time validation and rendering without a web
    // client-plugin for this feature.
    r.translations({ keys: SETTINGS_HUB_I18N });
    r.translations({ keys: SECRETS_I18N });

    // ES entity: set/delete go through the executor, `tenantSecret.created/
    // .updated/.deleted` events land on the aggregate stream. Reads fire a
    // separate `tenantSecretRead` event per call (see secrets-context.get
    // for the one-event-per-read rationale).
    // Backing table: envelope/metadata/last_rotated_at + the (tenant,key)
    // uniqueIndex are not expressible via the field-DSL (jsonb-without-default,
    // now()-default), so the physical table is the DDL truth. Without this the
    // generated migration omitted those columns → prod-500.
    r.entity({ name: "tenant-secret", ...tenantSecretEntity, backingTable: tenantSecretsTable });

    // Read-audit domain-event. Registered here so ops tools + MSPs can
    // discover the type; secrets-context.get parses payloads against
    // `secretReadSchema` at write time because the low-level append() path
    // skips ctx.events.append's schema-validation guard.
    r.defineEvent("read", secretReadSchema, { piiFields: "none" });

    // Per-tenant handlers (set/delete/list) run in the default tenant-scope,
    // giving them the automatic ctx.db tenant-filter as extra defense.
    // The rotation job deliberately reaches for ctx.db.unsafeRaw() (raw,
    // cross-tenant) because rotation is a deployment-wide operation — no
    // feature-wide r.systemScope() needed.
    r.writeHandler(createSetHandler(writeAccess));
    r.writeHandler(createDeleteHandler(writeAccess));
    r.queryHandler(createListHandler(access));
    // Manual-only by design: ops triggers rotation after a KEK version flip.
    // BullMQ delivers to exactly one worker, so running it against a busy
    // table on multiple instances is still safe.
    r.job({
      name: "rotate",
      trigger: { manual: true },
      escapeHatch: {
        reason: ROTATE_ESCAPE_HATCH_REASON,
      },
      handler: (payload, ctx) =>
        rotateJob(
          payload,
          ctx,
          ctx.db.unsafeRaw() as DbConnection, // @cast-boundary db-operator — jobs never run inside a DbTx
        ),
    });

    // Pre-ES had a separate `retention-cleanup` job scrubbing the audit
    // table on a compliance-driven schedule (90d default). Post-ES the
    // read-audit lives on the events-table as tenantSecretRead events;
    // retention for those flows through the framework-wide `pruneEvents`
    // ops-tool (see docs/plans/architecture/event-dispatcher.md §retention).
    // No per-feature retention-job anymore.
  });
  return featureWithEnvSchema(feature, secretsEnvSchema);
}
