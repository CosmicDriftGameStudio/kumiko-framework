import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { redeemRowBoundGrant, SIGNUP_HANDOVER_BENIGN_CLAIM_REJECTION_CODE } from "../../shared";
import { TENANT_HANDOVER_CLAIM_AGGREGATE_TYPE, TENANT_HANDOVER_CLAIMED_EVENT_QN } from "../events";
import { tenantHandoverPurpose } from "../grant";
import { moveRootRow, moveTransferGraph } from "../move-entity-graph";
import { resolveRootAnchorLocation } from "../root-anchor";

export type ClaimTenantHandoverOptions = {
  readonly grantSecret?: string;
};

// Every rejection before the grant is even peeked is a bare 422 — same
// no-oracle stance as row-bound-grant.ts. `entityType` itself is not secret
// (the app's own domain vocabulary), so failing fast on an unknown or
// undeclared root type is a plain config error, not a leak.
function notTransferable(entityType: string): ReturnType<typeof writeFailure> {
  return writeFailure(
    new UnprocessableError("entity_not_transferable", {
      i18nKey: "errors.tenantHandover.entityNotTransferable",
      details: { entityType },
    }),
  );
}

// The try-before-signup ownership handover (kumiko-framework#3035): claims an
// anonymous run into the caller's own tenant, legitimized by a row-bound
// grant the anonymous flow minted (see ../grant.ts). Idempotent — a second
// call with the same token fails the same way a forged one would, because
// the grant's anchor (the run's tenantId) has already moved.
export function createClaimTenantHandoverHandler(opts: ClaimTenantHandoverOptions = {}) {
  return defineWriteHandler({
    name: "claim",
    schema: z.object({ token: z.string().min(1), entityType: z.string().min(1) }),
    access: { roles: ["Member", "User", "TenantAdmin", "SystemAdmin"] },
    escapeHatch: {
      reason:
        "the ownership change moves rows OUT of a source tenant this caller has no membership " +
        "in — the framework's declared cross-tenant operation for try-before-signup, not a " +
        "per-consumer acknowledgeCrossTenant workaround",
    },
    agent: { expose: false },
    rateLimit: { per: "user", limit: 10, windowSeconds: 60 },
    handler: async (event, ctx) => {
      const db = ctx.db.unsafeRaw(
        "tenant-handover claim: cross-tenant read + ownership write, legitimized by the " +
          "row-bound grant redeemed below",
      );
      const rootLocation = resolveRootAnchorLocation(ctx.registry, db, event.payload.entityType);
      if (!rootLocation) return notTransferable(event.payload.entityType);
      const { rootTableName, rootIdCol, rootTenantCol, loadAnchor } = rootLocation;

      const destinationTenantId = event.user.tenantId;

      let sourceTenantId: string | undefined;
      let movedEntities: Readonly<Record<string, number>> = {};

      const redeemed = await redeemRowBoundGrant({
        token: event.payload.token,
        purpose: tenantHandoverPurpose(event.payload.entityType),
        secret: opts.grantSecret,
        loadAnchor,
        commitAnchor: async (subject, expectedAnchor) => {
          const moved = await moveRootRow({
            db,
            tableName: rootTableName,
            idCol: rootIdCol,
            tenantCol: rootTenantCol,
            rowId: subject,
            sourceTenantId: expectedAnchor,
            destinationTenantId,
          });
          if (!moved) return false;

          sourceTenantId = expectedAnchor;
          movedEntities = await moveTransferGraph({
            db,
            registry: ctx.registry,
            rootEntityName: event.payload.entityType,
            rootRowId: subject,
            sourceTenantId: expectedAnchor,
            destinationTenantId,
          });

          // Own aggregate, decoupled from the transferred root's stream (see
          // events.ts) — a fresh id needs no predecessor version and can't
          // conflict with a concurrent write on the entity it describes.
          await ctx.unsafeAppendEvent({
            aggregateId: generateId(),
            aggregateType: TENANT_HANDOVER_CLAIM_AGGREGATE_TYPE,
            type: TENANT_HANDOVER_CLAIMED_EVENT_QN,
            payload: {
              entityType: event.payload.entityType,
              rootRowId: subject,
              sourceTenantId: expectedAnchor,
              destinationTenantId,
              movedEntities,
            },
          });

          return true;
        },
      });

      // sourceTenantId is only ever undefined here if commitAnchor never ran
      // or returned false before setting it — both already covered by
      // `redeemed.ok`. The explicit check narrows the type without a cast.
      if (!redeemed.ok || sourceTenantId === undefined) {
        return writeFailure(new UnprocessableError(SIGNUP_HANDOVER_BENIGN_CLAIM_REJECTION_CODE));
      }

      return {
        isSuccess: true as const,
        data: {
          entityType: event.payload.entityType,
          id: redeemed.subject,
          sourceTenantId,
          destinationTenantId,
          movedEntities,
        },
      };
    },
  });
}
