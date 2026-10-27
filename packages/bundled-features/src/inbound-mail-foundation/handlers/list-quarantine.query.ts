// quarantine:list — open quarantine entries with the sender and subject of the header-only import
// (looked up by the deterministic message aggregate id; null when the provider gave no headers).

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import { MAX_LIST_LIMIT, type QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { INBOUND_MESSAGE_PII_FIELDS } from "../entities.ts";
import type { InboundMailRoles } from "../mail-roles.ts";
import { inboundMessagesProjectionTable, mailAccountsProjectionTable } from "../projection.ts";
import { quarantineTable } from "../quarantine-entities.ts";
import { mayManageQuarantine } from "./scope-visibility.ts";

// The projectionList screen always sends `limit`; unknown keys stay rejected.
const listQuarantineSchema = z
  .object({
    accountId: z.uuid().optional(),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(MAX_LIST_LIMIT),
  })
  .strict();

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createListQuarantineQuery({
  memberRoles,
  adminRoles,
}: InboundMailRoles): QueryHandlerDef {
  return {
    name: "quarantine:list",
    schema: listQuarantineSchema,
    access: { roles: [...memberRoles] },
    agent: { expose: false },
    description:
      "Lists the open quarantine entries (mails the import could not take) of the mailboxes the caller may manage, newest first, with reason, retry state and the sender and subject of the header-only import when there is one; use it to review and retry quarantined mails.",
    handler: async (query, ctx) => {
      const { accountId, limit } = listQuarantineSchema.parse(query.payload);
      const accounts = await ctx.db.selectMany(mailAccountsProjectionTable, {
        tenantId: ctx.user.tenantId,
      });
      const managed = accounts.filter(
        (row) =>
          (accountId === undefined || row["id"] === accountId) &&
          mayManageQuarantine(textOrNull(row["ownerUserId"]) || null, ctx.user, adminRoles),
      );
      if (managed.length === 0) return { rows: [] };
      const accountName = new Map(managed.map((row) => [String(row["id"]), row["displayName"]]));

      const entries = await ctx.db.selectMany(
        quarantineTable,
        { accountId: { in: [...accountName.keys()] }, acknowledgedAt: null },
        { limit, orderBy: [{ col: "quarantinedAt", direction: "desc" }, { col: "id" }] },
      );
      if (entries.length === 0) return { rows: [] };

      const headers = await ctx.db.selectMany(
        inboundMessagesProjectionTable,
        {
          id: {
            in: entries.map((entry) =>
              inboundMessageAggregateId(
                String(entry["accountId"]),
                String(entry["providerMessageId"]),
              ),
            ),
          },
        },
        { fields: ["id", "from", "subject"] },
      );
      const piiKms = configuredPiiSubjectKms();
      const readableHeaders = new Map<string, Record<string, unknown>>();
      for (const header of headers) {
        const readable = piiKms
          ? await decryptPiiFieldValues(header, INBOUND_MESSAGE_PII_FIELDS, piiKms, {
              requestId: `inbound-mail-foundation:list-quarantine:${ctx.user.tenantId}`,
            })
          : header;
        readableHeaders.set(String(header["id"]), readable);
      }

      return {
        rows: entries.map((entry) => {
          const accountIdOfEntry = String(entry["accountId"]);
          const header = readableHeaders.get(
            inboundMessageAggregateId(accountIdOfEntry, String(entry["providerMessageId"])),
          );
          return {
            id: entry["id"],
            accountId: accountIdOfEntry,
            accountName: accountName.get(accountIdOfEntry) ?? null,
            providerMessageId: entry["providerMessageId"],
            reason: entry["reasonCode"],
            quarantinedAt: entry["quarantinedAt"],
            retryRequestedAt: entry["retryRequestedAt"] ?? null,
            sender: textOrNull(header?.["from"]),
            subject: textOrNull(header?.["subject"]),
          };
        }),
      };
    },
  };
}
