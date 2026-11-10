import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  type FieldIssue,
  NotFoundError,
  ValidationError,
  VersionConflictError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { applyDocumentOps, documentOpsSchema } from "../document-ops.ts";
import { parseDocumentJson, serializeDocumentJson } from "../document-sanitizer.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { loadDocumentBase } from "./document-base.ts";
import {
  contentWithEditedHtml,
  documentTargetShape,
  editableHtmlOf,
  regionIssue,
} from "./document-region.ts";
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
      ...documentTargetShape,
      locale: localeSchema,
      base: z.object({
        scope: z.enum(["tenant", "system"]),
        version: z.number().int().nonnegative(),
      }),
      ops: documentOpsSchema,
    }),
    access: templateEditAccess(policy.tenantEditable),
    agent: { risk: "low", effect: "proposal" },
    description:
      'Changes a mail template, a PDF document template (kind document-pdf) or one region of a PDF layout (kind pdf-layout with region header, signature or footer; a tenant edits its own layouts under the slug tenant-layout-<name>, created with create-layout) with structured operations instead of a full rewrite and saves the result as the caller\'s tenant draft (never published, an active version keeps being served until publish). Never send raw HTML: every block goes through the same checks as the editor. Block forms: paragraph and heading {text} or {runs:[{text,bold,italic,underline,font,sizePt,color}]} with optional align, style {lineHeight,spaceBeforePt,spaceAfterPt} and textStyle {font,sizePt,color}; list {ordered,items:[text or runs]}; table {borders:"none",columnWidthsPx,header:{cells:[{text|runs,background,align}]},rows:[{cells}],repeat:{each:<list variable>,row}} (repeat is the row printed once per list entry; header repeats on every page); frame {xMm,yMm,widthMm,heightMm,preset:address|text,reserveFlow,blocks} only in document-pdf, at the top level (the DIN address window is x20 y45 w85 h45 with preset address); image {resource,alt}; button {text,href} mails only; divider; pageBreak PDF only. Fonts, sizes, colors (#rrggbb), line spacing, borders, backgrounds and frames are print styling: PDF only, a mail refuses them with print_style_not_allowed. Operations: insertBlock after a block id (null = at the start), replaceBody {blocks} (replaces the whole content, at most 300 blocks including the ones inside frames; read ids no longer apply afterwards), formatBlock {blockId,align,style,textStyle} on a paragraph, heading or list, replaceText inside one block (the text must occur exactly once within one formatting run and cannot contain a {{placeholder}}: a find across a formatting change fails with text_spans_formatting, a find with a placeholder with placeholder_not_replaceable, and the formatting of the replaced text is kept), removeBlock, setResource on an image block, setMeta (flat merge, null removes a key) and setVariable (adds, replaces or with null removes a variable definition; refused when a notification declares the variables). Block ids and base come from document-blocks and refer to the state that was read; if the template changed since, the call fails with version_conflict and nothing is written. A patch that removes a required placeholder is refused. A TenantAdmin may patch only templates the app lists in tenantEditable, otherwise SystemAdmin only. Returns the written row.',
    handler: async (event, ctx) => {
      const { slug, kind, region, locale, base, ops } = event.payload;
      const misplacedRegion = regionIssue(kind, region);
      if (misplacedRegion !== null) return validationFailure(misplacedRegion);
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
        doc: parseDocumentJson(editableHtmlOf(kind, region, loaded.content)),
        meta: loaded.meta,
        variableSchema: loaded.variableSchema,
        kind,
        ops,
      });
      if (!applied.ok) return writeFailure(new ValidationError({ fields: applied.issues }));
      const content = contentWithEditedHtml(
        kind,
        region,
        loaded.content,
        serializeDocumentJson(applied.doc),
      );

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
