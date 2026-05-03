import { createEventStoreExecutor, fetchOne } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type TextBlockRow, textBlockEntity, textBlocksTable } from "../table";

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case (lowercase, digits, dashes)");

const langSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[a-z]{2})?$/i, "lang must be ISO 639-1 (e.g. de, en, en-us)");

const executor = createEventStoreExecutor(textBlocksTable, textBlockEntity, {
  entityName: "text-block",
});

// Upsert handler — eine Operation pro (tenantId, slug, lang). Bei
// existierender Row → update, sonst → create. Tenant-Scope kommt
// automatisch aus event.user. Tenant-Admins setzen Texte für ihren
// eigenen Tenant; Plattform-Sysadmins setzen Texte für SYSTEM_TENANT_ID.
export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    slug: slugSchema,
    lang: langSchema,
    title: z.string().min(1).max(200),
    body: z.string().max(100_000).nullable(),
  }),
  // SystemAdmin ist eine GLOBALE Rolle (users.roles), TenantAdmin pro
  // tenant-membership. SystemAdmin braucht beide Pfade explizit weil
  // er nicht implicit TenantAdmin auf jedem Tenant ist (siehe
  // project_global_roles_sysadmin memory). Ohne SystemAdmin könnte
  // niemand SYSTEM_TENANT-Texte setzen — nur via Test-Helper.
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const tenantId = event.user.tenantId;

    const existing = await fetchOne<TextBlockRow>(
      db,
      textBlocksTable,
      eq(textBlocksTable["tenantId"], tenantId),
      eq(textBlocksTable["slug"], event.payload.slug),
      eq(textBlocksTable["lang"], event.payload.lang),
    );

    if (existing) {
      const result = await executor.update(
        {
          id: existing.id,
          version: existing.version,
          changes: {
            title: event.payload.title,
            body: event.payload.body,
          },
        },
        event.user,
        db,
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { slug: event.payload.slug, lang: event.payload.lang, isNew: false },
      };
    }

    const result = await executor.create(
      {
        slug: event.payload.slug,
        lang: event.payload.lang,
        title: event.payload.title,
        body: event.payload.body,
        tenantId,
      },
      event.user,
      db,
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { slug: event.payload.slug, lang: event.payload.lang, isNew: true },
    };
  },
});
