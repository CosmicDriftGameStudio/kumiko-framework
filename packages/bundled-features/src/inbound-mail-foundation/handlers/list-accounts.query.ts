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
import {
  IMAP_PROVIDER_KEY,
  InboundMailAccountStatuses,
  InboundMailAuthMethods,
  type MailAccountReactivationPath,
  MailAccountReactivationPaths,
} from "../constants.ts";
import { MAIL_ACCOUNT_PII_FIELDS } from "../entities.ts";
import { mailAccountsProjectionTable } from "../projection.ts";
import { quarantineTable } from "../quarantine-entities.ts";
import { isVisibleToCaller, mayReactivateMailbox } from "./scope-visibility.ts";

const REACTIVATABLE_STATUSES: ReadonlySet<unknown> = new Set([
  InboundMailAccountStatuses.disconnected,
  InboundMailAccountStatuses.authError,
]);

// Null where no way back exists for this caller, so no row action leads into a refusal.
function reactivationPathOf(
  row: Readonly<Record<string, unknown>>,
  user: { readonly id: string; readonly roles: readonly string[] },
): MailAccountReactivationPath | null {
  if (!REACTIVATABLE_STATUSES.has(row["status"])) return null;
  if (!mayReactivateMailbox(row["ownerUserId"], user)) return null;
  if (row["authMethod"] === InboundMailAuthMethods.oauth)
    return MailAccountReactivationPaths.oauthFlow;
  const isPasswordImap =
    row["provider"] === IMAP_PROVIDER_KEY && row["authMethod"] === InboundMailAuthMethods.password;
  return isPasswordImap ? MailAccountReactivationPaths.passwordForm : null;
}

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
    // One grouped count for all mailboxes instead of a query per row.
    const openQuarantine = await ctx.db.aggregate(
      quarantineTable,
      { measure: { fn: "count" }, groupBy: [{ field: "accountId" }] },
      { acknowledgedAt: null },
    );
    const quarantinedCountOf = new Map(
      openQuarantine.map((group) => [String(group.keys[0]), group.value ?? 0]),
    );
    // The screen's row condition cannot compare a count or combine fields, so it gets booleans.
    const withQuarantine = (row: Record<string, unknown>) => {
      const quarantinedCount = quarantinedCountOf.get(String(row["id"])) ?? 0;
      return {
        ...row,
        quarantinedCount,
        hasOpenQuarantine: quarantinedCount > 0,
        reactivateVia: reactivationPathOf(row, ctx.user),
      };
    };
    const piiKms = configuredPiiSubjectKms();
    if (!piiKms) return { rows: rows.map(withQuarantine) };
    const decryptedRows = await Promise.all(
      rows.map((row) =>
        decryptPiiFieldValues(row, MAIL_ACCOUNT_PII_FIELDS, piiKms, {
          requestId: `inbound-mail-foundation:list-accounts:${ctx.user.tenantId}`,
        }),
      ),
    );
    return { rows: decryptedRows.map(withQuarantine) };
  },
};
