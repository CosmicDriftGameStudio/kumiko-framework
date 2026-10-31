import { createTenantDb, type DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  type EscapeHatchAuditSink,
  EXT_USER_DATA,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import {
  createEscapeHatchReporter,
  UNATTRIBUTED_ACTOR,
} from "@cosmicdrift/kumiko-framework/pipeline";

export function buildHookDb(
  db: DbRunner,
  tenantId: TenantId,
  entry: { readonly entityName: string; readonly escapeHatchReason: string | undefined },
  args: {
    readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
    readonly escapeHatchAuditLog?: Logger;
    readonly actor?: string;
  },
) {
  const report = createEscapeHatchReporter({
    handler: `${EXT_USER_DATA}:${entry.entityName}`,
    tenantId,
    actor: args.actor ?? UNATTRIBUTED_ACTOR,
    sink: args.escapeHatchAuditSink,
    log: args.escapeHatchAuditLog ?? createFallbackLogger("user-data-rights"),
  });
  return createTenantDb({
    db,
    tenantId,
    mode: "tenant",
    grants: {
      unsafeRaw:
        entry.escapeHatchReason !== undefined ? { reason: entry.escapeHatchReason } : undefined,
      report,
    },
  });
}
