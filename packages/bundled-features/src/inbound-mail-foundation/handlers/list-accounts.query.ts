// list-accounts — tenant-scoped Liste der verbundenen Postfächer fürs
// Connect-/Settings-UI. PII (address) wird beim Read decrypted (Muster
// billing-foundation list-subscriptions).
//
// **Scope-Sichtbarkeit (Plan Entscheidung 2):** shared-Postfächer
// (ownerUserId=null) sieht jeder Berechtigte; persönliche nur der Owner
// selbst + TenantAdmin/SystemAdmin (Compliance-Sicht). Filter läuft
// in-memory nach dem tenant-scoped select — Volumen ist die Anzahl
// verbundener Postfächer eines Tenants (einstellig bis zweistellig).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { MAIL_ACCOUNT_PII_FIELDS } from "../entities";
import { mailAccountsProjectionTable } from "../projection";
import { isVisibleToCaller } from "./scope-visibility";

const listAccountsSchema = z.object({}).strict();

export const listAccountsQuery: QueryHandlerDef = {
  name: "account:list",
  schema: listAccountsSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin", "User"] },
  handler: async (_query, ctx) => {
    const allRows = await selectMany(ctx.db.raw, mailAccountsProjectionTable, {
      tenantId: ctx.user.tenantId,
    });
    const rows = allRows.filter((row) => isVisibleToCaller(row, ctx.user));
    const piiKms = configuredPiiSubjectKms();
    if (!piiKms) return { rows };
    const decryptedRows = await Promise.all(
      rows.map((row) =>
        decryptPiiFieldValues(row as Record<string, unknown>, MAIL_ACCOUNT_PII_FIELDS, piiKms, {
          requestId: `inbound-mail-foundation:list-accounts:${ctx.user.tenantId}`,
        }),
      ),
    );
    return { rows: decryptedRows };
  },
};
