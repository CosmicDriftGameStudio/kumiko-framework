import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { deliveryAttemptsTable } from "../../delivery";
import { featureMounted } from "./feature-mounted";

// userData-Hooks for delivery's attempt log (deferred from #797, closed by
// #799). deliveryAttempt is an events-only aggregate — the export reads the
// projected rows; recipientAddress may be ciphertext (kumiko-pii:), which
// the export runner's central decrypt sweep resolves to plaintext (or
// [[erased]] after a forget).

export const deliveryAttemptExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "delivery")) return null;
  const rows = await selectMany<Record<string, unknown>>(ctx.db, deliveryAttemptsTable, {
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

export const deliveryAttemptDeleteHook: UserDataDeleteHook = async () => {
  // Deliberate no-op: erasure runs via crypto-shredding — the forget pipeline
  // erases the recipient's DEK, which makes recipientAddress unreadable in
  // BOTH the append-only events and the projected rows (#799). A read-side
  // UPDATE here would be wiped on the next projection rebuild anyway.
};
