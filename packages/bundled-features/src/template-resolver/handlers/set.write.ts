import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  crossTenantOverrideDenied,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { TEMPLATE_KINDS, TEXT_BLOCK_KIND } from "../constants";
import { type TemplateResourceRow, templateResourcesTable } from "../table";
import { contentFormatSchema, executor, folderSchema, localeSchema, slugSchema } from "./shared";

// Upsert of a single resource, one operation per (tenantId, slug, kind,
// locale). This is the content-tree authoring path: unlike upsertTenant it
// takes a title and a folder, has no draft stage (saving publishes) and it may
// write onto SYSTEM_TENANT_ID, which is where legal and marketing copy lives.
// Cross-tenant writes are SystemAdmin-only.
//
// `kind` defaults to text-block. A collection editor passes its own kind; on
// update only title/content/contentFormat/folder move, so a mail template's
// variableSchema and status survive being edited through the tree.
export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    slug: slugSchema,
    locale: localeSchema,
    /** Which kind to author. Defaults to text-block. */
    kind: z.enum(TEMPLATE_KINDS).optional(),
    title: z.string().min(1).max(200),
    content: z.string().max(200_000).nullable(),
    contentFormat: contentFormatSchema.default("markdown"),
    /** Folder path for the content tree. Optional + null = root node. */
    folder: folderSchema.nullable().optional(),
    /** Optional cross-tenant write — SystemAdmin only. Typical use: the
     *  editor lets a SystemAdmin write onto SYSTEM_TENANT_ID, otherwise the
     *  text lands on their own platform tenant and the legal routes miss it. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  // SystemAdmin is a global role, TenantAdmin is per tenant-membership — both
  // paths are needed explicitly, otherwise nobody can set SYSTEM_TENANT texts.
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const override = event.payload.tenantIdOverride;
    const overrideDenied = crossTenantOverrideDenied(
      event.user,
      override,
      "templateResolver.errors.tenantOverrideRequiresSystemAdmin",
    );
    if (overrideDenied) return writeFailure(overrideDenied);
    // @cast-boundary engine-payload — override is a zod-validated string, the
    // user's own tenantId is already TenantId-branded.
    const tenantId = (override ?? event.user.tenantId) as TenantId;
    // With an override the executor user has to move to the target tenant too,
    // otherwise the event-store stream lookup runs against event.user.tenantId
    // and reports a version conflict although the projection row exists.
    const executorUser = override !== undefined ? { ...event.user, tenantId } : event.user;

    const kind = event.payload.kind ?? TEXT_BLOCK_KIND;
    const existing = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId,
      slug: event.payload.slug,
      kind,
      locale: event.payload.locale,
    });

    const fields = {
      slug: event.payload.slug,
      kind,
      locale: event.payload.locale,
      title: event.payload.title,
      content: event.payload.content,
      contentFormat: event.payload.contentFormat,
      folder: event.payload.folder ?? null,
      variableSchema: "{}",
      linkedResources: "{}",
      scope: tenantId === SYSTEM_TENANT_ID ? ("system" as const) : ("tenant" as const),
      parentTemplateId: null,
      // Text blocks have no draft stage — saving publishes, so resolveTemplate
      // (which only returns active rows) finds them.
      status: "active" as const,
    };

    if (existing) {
      const result = await executor.update(
        {
          id: existing.id,
          version: existing.version,
          // Only the editable columns — slug/kind/locale are the unique key,
          // and rewriting scope/status/variableSchema here would reset whatever
          // the template upserts put on the row.
          changes: {
            title: fields.title,
            content: fields.content,
            contentFormat: fields.contentFormat,
            folder: fields.folder,
          },
        },
        executorUser,
        db,
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { slug: event.payload.slug, locale: event.payload.locale, isNew: false },
      };
    }

    const result = await executor.create({ ...fields, tenantId }, executorUser, db);
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { slug: event.payload.slug, locale: event.payload.locale, isNew: true },
    };
  },
});
