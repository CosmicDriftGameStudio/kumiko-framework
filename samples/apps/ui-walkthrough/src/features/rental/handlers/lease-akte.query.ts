import type { EventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { open } from "../access";
import {
  formatGermanDate,
  formatGermanMoney,
  germanStatusLabel,
  idPayloadSchema,
  leaseExecutor,
  parseLeaseRow,
  partyExecutor,
  positionExecutor,
} from "../lease-support";

export const leaseAkteQuery = defineQueryHandler({
  name: "lease:akte",
  schema: idPayloadSchema,
  handler: async (query, ctx) => {
    const row = await leaseExecutor.detail({ id: query.payload.id }, query.user, ctx.db);
    if (!row) return failNotFound("lease", query.payload.id);
    const lease = parseLeaseRow(row);
    const countChildren = async (executor: EventStoreExecutor): Promise<number> => {
      const page = await executor.list(
        { filter: { field: "lease", op: "eq", value: lease.id }, limit: 1, totalCount: true },
        query.user,
        ctx.db,
      );
      return page.total ?? page.rows.length;
    };
    return {
      id: lease.id,
      mieter: lease.mieter,
      status: lease.status,
      statusLabel: germanStatusLabel(lease.status, lease.ende),
      grundmiete: formatGermanMoney(lease.grundmiete),
      beginn: formatGermanDate(lease.beginn),
      kuendigungsfrist: lease.kuendigungsfrist ?? "",
      zahltag: lease.zahltag != null ? `Tag ${lease.zahltag}` : "",
      einheit: lease.einheit ?? "",
      liegenschaft: lease.liegenschaft ?? "",
      ende: "",
      vorgaenger: lease.vorgaenger ?? "",
      kontostand: "0,00 €",
      notizen: "",
      partyCount: await countChildren(partyExecutor),
      positionCount: await countChildren(positionExecutor),
    };
  },
  ...open,
});
