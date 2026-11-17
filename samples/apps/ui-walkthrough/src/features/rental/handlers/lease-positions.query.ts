import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { open } from "../access";
import {
  formatGermanDate,
  formatGermanMoney,
  idPayloadSchema,
  positionExecutor,
  positionListRowSchema,
} from "../lease-support";

export const leasePositionsQuery = defineQueryHandler({
  name: "lease:positions",
  schema: idPayloadSchema,
  handler: async (query, ctx) => {
    const page = await positionExecutor.list(
      { filter: { field: "lease", op: "eq", value: query.payload.id }, limit: 100 },
      query.user,
      ctx.db,
    );
    return {
      rows: page.rows.map((row) => {
        const position = positionListRowSchema.parse(row);
        return {
          id: position.id,
          art: position.art,
          einheit: position.einheit ?? "",
          betrag: formatGermanMoney(position.betrag),
          betragWert: position.betrag,
          gueltigVonIso: position.gueltigVon.toString(),
          gueltigVon: formatGermanDate(position.gueltigVon),
          gueltigBis: position.gueltigBis ? formatGermanDate(position.gueltigBis) : "–",
        };
      }),
    };
  },
  ...open,
});
