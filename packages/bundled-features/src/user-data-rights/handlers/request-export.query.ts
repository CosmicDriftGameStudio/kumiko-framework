// GET /api/user/request-export (S2.U3) — DSGVO Art. 15 + 20.
//
// Synchroner Export-Bundle-Builder: User triggert + bekommt sofort das
// JSON-Bundle aller seiner Daten zurueck (alle Tenant-Memberships +
// alle EXT_USER_DATA-export-Hooks). File-Binaries sind NICHT inline —
// nur fileRef-Stueckliste. Storage-Mount + signed-URLs kommen mit
// einem optionalen Async-Job-Wrap (siehe run-user-export.ts Header).
//
// Access: openToAll — User exporten ihre eigenen Daten. event.user.id
// als userId — kein Cross-User-Export moeglich.

import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { runUserExport, type UserExportBundle } from "../run-user-export";

export const requestExportQuery = defineQueryHandler({
  name: "request-export",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx): Promise<UserExportBundle> => {
    if (!ctx.registry) {
      throw new InternalError({
        message: "request-export: ctx.registry missing",
      });
    }
    const T = getTemporal();
    return runUserExport({
      db: ctx.db.raw,
      registry: ctx.registry,
      userId: query.user.id,
      now: T.Now.instant(),
    });
  },
});
