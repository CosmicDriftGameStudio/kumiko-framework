// User-Data-Rights — Recipe
//
// Wie eine App-Domain DSGVO-Pipeline integriert: pro Entity einen
// (export, delete)-Hook ueber EXT_USER_DATA. Forget-Cron, Export-ZIP-Bau
// und Magic-Link-Versand kommen vollstaendig aus user-data-rights —
// App-Author schreibt nur die zwei Hooks pro Entity.
//
// Demo-Domain: minimaler Note-Service. Note hat (id, tenantId, authorId,
// title, body). Pinst:
//   1. Hook export liefert Note-Rows als JSON-Snippet ins Export-Bundle.
//   2. Hook delete entfernt Note-Rows beim Forget-Cleanup-Cron.
//
// Was nicht im Recipe ist (siehe samples/apps/user-data-rights-demo
// fuer eine vollstaendige App):
//   - Strategy-aware delete (anonymize vs hardDelete)
//   - HTTP-Endpoints fuer create/list
//   - Compliance-Profile-Wiring + Cron-Scheduling

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { and, eq } from "drizzle-orm";

export const noteEntity = createEntity({
  table: "read_notes",
  idType: "uuid",
  fields: {
    authorId: createTextField({}),
    title: createTextField({ required: true, maxLength: 200 }),
    body: createTextField({ maxLength: 4000 }),
  },
});

export const notesTable = buildDrizzleTable("note", noteEntity);

export const notesFeature = defineFeature("notes", (r) => {
  r.requires("user-data-rights");
  r.entity("note", noteEntity);

  // Export-Hook: Snippet pro Tenant des Users. user-data-rights iteriert
  // die Memberships und ruft den Hook pro Tenant auf.
  const exportNotes: UserDataExportHook = async (ctx) => {
    const rows = await ctx.db
      .select({
        id: notesTable["id"],
        title: notesTable["title"],
        body: notesTable["body"],
      })
      .from(notesTable)
      .where(and(eq(notesTable["tenantId"], ctx.tenantId), eq(notesTable["authorId"], ctx.userId)));
    if (rows.length === 0) return null;
    return {
      entity: "note",
      rows: rows.map((row) => ({
        id: String(row["id"]),
        title: row["title"] ?? "",
        body: row["body"] ?? "",
      })),
    };
  };

  // Delete-Hook: hardDelete bei strategy="delete", row-anonymize bei
  // strategy="anonymize". user-data-rights resolved die Strategy aus
  // retention.policyFor pro Entity (HR-Compliance kann anonymize forcen).
  const deleteNotes: UserDataDeleteHook = async (ctx, strategy) => {
    const where = and(
      eq(notesTable["tenantId"], ctx.tenantId),
      eq(notesTable["authorId"], ctx.userId),
    );
    if (strategy === "anonymize") {
      await ctx.db.update(notesTable).set({ authorId: null }).where(where);
    } else {
      await ctx.db.delete(notesTable).where(where);
    }
  };

  r.useExtension(EXT_USER_DATA, "note", {
    export: exportNotes,
    delete: deleteNotes,
  });
});
