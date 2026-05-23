import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { type TextBlockRow, textBlockEntity, textBlocksTable } from "../table";

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case (lowercase, digits, dashes)");

// Folder-Convention V.1.4: gleiches kebab-Pattern wie slug, optional
// `/`-Separator für nested folders ("legal/imprint", "page/marketing").
// Multi-level wird vom Visual-Tree-Grouping flat-rendered bis V.1.5
// rekursive Hierarchie braucht — dann erweitert sich nur der UI-Render,
// nicht das Schema.
const folderSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/, "folder must be kebab-case path");

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
// default aus event.user. Tenant-Admins setzen Texte für ihren
// eigenen Tenant; Plattform-Sysadmins können via optional
// `tenantIdOverride` für einen anderen Tenant schreiben (typisch:
// SYSTEM_TENANT_ID für legal-pages-content den die ganze Plattform
// teilt). Override ist SystemAdmin-only — TenantAdmin's Override-
// Versuch → 403.
export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    slug: slugSchema,
    lang: langSchema,
    title: z.string().min(1).max(200),
    body: z.string().max(100_000).nullable(),
    /** V.1.4: Folder-Pfad für Visual-Tree-Gruppierung. Optional + null
     *  → root-node (kein Folder). Tree groupt nach diesem Field, slug
     *  bleibt flach + kebab-validiert. Beispiele: "page", "legal",
     *  "page/marketing". */
    folder: folderSchema.nullable().optional(),
    /** Optional cross-tenant write — nur für SystemAdmin. Typischer
     *  use-case: legal-pages-Edit-UI lässt SystemAdmin auf
     *  SYSTEM_TENANT_ID schreiben (sonst landet der text auf seinem
     *  eigenen platform-tenant und legal-pages-routes lesen ihn
     *  nicht). TenantAdmin's Versuch → ForbiddenError. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  // SystemAdmin ist eine GLOBALE Rolle (users.roles), TenantAdmin pro
  // tenant-membership. SystemAdmin braucht beide Pfade explizit weil
  // er nicht implicit TenantAdmin auf jedem Tenant ist (siehe
  // project_global_roles_sysadmin memory). Ohne SystemAdmin könnte
  // niemand SYSTEM_TENANT-Texte setzen — nur via Test-Helper.
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const override = event.payload.tenantIdOverride;
    if (override !== undefined && !event.user.roles.includes("SystemAdmin")) {
      return writeFailure(
        new AccessDeniedError({
          i18nKey: "textContent.errors.tenantOverrideRequiresSystemAdmin",
          details: { reason: "tenant_override_requires_system_admin" },
        }),
      );
    }
    const tenantId = override ?? event.user.tenantId;
    // Bei tenantIdOverride muss auch der user-context auf den ziel-tenant
    // umgestellt werden, sonst läuft der event-store-Lookup
    // (getStreamVersion) gegen user.tenantId statt tenantId — und findet
    // den stream nicht → version_conflict obwohl die projection-row da ist.
    // Symmetrisch zu seedTextBlock, das TestUsers.systemAdmin (tenantId =
    // SYSTEM_TENANT) als by verwendet.
    const executorUser =
      override !== undefined ? { ...event.user, tenantId: override as TenantId } : event.user; // @cast-boundary engine-bridge

    const existing = await fetchOne<TextBlockRow>(db, textBlocksTable, {
      tenantId,
      slug: event.payload.slug,
      lang: event.payload.lang,
    });

    // V.1.4 folder: optional + null erlaubt (root-node). Optional-Chain
    // mapped undefined → null damit drizzle nullable-column konsistent
    // schreibt (sonst SQL-default kicked-in vs. explicit-null Unterschied).
    const folder = event.payload.folder ?? null;

    if (existing) {
      const result = await executor.update(
        {
          id: existing.id,
          version: existing.version,
          changes: {
            title: event.payload.title,
            body: event.payload.body,
            folder,
          },
        },
        executorUser,
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
        folder,
        tenantId,
      },
      executorUser,
      db,
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { slug: event.payload.slug, lang: event.payload.lang, isNew: true },
    };
  },
});
