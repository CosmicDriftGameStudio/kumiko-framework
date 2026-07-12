// list-messages — tenant-scoped Message-Liste (Inbox-Cockpit).
// Optionale Filter: accountId (ein Postfach), threadKey (eine
// Konversation), scope (Folder-Hint). PII (from/to/cc/subject/snippet)
// wird beim Read decrypted; to/cc bleiben JSON-stringified strings —
// der Client parsed sie (dokumentiert im Event-Payload).
//
// Bewusst KEINE Pagination in V1: die Projection ist tenant-scoped und
// das Inbox-Cockpit lädt begrenzte Zeiträume; ein `limit`-Feld ist
// vorwärtskompatibel ergänzbar ohne den QN zu brechen.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { INBOUND_MESSAGE_PII_FIELDS } from "../entities";
import { inboundMessagesProjectionTable } from "../projection";
import { isVisibleToCaller } from "./scope-visibility";

const listMessagesSchema = z
  .object({
    accountId: z.uuid().optional(),
    threadKey: z.string().min(1).max(500).optional(),
    scope: z.string().min(1).max(200).optional(),
  })
  .strict();
type ListMessagesPayload = z.infer<typeof listMessagesSchema>;

export const listMessagesQuery: QueryHandlerDef = {
  name: "message:list",
  schema: listMessagesSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin", "User"] },
  handler: async (query, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = query.payload as ListMessagesPayload;
    const filter: Record<string, unknown> = { tenantId: ctx.user.tenantId };
    if (payload.accountId) filter["accountId"] = payload.accountId;
    if (payload.threadKey) filter["threadKey"] = payload.threadKey;
    if (payload.scope) filter["scope"] = payload.scope;

    const allRows = await selectMany(ctx.db.raw, inboundMessagesProjectionTable, filter);
    // Scope-Sichtbarkeit (Plan Entscheidung 2): Messages persönlicher
    // Postfächer nur für Owner + TenantAdmin/SystemAdmin.
    const rows = allRows.filter((row) => isVisibleToCaller(row, ctx.user));
    const piiKms = configuredPiiSubjectKms();
    if (!piiKms) return { rows };
    const decryptedRows = await Promise.all(
      rows.map((row) =>
        decryptPiiFieldValues(row as Record<string, unknown>, INBOUND_MESSAGE_PII_FIELDS, piiKms, {
          requestId: `inbound-mail-foundation:list-messages:${ctx.user.tenantId}`,
        }),
      ),
    );
    return { rows: decryptedRows };
  },
};
