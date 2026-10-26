// retry-quarantined-message — marks one quarantined mail for a reload. The next successful sync of
// the mailbox fetches it again and, when it now goes through, removes the quarantine row
// (quarantine-retry.ts). The handler only flags; the supervisor owns the provider connection.

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
import { isVisibleToCaller } from "./scope-visibility.ts";

export const retryQuarantinedMessageSchema = z
  .object({ accountId: z.uuid(), providerMessageId: z.string().min(1).max(500) })
  .strict();

function mayRetry(
  ownerUserId: string | null,
  user: { readonly id: string; readonly roles: readonly string[] },
): boolean {
  const isAdmin = user.roles.includes("TenantAdmin") || user.roles.includes("SystemAdmin");
  // A shared mailbox is administered by admins; a personal one by its owner (and admins, as for reading).
  return ownerUserId === null ? isAdmin : isVisibleToCaller({ ownerUserId }, user);
}

export const retryQuarantinedMessageHandler: WriteHandlerDef = {
  name: "retry-quarantined-message",
  schema: retryQuarantinedMessageSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin", "User"] },
  agent: { expose: false },
  description:
    "Asks for a quarantined mail to be loaded again from the provider on the next sync of its mailbox; the owner of a personal mailbox or an admin may call it, and the quarantine entry disappears once the mail went through.",
  handler: async (event, ctx) => {
    const payload = retryQuarantinedMessageSchema.parse(event.payload);
    const account = await loadCurrentMailAccountPayload(ctx, payload.accountId);
    if (!account) return failNotFound("mail-account", payload.accountId);
    if (!mayRetry(account.ownerUserId, event.user)) {
      return writeFailure(new AccessDeniedError({ details: { reason: "not_mailbox_owner" } }));
    }
    const updated = await ctx.db.updateMany(
      quarantineTable,
      { retryRequestedAt: Temporal.Now.instant().toString() },
      { accountId: payload.accountId, providerMessageId: payload.providerMessageId },
    );
    if (updated.length === 0) return failNotFound("mail-quarantine", payload.providerMessageId);
    return { isSuccess: true as const, data: { requested: true as const } };
  },
};
