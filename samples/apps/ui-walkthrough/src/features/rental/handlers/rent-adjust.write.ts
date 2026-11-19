import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { open } from "../access";
import {
  dayBefore,
  leaseExecutor,
  positionExecutor,
  positionRowSchema,
  rentAdjustPayloadSchema,
} from "../lease-support";

export const rentAdjustWrite = defineWriteHandler({
  name: "rent:adjust",
  schema: rentAdjustPayloadSchema,
  handler: async (event, ctx) => {
    const { positionId, wirksamAb, neuerBetrag } = event.payload;
    const current = await positionExecutor.detail({ id: positionId }, event.user, ctx.db);
    if (!current) return failNotFound("leasePosition", positionId);
    const position = positionRowSchema.parse(current);

    const endOld = await positionExecutor.update(
      { id: positionId, changes: { gueltigBis: dayBefore(wirksamAb) } },
      event.user,
      ctx.db,
      { skipOptimisticLock: true },
    );
    if (!endOld.isSuccess) return endOld;

    const startNew = await positionExecutor.create(
      {
        lease: position.lease,
        art: position.art,
        einheit: position.einheit ?? "",
        betrag: neuerBetrag,
        gueltigVon: wirksamAb,
      },
      event.user,
      ctx.db,
    );
    if (!startNew.isSuccess) return startNew;

    return leaseExecutor.update(
      { id: position.lease, changes: { grundmiete: neuerBetrag } },
      event.user,
      ctx.db,
      { skipOptimisticLock: true },
    );
  },
  ...open,
});
