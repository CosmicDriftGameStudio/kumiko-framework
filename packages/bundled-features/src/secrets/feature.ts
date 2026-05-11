import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { deleteWrite } from "./handlers/delete.write";
import { listQuery } from "./handlers/list.query";
import { rotateJob } from "./handlers/rotate.job";
import { setWrite } from "./handlers/set.write";
import { secretReadSchema } from "./secrets-context";
import { tenantSecretEntity } from "./table";

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
    set: raw.set.bind(raw),
    delete: raw.delete.bind(raw),
  };
}

export function createSecretsFeature(): FeatureDefinition {
  return defineFeature("secrets", (r) => {
    // ES entity: set/delete go through the executor, `tenantSecret.created/
    // .updated/.deleted` events land on the aggregate stream. Reads fire a
    // separate `tenantSecretRead` event per call (see secrets-context.get
    // for the one-event-per-read rationale).
    r.entity("tenant-secret", tenantSecretEntity);

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
