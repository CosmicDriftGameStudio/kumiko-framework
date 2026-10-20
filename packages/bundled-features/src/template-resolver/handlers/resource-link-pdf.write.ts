import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { linkTemplatePdfAttachment } from "../store-template-resource.ts";
import {
  refuseTemplateEditById,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resourceKeySchema, resourceTargetTenantId } from "./resource-shared.ts";

export function makeResourceLinkPdfWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "resource-link-pdf",
    schema: z.object({
      templateId: z.string().min(1),
      key: resourceKeySchema,
      /** Slug of a document-pdf template of the tenant or the system. */
      templateSlug: z.string().min(1),
      /** Name pattern of the attached PDF; may hold {{placeholders}}, must end with .pdf. */
      fileName: z.string().min(1),
      /** Cross-tenant target — SystemAdmin only. */
      tenantIdOverride: z.string().min(1).optional(),
    }),
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Links a PDF rendered from a document-pdf template into a mail template under the key. Every mail sent from the template then carries that PDF, rendered at send time with the mail's own variables and locale; nothing is uploaded or stored. fileName is a pattern that may use the mail's {{placeholders}} and must end with .pdf. The document template must exist for the tenant or the system. Counts toward the 10 attachments per mail template together with uploaded files. Outside the templates the app lists in tenantEditable only a SystemAdmin may use it.",
    handler: async (event, ctx) => {
      const { templateId, key, templateSlug, fileName } = event.payload;
      const tenantId = resourceTargetTenantId(event.payload.tenantIdOverride, event.user.tenantId);
      const refused = await refuseTemplateEditById(
        ctx.db,
        policy,
        event.user,
        tenantId,
        templateId,
      );
      if (refused !== null) return refused;
      return linkTemplatePdfAttachment({
        ctx,
        user: event.user,
        tenantId,
        templateId,
        key,
        templateSlug,
        fileName,
      });
    },
  });
}
