import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createSystemDbView } from "@cosmicdrift/kumiko-framework/db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import type {
  EscapeHatchAuditSink,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  attachOutsideTransaction,
  bridgeStub,
  createSystemUser,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import { createEscapeHatchReporter } from "@cosmicdrift/kumiko-framework/pipeline";

export type TenantRecipientDeps = {
  readonly registry: Registry;
  readonly tenantUserIdsQuery: string | undefined;
  readonly escapeHatchAuditSink: EscapeHatchAuditSink | undefined;
  readonly log: Pick<Logger, "warn" | "error">;
};

export async function resolveUserIdsForTenant(
  deps: TenantRecipientDeps,
  db: DbConnection,
  tenantId: TenantId,
): Promise<readonly string[]> {
  const { registry, tenantUserIdsQuery, escapeHatchAuditSink, log } = deps;
  if (!tenantUserIdsQuery) {
    throw new Error(
      "Tenant broadcast (to: { tenant }) requires the tenant feature (default wiring) or an explicit tenantUserIdsQuery in DeliveryServiceOptions",
    );
  }
  const handler = registry.getQueryHandler(tenantUserIdsQuery);
  if (!handler) {
    throw new Error(`Tenant broadcast query "${tenantUserIdsQuery}" not found in registry`);
  }
  const systemUser = createSystemUser(tenantId);
  const report = createEscapeHatchReporter({
    handler: tenantUserIdsQuery,
    tenantId,
    actor: systemUser.id,
    sink: escapeHatchAuditSink,
    log,
  });
  // ctx.db/db.outsideTransaction are tenant-filtered even for a systemScope handler:
  // the dispatcher closes them off entirely there, so "system" mode would hand this
  // path a cross-tenant read the dispatcher never allows. Cross-tenant reach only
  // exists through the grant-carrying systemDb view below.
  const isSystem = registry.isHandlerSystemScoped(tenantUserIdsQuery);
  const tenantDb = createTenantDb({
    db,
    tenantId,
    mode: "tenant",
    grants: {
      report,
    },
  });
  // The dispatcher grants a systemScope handler's ctx.systemDb.unsafeRaw() ungated —
  // the grant comes from the handler's own r.systemScope() registration, not from this
  // caller. Only the systemDb view's own source TenantDb carries the grant, so it
  // can't leak onto ctx.db.
  const systemDbSourceTenantDb = isSystem
    ? createTenantDb({
        db,
        tenantId,
        mode: "system",
        reason: "delivery fan-out of a systemScope handler resolves recipients across tenants",
        grants: {
          report,
          unsafeRaw: { reason: `r.systemScope() handler "${tenantUserIdsQuery}"`, grants: ["unsafeRaw"] },
        },
      })
    : undefined;
  // Hand-built context, not routed through the dispatcher — this needs both
  // db (with its outsideTransaction) wired directly.
  // @cast-boundary engine-payload — generic query-handler return for typed convention
  return (await handler.handler(
    { type: tenantUserIdsQuery, payload: { tenantId }, user: systemUser },
    {
      db: attachOutsideTransaction(tenantDb, tenantDb),
      systemDb: systemDbSourceTenantDb
        ? createSystemDbView(systemDbSourceTenantDb, undefined, report)
        : undefined,
      registry,
      ...bridgeStub(),
    },
  )) as readonly string[];
}
