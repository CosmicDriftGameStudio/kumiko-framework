// acknowledge-quarantine — the tenant admin has seen the quarantined mails of a mailbox. Open entries
// are marked acknowledged; once none is left the supervisor returns the mailbox to active.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { quarantineTable } from "../entities.ts";

export const acknowledgeQuarantineSchema = z.object({ accountId: z.uuid() });

export const acknowledgeQuarantineHandler: WriteHandlerDef = {
  name: "acknowledge-quarantine",
  schema: acknowledgeQuarantineSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  agent: { expose: false },
  description:
    "Marks all open quarantine entries of a mailbox as acknowledged, i.e. the mails the import could not take have been looked at; the mailbox leaves the interrupted state on the next sync. Returns the number of acknowledged entries.",
  handler: async (event, ctx) => {
    const payload = acknowledgeQuarantineSchema.parse(event.payload);
    const updated = await ctx.db.updateMany(
      quarantineTable,
      { acknowledgedAt: Temporal.Now.instant().toString() },
      { accountId: payload.accountId, acknowledgedAt: null },
    );
    return { isSuccess: true as const, data: { acknowledged: updated.length } };
  },
};
