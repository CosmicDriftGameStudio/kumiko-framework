import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import {
  appendEventInTenantDb,
  getStreamVersionInTenantDb,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  DELIVERY_ATTEMPT_ADDRESS_ERASED_EVENT,
  deliveryAttemptsTable,
} from "../../delivery/index.js";
import { featureMounted } from "./feature-mounted.js";

// userData-Hooks for delivery's attempt log (deferred from #797, closed by
// #799). deliveryAttempt is an events-only aggregate — the export reads the
// projected rows; recipientAddress may be ciphertext (kumiko-pii:), which
// the export runner's central decrypt sweep resolves to plaintext (or
// [[erased]] after a forget).

export const deliveryAttemptExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "delivery")) return null;
  const rows = await ctx.db.selectMany(deliveryAttemptsTable, {
    tenantId: ctx.tenantId,
    recipientId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "delivery-attempt",
    rows: rows.map((r) => ({
      notificationType: r["notificationType"],
      channel: r["channel"],
      status: r["status"],
      recipientAddress: r["recipientAddress"],
      priority: r["priority"],
      createdAt: r["createdAt"],
    })),
  };
};

// Both strategies erase the address. The DEK shredding of a forget covers KMS deployments; the
// erase event also covers plaintext mode, and unlike a read-side UPDATE it survives a projection
// rebuild. Rows without an address are skipped, which makes a second run a no-op.
export const deliveryAttemptDeleteHook: UserDataDeleteHook = async (ctx) => {
  // skip: delivery not mounted — its table doesn't exist, nothing to erase.
  if (!featureMounted(ctx, "delivery")) return;
  const rows = await ctx.db.selectMany<{ id: string; recipientAddress: string | null }>(
    deliveryAttemptsTable,
    {
      tenantId: ctx.tenantId,
      recipientId: ctx.userId,
    },
  );
  for (const row of rows) {
    if (row.recipientAddress === null) continue;
    await appendEventInTenantDb(
      ctx.db,
      {
        aggregateType: "deliveryAttempt",
        aggregateId: row.id,
        expectedVersion: await getStreamVersionInTenantDb(ctx.db, row.id),
        type: DELIVERY_ATTEMPT_ADDRESS_ERASED_EVENT,
        payload: {},
        metadata: { userId: "system" },
      },
      { registry: ctx.registry },
    );
  }
};
