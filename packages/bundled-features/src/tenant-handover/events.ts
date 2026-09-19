import { z } from "zod";

// Audit trail for a completed claim (kumiko-framework#3035's "Audit-Eintrag
// nennt Quell-Tenant, Ziel-Tenant, Entities und Anzahl"). Its own aggregate,
// decoupled from the transferred root's stream — same reasoning as
// sessions' SESSION_REVOKED_EVENT: a fresh aggregate id per occurrence needs
// no predecessor version and can never conflict with a concurrent write on
// the entity it describes.
//
// _SHORT — r.defineEvent(short, schema) in feature.ts, framework prefixes it
//          to the QN below.
// _QN    — ctx.unsafeAppendEvent({ type })'s `type` field.
export const TENANT_HANDOVER_CLAIMED_EVENT_SHORT = "claimed" as const;
export const TENANT_HANDOVER_CLAIMED_EVENT_QN = "tenant-handover:event:claimed" as const;
export const TENANT_HANDOVER_CLAIM_AGGREGATE_TYPE = "tenant-handover-claim" as const;

export const tenantHandoverClaimedSchema = z.object({
  entityType: z.string().min(1),
  rootRowId: z.string().min(1),
  sourceTenantId: z.string().min(1),
  destinationTenantId: z.string().min(1),
  movedEntities: z.record(z.string(), z.number().int().nonnegative()),
});

export type TenantHandoverClaimedPayload = z.infer<typeof tenantHandoverClaimedSchema>;
