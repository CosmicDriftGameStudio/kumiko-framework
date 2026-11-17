import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type EventDef, emitEvent } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { approverDirectoryTable } from "../schema";

export function createInvoiceAcknowledgeWrite(
  acknowledged: EventDef<{ approverId: string; approverDisplayName: string }>,
) {
  return defineWriteHandler({
    name: "invoice:acknowledge",
    schema: z.object({ id: z.uuid(), approverId: z.string() }),
    handler: async (event, ctx) => {
      const row = await fetchOne<{ displayName: string }>(ctx.db, approverDirectoryTable, {
        approverId: event.payload.approverId,
      });
      const approverDisplayName: string = row?.displayName ?? `unknown:${event.payload.approverId}`;
      await emitEvent(ctx, acknowledged, {
        aggregateId: event.payload.id,
        aggregateType: "showcase-invoice",
        payload: { approverId: event.payload.approverId, approverDisplayName },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    access: { roles: ["Admin"] },
  });
}
