// Marker for the one-time checkout-ledger backfill: the first completed sweep is
// recorded as an event on a fixed system-tenant stream, so every worker and every
// restart agrees on when the takeover window began.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { v5 as uuidv5 } from "uuid";
import * as z from "zod";
import { SUBSCRIPTION_PADDLE_FEATURE } from "./constants.ts";

export const LEDGER_BACKFILL_EVENT_SHORT = "ledger-backfill-sweep-completed" as const;
export const LEDGER_BACKFILL_EVENT_QN =
  `${SUBSCRIPTION_PADDLE_FEATURE}:event:${LEDGER_BACKFILL_EVENT_SHORT}` as const;
export const LEDGER_BACKFILL_AGGREGATE_TYPE = "paddle-ledger-backfill" as const;

// Set in stone: changing it would orphan the marker and restart the takeover window.
const LEDGER_BACKFILL_NAMESPACE = "b4c1e7a2-5d38-4f6b-9a0e-2c7d8e1f3a59";

// @wrapper-known uuid-domain
export const LEDGER_BACKFILL_AGGREGATE_ID = uuidv5(
  "paddle-ledger-backfill",
  LEDGER_BACKFILL_NAMESPACE,
);

export const ledgerBackfillPayloadSchema = z.object({ completedAt: z.string().min(1) });

export const ledgerBackfillMarkerPayloadSchema = z.object({ markCompleted: z.boolean() });
type LedgerBackfillMarkerPayload = z.infer<typeof ledgerBackfillMarkerPayloadSchema>;

export type LedgerBackfillMarkerResult = { readonly completedAt: string | null };

export const LEDGER_BACKFILL_MARKER_HANDLER_QN =
  `${SUBSCRIPTION_PADDLE_FEATURE}:write:ledger-backfill-marker` as const;

// Reads the marker; with markCompleted it also writes it when absent. One handler
// for both, so the job never reads an event stream itself.
export const ledgerBackfillMarkerHandler: WriteHandlerDef = {
  name: "ledger-backfill-marker",
  agent: { expose: false },
  schema: ledgerBackfillMarkerPayloadSchema,
  access: { roles: ["system"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const { markCompleted } = event.payload as LedgerBackfillMarkerPayload;
    const stored = await ctx.events.load(LEDGER_BACKFILL_AGGREGATE_ID);
    const marker = stored.find((entry) => entry.type === LEDGER_BACKFILL_EVENT_QN);
    if (marker) {
      const parsed = ledgerBackfillPayloadSchema.parse(marker.payload);
      return {
        isSuccess: true as const,
        data: { completedAt: parsed.completedAt } satisfies LedgerBackfillMarkerResult,
      };
    }
    if (!markCompleted) {
      return {
        isSuccess: true as const,
        data: { completedAt: null } satisfies LedgerBackfillMarkerResult,
      };
    }
    const completedAt = ctx.tz.now().toString();
    await ctx.events.unsafeAppend({
      aggregateId: LEDGER_BACKFILL_AGGREGATE_ID,
      aggregateType: LEDGER_BACKFILL_AGGREGATE_TYPE,
      type: LEDGER_BACKFILL_EVENT_QN,
      payload: { completedAt },
    });
    return {
      isSuccess: true as const,
      data: { completedAt } satisfies LedgerBackfillMarkerResult,
    };
  },
};
