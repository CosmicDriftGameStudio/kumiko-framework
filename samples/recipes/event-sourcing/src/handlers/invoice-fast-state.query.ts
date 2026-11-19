import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import {
  type InvoiceState,
  type InvoiceStateRecord,
  initialInvoiceState,
  reduceInvoice,
} from "../schema";

// Snapshot-aware fast path. Uses the latest snapshot if available and
// only replays delta events past it. Identical state shape to
// invoice:state — the two are interchangeable modulo the perf profile.
export const invoiceFastStateQuery = defineQueryHandler({
  name: "invoice:fast-state",
  schema: z.object({ id: z.uuid() }),
  handler: async (query, ctx) => {
    const result = await ctx.events.loadWithSnapshot<InvoiceStateRecord>(
      query.payload.id,
      (state, evt) => {
        const next: InvoiceStateRecord = { ...state };
        reduceInvoice(next as unknown as InvoiceState, evt);
        return next;
      },
      { ...initialInvoiceState } as InvoiceStateRecord,
      // Auto-snapshot policy: once 100+ delta events pile up past the last
      // snapshot, the read path persists a fresh one (best-effort). Bump
      // snapshotVersion whenever the reducer's state SHAPE changes — a
      // stale-shape snapshot is then ignored and rebuilt from the log.
      { snapshotEvery: 100, snapshotVersion: 1 },
    );
    return {
      state: result.state,
      version: result.version,
      snapshotHit: result.snapshotHit,
    };
  },
  access: {
    openToAll: {
      reason:
        "demo recipe: any signed-in user may read the snapshot-accelerated invoice " +
        "state; there is no per-user invoice ownership in this sample",
    },
  },
});
