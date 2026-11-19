import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { open } from "../access";
import {
  leaseExecutor,
  parseLeaseRow,
  positionExecutor,
  type RecordedPositionItem,
  recordPositionsPayloadSchema,
} from "../lease-support";

// measure and vatRate only exist to give the walkthrough form realistic column
// types; leasePosition has no fields for them.
function positionFromItem(
  lease: string,
  unitLabel: string | null | undefined,
  item: RecordedPositionItem,
) {
  return {
    lease,
    art: item.kind,
    ...(unitLabel && { einheit: unitLabel }),
    betrag: {
      amount: Math.round(item.unitPrice.amount * item.quantity),
      currency: item.unitPrice.currency,
    },
    gueltigVon: item.validFrom,
    ...(item.validTo && { gueltigBis: item.validTo }),
  };
}

export const leaseRecordPositionsWrite = defineWriteHandler({
  name: "lease:record-positions",
  schema: recordPositionsPayloadSchema,
  handler: async (event, ctx) => {
    let created: Awaited<ReturnType<typeof positionExecutor.create>> | undefined;
    const unitLabels = new Map<string, string | null | undefined>();
    for (const unitId of new Set(event.payload.items.map((item) => item.unit))) {
      const unitRow = await leaseExecutor.detail({ id: unitId }, event.user, ctx.db);
      if (!unitRow) return failNotFound("lease", unitId);
      unitLabels.set(unitId, parseLeaseRow(unitRow).einheit);
    }
    for (const item of event.payload.items) {
      created = await positionExecutor.create(
        positionFromItem(event.payload.lease, unitLabels.get(item.unit), item),
        event.user,
        ctx.db,
      );
      if (!created.isSuccess) return created;
    }
    return created ?? failNotFound("leasePosition", event.payload.lease);
  },
  ...open,
});
