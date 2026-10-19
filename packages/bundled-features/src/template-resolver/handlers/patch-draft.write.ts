import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  type FieldIssue,
  NotFoundError,
  ValidationError,
  VersionConflictError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { DOCUMENT_HTML_KINDS } from "../constants.ts";
import { applyDocumentOps, documentOpsSchema } from "../document-ops.ts";
import { parseDocumentJson, serializeDocumentJson } from "../document-sanitizer.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { loadDocumentBase } from "./document-base.ts";
import { localeSchema, templateSlugSchema } from "./shared.ts";
import { writeTemplateRow } from "./template-write.ts";
import { validateTemplateDraft } from "./validate.query.ts";

function validationFailure(issue: FieldIssue) {
  return writeFailure(new ValidationError({ fields: [issue] }));
}

export function makePatchDraftWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "patch-draft",
    schema: z.object({
      slug: templateSlugSchema,
      kind: z.enum(DOCUMENT_HTML_KINDS),
      locale: localeSchema,
      base: z.object({
        scope: z.enum(["tenant", "system"]),
        version: z.number().int().nonnegative(),
      }),
      ops: documentOpsSchema,
    }),
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Changes a mail or PDF document template with structured operations instead of a full rewrite and saves the result as the caller's tenant draft (never published, an active version keeps being served until publish): insertBlock after a block id (null = at the start; paragraph, heading, image, button, divider, pageBreak), replaceText inside one block (the text must occur exactly once), removeBlock, setResource on an image block, setMeta (flat merge, null removes a key) and setVariable (adds, replaces or with null removes a variable definition; refused when a notification declares the variables). Block ids and base come from document-blocks and refer to the state that was read; if the template changed since, the call fails with version_conflict and nothing is written. A patch that removes a required placeholder is refused. A TenantAdmin may patch only templates the app lists in tenantEditable, otherwise SystemAdmin only. Returns the written row.",
    handler: async (event, ctx) => {
      const { slug, kind, locale, base, ops } = event.payload;
      const refused = refuseTemplateEdit(policy, event.user, { slug, kind });
      if (refused !== null) return refused;
      const loaded = await loadDocumentBase(ctx, event.user, { slug, kind, locale });
      if (loaded === null) return writeFailure(new NotFoundError("template-resource", slug));
      if (loaded.base.scope !== base.scope || loaded.base.version !== base.version) {
        return writeFailure(
          new VersionConflictError({
            entityId: loaded.rowId,
            expectedVersion: base.version,
            currentVersion: loaded.base.version,
          }),
        );
      }

      const variableOpIndex = ops.findIndex((op) => op.op === "setVariable");
      if (
        variableOpIndex !== -1 &&
        ctx.registry.getAllNotifications().get(slug)?.variables !== undefined
      ) {
        return validationFailure({
          path: `ops.${variableOpIndex}`,
          code: "variables_declared_by_feature",
          i18nKey: "templateResolver.errors.patch.variablesDeclaredByFeature",
          params: { slug },
        });
      }

      const applied = applyDocumentOps({
        doc: parseDocumentJson(loaded.content),
        meta: loaded.meta,
        variableSchema: loaded.variableSchema,
        kind,
        ops,
      });
      if (!applied.ok) return writeFailure(new ValidationError({ fields: applied.issues }));
      const content = serializeDocumentJson(applied.doc);

      const draftOf = (
        draftContent: string,
        meta: unknown,
        variableSchema: Record<string, unknown>,
      ) =>
        validateTemplateDraft(ctx, event.user, {
          slug,
          kind,
          contentFormat: "html",
          content: draftContent,
          meta,
          variableSchema,
          locale,
          scope: "tenant",
        });
      const before = await draftOf(loaded.content, loaded.meta, loaded.variableSchema);
      const after = await draftOf(content, applied.meta, applied.variableSchema);
      const alreadyMissing = new Set(before.response.missingRequired);
      const removed = after.response.missingRequired.filter((name) => !alreadyMissing.has(name));
      if (removed.length > 0) {
        return validationFailure({
          path: "ops",
          code: "required_placeholder_removed",
          i18nKey: "templateResolver.errors.patch.requiredPlaceholderRemoved",
          params: { names: removed },
        });
      }

      return writeTemplateRow({
        ctx,
        user: event.user,
        tenantId: event.user.tenantId,
        scope: "tenant",
        status: "draft",
        variables: resolveTemplateVariables(ctx.registry, slug, applied.variableSchema),
        payload: {
          slug,
          kind,
          locale,
          content,
          contentFormat: "html",
          variableSchema: applied.variableSchema,
          meta: applied.meta,
          title: loaded.title,
          folder: loaded.folder,
          parentTemplateId: loaded.parentTemplateId,
        },
        expectedVersion: loaded.base.scope === "tenant" ? loaded.base.version : null,
      });
    },
  });
}
