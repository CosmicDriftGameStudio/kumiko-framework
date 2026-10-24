import { crossTenantReadsGrantFor, escapeHatchFor } from "@cosmicdrift/kumiko-types/handlers";
import { isAgentToolCallScope } from "../api/request-context.ts";
import type { DbConnection, DbTx } from "../db/connection.ts";
import { createHandlerCrossTenantReads } from "../db/cross-tenant-reads.ts";
import { createTenantDb, createUncheckedSystemDb, type TenantDb } from "../db/tenant-db.ts";
import { createDerivativesContext } from "../derivatives/derivatives-context.ts";
import { mayOverrideTenant } from "../engine/cross-tenant.ts";
import type { TenantId } from "../engine/types/identifiers.ts";
import type { TenantWriteTarget } from "../engine/types/index.ts";
import { AccessDeniedError, FrameworkReasons } from "../errors/index.ts";
import { createTenantFileContext } from "../files/file-handle.ts";
import { attachOutsideTransaction } from "./attach-outside-transaction.ts";
import {
  createSystemScopedDbGuard,
  isMemberResolutionPrincipal,
  resolveAppPoolDb,
} from "./dispatch-shared.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";
import { buildPersonalDataGate } from "./write-origin.ts";

export function buildTenantScopedDb(
  scope: HandlerContextScope,
  source: DbConnection | DbTx,
  signal: AbortSignal | undefined,
  foreignTenantId?: TenantId,
  denyWrites = false,
): TenantDb {
  const { user, context, registry, origin, isSystem, writeEscapeHatch, handlerEscapeHatch } = scope;
  const options = {
    db: source,
    tenantId: foreignTenantId ?? user.tenantId,
    tracer: context.tracer,
    meter: context.meter,
    signal,
    grants: {
      ...(foreignTenantId === undefined && {
        globalWrites: escapeHatchFor(writeEscapeHatch, "globalWrites"),
        unsafeRaw: escapeHatchFor(handlerEscapeHatch, "unsafeRaw"),
      }),
      report: scope.reportEscapeHatch,
      memberReadOnly: isMemberResolutionPrincipal(user),
      personalDataGate: buildPersonalDataGate(registry, origin),
      projectionRegistry: registry,
      ...(denyWrites && { writesDeniedReason: "without an open transaction" }),
    },
  };
  return isSystem && foreignTenantId === undefined
    ? createTenantDb({
        ...options,
        mode: "system",
        reason: "system-scope handler dispatch reads and writes across tenants by design",
      })
    : createTenantDb(options);
}

function buildHandlerCrossTenantReads(scope: HandlerContextScope) {
  const { user, context, registry, origin, dbSource, reqCtx, handlerEscapeHatch } = scope;
  // An agent tool call runs with the user's session but feeds the LLM context, so
  // cross-tenant rows must never reach it, even when unsafeRaw implies the grant.
  const crossTenantReadsReason = isAgentToolCallScope()
    ? undefined
    : crossTenantReadsGrantFor(handlerEscapeHatch)?.reason;
  return dbSource && crossTenantReadsReason !== undefined
    ? createHandlerCrossTenantReads({
        db: dbSource,
        tenantId: user.tenantId,
        tracer: context.tracer,
        meter: context.meter,
        signal: reqCtx?.signal,
        reason: crossTenantReadsReason,
        report: scope.reportEscapeHatch,
        grants: {
          report: scope.reportEscapeHatch,
          memberReadOnly: isMemberResolutionPrincipal(user),
          personalDataGate: buildPersonalDataGate(registry, origin),
          projectionRegistry: registry,
        },
      })
    : undefined;
}

export function buildHandlerDbFacet(scope: HandlerContextScope) {
  const { ctx, type, isSystem, dbSource, reqCtx, denyDbWrites } = scope;
  // Propagate the request's AbortSignal so every TenantDb query throws when
  // the client has disconnected — handlers with many sequential queries skip
  // the rest of the chain instead of burning DB-CPU for results no one reads.
  const db = dbSource
    ? buildTenantScopedDb(scope, dbSource, reqCtx?.signal, undefined, denyDbWrites)
    : undefined;
  // Unbound pool, tenant-scoped like `db` but never tx-bound — writes
  // through it survive a rollback of the handler's own transaction. No
  // AbortSignal here: a client disconnect must not abort a durability write
  // that is meant to outlive the request. Computed before `systemDb` below
  // so its guarded escape hatch (ctx.systemDb.outsideTransaction) can wrap
  // this same TenantDb instead of a second, independently-built one.
  const outsideTxSource = ctx.outsideTransactionDb ?? resolveAppPoolDb(ctx);
  const rawDbOutsideTransaction = outsideTxSource
    ? buildTenantScopedDb(scope, outsideTxSource, undefined)
    : undefined;
  const systemDb =
    isSystem && db
      ? createUncheckedSystemDb(db, rawDbOutsideTransaction, scope.reportEscapeHatch)
      : undefined;
  const crossTenantReads = buildHandlerCrossTenantReads(scope);
  // Same fail-closed treatment as `exposedDb` — a system handler reaching
  // ctx.db.outsideTransaction directly would be a second, unguarded door to
  // the same cross-tenant access ctx.db closes off.
  const dbOutsideTransaction =
    isSystem && rawDbOutsideTransaction
      ? createSystemScopedDbGuard(
          type,
          "db.outsideTransaction",
          "ctx.systemDb.outsideTransaction.assertTenantMatch(...) or " +
            "ctx.systemDb.outsideTransaction.acknowledgeCrossTenant(...)",
        )
      : rawDbOutsideTransaction;
  // Exposed as ctx.db below — the internal `db` above stays the real,
  // working TenantDb for config/derivatives accessors and systemDb
  // construction.
  const unattachedExposedDb =
    isSystem && db
      ? createSystemScopedDbGuard(
          type,
          "db",
          "ctx.systemDb.assertTenantMatch(...) or ctx.systemDb.acknowledgeCrossTenant(...)",
        )
      : db;
  const exposedDb = unattachedExposedDb
    ? attachOutsideTransaction(unattachedExposedDb, dbOutsideTransaction)
    : undefined;
  return {
    db,
    exposedDb,
    outsideTxSource,
    fragment: {
      db: exposedDb,
      ...(systemDb && { systemDb }),
      ...(crossTenantReads && { crossTenantReads }),
    },
  };
}

// Write handlers only, and not r.systemScope() ones (they have ctx.systemDb). The gate is the
// dispatcher's tenantIdOverride predicate, so no caller reaches more than it could via
// tenantIdOverride. The foreign db carries no unsafeRaw/globalWrites grant and is tenant mode
// bound to the target; the executor accepts streamTenantId only on a db bound to that tenant.
export function buildForTenantFragment(
  scope: HandlerContextScope,
  exposedDb: TenantDb | undefined,
  readOnlyForTenant: boolean,
) {
  const { user, isSystem, dbSource, isWriteHandler, reqCtx, denyDbWrites, isPerCommand } = scope;
  const forTenant =
    !isSystem && dbSource && isWriteHandler
      ? (targetTenantId: TenantId): TenantWriteTarget => {
          if (targetTenantId === user.tenantId && exposedDb) {
            // Only perCommand handlers lose forTenant writes; reservations keep their pre-transaction contract.
            const ownTenantDb =
              denyDbWrites && !isPerCommand
                ? buildTenantScopedDb(scope, dbSource, reqCtx?.signal, undefined, readOnlyForTenant)
                : exposedDb;
            return { db: ownTenantDb, streamTenantId: undefined };
          }
          if (!mayOverrideTenant(user)) {
            throw new AccessDeniedError({
              details: { reason: FrameworkReasons.tenantOverrideRequiresSystemAdmin },
            });
          }
          return {
            db: buildTenantScopedDb(
              scope,
              dbSource,
              reqCtx?.signal,
              targetTenantId,
              denyDbWrites && (isPerCommand || readOnlyForTenant),
            ),
            streamTenantId: targetTenantId,
          };
        }
      : undefined;
  return { ...(forTenant && { forTenant }) };
}

// ctx.files resolved per-tenant through file-foundation (lazy — the
// provider is only resolved when a handle actually does I/O). Boot wires
// _fileProviderResolver when a file-provider plugin is mounted; falls back
// to a statically-injected context.files (tests).
export function buildFileFragment(scope: HandlerContextScope, db: TenantDb | undefined) {
  const { context, registry, user } = scope;
  const fileResolver = context._fileProviderResolver;
  const files = fileResolver ? createTenantFileContext(fileResolver, user.tenantId) : context.files;
  // ctx.derivatives builds on ctx.files (needs a FileContext to read the
  // original + write the variant) plus db (to look up the FileRef row) — so
  // it can only be constructed exactly when files+db both resolved; falls
  // back to a statically-injected context.derivatives otherwise (tests).
  const derivatives =
    files && db
      ? createDerivativesContext({ files, registry, db, tenantId: user.tenantId })
      : context.derivatives;
  return { ...(files && { files }), ...(derivatives && { derivatives }) };
}
