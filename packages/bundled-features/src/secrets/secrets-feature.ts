import {
  defineFeature,
  type FeatureDefinition,
  type HandlerContext,
} from "@kumiko/framework/engine";
import { InternalError } from "@kumiko/framework/errors";
import type { SecretsContext } from "@kumiko/framework/secrets";
import { deleteWrite } from "./handlers/delete.write";
import { listQuery } from "./handlers/list.query";
import { retentionJob } from "./handlers/retention.job";
import { rotateJob } from "./handlers/rotate.job";
import { setWrite } from "./handlers/set.write";

export {
  createSecretsContext,
  type SecretsContext,
  type SecretsContextOptions,
} from "./secrets-context";
export {
  type StoredEnvelope,
  type StoredMetadata,
  tenantSecretsAuditTable,
  tenantSecretsTable,
} from "./table";

// AppContext carries ctx.secrets via extraContext. requireSecretsContext
// wraps that raw context so every `.get(...)` call auto-includes the
// current user + handler as audit metadata — feature code can't forget
// to log the read (silent bypass of audit was the v1 gap).
export function requireSecretsContext(ctx: HandlerContext, handlerName: string): SecretsContext {
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
    set: raw.set.bind(raw),
    delete: raw.delete.bind(raw),
  };
}

export function createSecretsFeature(): FeatureDefinition {
  return defineFeature("secrets", (r) => {
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
    // Manual-or-cron cleanup for tenant_secret_reads audit-log. Default
    // retention is 90d; ops sets a schedule that fits their compliance
    // regime. Safe to run on a live system — chunked DELETEs hold brief
    // locks, not table-wide.
    r.job("retention-cleanup", { trigger: { manual: true } }, retentionJob);
  });
}
