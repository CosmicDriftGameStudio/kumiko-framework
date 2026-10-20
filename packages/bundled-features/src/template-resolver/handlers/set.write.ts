import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { TEMPLATE_KINDS, TEXT_BLOCK_KIND, UPSERT_KINDS } from "../web/constants.ts";
import { contentFormatSchema, executor, folderSchema, localeSchema, slugSchema } from "./shared.ts";
import { parseStoredJson, storedRecord } from "./template-gates.ts";
import { gateTemplateWrite } from "./template-write.ts";

// Upsert of a single resource, one operation per (tenantId, slug, kind,
// locale). This is the content-tree authoring path: unlike upsertTenant it
// takes a title and a folder, has no draft stage (saving publishes) and it may
// write onto SYSTEM_TENANT_ID, which is where legal and marketing copy lives.
// Cross-tenant writes are SystemAdmin-only.
//
// `kind` defaults to text-block. A collection editor passes its own kind; on
// update only title/content/contentFormat/folder move, so a mail template's
// variableSchema and status survive being edited through the tree.
//
// On CREATE this path stays what it is for text-blocks: status "active",
// empty variableSchema, no parent. A mail template created through a
// collection tree is therefore live immediately and skips the
// upsertTenant → publish draft stage. That is the deliberate split between
// the two authoring routes — use upsertSystem/upsertTenant when a template
// needs a draft or a variable schema.
//
// Kinds that upsertSystem/upsertTenant also write run the same validation
// pipeline here, and because saving publishes, publish issues reject too.
export function makeSetWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
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
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Creates or overwrites one content-tree resource addressed by slug, kind and locale, carrying a title and folder and going live on save with no draft stage; a SystemAdmin may target the system tenant, where shared legal and marketing copy lives. A TenantAdmin may write only the slug and kind pairs the app lists in tenantEditable, otherwise SystemAdmin only.",
    handler: async (event, ctx) => {
      const kind = event.payload.kind ?? TEXT_BLOCK_KIND;
      const refused = refuseTemplateEdit(policy, event.user, { slug: event.payload.slug, kind });
      if (refused !== null) return refused;
      const override = event.payload.tenantIdOverride;
      // @cast-boundary engine-payload — override is a zod-validated string, the
      // user's own tenantId is already TenantId-branded.
      const tenantId = (override ?? event.user.tenantId) as TenantId;
      const { db, streamTenantId } = requireForTenant(ctx, tenantId);

      const existing = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
        tenantId,
        slug: event.payload.slug,
        kind,
        locale: event.payload.locale,
      });

      const scope = tenantId === SYSTEM_TENANT_ID ? ("system" as const) : ("tenant" as const);
      let content = event.payload.content;
      if (isOneOf(UPSERT_KINDS, kind)) {
        const gated = gateTemplateWrite(
          {
            kind,
            scope,
            contentFormat: event.payload.contentFormat,
            content,
            rawMeta: parseStoredJson(existing?.meta ?? null),
            variables: resolveTemplateVariables(
              ctx.registry,
              event.payload.slug,
              storedRecord(existing?.variableSchema ?? null),
            ),
          },
          "active",
        );
        if (!gated.ok) return gated.failure;
        content = gated.evaluated.content;
      }

      const fields = {
        slug: event.payload.slug,
        kind,
        locale: event.payload.locale,
        title: event.payload.title,
        content,
        contentFormat: event.payload.contentFormat,
        folder: event.payload.folder ?? null,
        variableSchema: "{}",
        linkedResources: "{}",
        scope,
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
          event.user,
          db,
          { streamTenantId },
        );
        if (!result.isSuccess) return result;
        return {
          isSuccess: true as const,
          data: { slug: event.payload.slug, locale: event.payload.locale, isNew: false },
        };
      }

      const result = await executor.create({ ...fields, tenantId }, event.user, db, {
        streamTenantId,
      });
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { slug: event.payload.slug, locale: event.payload.locale, isNew: true },
      };
    },
  });
}
