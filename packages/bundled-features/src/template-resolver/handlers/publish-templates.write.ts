import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { parseTemplateDraft } from "../template-draft.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { TemplateResolverErrors } from "../web/qualified-names.ts";
import { failureReason } from "./failure-reason.ts";
import { kindSchema, localeSchema, templateSlugSchema } from "./shared.ts";
import { changeRowStatus } from "./toggle-status.write.ts";

const MAX_PUBLISHED_TEMPLATES = 200;

const templateRefSchema = z.object({
  slug: templateSlugSchema,
  kind: kindSchema,
  locale: localeSchema,
});

type TemplateRef = z.infer<typeof templateRefSchema>;
type FailedTemplate = TemplateRef & { readonly reason: string };

export function makePublishTemplatesWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "publish-templates",
    schema: z.object({
      templates: z.array(templateRefSchema).min(1).max(MAX_PUBLISHED_TEMPLATES),
    }),
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Publishes the open drafts of several tenant templates in one call, each exactly as publish would: the same edit right per template and the same gate (unknown placeholders, unused required variables). A template that is refused or fails the gate lands in failed with the reason and does not stop the others; a template without an open draft that is already active is reported as failed with template_already_active. Returns published and failed.",
    handler: async (event, ctx) => {
      const published: TemplateRef[] = [];
      const failed: FailedTemplate[] = [];
      const seen = new Set<string>();
      for (const ref of event.payload.templates) {
        const key = `${ref.kind}\u0000${ref.slug}\u0000${ref.locale}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const refused = refuseTemplateEdit(policy, event.user, ref);
        if (refused !== null) {
          failed.push({ ...ref, reason: failureReason(refused) });
          continue;
        }
        const row = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
          tenantId: event.user.tenantId,
          ...ref,
        });
        if (row === undefined || row.scope !== "tenant") {
          failed.push({ ...ref, reason: TemplateResolverErrors.notFound });
          continue;
        }
        if (row.status === "active" && parseTemplateDraft(row.draft) === null) {
          failed.push({ ...ref, reason: TemplateResolverErrors.alreadyActive });
          continue;
        }
        const ownRowTarget = { db: ctx.db, scoped: null };
        const result = await changeRowStatus(ctx, event.user, ownRowTarget, row, "active");
        if (result.isSuccess) published.push(ref);
        else failed.push({ ...ref, reason: failureReason(result) });
      }
      return { isSuccess: true as const, data: { published, failed } };
    },
  });
}
