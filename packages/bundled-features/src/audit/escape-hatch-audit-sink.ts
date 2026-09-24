import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { EscapeHatchAuditSink, EscapeHatchKind } from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";

export const ESCAPE_HATCH_USED_EVENT = "audit:event:escape-hatch-used";
export const ESCAPE_HATCH_USE_AGGREGATE_TYPE = "escapeHatchUse";

// Kept as a tuple so `satisfies` catches a kind added/removed/renamed on
// EscapeHatchKind without this schema following along.
const escapeHatchKinds = [
  "unsafe-raw",
  "acknowledge-cross-tenant",
  "global-write",
  "identity-switch",
  "unsafe-all-tenants",
] as const satisfies readonly EscapeHatchKind[];

export const escapeHatchUsedSchema = z.object({
  handler: z.string(),
  kind: z.enum(escapeHatchKinds),
  reason: z.string(),
  actor: z.string(),
  targetUserId: z.string().optional(),
  targetTenantId: z.string().optional(),
});

export function createEscapeHatchAuditSink(opts: {
  readonly db: DbConnection;
}): EscapeHatchAuditSink {
  return async (event) => {
    const payload = escapeHatchUsedSchema.parse({
      handler: event.handler,
      kind: event.kind,
      reason: event.reason,
      actor: event.actor,
      ...(event.target && { targetUserId: event.target.id, targetTenantId: event.target.tenantId }),
    });
    // Appends on the unbound pool, never the handler tx — an audit entry must
    // survive a rollback of the handler that used the hatch.
    await append(opts.db, {
      aggregateId: generateId(),
      aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
      tenantId: event.tenantId,
      expectedVersion: 0,
      type: ESCAPE_HATCH_USED_EVENT,
      payload,
      metadata: { userId: event.actor },
    });
  };
}
