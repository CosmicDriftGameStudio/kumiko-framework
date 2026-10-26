// acknowledge-quarantine — the mailbox owner or admin has seen quarantined mails. Open entries (all of
// the mailbox, or just one when providerMessageId is given) are marked acknowledged; once none is left
// the supervisor returns the mailbox to active.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  failNotFound,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { quarantineTable } from "../quarantine-entities.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";
import { mayManageQuarantine } from "./scope-visibility.ts";

export const acknowledgeQuarantineSchema = z.object({
  accountId: z.uuid(),
  providerMessageId: z.string().min(1).max(500).optional(),
});

export const acknowledgeQuarantineHandler: WriteHandlerDef = {
  name: "acknowledge-quarantine",
  schema: acknowledgeQuarantineSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin", "User"] },
  agent: { expose: false },
  description:
    "Marks the open quarantine entries of a mailbox as acknowledged, all of them or only the one mail named by providerMessageId, i.e. the mails the import could not take have been looked at; the mailbox leaves the interrupted state on the next sync. The owner of a personal mailbox or an admin may call it. Returns the number of acknowledged entries.",
  handler: async (event, ctx) => {
    const payload = acknowledgeQuarantineSchema.parse(event.payload);
    const account = await loadCurrentMailAccountPayload(ctx, payload.accountId);
    if (!account) return failNotFound("mail-account", payload.accountId);
    if (!mayManageQuarantine(account.ownerUserId, event.user)) {
      return writeFailure(new AccessDeniedError({ details: { reason: "not_mailbox_owner" } }));
    }
    const updated = await ctx.db.updateMany(
      quarantineTable,
      { acknowledgedAt: Temporal.Now.instant().toString() },
      {
        accountId: payload.accountId,
        acknowledgedAt: null,
        ...(payload.providerMessageId !== undefined && {
          providerMessageId: payload.providerMessageId,
        }),
      },
    );
    return { isSuccess: true as const, data: { acknowledged: updated.length } };
  },
};
