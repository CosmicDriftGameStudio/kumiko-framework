// list-accounts — tenant-scoped list of connected mailboxes for the
// Connect/Settings UI. PII (address) is decrypted on read, following the
// billing-foundation list-subscriptions pattern.
//
// **Scope visibility:** authorized users can see shared mailboxes
// (ownerUserId=null); personal mailboxes are visible only to their owner,
// TenantAdmin, or SystemAdmin for compliance access. Filtering runs in memory
// after the tenant-scoped select because a tenant has only a single- to
// double-digit number of connected mailboxes.
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import { MAX_LIST_LIMIT, type QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { MAIL_ACCOUNT_PII_FIELDS } from "../entities.ts";
import { mailAccountsProjectionTable } from "../projection.ts";
import { isVisibleToCaller } from "./scope-visibility.ts";

// The projectionList screen always sends `limit`; unknown keys stay rejected.
const listAccountsSchema = z
  .object({ limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(MAX_LIST_LIMIT) })
  .strict();

export const listAccountsQuery: QueryHandlerDef = {
  name: "account:list",
  schema: listAccountsSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin", "User"] },
  description:
    "Lists the connected mailboxes of the caller's tenant with the mailbox address decrypted, hiding personal mailboxes the caller neither owns nor administers; use it for the mail connect and settings views.",
  handler: async (query, ctx) => {
    const { limit } = listAccountsSchema.parse(query.payload);
    const allRows = await ctx.db.selectMany(mailAccountsProjectionTable, {
      tenantId: ctx.user.tenantId,
    });
    const rows = allRows
      .filter((row) => isVisibleToCaller(row, ctx.user))
      .sort((a, b) => String(a["id"]).localeCompare(String(b["id"])))
      .slice(0, limit);
    const piiKms = configuredPiiSubjectKms();
    if (!piiKms) return { rows };
    const decryptedRows = await Promise.all(
      rows.map((row) =>
        decryptPiiFieldValues(row, MAIL_ACCOUNT_PII_FIELDS, piiKms, {
          requestId: `inbound-mail-foundation:list-accounts:${ctx.user.tenantId}`,
        }),
      ),
    );
    return { rows: decryptedRows };
  },
};
